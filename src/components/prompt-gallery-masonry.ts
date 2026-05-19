/**
 * prompt-gallery-masonry.ts 收口 arcade prompt gallery 对 masonic 布局缓存的判定逻辑。
 * 它位于 landing-pages 的客户端布局辅助层，被 PromptGallery 在替换整组卡片时调用，
 * 用来判断当前变更是否会让旧的 positioner 继续访问已失效的索引。
 */
import type { PromptGalleryItem } from '@/lib/notion-prompts';

/**
 * 判断当前卡片集合替换是否需要重置 masonic 的布局缓存。
 * PromptGallery 的 cursor 分页属于“纯追加”，旧 positioner 可以继续复用；
 * 但 tag/search/shared-prompt 切换会直接替换整组 items，此时旧缓存里的索引可能已经不再存在，
 * 必须重建 Masonry 实例，否则 itemKey/render 会在虚拟滚动阶段拿到 `undefined` 数据。
 */
export function shouldResetPromptGalleryMasonry(
  previousItems: readonly PromptGalleryItem[],
  nextItems: readonly PromptGalleryItem[],
): boolean {
  if (nextItems.length < previousItems.length) {
    return true;
  }

  for (let index = 0; index < previousItems.length; index += 1) {
    if (previousItems[index]?.id !== nextItems[index]?.id) {
      return true;
    }
  }

  return false;
}
