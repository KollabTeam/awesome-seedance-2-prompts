'use client';

/**
 * handdrawn-prompt-gallery-toolbar.tsx 渲染手绘风格 landing page 的搜索和 tag 切换控件。
 * 它位于 landing-pages 的客户端交互层，被 PromptGallery 在 handdrawn 视觉分支下调用；
 * 控件继续只负责展示和派发用户意图，真正的数据请求仍集中在父组件，
 * 这样新风格不会引入第二份筛选状态机。
 */
import type { ChangeEvent } from 'react';

import { getPromptTagLabel, isPromptGalleryLatestTag, PROMPT_GALLERY_LATEST_TAG, type PromptGalleryTagLabels } from '@/lib/prompt-tags';

type HandDrawnPromptGalleryToolbarCopy = {
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

type HandDrawnPromptGalleryToolbarProps = {
  copy: HandDrawnPromptGalleryToolbarCopy;
  searchInput: string;
  selectedTag: string | null;
  tags: string[];
  onSearchInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTagSelect: (tag: string | null) => void;
};

const wobbleMd = '26px 18px 28px 14px / 14px 30px 18px 28px';
const handdrawnTagButtonClassName =
  'min-h-[42px] cursor-pointer border-[3px] border-[#2d2d2d] px-4 text-[16px] font-bold text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] transition-transform duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#2d2d2d]';

/**
 * 计算手绘 tag chip 的当前视觉状态。
 * 这个辅助函数只被手绘 toolbar 的桌面 tag 行调用，用来把 All tags / Latest / 普通 tag 的选中反馈统一成一套规则；
 * 之所以集中在这里，而不是给前两个按钮单独写死底色，是为了避免伪 tag 和真实 tag 再次出现“都算选中，但视觉不一致”的漂移。
 */
function getHanddrawnTagButtonStyle(isActive: boolean, inactiveBackgroundColor: '#ffffff' | '#fff9c4') {
  return {
    borderRadius: wobbleMd,
    fontFamily: 'var(--font-handwritten-body)',
    backgroundColor: isActive ? '#ff4d4d' : inactiveBackgroundColor,
    color: isActive ? '#ffffff' : '#2d2d2d',
  };
}

/**
 * 渲染搜索输入框和 tag chip 按钮。
 * 这个组件沿用与 arcade toolbar 相同的语义结构和移动端 select fallback，
 * 只把视觉改成便签/手写批注样式，避免多媒体分页和 tag 行为因为新风格再次分叉。
 */
export function HandDrawnPromptGalleryToolbar({
  copy,
  searchInput,
  selectedTag,
  tags,
  onSearchInputChange,
  onTagSelect,
}: HandDrawnPromptGalleryToolbarProps) {
  const isAllTagsActive = !selectedTag;
  const isLatestActive = isPromptGalleryLatestTag(selectedTag);

  return (
    <div className="mx-auto mb-6 w-[min(94vw,1240px)]" id="prompt-filters">
      <div
        className="grid gap-4 border-[3px] border-[#2d2d2d] bg-[#fffdf9] p-4 shadow-[6px_6px_0px_0px_#2d2d2d]"
        style={{ borderRadius: wobbleMd, transform: 'rotate(0.5deg)' }}
        aria-label={copy.toolbarLabel}
      >
        <label className="grid gap-2">
          <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#2d5da1]">{copy.toolbarLabel}</span>
          <input
            className="h-[54px] border-[3px] border-[#2d2d2d] bg-white px-4 text-[18px] text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] outline-none placeholder:text-[#2d2d2d]/45"
            style={{ borderRadius: wobbleMd, fontFamily: 'var(--font-handwritten-body)' }}
            type="search"
            value={searchInput}
            placeholder={copy.search.placeholder}
            aria-label={copy.search.label}
            onChange={onSearchInputChange}
          />
        </label>

        <label className="hidden gap-2 max-[640px]:grid">
          <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#ff4d4d]">{copy.filtersLabel}</span>
          <span className="relative block">
            <select
              className="h-[52px] w-full appearance-none border-[3px] border-[#2d2d2d] bg-[#fff9c4] px-4 pr-10 text-[17px] text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] outline-none"
              style={{ borderRadius: wobbleMd, fontFamily: 'var(--font-handwritten-body)' }}
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
            <svg className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2d2d2d]" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6.5 9.5 5.5 5 5.5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </span>
        </label>

        <div className="flex flex-wrap gap-3 max-[640px]:hidden" aria-label={copy.filtersLabel}>
          <button
            className={handdrawnTagButtonClassName}
            style={getHanddrawnTagButtonStyle(isAllTagsActive, '#ffffff')}
            type="button"
            aria-pressed={isAllTagsActive}
            onClick={() => onTagSelect(null)}
          >
            {copy.allTagsLabel}
          </button>
          <button
            className={handdrawnTagButtonClassName}
            style={getHanddrawnTagButtonStyle(isLatestActive, '#fff9c4')}
            type="button"
            aria-pressed={isLatestActive}
            onClick={() => onTagSelect(PROMPT_GALLERY_LATEST_TAG)}
          >
            {copy.latestTagLabel}
          </button>
          {tags.map((tag, index) => {
            const tagLabel = getPromptTagLabel(tag, copy.tagLabels);
            const isActive = selectedTag === tag;

            return (
              <button
                className={handdrawnTagButtonClassName}
                style={getHanddrawnTagButtonStyle(isActive, index % 2 === 0 ? '#ffffff' : '#fff9c4')}
                type="button"
                key={tag}
                aria-pressed={isActive}
                onClick={() => onTagSelect(tag)}
              >
                {tagLabel}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
