'use client';

/**
 * handdrawn-image-lightbox.tsx 渲染手绘 landing page 的全屏媒体预览弹层。
 * 它位于 landing-pages 的客户端展示层，被 PromptGallery 在 handdrawn 分支下挂载；
 * 弹层继续只消费当前媒体和导航回调，不持有页面级副作用，
 * 这样 Seedance 可以在同一套手绘视觉里查看图片和视频，而键盘/滚动锁语义仍留在父组件统一管理。
 */
import type { GalleryMedia } from '@/components/prompt-gallery-images';
import { Tooltip } from '@/components/ui/tooltip';
import { useRef } from 'react';

import { PromptGalleryVideo } from '@/components/prompt-gallery-video';
import { VideoFullscreenButton } from '@/components/video-fullscreen-button';

type HandDrawnImageLightboxCopy = {
  images: {
    open: string;
    previous: string;
    next: string;
    close: string;
    fullscreen: string;
    count: string;
  };
};

const wobbleMd = '26px 18px 28px 14px / 14px 30px 18px 28px';

/**
 * 格式化 lightbox 计数文案。
 * 这个 helper 被 HandDrawnImageLightbox 调用，用 i18n 模板替换数字；
 * 数字不硬编码在组件字符串里，是为了保持 landing-pages 多语言资源的单一来源。
 */
function formatImageCount(template: string, current: number, total: number): string {
  return template.replace('{{current}}', String(current)).replace('{{total}}', String(total));
}

/**
 * 渲染手绘风格的全屏媒体 lightbox。
 * 视频和图片继续共享同一套计数、关闭和左右导航 UI，
 * 是为了让 Seedance prompt 在查看 motion 结果时不需要跳到另一种完全不同的交互模型。
 * 视频在弹层里继续保留内联播放和显式全屏按钮，
 * 是为了让用户既能用原生 controls 拖动时间轴，也能随时切到浏览器级全屏查看镜头细节。
 */
export function HandDrawnImageLightbox({
  media,
  currentIndex,
  total,
  copy,
  onClose,
  onPrevious,
  onNext,
}: {
  media: GalleryMedia;
  currentIndex: number;
  total: number;
  copy: HandDrawnImageLightboxCopy;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const hasNavigation = total > 1;
  const imageCountLabel = formatImageCount(copy.images.count, currentIndex + 1, total);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(253,251,247,0.92)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy.images.open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="pointer-events-none absolute left-4 right-4 top-4 z-[2] flex items-center justify-between">
        <span
          className="inline-flex min-h-[42px] items-center border-[3px] border-[#2d2d2d] bg-[#fff9c4] px-4 text-[16px] font-bold text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]"
          style={{ borderRadius: wobbleMd, fontFamily: 'var(--font-handwritten-body)' }}
        >
          {imageCountLabel}
        </span>
        <Tooltip content={copy.images.close}>
          <button
            className="pointer-events-auto inline-grid h-[48px] w-[48px] place-items-center border-[3px] border-[#2d2d2d] bg-white text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]"
            style={{ borderRadius: wobbleMd }}
            type="button"
            aria-label={copy.images.close}
            onClick={onClose}
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          </button>
        </Tooltip>
      </div>
      <div className="relative grid max-h-[calc(100vh-120px)] max-w-[min(1180px,calc(100vw-40px))] place-items-center px-[68px] max-[640px]:px-[48px]">
        {hasNavigation ? (
          <Tooltip content={copy.images.previous}>
            <button
              className="absolute left-0 top-1/2 z-[2] inline-grid h-[48px] w-[48px] -translate-y-1/2 place-items-center border-[3px] border-[#2d2d2d] bg-white text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]"
              style={{ borderRadius: wobbleMd }}
              type="button"
              aria-label={copy.images.previous}
              onClick={onPrevious}
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m14.5 6.5-5 5.5 5 5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
              </svg>
            </button>
          </Tooltip>
        ) : null}
        <figure
          className="m-0 grid justify-items-center gap-4 border-[3px] border-[#2d2d2d] bg-white p-4 shadow-[8px_8px_0px_0px_#2d2d2d] max-[640px]:p-3"
          style={{ borderRadius: wobbleMd, transform: 'rotate(-0.4deg)' }}
        >
          {media.type === 'video' ? (
            <div className="relative">
              <PromptGalleryVideo
                videoRef={videoRef}
                className="block max-h-[calc(100vh-220px)] max-w-full object-contain"
                src={media.url}
                posterUrl={media.posterUrl || undefined}
                playbackKind={media.playbackKind}
                autoPlay
                controls
                playsInline
                preload="metadata"
              />
              <div className="pointer-events-none absolute bottom-3 right-3 z-[3]">
                <VideoFullscreenButton
                  videoRef={videoRef}
                  label={copy.images.fullscreen}
                  variant="handdrawn"
                  className="pointer-events-auto inline-grid h-[46px] w-[46px] cursor-pointer place-items-center border-[3px] border-[#2d2d2d] bg-[rgba(255,249,196,0.94)] text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]"
                />
              </div>
            </div>
          ) : (
            <img className="block max-h-[calc(100vh-220px)] max-w-full object-contain" src={media.url} alt={media.altText} />
          )}
          <figcaption className="max-w-[min(760px,100%)] text-center text-[18px] text-[#2d2d2d]/82" style={{ fontFamily: 'var(--font-handwritten-body)' }}>
            {media.title}
          </figcaption>
        </figure>
        {hasNavigation ? (
          <Tooltip content={copy.images.next}>
            <button
              className="absolute right-0 top-1/2 z-[2] inline-grid h-[48px] w-[48px] -translate-y-1/2 place-items-center border-[3px] border-[#2d2d2d] bg-white text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]"
              style={{ borderRadius: wobbleMd }}
              type="button"
              aria-label={copy.images.next}
              onClick={onNext}
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9.5 6.5 5 5.5-5 5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
              </svg>
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
