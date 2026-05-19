/**
 * prompt-gallery-images.ts 负责 landing prompt gallery 的媒体分组与预览导航规则。
 * 它位于 landing-pages 客户端组件的纯逻辑层，被 PromptGallery、手绘卡片和组件测试复用；
 * 把图片/视频分组逻辑从 UI 组件里拆出，是为了让不同视觉变体共享同一份媒体真相，同时各自决定展示方式。
 */
import type { PromptGalleryItem } from '@/lib/notion-prompts';

export type GalleryImage = {
  id: string;
  itemId: string;
  imageIndex: number;
  title: string;
  altText: string;
  url: string;
};

export type PromptPreviewMediaItem = {
  id: string;
  type: 'image' | 'video';
  url: string;
  playbackKind: 'mp4' | 'hls';
  posterUrl: string | null;
  imageIndex: number | null;
  /** 原始媒体尺寸，来自同步表；用于在 SSR 阶段为 <img>/<video> 预留正确比例容器，避免 CLS。
   * 旧 Notion 兼容路径不携带尺寸，命中时为 null，调用方需要回退到自然加载布局。 */
  width: number | null;
  height: number | null;
};

export type ActiveGalleryImageState = {
  itemId: string;
  imageIndex: number;
};

export type GalleryMedia = {
  id: string;
  itemId: string;
  mediaIndex: number;
  type: 'image' | 'video';
  title: string;
  altText: string;
  url: string;
  playbackKind: 'mp4' | 'hls';
  posterUrl: string | null;
};

export type ActiveGalleryMediaState = {
  itemId: string;
  mediaId: string;
};

/**
 * 生成 lightbox 图片的稳定 id。
 * 这个 helper 被当前 prompt 图片组构建时调用；id 只依赖 Notion page id 与图片顺序，
 * 是为了后续追加分页数据时，弹层里的图片身份不会因为 React 重渲染而漂移。
 */
function createGalleryImageId(itemId: string, imageIndex: number): string {
  return `${itemId}::${imageIndex}`;
}

/**
 * 生成媒体预览的稳定 id。
 * 这个 helper 被手绘卡片和手绘 lightbox 的 fallback 图片媒体调用；
 * 当旧数据里还没有同步后的 `media.id` 时，前端仍然可以用 `(itemId, mediaIndex)` 稳定定位当前媒体。
 */
function createGalleryMediaId(itemId: string, mediaIndex: number): string {
  return `${itemId}::media::${mediaIndex}`;
}

/**
 * 读取单张 prompt 卡片可展示的图片 URL。
 * 这个 helper 同时兼容新的 imageUrls 数组和旧的 imageUrl 字段；
 * 这样 Next Data Cache 或旧接口响应里只有第一张图时，卡片仍能打开 lightbox。
 */
export function getPromptImageUrls(item: PromptGalleryItem): string[] {
  const mediaImageUrls = (item.media || [])
    .filter((media) => media.type === 'image')
    .map((media) => media.detailUrl || media.cardUrl || media.url)
    .filter(Boolean);
  if (mediaImageUrls.length > 0) {
    return Array.from(new Set(mediaImageUrls));
  }

  const urls = (item.imageUrls && item.imageUrls.length > 0 ? item.imageUrls : item.imageUrl ? [item.imageUrl] : []).filter(Boolean);
  return Array.from(new Set(urls));
}

/**
 * 读取 prompt 卡片顶部可预览的有序媒体。
 * DB 同步后的 read model 会提供 image/video 混合资源；旧 Notion 响应只有 imageUrls，
 * 因此这里保留兼容 fallback，让前端可以逐步切到完整媒体模型而不破坏现有 lightbox。
 */
export function getPromptPreviewMediaItems(item: PromptGalleryItem): PromptPreviewMediaItem[] {
  if (item.media && item.media.length > 0) {
    let imageIndex = 0;
    return item.media
      .map((media) => {
        const url = media.type === 'image' ? media.cardUrl || media.detailUrl || media.url : media.url;
        if (!url) {
          return null;
        }

        const preview: PromptPreviewMediaItem = {
          id: media.id,
          type: media.type,
          url,
          playbackKind: media.playbackKind || 'mp4',
          posterUrl: media.posterUrl || (media.type === 'video' ? media.cardUrl : null),
          imageIndex: media.type === 'image' ? imageIndex : null,
          width: media.width,
          height: media.height,
        };

        if (media.type === 'image') {
          imageIndex += 1;
        }

        return preview;
      })
      .filter((media): media is PromptPreviewMediaItem => Boolean(media));
  }

  return getPromptImageUrls(item).map((url, imageIndex) => ({
    id: createGalleryImageId(item.id, imageIndex),
    type: 'image',
    url,
    playbackKind: 'mp4',
    posterUrl: null,
    imageIndex,
    width: null,
    height: null,
  }));
}

/**
 * 将单个 prompt 展开成 lightbox 图片列表。
 * 这个方法被 PromptGallery 在打开弹层时调用；只返回当前 prompt 的图片，
 * 是为了避免单图 prompt 用方向键切到其它 prompt，保持图片查看范围和用户点击的卡片一致。
 * lightbox 的 alt 文本直接复用 prompt 真值，而不是标题或装饰词，
 * 这样查看大图时的无障碍描述仍然和用户真正执行的提示词保持同一来源。
 */
export function buildPromptGalleryImages(item: PromptGalleryItem): GalleryImage[] {
  return getPromptImageUrls(item).map((url, imageIndex) => ({
    id: createGalleryImageId(item.id, imageIndex),
    itemId: item.id,
    imageIndex,
    title: item.title,
    altText: item.prompt,
    url,
  }));
}

/**
 * 将单个 prompt 展开成可顺序浏览的图片/视频媒体列表。
 * 这个方法被 Seedance 手绘卡片和其 lightbox 调用；它优先使用同步后的 `item.media`，
 * 是为了让视频 prompt 直接复用落库后的 mp4 与 poster 元数据，而不是再从旧的 imageUrls 里猜测媒体类型。
 */
export function buildPromptGalleryMedia(item: PromptGalleryItem): GalleryMedia[] {
  if (item.media && item.media.length > 0) {
    return item.media
      .map((media, mediaIndex) => {
        const url = media.type === 'image' ? media.detailUrl || media.cardUrl || media.url : media.url;
        if (!url) {
          return null;
        }

        return {
          id: media.id || createGalleryMediaId(item.id, mediaIndex),
          itemId: item.id,
          mediaIndex,
          type: media.type,
          title: item.title,
          altText: item.prompt,
          url,
          playbackKind: media.playbackKind || 'mp4',
          posterUrl: media.posterUrl || (media.type === 'video' ? media.cardUrl : null),
        } satisfies GalleryMedia;
      })
      .filter((media): media is GalleryMedia => Boolean(media));
  }

  return getPromptImageUrls(item).map((url, mediaIndex) => ({
    id: createGalleryMediaId(item.id, mediaIndex),
    itemId: item.id,
    mediaIndex,
    type: 'image',
    title: item.title,
    altText: item.prompt,
    url,
    playbackKind: 'mp4',
    posterUrl: null,
  }));
}

/**
 * 计算当前 prompt 图片组里的上一张或下一张。
 * 这个 helper 被 lightbox 按钮和键盘方向键共用；单图 prompt 直接返回当前状态，
 * 是为了保持弹层打开但不出现跨 prompt 切换，只有 2 张及以上图片时才在当前 prompt 内循环。
 */
export function getAdjacentPromptImageState(
  images: GalleryImage[],
  currentImage: ActiveGalleryImageState | null,
  direction: -1 | 1,
): ActiveGalleryImageState | null {
  if (!currentImage || images.length === 0) {
    return null;
  }

  if (images.length === 1) {
    return currentImage;
  }

  const currentIndex = images.findIndex((image) => image.itemId === currentImage.itemId && image.imageIndex === currentImage.imageIndex);
  const nextIndex = currentIndex >= 0 ? (currentIndex + direction + images.length) % images.length : 0;
  const nextImage = images[nextIndex];
  return nextImage ? { itemId: nextImage.itemId, imageIndex: nextImage.imageIndex } : currentImage;
}

/**
 * 计算当前 prompt 媒体组里的上一条或下一条。
 * 这个 helper 只被 Seedance 手绘 lightbox 调用；导航范围仍然限定在当前 prompt 内，
 * 这样视频 prompt 的查看体验可以支持左右切换，而不会误跳到其它卡片。
 */
export function getAdjacentPromptMediaState(
  mediaItems: GalleryMedia[],
  currentMedia: ActiveGalleryMediaState | null,
  direction: -1 | 1,
): ActiveGalleryMediaState | null {
  if (!currentMedia || mediaItems.length === 0) {
    return null;
  }

  if (mediaItems.length === 1) {
    return currentMedia;
  }

  const currentIndex = mediaItems.findIndex((media) => media.itemId === currentMedia.itemId && media.id === currentMedia.mediaId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + direction + mediaItems.length) % mediaItems.length : 0;
  const nextMedia = mediaItems[nextIndex];
  return nextMedia ? { itemId: nextMedia.itemId, mediaId: nextMedia.id } : currentMedia;
}

/**
 * 计算叠放缩略图里某张图应该使用的视觉层级槽位。
 * 这个 helper 被 PromptImageStack 渲染每个 layer 时调用；hover 后只改变 z-index 深度，
 * 不改变图片的几何位置，是为了让底层图片切到最前时仍保持在鼠标命中区域下方。
 */
export function getImageStackLayerSlot(imageIndex: number, frontImageIndex: number, visibleImageCount: number): number {
  if (visibleImageCount <= 1) {
    return 1;
  }

  const normalizedFrontIndex = frontImageIndex >= 0 && frontImageIndex < visibleImageCount ? frontImageIndex : 0;
  return ((imageIndex - normalizedFrontIndex + visibleImageCount) % visibleImageCount) + 1;
}

/**
 * 计算叠放缩略图里某张图的固定物理槽位。
 * 这个 helper 被 PromptImageStack 的 transform class 调用；它故意不接收 hover 状态，
 * 是为了把稳定命中区域和动态视觉层级拆开，避免前置动画结束后鼠标重新命中其它层导致抖动。
 */
export function getImageStackTransformSlot(imageIndex: number, visibleImageCount: number): number {
  if (visibleImageCount <= 1) {
    return 1;
  }

  return Math.min(Math.max(imageIndex + 1, 1), visibleImageCount);
}
