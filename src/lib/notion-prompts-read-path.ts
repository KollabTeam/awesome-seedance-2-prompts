/**
 * notion-prompts-read-path.ts owns the Postgres read path for landing prompt pages.
 * It sits next to notion-prompts.ts in the landing-pages data layer so public pages and API routes always read the
 * synced database model; Notion is only touched by the separate sync job that populates these tables.
 *
 * 本地调试旁路：当 `LANDING_PROMPTS_DEV_PROXY_URL` 在非 production 环境被设置时，读取路径会切到那个 base URL
 * 的公共 prompts API（例如 `https://kollab.im`），跳过 Postgres 直连。test 环境的 RDS 安全组只放行 VPC 内连接，
 * Mac 本地无法直接拿到同步表数据；让 SSR 代理到线上公共 API 让重设计页能本地预览，而不必为此再装本地 DB 或申请 bastion。
 */
import { getLandingPageConfigBySourceSlug } from '@/lib/landing-page-config';
import { DEFAULT_LANDING_LANGUAGE, type LandingLanguage } from '@/lib/landing-language';
import { getLandingPromptPageFromDb } from '@/lib/server/landing-prompts/query';
import { getLandingPromptSourceBySlug } from '@/lib/server/landing-prompts/sources';

import type { PromptGalleryPage } from './notion-prompts';

const GPT_IMAGE_PROMPT_SOURCE_SLUG = 'gpt-image-2';

/**
 * 解析 dev-only 公共 API 代理 base URL。
 * 这个 helper 只在 `LANDING_PROMPTS_DEV_PROXY_URL` 被显式设置且 NODE_ENV 不是 production 时返回值；
 * 在生产编译里 short-circuit 返回 null，是为了避免任何配置事故让线上 SSR 跨调到另一个 origin。
 */
function getLandingPromptsDevProxyBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  if (env.NODE_ENV === 'production') {
    return null;
  }
  const raw = env.LANDING_PROMPTS_DEV_PROXY_URL?.trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/\/+$/, '');
}

/**
 * 通过线上公共 API 拿一页 prompt，专用于本地 dev 预览。
 * 这个函数只被 `getSyncedLandingPromptsPage` 在 dev 代理开关命中时调用；它把同一组 query 参数透传给
 * `${proxy}/{routeSlug}/api/prompts`，并直接复用其返回结构（items / hasMore / nextCursor / availableTags
 * 与本地 read path 完全同形）。一旦上游返回非 2xx，立即抛错由页面层暴露真实失败，避免静默回退到旧缓存。
 */
async function fetchLandingPromptsViaDevProxy(params: {
  sourceSlug: string;
  cursor?: string | null;
  pageSize: number;
  language: LandingLanguage;
  tag?: string | null;
  query?: string | null;
  id?: string | null;
  baseUrl: string;
}): Promise<PromptGalleryPage> {
  const config = getLandingPageConfigBySourceSlug(params.sourceSlug);
  if (!config) {
    throw new Error(`Landing prompt source ${params.sourceSlug} has no route config`);
  }

  const url = new URL(`${params.baseUrl}/${config.routeSlug}/api/prompts`);
  url.searchParams.set('language', params.language);
  url.searchParams.set('pageSize', String(params.pageSize));
  if (params.cursor) url.searchParams.set('cursor', params.cursor);
  if (params.tag) url.searchParams.set('tag', params.tag);
  if (params.query) url.searchParams.set('query', params.query);
  if (params.id) url.searchParams.set('id', params.id);

  const response = await fetch(url.toString(), {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Landing prompts dev proxy returned ${response.status} for ${url.toString()}`);
  }
  return (await response.json()) as PromptGalleryPage;
}

/**
 * 判断当前进程是否是 landing-pages 的本地调试环境。
 * 这个方法被 API route 用来选择响应缓存头；本地调试需要 no-store，避免调试筛选/分页时浏览器缓存旧 DB 结果。
 */
export function isLandingPagesLocalDebugEnv(env: Record<string, string | undefined> = process.env): boolean {
  const appEnv = env.VITE_APP_ENV || (env.NODE_ENV === 'development' ? 'local' : 'production');
  return appEnv === 'local';
}

/**
 * 判断 landing prompt 读取是否走同步后的 Postgres read model。
 * 现在公共页面和分页 API 必须以数据库为唯一数据源；保留这个函数只是为了让旧调用点和测试能明确锁住决策。
 */
export function shouldUseLandingPromptDbReadPath(_env: Record<string, string | undefined> = process.env): boolean {
  return true;
}

/**
 * 从同步表读取某个 landing source 的一页 prompt。
 * 这个 helper 被各个页面 wrapper 调用，是公共展示链路的唯一数据来源；如果 source 缺失、DB 失败或 cursor
 * 不是 DB cursor，就直接抛错交给页面/API 暴露真实失败，避免静默回退到过期 CMS 或内置数据。
 *
 * dev 代理分支：如果 `LANDING_PROMPTS_DEV_PROXY_URL` 在非 production 环境配置，整段函数改走线上公共 API，
 * 完全跳过本地 Postgres / S3 依赖。production 编译里 `getLandingPromptsDevProxyBaseUrl` 永远返回 null，
 * 这条分支不会被触发，避免 dev 旁路误成线上行为。
 */
export async function getSyncedLandingPromptsPage({
  sourceSlug,
  cursor,
  pageSize,
  language = DEFAULT_LANDING_LANGUAGE,
  tag,
  query,
  id,
}: {
  sourceSlug: string;
  cursor?: string | null;
  pageSize: number;
  language?: LandingLanguage;
  tag?: string | null;
  query?: string | null;
  id?: string | null;
}): Promise<PromptGalleryPage> {
  const devProxyBaseUrl = getLandingPromptsDevProxyBaseUrl();
  if (devProxyBaseUrl) {
    return fetchLandingPromptsViaDevProxy({
      sourceSlug,
      cursor,
      pageSize,
      language,
      tag,
      query,
      id,
      baseUrl: devProxyBaseUrl,
    });
  }

  const source = await getLandingPromptSourceBySlug(sourceSlug);
  if (!source) {
    throw new Error('Landing prompt source is not configured');
  }

  return getLandingPromptPageFromDb({
    source,
    cursor,
    pageSize,
    language,
    tag,
    query,
    id,
  });
}

/**
 * 从同步表读取 GPT Image 2 的一页 prompt。
 * 这个 wrapper 继续服务既有 GPT Image 页面和测试，避免多 landing page 改造把旧调用点全部打碎。
 */
export async function getSyncedGptImagePromptsPage(
  input: Omit<Parameters<typeof getSyncedLandingPromptsPage>[0], 'sourceSlug'>,
): Promise<PromptGalleryPage> {
  return getSyncedLandingPromptsPage({
    sourceSlug: GPT_IMAGE_PROMPT_SOURCE_SLUG,
    ...input,
  });
}
