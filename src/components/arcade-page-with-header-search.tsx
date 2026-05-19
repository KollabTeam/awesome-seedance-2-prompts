'use client';

/**
 * arcade-page-with-header-search.tsx 是 arcade landing page 的客户端包裹层。
 * 它位于 landing-pages 的客户端交互层，被 renderLandingPromptsPage（服务端）在 arcade 变体下渲染；
 * 职责是调用 usePromptGalleryRouteState 并把 searchInput/commitSearchInput 注入 LandingPageShell，
 * 让 header 搜索框与 gallery toolbar 搜索框共享同一 URL ?q= 真相，无需在服务端组件层持有搜索状态。
 *
 * 为什么单独拆出而不是在 LandingPageShell 内调 hook：
 * LandingPageShell 本身已是 'use client'，直接调 hook 可行，但会把 gallery 路由逻辑耦合进通用壳层，
 * 影响 handdrawn shell 等未来可能复用 shell 逻辑的变体；拆出包裹层让 shell 继续作受控展示组件。
 */
import type { ReactNode } from 'react';

import type { LandingLanguageSelectOption } from '@/components/language-select';
import { LandingPageShell } from '@/components/landing-page-shell';
import type { LandingLanguage } from '@/lib/landing-language';

import { usePromptGalleryRouteState } from './use-prompt-gallery-route-state';

/** LandingPageShell 所需的非搜索非 children props，由服务端算好后透传。 */
type ShellBaseProps = {
  navigationLabel: string;
  brandAria: string;
  logoSrc: string;
  languageLabel: string;
  currentLanguage: LandingLanguage;
  languageOptions: LandingLanguageSelectOption[];
  title: string;
  lede: string | null;
  eyebrow?: string | null;
  marginNote?: string | null;
};

type ArcadePageWithHeaderSearchProps = {
  shellProps: ShellBaseProps;
  /** copy.search（placeholder + label），由服务端注入保持 i18n 一致。 */
  searchCopy: { placeholder: string; label: string };
  /** SEO 区块（GptImagePromptsSeoSection），由服务端渲染后透传。 */
  seoSection: ReactNode;
  /** PromptGallery 子树。 */
  children: ReactNode;
};

/**
 * arcade landing page 客户端包裹层。
 * 这个组件持有 usePromptGalleryRouteState hook 调用，并将 searchInput/commitSearchInput
 * 以受控 headerSearch prop 的形式注入 LandingPageShell，
 * 同时将 children（PromptGallery）传递下去；gallery 内部的 hook 实例通过 gallery:statechange
 * 自定义事件与这里的 hook 实例保持同步，所以 header 与 toolbar 搜索框始终读取同一个值。
 */
export function ArcadePageWithHeaderSearch({ shellProps, searchCopy, seoSection, children }: ArcadePageWithHeaderSearchProps) {
  const { searchInput, commitSearchInput } = usePromptGalleryRouteState();

  return (
    <LandingPageShell
      {...shellProps}
      headerSearch={{
        value: searchInput,
        placeholder: searchCopy.placeholder,
        label: searchCopy.label,
        onChange: commitSearchInput,
      }}
    >
      {children}
      {seoSection}
    </LandingPageShell>
  );
}
