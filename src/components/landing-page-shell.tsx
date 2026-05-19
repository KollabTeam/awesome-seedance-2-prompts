'use client';

/**
 * landing-page-shell.tsx 渲染 GPT Image 2 landing page 的页头、hero、正文区和页脚。
 * 它位于 landing-pages 的客户端展示层，被服务端页面注入已算好的文案、语言选项和首屏 gallery 子树。
 * 当前实现遵循 "Atelier Editorial" 设计系统：
 *   - header：hairline 下边框，品牌 Fraunces italic 文字（非 logo 图片），JetBrains Mono 语言选择器
 *   - hero：非对称两列网格，eyebrow + star doodle，H1 第二行有 marker SVG 下划线，
 *           右侧 Caveat marginNote + curved-arrow doodle，Source Serif 4 lede
 *   - footer：虚线 SVG 装饰线，三列布局（品牌 / 常青藤 ❋ 装饰 / mono 元数据）
 * lede 和 eyebrow 从 copy prop 读取；若上游未传，eyebrow 和 marginNote 优雅降级为空，
 * lede 则回退到 null（不渲染段落），保证旧路由不因新 key 缺失而抛错。
 */
import type { ReactNode } from 'react';

import { type LandingLanguageSelectOption, LanguageSelect } from '@/components/language-select';
import { MARKER_UNDERLINE_SVG, pageShellClasses } from '@/components/page-shell-classes';
import type { LandingLanguage } from '@/lib/landing-language';

/**
 * header 搜索框的受控 prop bundle，由调用方（arcade wrapper）注入；
 * shell 本身不持有搜索状态，只负责渲染和派发 onChange，
 * 是为了让 header 和 gallery toolbar 的输入框绑定同一个上游真相（URL ?q=）。
 * arcade-only：handdrawn shell 不使用这个 prop。
 */
type HeaderSearchProps = {
  value: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
};

type LandingPageShellProps = {
  navigationLabel: string;
  brandAria: string;
  /** Kollab wordmark SVG 路径，由服务端注入；header 用它渲染 logo 图片，链接到 /product。 */
  logoSrc: string;
  languageLabel: string;
  currentLanguage: LandingLanguage;
  languageOptions: LandingLanguageSelectOption[];
  title: string;
  /** lede 现在从 copy.lede 读取；null 时不渲染 lede 段落。 */
  lede: string | null;
  /** eyebrow 是 JetBrains Mono 小号元数据行（如 "Issue 02 · Curated GPT Image 2 prompts · 2026"）。 */
  eyebrow?: string | null;
  /** marginNote 是右侧 Caveat 手写注脚（如 "Hand-picked →"）。 */
  marginNote?: string | null;
  /**
   * header 右侧搜索框，只在 arcade 变体启用；不传时不渲染搜索区域。
   * 搜索状态由外层 ArcadePageWithHeaderSearch 持有（通过 usePromptGalleryRouteState），
   * shell 接收 value/onChange 作为受控组件。
   */
  headerSearch?: HeaderSearchProps;
  children: ReactNode;
};

/**
 * 渲染 Editorial 风格的 landing page 壳层。
 * 这个组件被服务端页面调用，用来承接 header、hero 和 footer；
 * 服务端负责多语言文案和首屏数据，客户端壳层只消费已准备好的 props，不持有第二份数据真相。
 * header 品牌区渲染 Fraunces italic 文字 "Kollab" 而非 logo 图片，
 * 是为了与页面整体的书版文字质感保持统一，同时保留 brandAria 无障碍标签。
 * hero 的两列网格故意不设 min-height，遵循用户批准的手改 padding token（56px 0 64px 桌面），
 * 让页面首屏高度随内容自然流动，而不是强制固定视口百分比。
 * footer 附着在 LandingPageShell 内，而不是全局 layout，因为 handdrawn shell 有自己的页脚。
 */
export function LandingPageShell({
  navigationLabel,
  brandAria,
  logoSrc,
  languageLabel,
  currentLanguage,
  languageOptions,
  title,
  lede,
  eyebrow,
  marginNote,
  headerSearch,
  children,
}: LandingPageShellProps) {
  /* 把 H1 按换行语义拆分成两个 <span class="line">：
   * 第一行是主要名词（如 "GPT Image 2"），第二行包含 marker 下划线高亮词。
   * 这里通过 / 分隔符把 title 劈成两段；如果标题没有 /，整段都进第二行并加下划线。
   * 分隔符约定由 copy.title 编写者控制，不在组件层硬编码语言规则。 */
  const titleParts = title.split(' / ');
  const titleLine1 = titleParts.length > 1 ? titleParts[0] : null;
  const titleLine2 = titleParts.length > 1 ? titleParts.slice(1).join(' / ') : title;

  return (
    <>
      {/* ── 页头：hairline 下边框 ── */}
      <header className={pageShellClasses.header} aria-label={navigationLabel}>
        <div className={pageShellClasses.headerInner}>
          {/* 品牌区：Kollab wordmark SVG。点击回流到官网产品页 /product，
            * 用 logoSrc 这个已有 prop 而不是写死路径，让 server 端可以按变体替换 logo 文件。 */}
          <a className={pageShellClasses.brandLink} href="https://kollab.im/product" aria-label={brandAria}>
            <img className={pageShellClasses.brandLogo} src={logoSrc} alt="Kollab" width="148" height="40" />
          </a>

          {/* 右侧动作组：搜索框 + 语言切换。
            * 用一个 flex 容器把它们打包到 header 右侧；headerInner 的 justify-between 才能
            * 把 logo 推到左边、整组推到右边，否则三个子元素会被均分到 left/center/right。 */}
          <div className={pageShellClasses.headerActions}>
            {/* header 搜索框：arcade 专用，桌面 ~220px、tablet ~180px、移动端隐藏（工具栏搜索覆盖移动入口）。
              * 搜索框与 gallery toolbar 搜索框绑定同一 URL ?q= 真相，两者保持实时同步。
              * 不传 headerSearch 时不渲染，不影响 handdrawn 变体。 */}
            {headerSearch ? (
              <div className={pageShellClasses.headerSearchWrap}>
                <svg className={pageShellClasses.headerSearchIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="10.8" cy="10.8" r="6.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="m16 16 4.4 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <input
                  className={pageShellClasses.headerSearchInput}
                  type="search"
                  value={headerSearch.value}
                  placeholder={headerSearch.placeholder}
                  aria-label={headerSearch.label}
                  onChange={(e) => headerSearch.onChange(e.target.value)}
                />
              </div>
            ) : null}

            {/* 语言选择器：editorial 变体，hairline 下边框触发器 + 纸质感下拉面板 */}
            <div className={pageShellClasses.languageSelectWrap} aria-label={languageLabel}>
              <LanguageSelect
                className={pageShellClasses.languageSelect}
                label={languageLabel}
                currentLanguage={currentLanguage}
                options={languageOptions}
                variant="editorial"
              />
            </div>
          </div>
        </div>
      </header>

      {/* ── Hero：非对称两列，eyebrow + H1 + marginNote + lede ── */}
      <section className={pageShellClasses.hero}>
        <div className={pageShellClasses.heroGrid}>
          {/* 左列：eyebrow + H1 */}
          <div>
            {eyebrow ? (
              <p className={pageShellClasses.eyebrow}>
                {eyebrow}
                {/* 星形 doodle：marker 橙色，不被屏幕阅读器读取 */}
                <svg width="15" height="15" viewBox="0 0 18 18" aria-hidden="true" className="flex-none">
                  <path
                    d="M9.2 1.5 11 6.8l5.1.7-4.1 3.1 1.2 5-4.1-3.1-4.6 2.7 1.8-4.8-4-3.7 5.1.2Z"
                    fill="none"
                    stroke="#D2502A"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </p>
            ) : null}

            <h1 className={pageShellClasses.title}>
              {titleLine1 ? (
                <span className={pageShellClasses.titleLine}>{titleLine1}</span>
              ) : null}
              {/* 第二行加 titleLineOffset 让 marker 下划线那一行向右轻微错位，
                * 形成 editorial 风格的左右错落感；当 title 没有 ` / ` 分隔符时只渲染这一行，
                * 此时整段标题居左，offset 会让单段标题相对 eyebrow 也有一点缩进，仍符合排版节奏。 */}
              <span className={`${pageShellClasses.titleLine} ${pageShellClasses.titleLineOffset}`}>
                {/* marker 下划线 span：使用 SVG background-image，跟随文字宽度而不是容器宽度 */}
                <span
                  className={pageShellClasses.titleMarker}
                  style={{
                    backgroundImage: MARKER_UNDERLINE_SVG,
                  }}
                >
                  {titleLine2}
                </span>
              </span>
            </h1>
          </div>

          {/* 右列：marginNote + curved-arrow doodle + lede */}
          <div className={pageShellClasses.heroCopy}>
            {marginNote ? (
              <div className={pageShellClasses.noteRow} aria-hidden="true">
                <span className={pageShellClasses.heroNote}>{marginNote}</span>
                {/* Curved arrow doodle：与 mockup 笔触一致，视觉装饰不参与语义 */}
                <svg width="42" height="25" viewBox="0 0 58 34" aria-hidden="true" style={{ transform: 'translateY(5px)' }}>
                  <path d="M3 7 C18 2 34 7 42 20 C45 25 43 29 38 30" fill="none" stroke="#D2502A" strokeWidth="2" strokeLinecap="round" />
                  <path d="M38 30 C42 27 45 24 48 20" fill="none" stroke="#D2502A" strokeWidth="2" strokeLinecap="round" />
                  <path d="M38 30 C43 31 48 31 53 29" fill="none" stroke="#D2502A" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            ) : null}
            {lede ? (
              <p className={pageShellClasses.lede}>{lede}</p>
            ) : null}
          </div>
        </div>

        {/* hero 底部 hairline 分隔线 */}
        <hr className={pageShellClasses.heroRule} />
      </section>

      {children}

      {/* ── 页脚：虚线装饰线 + 三列品牌/装饰/元数据 ── */}
      <footer className="pb-[46px]">
        <div className="mx-auto w-[min(1240px,calc(100%-112px))] max-[900px]:w-[min(1240px,calc(100%-48px))] max-[480px]:w-[min(1240px,calc(100%-32px))]">
          {/* 虚线 SVG 装饰线，模拟手绘撕边效果 */}
          <svg
            className="mb-[24px] w-full h-[18px] text-[var(--marker)]"
            viewBox="0 0 1240 18"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M4 10 C98 6 182 13 272 9 C367 5 461 12 555 9 C650 6 742 12 834 9 C930 6 1040 12 1236 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeDasharray="3 9"
            />
          </svg>
          <div className="grid [grid-template-columns:1fr_auto_1fr] gap-[28px] items-center max-[900px]:[grid-template-columns:1fr] max-[900px]:gap-[14px] max-[900px]:text-left">
            {/* 左：品牌 + 画廊名 */}
            <div
              className="font-[var(--font-fraunces)] text-[16px] italic font-[550] [font-variation-settings:'opsz'_72] text-[var(--ink-primary)]"
            >
              Kollab · 提示词画廊
            </div>
            {/* 中：常青藤 ❋ 装饰（窄屏隐藏） */}
            <div
              className="text-[var(--ivy)] font-[var(--font-fraunces)] text-[14px] max-[900px]:hidden"
              aria-hidden="true"
            >
              ❋
            </div>
            {/* 右：mono 元数据 */}
            <div
              className="justify-self-end text-[var(--ink-secondary)] font-[var(--font-mono)] text-[11px] font-medium tracking-[0.08em] leading-[1.4] max-[900px]:justify-self-start"
            >
              2026 · 每周更新 ·{' '}
              <a href="https://kollab.im" className="border-b border-[var(--hairline)] hover:border-[var(--ink-secondary)] transition-colors duration-200">
                kollab.im
              </a>{' '}
              <span className="text-[var(--marker)]">→</span>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
