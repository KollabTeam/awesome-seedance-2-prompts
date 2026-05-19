'use client';

/**
 * prompt-gallery-virtual-grid.tsx 负责把 prompt gallery 的卡片渲染收口到窗口虚拟化网格。
 * 它位于 landing-pages 的客户端展示层，被 PromptGallery 在拿到筛选后的 items 后调用；
 * 这里按“行”而不是单卡做虚拟化，是为了同时兼容响应式多列、全页滚动和动态行高，
 * 避免直接把现有多列 gallery 退化回单列长列表。
 */
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { LandingPromptCommandConfig } from '@/lib/landing-page-config';
import type { PromptGalleryItem } from '@/lib/notion-prompts';

import { HandDrawnPromptCard } from './handdrawn-prompt-card';
import { buildPromptGallerySectionClassName } from './prompt-gallery-layout';
import { PromptCard, type PromptGalleryCardCopy } from './prompt-gallery-card';

type PromptGalleryVirtualGridVariant = 'arcade' | 'handdrawn';

type PromptGalleryVirtualGridCopy = {
  images: PromptGalleryCardCopy['images'];
  actions: PromptGalleryCardCopy['actions'];
};

type PromptGalleryVirtualGridRow<TItem> = {
  startIndex: number;
  items: TItem[];
};

const PROMPT_GALLERY_MOBILE_BREAKPOINT_PX = 640;
const PROMPT_GALLERY_GRID_GAP_PX = 24;
const PROMPT_GALLERY_MIN_CARD_WIDTH_BY_VARIANT = {
  arcade: 260,
  handdrawn: 320,
} as const;
const PROMPT_GALLERY_ESTIMATED_ROW_HEIGHT_PX = {
  arcade: 720,
  handdrawn: 760,
} as const;
const PROMPT_GALLERY_ROW_OVERSCAN = 3;

/**
 * 依据当前容器宽度和断点推导虚拟网格列数。
 * 这个 helper 被虚拟网格组件和测试共用；移动端仍然强制 1 列，
 * 单卡分享态也固定 1 列，是为了让虚拟化后的布局继续遵守现有 CSS 断点和单卡宽度约束。
 */
export function getPromptGalleryVirtualColumnCount({
  variant,
  containerWidth,
  viewportWidth,
  isSingleSharedPrompt,
}: {
  variant: PromptGalleryVirtualGridVariant;
  containerWidth: number;
  viewportWidth: number;
  isSingleSharedPrompt: boolean;
}): number {
  if (isSingleSharedPrompt || viewportWidth <= PROMPT_GALLERY_MOBILE_BREAKPOINT_PX || containerWidth <= 0) {
    return 1;
  }

  const minCardWidth = PROMPT_GALLERY_MIN_CARD_WIDTH_BY_VARIANT[variant];
  return Math.max(1, Math.floor((containerWidth + PROMPT_GALLERY_GRID_GAP_PX) / (minCardWidth + PROMPT_GALLERY_GRID_GAP_PX)));
}

/**
 * 按当前列数把线性卡片数组分组成虚拟化行。
 * 这个 helper 被 PromptGalleryVirtualGrid 的 memo 和测试共用；
 * 每行都保留绝对起始索引，是为了让行内卡片仍然能恢复原始 accent/stagger 节奏。
 */
export function groupPromptGalleryItemsIntoRows<TItem>(items: TItem[], columnCount: number): Array<PromptGalleryVirtualGridRow<TItem>> {
  const normalizedColumnCount = Math.max(1, columnCount);
  const rows: Array<PromptGalleryVirtualGridRow<TItem>> = [];

  for (let index = 0; index < items.length; index += normalizedColumnCount) {
    rows.push({
      startIndex: index,
      items: items.slice(index, index + normalizedColumnCount),
    });
  }

  return rows;
}

/**
 * 计算 arcade 卡片在虚拟化后仍应保留的错位节奏。
 * 旧实现依赖 section 直系子元素上的 nth-child 选择器；现在 rows 会包住卡片，
 * 因此必须按绝对索引把那套错位/旋转节奏重新补回到每张卡片自己的包裹层上。
 */
function getPromptGalleryVirtualItemWrapClassName(variant: PromptGalleryVirtualGridVariant, absoluteIndex: number): string {
  if (variant === 'handdrawn') {
    return '';
  }

  const oneBasedIndex = absoluteIndex + 1;
  const matchesThreeCycle = oneBasedIndex % 3 === 2;
  const matchesFourCycle = oneBasedIndex % 4 === 0;
  const classes = ['sm:will-change-transform'];

  if (matchesThreeCycle) {
    classes.push('sm:-translate-y-2', 'sm:rotate-[-0.9deg]');
  }

  if (matchesFourCycle) {
    classes.push('sm:translate-y-2', 'sm:rotate-[0.9deg]');
  }

  return classes.join(' ');
}

/**
 * 渲染支持窗口虚拟化的 prompt gallery 网格。
 * 这个组件复用 PromptGallery 已经维护好的 items、复制文案和媒体打开回调；
 * 通过 `useWindowVirtualizer` 对 row 做窗口虚拟化，是为了在列表继续无限追加时把 DOM 规模控制在可见区附近，
 * 同时不改动父组件已有的分页、筛选、分享和 lightbox 状态机。
 */
export function PromptGalleryVirtualGrid({
  variant,
  items,
  copy,
  promptCommand,
  isReplacingItems,
  isSingleSharedPrompt,
  onImageOpen,
  onMediaOpen,
}: {
  variant: PromptGalleryVirtualGridVariant;
  items: PromptGalleryItem[];
  copy: PromptGalleryVirtualGridCopy;
  promptCommand: LandingPromptCommandConfig;
  isReplacingItems: boolean;
  isSingleSharedPrompt: boolean;
  onImageOpen: (itemId: string, imageIndex: number) => void;
  onMediaOpen: (itemId: string, mediaId: string) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    function updateLayoutMetrics() {
      setContainerWidth(sectionRef.current?.clientWidth ?? 0);
      setScrollMargin(sectionRef.current?.offsetTop ?? 0);
      setViewportWidth(window.innerWidth);
    }

    updateLayoutMetrics();

    const resizeObserver = typeof ResizeObserver === 'undefined' || !sectionRef.current
      ? null
      : new ResizeObserver(() => {
          updateLayoutMetrics();
        });

    if (resizeObserver && sectionRef.current) {
      resizeObserver.observe(sectionRef.current);
    }

    window.addEventListener('resize', updateLayoutMetrics);
    return () => {
      window.removeEventListener('resize', updateLayoutMetrics);
      resizeObserver?.disconnect();
    };
  }, [isSingleSharedPrompt, items.length, variant]);

  const columnCount = useMemo(
    () =>
      getPromptGalleryVirtualColumnCount({
        variant,
        containerWidth,
        viewportWidth,
        isSingleSharedPrompt,
      }),
    [containerWidth, isSingleSharedPrompt, variant, viewportWidth],
  );
  const rows = useMemo(() => groupPromptGalleryItemsIntoRows(items, columnCount), [columnCount, items]);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => PROMPT_GALLERY_ESTIMATED_ROW_HEIGHT_PX[variant],
    overscan: PROMPT_GALLERY_ROW_OVERSCAN,
    scrollMargin,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const rowGridTemplateColumns = isSingleSharedPrompt
    ? variant === 'handdrawn'
      ? 'minmax(320px, 420px)'
      : 'minmax(260px, 360px)'
    : `repeat(${columnCount}, minmax(0, 1fr))`;
  const rowClassName =
    variant === 'handdrawn'
      ? 'grid items-start gap-6'
      : 'grid items-start gap-x-6 gap-y-8 justify-items-stretch';

  return (
    <section
      id="prompt-gallery"
      ref={sectionRef}
      className={buildPromptGallerySectionClassName({
        variant,
        isReplacingItems,
        isSingleSharedPrompt,
      })}
      style={variant === 'handdrawn' ? { borderRadius: '26px 18px 28px 14px / 14px 30px 18px 28px' } : undefined}
      aria-busy={isReplacingItems || undefined}
    >
      {rows.length > 0 ? (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) {
              return null;
            }

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  left: 0,
                  position: 'absolute',
                  top: 0,
                  transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                  width: '100%',
                }}
              >
                <div
                  className={rowClassName}
                  style={{
                    gridTemplateColumns: rowGridTemplateColumns,
                    justifyContent: isSingleSharedPrompt ? 'center' : undefined,
                  }}
                >
                  {row.items.map((item, itemIndex) => {
                    const absoluteIndex = row.startIndex + itemIndex;
                    return (
                      <div className={getPromptGalleryVirtualItemWrapClassName(variant, absoluteIndex)} key={`${item.id}-${absoluteIndex}`}>
                        {variant === 'handdrawn' ? (
                          <HandDrawnPromptCard item={item} copy={copy} onMediaOpen={onMediaOpen} promptCommand={promptCommand} />
                        ) : (
                          <PromptCard item={item} copy={copy} onImageOpen={onImageOpen} promptCommand={promptCommand.primary} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
