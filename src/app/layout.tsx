/**
 * layout.tsx 定义 landing-pages 独立 Next 应用的根布局。
 * 它位于 App Router 根层，被所有落地页共享。
 * 当前承载 "Atelier Editorial / Refined Marker" 字体系统：
 *   - Fraunces：展示字体（可变轴 opsz/wght/SOFT），用于品牌标志、H1、H2 和 CTA
 *   - Source Serif 4：正文字体（可变轴 opsz/wght），用于段落、lede 和卡片 prompt 正文
 *   - JetBrains Mono：等宽标签，用于 eyebrow、caption、footer meta 等固定宽度元数据
 *   - Caveat：手写风格注脚，受限使用（≤4 处语义位置），用于 marginNote、card № 索引、
 *             tip 序号和 pull-quote
 *   - Kalam / Patrick_Hand：保留用于 handdrawn-* 组件，不在 GPT Image 2 页使用
 * 首帧脚本在 hydration 前修正根节点语言属性，避免多语言页依赖 <main lang> 局部补救。
 */
import type { ReactNode } from 'react';
import { Caveat, Fraunces, JetBrains_Mono, Kalam, Patrick_Hand, Source_Serif_4 } from 'next/font/google';

import { AnalyticsBody, AnalyticsHead } from '@/components/analytics';
import { getPublicAssetPath } from '@/lib/landing-language';
import './globals.css';

const kollabFaviconPath = getPublicAssetPath('/logo/kollab-logo-logomark.png');

export const metadata = {
  icons: {
    icon: kollabFaviconPath,
    shortcut: kollabFaviconPath,
    apple: kollabFaviconPath,
  },
};

/* ── 展示字体：Fraunces 可变字体，覆盖 opsz/wght/SOFT 轴 ── */
const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz', 'SOFT'],
  variable: '--font-fraunces',
  display: 'swap',
});

/* ── 正文字体：Source Serif 4 可变字体 ── */
const sourceSerif4 = Source_Serif_4({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-serif-body',
  display: 'swap',
});

/* ── 等宽标签：JetBrains Mono，用于 eyebrow / caption / footer ── */
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

/* ── 手写注脚：Caveat，受限使用，仅 marginNote / card index / tip num / pullquote ── */
const caveat = Caveat({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-caveat',
  display: 'swap',
});

/* ── 保留：handdrawn-* 组件专用字体，GPT Image 2 页不使用 ── */
const kalam = Kalam({ subsets: ['latin'], weight: ['700'], variable: '--font-handwritten-heading' });
const patrickHand = Patrick_Hand({ subsets: ['latin'], weight: '400', variable: '--font-handwritten-body' });

const supportedLanguages = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'ru', 'pt-BR'] as const;

const rootLangInitScript = `
(() => {
  try {
    const routeLanguage = ${JSON.stringify(supportedLanguages)}.find((language) =>
      window.location.pathname.split('/').filter(Boolean).includes(language)
    ) || 'en';
    document.documentElement.lang = routeLanguage;
  } catch {
    document.documentElement.lang = 'en';
  }
})();
`;

/**
 * 渲染根 HTML 布局。
 * 这个函数被 Next.js App Router 调用；SSR HTML 保留默认英文语言属性，
 * 首帧脚本会按当前路由把 `<html lang>` 修正到 landing language。
 * data-theme="light" 与 Editorial 设计系统一致；handdrawn shell 不依赖此属性。
 * suppressHydrationWarning 容忍首屏脚本在 React hydration 前修正根节点语言属性。
 * body 上的字体变量 class 将 Google Font token 暴露给全局 CSS 和 Tailwind 主题层。
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: rootLangInitScript }} />
        {/* AnalyticsHead 渲染 GTM、GA4、Ahrefs、Clarity 内联脚本；
            组件内部 guard 在缺少 env 时返回 null，本地开发不会产生任何输出。 */}
        <AnalyticsHead />
      </head>
      <body
        className={`${fraunces.variable} ${sourceSerif4.variable} ${jetbrainsMono.variable} ${caveat.variable} ${kalam.variable} ${patrickHand.variable}`}
      >
        {/* AnalyticsBody 渲染 Firebase、Mixpanel runtime 和 GTM noscript iframe；
            同样由组件内部 guard 保护，env 缺失时 no-op。 */}
        <AnalyticsBody />
        {children}
      </body>
    </html>
  );
}
