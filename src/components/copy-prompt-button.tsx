'use client';

/**
 * copy-prompt-button.tsx 提供 prompt 卡片里的复制控件。
 * 它位于 landing-pages 的轻量客户端交互层，只负责 Clipboard API、tooltip、反馈浮层和 arcade 风格按钮状态，
 * 页面数据、卡片布局和 SEO 内容仍由服务端组件生成，避免整页因为一个复制按钮退化成客户端渲染。
 * icon button 和 tooltip 都按视觉变体分流；默认 arcade 保持 GPT Image 页面现状，
 * handdrawn 只服务 Seedance 这类手绘落地页，避免视觉修正跨页面串味。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Tooltip } from '@/components/ui/tooltip';
import { copyTextWithFallback } from '@/lib/clipboard';

type CopyPromptButtonProps = {
  prompt: string;
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
const COPY_PROMPT_ICON_BUTTON_CLASS_NAME =
  'inline-grid h-[46px] w-[46px] place-items-center rounded-[16px] border-4 border-[var(--accent-cyan)] bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-glow),4px_4px_0_var(--accent-purple)] transition-all duration-200 hover:-translate-y-1 hover:rotate-[4deg] hover:border-[var(--accent-yellow)] hover:bg-[var(--surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-cyan)] max-[640px]:h-[42px] max-[640px]:w-[42px] max-[640px]:rounded-[14px]';
const HANDDRAWN_COPY_PROMPT_ICON_BUTTON_CLASS_NAME =
  'inline-grid h-[46px] w-[46px] place-items-center rounded-[18px] border-[3px] border-[#2d2d2d] bg-white text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-[#ff4d4d] hover:text-white hover:shadow-[2px_2px_0px_0px_#2d2d2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d5da1] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none max-[640px]:h-[42px] max-[640px]:w-[42px]';

/**
 * 计算复制成功提示的 viewport 坐标。
 * 这个 helper 被 CopyPromptButton 的点击和滚动/resize 恢复调用；
 * 反馈层通过 portal 挂到 document.body，所以位置必须从真实按钮 rect 派生，
 * 而不是继续依赖 prompt card 内部的 absolute 定位，否则会被卡片 overflow 裁掉。
 */
function getFeedbackPosition(button: HTMLButtonElement): FeedbackPosition {
  const rect = button.getBoundingClientRect();

  return {
    top: Math.max(FEEDBACK_VIEWPORT_GUTTER, rect.top - FEEDBACK_OFFSET),
    left: Math.min(window.innerWidth - FEEDBACK_VIEWPORT_GUTTER, rect.right),
  };
}

/**
 * 渲染 icon-only 复制按钮。
 * 这个组件被每张 prompt 卡片调用；aria-label 和 tooltip 文案都由 i18n 文案驱动，
 * 复制成功后额外显示短暂的可见反馈，避免用户只看到图标状态变化而无法确认内容已进入剪贴板。
 * 反馈层通过 portal 渲染到 body，避免被 prompt card/footer 的 overflow-hidden 裁切。
 */
export function CopyPromptButton({ prompt, label, copiedLabel, variant = 'arcade' }: CopyPromptButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedbackPosition, setFeedbackPosition] = useState<FeedbackPosition | null>(null);
  const currentLabel = copied ? copiedLabel : label;
  const buttonClassName =
    variant === 'handdrawn'
      ? `${HANDDRAWN_COPY_PROMPT_ICON_BUTTON_CLASS_NAME} cursor-pointer`
      : `${COPY_PROMPT_ICON_BUTTON_CLASS_NAME} cursor-pointer`;
  const feedbackClassName =
    variant === 'handdrawn'
      ? 'pointer-events-none fixed z-[60] rounded-[18px] border-[3px] border-[#2d2d2d] bg-[#fff9c4] px-3 py-2 text-[11px] font-bold tracking-[0.08em] text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]'
      : 'pointer-events-none fixed z-[60] rounded-full border-4 border-[var(--accent-cyan)] bg-[var(--surface)] px-3 py-2 text-[11px] font-black tracking-[0.1em] text-[var(--ink)] shadow-[var(--shadow-glow)]';

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
   * 将 prompt 写入系统剪贴板。
   * 复制走共享的 copyTextWithFallback：优先 Clipboard API，失败时落 textarea fallback；
   * IAB 对返回值不稳定，所以点击后立即展示 body portal 反馈，复制动作在后台尽力完成。
   */
  async function handleCopy() {
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

    await copyTextWithFallback(prompt);
  }

  return (
    <>
      <Tooltip content={currentLabel} variant={variant === 'handdrawn' ? 'handdrawn' : 'arcade'}>
        <button
          ref={buttonRef}
          className={buttonClassName}
          type="button"
          aria-label={currentLabel}
          onClick={handleCopy}
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 7.5C9 6.12 10.12 5 11.5 5h5C17.88 5 19 6.12 19 7.5v5c0 1.38-1.12 2.5-2.5 2.5h-5A2.5 2.5 0 0 1 9 12.5v-5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path
              d="M6.5 9H6a2 2 0 0 0-2 2v5.5A2.5 2.5 0 0 0 6.5 19H12a2 2 0 0 0 2-2v-.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.7"
            />
          </svg>
        </button>
      </Tooltip>
      {copied && feedbackPosition
        ? createPortal(
            <span
              className={feedbackClassName}
              style={{ top: feedbackPosition.top, left: feedbackPosition.left, transform: 'translate(-100%, -100%)' }}
              role="status"
            >
              {copiedLabel}
            </span>,
            document.body
          )
        : null}
    </>
  );
}
