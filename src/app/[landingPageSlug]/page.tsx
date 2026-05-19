/**
 * [landingPageSlug]/page.tsx 渲染每个公开 landing page 的默认语言入口。
 * 它位于 landing-pages 的 App Router 顶级 route 层，被 ingress 直接暴露到 kollab.im 的多个营销子路径；
 * 这里按 route slug 解析页面配置，再复用统一的服务端页面 renderer，避免每加一个落地页都复制整套路由实现。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { generateLandingPromptsMetadata, renderLandingPromptsPage } from '@/app/landing-prompts-page';
import { getLandingPageConfigByRouteSlug } from '@/lib/landing-page-config';
import { DEFAULT_LANDING_LANGUAGE } from '@/lib/landing-language';

export const dynamic = 'force-dynamic';

/**
 * 生成默认无语言后缀 landing page 的 metadata。
 * 这个方法被 Next.js metadata pipeline 调用；只有已注册 route slug 才会生成可索引 metadata，
 * 未知 slug 直接 404，避免把任意 marketing path 都渲染成重复页面。
 */
export async function generateMetadata({ params }: { params: Promise<{ landingPageSlug: string }> }): Promise<Metadata> {
  const { landingPageSlug } = await params;
  const config = getLandingPageConfigByRouteSlug(landingPageSlug);

  if (!config) {
    notFound();
  }

  return generateLandingPromptsMetadata(config, DEFAULT_LANDING_LANGUAGE, null);
}

/**
 * 渲染默认语言 landing page。
 * 默认页继续使用英文和无语言后缀 canonical，显式语言入口交给 `app/[landingPageSlug]/[lan]/page.tsx`。
 */
export default async function LandingPromptsDefaultPage({
  params,
  searchParams,
}: {
  params: Promise<{ landingPageSlug: string }>;
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { landingPageSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const config = getLandingPageConfigByRouteSlug(landingPageSlug);
  const sharedPromptId = typeof resolvedSearchParams.id === 'string' ? resolvedSearchParams.id : null;

  if (!config) {
    notFound();
  }

  return renderLandingPromptsPage({
    config,
    language: DEFAULT_LANDING_LANGUAGE,
    canonicalLanguage: null,
    sharedPromptId,
  });
}
