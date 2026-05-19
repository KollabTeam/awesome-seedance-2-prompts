/**
 * [landingPageSlug]/[lan]/page.tsx 渲染每个 landing page 的显式语言入口。
 * 它位于 landing-pages 的 App Router 双动态段路由层（slug 在前、语言在后），被 middleware 内部 rewrite 后访问。
 * 浏览器可见 URL 始终是 /{lang}/{landingPageSlug}（lang 在前）；middleware 在路由匹配前把路径内部重写为
 * /{landingPageSlug}/{lan}，这样本文件才能被 Next.js 路由系统命中。
 * 路由参数名使用 `lan`（而非 `lang`）是为了与顶层的 [landingPageSlug] segment 组合后不触发 Next.js
 * 的"同层级 dynamic segment 名称不一致"错误——这是本文件维持在 slug-first 路径下的根本原因。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { generateLandingPromptsMetadata, renderLandingPromptsPage } from '@/app/landing-prompts-page';
import { getLandingPageConfigByRouteSlug } from '@/lib/landing-page-config';
import { getLandingLanguageFromSegment } from '@/lib/landing-language';

export const dynamic = 'force-dynamic';

/**
 * 生成显式语言 landing page 的 metadata。
 * 非法 route slug 或语言 segment 都直接 404，避免 metadata 阶段和页面渲染阶段出现不同分支。
 * 参数名 `lan` 对应文件系统中的 `[lan]` segment；middleware rewrite 已把原始 URL 的第一段 lang 映射到这里。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lan: string; landingPageSlug: string }>;
}): Promise<Metadata> {
  const { landingPageSlug, lan } = await params;
  const config = getLandingPageConfigByRouteSlug(landingPageSlug);
  const language = getLandingLanguageFromSegment(lan);

  if (!config || !language || !config.supportedLanguages.includes(language)) {
    notFound();
  }

  return generateLandingPromptsMetadata(config, language, language);
}

/**
 * 渲染显式语言 landing page。
 * 这个入口只负责校验 route slug 和语言，并把它们传给统一服务端 renderer。
 * params.lan 由 middleware rewrite 填入，值就是原始 URL /{lang}/{slug} 中的 lang segment。
 */
export default async function LocalizedLandingPromptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lan: string; landingPageSlug: string }>;
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { landingPageSlug, lan } = await params;
  const resolvedSearchParams = await searchParams;
  const config = getLandingPageConfigByRouteSlug(landingPageSlug);
  const language = getLandingLanguageFromSegment(lan);
  const sharedPromptId = typeof resolvedSearchParams.id === 'string' ? resolvedSearchParams.id : null;

  if (!config || !language || !config.supportedLanguages.includes(language)) {
    notFound();
  }

  return renderLandingPromptsPage({
    config,
    language,
    sharedPromptId,
  });
}
