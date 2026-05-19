'use client';

/**
 * tooltip.tsx 为 landing-pages 提供本地轻量 tooltip。
 * 它位于组件基础交互层，被 prompt card 这类 icon-only 触发器复用；
 * 这里不引入额外依赖，是为了在保持可访问语义的同时，把落地页 bundle 变化控制在最小范围。
 */
import { cloneElement, useEffect, useId, useRef, useState, type FocusEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

type TooltipTriggerProps = {
  'aria-describedby'?: string;
};

type TooltipProps = {
  content: string;
  children: ReactElement<TooltipTriggerProps>;
  variant?: 'arcade' | 'handdrawn';
  wrapperClassName?: string;
};

type TooltipPosition = {
  top: number;
  left: number;
};

const TOOLTIP_VIEWPORT_GUTTER = 12;
const TOOLTIP_OFFSET = 10;
const TOOLTIP_CLASS_BY_VARIANT = {
  arcade:
    'pointer-events-none fixed z-[70] inline-flex max-w-[min(280px,calc(100vw-24px))] -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-full border-4 border-[var(--accent-cyan)] bg-[var(--surface)] px-3 py-2 text-[11px] font-black tracking-[0.1em] text-[var(--ink)] shadow-[var(--shadow-glow)]',
  handdrawn:
    'pointer-events-none fixed z-[70] inline-flex max-w-[min(280px,calc(100vw-24px))] -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap border-[3px] border-[#2d2d2d] bg-[#fff9c4] px-3 py-2 text-[15px] font-bold leading-none text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]',
} as const;

/**
 * 计算 tooltip 的 viewport 坐标。
 * 这个 helper 被 Tooltip 在 hover/focus 与滚动恢复时调用；tooltip 现在通过 portal 挂到 body，
 * 是为了规避 prompt card 这类 `overflow-hidden` 容器对提示层的裁切。
 * left 会按 tooltip 实际宽度做 viewport clamp，避免按钮靠近右侧时提示文案再被屏幕边缘截断。
 */
function getTooltipPosition(trigger: HTMLElement, tooltipWidth: number): TooltipPosition {
  const rect = trigger.getBoundingClientRect();
  const halfWidth = tooltipWidth / 2;
  const unclampedLeft = rect.left + rect.width / 2;
  const minLeft = TOOLTIP_VIEWPORT_GUTTER + halfWidth;
  const maxLeft = window.innerWidth - TOOLTIP_VIEWPORT_GUTTER - halfWidth;

  return {
    top: Math.max(TOOLTIP_VIEWPORT_GUTTER, rect.top - TOOLTIP_OFFSET),
    left: Math.min(maxLeft, Math.max(minLeft, unclampedLeft)),
  };
}

/**
 * 为单个触发器补齐 tooltip 文案和 aria-describedby 关联。
 * 这个组件被 icon-only 的 button / anchor 包裹使用；提示层改为通过 portal 渲染到 body，
 * 是为了让 prompt card 和 lightbox 内的 tooltip 不再被局部 overflow 裁切。
 * `variant` 默认保持 GPT Image 的 arcade 样式，Seedance 手绘卡片显式传入 handdrawn，
 * 避免一个新页面的视觉修正反向影响已经上线的 GPT Image prompt 页面。
 * hover 和 focus 共用同一套显隐与定位逻辑，避免鼠标和键盘用户看到两套不一致的位置行为。
 */
export function Tooltip({ content, children, variant = 'arcade', wrapperClassName }: TooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const describedBy = [children.props['aria-describedby'], visible ? tooltipId : null].filter(Boolean).join(' ');
  const wrapperClasses = ['relative inline-flex', wrapperClassName].filter(Boolean).join(' ');

  /**
   * 依据触发器和 tooltip 实际宽度重新定位提示层。
   * 这个回调被显示、窗口 resize 和嵌套滚动容器 scroll 复用；
   * 不直接把 tooltip 固定在触发器局部坐标里，是因为 portal 已经脱离原布局树，必须显式换算成 viewport 坐标。
   */
  function updatePosition() {
    if (!triggerRef.current || !tooltipRef.current) {
      return;
    }

    setPosition(getTooltipPosition(triggerRef.current, tooltipRef.current.offsetWidth));
  }

  useEffect(() => {
    if (!visible) {
      return;
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [visible]);

  function handleShow() {
    setVisible(true);
  }

  function handleHide() {
    setVisible(false);
    setPosition(null);
  }

  function handleBlur(event: FocusEvent<HTMLSpanElement>) {
    if (event.relatedTarget && triggerRef.current?.contains(event.relatedTarget as Node)) {
      return;
    }
    handleHide();
  }

  return (
    <span className={wrapperClasses} ref={triggerRef} onMouseEnter={handleShow} onMouseLeave={handleHide} onFocusCapture={handleShow} onBlurCapture={handleBlur}>
      {cloneElement(children, {
        'aria-describedby': describedBy || undefined,
      })}
      {visible
        ? createPortal(
            <span
              ref={tooltipRef}
              className={TOOLTIP_CLASS_BY_VARIANT[variant]}
              style={{
                borderRadius: variant === 'handdrawn' ? '28px 18px 32px 14px / 14px 34px 18px 30px' : undefined,
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                visibility: position ? 'visible' : 'hidden',
              }}
              id={tooltipId}
              role="tooltip"
            >
              {content}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
