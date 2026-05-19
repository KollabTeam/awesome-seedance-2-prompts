/**
 * landing-language.ts 管理 landing-pages 应用的语言路由、Notion prompt 字段和公开路径。
 * 它位于 landing-pages 的路由辅助层，被 App Router 页面、metadata、Notion 数据解析和页头语言切换共用；
 * 把 route slug、canonical、locale segment、静态资源前缀与 Notion `Prompt XX` 字段统一收口，
 * 是为了让多落地页复用同一套 URL/多语言规则，而不是每个页面再维护第二份路径约定。
 */
const Language = {
  EN: 'en',
  ZH: 'zh-CN',
  JA: 'ja',
  KO: 'ko',
} as const;

type UiLanguage = (typeof Language)[keyof typeof Language];

export const LANDING_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English', notionPromptProperty: 'Prompt EN', uiCopyLanguage: Language.EN },
  { code: 'zh-CN', label: '简体中文', notionPromptProperty: 'Prompt ZH-CN', uiCopyLanguage: Language.ZH },
  { code: 'zh-TW', label: '繁體中文', notionPromptProperty: 'Prompt ZH-TW', uiCopyLanguage: Language.ZH },
  { code: 'ja', label: '日本語', notionPromptProperty: 'Prompt JA', uiCopyLanguage: Language.JA },
  { code: 'ko', label: '한국어', notionPromptProperty: 'Prompt KO', uiCopyLanguage: Language.KO },
  { code: 'fr', label: 'Français', notionPromptProperty: 'Prompt FR', uiCopyLanguage: Language.EN },
  { code: 'de', label: 'Deutsch', notionPromptProperty: 'Prompt DE', uiCopyLanguage: Language.EN },
  { code: 'ru', label: 'Русский', notionPromptProperty: 'Prompt RU', uiCopyLanguage: Language.EN },
  { code: 'pt-BR', label: 'Português', notionPromptProperty: 'Prompt PT-BR', uiCopyLanguage: Language.EN },
] as const;

export type LandingLanguage = (typeof LANDING_LANGUAGE_OPTIONS)[number]['code'];

export const DEFAULT_LANDING_LANGUAGE: LandingLanguage = 'en';
export const DEFAULT_LANDING_ROUTE_SLUG = 'seedance-2-prompts';
export const LANDING_ASSET_PREFIX = (process.env.NEXT_PUBLIC_ASSET_PREFIX || '/landing-pages-static').replace(/\/$/, '');

const landingLanguageSet = new Set<string>(LANDING_LANGUAGE_OPTIONS.map((option) => option.code));

/**
 * 生成某个落地页的公开根路径。
 * 这个 helper 被页面路由、语言切换和分页 API 路径共用；
 * 独立 landing-pages 不再依赖单一 Next.js basePath，而是直接输出多个顶级 marketing 路由。
 */
export function getLandingRouteBasePath(routeSlug: string = DEFAULT_LANDING_ROUTE_SLUG): string {
  return `/${routeSlug.replace(/^\/+|\/+$/g, '')}`;
}

/**
 * 判断 route segment 是否是 landing page 支持的语言。
 * 这个方法被 `app/[lang]/[landingPageSlug]/page.tsx` 调用；不支持的 segment 直接 404，
 * 避免把任意路径都当成语言页面并产生重复 SEO URL。
 */
export function getLandingLanguageFromSegment(segment: string | undefined): LandingLanguage | null {
  if (!segment) {
    return null;
  }

  return landingLanguageSet.has(segment as LandingLanguage) ? (segment as LandingLanguage) : null;
}

/**
 * 返回当前 landing 语言可使用的 UI 文案语言。
 * 这个方法被 landing-copy 调用；Notion 已有的 prompt 翻译多于当前 UI 文案语言，
 * 所以法德俄葡等页面先回退英文 UI，但仍然展示对应 Notion prompt 字段。
 */
export function getLandingUiCopyLanguage(language: LandingLanguage): UiLanguage {
  return LANDING_LANGUAGE_OPTIONS.find((option) => option.code === language)?.uiCopyLanguage || Language.EN;
}

/**
 * 返回当前 landing 语言读取 Notion prompt 的候选字段。
 * 这个方法被数据解析层调用；先读对应翻译列，再回退英文翻译列，最后回退原始 `Prompt`，
 * 是为了让新增翻译不会因为单条记录漏翻而整张卡片消失。
 */
export function getLandingPromptPropertyCandidates(language: LandingLanguage): string[] {
  const translatedProperty = LANDING_LANGUAGE_OPTIONS.find((option) => option.code === language)?.notionPromptProperty || 'Prompt EN';
  return Array.from(new Set([translatedProperty, 'Prompt EN', 'Prompt']));
}

/**
 * 生成当前语言在公开站点下的 href。
 * 这个方法被页头语言切换调用；显式语言页使用 `/{lang}/{routeSlug}` 形态（lang 在前），
 * 同时保留无语言段的默认页作为 x-default。
 * lang 优先于 slug 是为了符合 /{locale}/{path} 的国际化惯例，也便于 CDN/ingress 按 lang prefix 做区域缓存。
 */
export function getLocalizedLandingHref(routeSlug: string, language: LandingLanguage): string {
  return `/${language}${getLandingRouteBasePath(routeSlug)}`;
}

/**
 * 生成 landing page 的 canonical URL。
 * 这个方法被 metadata 和结构化数据共用；默认页不带语言段（/slug），
 * 显式语言页使用 /{lang}/{slug} 形态（lang 在前），避免默认页和显式语言页互相抢 canonical。
 */
export function getCanonicalUrl(routeSlug: string, language: LandingLanguage | null): string {
  const basePath = getLandingRouteBasePath(routeSlug);
  return language ? `https://kollab.im/${language}${basePath}` : `https://kollab.im${basePath}`;
}

/**
 * 生成 metadata alternates.languages。
 * 这个方法被默认页和语言页共用；x-default 指向无语言默认页，
 * 每个显式语言都指向用户可直接切换的 `/{lan}` URL。
 * 支持语言从页面配置传入，是为了让文案未本地化的新落地页先只暴露英文，
 * 避免生成内容仍为英文的多语言 canonical 页面。
 */
export function getLanguageAlternates(routeSlug: string, supportedLanguages: LandingLanguage[] = LANDING_LANGUAGE_OPTIONS.map((option) => option.code)): Record<string, string> {
  const canonicalBaseUrl = getCanonicalUrl(routeSlug, null);
  return {
    'x-default': canonicalBaseUrl,
    ...Object.fromEntries(supportedLanguages.map((language) => [language, getCanonicalUrl(routeSlug, language)])),
  };
}

/**
 * 生成页头语言切换项。
 * 这个方法被页面 shell 调用；label 使用共享 i18n 包里的本地原生语言名，
 * 这样用户即使当前 UI 不是自己的语言，也能直接识别要切换到哪种语言。
 */
export function getLandingLanguageSwitcherOptions(currentLanguage: LandingLanguage): {
  code: LandingLanguage;
  label: string;
  href: string;
  isActive: boolean;
}[] {
  return LANDING_LANGUAGE_OPTIONS.map((option) => ({
    code: option.code,
    label: option.label,
    href: getLocalizedLandingHref(DEFAULT_LANDING_ROUTE_SLUG, option.code),
    isActive: option.code === currentLanguage,
  }));
}

/**
 * 生成某个指定落地页的语言切换项。
 * 这个 helper 被多 landing page 共享页面壳层调用；
 * route slug 与支持语言进入参数，是为了让 Seedance 等新页面复用同一套语言下拉组件，
 * 同时避免尚未翻译的页面在导航里暴露无效的语言入口。
 */
export function getLandingLanguageSwitcherOptionsForRoute(routeSlug: string, currentLanguage: LandingLanguage, supportedLanguages: LandingLanguage[] = LANDING_LANGUAGE_OPTIONS.map((option) => option.code)): {
  code: LandingLanguage;
  label: string;
  href: string;
  isActive: boolean;
}[] {
  const supportedLanguageSet = new Set(supportedLanguages);
  return LANDING_LANGUAGE_OPTIONS.filter((option) => supportedLanguageSet.has(option.code)).map((option) => ({
    code: option.code,
    label: option.label,
    href: getLocalizedLandingHref(routeSlug, option.code),
    isActive: option.code === currentLanguage,
  }));
}

/**
 * 生成 prompt 分页 API 的公开路径。
 * 这个 helper 被页面组件调用后传给客户端 gallery；route slug 在服务端集中读取，
 * 是为了避免浏览器相对路径在多 landing route 无尾斜杠路径下误解析到站点根路径。
 */
export function getPromptApiPath(routeSlug: string = DEFAULT_LANDING_ROUTE_SLUG): string {
  return `${getLandingRouteBasePath(routeSlug)}/api/prompts`;
}

/**
 * 生成当前 Next app public 目录资源路径。
 * 这个 helper 被页头品牌 logo 使用；public 资源不会自动继承 Next assetPrefix，
 * 因此这里手动复用同一个公开前缀，避免 logo 等资源请求落到 website 的根路径。
 */
export function getPublicAssetPath(pathname: string): string {
  return `${LANDING_ASSET_PREFIX}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}
