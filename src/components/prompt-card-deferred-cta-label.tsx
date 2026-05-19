'use client';

/**
 * prompt-card-deferred-cta-label.tsx 负责延迟显示 prompt card CTA 的用户可见文案。
 * 它位于 landing-pages 的展示组件层，只被 PromptCard 底部按钮复用；
 * 把文案挂载延迟到 hydration 之后，是为了保留现有 i18n CTA，同时减少服务端 HTML 里重复 CTA 文本对 prompt 关键词密度的干扰。
 */
import { useEffect, useState } from 'react';

/**
 * 在客户端 hydration 之后再显示 CTA 文案。
 * 这个组件被 PromptCard 的底部按钮调用；服务端和首帧 hydration 都保持空内容，
 * 是为了让 SSR 输出继续保留按钮结构和尺寸，但不把重复 CTA 文本提前写进首屏 HTML。
 */
export function PromptCardDeferredCtaLabel({ label }: { label: string }) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  return (
    <span
      className="inline-flex items-center justify-center transition-opacity duration-150"
      aria-hidden={!isHydrated}
    >
      {isHydrated ? label : null}
    </span>
  );
}
