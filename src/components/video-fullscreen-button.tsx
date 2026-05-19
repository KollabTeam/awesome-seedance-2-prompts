'use client';

/**
 * video-fullscreen-button.tsx 提供 landing page 视频预览的显式全屏入口。
 * 它位于 landing-pages 的客户端交互层，被 Seedance 卡片和手绘媒体弹层复用；
 * 统一在这里处理浏览器全屏 API 与 iOS WebKit 兼容分支，是为了避免每个视频容器都重复维护一套全屏兜底逻辑。
 */
import type { MouseEvent, RefObject } from 'react';

import { Tooltip } from '@/components/ui/tooltip';

type VideoFullscreenButtonProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  label: string;
  variant?: 'arcade' | 'handdrawn';
  className: string;
  stopPropagation?: boolean;
};

type FullscreenCapableVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * 请求浏览器把当前视频切到全屏。
 * 这个 helper 被列表卡片和 lightbox 的全屏按钮共用；优先走标准 Fullscreen API，
 * 再回退到 WebKit 私有实现，是为了让移动 Safari 仍然能从同一个按钮进入视频全屏模式。
 */
export async function requestFullscreenForVideo(video: HTMLVideoElement) {
  const fullscreenVideo = video as FullscreenCapableVideoElement;

  if (typeof fullscreenVideo.requestFullscreen === 'function') {
    await fullscreenVideo.requestFullscreen();
    return;
  }

  if (typeof fullscreenVideo.webkitRequestFullscreen === 'function') {
    await fullscreenVideo.webkitRequestFullscreen();
    return;
  }

  if (typeof fullscreenVideo.webkitEnterFullscreen === 'function') {
    fullscreenVideo.webkitEnterFullscreen();
  }
}

/**
 * 渲染视频全屏按钮。
 * 这个按钮叠在视频右下角；点击时可选地阻止父层点击，是为了让“列表卡片点击打开弹层”和“只把当前视频切全屏”这两种动作不互相串扰。
 */
export function VideoFullscreenButton({
  videoRef,
  label,
  variant = 'handdrawn',
  className,
  stopPropagation = false,
}: VideoFullscreenButtonProps) {
  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (stopPropagation) {
      event.stopPropagation();
    }

    if (!videoRef.current) {
      return;
    }

    await requestFullscreenForVideo(videoRef.current);
  }

  return (
    <Tooltip content={label} variant={variant}>
      <button className={className} type="button" aria-label={label} onClick={handleClick}>
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M20 20h-4v-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
        </svg>
      </button>
    </Tooltip>
  );
}
