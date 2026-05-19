/**
 * landing-copy.ts 负责按 landing route language 读取本应用自己的 locale JSON。
 * 它位于 landing-pages 的服务端文案层，被 metadata、页面 shell 和客户端按钮标签共用。
 * 这个独立落地页使用本地 locale JSON，不依赖原 monorepo 的共享 i18n 包。
 * 英文资源同时充当新增页面的兜底基线：其它语言暂未补齐某个新页面时，页面仍能完整渲染，
 * 只是暂时回落到英文文案，而不会因为缺 key 直接渲染空白区块。
 * `eyebrow`、`lede`、`marginNote` 是 F2 Editorial 设计新增的可选 copy key，
 * 它们在 locale JSON 里是可选字段；landing-prompts-page 读取时做 null 兜底，
 * 保证旧语言文件或未升级路由不因 key 缺失而抛错。
 */
import deLandingCopy from '@/locales/de/landing-pages.json';
import enLandingCopy from '@/locales/en/landing-pages.json';
import frLandingCopy from '@/locales/fr/landing-pages.json';
import jaLandingCopy from '@/locales/ja/landing-pages.json';
import koLandingCopy from '@/locales/ko/landing-pages.json';
import ptBRLandingCopy from '@/locales/pt-BR/landing-pages.json';
import ruLandingCopy from '@/locales/ru/landing-pages.json';
import zhCNLandingCopy from '@/locales/zh-CN/landing-pages.json';
import zhTWLandingCopy from '@/locales/zh-TW/landing-pages.json';
import { DEFAULT_LANDING_LANGUAGE, type LandingLanguage } from '@/lib/landing-language';

export type LandingPagesResources = typeof enLandingCopy;
export type LandingPageCopyKey = keyof LandingPagesResources;

const landingCopyByLanguage = {
  en: enLandingCopy,
  'zh-CN': zhCNLandingCopy,
  'zh-TW': zhTWLandingCopy,
  ja: jaLandingCopy,
  ko: koLandingCopy,
  fr: frLandingCopy,
  de: deLandingCopy,
  ru: ruLandingCopy,
  'pt-BR': ptBRLandingCopy,
} satisfies Record<LandingLanguage, Partial<LandingPagesResources>>;

/**
 * 按路由语言读取当前落地页文案。
 * 这个方法被默认页和 `/{lan}` 语言页共同调用；默认值仍是英文，
 * 是为了保留无语言后缀的历史 SEO 路由，同时让显式语言页只通过 route segment 切换资源。
 * 这里做浅合并而不是要求所有语言文件和英文资源 100% 同步，
 * 是为了让新落地页先上线英文和同步链路，再逐步补齐其它语言文案。
 */
export function getLandingCopy(language: LandingLanguage = DEFAULT_LANDING_LANGUAGE): LandingPagesResources {
  return {
    ...enLandingCopy,
    ...landingCopyByLanguage[language],
  };
}
