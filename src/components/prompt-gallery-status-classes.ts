/**
 * prompt-gallery-status-classes.ts 保存 GPT Image 2 arcade gallery 加载、空态和重试状态样式。
 * 它位于 landing-pages 的展示层，被 PromptGallery 的状态反馈区域使用。
 * 当前实现遵循 "Atelier Editorial" 风格：hairline 边框、paper-soft 背景、ink-secondary 文字、
 * 重试按钮使用 marker 橙色。
 * handdrawn 变体有独立的 handdrawn-prompt-gallery-status-classes.ts，互不干扰。
 */

export const promptGalleryStatusClasses = {
  /** 状态区域外层：让 sentinel 元素有最小高度，方便 IntersectionObserver 触发 */
  galleryStatusWrap:
    'mx-auto mt-6 flex min-h-[88px] w-[min(1240px,calc(100%-112px))] items-center justify-center max-[900px]:w-[min(1240px,calc(100%-48px))] max-[480px]:w-[min(1240px,calc(100%-32px))]',

  /** 状态文字：Source Serif 4 正文，ink-secondary，轻量 hairline 边框 */
  galleryStatusFrame:
    'inline-flex min-h-[44px] items-center justify-center border border-[var(--hairline)] bg-[var(--paper-soft)] px-5 text-center text-[13px] leading-[1.4] text-[var(--ink-secondary)] font-[var(--font-serif-body),Georgia,serif] max-[640px]:min-h-[40px] max-[640px]:px-4 max-[640px]:text-[12px]',

  /** 重试按钮：marker 橙色底色，ink-primary 文字，hover 微抬 */
  galleryStatusButton:
    'inline-flex min-h-[44px] items-center justify-center border border-[var(--marker)] bg-[var(--marker)] px-5 text-[13px] font-medium text-white transition-transform duration-200 hover:-translate-y-px cursor-pointer max-[640px]:min-h-[40px] max-[640px]:px-4 max-[640px]:text-[12px]',
};
