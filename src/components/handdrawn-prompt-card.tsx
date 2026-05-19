'use client';

/**
 * handdrawn-prompt-card.tsx 渲染手绘落地页里的单张 prompt 卡片。
 * 它位于 landing-pages 的客户端展示层，被 PromptGallery 在 handdrawn 视觉分支下调用；
 * 单 prompt 的 Seedance 列表继续保留“视频在上、正文在下”的旧信息层级，
 * 双 prompt 的混合页则把 GPT Image 2 与 Seedance 2 分成上下两个 prompt section，
 * 并在底部只保留一个 Try in Kollab CTA：它会把“先出图，再把上一条图喂给视频模型”的桥接语一起预填进任务，
 * 这样同一张卡片既能展示图像参考与视频结果，也不会把两个模型的 prompt 混成一段难以复制的长文本。
 */
import { useRef, type ReactNode } from 'react';

import { CopyPromptButton } from '@/components/copy-prompt-button';
import { PromptCardDeferredCtaLabel } from '@/components/prompt-card-deferred-cta-label';
import { buildPromptGalleryMedia, type GalleryMedia } from '@/components/prompt-gallery-images';
import { PromptGalleryVideo } from '@/components/prompt-gallery-video';
import { SharePromptButton } from '@/components/share-prompt-button';
import { Tooltip } from '@/components/ui/tooltip';
import { VideoFullscreenButton } from '@/components/video-fullscreen-button';
import type { LandingPromptCommandConfig } from '@/lib/landing-page-config';
import type { PromptGalleryItem } from '@/lib/notion-prompts';

import { buildHandDrawnPairedPromptPrefill } from './handdrawn-prompt-prefill';
import { launchPrefilledKollabTask, launchPromptInKollabTask, openExternalLinkInNewWindow } from '@/components/prompt-gallery-card';

type HandDrawnPromptGalleryCardCopy = {
  images: {
    open: string;
    fullscreen: string;
  };
  actions: {
    copy: string;
    copied: string;
    share: string;
    shared: string;
    source: string;
    tryItNow: string;
  };
  sections?: {
    primaryPrompt: string;
    secondaryPrompt: string;
  };
};

type HandDrawnPromptSection = {
  id: 'primary' | 'secondary';
  label: string | null;
  prompt: string;
  accentClassName: string;
};

const wobbleCard = '28px 18px 32px 14px / 14px 34px 18px 30px';
const promptSectionBaseClassName =
  'grid gap-3 border-[3px] border-[#2d2d2d] px-4 py-3 shadow-[4px_4px_0px_0px_#2d2d2d]';

/**
 * 选择手绘卡片顶部要展示的主媒体。
 * 这个 helper 继续被老的单 prompt Seedance 卡片调用；视频优先，
 * 是为了保证 motion prompt 首屏就暴露时间轴，而不是被静态 poster 或参考图抢占主位。
 */
export function getHandDrawnPrimaryMedia(item: PromptGalleryItem): GalleryMedia | null {
  const mediaItems = buildPromptGalleryMedia(item);
  return mediaItems.find((media) => media.type === 'video') || mediaItems[0] || null;
}

/**
 * 拆出手绘卡片需要的双 prompt section。
 * 只有混合页同时存在 `secondaryPrompt` 和 secondary command 时才返回两段，
 * 这样旧 Seedance 页面不需要承担额外标题高度；底部合并 CTA 的拼接逻辑则留给独立 helper 处理。
 */
function buildHandDrawnPromptSections(
  item: PromptGalleryItem,
  promptCommand: LandingPromptCommandConfig,
  copy: HandDrawnPromptGalleryCardCopy,
): HandDrawnPromptSection[] | null {
  if (!item.secondaryPrompt?.trim() || !promptCommand.secondary) {
    return null;
  }

  return [
    {
      id: 'primary',
      label: copy.sections?.primaryPrompt || null,
      prompt: item.prompt,
      accentClassName: 'bg-[#fff9c4]',
    },
    {
      id: 'secondary',
      label: copy.sections?.secondaryPrompt || null,
      prompt: item.secondaryPrompt,
      accentClassName: 'bg-[#dff4ff]',
    },
  ];
}

/**
 * 读取卡片需要的首张图片和首条视频。
 * 混合页要求视频在上、图片在下，因此这里显式拆出两个槽位，
 * 而不是继续沿用“只挑一个主媒体”的旧 Seedance 逻辑。
 */
function getHandDrawnSplitMedia(item: PromptGalleryItem): {
  image: GalleryMedia | null;
  video: GalleryMedia | null;
} {
  const mediaItems = buildPromptGalleryMedia(item);
  return {
    image: mediaItems.find((media) => media.type === 'image') || null,
    video: mediaItems.find((media) => media.type === 'video') || null,
  };
}

/**
 * 渲染手绘风格作者头像。
 * 这个局部组件和 arcade 版本一样优先显示同步后的头像 URL，
 * 只是在纸张视觉里把外框改成粗线条，以保持 author 行仍来自同一份内容真相。
 */
function HandDrawnAuthorAvatar({ item }: { item: PromptGalleryItem }) {
  if (item.authorAvatarUrl) {
    return <img className="h-10 w-10 rounded-[14px] border-[3px] border-[#2d2d2d] object-cover" src={item.authorAvatarUrl} alt="" />;
  }

  return (
    <span className="inline-grid h-10 w-10 place-items-center rounded-[14px] border-[3px] border-[#2d2d2d] bg-[#fff9c4] text-[14px] font-bold text-[#2d2d2d]">
      {item.authorName.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * 渲染卡片底部的作者与来源信息。
 * 这个 footer 同时服务单 prompt 与双 prompt 卡片，并允许调用方把 CTA 塞进作者右侧；
 * 混合页把 Try in Kollab 收进这里，是为了让“两段 prompt section + 独立 CTA 行”的纵向节奏收短一些，
 * 同时仍保留作者与来源作为卡片收尾的固定锚点。
 */
function HandDrawnCardFooter({
  item,
  copy,
  aside = null,
}: {
  item: PromptGalleryItem;
  copy: HandDrawnPromptGalleryCardCopy;
  aside?: ReactNode;
}) {
  return (
    <footer className="grid gap-3 border-t-[3px] border-dashed border-[#2d2d2d] pt-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        {item.authorUrl ? (
          <a
            className="inline-flex min-w-0 max-w-full flex-1 items-center gap-3 border-[3px] border-[#2d2d2d] bg-[#fffdf9] px-3 py-2 text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]"
            style={{ borderRadius: wobbleCard, fontFamily: 'var(--font-handwritten-body)' }}
            href={item.authorUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => openExternalLinkInNewWindow(event, item.authorUrl!)}
          >
            <HandDrawnAuthorAvatar item={item} />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[18px]">{item.authorName}</span>
          </a>
        ) : (
          <span
            className="inline-flex min-w-0 max-w-full flex-1 items-center gap-3 border-[3px] border-[#2d2d2d] bg-[#fffdf9] px-3 py-2 text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d]"
            style={{ borderRadius: wobbleCard, fontFamily: 'var(--font-handwritten-body)' }}
          >
            <HandDrawnAuthorAvatar item={item} />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[18px]">{item.authorName}</span>
          </span>
        )}

        <div className="flex items-center gap-2">
          {aside}
          {item.sourceUrl ? (
            <Tooltip content={copy.actions.source} variant="handdrawn">
              <a
                className="inline-grid h-[46px] w-[46px] place-items-center border-[3px] border-[#2d2d2d] bg-white text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-[#ff4d4d] hover:text-white hover:shadow-[2px_2px_0px_0px_#2d2d2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d5da1] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                style={{ borderRadius: wobbleCard }}
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={copy.actions.source}
                onClick={(event) => openExternalLinkInNewWindow(event, item.sourceUrl!)}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7.5 16.5 16.5 7.5M10 7.5h6.5V14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </a>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

/**
 * 渲染双 prompt 卡片里的单个 prompt section。
 * section 内部只保留独立复制按钮，避免混合页出现两个 Try in Kollab CTA；
 * 真正执行时由卡片底部统一 CTA 负责把两条命令和桥接语一次性带进同一个任务。
 */
function HandDrawnPromptSectionCard({
  section,
  copy,
}: {
  section: HandDrawnPromptSection;
  copy: HandDrawnPromptGalleryCardCopy;
}) {
  return (
    <section className={`${promptSectionBaseClassName} ${section.accentClassName}`} style={{ borderRadius: wobbleCard }}>
      {section.label ? (
        <p className="m-0 text-[12px] font-bold uppercase tracking-[0.18em] text-[#2d2d2d]/72">
          {section.label}
        </p>
      ) : null}
      <p
        className="m-0 max-h-[180px] overflow-y-auto whitespace-pre-wrap text-[18px] leading-[1.55] text-[#2d2d2d]/84"
        style={{ fontFamily: 'var(--font-handwritten-body)' }}
      >
        {section.prompt}
      </p>
      <div className="flex items-center">
        <CopyPromptButton prompt={section.prompt} label={copy.actions.copy} copiedLabel={copy.actions.copied} variant="handdrawn" />
      </div>
    </section>
  );
}

/**
 * 渲染 handdrawn CTA 按钮。
 * 单 prompt 与双 prompt 卡片共用同一份按钮视觉，避免两条链路以后再出现样式分叉；
 * 文案仍延后到 hydration 后再显示，以保持首屏 SSR 和现有 CTA 测试约束一致。
 */
function HandDrawnTryInKollabButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-[52px] cursor-pointer items-center justify-center border-[3px] border-[#2d2d2d] bg-[#ff4d4d] px-4 text-[18px] font-bold text-white shadow-[4px_4px_0px_0px_#2d2d2d] transition-transform duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#2d2d2d]"
      style={{ borderRadius: wobbleCard, fontFamily: 'var(--font-handwritten-body)' }}
      type="button"
      aria-label={label}
      onClick={onClick}
    >
      <PromptCardDeferredCtaLabel label={label} />
    </button>
  );
}

/**
 * 渲染混合页的上下媒体槽位。
 * 视频始终在上、图片在下，是为了先暴露 motion 结果，再把来源图作为补充参考；
 * 如果没有图片就只保留视频，如果视频暂时缺失则继续显示图片，避免同步中的半成品卡片直接变空白。
 */
function HandDrawnSplitMediaPanel({
  item,
  image,
  video,
  copy,
  onMediaOpen,
}: {
  item: PromptGalleryItem;
  image: GalleryMedia | null;
  video: GalleryMedia | null;
  copy: HandDrawnPromptGalleryCardCopy;
  onMediaOpen: (itemId: string, mediaId: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasImage = Boolean(image);
  const hasVideo = Boolean(video);

  if (!hasImage && !hasVideo) {
    return (
      <div className="grid min-h-[260px] place-items-center border-[3px] border-dashed border-[#2d2d2d] bg-[#fff9c4]" style={{ borderRadius: wobbleCard }} />
    );
  }

  return (
    <div className="grid gap-4">
      {hasVideo ? (
        <div
          className="relative min-h-[220px] overflow-hidden border-[3px] border-[#2d2d2d] bg-[#fffdf9] shadow-[4px_4px_0px_0px_#2d2d2d]"
          style={{ borderRadius: wobbleCard, transform: hasImage ? 'rotate(0.7deg)' : 'rotate(-1.2deg)' }}
        >
          <PromptGalleryVideo
            videoRef={videoRef}
            className="block h-full w-full object-cover"
            src={video!.url}
            posterUrl={video!.posterUrl || undefined}
            playbackKind={video!.playbackKind}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[rgba(0,0,0,0.26)] to-transparent" />
          <div className="pointer-events-none absolute bottom-3 right-3 z-[4]">
            <VideoFullscreenButton
              videoRef={videoRef}
              label={copy.images.fullscreen}
              variant="handdrawn"
              className="pointer-events-auto inline-grid h-[42px] w-[42px] cursor-pointer place-items-center rounded-[16px] border-[3px] border-[#2d2d2d] bg-[rgba(255,249,196,0.94)] text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-[#ff4d4d] hover:text-white hover:shadow-[2px_2px_0px_0px_#2d2d2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d5da1]"
            />
          </div>
        </div>
      ) : null}
      {hasImage ? (
        <button
          className="relative min-h-[220px] overflow-hidden border-[3px] border-[#2d2d2d] bg-[#fffdf9] shadow-[4px_4px_0px_0px_#2d2d2d]"
          style={{ borderRadius: wobbleCard, transform: hasVideo ? 'rotate(-0.6deg)' : 'rotate(-1deg)' }}
          type="button"
          aria-label={copy.images.open}
          onClick={() => onMediaOpen(item.id, image!.id)}
        >
          <img className="block h-full w-full object-cover" src={image!.url} alt={image!.altText} loading="lazy" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * 渲染单个手绘 prompt 卡片。
 * 分享按钮继续悬浮在媒体右上角；桌面 hover 设备默认隐藏并在 hover/focus 时出现，
 * 触屏设备则默认保持可见，是为了让分享动作继续贴近当前镜头，同时避免移动端因为没有 hover 而失去入口。
 * 混合页（存在 secondary command）会把 Try in Kollab 挪到 footer 的作者右侧，
 * 这样两段 prompt section 不会再被单独的 CTA 行割裂，视觉重心也更靠近卡片收尾信息。
 */
export function HandDrawnPromptCard({
  item,
  copy,
  onMediaOpen,
  promptCommand,
}: {
  item: PromptGalleryItem;
  copy: HandDrawnPromptGalleryCardCopy;
  onMediaOpen: (itemId: string, mediaId: string) => void;
  promptCommand: LandingPromptCommandConfig;
}) {
  const primaryMedia = getHandDrawnPrimaryMedia(item);
  const splitMedia = getHandDrawnSplitMedia(item);
  const promptSections = buildHandDrawnPromptSections(item, promptCommand, copy);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shouldPlaceTryButtonInFooter = Boolean(promptCommand.secondary);

  if (promptSections) {
    const pairedTryButton = (
      <HandDrawnTryInKollabButton
        label={copy.actions.tryItNow}
        onClick={() =>
          launchPrefilledKollabTask(
            buildHandDrawnPairedPromptPrefill({
              primaryPrompt: item.prompt,
              secondaryPrompt: item.secondaryPrompt!,
            }),
          )
        }
      />
    );

    return (
      <article
        className="group relative grid content-start gap-4 border-[3px] border-[#2d2d2d] bg-white p-4 shadow-[6px_6px_0px_0px_#2d2d2d] transition-transform duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[4px_4px_0px_0px_#2d2d2d]"
        style={{
          borderRadius: wobbleCard,
          transform: item.accentIndex % 2 === 0 ? 'rotate(-0.8deg)' : 'rotate(0.9deg)',
        }}
      >
        <span className="pointer-events-none absolute left-1/2 top-0 h-8 w-28 -translate-x-1/2 -translate-y-1/2 rotate-[-6deg] bg-[#d9d9d9]/70" />
        <div className="prompt-share-shell group/media-shell relative">
          <div className="prompt-share-overlay pointer-events-none absolute right-3 top-3 z-[5] transition-opacity duration-150">
            <div className="pointer-events-auto">
              <SharePromptButton promptId={item.id} label={copy.actions.share} copiedLabel={copy.actions.shared} variant="handdrawn" />
            </div>
          </div>
          <HandDrawnSplitMediaPanel item={item} image={splitMedia.image} video={splitMedia.video} copy={copy} onMediaOpen={onMediaOpen} />
        </div>

        <div className="grid gap-4">
          {promptSections.map((section) => (
            <HandDrawnPromptSectionCard key={section.id} section={section} copy={copy} />
          ))}
          {shouldPlaceTryButtonInFooter ? null : <div className="flex justify-end">{pairedTryButton}</div>}
        </div>

        <HandDrawnCardFooter item={item} copy={copy} aside={shouldPlaceTryButtonInFooter ? pairedTryButton : null} />
      </article>
    );
  }

  const singleTryButton = <HandDrawnTryInKollabButton label={copy.actions.tryItNow} onClick={() => launchPromptInKollabTask(item.prompt, promptCommand.primary)} />;

  return (
    <article
      className="group relative grid content-start gap-4 border-[3px] border-[#2d2d2d] bg-white p-4 shadow-[6px_6px_0px_0px_#2d2d2d] transition-transform duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[4px_4px_0px_0px_#2d2d2d]"
      style={{
        borderRadius: wobbleCard,
        transform: item.accentIndex % 2 === 0 ? 'rotate(-0.8deg)' : 'rotate(0.9deg)',
      }}
    >
      <span className="pointer-events-none absolute left-1/2 top-0 h-8 w-28 -translate-x-1/2 -translate-y-1/2 rotate-[-6deg] bg-[#d9d9d9]/70" />
      <div className="prompt-share-shell group/media-shell relative min-h-[230px] md:min-h-[300px]">
        <div className="prompt-share-overlay pointer-events-none absolute right-3 top-3 z-[5] transition-opacity duration-150">
          <div className="pointer-events-auto">
            <SharePromptButton promptId={item.id} label={copy.actions.share} copiedLabel={copy.actions.shared} variant="handdrawn" />
          </div>
        </div>
        {primaryMedia ? (
          primaryMedia.type === 'video' ? (
            <div
              className="absolute inset-0 overflow-hidden border-[3px] border-[#2d2d2d] bg-[#fffdf9] shadow-[4px_4px_0px_0px_#2d2d2d]"
              style={{ borderRadius: wobbleCard, transform: 'rotate(-1.4deg)' }}
            >
              <PromptGalleryVideo
                videoRef={videoRef}
                className="block h-full w-full object-cover"
                src={primaryMedia.url}
                posterUrl={primaryMedia.posterUrl || undefined}
                playbackKind={primaryMedia.playbackKind}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[rgba(0,0,0,0.26)] to-transparent" />
              <div className="pointer-events-none absolute bottom-3 right-3 z-[4]">
                <VideoFullscreenButton
                  videoRef={videoRef}
                  label={copy.images.fullscreen}
                  variant="handdrawn"
                  className="pointer-events-auto inline-grid h-[42px] w-[42px] cursor-pointer place-items-center rounded-[16px] border-[3px] border-[#2d2d2d] bg-[rgba(255,249,196,0.94)] text-[#2d2d2d] shadow-[4px_4px_0px_0px_#2d2d2d] transition-all duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-[#ff4d4d] hover:text-white hover:shadow-[2px_2px_0px_0px_#2d2d2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d5da1]"
                />
              </div>
            </div>
          ) : (
            <button
              className="absolute inset-0 overflow-hidden border-[3px] border-[#2d2d2d] bg-[#fffdf9] shadow-[4px_4px_0px_0px_#2d2d2d]"
              style={{ borderRadius: wobbleCard, transform: 'rotate(-1.4deg)' }}
              type="button"
              aria-label={copy.images.open}
              onClick={() => onMediaOpen(item.id, primaryMedia.id)}
            >
              <img className="block h-full w-full object-cover" src={primaryMedia.url} alt={item.prompt} loading="lazy" />
            </button>
          )
        ) : (
          <div className="grid h-full min-h-[230px] place-items-center border-[3px] border-dashed border-[#2d2d2d] bg-[#fff9c4] md:min-h-[300px]" style={{ borderRadius: wobbleCard }} />
        )}
      </div>
      <p
        className="m-0 max-h-[240px] overflow-y-auto whitespace-pre-wrap text-[20px] leading-[1.5] text-[#2d2d2d]/82 md:text-[21px]"
        style={{ fontFamily: 'var(--font-handwritten-body)' }}
      >
        {item.prompt}
      </p>

      <div className={`flex items-center gap-3 ${shouldPlaceTryButtonInFooter ? 'justify-start' : 'justify-between'}`}>
        <CopyPromptButton prompt={item.prompt} label={copy.actions.copy} copiedLabel={copy.actions.copied} variant="handdrawn" />
        {shouldPlaceTryButtonInFooter ? null : singleTryButton}
      </div>

      <HandDrawnCardFooter item={item} copy={copy} aside={shouldPlaceTryButtonInFooter ? singleTryButton : null} />
    </article>
  );
}
