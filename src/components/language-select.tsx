'use client';

/**
 * language-select.tsx 管理 landing-pages 页头的语言切换下拉框。
 * 它位于 landing-pages 的客户端交互层，被共享页面 shell 注入语言路由选项和 className；
 * 用单个语言触发器承载所有翻译入口，是为了避免 9 个语言链接在页头直接铺开挤占品牌区域，
 * 同时让选择器样式不再反向依赖整页壳层模块，减少壳层样式微调时的共同失效范围。
 * 这里不再使用原生 select，是因为浏览器原生 option 面板几乎不能稳定跟随页面视觉定制，
 * 展开后会立刻跳回系统默认样式，破坏 landing page 的整体风格一致性。
 */
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';

import type { LandingLanguage } from '@/lib/landing-language';

import { cn } from './class-name-utils';

export type LandingLanguageSelectOption = {
  code: LandingLanguage;
  label: string;
  href: string;
  isActive: boolean;
};

type LanguageSelectVariant = 'arcade' | 'handdrawn' | 'editorial';

type LanguageSelectProps = {
  className: string;
  label: string;
  currentLanguage: LandingLanguage;
  options: LandingLanguageSelectOption[];
  variant: LanguageSelectVariant;
};

export const languageSelectVariantClasses = {
  /** editorial 变体：hairline 边框下拉面板，Source Serif 4 选项文字，无饱和色 */
  editorial: {
    panel:
      'absolute right-0 top-[calc(100%+8px)] z-40 w-max min-w-[180px] max-w-[min(88vw,240px)] overflow-hidden border border-[var(--hairline)] bg-[var(--paper)] shadow-[0_4px_16px_rgba(26,22,16,0.10)]',
    option:
      'flex w-full cursor-pointer items-center justify-between gap-3 border-b border-[var(--hairline)] px-4 py-3 text-left text-[13px] font-[var(--font-serif-body),Georgia,serif] text-[var(--ink-primary)] transition-colors duration-150 hover:bg-[var(--paper-soft)] last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--marker)]',
    optionIdle: 'bg-[var(--paper)]',
    optionActive: 'bg-[var(--paper-soft)] font-medium',
    optionCode: 'text-[10px] tracking-[0.1em] text-[var(--ink-secondary)]',
    icon: 'text-[var(--ink-secondary)]',
  },
  arcade: {
    panel:
      'absolute right-0 top-[calc(100%+12px)] z-40 w-max min-w-[190px] max-w-[min(88vw,240px)] overflow-hidden rounded-[26px] border-4 border-[var(--accent-cyan)] bg-[linear-gradient(180deg,rgba(8,11,24,0.98),rgba(18,22,44,0.98))] p-2 shadow-[var(--shadow-panel),0_0_28px_rgba(0,245,212,0.16)] backdrop-blur-xl',
    option:
      'flex w-full cursor-pointer items-center justify-between gap-3 rounded-full border-2 px-3.5 py-3 text-left text-[12px] font-black tracking-[0.08em] text-[var(--ink)] transition-all duration-200 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-yellow)] max-[640px]:px-3 max-[640px]:py-2.5 max-[640px]:text-[11px]',
    optionIdle:
      'border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] hover:border-[var(--accent-orange)] hover:bg-[rgba(255,255,255,0.08)]',
    optionActive: 'border-[var(--accent-cyan)] bg-verdigris text-black shadow-[0_0_0_2px_rgba(0,245,212,0.14)]',
    optionCode: 'text-[10px] tracking-[0.12em] text-current/65',
    icon: 'text-[var(--accent-cyan)]',
  },
  handdrawn: {
    panel:
      'absolute right-0 top-[calc(100%+12px)] z-40 w-max min-w-[190px] max-w-[min(88vw,240px)] rounded-[24px] border-[3px] border-[#2d2d2d] bg-[#fffdf9] p-2 shadow-[4px_4px_0px_0px_#2d2d2d]',
    option:
      'flex w-full cursor-pointer items-center justify-between gap-3 rounded-[18px] border-[3px] px-3.5 py-3 text-left text-[13px] font-bold text-[#2d2d2d] transition-transform duration-200 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d5da1] max-[640px]:px-3 max-[640px]:py-2.5 max-[640px]:text-[12px]',
    optionIdle: 'border-[#2d2d2d] bg-white hover:bg-[#fff6cc]',
    optionActive: 'border-[#2d2d2d] bg-[#fff1a8] shadow-[3px_3px_0px_0px_#2d2d2d]',
    optionCode: 'text-[10px] tracking-[0.1em] text-[#2d2d2d]/55',
    icon: 'text-[#2d2d2d]',
  },
} satisfies Record<
  LanguageSelectVariant,
  {
    panel: string;
    option: string;
    optionIdle: string;
    optionActive: string;
    optionCode: string;
    icon: string;
  }
>;

// 确保 LanguageSelectVariant 完整包含 editorial 变体，方便 shell 组件按名字传入

/**
 * 渲染语言切换下拉框。
 * 这个组件被服务端 page shell 调用，作为各视觉壳层 header 右侧的单一语言入口；
 * 服务端仍负责生成 canonical/alternate 和 href，客户端只在用户确认某个语言项后跳转到对应语言路径，
 * 避免在服务端组件里绑定事件处理器，也避免把多语言链接重新铺回 sticky header。
 * 选择器 trigger 样式继续由外层 shell 通过 className 显式传入，但展开面板在组件内按 variant 补齐，
 * 是为了让“关闭态”和“展开态”都共享同一套页面风格，而不是只给 trigger 套皮后让 option 掉回系统 UI。
 */
export function LanguageSelect({ className, label, currentLanguage, options, variant }: LanguageSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.code === currentLanguage) ?? options[0];
  const variantClasses = languageSelectVariantClasses[variant];

  const closeMenuOnOutsidePointerDown = useEffectEvent((event: PointerEvent) => {
    if (!containerRef.current?.contains(event.target as Node)) {
      setIsOpen(false);
    }
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    document.addEventListener('pointerdown', closeMenuOnOutsidePointerDown);

    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsidePointerDown);
    };
  }, [closeMenuOnOutsidePointerDown, isOpen]);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={cn(className, 'inline-flex items-center text-left')}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={popoverId}
        onClick={() => {
          setIsOpen((open) => !open);
        }}
      >
        <span className="truncate pr-2">{selectedOption?.label ?? currentLanguage}</span>
      </button>
      <svg
        className={cn(
          'pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 transition-transform duration-200 max-[640px]:right-3.5 max-[640px]:h-3.5 max-[640px]:w-3.5',
          isOpen && 'rotate-180',
          variantClasses.icon,
        )}
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <path d="m3.5 6 4.5 4 4.5-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
      {isOpen ? (
        <div id={popoverId} role="listbox" aria-label={label} className={variantClasses.panel}>
          <div className="grid gap-1.5">
            {options.map((option) => (
              <button
                key={option.code}
                type="button"
                role="option"
                aria-selected={option.isActive}
                className={cn(
                  variantClasses.option,
                  option.isActive ? variantClasses.optionActive : variantClasses.optionIdle,
                )}
                onClick={() => {
                  // 当前语言只关闭面板，不重复触发导航，避免首屏内容无意义重载。
                  if (option.isActive) {
                    setIsOpen(false);
                    return;
                  }

                  window.location.assign(option.href);
                }}
              >
                <span className="truncate">{option.label}</span>
                <span className={variantClasses.optionCode}>{option.code}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
