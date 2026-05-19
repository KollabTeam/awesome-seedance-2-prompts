/**
 * query.ts reads the synced landing prompt Postgres tables and converts them into gallery payloads.
 * It is used by apps/landing-pages server routes/pages as the production read path after Notion data has been
 * mirrored; tests call the pure mapper so row-shape changes are caught without requiring a live database.
 */
import { sortPromptTagsByPriority } from '@/lib/prompt-tags';
import type { LandingLanguage } from '@/lib/landing-language';
import type { PromptGalleryItem, PromptGalleryPage } from '@/lib/notion-prompts';
import { isPromptGalleryLatestTag } from '@/lib/prompt-tags';

import { queryLandingPromptDb } from './db';
import { LandingPromptStatus, type LandingPromptSourceConfig, type PromptGalleryMedia } from './types';

type StoredPromptMap = Record<string, string>;
type StoredPromptPayload =
  | StoredPromptMap
  | {
      primary?: StoredPromptMap;
      secondary?: StoredPromptMap | null;
    };

export type LandingPromptRow = {
  id: string;
  notion_created_at: Date | string | null;
  title: string;
  prompts: StoredPromptPayload | string;
  author_name: string;
  author_url: string | null;
  source_url: string | null;
  tags: string[] | string;
  like_count: number;
  sort_order: number;
};

export type LandingPromptAssetRow = {
  id: string;
  prompt_id: string;
  kind: 'prompt_media' | 'author_avatar' | string;
  media_type: 'image' | 'video' | 'unknown' | string;
  position: number;
  original_cdn_url: string | null;
  variants: Record<string, { url?: string | null; status?: string | null }> | string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
};

type LandingPromptTagRow = {
  tag: string;
};

type LandingPromptQueryFilter = {
  tag?: string | null;
  query?: string | null;
  id?: string | null;
};

const DB_CURSOR_PREFIX = 'db:';

/**
 * Encodes the current offset into an opaque DB cursor.
 * The public API already treats cursor values as implementation details, so this keeps the DB cursor format explicit
 * while preserving the existing `cursor` query parameter contract.
 */
export function encodeLandingPromptCursor(offset: number): string {
  const normalizedOffset = Math.max(0, Math.trunc(offset));
  return `${DB_CURSOR_PREFIX}${Buffer.from(JSON.stringify({ offset: normalizedOffset }), 'utf8').toString('base64url')}`;
}

/**
 * Checks whether a cursor belongs to the Postgres read path.
 * Legacy Notion cursors are rejected instead of decoded as offset 0 because public reads no longer have a Notion fallback.
 */
export function isLandingPromptDbCursor(cursor?: string | null): boolean {
  return Boolean(cursor?.startsWith(DB_CURSOR_PREFIX));
}

/**
 * Decodes an opaque DB cursor into an offset.
 * Non-DB cursors are rejected because they belong to the removed Notion pagination path; silently treating them as offset 0 would make
 * public pagination repeat the first synced DB page.
 */
export function decodeLandingPromptCursor(cursor?: string | null): number {
  if (!cursor) {
    return 0;
  }
  if (!isLandingPromptDbCursor(cursor)) {
    throw new Error('landing_prompt_cursor_not_from_db');
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor.slice(DB_CURSOR_PREFIX.length), 'base64url').toString('utf8')) as {
      offset?: unknown;
    };
    return typeof decoded.offset === 'number' && Number.isFinite(decoded.offset) ? Math.max(0, Math.trunc(decoded.offset)) : 0;
  } catch {
    throw new Error('landing_prompt_cursor_invalid');
  }
}

/**
 * Parses a JSONB value returned by node-postgres or a string fixture used by tests.
 * The mapper accepts both shapes because pg returns objects in production while route tests often use raw JSON strings.
 */
function parseJsonValue<T>(value: T | string, fallback: T): T {
  if (typeof value !== 'string') {
    return value ?? fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Selects the prompt text for the current landing language.
 * Sync writes all supported language columns, but read-time fallback remains here so partially migrated rows or a future
 * source with fewer translations still render rather than disappearing from the gallery.
 */
function getPromptTextForLanguage(promptsValue: StoredPromptMap | string, language: LandingLanguage): string {
  const prompts = parseJsonValue<Record<string, string>>(promptsValue, {});
  const fallback = prompts.en || Object.values(prompts).find((value) => value.trim().length > 0) || '';
  return prompts[language]?.trim() || fallback;
}

function isGroupedPromptPayload(
  prompts: StoredPromptPayload,
): prompts is {
  primary?: StoredPromptMap;
  secondary?: StoredPromptMap | null;
} {
  return typeof prompts === 'object' && prompts !== null && ('primary' in prompts || 'secondary' in prompts);
}

/**
 * 拆出单 prompt / 双 prompt source 共用的 prompts JSON 结构。
 * 旧页没有 `secondary`；新双 prompt 页在同一列 JSON 里额外携带第二段 prompt，
 * 这里把差异收口到 read model mapper，避免前端再做 landing-type 分支。
 */
function parseStoredPromptGroups(promptsValue: LandingPromptRow['prompts']): {
  primary: StoredPromptMap;
  secondary: StoredPromptMap | null;
} {
  const prompts = parseJsonValue<StoredPromptPayload>(promptsValue, {});
  if (isGroupedPromptPayload(prompts)) {
    return {
      primary: prompts.primary || {},
      secondary: prompts.secondary || null,
    };
  }

  return {
    primary: prompts,
    secondary: null,
  };
}

/**
 * Normalizes an optional database timestamp into a JSON-safe ISO string.
 * node-postgres returns TIMESTAMPTZ as Date by default, while tests can use strings; both need the same public payload
 * shape so future recommendation code does not depend on driver-specific timestamp objects.
 */
function formatOptionalTimestamp(value: LandingPromptRow['notion_created_at']): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * Returns one optional public URL out of the stored media variants map.
 * Image prompts now only store a thumbnail variant for cards; full-size viewing uses the mirrored original URL.
 */
function getVariantUrl(variantsValue: LandingPromptAssetRow['variants'], key: string): string | null {
  const variants = parseJsonValue<Record<string, { url?: string | null }>>(variantsValue, {});
  return variants[key]?.url || null;
}

/**
 * 解析视频应当优先使用的播放地址。
 * 如果同步已经拿到 Cloudflare Stream 的 ready HLS，就优先返回 HLS；
 * 否则继续使用原始 mp4 CDN 地址，保证 provider 切换失败时页面仍可播放。
 */
function resolveVideoPlayback(
  originalCdnUrl: string | null,
  variantsValue: LandingPromptAssetRow['variants'],
): {
  url: string;
  playbackKind: 'mp4' | 'hls';
} | null {
  const variants = parseJsonValue<Record<string, { url?: string | null; status?: string | null }>>(variantsValue, {});
  const streamUrl = variants.stream?.url || null;
  const streamStatus = variants.stream?.status || null;

  if (streamUrl && streamStatus === 'ready') {
    return {
      url: streamUrl,
      playbackKind: 'hls',
    };
  }

  if (!originalCdnUrl) {
    return null;
  }

  return {
    url: originalCdnUrl,
    playbackKind: 'mp4',
  };
}

/**
 * Converts ordered prompt_media rows into the public mixed-media model.
 * Failed/stale assets are excluded by the SQL query, so this mapper only needs to preserve the Notion file order and
 * expose the mirrored original as the full-size image while the thumbnail variant powers card rendering.
 */
function mapPromptMediaRows(assetRows: LandingPromptAssetRow[]): PromptGalleryMedia[] {
  const mappedMedia = assetRows
    .filter((asset) => asset.kind === 'prompt_media' && asset.original_cdn_url && (asset.media_type === 'image' || asset.media_type === 'video'))
    .sort((left, right) => left.position - right.position)
    .map<PromptGalleryMedia | null>((asset) => {
      if (asset.media_type === 'video') {
        const playback = resolveVideoPlayback(asset.original_cdn_url, asset.variants);
        if (!playback) {
          return null;
        }

        return {
          id: asset.id,
          type: 'video',
          url: playback.url,
          playbackKind: playback.playbackKind,
          posterUrl: getVariantUrl(asset.variants, 'poster'),
          cardUrl: null,
          detailUrl: null,
          width: asset.width,
          height: asset.height,
          durationMs: asset.duration_ms,
        } satisfies PromptGalleryMedia;
      }

      return {
        id: asset.id,
        type: 'image',
        url: asset.original_cdn_url || '',
        playbackKind: 'mp4',
        posterUrl: null,
        cardUrl: getVariantUrl(asset.variants, 'card'),
        detailUrl: asset.original_cdn_url || '',
        width: asset.width,
        height: asset.height,
        durationMs: asset.duration_ms,
      } satisfies PromptGalleryMedia;
    })
    .filter((asset): asset is PromptGalleryMedia => Boolean(asset));

  return mappedMedia;
}

/**
 * Resolves the mirrored author avatar URL from author_avatar rows.
 * Avatars now only store the mirrored original image, so the gallery reads that URL directly.
 */
function getAuthorAvatarUrl(assetRows: LandingPromptAssetRow[]): string | null {
  const avatar = assetRows.find((asset) => asset.kind === 'author_avatar' && asset.original_cdn_url);
  if (!avatar) {
    return null;
  }

  return avatar.original_cdn_url;
}

/**
 * Converts DB prompt rows plus their mirrored assets into the existing PromptGalleryPage shape.
 * The extra row (`pageSize + 1`) is only used to compute hasMore; it is not exposed, which keeps offset cursors stable.
 */
export function mapLandingPromptRowsToGalleryPage({
  promptRows,
  assetRows,
  language,
  pageSize,
  offset,
  availableTags,
}: {
  promptRows: LandingPromptRow[];
  assetRows: LandingPromptAssetRow[];
  language: LandingLanguage;
  pageSize: number;
  offset: number;
  availableTags: string[];
}): PromptGalleryPage {
  const normalizedPageSize = Math.min(Math.max(Math.trunc(pageSize), 1), 100);
  const visiblePromptRows = promptRows.slice(0, normalizedPageSize);
  const assetsByPromptId = new Map<string, LandingPromptAssetRow[]>();

  for (const asset of assetRows) {
    const existing = assetsByPromptId.get(asset.prompt_id) || [];
    existing.push(asset);
    assetsByPromptId.set(asset.prompt_id, existing);
  }

  const items: PromptGalleryItem[] = visiblePromptRows
    .map((row, index) => {
      const promptGroups = parseStoredPromptGroups(row.prompts);
      const prompt = getPromptTextForLanguage(promptGroups.primary, language);
      const secondaryPrompt = promptGroups.secondary ? getPromptTextForLanguage(promptGroups.secondary, language) : null;
      const promptAssets = assetsByPromptId.get(row.id) || [];
      const media = mapPromptMediaRows(promptAssets);
      const imageUrls = media
        .filter((asset) => asset.type === 'image')
        .map((asset) => asset.detailUrl || asset.cardUrl || asset.url)
        .filter(Boolean);

      return {
        id: row.id,
        title: row.title,
        prompt,
        secondaryPrompt,
        notionCreatedAt: formatOptionalTimestamp(row.notion_created_at),
        media,
        imageUrl: imageUrls[0] || null,
        imageUrls,
        authorName: row.author_name,
        authorUrl: row.author_url,
        authorAvatarUrl: getAuthorAvatarUrl(promptAssets),
        sourceUrl: row.source_url,
        tags: parseJsonValue<string[]>(row.tags, []),
        likeCount: Math.max(0, Math.trunc(row.like_count || 0)),
        accentIndex: offset + index,
      };
    })
    .filter((item) => item.prompt.trim().length > 0);

  const nextOffset = offset + normalizedPageSize;
  return {
    items,
    hasMore: promptRows.length > normalizedPageSize,
    nextCursor: promptRows.length > normalizedPageSize ? encodeLandingPromptCursor(nextOffset) : null,
    availableTags,
  };
}

/**
 * Builds the SQL WHERE clause shared by page and tag queries.
 * The prompt JSONB text search is intentionally broad: this landing page has a small editorial dataset, and broad
 * language coverage is more useful than maintaining one SQL expression per locale.
 * `lasted` 是页面专用排序项，不应该进入真实 tag 过滤；否则 SQL 会去匹配一个不存在的 Notion tag 并返回空列表。
 */
function buildPromptWhereClause(source: LandingPromptSourceConfig, filter: LandingPromptQueryFilter) {
  const values: unknown[] = [source.landingType, LandingPromptStatus.Active];
  const where = ['landing_type = $1', 'status = $2'];
  const id = filter.id?.trim();
  const tag = filter.tag?.trim();
  const query = filter.query?.trim();

  if (id) {
    values.push(id);
    where.push(`id = $${values.length}`);
  }

  if (!id && tag && !isPromptGalleryLatestTag(tag)) {
    values.push(tag);
    where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS prompt_tag(tag) WHERE prompt_tag.tag = $${values.length})`);
  }

  if (!id && query) {
    values.push(`%${query}%`);
    where.push(`(title ILIKE $${values.length} OR prompts::text ILIKE $${values.length})`);
  }

  return {
    whereSql: where.join(' AND '),
    values,
  };
}

/**
 * Returns the SQL ORDER BY clause for one landing prompt page query.
 * 这个 helper 被 getLandingPromptPageFromDb 和纯测试共同使用；
 * 默认列表继续按 `like_count,updated_at` 降序，维持当前线上“热门优先”的排序心智；
 * 只有 tag 传入页面专用的 `lasted` 特殊项时，才切到按 Notion 创建时间倒序，把最新内容顶到最前面。
 */
export function buildLandingPromptOrderBySql(filter: LandingPromptQueryFilter): string {
  if (filter.id?.trim()) {
    return 'id ASC';
  }

  if (isPromptGalleryLatestTag(filter.tag)) {
    return 'notion_created_at DESC NULLS LAST, updated_at DESC, id ASC';
  }

  return 'like_count DESC, updated_at DESC, id ASC';
}

/**
 * Builds the DISTINCT tag query used by the first gallery page.
 * 这个查询只在首屏请求里执行，用来渲染可筛选 tag；因此它必须和 landing_prompt.status 的真实枚举保持同一套参数化约束，
 * 不能再写死字符串状态，否则表结构迁移后首页会在 tags 查询阶段直接报错。
 */
export function buildLandingPromptAvailableTagsQuery(source: LandingPromptSourceConfig): {
  sql: string;
  values: [string, LandingPromptStatus];
} {
  return {
    sql: `
      SELECT DISTINCT prompt_tag.tag
      FROM landing_prompt
      CROSS JOIN LATERAL jsonb_array_elements_text(tags) AS prompt_tag(tag)
      WHERE landing_type = $1
        AND status = $2
      ORDER BY prompt_tag.tag ASC
    `,
    values: [source.landingType, LandingPromptStatus.Active],
  };
}

/**
 * Reads one page of active landing prompts from Postgres.
 * This is the public landing-pages source of truth; an empty table returns an empty page so operators can see sync
 * failures directly instead of silently serving stale Notion or editorial fallback content.
 * 首屏除了 prompt 列表，还会顺手读取可筛选 tags；两条查询必须共享同一个 active 状态定义，
 * 这样 public gallery 才不会在状态字段迁移后出现“列表可读、tags 查询单独失败”的半损坏状态。
 */
export async function getLandingPromptPageFromDb({
  source,
  cursor,
  pageSize,
  language,
  tag,
  query,
  id,
}: {
  source: LandingPromptSourceConfig;
  cursor?: string | null;
  pageSize: number;
  language: LandingLanguage;
  tag?: string | null;
  query?: string | null;
  id?: string | null;
}): Promise<PromptGalleryPage> {
  const normalizedPageSize = Math.min(Math.max(Math.trunc(pageSize), 1), 100);
  const filter = { tag, query, id };
  const offset = filter.id?.trim() ? 0 : decodeLandingPromptCursor(cursor);
  const { whereSql, values } = buildPromptWhereClause(source, filter);
  const availableTagsQuery = buildLandingPromptAvailableTagsQuery(source);
  const orderBySql = buildLandingPromptOrderBySql(filter);
  const promptRows = await queryLandingPromptDb<LandingPromptRow>(
    `
      SELECT
        id,
        notion_created_at,
        title,
        prompts,
        author_name,
        author_url,
        source_url,
        tags,
        like_count,
        sort_order
      FROM landing_prompt
      WHERE ${whereSql}
      ORDER BY ${orderBySql}
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `,
    [...values, normalizedPageSize + 1, offset]
  );
  const visiblePromptIds = promptRows.slice(0, normalizedPageSize).map((row) => row.id);
  const [assetRows, tagRows] = await Promise.all([
    visiblePromptIds.length > 0
      ? queryLandingPromptDb<LandingPromptAssetRow>(
          `
            SELECT
              id,
              prompt_id,
              kind,
              media_type,
              position,
              original_cdn_url,
              variants,
              width,
              height,
              duration_ms
            FROM landing_prompt_asset
            WHERE landing_type = $1
              AND prompt_id = ANY($2)
              AND status = 'active'
            ORDER BY prompt_id ASC, kind ASC, position ASC
          `,
          [source.landingType, visiblePromptIds]
        )
      : Promise.resolve([]),
    offset === 0
      ? queryLandingPromptDb<LandingPromptTagRow>(
          availableTagsQuery.sql,
          availableTagsQuery.values
        )
      : Promise.resolve([]),
  ]);

  return mapLandingPromptRowsToGalleryPage({
    promptRows,
    assetRows,
    language,
    pageSize: normalizedPageSize,
    offset,
    availableTags: sortPromptTagsByPriority(tagRows.map((row) => row.tag)),
  });
}
