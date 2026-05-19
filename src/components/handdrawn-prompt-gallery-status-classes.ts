/**
 * handdrawn-prompt-gallery-status-classes.ts 保存手绘 landing page 的 gallery 状态样式。
 * 它位于 landing-pages 的展示层，被 PromptGallery 在 handdrawn 视觉分支下复用；
 * 单独拆文件是为了让状态条和重试按钮沿用手绘 token，而不把这些纸张样式塞回 arcade 模块。
 */
export const handDrawnPromptGalleryStatusClasses = {
  galleryStatusWrap: 'mx-auto mt-6 flex min-h-[88px] w-[min(94vw,1240px)] items-center justify-center',
  galleryStatusFrame:
    'inline-flex min-h-[56px] items-center justify-center border-[3px] border-[#2d2d2d] bg-white px-6 text-center text-[16px] font-bold text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]',
  galleryStatusButton:
    'inline-flex min-h-[56px] items-center justify-center border-[3px] border-[#2d2d2d] bg-[#ff4d4d] px-6 text-[16px] font-bold text-white shadow-[4px_4px_0px_0px_#2d2d2d] transition-transform duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#2d2d2d]',
};
