/**
 * assets.ts mirrors landing prompt media into S3 and plans landing-page delivery variants.
 * It belongs to the landing-pages backend layer: Notion/external URLs are unstable, so sync downloads them once,
 * stores originals plus lightweight display variants, and public pages serve stable CDN URLs or external playback
 * providers such as Cloudflare Stream without doing per-request media transforms.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import sharp from 'sharp';

type LandingAssetMediaType = 'image' | 'video' | 'unknown';

const DEFAULT_LANDING_PROMPTS_ASSET_MAX_BYTES = 15728640;

export type LandingPromptMediaKeyPlan = {
  original: {
    s3Key: string;
  };
  card?: {
    s3Key: string;
  };
};

export type PlanPromptMediaKeysInput = {
  s3Prefix: string;
  notionPageId: string;
  mediaType: LandingAssetMediaType;
  position: number;
  hash: string;
  extension: string;
  avatar?: boolean;
};

export type DownloadedLandingAsset = {
  buffer: Buffer;
  contentType: string | null;
  byteSize: number;
  hash: string;
  mediaType: LandingAssetMediaType;
  extension: string;
};

export type MirroredLandingAssetVariant = {
  url: string;
  s3Key?: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
  status?: string;
  uid?: string;
  previewUrl?: string | null;
  readyToStream?: boolean;
  provider?: string;
  error?: string | null;
};

export type MirroredLandingAsset = {
  mediaType: LandingAssetMediaType;
  contentType: string | null;
  byteSize: number;
  hash: string;
  width: number | null;
  height: number | null;
  originalS3Key: string;
  originalCdnUrl: string;
  variants: Record<string, MirroredLandingAssetVariant>;
};

let s3Client: S3Client | null = null;

/**
 * Sanitizes one S3 key path segment.
 * We keep this intentionally small: the goal is stable object keys that do not contain slashes from external IDs,
 * not user-facing filenames.
 */
function sanitizeS3Segment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'item';
}

/**
 * Returns the content-addressed S3 key plan for one prompt media slot.
 * Images keep the original asset for lightbox/full-size viewing and get one q80 compressed image for card display;
 * videos only get original mirroring in this phase to avoid hidden transcoding cost and runtime complexity.
 */
export function planPromptMediaKeys(input: PlanPromptMediaKeysInput): LandingPromptMediaKeyPlan {
  const prefix = input.s3Prefix.replace(/^\/+|\/+$/g, '');
  const pageId = sanitizeS3Segment(input.notionPageId);
  const hash = sanitizeS3Segment(input.hash);
  const extension = sanitizeS3Segment(input.extension.replace(/^\./, '').toLowerCase() || 'bin');
  const position = Math.max(0, Math.trunc(input.position));

  if (input.avatar) {
    const base = `${prefix}/authors/${hash}`;
    return {
      original: { s3Key: `${base}/original.${extension}` },
    };
  }

  if (input.mediaType === 'video') {
    const base = `${prefix}/${pageId}/videos/${position}/${hash}`;
    return {
      original: { s3Key: `${base}/original.${extension}` },
    };
  }

  const base = `${prefix}/${pageId}/images/${position}/${hash}`;
  return {
    original: { s3Key: `${base}/original.${extension}` },
    card: { s3Key: `${base}/thumb_768_q80.webp` },
  };
}

/**
 * Builds a CloudFront URL from a raw S3 key.
 * Each path segment is encoded independently so object keys with spaces remain fetchable while `/` keeps path semantics.
 */
export function buildLandingPromptCdnUrl(cdnBaseUrl: string, s3Key: string): string {
  const baseUrl = cdnBaseUrl.replace(/\/+$/g, '');
  const encodedKey = s3Key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${baseUrl}/${encodedKey}`;
}

/**
 * Resolves the public CDN base used by landing prompt assets in the current runtime.
 * Sync and reuse logic both depend on this so a deployment that switches from test CDN to production CDN does not
 * keep copying stale public URLs out of old DB rows.
 */
export function getLandingPromptCdnBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.LANDING_PROMPTS_CDN_BASE_URL || env.EDGE_SERVER_URL || '').replace(/\/+$/g, '');
}

/**
 * Resolves the byte limit used for one landing asset download.
 * Images continue to use the conservative default/global limit, while videos may opt into a higher cap through
 * `LANDING_PROMPTS_VIDEO_ASSET_MAX_BYTES`; this keeps tweet mp4 mirroring possible without silently loosening image
 * limits for every sync source.
 */
export function getLandingPromptAssetMaxBytes(
  mediaType: LandingAssetMediaType,
  env: Record<string, string | undefined> = process.env,
): number {
  const configuredDefault = Number.parseInt(env.LANDING_PROMPTS_ASSET_MAX_BYTES || '', 10);
  const defaultMaxBytes =
    Number.isFinite(configuredDefault) && configuredDefault > 0
      ? configuredDefault
      : DEFAULT_LANDING_PROMPTS_ASSET_MAX_BYTES;

  if (mediaType !== 'video') {
    return defaultMaxBytes;
  }

  const configuredVideo = Number.parseInt(env.LANDING_PROMPTS_VIDEO_ASSET_MAX_BYTES || '', 10);
  return Number.isFinite(configuredVideo) && configuredVideo > 0 ? configuredVideo : defaultMaxBytes;
}

/**
 * Detects whether a downloaded asset is an image or a video.
 * Header content-type wins when present; file signatures and URL extensions cover common external hosts that return
 * generic octet-stream responses.
 */
export function detectLandingAssetMediaType(buffer: Buffer, contentType?: string | null, sourceUrl?: string): LandingAssetMediaType {
  const normalizedType = contentType?.toLowerCase() || '';
  if (normalizedType.startsWith('image/')) {
    return 'image';
  }
  if (normalizedType.startsWith('video/')) {
    return 'video';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image';
  }
  if (buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'video';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image';
  }
  if (buffer.length >= 8 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return 'image';
  }

  const extension = getExtensionFromUrl(sourceUrl || '');
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(extension)) {
    return 'image';
  }
  if (['mp4', 'webm', 'mov', 'm4v'].includes(extension)) {
    return 'video';
  }

  return 'unknown';
}

/**
 * Guesses the asset media type from headers and URL before the body is downloaded.
 * `content-length` enforcement needs a media-type guess up front, so this helper intentionally uses only metadata that
 * is already available before streaming the response body.
 */
function detectLandingAssetMediaTypeHint(contentType?: string | null, sourceUrl?: string): LandingAssetMediaType {
  const normalizedType = contentType?.toLowerCase() || '';
  if (normalizedType.startsWith('image/')) {
    return 'image';
  }
  if (normalizedType.startsWith('video/')) {
    return 'video';
  }

  const extension = getExtensionFromUrl(sourceUrl || '');
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(extension)) {
    return 'image';
  }
  if (['mp4', 'webm', 'mov', 'm4v'].includes(extension)) {
    return 'video';
  }

  return 'unknown';
}

/**
 * Resolves a stable file extension from content type and source URL.
 * The extension only affects object key readability; media type detection is handled separately.
 */
function resolveAssetExtension(contentType: string | null, sourceUrl: string, mediaType: LandingAssetMediaType): string {
  const normalizedType = contentType?.toLowerCase() || '';
  const fromUrl = getExtensionFromUrl(sourceUrl);
  if (fromUrl) {
    return fromUrl;
  }
  if (normalizedType.includes('jpeg')) return 'jpg';
  if (normalizedType.includes('png')) return 'png';
  if (normalizedType.includes('webp')) return 'webp';
  if (normalizedType.includes('avif')) return 'avif';
  if (normalizedType.includes('mp4')) return 'mp4';
  if (normalizedType.includes('webm')) return 'webm';
  return mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'bin';
}

/**
 * Extracts a simple extension from URL pathnames.
 * Query strings are ignored because many Notion/file hosts append signed URL parameters.
 */
function getExtensionFromUrl(sourceUrl: string): string {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const last = pathname.split('/').pop() || '';
    const dotIndex = last.lastIndexOf('.');
    return dotIndex >= 0 ? last.slice(dotIndex + 1).toLowerCase() : '';
  } catch {
    const last = sourceUrl.split('?')[0]?.split('/').pop() || '';
    const dotIndex = last.lastIndexOf('.');
    return dotIndex >= 0 ? last.slice(dotIndex + 1).toLowerCase() : '';
  }
}

/**
 * Reads a fetch body incrementally while enforcing the configured byte limit.
 * Some external media hosts omit content-length; streaming protects the sync pod from buffering an oversized video before
 * the limit check can run.
 */
async function readLandingAssetBody(response: Response, maxBytes: number, controller: AbortController): Promise<Buffer> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.byteLength > maxBytes) {
      throw new Error('landing_asset_too_large');
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        controller.abort();
        throw new Error('landing_asset_too_large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

/**
 * Downloads an external landing asset with timeout and byte limits.
 * Sync calls this before S3 upload so one broken external host cannot hang the whole landing source refresh.
 */
export async function downloadLandingAsset(sourceUrl: string): Promise<DownloadedLandingAsset> {
  const timeoutMs = Number.parseInt(process.env.LANDING_PROMPTS_ASSET_FETCH_TIMEOUT_MS || '15000', 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 15000);

  try {
    const response = await fetch(sourceUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`landing_asset_fetch_failed:${response.status}`);
    }

    const hintedMediaType = detectLandingAssetMediaTypeHint(response.headers.get('content-type'), sourceUrl);
    const maxBytes = getLandingPromptAssetMaxBytes(hintedMediaType);
    const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error('landing_asset_too_large');
    }

    const buffer = await readLandingAssetBody(response, maxBytes, controller);

    const contentType = response.headers.get('content-type');
    const mediaType = detectLandingAssetMediaType(buffer, contentType, sourceUrl);
    if (mediaType === 'unknown') {
      throw new Error('landing_asset_unsupported_media_type');
    }
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
    return {
      buffer,
      contentType,
      byteSize: buffer.byteLength,
      hash,
      mediaType,
      extension: resolveAssetExtension(contentType, sourceUrl, mediaType),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Returns the S3 client used by landing-pages asset mirroring.
 * Credentials are resolved by the AWS SDK default chain so the deployed container can reuse existing AWS runtime env.
 */
function getLandingPromptS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.LANDING_PROMPTS_S3_REGION || process.env.AWS_REGION || 'ap-northeast-1',
    });
  }
  return s3Client;
}

/**
 * Uploads one generated landing asset buffer to S3.
 * This is separated from variant generation so tests can validate key planning without hitting AWS.
 */
async function putLandingAssetObject(s3Key: string, body: Buffer, contentType?: string | null): Promise<void> {
  const bucket = process.env.LANDING_PROMPTS_S3_BUCKET || process.env.AWS_BUCKET_NAME;
  if (!bucket) {
    throw new Error('landing_prompts_s3_bucket_missing');
  }

  await getLandingPromptS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: body,
      ContentType: contentType || undefined,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

/**
 * Mirrors one downloaded prompt image/video or avatar to S3 and returns public CDN URLs.
 * Videos are not transcoded in this phase; images keep their original dimensions for lightbox/full-size viewing and
 * only add one q80 compressed image for card display so sync does not distort aspect ratios with resize/crop variants.
 */
export async function mirrorLandingPromptAsset({
  sourceUrl,
  s3Prefix,
  notionPageId,
  position,
  avatar = false,
}: {
  sourceUrl: string;
  s3Prefix: string;
  notionPageId: string;
  position: number;
  avatar?: boolean;
}): Promise<MirroredLandingAsset> {
  const downloaded = await downloadLandingAsset(sourceUrl);
  const plan = planPromptMediaKeys({
    s3Prefix,
    notionPageId,
    mediaType: downloaded.mediaType,
    position,
    hash: downloaded.hash,
    extension: downloaded.extension,
    avatar,
  });
  const cdnBaseUrl = process.env.LANDING_PROMPTS_CDN_BASE_URL || process.env.EDGE_SERVER_URL || '';
  if (!cdnBaseUrl) {
    throw new Error('landing_prompts_cdn_base_url_missing');
  }

  await putLandingAssetObject(plan.original.s3Key, downloaded.buffer, downloaded.contentType);

  const variants: MirroredLandingAsset['variants'] = {};
  let width: number | null = null;
  let height: number | null = null;

  if (downloaded.mediaType === 'image') {
    const metadata = await sharp(downloaded.buffer).metadata();
    width = metadata.width ?? null;
    height = metadata.height ?? null;

    if (plan.card) {
      const cardBuffer = await sharp(downloaded.buffer).webp({ quality: 80 }).toBuffer();
      await putLandingAssetObject(plan.card.s3Key, cardBuffer, 'image/webp');
      const cardMetadata = await sharp(cardBuffer).metadata();
      variants.card = {
        s3Key: plan.card.s3Key,
        url: buildLandingPromptCdnUrl(cdnBaseUrl, plan.card.s3Key),
        width: cardMetadata.width ?? undefined,
        height: cardMetadata.height ?? undefined,
      };
    }
  }

  return {
    mediaType: downloaded.mediaType,
    contentType: downloaded.contentType,
    byteSize: downloaded.byteSize,
    hash: downloaded.hash,
    width,
    height,
    originalS3Key: plan.original.s3Key,
    originalCdnUrl: buildLandingPromptCdnUrl(cdnBaseUrl, plan.original.s3Key),
    variants,
  };
}
