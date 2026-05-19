/**
 * asset-reuse.ts rebuilds mirrored asset metadata from existing landing prompt DB rows.
 * It is used by asset-writes.ts during scheduled syncs so unchanged media and shared author avatars reuse CDN objects
 * instead of being downloaded and uploaded on every Notion refresh.
 */
import { getLandingPromptCdnBaseUrl, type MirroredLandingAsset } from './assets';
import type { LandingPromptSyncDbClient } from './sync';
import { LandingPromptAssetKind, LandingPromptAssetMediaType, LandingPromptAssetStatus } from './types';

type LandingPromptAssetRowForReuse = {
  kind: LandingPromptAssetKind | string;
  media_type: MirroredLandingAsset['mediaType'] | string | null;
  position: number;
  source_url: string;
  source_hash: string | null;
  original_s3_key: string | null;
  original_cdn_url: string | null;
  variants: MirroredLandingAsset['variants'] | string | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | string | null;
};

/**
 * Parses asset variants from either pg JSONB objects or string fixtures.
 * Reuse queries can source rows from a different prompt, so they must rebuild the same MirroredLandingAsset shape that
 * fresh S3 uploads return without depending on node-postgres' exact JSONB decoding in tests.
 */
function parseAssetVariants(variants: LandingPromptAssetRowForReuse['variants']): MirroredLandingAsset['variants'] {
  if (!variants) {
    return {};
  }
  if (typeof variants !== 'string') {
    return variants;
  }

  try {
    return JSON.parse(variants) as MirroredLandingAsset['variants'];
  } catch {
    return {};
  }
}

/**
 * Scores one prompt-media candidate for cross-prompt reuse.
 * A healthy Stream UID is the highest-value row because reusing it avoids a second Cloudflare copy bill; plain CDN-only
 * rows are still useful when no Stream-backed candidate exists yet.
 */
function getPromptMediaReusePriority(row: LandingPromptAssetRowForReuse): number {
  const variants = parseAssetVariants(row.variants);
  const streamUid = variants.stream?.uid?.trim();
  const streamStatus = variants.stream?.status?.trim();

  if (streamUid && streamStatus !== 'error') {
    return 3;
  }
  if (streamUid) {
    return 2;
  }
  if (row.original_cdn_url) {
    return 1;
  }

  return 0;
}

/**
 * Checks whether a mirrored asset row still matches the current public CDN base.
 * Reusing a row from a previous test CDN rollout would keep stale public URLs in the prod read model even when the
 * S3 key itself is still valid, so CDN drift disables reuse and forces a fresh mirror.
 */
function assetMatchesCurrentCdnBase(mirrored: MirroredLandingAsset, currentCdnBaseUrl: string): boolean {
  if (!currentCdnBaseUrl) {
    return true;
  }
  if (!mirrored.originalCdnUrl.startsWith(`${currentCdnBaseUrl}/`)) {
    return false;
  }

  return Object.values(mirrored.variants).every((variant) => {
    if (!variant.s3Key) {
      return true;
    }

    return variant.url.startsWith(`${currentCdnBaseUrl}/`);
  });
}

/**
 * Converts an active DB asset row into the mirrored asset shape used by the upsert helper.
 * Rows without CDN keys are intentionally not reusable: reusing a partial failed row would copy broken media into the
 * current prompt instead of forcing a fresh mirror attempt.
 */
export function rowToReusableMirroredAsset(
  row: LandingPromptAssetRowForReuse,
  currentCdnBaseUrl = getLandingPromptCdnBaseUrl(),
): MirroredLandingAsset | null {
  if (!row.source_hash || !row.original_s3_key || !row.original_cdn_url) {
    return null;
  }
  if (row.media_type !== LandingPromptAssetMediaType.Image && row.media_type !== LandingPromptAssetMediaType.Video) {
    return null;
  }

  const byteSize = typeof row.byte_size === 'string' ? Number.parseInt(row.byte_size, 10) : row.byte_size;
  const mirrored: MirroredLandingAsset = {
    mediaType: row.media_type,
    contentType: row.content_type,
    byteSize: Number.isFinite(byteSize) ? Number(byteSize) : 0,
    hash: row.source_hash,
    width: row.width,
    height: row.height,
    originalS3Key: row.original_s3_key,
    originalCdnUrl: row.original_cdn_url,
    variants: parseAssetVariants(row.variants),
  };

  return assetMatchesCurrentCdnBase(mirrored, currentCdnBaseUrl) ? mirrored : null;
}

/**
 * Reads currently active assets for one prompt before mirroring.
 * The sync job runs hourly; checking the active read model first prevents re-downloading unchanged Notion media and lets
 * a simple reorder reuse the existing CDN object while writing a new ordered row.
 */
export async function getActiveAssetsForPrompt({
  client,
  landingType,
  promptId,
}: {
  client: LandingPromptSyncDbClient;
  landingType: string;
  promptId: string;
}): Promise<LandingPromptAssetRowForReuse[]> {
  const result = await client.query<LandingPromptAssetRowForReuse>(
    `
      SELECT
        kind,
        media_type,
        position,
        source_url,
        source_hash,
        original_s3_key,
        original_cdn_url,
        variants,
        content_type,
        width,
        height,
        byte_size
      FROM landing_prompt_asset
      WHERE landing_type = $1
        AND prompt_id = $2
        AND status = $3
        AND kind = ANY($4::text[])
    `,
    [
      landingType,
      promptId,
      LandingPromptAssetStatus.Active,
      [LandingPromptAssetKind.PromptMedia, LandingPromptAssetKind.AuthorAvatar],
    ],
  );

  return result.rows;
}

/**
 * Finds an already mirrored avatar by source URL across prompts in the same landing type.
 * Author avatars are content-addressed under `authors/{hash}` and multiple cards can share one author, so copying the
 * CDN metadata into the current prompt avoids repeated downloads/uploads for identical profile image URLs.
 */
export async function findReusableAuthorAvatarAsset({
  client,
  landingType,
  sourceUrl,
}: {
  client: LandingPromptSyncDbClient;
  landingType: string;
  sourceUrl: string;
}): Promise<MirroredLandingAsset | null> {
  const result = await client.query<LandingPromptAssetRowForReuse>(
    `
      SELECT
        kind,
        media_type,
        position,
        source_url,
        source_hash,
        original_s3_key,
        original_cdn_url,
        variants,
        content_type,
        width,
        height,
        byte_size
      FROM landing_prompt_asset
      WHERE landing_type = $1
        AND kind = $2
        AND source_url = $3
        AND status = $4
        AND original_cdn_url IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [landingType, LandingPromptAssetKind.AuthorAvatar, sourceUrl, LandingPromptAssetStatus.Active],
  );

  return result.rows[0] ? rowToReusableMirroredAsset(result.rows[0]) : null;
}

/**
 * Finds reusable prompt media rows by source URL across all active landing sources.
 * Editorial teams can intentionally surface the same tweet/video in multiple landing pages, so global lookup keeps
 * those rows on one mirrored CDN object and one Cloudflare Stream UID instead of re-uploading the same source per page.
 */
export async function findReusablePromptMediaAssetsBySourceUrls({
  client,
  sourceUrls,
}: {
  client: LandingPromptSyncDbClient;
  sourceUrls: string[];
}): Promise<Map<string, MirroredLandingAsset>> {
  const normalizedSourceUrls = [...new Set(sourceUrls.map((sourceUrl) => sourceUrl.trim()).filter(Boolean))];
  if (normalizedSourceUrls.length === 0) {
    return new Map();
  }

  const result = await client.query<LandingPromptAssetRowForReuse>(
    `
      SELECT
        kind,
        media_type,
        position,
        source_url,
        source_hash,
        original_s3_key,
        original_cdn_url,
        variants,
        content_type,
        width,
        height,
        byte_size
      FROM landing_prompt_asset
      WHERE kind = $1
        AND source_url = ANY($2::text[])
        AND status = $3
        AND original_cdn_url IS NOT NULL
      ORDER BY source_url ASC, updated_at DESC
    `,
    [LandingPromptAssetKind.PromptMedia, normalizedSourceUrls, LandingPromptAssetStatus.Active],
  );

  const reusableAssets = new Map<string, { mirrored: MirroredLandingAsset; priority: number }>();
  for (const row of result.rows) {
    const mirrored = rowToReusableMirroredAsset(row);
    if (mirrored) {
      const priority = getPromptMediaReusePriority(row);
      const current = reusableAssets.get(row.source_url);
      if (!current || priority > current.priority) {
        reusableAssets.set(row.source_url, { mirrored, priority });
      }
    }
  }

  return new Map(
    [...reusableAssets.entries()].map(([sourceUrl, entry]) => [sourceUrl, entry.mirrored]),
  );
}
