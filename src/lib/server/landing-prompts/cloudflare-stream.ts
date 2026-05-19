/**
 * cloudflare-stream.ts 负责把已公开可访问的视频复制到 Cloudflare Stream，并渐进刷新 HLS 播放状态。
 * 它位于 landing-pages 同步链路里的外部视频分发层，被 asset-writes.ts 在视频已镜像到 Kollab CDN 后调用；
 * 这样页面读取层只需要消费 `variants.stream`，不需要知道 Cloudflare 的 copy/refresh 协议细节。
 */
import type { MirroredLandingAssetVariant } from './assets';

type CloudflareStreamVideo = {
  uid?: string;
  readyToStream?: boolean;
  preview?: string;
  playback?: {
    hls?: string;
  };
  status?: {
    state?: string;
    errorReasonText?: string;
  };
};

type CloudflareApiEnvelope<TResult> = {
  success?: boolean;
  result?: TResult;
  errors?: Array<{
    code?: number;
    message?: string;
  }>;
};

type CloudflareStreamConfig = {
  accountId: string;
  apiToken: string;
};

/**
 * 读取当前环境下的 Cloudflare Stream 凭据。
 * landing-pages Deployment/CronJob 会通过 shared runtime secret 注入这些字段；
 * 缺配置时保持 null，让同步继续用 mp4 CDN 回退而不是整条 prompt 失败。
 */
function getCloudflareStreamConfig(env: Record<string, string | undefined> = process.env): CloudflareStreamConfig | null {
  const accountId = env.LANDING_PROMPTS_CLOUDFLARE_STREAM_ACCOUNT_ID?.trim() || '';
  const apiToken = env.LANDING_PROMPTS_CLOUDFLARE_STREAM_API_TOKEN?.trim() || '';

  if (!accountId || !apiToken) {
    return null;
  }

  return { accountId, apiToken };
}

/**
 * 判断当前 runtime 是否启用了 Cloudflare Stream 同步。
 * asset-writes.ts 用这个信号决定是否尝试刷新 `variants.stream`。
 */
export function isCloudflareStreamEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(getCloudflareStreamConfig(env));
}

/**
 * 发送 Cloudflare Stream API 请求并统一解析错误。
 * 这里显式要求 `result` 存在，是为了让上游拿到的总是已解包的业务对象而不是 envelope。
 */
async function requestCloudflareStream<TResult>(path: string, init?: RequestInit): Promise<TResult> {
  const config = getCloudflareStreamConfig();
  if (!config) {
    throw new Error('cloudflare_stream_not_configured');
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json()) as CloudflareApiEnvelope<TResult>;
  if (!response.ok || payload.success === false || !payload.result) {
    const errorMessage = payload.errors?.map((error) => error.message).filter(Boolean).join('; ') || `cloudflare_stream_request_failed:${response.status}`;
    throw new Error(errorMessage);
  }

  return payload.result;
}

/**
 * 把 Cloudflare 视频详情映射到 `variants.stream`。
 * 页面只关心 HLS manifest、ready 状态和调试所需的 preview/error 信息，
 * 因此这里只保留前端播放和后续同步刷新所需的最小字段。
 */
function mapCloudflareStreamVariant(video: CloudflareStreamVideo, sourceUrl: string): MirroredLandingAssetVariant {
  const state = video.readyToStream ? 'ready' : video.status?.state || 'queued';

  return {
    provider: 'cloudflare-stream',
    uid: video.uid,
    url: video.playback?.hls || '',
    status: state,
    previewUrl: video.preview || null,
    readyToStream: Boolean(video.readyToStream),
    sourceUrl,
    error: video.status?.errorReasonText || null,
  };
}

/**
 * 通过 public URL 创建一条 Cloudflare Stream copy 任务。
 * 这里使用 copy API 而不是本地 wrangler 上传，是因为定时任务运行在集群内，
 * 复制公开 CDN 地址能避免依赖本地登录态或在容器里追加 wrangler runtime。
 */
async function createCloudflareStreamCopy(sourceUrl: string, title: string): Promise<CloudflareStreamVideo> {
  return requestCloudflareStream<CloudflareStreamVideo>('/stream/copy', {
    method: 'POST',
    body: JSON.stringify({
      url: sourceUrl,
      meta: { name: title },
    }),
  });
}

/**
 * 读取单条 Cloudflare Stream 视频详情。
 * 已存在但未 ready 的视频会在下一次 sync 中从这里继续单次刷新，避免反复创建新的 copy 任务。
 */
async function getCloudflareStreamVideo(uid: string): Promise<CloudflareStreamVideo> {
  return requestCloudflareStream<CloudflareStreamVideo>(`/stream/${uid}`);
}

/**
 * 读取一条已有 Cloudflare Stream 视频的最新状态。
 * 这里只做单次查询而不在当前 sync 里持续轮询，
 * 因为 landing source 可能包含成百上千条视频；同步链路已经有 mp4 回退可播，
 * 继续同步等待 HLS ready 只会把事务和 CronJob 线性拉长到不可接受的程度。
 */
async function refreshCloudflareStreamVariant(uid: string, sourceUrl: string): Promise<MirroredLandingAssetVariant> {
  const video = await getCloudflareStreamVideo(uid);
  return mapCloudflareStreamVariant(video, sourceUrl);
}

/**
 * 确保当前视频拥有可复用的 Cloudflare Stream 变体。
 * 相同 sourceUrl 且已有 UID 时优先复用：ready 状态直接沿用，queued/processing 状态只单次刷新；
 * sourceUrl 变化或已有状态 error 时重新创建 copy，但不在当前 sync 同步等待 ready，
 * 这样页面可以先继续播放 mp4，下一次小时级 sync 再把 `variants.stream` 升级成 HLS。
 */
export async function ensureCloudflareStreamVariant({
  sourceUrl,
  title,
  existingVariant,
}: {
  sourceUrl: string;
  title: string;
  existingVariant?: MirroredLandingAssetVariant | null;
}): Promise<MirroredLandingAssetVariant | null> {
  if (!isCloudflareStreamEnabled()) {
    return existingVariant || null;
  }

  const existingUid = existingVariant?.uid?.trim();
  const existingSourceUrl = existingVariant?.sourceUrl?.trim();
  const canReuseExisting = Boolean(existingUid && existingSourceUrl === sourceUrl && existingVariant?.status !== 'error');

  if (canReuseExisting && existingUid) {
    if (existingVariant?.status === 'ready') {
      return existingVariant;
    }

    return refreshCloudflareStreamVariant(existingUid, sourceUrl);
  }

  const createdVideo = await createCloudflareStreamCopy(sourceUrl, title);
  if (createdVideo.uid) {
    return mapCloudflareStreamVariant(createdVideo, sourceUrl);
  }

  return null;
}
