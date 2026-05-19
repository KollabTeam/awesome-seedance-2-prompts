/**
 * notion.ts converts Notion prompt database pages into landing-pages read-model inputs.
 * It is server-only landing-pages code used by the internal sync route; public page requests should read Postgres rows
 * instead of calling Notion so editorial/API latency cannot slow normal visitors.
 */
import {
  LANDING_PROMPT_LANGUAGES,
  type LandingPromptLanguage,
  type LandingPromptLocalizedPropertyMap,
  type LandingPromptPropertyMap,
  type LandingPromptSourceConfig,
  type ParsedLandingPromptPage,
} from './types';

type RichTextLike = {
  plain_text?: string;
  text?: {
    content?: string;
  };
};

type FileLike = {
  type?: string;
  external?: {
    url?: string;
  };
  file?: {
    url?: string;
  };
};

type MultiSelectOptionLike = {
  name?: string;
};

type PropertyLike = {
  type?: string;
  title?: RichTextLike[];
  rich_text?: RichTextLike[];
  url?: string | null;
  files?: FileLike[];
  multi_select?: MultiSelectOptionLike[];
  number?: number | null;
  formula?: {
    type?: string;
    number?: number | null;
  };
};

export type NotionPromptPageLike = {
  id?: string;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, PropertyLike>;
};

type NotionQueryResponse = {
  results?: NotionPromptPageLike[];
  has_more?: boolean;
  next_cursor?: string | null;
};

export type LandingPromptNotionPageResult = {
  pages: NotionPromptPageLike[];
  hasMore: boolean;
  nextCursor: string | null;
};

const LIKE_PROPERTY_CANDIDATES = ['Like', 'Likes', 'like', 'likes'];
const DEFAULT_NOTION_QUERY_RETRY_ATTEMPTS = 3;
const DEFAULT_NOTION_QUERY_RETRY_DELAY_MS = 250;

/**
 * Decides whether a Notion database query failure is transient enough to retry.
 * The cronjob should keep one short backoff loop for 5xx and network/timeout failures because these usually clear on
 * their own, while 4xx configuration errors must surface immediately so operators notice broken credentials or schema.
 */
function shouldRetryNotionQuery(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    /^landing_prompts_notion_query_failed:(502|503|504)$/.test(error.message) ||
    error.name === 'AbortError' ||
    error.message === 'fetch failed'
  );
}

/**
 * Waits before the next Notion retry attempt.
 * The delay is configurable for tests so retry behavior can be verified without sleeping in CI.
 */
async function waitBeforeRetry(attempt: number, env: Record<string, string | undefined> = process.env): Promise<void> {
  const configuredDelayMs = Number.parseInt(env.LANDING_PROMPTS_NOTION_RETRY_DELAY_MS || '', 10);
  const baseDelayMs =
    Number.isFinite(configuredDelayMs) && configuredDelayMs >= 0
      ? configuredDelayMs
      : DEFAULT_NOTION_QUERY_RETRY_DELAY_MS;
  const delayMs = baseDelayMs * Math.max(1, attempt);
  if (delayMs === 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * 将 source 上的 prompt 配置归一成主/次两组字段映射。
 * 旧 landing source 仍然只声明一组 prompt 列；
 * 新的 GPT Image 2 + Seedance 2 数据源会在同一个 JSON 字段里声明 `primary/secondary` 两组映射，
 * 这样无需为了双 prompt 页面再引入第二列 source 真相。
 */
function resolvePromptPropertyMaps(
  promptPropertyMap: LandingPromptPropertyMap,
): {
  primary: LandingPromptLocalizedPropertyMap;
  secondary: LandingPromptLocalizedPropertyMap | null;
} {
  if ('primary' in promptPropertyMap && 'secondary' in promptPropertyMap) {
    return {
      primary: promptPropertyMap.primary,
      secondary: promptPropertyMap.secondary,
    };
  }

  return {
    primary: promptPropertyMap,
    secondary: null,
  };
}

/**
 * Combines Notion rich text fragments into one plain string.
 * Notion splits styled text into multiple fragments, so prompt/title parsing must join all fragments rather than taking
 * only the first segment and silently dropping the rest of the user-authored prompt.
 */
function richTextToPlainText(items: RichTextLike[] | undefined): string {
  if (!Array.isArray(items)) {
    return '';
  }

  return items
    .map((item) => item.plain_text || item.text?.content || '')
    .join('')
    .trim();
}

/**
 * Reads a Notion title or rich_text property as plain text.
 * This helper is shared by title, localized prompt, and author-name fields so future sources can rename columns without
 * changing the low-level Notion property handling rules.
 */
function readTextProperty(properties: Record<string, PropertyLike>, name: string): string {
  const property = properties[name];
  if (!property) {
    return '';
  }

  if (property.type === 'title') {
    return richTextToPlainText(property.title);
  }

  if (property.type === 'rich_text') {
    return richTextToPlainText(property.rich_text);
  }

  return '';
}

/**
 * Reads a Notion URL property.
 * Null is returned for absent/empty URLs so DB writes can distinguish "not configured" from an empty string.
 */
function readUrlProperty(properties: Record<string, PropertyLike>, name: string): string | null {
  const property = properties[name];
  return property?.type === 'url' && property.url ? property.url : null;
}

/**
 * Reads a Notion number value for recommendation signals.
 * Notion number properties expose `number` directly; formula-backed counters expose `formula.type = number` plus
 * `formula.number`, so both shapes are supported while negative/NaN values are clamped to zero.
 */
function readNumberProperty(properties: Record<string, PropertyLike>, names: string[]): number {
  for (const name of names) {
    const property = properties[name];
    const value =
      property?.type === 'number'
        ? property.number
        : property?.type === 'formula' && property.formula?.type === 'number'
          ? property.formula.number
          : null;

    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
  }

  return 0;
}

/**
 * Parses a Notion page timestamp into a nullable Date.
 * Notion exposes created/last-edited timestamps on the page object rather than inside properties; keeping this helper
 * shared makes invalid or missing timestamps consistently land as null instead of poisoning DB writes with Invalid Date.
 */
function parseNotionTimestamp(value: string | undefined): Date | null {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Reads all URLs from a Notion files property while preserving Notion order.
 * Prompt cards can contain multiple images/videos, so order is part of the content contract and becomes asset.position.
 */
function readFileUrls(properties: Record<string, PropertyLike>, name: string): string[] {
  const property = properties[name];
  const files = property?.type === 'files' && Array.isArray(property.files) ? property.files : [];
  return files
    .map((file) => (file.type === 'external' ? file.external?.url : file.file?.url))
    .filter((url): url is string => Boolean(url));
}

/**
 * Collects prompt media URLs from both the legacy mixed-media column and the dedicated video column.
 * Early landing rows stored videos inside `Images`, while newer Seedance rows write mp4 files into `Videos`.
 * Merging both shapes here keeps the sync pipeline backward compatible without forcing editors to migrate old pages.
 */
function readPromptMediaUrls(
  properties: Record<string, PropertyLike>,
  source: LandingPromptSourceConfig,
): string[] {
  const orderedUrls = [
    ...readFileUrls(properties, source.imagePropertyName),
    ...readFileUrls(properties, 'Videos'),
  ];

  return Array.from(new Set(orderedUrls));
}

/**
 * Detects whether one synced media URL should be treated as a video before download time.
 * Poster assignment needs to happen while we are still mapping Notion properties, so this lightweight extension check
 * keeps the parser deterministic without fetching remote headers.
 */
function isLikelyVideoSourceUrl(sourceUrl: string): boolean {
  try {
    const pathname = new URL(sourceUrl).pathname.toLowerCase();
    return /\.(mp4|webm|mov|m4v)$/i.test(pathname);
  } catch {
    return /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(sourceUrl);
  }
}

/**
 * Reads tag names from the configured multi-select property.
 * Duplicates are removed at parse time so filtering and display do not repeatedly show the same Notion option.
 */
function readTags(properties: Record<string, PropertyLike>, propertyName: string): string[] {
  const property = properties[propertyName];
  const tags = property?.type === 'multi_select' && Array.isArray(property.multi_select) ? property.multi_select : [];
  return Array.from(new Set(tags.map((tag) => tag.name?.trim() || '').filter(Boolean)));
}

/**
 * Resolves one localized prompt value with configured fallback fields.
 * Each landing source can map languages to different Notion columns; empty localized values fall back to English and
 * then any source-specific original prompt fields so every route can still render usable content.
 */
function readPromptForLanguage(
  properties: Record<string, PropertyLike>,
  promptPropertyMap: LandingPromptLocalizedPropertyMap,
  language: LandingPromptLanguage,
): string {
  const candidates = [
    promptPropertyMap[language],
    language !== 'en' ? promptPropertyMap.en : undefined,
    ...(promptPropertyMap.fallback || []),
  ].filter((propertyName): propertyName is string => Boolean(propertyName));

  for (const propertyName of Array.from(new Set(candidates))) {
    const value = readTextProperty(properties, propertyName);
    if (value) {
      return value;
    }
  }

  return '';
}

/**
 * Converts one Notion page into the normalized landing prompt input used by sync.
 * It does not write to Postgres or download media; those side effects stay in sync/assets modules so parser tests remain
 * pure and future landing types can reuse the same Notion mapping contract.
 */
export function parseLandingPromptNotionPage(
  page: unknown,
  source: LandingPromptSourceConfig,
  sortOrder: number,
): ParsedLandingPromptPage {
  const notionPage = page as NotionPromptPageLike;
  const properties = notionPage.properties || {};
  const title = readTextProperty(properties, 'Name') || `${source.name} prompt ${sortOrder + 1}`;
  const promptPropertyMaps = resolvePromptPropertyMaps(source.promptPropertyMap);
  const prompts = Object.fromEntries(
    LANDING_PROMPT_LANGUAGES.map((language) => [language, readPromptForLanguage(properties, promptPropertyMaps.primary, language)]),
  ) as Record<LandingPromptLanguage, string>;
  const secondaryPrompts = promptPropertyMaps.secondary
    ? (Object.fromEntries(
        LANDING_PROMPT_LANGUAGES.map((language) => [language, readPromptForLanguage(properties, promptPropertyMaps.secondary!, language)]),
      ) as Record<LandingPromptLanguage, string>)
    : null;
  const posterUrls = readFileUrls(properties, 'Video Posters');
  let videoIndex = 0;

  return {
    landingType: source.landingType,
    notionPageId: notionPage.id || `${source.landingType}-${sortOrder}`,
    notionCreatedAt: parseNotionTimestamp(notionPage.created_time),
    notionLastEditedAt: parseNotionTimestamp(notionPage.last_edited_time),
    title,
    prompts,
    secondaryPrompts:
      secondaryPrompts && Object.values(secondaryPrompts).some((prompt) => prompt.trim().length > 0) ? secondaryPrompts : null,
    authorName: readTextProperty(properties, 'Author Name') || 'Unknown creator',
    authorUrl: readUrlProperty(properties, 'Author URL'),
    authorAvatarSourceUrl: readFileUrls(properties, source.authorAvatarPropertyName)[0] || null,
    sourceUrl: readUrlProperty(properties, 'Tweet URL'),
    tags: readTags(properties, source.tagPropertyName),
    likeCount: readNumberProperty(properties, LIKE_PROPERTY_CANDIDATES),
    media: readPromptMediaUrls(properties, source).map((sourceUrl, position) => {
      const posterSourceUrl = isLikelyVideoSourceUrl(sourceUrl) ? posterUrls[videoIndex++] || null : null;
      return { sourceUrl, position, posterSourceUrl };
    }),
    sortOrder,
  };
}

/**
 * Fetches one Notion database page for the configured landing source.
 * The sync layer paginates through this function so API credentials and Notion versioning remain isolated to one module.
 */
export async function fetchLandingPromptNotionPage({
  source,
  cursor,
  pageSize = 100,
}: {
  source: LandingPromptSourceConfig;
  cursor?: string | null;
  pageSize?: number;
}): Promise<LandingPromptNotionPageResult> {
  const token = process.env.LANDING_PAGES_NOTION_API_KEY || process.env.NOTION_API_KEY || '';
  if (!token) {
    throw new Error('landing_prompts_notion_token_missing');
  }
  const configuredAttempts = Number.parseInt(process.env.LANDING_PROMPTS_NOTION_RETRY_ATTEMPTS || '', 10);
  const maxAttempts =
    Number.isFinite(configuredAttempts) && configuredAttempts > 0
      ? configuredAttempts
      : DEFAULT_NOTION_QUERY_RETRY_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`https://api.notion.com/v1/databases/${source.notionDatabaseId}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': source.notionVersion,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page_size: Math.min(Math.max(Math.trunc(pageSize), 1), 100),
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`landing_prompts_notion_query_failed:${response.status}`);
      }

      const payload = (await response.json()) as NotionQueryResponse;
      return {
        pages: payload.results || [],
        hasMore: Boolean(payload.has_more && payload.next_cursor),
        nextCursor: payload.next_cursor || null,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryNotionQuery(error)) {
        throw error;
      }
      await waitBeforeRetry(attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('landing_prompts_notion_query_failed:unknown');
}
