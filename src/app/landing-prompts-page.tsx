/**
 * landing-prompts-page.tsx 渲染多 landing source 共享的服务端页面入口。
 * 它位于 landing-pages 的 App Router 页面层下方，被 route-slug 默认页与语言页复用；
 * 页面服务端只负责读取同步后的数据库内容、输出结构化数据并按配置选择视觉外壳，
 * 这样新增页面时主要扩展配置和局部 UI，而不再复制整套路由与数据查询代码。
 *
 * arcade 变体额外渲染 ArcadePageWithHeaderSearch（客户端包裹层），
 * 让 LandingPageShell 的 header 搜索框能与 gallery toolbar 搜索框共享同一 URL ?q= 真相，
 * 而不把 hook 调用提升到服务端组件。
 */
import type { Metadata } from 'next';
import { connection } from 'next/server';

import { GptImagePromptsSeoSection } from '@/components/gpt-image-prompts-seo-section';
import { HandDrawnLandingPageShell } from '@/components/handdrawn-landing-page-shell';
import { HandDrawnPromptSeoSection } from '@/components/handdrawn-prompt-seo-section';
import { ArcadePageWithHeaderSearch } from '@/components/arcade-page-with-header-search';
import { PromptGallery } from '@/components/prompt-gallery';
import type { LandingPageConfig } from '@/lib/landing-page-config';
import { getLandingCopy } from '@/lib/landing-copy';
import {
  getCanonicalUrl,
  getLandingLanguageSwitcherOptionsForRoute,
  getLanguageAlternates,
  getPromptApiPath,
  getPublicAssetPath,
  type LandingLanguage,
} from '@/lib/landing-language';
import { getLandingPromptsPage, type PromptGalleryItem } from '@/lib/notion-prompts';

type LandingPromptCopy = ReturnType<typeof getLandingCopy>[LandingPageConfig['copyKey']];

/**
 * 生成某个 landing page 的 metadata。
 * 这个方法被默认页和语言页的 Next.js metadata pipeline 调用；
 * canonicalLanguage 为 null 时代表无语言后缀默认页，显式语言页则使用 `/{lan}` URL。
 */
export async function generateLandingPromptsMetadata(
  config: LandingPageConfig,
  language: LandingLanguage,
  canonicalLanguage: LandingLanguage | null,
): Promise<Metadata> {
  const copy = getLandingCopy(language)[config.copyKey];
  const canonicalUrl = getCanonicalUrl(config.routeSlug, canonicalLanguage);

  return {
    title: copy.seo.title,
    description: copy.seo.description,
    keywords: copy.seo.keywords,
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical: canonicalUrl,
      languages: getLanguageAlternates(config.routeSlug, config.supportedLanguages),
    },
    openGraph: {
      title: copy.seo.title,
      description: copy.seo.description,
      type: 'website',
      url: canonicalUrl,
    },
    twitter: {
      card: 'summary_large_image',
      title: copy.seo.title,
      description: copy.seo.description,
    },
  };
}

/**
 * 生成结构化数据。
 * CollectionPage 继续暴露首屏 prompt 列表，FAQPage 则按当前 landing page 的 guide 文案输出主题问答，
 * 让搜索引擎理解这条路由既是 gallery，也是围绕具体模型/工具的专题内容页。
 */
function buildStructuredData(
  items: PromptGalleryItem[],
  canonicalUrl: string,
  copy: LandingPromptCopy,
  language: LandingLanguage,
) {
  const collectionPage = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: copy.title,
    inLanguage: language,
    url: canonicalUrl,
    description: copy.seo.description,
    keywords: copy.seo.keywords,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: items.slice(0, 12).map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.title,
        description: item.prompt,
        url: item.sourceUrl || canonicalUrl,
      })),
    },
  };

  const faqPage = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: language,
    name: copy.seoGuide.title,
    description: copy.seo.description,
    mainEntity: copy.seoGuide.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };

  return [collectionPage, faqPage];
}

/**
 * 渲染指定 landing page。
 * 这个服务端组件是所有 route slug 与语言路由的共同入口；它读取 landing prompt read model 后生成首屏 gallery，
 * 再按视觉变体选择 page shell、toolbar/card/lightbox 组合，保证“同一数据链路，不同落地页风格”。
 * `sharedPromptId` 命中时会额外并行拉一份默认 all 首屏，
 * 是为了让 `?id=` 分享链接首屏就能直达单卡，同时用户切回 All 时还能立即恢复默认列表，而不是把单卡结果误当成默认首屏。
 */
export async function renderLandingPromptsPage({
  config,
  language,
  canonicalLanguage = language,
  sharedPromptId = null,
}: {
  config: LandingPageConfig;
  language: LandingLanguage;
  canonicalLanguage?: LandingLanguage | null;
  sharedPromptId?: string | null;
}) {
  await connection();

  const copy = getLandingCopy(language)[config.copyKey];
  const [initialPage, unfilteredInitialPage] = sharedPromptId
    ? await Promise.all([
        getLandingPromptsPage({ sourceSlug: config.sourceSlug, language, id: sharedPromptId }),
        getLandingPromptsPage({ sourceSlug: config.sourceSlug, language }),
      ])
    : [await getLandingPromptsPage({ sourceSlug: config.sourceSlug, language }), null];
  const languageOptions = getLandingLanguageSwitcherOptionsForRoute(config.routeSlug, language, config.supportedLanguages);
  const canonicalUrl = getCanonicalUrl(config.routeSlug, canonicalLanguage);
  /* lede、eyebrow、marginNote 是 F2 Editorial 新增的可选 copy key；
   * handdrawn shell 使用 seo.description 作为 lede，Editorial shell 使用 copy.lede；
   * 如果语言文件未包含这些 key，安全回退到 null，不渲染对应区块。 */
  const copyWithOptionals = copy as typeof copy & {
    lede?: string;
    eyebrow?: string;
    marginNote?: string;
  };
  const shellProps = {
    navigationLabel: copy.navigationLabel,
    brandAria: copy.brandAria,
    logoSrc: getPublicAssetPath('/logo/kollab-logo.svg'),
    languageLabel: copy.language.label,
    currentLanguage: language,
    languageOptions,
    title: copy.title,
    lede: config.visualVariant === 'handdrawn' ? copy.seo.description : (copyWithOptionals.lede ?? null),
    eyebrow: config.visualVariant === 'handdrawn' ? null : (copyWithOptionals.eyebrow ?? null),
    marginNote: config.visualVariant === 'handdrawn' ? null : (copyWithOptionals.marginNote ?? null),
  };

  const gallery = (
    <PromptGallery
      variant={config.visualVariant}
      promptCommand={config.promptCommand}
      initialPage={initialPage}
      defaultPage={unfilteredInitialPage || initialPage}
      apiPath={getPromptApiPath(config.routeSlug)}
      language={language}
      copy={{
        galleryLabel: copy.galleryLabel,
        toolbarLabel: copy.toolbarLabel,
        search: copy.search,
        filtersLabel: copy.filtersLabel,
        allTagsLabel: copy.allTagsLabel,
        latestTagLabel: copy.latestTagLabel,
        tagLabels: copy.tagLabels,
        empty: copy.empty,
        actions: copy.actions,
        images: copy.images,
        sections: 'sections' in copy ? copy.sections : undefined,
        loadMore: copy.loadMore,
      }}
    />
  );

  return (
    <main lang={language}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildStructuredData(initialPage.items, canonicalUrl, copy, language)) }} />
      {config.visualVariant === 'handdrawn' ? (
        <HandDrawnLandingPageShell {...shellProps}>
          {gallery}
          <HandDrawnPromptSeoSection copy={copy.seoGuide} />
        </HandDrawnLandingPageShell>
      ) : (
        // arcade 变体：ArcadePageWithHeaderSearch 是客户端包裹层，
        // 它调用 usePromptGalleryRouteState 后把 header 搜索 props 注入 LandingPageShell，
        // 保证 header 搜索框与 gallery toolbar 绑定同一 URL ?q= 真相。
        <ArcadePageWithHeaderSearch
          shellProps={shellProps}
          searchCopy={copy.search}
          seoSection={<GptImagePromptsSeoSection copy={copy.seoGuide} />}
        >
          {gallery}
        </ArcadePageWithHeaderSearch>
      )}
    </main>
  );
}
