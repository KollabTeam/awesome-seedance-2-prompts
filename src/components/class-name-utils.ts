/**
 * class-name-utils.ts 提供 landing-pages 组件共享的轻量 className 工具。
 * 它位于 landing-pages 的展示辅助层，被 page shell、toolbar、gallery 和 lightbox 复用；
 * 把 `cn` 从大而全的样式表文件里拆出来，是为了让局部 UI 样式热更新时不再无谓牵连其它区域模块。
 */

type ClassValue = string | false | null | undefined;

/**
 * 合并 Tailwind className 片段。
 * 这个 helper 被页面和 gallery 组件调用，只过滤空值不做去重；
 * 保持实现轻量，是为了避免为 landing page 引入额外运行时依赖。
 */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}
