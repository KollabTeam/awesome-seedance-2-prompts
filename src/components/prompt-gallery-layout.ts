/**
 * prompt-gallery-layout.ts 负责收口 prompt gallery 列表容器的版式选择。
 * 它位于 landing-pages 的客户端展示层，被 PromptGallery 在渲染卡片网格时调用；
 * 把普通列表和 `?id=` 单卡分享的布局判断集中到这里，是为了避免超长容器 class 继续堆在主组件里，
 * 同时确保单卡分享不会因为 `auto-fit + 1fr` 被拉满整行。
 */
import { cn } from './class-name-utils';

type PromptGalleryLayoutVariant = 'arcade' | 'handdrawn';

const PROMPT_GALLERY_ARCADE_GRID_CLASS_NAME =
  'mx-auto grid w-[min(92vw,1320px)] grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-6 gap-y-8 rounded-[32px] border-4 border-[var(--accent-cyan)] bg-[linear-gradient(180deg,rgba(20,16,42,0.98),rgba(8,8,20,0.98))] p-5 pb-20 shadow-[var(--shadow-glow),var(--shadow-stack)] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(180deg,rgba(255,58,242,0.08),rgba(0,245,212,0.04))] [background-position:center,center,center] [background-size:22px_22px,22px_22px,100%_100%] max-[640px]:grid-cols-[minmax(0,1fr)] max-[640px]:gap-y-5 max-[640px]:rounded-[26px] max-[640px]:p-3 max-[640px]:pb-12 max-[640px]:[background-size:18px_18px,18px_18px,100%_100%] sm:[&>*:nth-child(3n+2)]:-translate-y-2 sm:[&>*:nth-child(4n+4)]:translate-y-2 sm:[&>*:nth-child(3n+2)]:rotate-[-0.9deg] sm:[&>*:nth-child(4n+4)]:rotate-[0.9deg]';
const PROMPT_GALLERY_ARCADE_SINGLE_SHARED_CLASS_NAME =
  'mx-auto grid w-[min(92vw,1320px)] justify-center grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-8 rounded-[32px] border-4 border-[var(--accent-cyan)] bg-[linear-gradient(180deg,rgba(20,16,42,0.98),rgba(8,8,20,0.98))] p-5 pb-20 shadow-[var(--shadow-glow),var(--shadow-stack)] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(180deg,rgba(255,58,242,0.08),rgba(0,245,212,0.04))] [background-position:center,center,center] [background-size:22px_22px,22px_22px,100%_100%] max-[640px]:grid-cols-[minmax(0,1fr)] max-[640px]:gap-y-5 max-[640px]:rounded-[26px] max-[640px]:p-3 max-[640px]:pb-12 max-[640px]:[background-size:18px_18px,18px_18px,100%_100%] sm:grid-cols-[minmax(260px,360px)]';
const PROMPT_GALLERY_HANDDRAWN_GRID_CLASS_NAME =
  'mx-auto grid w-[min(94vw,1240px)] grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6 rounded-[26px] border-[3px] border-[#2d2d2d] bg-[#f7f2e8] p-4 pb-14 shadow-[6px_6px_0px_0px_#2d2d2d] max-[640px]:grid-cols-[minmax(0,1fr)] max-[640px]:gap-4 max-[640px]:p-3';
const PROMPT_GALLERY_HANDDRAWN_SINGLE_SHARED_CLASS_NAME =
  'mx-auto grid w-[min(94vw,1240px)] justify-center grid-cols-[minmax(0,1fr)] gap-6 rounded-[26px] border-[3px] border-[#2d2d2d] bg-[#f7f2e8] p-4 pb-14 shadow-[6px_6px_0px_0px_#2d2d2d] max-[640px]:grid-cols-[minmax(0,1fr)] max-[640px]:gap-4 max-[640px]:p-3 sm:grid-cols-[minmax(320px,420px)]';

/**
 * 判断当前是否应切到单卡分享专用布局。
 * 这个 helper 被 PromptGallery 在计算列表容器 class 前调用；
 * 只有 `?id=` 命中且当前权威结果确实只返回 1 张卡片时，才值得放弃 auto-fit 的整行铺满策略并改成居中定宽。
 */
export function shouldUseSingleSharedPromptLayout({
  sharedPromptId,
  itemCount,
}: {
  sharedPromptId: string | null;
  itemCount: number;
}): boolean {
  return Boolean(sharedPromptId && itemCount === 1);
}

/**
 * 生成 prompt gallery 列表容器的 className。
 * 这个 helper 被 PromptGallery 的 section 容器复用；普通态仍保留原有 auto-fit 多列铺排，
 * 但单卡分享态改成居中且有上限宽度的单列轨道，避免分享页只剩一张卡时把卡片拉到接近整屏宽。
 */
export function buildPromptGallerySectionClassName({
  variant,
  isReplacingItems,
  isSingleSharedPrompt,
}: {
  variant: PromptGalleryLayoutVariant;
  isReplacingItems: boolean;
  isSingleSharedPrompt: boolean;
}): string {
  const baseClassName = variant === 'handdrawn'
    ? isSingleSharedPrompt
      ? PROMPT_GALLERY_HANDDRAWN_SINGLE_SHARED_CLASS_NAME
      : PROMPT_GALLERY_HANDDRAWN_GRID_CLASS_NAME
    : isSingleSharedPrompt
      ? PROMPT_GALLERY_ARCADE_SINGLE_SHARED_CLASS_NAME
      : PROMPT_GALLERY_ARCADE_GRID_CLASS_NAME;

  return cn(baseClassName, isReplacingItems && 'opacity-60 transition-opacity duration-200');
}
