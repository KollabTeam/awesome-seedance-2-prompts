'use client';

/**
 * share-prompt-button.tsx 提供 landing prompt 卡片的分享控件。
 * 它位于 landing-pages 的轻量客户端交互层，被 GPT Image 和 Seedance 卡片共用；
 * 按钮只负责生成当前卡片的公开链接、写入剪贴板并给出短暂反馈，避免 gallery 容器把分享细节和悬浮按钮视觉都收进同一个大组件。
 * 分享按钮不再使用 tooltip，而是只保留点击后的成功浮层，
 * 这样 hover/focus 停留在按钮上时不会再和复制成功反馈叠出两层相同文案。
 * 分享链接统一写成 `?id=` 直达单卡，是为了让外部打开的人直接看到目标 prompt，而不是先落到某个模糊的 tag 列表里再手动寻找。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { buildPromptShareUrl } from '@/components/prompt-gallery-filters';
import { copyTextWithFallback } from '@/lib/clipboard';

type SharePromptButtonProps = {
  promptId: string;
  label: string;
  copiedLabel: string;
  variant?: 'arcade' | 'handdrawn';
};

type FeedbackPosition = {
  top: number;
  left: number;
};

const FEEDBACK_VIEWPORT_GUTTER = 12;
const FEEDBACK_OFFSET = 8;
const FEEDBACK_TIMEOUT_MS = 1400;
/* Editorial 风格的 share 浮层按钮：纸色填充 + 1px hairline 边框 + 墨色 icon。
 * 这个 class 同时服务 GPT Image 卡片当前的 arcade 变体；保持 variant 名 'arcade' 不改是为了和现有 i18n / 调用点兼容，
 * 实际渲染走 Atelier Editorial 视觉系统而不是旧霓虹 token。 */
const SHARE_PROMPT_ICON_BUTTON_CLASS_NAME =
  'inline-grid h-[36px] w-[36px] cursor-pointer place-items-center rounded-full border border-[var(--hairline)] bg-[var(--paper)]/90 text-[var(--ink-primary)] backdrop-blur-[2px] transition-colors duration-200 hover:border-[var(--marker)] hover:text-[var(--marker)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--marker)]';
const HANDDRAWN_SHARE_PROMPT_ICON_BUTTON_CLASS_NAME =
  'inline-grid h-[42px] w-[42px] cursor-pointer place-items-center rounded-[16px] border-[3px] border-[#2d2d2d] bg-[#fff9c4] text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-[#ff4d4d] hover:text-white hover:shadow-[2px_2px_0px_0px_#2d2d2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d5da1]';

/**
 * 计算分享成功提示的 viewport 坐标。
 * 反馈层通过 portal 挂到 body，所以位置必须从真实按钮 rect 推导，避免媒体容器的 overflow 把提示裁掉。
 */
function getFeedbackPosition(button: HTMLButtonElement): FeedbackPosition {
  const rect = button.getBoundingClientRect();

  return {
    top: Math.max(FEEDBACK_VIEWPORT_GUTTER, rect.top - FEEDBACK_OFFSET),
    left: Math.min(window.innerWidth - FEEDBACK_VIEWPORT_GUTTER, rect.right),
  };
}

/**
 * 渲染悬浮在媒体右上角的分享按钮。
 * 它被 prompt 卡片的媒体区调用；复制成功后通过 body portal 给出反馈，
 * 是为了让 hover 才显示的小按钮仍然能在用户点击后明确告知“分享链接已经写入剪贴板”。
 */
export function SharePromptButton({ promptId, label, copiedLabel, variant = 'arcade' }: SharePromptButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedbackPosition, setFeedbackPosition] = useState<FeedbackPosition | null>(null);
  const currentLabel = copied ? copiedLabel : label;
  const buttonClassName =
    variant === 'handdrawn' ? HANDDRAWN_SHARE_PROMPT_ICON_BUTTON_CLASS_NAME : SHARE_PROMPT_ICON_BUTTON_CLASS_NAME;
  const feedbackClassName =
    variant === 'handdrawn'
      ? 'pointer-events-none fixed z-[60] rounded-[18px] border-[3px] border-[#2d2d2d] bg-[#fff9c4] px-3 py-2 text-[11px] font-bold tracking-[0.08em] text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]'
      : 'pointer-events-none fixed z-[60] rounded-full border border-[var(--hairline)] bg-[var(--paper)] px-3 py-1.5 font-[var(--font-mono)] text-[11px] tracking-[0.08em] text-[var(--ink-primary)] shadow-[0_8px_24px_rgba(26,22,16,0.08)]';

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!copied) {
      return;
    }

    function updateFeedbackPosition() {
      if (!buttonRef.current) {
        return;
      }

      setFeedbackPosition(getFeedbackPosition(buttonRef.current));
    }

    window.addEventListener('resize', updateFeedbackPosition);
    window.addEventListener('scroll', updateFeedbackPosition, true);
    return () => {
      window.removeEventListener('resize', updateFeedbackPosition);
      window.removeEventListener('scroll', updateFeedbackPosition, true);
    };
  }, [copied]);

  /**
   * 复制当前 prompt 的公开分享链接。
   * 链接基于当前 landing page 路径生成并强制收口到 `?id=`，这样分享出去的人能直接落到目标卡片，而不是继承当前页面零散的本地筛选状态。
   */
  async function handleShare() {
    if (buttonRef.current) {
      setFeedbackPosition(getFeedbackPosition(buttonRef.current));
    }

    setCopied(true);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => {
      setCopied(false);
      setFeedbackPosition(null);
      feedbackTimerRef.current = null;
    }, FEEDBACK_TIMEOUT_MS);

    const shareUrl = buildPromptShareUrl(window.location.href, promptId);
    await copyTextWithFallback(shareUrl);
  }

  return (
    <>
      <button
        ref={buttonRef}
        className={buttonClassName}
        type="button"
        aria-label={currentLabel}
        onClick={handleShare}
      >
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M14 5a3 3 0 1 1 2.83 4h-1.07l-4.55 3.03a3 3 0 0 1 0 .94l4.55 3.03h1.07A3 3 0 1 1 14 19a3 3 0 0 1 .22-1.12l-4.56-3.04a3 3 0 1 1 0-5.68l4.56-3.04A3 3 0 0 1 14 5Z"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
      </button>
      {copied && feedbackPosition
        ? createPortal(
            <span
              className={feedbackClassName}
              style={{ top: feedbackPosition.top, left: feedbackPosition.left, transform: 'translate(-100%, -100%)' }}
              role="status"
            >
              {copiedLabel}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
