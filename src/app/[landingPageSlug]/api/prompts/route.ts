/**
 * [landingPageSlug]/api/prompts/route.ts 提供每个公开 landing page 的 cursor 分页接口。
 * 它位于 landing-pages 的 App Router API 层，被对应页面前端 gallery 调用；
 * API 路径收口在页面 route slug 下，是为了让公网 `/api` 继续归 seeds-server 所有，而落地页数据请求只命中 landing-pages。
 */
import { getLandingPageConfigByRouteSlug } from '@/lib/landing-page-config';
import { NOTION_PROMPTS_CACHE_SECONDS, getLandingPromptsPage, isLandingPagesLocalDebugEnv } from '@/lib/notion-prompts';
import { DEFAULT_LANDING_LANGUAGE, getLandingLanguageFromSegment } from '@/lib/landing-language';

export const revalidate = 600;

const CACHE_CONTROL = `public, s-maxage=${NOTION_PROMPTS_CACHE_SECONDS}, stale-while-revalidate=60`;
const LOCAL_CACHE_CONTROL = 'no-store, max-age=0';

type PromptRouteContext = {
  params: Promise<{ landingPageSlug: string }> | { landingPageSlug: string };
};

/**
 * 返回当前运行环境下的 prompt API 缓存头。
 * 本地调试继续显式 no-store，避免筛选、分页和同步验证被浏览器缓存干扰。
 */
function getPromptApiCacheControl(): string {
  return isLandingPagesLocalDebugEnv() ? LOCAL_CACHE_CONTROL : CACHE_CONTROL;
}

/**
 * 解析动态 route params。
 * 某些 Next 版本会把 params 生成为 Promise，这里统一 await 后再交给 source/config 查找逻辑。
 */
async function resolvePromptRouteParams(context: PromptRouteContext): Promise<{ landingPageSlug: string }> {
  return await context.params;
}

/**
 * 返回某个 landing page 的一页 prompt gallery 数据。
 * route slug 先映射到 source slug，再共享同一条 DB read path，避免 API 层直接依赖数据库内部的 landing_type 命名。
 */
export async function GET(request: Request, context: PromptRouteContext) {
  const params = await resolvePromptRouteParams(context);
  const config = getLandingPageConfigByRouteSlug(params.landingPageSlug);
  if (!config) {
    return Response.json({ error: 'prompt_page_not_found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const tag = url.searchParams.get('tag');
  const query = url.searchParams.get('q');
  const id = url.searchParams.get('id');
  const language = getLandingLanguageFromSegment(url.searchParams.get('lan') || undefined) || DEFAULT_LANDING_LANGUAGE;
  const cacheControl = getPromptApiCacheControl();
  try {
    const page = await getLandingPromptsPage({
      sourceSlug: config.sourceSlug,
      cursor,
      language,
      tag,
      query,
      id,
    });

    return Response.json(page, {
      headers: {
        'Cache-Control': cacheControl,
      },
    });
  } catch {
    return Response.json(
      { error: 'prompt_page_unavailable' },
      {
        status: 502,
        headers: {
          'Cache-Control': cacheControl,
        },
      },
    );
  }
}
