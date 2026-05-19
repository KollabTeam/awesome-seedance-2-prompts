'use client';

/**
 * handdrawn-landing-page-shell.tsx 渲染 Seedance 等手绘风格落地页的页头与 hero。
 * 它位于 landing-pages 的客户端展示层，被服务端页面注入文案、语言选项和 gallery 子树；
 * 手绘页面单独使用这层纸张质感壳子，是为了让新落地页彻底脱离 GPT Image 的 neon arcade 视觉，
 * 同时继续复用同一套语言切换与服务端数据装配链路。
 */
import type { ReactNode } from 'react';

import { type LandingLanguageSelectOption, LanguageSelect } from '@/components/language-select';
import type { LandingLanguage } from '@/lib/landing-language';

type HandDrawnLandingPageShellProps = {
  navigationLabel: string;
  brandAria: string;
  logoSrc: string;
  languageLabel: string;
  currentLanguage: LandingLanguage;
  languageOptions: LandingLanguageSelectOption[];
  title: string;
  lede: string | null;
  children: ReactNode;
};

const wobbleLg = '255px 15px 225px 15px / 15px 225px 15px 255px';
const wobbleMd = '24px 18px 28px 16px / 18px 30px 18px 26px';

/**
 * 组合手绘 landing page 的稳定展示壳层。
 * 这个组件只消费服务端已经准备好的 props，不再持有第二份页面数据；
 * 纸张背景、便签式 hero 和略带倾斜的 header 都集中在这里，
 * 是为了让 Seedance 页面从第一屏开始就建立“草稿本/分镜墙”氛围，而不是继续沿用 dark 控制台布局。
 */
export function HandDrawnLandingPageShell({
  navigationLabel,
  brandAria,
  logoSrc,
  languageLabel,
  currentLanguage,
  languageOptions,
  title,
  lede,
  children,
}: HandDrawnLandingPageShellProps) {
  return (
    <div
      className="min-h-screen px-4 py-4 text-[#2d2d2d] max-[640px]:px-3"
      style={{
        backgroundColor: '#fdfbf7',
        backgroundImage: 'radial-gradient(#e5e0d8 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <header className="sticky top-0 z-20 mx-auto w-[min(94vw,1240px)] pt-1" aria-label={navigationLabel}>
        <div
          className="flex items-center justify-between gap-3 border-[3px] border-[#2d2d2d] bg-[#fffdf9] px-4 py-3 shadow-[4px_4px_0px_0px_#2d2d2d] max-[640px]:px-3"
          style={{ borderRadius: wobbleMd, transform: 'rotate(-0.8deg)' }}
        >
          <a className="inline-flex items-center gap-3" href="https://kollab.im" aria-label={brandAria}>
            <img src={logoSrc} alt=""  />
          </a>
          <div className="relative text-[#2d2d2d]">
            <LanguageSelect
              className="h-[44px] w-[170px] appearance-none border-[3px] border-[#2d2d2d] bg-white pl-4 pr-10 text-[14px] font-bold text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] outline-none max-[640px]:w-[138px] max-[640px]:pl-3"
              label={languageLabel}
              currentLanguage={currentLanguage}
              options={languageOptions}
              variant="handdrawn"
            />
          </div>
        </div>
      </header>

      <section className="mx-auto mt-6 grid w-[min(94vw,1240px)] gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <div
          className="relative border-[3px] border-[#2d2d2d] bg-[#fffdf9] px-6 py-7 shadow-[8px_8px_0px_0px_#2d2d2d] max-[640px]:px-4 max-[640px]:py-5"
          style={{ borderRadius: wobbleLg, transform: 'rotate(-1.2deg)' }}
        >
          <h1
            className="m-0 text-[clamp(2.4rem,7vw,5rem)] leading-[0.95] text-[#2d2d2d]"
            style={{ fontFamily: 'var(--font-handwritten-heading)' }}
          >
            {title}
          </h1>
          <p
            className="mt-5 mb-0 max-w-[34rem] text-[22px] leading-[1.4] text-[#2d2d2d]/80 max-[640px]:text-[18px]"
            style={{ fontFamily: 'var(--font-handwritten-body)' }}
          >
            {lede}
          </p>
          <div className="pointer-events-none absolute -right-2 -top-2 hidden h-12 w-28 rotate-[12deg] border-[3px] border-dashed border-[#2d5da1] md:block" />
          <div className="pointer-events-none absolute -bottom-3 left-10 hidden h-5 w-32 rotate-[-8deg] bg-[#d9d9d9]/65 md:block" />
        </div>

        <aside
          className="relative border-[3px] border-[#2d2d2d] bg-[#fff9c4] px-5 py-5 shadow-[6px_6px_0px_0px_#2d2d2d]"
          style={{ borderRadius: wobbleMd, transform: 'rotate(1.1deg)' }}
        >
          <div className="grid gap-4">
            <div className="h-3 w-24 rotate-[-8deg] bg-[#d9d9d9]/75" />
            <div className="grid gap-3 border-t-[3px] border-dashed border-[#2d2d2d] pt-4">
              <div className="h-3 w-[82%] rounded-full bg-[#2d2d2d]/14" />
              <div className="h-3 w-[68%] rounded-full bg-[#2d2d2d]/14" />
              <div className="h-3 w-[74%] rounded-full bg-[#2d2d2d]/14" />
              <div className="h-3 w-[56%] rounded-full bg-[#2d2d2d]/14" />
            </div>
            <div className="relative mt-2 h-28 rounded-[20px] border-[3px] border-dashed border-[#2d2d2d] bg-white/55">
              <div className="absolute left-4 top-4 h-5 w-5 rounded-full border-[3px] border-[#ff4d4d]" />
              <div className="absolute right-6 top-8 h-9 w-20 rotate-[8deg] border-[3px] border-dashed border-[#2d5da1]" />
              <div className="absolute bottom-5 left-6 h-[3px] w-24 bg-[#2d2d2d]" />
              <div className="absolute bottom-9 left-6 h-[3px] w-16 bg-[#2d2d2d]" />
            </div>
          </div>
        </aside>
      </section>

      {children}
    </div>
  );
}
