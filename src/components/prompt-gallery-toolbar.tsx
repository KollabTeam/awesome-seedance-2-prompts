'use client';

/**
 * prompt-gallery-toolbar.tsx 渲染 GPT Image 2 prompt gallery 的搜索和 tag 切换控件。
 * 它位于 landing-pages 的客户端交互层，被 PromptGallery 持有筛选状态后调用。
 * 当前实现遵循 "Atelier Editorial" 工具栏风格：
 *   - 桌面端：搜索框（paper-soft + hairline）+ 文字标签列表（中点分隔，激活态 marker 下划线）
 *   - 移动端：hairline 边框 select 下拉
 * 控件只负责展示和派发用户意图，真正的数据请求集中在父组件 PromptGallery，
 * 避免 UI 控件成为第二个数据真相源。
 * aria-pressed 语义继续保留在每个 tag 按钮上，确保键盘操作和辅助技术能读取当前筛选状态。
 */
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { getPromptTagLabel, isPromptGalleryLatestTag, PROMPT_GALLERY_LATEST_TAG, type PromptGalleryTagLabels } from '@/lib/prompt-tags';

import { cn } from './class-name-utils';
import { TAG_ACTIVE_UNDERLINE_SVG, promptGalleryToolbarClasses } from './prompt-gallery-toolbar-classes';

/* 模块级常量：tag 激活态的内联 SVG 下划线 style 对象。
 * 用内联 style 而不是 Tailwind arbitrary value，是因为 backgroundImage 包含特殊字符，
 * Tailwind JIT 在构建时可能裁剪动态值导致激活下划线在生产环境静默丢失。
 * 提到模块作用域避免每次 PromptGalleryToolbar 渲染都重建对象引用。 */
const ACTIVE_TAG_STYLE = {
  backgroundImage: TAG_ACTIVE_UNDERLINE_SVG,
  backgroundRepeat: 'no-repeat' as const,
  backgroundSize: '100% 0.38em',
  backgroundPosition: 'left 100%',
};

type ToolbarTagEntry =
  | { type: 'all' }
  | { type: 'latest' }
  | { type: 'tag'; value: string; label: string };

export type PromptGalleryToolbarCopy = {
  toolbarLabel: string;
  search: {
    label: string;
    placeholder: string;
  };
  filtersLabel: string;
  allTagsLabel: string;
  latestTagLabel: string;
  tagLabels?: PromptGalleryTagLabels;
};

type PromptGalleryToolbarProps = {
  copy: PromptGalleryToolbarCopy;
  searchInput: string;
  selectedTag: string | null;
  tags: string[];
  onSearchInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTagSelect: (tag: string | null) => void;
};

/**
 * 渲染搜索输入框和 tag 文字标签按钮。
 * 桌面端 tag 列表用中点（·）作为视觉分隔符，激活态通过内联 style 注入 SVG 下划线，
 * 而不是依赖 CSS 类名字符串，是为了避免 Tailwind JIT 在构建时裁剪动态 backgroundImage 值。
 * 移动端降级为单一 select，保留相同的筛选能力但避免 tag 在窄屏挤成多排。
 * 真实 tag value 仍保留 Notion 原始值用于 API 过滤，按钮文本只读取 i18n label。
 */
export function PromptGalleryToolbar({ copy, searchInput, selectedTag, tags, onSearchInputChange, onTagSelect }: PromptGalleryToolbarProps) {
  const allTagsActive = !selectedTag;
  const latestActive = isPromptGalleryLatestTag(selectedTag);

  /* 把所有 tag 按钮 + 分隔点排成一个平铺数组，方便一次性 map 渲染。
   * 用 useMemo 把构建结果按 tags + tagLabels 缓存，避免父组件每次 onSearchInputChange 触发的重渲染都重建数组。 */
  const tagEntries = useMemo<ToolbarTagEntry[]>(
    () => [
      { type: 'all' },
      { type: 'latest' },
      ...tags.map((tag) => ({ type: 'tag' as const, value: tag, label: getPromptTagLabel(tag, copy.tagLabels) })),
    ],
    [tags, copy.tagLabels],
  );

  return (
    <div className={promptGalleryToolbarClasses.galleryToolbar} id="prompt-filters">
      <div className={promptGalleryToolbarClasses.toolbar} aria-label={copy.toolbarLabel}>
        <div className={promptGalleryToolbarClasses.toolbarInner}>
          {/* 搜索框：paper-soft 填充，mono 放大镜图标，Source Serif 4 正文 */}
          <div className={promptGalleryToolbarClasses.searchBox}>
            <svg className={promptGalleryToolbarClasses.searchIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="m16 16 4.4 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              className={promptGalleryToolbarClasses.searchInput}
              type="search"
              value={searchInput}
              placeholder={copy.search.placeholder}
              aria-label={copy.search.label}
              onChange={onSearchInputChange}
            />
          </div>

          {/* 桌面端：文字标签列表，中点分隔，激活态 marker SVG 下划线 */}
          <div className={promptGalleryToolbarClasses.filters} aria-label={copy.filtersLabel}>
            {tagEntries.map((entry, index) => {
              const isFirst = index === 0;
              const isAll = entry.type === 'all';
              const isLatest = entry.type === 'latest';
              const isTag = entry.type === 'tag';
              const isActive = isAll ? allTagsActive : isLatest ? latestActive : isTag && selectedTag === entry.value;
              const label = isAll ? copy.allTagsLabel : isLatest ? copy.latestTagLabel : isTag ? entry.label : '';
              const key = isAll ? '__all__' : isLatest ? '__latest__' : isTag ? entry.value : '';

              return (
                <span key={key} className="inline-flex items-center gap-[9px]">
                  {!isFirst ? (
                    <span className={promptGalleryToolbarClasses.filterDot} aria-hidden="true">·</span>
                  ) : null}
                  <button
                    className={cn(
                      promptGalleryToolbarClasses.filterTag,
                      isActive ? promptGalleryToolbarClasses.filterTagActive : ''
                    )}
                    style={isActive ? ACTIVE_TAG_STYLE : undefined}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      if (isAll) {
                        onTagSelect(null);
                      } else if (isLatest) {
                        onTagSelect(PROMPT_GALLERY_LATEST_TAG);
                      } else if (isTag) {
                        onTagSelect(entry.value);
                      }
                    }}
                  >
                    {label}
                  </button>
                </span>
              );
            })}
          </div>

          {/* 移动端：hairline 边框 select，JetBrains Mono */}
          <div className={promptGalleryToolbarClasses.mobileFilterSelectWrap}>
            <label>
              <span className="sr-only">{copy.filtersLabel}</span>
              <select
                className={promptGalleryToolbarClasses.mobileFilterSelect}
                aria-label={copy.filtersLabel}
                value={selectedTag ?? ''}
                onChange={(event) => onTagSelect(event.currentTarget.value || null)}
              >
                <option value="">{copy.allTagsLabel}</option>
                <option value={PROMPT_GALLERY_LATEST_TAG}>{copy.latestTagLabel}</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {getPromptTagLabel(tag, copy.tagLabels)}
                  </option>
                ))}
              </select>
            </label>
            <svg className={promptGalleryToolbarClasses.mobileFilterSelectIcon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6.5 9.5 5.5 5 5.5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
