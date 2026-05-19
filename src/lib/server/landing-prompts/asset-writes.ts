/**
 * asset-writes.ts owns landing prompt asset reuse and DB write helpers.
 * It sits below sync.ts in the landing-pages server sync chain; sync orchestration calls this module after each prompt
 * row is upserted so media/avatar mirroring policy stays isolated from Notion pagination and run-state bookkeeping.
 */
import { getLandingPromptCdnBaseUrl, type MirroredLandingAsset } from './assets';
import {
  findReusableAuthorAvatarAsset,
  findReusablePromptMediaAssetsBySourceUrls,
  getActiveAssetsForPrompt,
  rowToReusableMirroredAsset,
} from './asset-reuse';
import { ensureCloudflareStreamVariant } from './cloudflare-stream';
import type { LandingPromptSyncDbClient } from './sync';
import { formatSyncError } from './sync-writes';
import {
  LandingPromptAssetKind,
  LandingPromptAssetMediaType,
  LandingPromptAssetStatus,
  type LandingPromptSourceConfig,
  type ParsedLandingPromptPage,
} from './types';

export type MirrorLandingPromptAsset = (input: {
  sourceUrl: string;
  s3Prefix: string;
  notionPageId: string;
  position: number;
  avatar?: boolean;
}) => Promise<MirroredLandingAsset>;

/**
 * Builds the identity key used to decide whether one prompt media row already matches the current Notion state.
 * Poster source participates in the key so a stable mp4 with a replaced thumbnail still refreshes the DB row and CDN
 * variant instead of being skipped as "unchanged media".
 */
function buildPromptMediaSyncKey(media: { position: number; sourceUrl: string; posterSourceUrl?: string | null }): string {
  return `${media.position}:${media.sourceUrl}:${media.posterSourceUrl || ''}`;
}

/**
 * Attaches one mirrored poster image to an existing mirrored video asset.
 * Posters travel as a variant on the video row because the public gallery expects `posterUrl` next to the video CDN URL,
 * not as a second standalone prompt_media asset.
 */
function withPosterVariant(
  mirrored: MirroredLandingAsset,
  poster: MirroredLandingAsset | null,
  posterSourceUrl: string | null | undefined,
): MirroredLandingAsset {
  const nextVariants = { ...mirrored.variants };

  if (!poster || !posterSourceUrl) {
    delete nextVariants.poster;
    return {
      ...mirrored,
      variants: nextVariants,
    };
  }

  nextVariants.poster = {
    url: poster.originalCdnUrl,
    s3Key: poster.originalS3Key,
    width: poster.width ?? undefined,
    height: poster.height ?? undefined,
    sourceUrl: posterSourceUrl,
  };

  return {
    ...mirrored,
    variants: nextVariants,
  };
}

/**
 * 把视频资产的 Cloudflare Stream 状态折叠进 variants.stream。
 * Stream copy/refresh 失败时仍保留已镜像的 mp4 CDN 回退，
 * 是为了让单次 Cloudflare 波动不会让整个 prompt 卡片丢失可播放视频。
 */
async function withCloudflareStreamVariant(mirrored: MirroredLandingAsset, title: string): Promise<MirroredLandingAsset> {
  if (mirrored.mediaType !== LandingPromptAssetMediaType.Video) {
    return mirrored;
  }

  try {
    const streamVariant = await ensureCloudflareStreamVariant({
      sourceUrl: mirrored.originalCdnUrl,
      title,
      existingVariant: mirrored.variants.stream,
    });
    if (!streamVariant) {
      return mirrored;
    }
    if (JSON.stringify(streamVariant) === JSON.stringify(mirrored.variants.stream || null)) {
      return mirrored;
    }

    return {
      ...mirrored,
      variants: {
        ...mirrored.variants,
        stream: streamVariant,
      },
    };
  } catch (error) {
    const failedVariant = {
      ...(mirrored.variants.stream || { url: '', sourceUrl: mirrored.originalCdnUrl }),
      provider: 'cloudflare-stream',
      status: 'error',
      error: formatSyncError(error),
      sourceUrl: mirrored.originalCdnUrl,
    };
    if (JSON.stringify(failedVariant) === JSON.stringify(mirrored.variants.stream || null)) {
      return mirrored;
    }

    return {
      ...mirrored,
      variants: {
        ...mirrored.variants,
        stream: failedVariant,
      },
    };
  }
}

/**
 * Writes one successful mirrored asset row.
 * Source URL and position remain part of the unique key so a changed Notion file order produces a new ordered asset row.
 */
async function upsertSuccessfulAsset({
  client,
  idFactory,
  landingType,
  promptId,
  kind,
  sourceUrl,
  position,
  mirrored,
}: {
  client: LandingPromptSyncDbClient;
  idFactory: () => string;
  landingType: string;
  promptId: string;
  kind: LandingPromptAssetKind;
  sourceUrl: string;
  position: number;
  mirrored: MirroredLandingAsset;
}): Promise<void> {
  await client.query(
    `
      INSERT INTO landing_prompt_asset (
        id,
        landing_type,
        prompt_id,
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
        duration_ms,
        byte_size,
        status,
        error_message,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11::jsonb,
        $12,
        $13,
        $14,
        NULL,
        $15,
        $16,
        NULL,
        NOW()
      )
      ON CONFLICT (landing_type, prompt_id, kind, position, source_url)
      DO UPDATE SET
        media_type = EXCLUDED.media_type,
        source_hash = EXCLUDED.source_hash,
        original_s3_key = EXCLUDED.original_s3_key,
        original_cdn_url = EXCLUDED.original_cdn_url,
        variants = EXCLUDED.variants,
        content_type = EXCLUDED.content_type,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        duration_ms = EXCLUDED.duration_ms,
        byte_size = EXCLUDED.byte_size,
        status = EXCLUDED.status,
        error_message = NULL,
        updated_at = NOW()
    `,
    [
      idFactory(),
      landingType,
      promptId,
      kind,
      mirrored.mediaType,
      position,
      sourceUrl,
      mirrored.hash,
      mirrored.originalS3Key,
      mirrored.originalCdnUrl,
      JSON.stringify(mirrored.variants),
      mirrored.contentType,
      mirrored.width,
      mirrored.height,
      mirrored.byteSize,
      LandingPromptAssetStatus.Active,
    ],
  );
}

/**
 * Records a failed asset mirror attempt without failing the whole prompt row.
 * If the same ordered asset was previously active, keep that CDN row active and only refresh the diagnostic error text;
 * one temporary host/S3/sharp failure should not make already mirrored public media disappear.
 */
async function upsertFailedAsset({
  client,
  idFactory,
  landingType,
  promptId,
  kind,
  sourceUrl,
  position,
  error,
}: {
  client: LandingPromptSyncDbClient;
  idFactory: () => string;
  landingType: string;
  promptId: string;
  kind: LandingPromptAssetKind;
  sourceUrl: string;
  position: number;
  error: unknown;
}): Promise<void> {
  await client.query(
    `
      INSERT INTO landing_prompt_asset (
        id,
        landing_type,
        prompt_id,
        kind,
        media_type,
        position,
        source_url,
        variants,
        status,
        error_message,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        '{}'::jsonb,
        $8,
        $9,
        NOW()
      )
      ON CONFLICT (landing_type, prompt_id, kind, position, source_url)
      DO UPDATE SET
        media_type = CASE
          WHEN landing_prompt_asset.status = $10 THEN landing_prompt_asset.media_type
          ELSE EXCLUDED.media_type
        END,
        status = CASE
          WHEN landing_prompt_asset.status = $10 THEN landing_prompt_asset.status
          ELSE EXCLUDED.status
        END,
        error_message = EXCLUDED.error_message,
        updated_at = NOW()
    `,
    [
      idFactory(),
      landingType,
      promptId,
      kind,
      LandingPromptAssetMediaType.Unknown,
      position,
      sourceUrl,
      LandingPromptAssetStatus.Failed,
      formatSyncError(error),
      LandingPromptAssetStatus.Active,
    ],
  );
}

/**
 * Marks active rows stale when their `(position, source_url)` tuple no longer exists in Notion.
 * Position is part of the public ordering contract and the DB unique key, so comparing only source_url would leave
 * duplicates active after editors reorder the same file.
 */
async function staleMissingAssets({
  client,
  landingType,
  promptId,
  kind,
  currentAssets,
}: {
  client: LandingPromptSyncDbClient;
  landingType: string;
  promptId: string;
  kind: LandingPromptAssetKind;
  currentAssets: Array<{ position: number; sourceUrl: string }>;
}): Promise<void> {
  await client.query(
    `
      UPDATE landing_prompt_asset
      SET status = $1,
          updated_at = NOW()
      WHERE landing_type = $2
        AND prompt_id = $3
        AND kind = $4
        AND status = $5
        AND NOT EXISTS (
          SELECT 1
          FROM unnest($6::int[], $7::text[]) AS current_asset(position, source_url)
          WHERE current_asset.position = landing_prompt_asset.position
            AND current_asset.source_url = landing_prompt_asset.source_url
        )
    `,
    [
      LandingPromptAssetStatus.Stale,
      landingType,
      promptId,
      kind,
      LandingPromptAssetStatus.Active,
      currentAssets.map((asset) => asset.position),
      currentAssets.map((asset) => asset.sourceUrl),
    ],
  );
}

/**
 * Mirrors all current assets for one prompt and writes success/failure rows.
 * Asset failures are counted but do not stop prompt syncing, because a transient avatar/image host issue should not
 * archive otherwise valid prompt text. Existing active CDN assets are reused first so hourly syncs do not repeatedly
 * download unchanged Notion media, and old active rows stay visible when a replacement download fails.
 */
export async function syncPromptAssets({
  source,
  parsed,
  promptId,
  client,
  idFactory,
  mirrorAsset,
}: {
  source: LandingPromptSourceConfig;
  parsed: ParsedLandingPromptPage;
  promptId: string;
  client: LandingPromptSyncDbClient;
  idFactory: () => string;
  mirrorAsset: MirrorLandingPromptAsset;
}): Promise<{ successCount: number; failedCount: number }> {
  const currentCdnBaseUrl = getLandingPromptCdnBaseUrl();
  let successCount = 0;
  let failedCount = 0;
  let mediaFailedCount = 0;
  let avatarFailedCount = 0;
  const activeAssets = await getActiveAssetsForPrompt({ client, landingType: source.landingType, promptId });
  const globallyReusablePromptMedia = await findReusablePromptMediaAssetsBySourceUrls({
    client,
    sourceUrls: parsed.media.map((media) => media.sourceUrl),
  });
  const activeExactKeys = new Set<string>();
  const reusableByKindAndSource = new Map<string, MirroredLandingAsset>();
  const activePromptMediaBySyncKey = new Map<string, MirroredLandingAsset>();
  for (const asset of activeAssets) {
    const mirrored = rowToReusableMirroredAsset(asset, currentCdnBaseUrl);
    if (mirrored) {
      const syncKey = buildPromptMediaSyncKey({
        position: asset.position,
        sourceUrl: asset.source_url,
        posterSourceUrl: mirrored.variants.poster?.sourceUrl || null,
      });
      activeExactKeys.add(`${asset.kind}:${syncKey}`);
      reusableByKindAndSource.set(`${asset.kind}:${asset.source_url}`, mirrored);
      if (asset.kind === LandingPromptAssetKind.PromptMedia) {
        activePromptMediaBySyncKey.set(syncKey, mirrored);
      }
    }
  }

  for (const media of parsed.media) {
    const mediaSyncKey = buildPromptMediaSyncKey(media);
    if (activeExactKeys.has(`${LandingPromptAssetKind.PromptMedia}:${mediaSyncKey}`)) {
      const activeMirrored = activePromptMediaBySyncKey.get(mediaSyncKey);
      if (activeMirrored) {
        const refreshedMirrored = await withCloudflareStreamVariant(activeMirrored, parsed.title);
        if (refreshedMirrored !== activeMirrored) {
          await upsertSuccessfulAsset({
            client,
            idFactory,
            landingType: source.landingType,
            promptId,
            kind: LandingPromptAssetKind.PromptMedia,
            sourceUrl: media.sourceUrl,
            position: media.position,
            mirrored: refreshedMirrored,
          });
          successCount += 1;
        }
      }
      continue;
    }

    try {
      const mirrored =
        reusableByKindAndSource.get(`${LandingPromptAssetKind.PromptMedia}:${media.sourceUrl}`) ||
        globallyReusablePromptMedia.get(media.sourceUrl) ||
        (await mirrorAsset({
          sourceUrl: media.sourceUrl,
          s3Prefix: source.s3Prefix,
          notionPageId: parsed.notionPageId,
          position: media.position,
        }));
      const poster =
        media.posterSourceUrl &&
        (await mirrorAsset({
          sourceUrl: media.posterSourceUrl,
          s3Prefix: source.s3Prefix,
          notionPageId: parsed.notionPageId,
          position: media.position,
        }));
      const mirroredWithPlayback = await withCloudflareStreamVariant(mirrored, parsed.title);
      await upsertSuccessfulAsset({
        client,
        idFactory,
        landingType: source.landingType,
        promptId,
        kind: LandingPromptAssetKind.PromptMedia,
        sourceUrl: media.sourceUrl,
        position: media.position,
        mirrored: withPosterVariant(mirroredWithPlayback, poster || null, media.posterSourceUrl),
      });
      successCount += 1;
    } catch (error) {
      await upsertFailedAsset({
        client,
        idFactory,
        landingType: source.landingType,
        promptId,
        kind: LandingPromptAssetKind.PromptMedia,
        sourceUrl: media.sourceUrl,
        position: media.position,
        error,
      });
      failedCount += 1;
      mediaFailedCount += 1;
    }
  }

  if (parsed.authorAvatarSourceUrl) {
    const avatarAlreadyCurrent = activeExactKeys.has(
      `${LandingPromptAssetKind.AuthorAvatar}:${buildPromptMediaSyncKey({
        position: 0,
        sourceUrl: parsed.authorAvatarSourceUrl,
        posterSourceUrl: null,
      })}`,
    );
    if (!avatarAlreadyCurrent) {
      try {
        const mirrored =
          reusableByKindAndSource.get(`${LandingPromptAssetKind.AuthorAvatar}:${parsed.authorAvatarSourceUrl}`) ||
          (await findReusableAuthorAvatarAsset({
            client,
            landingType: source.landingType,
            sourceUrl: parsed.authorAvatarSourceUrl,
          })) ||
          (await mirrorAsset({
            sourceUrl: parsed.authorAvatarSourceUrl,
            s3Prefix: source.s3Prefix,
            notionPageId: parsed.notionPageId,
            position: 0,
            avatar: true,
          }));
        await upsertSuccessfulAsset({
          client,
          idFactory,
          landingType: source.landingType,
          promptId,
          kind: LandingPromptAssetKind.AuthorAvatar,
          sourceUrl: parsed.authorAvatarSourceUrl,
          position: 0,
          mirrored,
        });
        successCount += 1;
      } catch (error) {
        await upsertFailedAsset({
          client,
          idFactory,
          landingType: source.landingType,
          promptId,
          kind: LandingPromptAssetKind.AuthorAvatar,
          sourceUrl: parsed.authorAvatarSourceUrl,
          position: 0,
          error,
        });
        failedCount += 1;
        avatarFailedCount += 1;
      }
    }
    // If avatarAlreadyCurrent is true, leave updated_at untouched so hourly syncs stay cheap.
  }

  if (mediaFailedCount === 0) {
    await staleMissingAssets({
      client,
      landingType: source.landingType,
      promptId,
      kind: LandingPromptAssetKind.PromptMedia,
      currentAssets: parsed.media.map((media) => ({ position: media.position, sourceUrl: media.sourceUrl })),
    });
  }
  if (avatarFailedCount === 0) {
    await staleMissingAssets({
      client,
      landingType: source.landingType,
      promptId,
      kind: LandingPromptAssetKind.AuthorAvatar,
      currentAssets: parsed.authorAvatarSourceUrl ? [{ position: 0, sourceUrl: parsed.authorAvatarSourceUrl }] : [],
    });
  }

  return { successCount, failedCount };
}
