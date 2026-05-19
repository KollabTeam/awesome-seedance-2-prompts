'use client';

/**
 * prompt-gallery-video.tsx 负责统一渲染 landing-pages 中的 mp4 与 HLS 视频。
 * 它位于 landing-pages 的客户端媒体层，被手绘卡片和手绘 lightbox 复用；
 * Cloudflare Stream ready 后会返回 HLS manifest，而旧数据和失败回退仍是 mp4，
 * 所以这里把浏览器原生 HLS 与 hls.js fallback 收口，避免业务组件重复处理播放器分支。
 */
import Hls from 'hls.js';
import { useEffect, useMemo, useRef, type ComponentPropsWithoutRef, type MutableRefObject, type RefObject } from 'react';

type PromptGalleryVideoProps = Omit<ComponentPropsWithoutRef<'video'>, 'poster' | 'src'> & {
  src: string;
  posterUrl?: string | null;
  playbackKind?: 'mp4' | 'hls';
  videoRef?: RefObject<HTMLVideoElement | null>;
};

export const DEFAULT_HLS_CLIENT_BANDWIDTH_HINT = 10_000_000;

type PromptGalleryVideoAutoplayTarget = Pick<HTMLVideoElement, 'autoplay' | 'play'>;
type PromptGalleryVideoVisibilityTarget = PromptGalleryVideoAutoplayTarget &
  Pick<HTMLVideoElement, 'pause'> & {
    paused: boolean;
  };
type PromptGalleryVideoMuteTarget = Pick<HTMLVideoElement, 'muted'>;

/**
 * 给 Cloudflare Stream manifest 附加 `clientBandwidthHint`。
 * landing-pages 统一把 HLS 预览拉到较高清晰度，因此由这个 helper 负责把同一组参数拼到 manifest URL，
 * 避免卡片预览、lightbox 和浏览器级全屏各自维护一套 query 拼接细节。
 */
function appendPromptGalleryClientBandwidthHint(src: string, bandwidthHintMbps: number): string {
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}clientBandwidthHint=${bandwidthHintMbps}`;
}

/**
 * 解析当前视频元素应使用的实际播放地址。
 * mp4 继续保持原始 URL；Cloudflare Stream HLS 预览统一追加最大 `clientBandwidthHint`，
 * 这样列表卡片、lightbox 和原生全屏都优先拿高码率版本，不再依赖额外的容器测量或进入全屏后的二次切换。
 */
export function resolvePromptGalleryVideoPlaybackUrl(
  src: string,
  playbackKind: 'mp4' | 'hls',
): string {
  if (playbackKind !== 'hls') {
    return src;
  }
  return appendPromptGalleryClientBandwidthHint(src, DEFAULT_HLS_CLIENT_BANDWIDTH_HINT);
}

/**
 * 在媒体源由运行时后挂载时，主动补一次 autoplay 恢复。
 * handdrawn gallery 的 HLS 分支不会像普通 mp4 那样在初次 DOM 挂载时就带着最终媒体源，
 * 浏览器经常不会因为最初的 `autoPlay` 属性自动重试，所以这里在 manifest/metadata ready 后显式 `play()` 一次。
 * 失败时静默吞掉 Promise rejection：常见原因是页面切后台、用户省流或浏览器临时中断，
 * 这些都不应该把 landing page 变成未处理异常。
 */
export async function recoverPromptGalleryVideoAutoplay(video: PromptGalleryVideoAutoplayTarget): Promise<void> {
  if (!video.autoplay) {
    return;
  }

  try {
    await video.play();
  } catch {
    // 自动播放恢复失败时保持静默回退，让 poster/controls 继续作为浏览器默认兜底体验。
  }
}

/**
 * 根据当前可见性同步视频播放状态。
 * 这个 helper 被列表卡片和 lightbox 的 IntersectionObserver 回调复用：
 * 元素可见时，只为 autoplay 视频尝试恢复播放；元素不可见时一律暂停，
 * 这样长列表滚出视口后的视频不会继续消耗解码和带宽。
 */
export async function syncPromptGalleryVideoVisibility(
  video: PromptGalleryVideoVisibilityTarget,
  isVisible: boolean,
): Promise<void> {
  if (isVisible) {
    await recoverPromptGalleryVideoAutoplay(video);
    return;
  }

  if (!video.paused) {
    video.pause();
  }
}

/**
 * 在视频退出浏览器级全屏后恢复默认静音状态。
 * landing page 里的视频默认都是静音自动播放；如果用户在全屏原生控件里手动开了声音，
 * 退出全屏后继续保留有声状态会让列表态失去关闭入口，所以这里在退出全屏时统一回到静音。
 */
export function syncPromptGalleryVideoFullscreenMute(
  video: PromptGalleryVideoMuteTarget,
  isFullscreen: boolean,
): void {
  if (!isFullscreen) {
    video.muted = true;
  }
}

/**
 * 渲染 gallery 里的视频元素，并在需要时挂上 hls.js。
 * 组件始终保留同一个 `<video>` DOM，以便全屏按钮、controls 和 autoplay 状态继续指向同一实例；
 * HLS 分支只有在浏览器没有原生 HLS 支持时才接管，是为了优先复用 Safari/iOS 的原生播放能力。
 */
export function PromptGalleryVideo({
  src,
  posterUrl = null,
  playbackKind = 'mp4',
  videoRef,
  ...videoProps
}: PromptGalleryVideoProps) {
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const visibilityStateRef = useRef(false);
  const playbackUrl = useMemo(() => resolvePromptGalleryVideoPlaybackUrl(src, playbackKind), [src, playbackKind]);

  /**
   * 观察当前视频元素是否进入视口。
   * 列表里的自动播放预览如果离开视口后继续解码，会让同页多个视频在后台同时播放；
   * 这里用 IntersectionObserver 把播放权限定在可见元素上，浏览器不支持该 API 时再保留旧的直接播放兜底。
   */
  useEffect(() => {
    const video = internalRef.current;
    if (!video) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      visibilityStateRef.current = true;
      void syncPromptGalleryVideoVisibility(video, true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }

        const isVisible = entry.isIntersecting && entry.intersectionRatio > 0;
        visibilityStateRef.current = isVisible;
        void syncPromptGalleryVideoVisibility(video, isVisible);
      },
      {
        threshold: 0.05,
      },
    );

    observer.observe(video);

    return () => {
      observer.disconnect();
    };
  }, []);

  /**
   * 监听浏览器级全屏状态，并在退出时把视频恢复成静音。
   * 标准 Fullscreen API 和 WebKit 私有事件都要覆盖，
   * 因为移动 Safari 仍然会通过 `webkitbeginfullscreen` / `webkitendfullscreen` 驱动原生视频全屏。
   */
  useEffect(() => {
    const video = internalRef.current;
    if (!video) {
      return;
    }

    const syncStandardFullscreenMute = () => {
      const fullscreenElement = typeof document !== 'undefined' ? document.fullscreenElement : null;
      syncPromptGalleryVideoFullscreenMute(video, fullscreenElement === video);
    };

    const handleWebkitBeginFullscreen = () => {
      syncPromptGalleryVideoFullscreenMute(video, true);
    };

    const handleWebkitEndFullscreen = () => {
      syncPromptGalleryVideoFullscreenMute(video, false);
    };

    document.addEventListener('fullscreenchange', syncStandardFullscreenMute);
    video.addEventListener('webkitbeginfullscreen', handleWebkitBeginFullscreen as EventListener);
    video.addEventListener('webkitendfullscreen', handleWebkitEndFullscreen as EventListener);

    return () => {
      document.removeEventListener('fullscreenchange', syncStandardFullscreenMute);
      video.removeEventListener('webkitbeginfullscreen', handleWebkitBeginFullscreen as EventListener);
      video.removeEventListener('webkitendfullscreen', handleWebkitEndFullscreen as EventListener);
    };
  }, []);

  useEffect(() => {
    const video = internalRef.current;
    if (!video || playbackKind !== 'hls') {
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      if (video.src !== playbackUrl) {
        video.src = playbackUrl;
      }

      const handleLoadedMetadata = () => {
        void syncPromptGalleryVideoVisibility(video, visibilityStateRef.current);
      };

      video.addEventListener('loadedmetadata', handleLoadedMetadata);

      if (video.readyState >= 1 && visibilityStateRef.current) {
        void syncPromptGalleryVideoVisibility(video, true);
      }

      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
    }

    if (!Hls.isSupported()) {
      return;
    }

    video.removeAttribute('src');
    video.load();

    const hls = new Hls();
    const handleManifestParsed = () => {
      void syncPromptGalleryVideoVisibility(video, visibilityStateRef.current);
    };

    hls.on(Hls.Events.MANIFEST_PARSED, handleManifestParsed);
    hls.loadSource(playbackUrl);
    hls.attachMedia(video);

    return () => {
      hls.off(Hls.Events.MANIFEST_PARSED, handleManifestParsed);
      hls.destroy();
    };
  }, [playbackKind, playbackUrl]);

  return (
    <video
      {...videoProps}
      ref={(node) => {
        internalRef.current = node;
        if (videoRef) {
          (videoRef as MutableRefObject<HTMLVideoElement | null>).current = node;
        }
      }}
      src={playbackUrl}
      poster={posterUrl || undefined}
    />
  );
}
