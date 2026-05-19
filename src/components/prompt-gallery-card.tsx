'use client';

/**
 * prompt-gallery-card.tsx 渲染单个 Editorial 风格的 prompt 卡片。
 * 它位于 landing-pages 的客户端展示层，被 PromptGallery 的 arcade 变体调用。
 * 当前实现遵循 "Atelier Editorial / Refined Marker" 设计：
 *   - 1px hairline 边框，0 圆角，paper-soft 背景，柔和阴影
 *   - 媒体区布局由 thumbnailMediaItems.length（thumbCount）驱动：
 *       0 → 仅 hero
 *       1 → hero + 第二张全宽 hero-style 图（竖向堆叠，第二张不携带 SharePromptButton）
 *       2 → hero + 2 列等宽缩略图行（grid repeat(2, minmax(0, 1fr))）
 *     ≥3 → hero + 3 列等宽缩略图行（grid repeat(3, minmax(0, 1fr))），超出 3 张时换行；
 *           末尾不足 3 张的行保持 1/3 宽度，不拉伸（CSS grid 已天然保证）
 *   - 所有缩略图按自身 width/height 保持原比例（FALLBACK_MEDIA_ASPECT_RATIO 兜底），不强制 1:1
 *   - SharePromptButton 仍以浮层形态挂在第一张 hero 右上角，不在第二 hero 或缩略图上重复
 *   - JetBrains Mono caption "Plate N · GPT Image 2 · {tag}"
 *   - Source Serif 4 15.5px / 1.7 prompt 正文：默认 3 行夹断，超过阈值时显示展开/收起
 *   - 24px 圆形头像 + hairline 圆环，作者名 Source Serif 4 italic，来源 mono 链接
 *   - action row：纯文字链接 中点分隔（复制 · 分享 · 来源），不再嵌入 icon button 形态
 *   - CTA：Fraunces italic，marker 色 SVG 箭头，hover 时箭头右移 6px
 * 卡片保留 launchPromptInKollabTask / buildPromptTaskPath / login redirect 逻辑；
 * 复制 / 分享文字链接以内联 clipboard fallback + 短暂 inline 反馈实现，避免再嵌入图标按钮组件。
 */
import type { MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { copyTextWithFallback } from '@/lib/clipboard';
import type { PromptGalleryItem } from '@/lib/notion-prompts';
import type { PromptGalleryTagLabels } from '@/lib/prompt-tags';
import { buildTaskPathFromPrefillHandoff } from '@/lib/task-prefill-handoff';

import { cn } from './class-name-utils';
import { PromptCardDeferredCtaLabel } from './prompt-card-deferred-cta-label';
import { buildPromptShareUrl } from './prompt-gallery-filters';
import { getPromptPreviewMediaItems } from './prompt-gallery-images';
import { SharePromptButton } from './share-prompt-button';

export type PromptGalleryCardCopy = {
  images: {
    open: string;
    fullscreen: string;
  };
  tagLabels?: PromptGalleryTagLabels;
  actions: {
    copy: string;
    copied: string;
    share: string;
    shared: string;
    source: string;
    tryItNow: string;
    /** 提示词正文超过 3 行时的"展开"按钮文案。 */
    expand?: string;
    /** 已展开后的"收起"按钮文案。 */
    collapse?: string;
  };
};

/* prompt 字数超过这个阈值时启用 3 行折叠 + 展开按钮。
 * 320px 列宽 × Source Serif 4 15.5px × 1.7 line-height 大约一行 18-22 个汉字 / 30-36 个英文字符；
 * 100 字以上一定会超过 3 行，而 60-100 字的临界 prompt 直接全展示也不至于撑爆卡片。 */
const PROMPT_CLAMP_TRIGGER_CHAR_COUNT = 100;

const GPT_IMAGE_PROMPT_COMMAND = '/gpt-image-2';
const POST_LOGIN_REDIRECT_KEY = 'postLoginRedirect';

/** 罗马数字数组，用于 caption "PLATE N" 格式；超出范围回退到阿拉伯数字。 */
const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

/** 主图缺尺寸时的兜底 aspect ratio。
 * 旧 Notion 兼容路径不携带 width/height，渲染层用这个保底值预留容器空间，
 * 避免图片加载到一半把 masonry 列其它卡片向上抽。 */
const FALLBACK_MEDIA_ASPECT_RATIO = '4/5';

/** study 参考图缺尺寸时的兜底 aspect ratio。 */
const FALLBACK_STUDY_MEDIA_ASPECT_RATIO = '1/1';

/**
 * 把 accentIndex 映射到 0-4 的稳定槽位。
 * 被卡片 study 参考图节奏（每第 3 张展示）和测试共用，保证分页追加后视觉节奏不漂移。
 */
export function getPromptCardAccentSlot(accentIndex: number): number {
  const len = 5;
  const remainder = accentIndex % len;
  return remainder < 0 ? remainder + len : remainder;
}

/**
 * 在新窗口打开外部链接。
 * 被作者链接和来源链接共用；显式 preventDefault 后调用 window.open，
 * 避免部分 IAB 对普通 target="_blank" anchor 的接管，保持用户停留在当前 gallery。
 */
export function openExternalLinkInNewWindow(event: MouseEvent<HTMLAnchorElement>, url: string) {
  event.preventDefault();
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * 生成旧版带 prompt 预填的 fe-app task 草稿页路径。
 * 真正的 CTA 打开流程现在会先写浏览器侧 handoff，再使用更短的
 * `/task?prefillHandoff=...` 链接，避免长 prompt 撞上 URL 长度限制。
 */
export function buildPromptTaskPath(prompt: string, promptCommand: string = GPT_IMAGE_PROMPT_COMMAND): string {
  return buildPromptTaskPathFromPrefill(`${promptCommand} ${prompt.trim()}`.trim());
}

/**
 * 生成旧版带原始 prefill 文本的 fe-app task 草稿页路径。
 * handdrawn 混合 prompt 页的真实 CTA 已经改走 handoff 协议；这里保留 legacy 纯函数，
 * 是为了避免直接删掉导出后影响现有测试夹具或临时调试入口。
 */
export function buildPromptTaskPathFromPrefill(prefill: string): string {
  return `/task?prefill=${encodeURIComponent(prefill.trim())}`;
}

/**
 * 把登录后目标路径同时写进当前标签和跨标签存储。
 * 只被 prompt 卡片 CTA 调用；同时写 sessionStorage + localStorage，
 * 兼容"当前标签直接登录恢复"和"新标签去 /login 再恢复"两条路径。
 */
function persistPostLoginRedirect(taskPath: string) {
  window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, taskPath);
  window.localStorage.setItem(POST_LOGIN_REDIRECT_KEY, taskPath);
}

/**
 * 在新标签页打开基于 handoff 协议的 task 草稿页路径。
 * 这个 helper 被单模型 CTA 和多行 prefill CTA 共用，统一处理登录恢复目标；
 * handoff 路径会在这里同步写入 postLoginRedirect，保证登录完成后仍能恢复到同一次 prompt 任务。
 */
function openKollabTaskPathFromPrefill(prefill: string) {
  const taskPath = buildTaskPathFromPrefillHandoff({ prefill });
  const token = window.localStorage.getItem('token');
  const hasLikelySession = Boolean(token && token !== 'null' && token !== 'undefined');

  if (!hasLikelySession) {
    persistPostLoginRedirect(taskPath);
    window.open('/login/', '_blank', 'noopener,noreferrer');
    return;
  }

  window.open(taskPath, '_blank', 'noopener,noreferrer');
}

/**
 * 在新标签页打开 fe-app task 草稿页并预填当前 prompt。
 * 未登录时先持久化登录后恢复目标，再跳 /login/；已登录时直接新开 task。
 */
export function launchPromptInKollabTask(prompt: string, promptCommand: string = GPT_IMAGE_PROMPT_COMMAND) {
  openKollabTaskPathFromPrefill(`${promptCommand} ${prompt.trim()}`.trim());
}

/**
 * 在新标签页打开带原始多行 prefill 的 fe-app task 草稿页。
 * 混合 GPT Image 2 / Seedance 2 卡片需要把两条命令一起预填到同一个任务里，
 * 所以这里保留“直接传完整 prefill 文本”的入口，而不是强行套单命令格式。
 */
export function launchPrefilledKollabTask(prefill: string) {
  openKollabTaskPathFromPrefill(prefill);
}

/**
 * 渲染 prompt 正文：默认 3 行夹断，超过 PROMPT_CLAMP_TRIGGER_CHAR_COUNT 时显示展开 / 收起切换。
 * 阈值是字符数启发式，避免引入 ResizeObserver / 真实 DOM 行数测量带来的水合复杂度。
 * `break-words` + `[overflow-wrap:anywhere]` 配合 max-width，是为了让长 URL / 不可断英文词在窄列里也能正确换行。
 */
function PromptCardBody({
  prompt,
  expandLabel,
  collapseLabel,
}: {
  prompt: string;
  expandLabel?: string;
  collapseLabel?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldClamp = prompt.length > PROMPT_CLAMP_TRIGGER_CHAR_COUNT;
  const expanded = isExpanded || !shouldClamp;
  const toggleLabel = expanded ? (collapseLabel ?? 'Show less') : (expandLabel ?? 'Show more');

  return (
    <div className="mt-[16px]">
      <p
        className={cn(
          'max-w-[36ch] text-[var(--ink-primary)] text-[15.5px] leading-[1.7] m-0 break-words [overflow-wrap:anywhere]',
          !expanded && '[display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical] overflow-hidden'
        )}
      >
        {prompt}
      </p>
      {shouldClamp ? (
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          className="mt-[8px] inline-flex items-center gap-[4px] text-[var(--ink-secondary)] font-[var(--font-mono)] text-[11px] tracking-[0.08em] hover:text-[var(--ink-primary)] transition-colors duration-200 border-0 bg-transparent p-0 cursor-pointer"
        >
          {toggleLabel}
          <svg
            className={cn(
              'w-[10px] h-[10px] transition-transform duration-[220ms] ease-[ease]',
              expanded && 'rotate-180'
            )}
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

const ACTION_FEEDBACK_TIMEOUT_MS = 1400;

/**
 * 暂态反馈 hook：触发 trigger() 后短时切到 active，自动回到 idle。
 * 被复制 / 分享文字链接共用；自身管理 timeout 引用并在卸载时清理，
 * 避免 PromptCardActions 同时维护两套 useRef + cleanup useEffect。
 */
function useTimedFeedback(timeoutMs: number = ACTION_FEEDBACK_TIMEOUT_MS): readonly [boolean, () => void] {
  const [active, setActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);
  const trigger = () => {
    setActive(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setActive(false), timeoutMs);
  };
  return [active, trigger] as const;
}

/**
 * 渲染 prompt 卡片底部 action 行（复制 · 分享 · 来源）。
 * 全部为同一文字链接视觉：默认 ink-secondary，hover 时画一条 hairline 底线 + 切到 ink-primary。
 * 复制 / 分享点击后短暂把文案切到 copied / shared 反馈，这种内联反馈比 portal toast 更轻，
 * 在 Atelier Editorial 的克制排版里也不抢注意力。
 */
function PromptCardActions({
  prompt,
  promptId,
  sourceUrl,
  copy,
}: {
  prompt: string;
  promptId: string;
  sourceUrl: string | null;
  copy: PromptGalleryCardCopy;
}) {
  const [copied, triggerCopied] = useTimedFeedback();
  const [shared, triggerShared] = useTimedFeedback();

  function handleCopy() {
    void copyTextWithFallback(prompt);
    triggerCopied();
  }

  function handleShare() {
    const shareUrl = buildPromptShareUrl(window.location.href, promptId);
    void copyTextWithFallback(shareUrl);
    triggerShared();
  }

  /* 文字链接的 hairline 下划线动画：起始 background-size 为 0，hover 时扩到 100%。
   * 这种背景图模拟下划线的方式比 text-decoration 更可控（hairline 颜色 + 触发动画速率）。 */
  const linkClassName =
    '[background:linear-gradient(var(--hairline),var(--hairline))_left_100%_/_0_1px_no-repeat] hover:[background-size:100%_1px] hover:text-[var(--ink-primary)] transition-[background-size,color] duration-[220ms] ease-[ease] border-0 bg-transparent p-0 cursor-pointer';

  return (
    <div className="mt-[18px] text-[var(--ink-secondary)] text-[13px] leading-[1.25]">
      <button type="button" className={linkClassName} aria-label={copy.actions.copy} onClick={handleCopy}>
        {copied ? copy.actions.copied : copy.actions.copy}
      </button>
      <span className="mx-[6px] opacity-55" aria-hidden="true">·</span>
      <button type="button" className={linkClassName} aria-label={copy.actions.share} onClick={handleShare}>
        {shared ? copy.actions.shared : copy.actions.share}
      </button>
      {sourceUrl ? (
        <>
          <span className="mx-[6px] opacity-55" aria-hidden="true">·</span>
          <Tooltip content={copy.actions.source}>
            <a
              className={linkClassName}
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={copy.actions.source}
              onClick={(event) => openExternalLinkInNewWindow(event, sourceUrl)}
            >
              {copy.actions.source}
            </a>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}

/**
 * 渲染缩略图媒体项（图片或视频）。
 * 被 PromptCardImage 在缩略图行和第二 hero 共享；视频不支持 lightbox（用 div），图片用 button 打开弹层。
 * aspectRatio 由调用方按媒体自身 width/height 传入，保持原比例不裁切。
 */
function PromptMediaThumb({
  thumb,
  prompt,
  copy,
  onImageOpen,
  itemId,
}: {
  thumb: ReturnType<typeof getPromptPreviewMediaItems>[number];
  prompt: string;
  copy: PromptGalleryCardCopy;
  onImageOpen: (itemId: string, imageIndex: number) => void;
  itemId: string;
}) {
  /* 按媒体自身比例保持容器高度，旧 Notion 兼容路径无尺寸时回退到 FALLBACK，
   * 避免 grid 行高被空容器抽走。 */
  const thumbAspectRatio =
    thumb.width && thumb.height
      ? `${thumb.width} / ${thumb.height}`
      : FALLBACK_MEDIA_ASPECT_RATIO;
  const canOpenLightbox = thumb.type === 'image' && thumb.imageIndex !== null;
  const wrapperBaseClass =
    'self-start overflow-hidden border border-[var(--hairline)] bg-[var(--paper-soft)]';

  /* 图片缩略图：button 可聚焦，点击打开 lightbox；视频缩略图：div，不可点击打开弹层。 */
  if (canOpenLightbox) {
    return (
      <button
        key={thumb.id}
        type="button"
        aria-label={copy.images.open}
        className={cn(
          'block w-full p-0 cursor-zoom-in hover:border-[var(--hairline-strong)] transition-colors duration-150',
          wrapperBaseClass,
        )}
        style={{ aspectRatio: thumbAspectRatio }}
        onClick={() => onImageOpen(itemId, thumb.imageIndex!)}
      >
        <img
          className="block w-full h-full object-cover [filter:saturate(0.88)_contrast(1.02)]"
          src={thumb.url}
          alt={prompt}
          width={thumb.width || undefined}
          height={thumb.height || undefined}
          loading="lazy"
        />
      </button>
    );
  }

  return (
    <div
      key={thumb.id}
      className={cn('w-full', wrapperBaseClass)}
      style={{ aspectRatio: thumbAspectRatio }}
    >
      {thumb.type === 'video' ? (
        <video
          className="block w-full h-full object-cover [filter:saturate(0.88)_contrast(1.02)]"
          src={thumb.url}
          poster={thumb.posterUrl || undefined}
          width={thumb.width || undefined}
          height={thumb.height || undefined}
          muted
          loop
          playsInline
          preload="metadata"
        />
      ) : (
        <img
          className="block w-full h-full object-cover [filter:saturate(0.88)_contrast(1.02)]"
          src={thumb.url}
          alt={prompt}
          width={thumb.width || undefined}
          height={thumb.height || undefined}
          loading="lazy"
        />
      )}
    </div>
  );
}

/**
 * 渲染卡片顶部媒体区，布局由 thumbCount（thumbnailMediaItems.length）驱动：
 *   0 → 仅 hero
 *   1 → hero + 第二张全宽 hero-style 图（竖向堆叠，间距 6px），第二张不携带 SharePromptButton
 *   2 → hero + 2 列等宽缩略图行（repeat(2, minmax(0, 1fr))）
 *  ≥3 → hero + 3 列等宽缩略图行（repeat(3, minmax(0, 1fr))），超出换行；
 *        末尾不足 3 张保持 1/3 宽（CSS grid 天然保证，不用 flex-wrap / auto-fit）
 *
 * Hero 容器的 aspect-ratio 锁定到第一张媒体的真实 width/height：
 * hero 撑开卡片高度，必须用真实比例保全焦点构图；
 * lazy 加载期间容器已有正确高度，不会在 masonry 里把相邻卡片向上抽。
 *
 * 调用方：PromptCard，通过 masonry 容器直接渲染。
 */
function PromptCardImage({
  item,
  copy,
  onImageOpen,
}: {
  item: PromptGalleryItem;
  copy: PromptGalleryCardCopy;
  onImageOpen: (itemId: string, imageIndex: number) => void;
}) {
  const previewMediaItems = getPromptPreviewMediaItems(item);
  const heroMedia = previewMediaItems[0];
  const thumbnailMediaItems = previewMediaItems.slice(1);
  const thumbCount = thumbnailMediaItems.length;

  if (!heroMedia) {
    return null;
  }

  /* Hero 容器比例锁定第一张媒体，旧 Notion 兼容路径无尺寸时回退到 FALLBACK。 */
  const heroAspectRatio =
    heroMedia.width && heroMedia.height
      ? `${heroMedia.width} / ${heroMedia.height}`
      : FALLBACK_MEDIA_ASPECT_RATIO;

  /* thumbCount === 1 时第二张媒体也以全宽 hero-style 渲染，而不是进缩略图行。
   * 用于区分"需要 grid 的 2 列 / 3 列布局"还是"双 hero 堆叠"。 */
  const gridCols = thumbCount === 2 ? 2 : 3;

  return (
    <div>
      {/* Hero 区：prompt-share-shell 触发分享浮层 hover/focus-within CSS 语义（见 globals.css）。
        * SharePromptButton 浮层仅挂在第一张 hero 右上角；第二 hero 和缩略图不重复分享按钮。 */}
      <div
        className="prompt-share-shell relative overflow-hidden border border-[var(--hairline)] bg-[var(--paper-soft)]"
        style={{ aspectRatio: heroAspectRatio }}
      >
        {/* 分享按钮浮层 */}
        <div className="prompt-share-overlay pointer-events-none absolute right-2 top-2 z-[6] transition-opacity duration-200">
          <div className="pointer-events-auto">
            <SharePromptButton promptId={item.id} label={copy.actions.share} copiedLabel={copy.actions.shared} />
          </div>
        </div>

        {heroMedia.type === 'video' ? (
          <video
            className="block w-full h-full object-cover [filter:saturate(0.88)_contrast(1.02)]"
            src={heroMedia.url}
            poster={heroMedia.posterUrl || undefined}
            width={heroMedia.width || undefined}
            height={heroMedia.height || undefined}
            muted
            loop
            playsInline
            preload="metadata"
          />
        ) : (
          <button
            className="block w-full h-full border-0 bg-transparent p-0 cursor-zoom-in"
            type="button"
            aria-label={copy.images.open}
            onClick={() => {
              if (heroMedia.imageIndex !== null) {
                onImageOpen(item.id, heroMedia.imageIndex);
              }
            }}
          >
            <img
              className="block w-full h-full object-cover [filter:saturate(0.88)_contrast(1.02)]"
              src={heroMedia.url}
              alt={item.prompt}
              width={heroMedia.width || undefined}
              height={heroMedia.height || undefined}
              loading="lazy"
            />
          </button>
        )}
      </div>

      {/* thumbCount === 1：第二张媒体以全宽 hero-style 竖向堆叠，间距与缩略图行保持一致（6px）。
        * 不携带 SharePromptButton（分享是 per-prompt 的，已在第一张 hero 上提供）。
        * 使用 PromptMediaThumb 复用点击 / 视频渲染逻辑，避免重复代码。 */}
      {thumbCount === 1 ? (
        <div className="mt-[6px]">
          <PromptMediaThumb
            thumb={thumbnailMediaItems[0]!}
            prompt={item.prompt}
            copy={copy}
            onImageOpen={onImageOpen}
            itemId={item.id}
          />
        </div>
      ) : null}

      {/* thumbCount >= 2：缩略图行，列数由 gridCols 决定（2 列 / 3 列）。
        * repeat(N, minmax(0, 1fr)) 确保末尾不足 N 张的行仍保持 1/N 宽度，不拉伸；
        * 这是选择 CSS grid 而不是 flex-wrap 的原因：flex auto-fit 会拉伸最后一行。 */}
      {thumbCount >= 2 ? (
        <div
          className="mt-[6px] grid gap-[6px]"
          style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {thumbnailMediaItems.map((thumb) => (
            <PromptMediaThumb
              key={thumb.id}
              thumb={thumb}
              prompt={item.prompt}
              copy={copy}
              onImageOpen={onImageOpen}
              itemId={item.id}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 渲染单个 Editorial 风格 prompt 卡片。
 * 被 PromptGallery 的 arcade 变体通过 masonry 容器直接渲染（不经过 VirtualGrid）。
 * 卡片不再使用 rotation、neon shadow 或多色方案；
 * accentIndex 只用于决定图片比例和 № 索引数字，保持卡片视觉节奏而不引入颜色噪音。
 * Tooltip 仍包裹来源按钮保留桌面端悬停提示，而不仅依赖 title 属性。
 */
export function PromptCard({
  item,
  copy,
  accentIndex: accentIndexProp,
  onImageOpen,
  promptCommand = GPT_IMAGE_PROMPT_COMMAND,
}: {
  item: PromptGalleryItem;
  copy: PromptGalleryCardCopy;
  accentIndex?: number;
  onImageOpen: (itemId: string, imageIndex: number) => void;
  promptCommand?: string;
}) {
  /* 优先用组件外部传入的 accentIndex（由 gallery 按全局序号分配），没有时回退到 item.accentIndex；
   * 当前只剩 caption 的罗马数字 PLATE 标记会用到，没有右上角索引。 */
  const accentIndex = accentIndexProp ?? item.accentIndex;
  const romanNumeral = ROMAN_NUMERALS[accentIndex] ?? String(accentIndex + 1);

  /* 取第一个 tag 的 label 用于 caption，没有 tag 时留空 */
  const tagLabel = item.tags[0] ? (copy.tagLabels?.[item.tags[0] as keyof typeof copy.tagLabels] ?? item.tags[0]) : '';

  return (
    <article
      className="relative block w-full border border-[var(--hairline)] bg-[rgba(244,238,223,0.78)] [box-shadow:0_1px_0_rgba(26,22,16,0.04),0_12px_24px_rgba(26,22,16,0.04)] transition-[border-color] duration-[180ms] ease-[ease] hover:border-[var(--hairline-strong)] p-[26px_24px_24px]"
    >
      {/* 媒体区：第一张媒体为全宽 hero，额外媒体在 hero 下方渲染为方形缩略图行 */}
      <PromptCardImage item={item} copy={copy} onImageOpen={onImageOpen} />

      {/* caption：JetBrains Mono 小号元数据，保留 GPT Image 2 官方大小写。 */}
      <div className="mt-[8px] text-[var(--ink-secondary)] font-[var(--font-mono)] text-[10px] font-medium tracking-[0.12em] leading-[1.35]">
        Plate {romanNumeral} · GPT Image 2{tagLabel ? ` · ${tagLabel}` : ''}
      </div>

      {/* prompt 正文：Source Serif 4，15.5px / 1.7。
        * 默认 3 行折叠，长 prompt 展开按钮在下方触发。
        * `break-words` + `[overflow-wrap:anywhere]` 双保险，避免长 URL / 英文单词撑爆卡片宽度。 */}
      <PromptCardBody prompt={item.prompt} expandLabel={copy.actions.expand} collapseLabel={copy.actions.collapse} />

      {/* 作者行：圆形头像 + hairline 圆环，italic 作者名，mono 来源链接 */}
      <div className="flex items-center gap-[10px] min-h-[32px] mt-[18px]">
        {/* 头像：24px，hairline 圆环 */}
        {item.authorAvatarUrl ? (
          <img
            className="flex-none w-[24px] h-[24px] rounded-full border border-[var(--hairline)] overflow-hidden object-cover"
            src={item.authorAvatarUrl}
            alt=""
            loading="lazy"
          />
        ) : (
          <span className="flex-none inline-grid w-[24px] h-[24px] place-items-center rounded-full border border-[var(--hairline)] bg-[var(--paper-soft)] text-[10px] font-medium text-[var(--ink-secondary)]">
            {item.authorName.slice(0, 1).toUpperCase()}
          </span>
        )}

        {/* 作者名：Source Serif 4 italic */}
        {item.authorUrl ? (
          <a
            className="text-[var(--ink-secondary)] font-[var(--font-serif-body),Georgia,serif] text-[13.5px] italic leading-[1.1] hover:text-[var(--ink-primary)] transition-colors duration-200"
            href={item.authorUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => openExternalLinkInNewWindow(event, item.authorUrl!)}
          >
            {item.authorName}
          </a>
        ) : (
          <span className="text-[var(--ink-secondary)] font-[var(--font-serif-body),Georgia,serif] text-[13.5px] italic leading-[1.1]">
            {item.authorName}
          </span>
        )}

      </div>

      {/* action row：纯文字链接 + 中点分隔。
        * Copy / Share 内联实现，不再嵌入 CopyPromptButton / SharePromptButton 的 icon-button 形态，
        * 这样三个动作（复制 · 分享 · 来源）保持同一文字链视觉，对齐 Atelier Editorial 排版语义。 */}
      <PromptCardActions
        prompt={item.prompt}
        promptId={item.id}
        sourceUrl={item.sourceUrl ?? null}
        copy={copy}
      />

      {/* CTA：Fraunces italic，marker 箭头 SVG，hover 时箭头右移 6px */}
      <button
        className="group/cta inline-flex items-center gap-[7px] mt-[12px] text-[var(--ink-primary)] font-[var(--font-fraunces),Georgia,serif] text-[16px] italic font-[550] leading-[1.2] [font-variation-settings:'opsz'_72] [background:linear-gradient(var(--ink-primary),var(--ink-primary))_left_100%_/_0_1px_no-repeat] hover:[background-size:calc(100%-20px)_1px] transition-[background-size] duration-[220ms] ease-[ease] border-0 bg-transparent p-0 cursor-pointer"
        type="button"
        aria-label={copy.actions.tryItNow}
        onClick={() => launchPromptInKollabTask(item.prompt, promptCommand)}
      >
        <PromptCardDeferredCtaLabel label={copy.actions.tryItNow} />
        {/* 14×14 marker 色箭头 doodle，hover 时右移 6px */}
        <svg
          className="w-[14px] h-[14px] text-[var(--marker)] transition-transform duration-[220ms] ease-[ease] group-hover/cta:translate-x-[6px]"
          viewBox="0 0 18 18"
          aria-hidden="true"
        >
          <path d="M2 9 C6 8 10 8 15 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M11 5 C13 6.2 14.4 7.5 16 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M11 13 C13 11.8 14.4 10.5 16 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </article>
  );
}
