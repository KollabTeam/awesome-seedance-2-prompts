'use client';

/**
 * prompt-gallery.tsx 管理多 landing page prompt gallery 的客户端追加加载。
 * 它位于 landing-pages 的交互层，被服务端 landing page renderer 注入首屏数据库分页结果后接管后续 cursor。
 * arcade 变体使用 masonic <Masonry> 实现最短列优先（shortest-column）布局：
 *   - 每张新卡片插入当前最短列，ResizeObserver 测量每张卡片的真实高度后更新列高；
 *   - itemKey={(data) => data.id} 保证 load-more 追加时已有卡片列位置稳定，不会重排；
 *   - masonic 默认开启视口内虚拟化，长 gallery 性能优于无虚拟化的 flex 列方案；
 *   - columnWidth={360} + columnGutter={32} 在 ≥1240px 容器得 3 列，~700–1239px 得 2 列，<700px 得 1 列，
 *     与原 breakpointCols 的 ≥1280/768/< 断点近似一致；rowGutter={32} 控制卡片纵向间距。
 * handdrawn 变体仍使用 PromptGalleryVirtualGrid，不受影响。
 *
 * Arcade image preview uses react-photo-view <PhotoSlider> (controlled mode) rather
 * than the old hand-rolled ImageLightbox. PhotoSlider handles Esc, Arrow, pinch-zoom,
 * mousewheel-zoom, drag-pan, and mobile swipe internally, so those event handlers and
 * the body-overflow side-effect have been removed for the arcade image path.
 */
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Masonry as MasonryComponent } from 'masonic';
import { PhotoSlider } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import './prompt-gallery-photo-view.css';

/* masonic 模块顶层会触碰浏览器特有的 ResizeObserver / window，
 * 即使 prompt-gallery 标记了 'use client'，server 端解析 module 引用时仍会执行其顶层代码导致 SSR 500。
 * 这里用 next/dynamic + ssr:false 把它彻底延迟到客户端加载，server 渲染时返回占位 null，
 * 客户端 hydrate 后再挂上真实 Masonry。
 * dynamic() 会丢掉 Masonry 的泛型签名，所以这里 cast 回 typeof MasonryComponent，
 * 让调用点继续保留 `data: PromptGalleryItem` 的精确类型。 */
const Masonry = dynamic(() => import('masonic').then((mod) => mod.Masonry), {
  ssr: false,
}) as unknown as typeof MasonryComponent;

import type { LandingLanguage } from '@/lib/landing-language';
import type { LandingPromptCommandConfig } from '@/lib/landing-page-config';
import type { PromptGalleryItem, PromptGalleryPage } from '@/lib/notion-prompts';
import { sortPromptTagsByPriority } from '@/lib/prompt-tags';

import {
  buildPromptGalleryFilterKey,
  buildPromptPageUrl,
  PROMPT_GALLERY_SEARCH_DEBOUNCE_MS,
  resolvePromptGalleryImmediatePreviewItems,
  type PromptGalleryFilterRequest,
} from './prompt-gallery-filters';
import { HandDrawnImageLightbox } from './handdrawn-image-lightbox';
import { HandDrawnPromptGalleryToolbar } from './handdrawn-prompt-gallery-toolbar';
import { shouldResetPromptGalleryMasonry } from './prompt-gallery-masonry';
import { shouldUseSingleSharedPromptLayout } from './prompt-gallery-layout';
import { handDrawnPromptGalleryStatusClasses } from './handdrawn-prompt-gallery-status-classes';
import { PromptGalleryVirtualGrid } from './prompt-gallery-virtual-grid';
import { PromptGalleryToolbar, type PromptGalleryToolbarCopy } from './prompt-gallery-toolbar';
import { PromptCard, type PromptGalleryCardCopy } from './prompt-gallery-card';
import { cn } from './class-name-utils';
import {
  buildPromptGalleryMedia,
  buildPromptGalleryImages,
  getAdjacentPromptMediaState,
  getAdjacentPromptImageState,
  type ActiveGalleryMediaState,
  type ActiveGalleryImageState,
} from './prompt-gallery-images';
import { promptGalleryStatusClasses } from './prompt-gallery-status-classes';
import { usePromptGalleryRouteState } from './use-prompt-gallery-route-state';

/**
 * PromptGalleryCopy aggregates all user-visible strings for the gallery.
 * The `images` block is still required because HandDrawnImageLightbox (Seedance variant)
 * reads all six keys. The arcade variant now delegates navigation UI to react-photo-view
 * internally, so arcade code no longer reads previous/next/close/fullscreen/count — but
 * we keep the keys in this type (and in locale JSONs) to avoid a breaking change to any
 * parent that builds the copy object once for both variants.
 */
type PromptGalleryCopy = PromptGalleryToolbarCopy & {
    images: {
      open: string;
      previous: string;
      next: string;
      close: string;
      fullscreen: string;
      count: string;
    };
    sections?: {
      primaryPrompt: string;
      secondaryPrompt: string;
    };
    galleryLabel: string;
    empty: string;
    actions: PromptGalleryCardCopy['actions'];
    loadMore: {
      loading: string;
      error: string;
      retry: string;
      end: string;
      idle: string;
    };
  };

type PromptGalleryProps = {
  variant: 'arcade' | 'handdrawn';
  promptCommand: LandingPromptCommandConfig;
  initialPage: PromptGalleryPage;
  defaultPage: PromptGalleryPage;
  apiPath: string;
  language: LandingLanguage;
  copy: PromptGalleryCopy;
};

export { buildPromptTaskPath, launchPromptInKollabTask, openExternalLinkInNewWindow } from './prompt-gallery-card';

/**
 * 渲染可滑动加载更多的 prompt gallery。
 * 这个组件维护 items、cursor 和加载状态；IntersectionObserver 只在还有 nextCursor 时启用，
 * 这样最后一页不会持续触发空请求，也能让分页 API 的 10 分钟缓存集中服务真实分页访问。
 * 分类切换会先用已加载的未筛选卡片生成即时预览，再等待 API 返回权威第一页；
 * 这样本地调试不依赖缓存，也能避免用户点击 tag 后盯着旧列表等待数秒。
 * `?id=` 单卡分享例外：首屏已经由服务端按目标 prompt 渲染，客户端切入分享态时必须保留这份 SSR 真相，
 * 否则目标卡片不在默认第一页缓存里时，hydration 后会先闪成空列表再等网络恢复。
 */
export function PromptGallery({ variant, promptCommand, initialPage, defaultPage, apiPath, language, copy }: PromptGalleryProps) {
  const [items, setItems] = useState(initialPage.items);
  const [masonryInstanceKey, setMasonryInstanceKey] = useState(0);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isReplacingItems, setIsReplacingItems] = useState(false);
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  // searchInput 来自 hook（?q= URL 参数），与 header 搜索框共享同一真相；
  // searchQuery 是 debounce 后的提交值，只用于 API 请求 key，不持久化。
  const [searchQuery, setSearchQuery] = useState('');
  const [activeImageState, setActiveImageState] = useState<ActiveGalleryImageState | null>(null);
  const [activeMediaState, setActiveMediaState] = useState<ActiveGalleryMediaState | null>(null);
  const { isRouteStateReady, selectedTag, sharedPromptId, searchInput, commitTagSelection, clearSharedPromptId, commitSearchInput } = usePromptGalleryRouteState();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const itemsRef = useRef(initialPage.items);
  const unfilteredItemsRef = useRef(defaultPage.items);
  const activeRequest = useMemo(
    () => ({
      key: buildPromptGalleryFilterKey({ language, selectedTag, searchQuery, sharedPromptId }),
      selectedTag,
      searchQuery,
      sharedPromptId,
    }),
    [language, searchQuery, selectedTag, sharedPromptId]
  );
  const activeRequestKeyRef = useRef(activeRequest.key);
  const hasActiveFilter = Boolean(selectedTag || searchQuery || sharedPromptId);
  const tagOptions = useMemo(() => {
    if (initialPage.availableTags.length > 0) {
      return sortPromptTagsByPriority(initialPage.availableTags);
    }

    return sortPromptTagsByPriority(initialPage.items.flatMap((item) => item.tags));
  }, [initialPage.availableTags, initialPage.items]);
  const activePromptImages = useMemo(() => {
    if (!activeImageState) {
      return [];
    }

    const activeItem = items.find((item) => item.id === activeImageState.itemId);
    return activeItem ? buildPromptGalleryImages(activeItem) : [];
  }, [activeImageState, items]);
  /* PhotoSlider 的 images 列只取 src/key 子集；用 useMemo 把映射结果绑到 activePromptImages 引用，
   * 避免每次父组件渲染（搜索框输入、分页加载）都给 PhotoSlider 一个新 images prop 导致内部 diff。 */
  const photoSliderImages = useMemo(
    () => activePromptImages.map((image) => ({ src: image.url, key: image.id })),
    [activePromptImages],
  );
  const activeImageIndex = activeImageState ? activePromptImages.findIndex((image) => image.imageIndex === activeImageState.imageIndex) : -1;
  const activeImage = activeImageIndex >= 0 ? activePromptImages[activeImageIndex] : null;
  const activePromptMedia = useMemo(() => {
    if (!activeMediaState) {
      return [];
    }

    const activeItem = items.find((item) => item.id === activeMediaState.itemId);
    return activeItem ? buildPromptGalleryMedia(activeItem) : [];
  }, [activeMediaState, items]);
  const activeMediaIndex = activeMediaState ? activePromptMedia.findIndex((media) => media.id === activeMediaState.mediaId) : -1;
  const activeMedia = activeMediaIndex >= 0 ? activePromptMedia[activeMediaIndex] : null;
  const isHandDrawn = variant === 'handdrawn';
  const statusClasses = isHandDrawn ? handDrawnPromptGalleryStatusClasses : promptGalleryStatusClasses;
  const isSingleSharedPrompt = shouldUseSingleSharedPromptLayout({
    sharedPromptId,
    itemCount: items.length,
  });

  useEffect(() => {
    if (isRouteStateReady && !hasActiveFilter) {
      unfilteredItemsRef.current = items;
    }
  }, [hasActiveFilter, isRouteStateReady, items]);

  /**
   * 把搜索框新值写入 URL（?q=）并同步到 hook 状态。
   * 这个回调传给 PromptGalleryToolbar；URL 更新使用 replaceState 不增加历史条目，
   * 防止用户连续输入时污染 back-stack；真实 API 请求等 debounce 后的 searchQuery 再触发。
   * clearSharedPromptId 逻辑已内嵌在 commitSearchInput 中（当 sharedPromptId 存在时离开单卡态）。
   */
  const handleSearchInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    commitSearchInput(event.target.value);
  }, [commitSearchInput]);

  /**
   * 用新的一整组卡片替换当前 gallery 内容，并在必要时重建 masonic 实例。
   * 这个方法被筛选即时预览、筛选首屏结果和“回到默认列表”三条替换链路复用；
   * 与 cursor 分页不同，这些场景会直接丢弃旧列表，旧的 positioner 若继续保留会按历史索引读到 `undefined`。
   * 因此这里在同一批 state update 里同时更新 items 和 Masonry key，确保浏览器不会先经历一次“新 items + 旧布局缓存”的中间态。
   */
  const replaceGalleryItems = useCallback((nextItems: PromptGalleryItem[]) => {
    if (shouldResetPromptGalleryMasonry(itemsRef.current, nextItems)) {
      setMasonryInstanceKey((currentKey) => currentKey + 1);
    }

    itemsRef.current = nextItems;
    setItems(nextItems);
  }, []);

  /**
   * 请求指定 cursor 的 prompt page。
   * 这个方法被筛选首屏、滚动分页和错误重试共用；cursor 为空时替换当前列表，
   * cursor 有值时追加到列表末尾，从而保持搜索/tag 条件下的分页语义和普通列表一致。
   */
  const loadPromptPage = useCallback(
    async ({ cursor, signal, request }: { cursor: string | null; signal?: AbortSignal; request: PromptGalleryFilterRequest }) => {
      if (loadingRef.current) {
        return;
      }

      loadingRef.current = true;
      setIsLoading(true);
      setHasError(false);
      setFailedCursor(null);
      if (!cursor) {
        setIsReplacingItems(true);
      }

      try {
        const response = await fetch(
          buildPromptPageUrl({
            apiPath,
            cursor,
            language,
            selectedTag: request.selectedTag,
            searchQuery: request.searchQuery,
            sharedPromptId: request.sharedPromptId,
          }),
          {
          headers: {
            Accept: 'application/json',
          },
          signal,
          }
        );

        if (!response.ok) {
          throw new Error('Prompt page request failed');
        }

        const page = (await response.json()) as PromptGalleryPage;
        if (request.key !== activeRequestKeyRef.current) {
          return;
        }

        if (cursor) {
          setItems((currentItems) => {
            const nextItems = [...currentItems, ...page.items];
            itemsRef.current = nextItems;
            return nextItems;
          });
        } else {
          replaceGalleryItems(page.items);
        }
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch {
        if (signal?.aborted || request.key !== activeRequestKeyRef.current) {
          return;
        }

        setHasError(true);
        setFailedCursor(cursor);
      } finally {
        if (!signal?.aborted && request.key === activeRequestKeyRef.current) {
          loadingRef.current = false;
          setIsLoading(false);
          setIsReplacingItems(false);
        }
      }
    },
    [apiPath, language]
  );

  /**
   * 请求下一页 prompt。
   * 这个方法被 IntersectionObserver 和错误重试按钮共用；loadingRef 用来抵消 observer 连续触发，
   * 避免同一个 cursor/filter 在短时间内被重复请求，即使 API 端已有缓存也不制造无意义的并发。
   */
  const loadNextPage = useCallback(async () => {
    if (!hasMore || !nextCursor) {
      return;
    }

    await loadPromptPage({ cursor: nextCursor, request: activeRequest });
  }, [activeRequest, hasMore, loadPromptPage, nextCursor]);

  /**
   * 重试最近一次失败的 prompt 请求。
   * 这个回调被底部 retry 按钮调用；failedCursor 为 null 时重试当前筛选首屏，
   * 有 cursor 时重试滚动分页，避免筛选首屏失败后按钮误走“下一页”逻辑。
   */
  const retryFailedRequest = useCallback(() => {
    void loadPromptPage({ cursor: failedCursor, request: activeRequest });
  }, [activeRequest, failedCursor, loadPromptPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, PROMPT_GALLERY_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!isRouteStateReady) {
      return;
    }

    activeRequestKeyRef.current = activeRequest.key;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    loadingRef.current = false;

    if (!hasActiveFilter) {
      replaceGalleryItems(defaultPage.items);
      setNextCursor(defaultPage.nextCursor);
      setHasMore(defaultPage.hasMore);
      setHasError(false);
      setFailedCursor(null);
      setIsLoading(false);
      setIsReplacingItems(false);
      return;
    }

    replaceGalleryItems(resolvePromptGalleryImmediatePreviewItems({
        previewSourceItems: unfilteredItemsRef.current,
        currentItems: itemsRef.current,
        request: activeRequest,
      }));
    setNextCursor(null);
    setHasMore(false);
    setHasError(false);
    setFailedCursor(null);
    setIsLoading(true);
    setIsReplacingItems(true);

    const controller = new AbortController();
    requestControllerRef.current = controller;
    void loadPromptPage({ cursor: null, signal: controller.signal, request: activeRequest });

    return () => {
      controller.abort();
    };
  }, [activeRequest, defaultPage.hasMore, defaultPage.items, defaultPage.nextCursor, hasActiveFilter, isRouteStateReady, loadPromptPage, replaceGalleryItems]);

  /**
   * 打开指定 prompt 图片。
   * 这个回调传给每张卡片的缩略图按钮；只保存 prompt id 与图片顺序而不是整张图片对象，
   * 是为了分页追加 items 后仍能从最新 items 中重建当前 prompt 的图片组。
   */
  const openImage = useCallback((itemId: string, imageIndex: number) => {
    setActiveImageState({ itemId, imageIndex });
  }, []);

  /**
   * 打开指定 prompt 的图片或视频媒体。
   * 这个回调只传给 handdrawn Seedance 卡片；它保存稳定的媒体 id，
   * 是为了让视频优先卡片在分页追加后仍然能从最新 items 中重建当前媒体组。
   */
  const openMedia = useCallback((itemId: string, mediaId: string) => {
    setActiveMediaState({ itemId, mediaId });
  }, []);

  /**
   * 在 lightbox 里循环切换当前 prompt 的图片。
   * 这个方法被上一张/下一张按钮和键盘方向键共用；导航范围限定在当前 prompt 图片组，
   * 避免单图 prompt 切到其它卡片，也避免用户看图时触发额外 Notion 分页请求。
   */
  const showAdjacentImage = useCallback(
    (direction: -1 | 1) => {
      setActiveImageState((currentImage) => getAdjacentPromptImageState(activePromptImages, currentImage, direction));
    },
    [activePromptImages]
  );

  /**
   * 在 handdrawn 媒体 lightbox 里循环切换当前 prompt 的媒体。
   * 这个方法复用当前 prompt 的有序媒体列表，避免 Seedance 用户在查看视频时跳到其它 prompt。
   */
  const showAdjacentMedia = useCallback(
    (direction: -1 | 1) => {
      setActiveMediaState((currentMedia) => getAdjacentPromptMediaState(activePromptMedia, currentMedia, direction));
    },
    [activePromptMedia]
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || !nextCursor) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadNextPage();
        }
      },
      { rootMargin: '720px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadNextPage, nextCursor]);

  useEffect(() => {
    // This effect handles body scroll-lock and keyboard navigation only for the
    // handdrawn (Seedance) media lightbox. The arcade image path now uses
    // react-photo-view <PhotoSlider>, which manages its own scroll lock and
    // binds Esc / ArrowLeft / ArrowRight internally — duplicating those here
    // would cause double-fire on the arcade path.
    if (!activeMedia) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    /**
     * 处理 handdrawn 媒体 lightbox 的键盘导航。
     * 这个监听只在手绘媒体弹层打开时注册，避免普通页面滚动浏览时方向键被 gallery 抢走。
     * arcade 图片 lightbox 的键盘绑定由 react-photo-view 内部处理，不依赖这里。
     */
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveMediaState(null);
      }
      if (event.key === 'ArrowLeft') {
        showAdjacentMedia(-1);
      }
      if (event.key === 'ArrowRight') {
        showAdjacentMedia(1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeMedia, showAdjacentMedia]);

  /**
   * masonic render 组件：渲染 arcade gallery 中的单张 prompt 卡片。
   * masonic 在每次 render prop 引用变化时会重建 positioner，因此用 useCallback 保持引用稳定。
   * copy / promptCommand / openImage 均为稳定引用（copy 来自 props，另两个已被 useCallback 包裹），
   * 所以 useCallback 的依赖数组在 gallery 生命周期内几乎不变。
   * 注意：masonic 把 width 注入到每个 render 调用，但 PromptCard 自身是 block 元素（w-full），
   * 会自然撑满列容器；我们不强制 style.width，因为 masonic 的列容器已经是绝对定位 + 正确宽度。
   */
  const ArcadePromptCard = useCallback(
    ({ data, index }: { data: (typeof items)[number]; index: number; width: number }) => (
      <PromptCard
        item={data}
        copy={copy}
        accentIndex={index}
        promptCommand={promptCommand.primary}
        onImageOpen={openImage}
      />
    ),
    [copy, promptCommand, openImage]
  );

  return (
    <>
      {/* toolbar 继续输出 id="prompt-filters"，这样页头锚点仍能落到同一份筛选控件。 */}
      {isHandDrawn ? (
        <HandDrawnPromptGalleryToolbar
          copy={copy}
          searchInput={searchInput}
          selectedTag={selectedTag}
          tags={tagOptions}
          onSearchInputChange={handleSearchInputChange}
          onTagSelect={commitTagSelection}
        />
      ) : (
        <PromptGalleryToolbar
          copy={copy}
          searchInput={searchInput}
          selectedTag={selectedTag}
          tags={tagOptions}
          onSearchInputChange={handleSearchInputChange}
          onTagSelect={commitTagSelection}
        />
      )}

      {/* arcade 变体：masonic shortest-column masonry，开启视口虚拟化。
       * masonic 用 ResizeObserver 测量每张卡片渲染后的真实高度，并把新卡片放入当前最短列，
       * 从而消除 round-robin 分配在卡片高度差异大时产生的长列白边。
       * itemKey 确保 load-more 追加时已有卡片的列位置不变（不重排）。
       * columnWidth={360} + columnGutter={32}：在 ≥1240px 容器得 3 列，~700-1239px 得 2 列，
       * <700px 得 1 列，近似原 ≥1280/768 断点。rowGutter 单独控制纵向间距（与 columnGutter 解耦）。
       * handdrawn 变体保持使用 PromptGalleryVirtualGrid。 */}
      {isHandDrawn ? (
        <PromptGalleryVirtualGrid
          variant={variant}
          items={items}
          copy={copy}
          promptCommand={promptCommand}
          isReplacingItems={isReplacingItems}
          isSingleSharedPrompt={isSingleSharedPrompt}
          onImageOpen={openImage}
          onMediaOpen={openMedia}
        />
      ) : (
        <section
          className={cn(
            'py-[56px] max-[480px]:pt-[40px]',
            isReplacingItems && 'opacity-60 transition-opacity duration-200'
          )}
          aria-label={copy.galleryLabel}
        >
          <div className="mx-auto w-[min(1240px,calc(100%-112px))] max-[900px]:w-[min(1240px,calc(100%-48px))] max-[480px]:w-[min(1240px,calc(100%-32px))]">
            {/* masonic <Masonry> 完全接管宽度测量和列分配；render prop 以 React 组件形式接收
              * { data, index, width }，width 由 masonic 注入（当前列宽），卡片本身 w-full
              * 确保撑满列容器，供 ResizeObserver 正确测量高度。
              * overscanBy={3} 在视口上下各多渲染 3 个视口高的内容，防止快速滚动时撕裂。 */}
            <Masonry
              key={masonryInstanceKey}
              items={items}
              itemKey={(data) => data.id}
              render={ArcadePromptCard}
              columnWidth={360}
              columnGutter={32}
              rowGutter={32}
              overscanBy={3}
            />
          </div>
        </section>
      )}

      <div
        className={statusClasses.galleryStatusWrap}
        ref={sentinelRef}
        aria-live="polite"
      >
        {isLoading ? (
          <span
            className={cn(
              statusClasses.galleryStatusFrame,
              isHandDrawn ? 'rotate-[0.6deg] bg-[#fff9c4] max-[640px]:text-[15px]' : ''
            )}
            style={isHandDrawn ? { borderRadius: '26px 18px 28px 14px / 14px 30px 18px 28px', fontFamily: 'var(--font-handwritten-body)' } : undefined}
          >
            {copy.loadMore.loading}
          </span>
        ) : null}
        {hasError ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span
              className={cn(
                statusClasses.galleryStatusFrame,
                isHandDrawn ? 'rotate-[-0.6deg] bg-white text-[#ff4d4d] max-[640px]:text-[15px]' : ''
              )}
              style={isHandDrawn ? { borderRadius: '26px 18px 28px 14px / 14px 30px 18px 28px', fontFamily: 'var(--font-handwritten-body)' } : undefined}
            >
              {copy.loadMore.error}
            </span>
            <button
              className={cn(statusClasses.galleryStatusButton, isHandDrawn ? 'rotate-[0.7deg]' : '')}
              style={isHandDrawn ? { borderRadius: '26px 18px 28px 14px / 14px 30px 18px 28px', fontFamily: 'var(--font-handwritten-body)' } : undefined}
              type="button"
              onClick={retryFailedRequest}
            >
              {copy.loadMore.retry}
            </button>
          </div>
        ) : null}
        {!isLoading && !hasError && items.length === 0 ? (
          <span
            className={cn(
              statusClasses.galleryStatusFrame,
              isHandDrawn ? 'rotate-[-0.6deg] bg-white text-[#ff4d4d] max-[640px]:text-[15px]' : ''
            )}
            style={isHandDrawn ? { borderRadius: '26px 18px 28px 14px / 14px 30px 18px 28px', fontFamily: 'var(--font-handwritten-body)' } : undefined}
          >
            {copy.empty}
          </span>
        ) : null}
        {!hasMore && items.length > 0 ? (
          <span
            className={cn(
              statusClasses.galleryStatusFrame,
              isHandDrawn ? 'rotate-[0.6deg] bg-[#fff9c4] text-[#2d5da1] max-[640px]:text-[15px]' : ''
            )}
            style={isHandDrawn ? { borderRadius: '26px 18px 28px 14px / 14px 30px 18px 28px', fontFamily: 'var(--font-handwritten-body)' } : undefined}
          >
            {copy.loadMore.end}
          </span>
        ) : null}
        {hasMore && !isLoading && !hasError ? (
          <span
            className={cn(
              statusClasses.galleryStatusFrame,
              isHandDrawn ? 'rotate-[-0.5deg] bg-white text-[#2d2d2d]/72 max-[640px]:text-[15px]' : ''
            )}
            style={isHandDrawn ? { borderRadius: '26px 18px 28px 14px / 14px 30px 18px 28px', fontFamily: 'var(--font-handwritten-body)' } : undefined}
          >
            {copy.loadMore.idle}
          </span>
        ) : null}
      </div>

      {isHandDrawn && activeMedia ? (
        <HandDrawnImageLightbox
          media={activeMedia}
          currentIndex={activeMediaIndex}
          total={activePromptMedia.length}
          copy={copy}
          onClose={() => setActiveMediaState(null)}
          onPrevious={() => showAdjacentMedia(-1)}
          onNext={() => showAdjacentMedia(1)}
        />
      ) : null}

      {/* Arcade image lightbox — react-photo-view handles Esc, Arrow nav,
        * pinch-zoom, mousewheel-zoom, drag-pan, and mobile swipe internally.
        * We stay in controlled mode (visible + index + onIndexChange) so the
        * parent state machine remains the single source of truth for which
        * image is open, and closing via PhotoSlider's own Esc/backdrop also
        * clears our state through onClose. */}
      {!isHandDrawn ? (
        <PhotoSlider
          images={photoSliderImages}
          visible={Boolean(activeImage)}
          index={activeImageIndex >= 0 ? activeImageIndex : 0}
          onIndexChange={(index) => {
            const img = activePromptImages[index];
            if (img) {
              setActiveImageState({ itemId: img.itemId, imageIndex: img.imageIndex });
            }
          }}
          onClose={() => setActiveImageState(null)}
          className="prompt-gallery-photo-view"
        />
      ) : null}
      {isHandDrawn && activeImage ? (
        // handdrawn 分支现在只通过 activeMediaState 打开弹层；保留这个兜底是为了在迁移过程中，
        // 万一仍有旧回调误触发 activeImageState，也不会把错误状态静默留在 body scroll lock 里。
        (
          <HandDrawnImageLightbox
            media={{
              id: activeImage.id,
              itemId: activeImage.itemId,
              mediaIndex: activeImage.imageIndex,
              type: 'image',
              title: activeImage.title,
              altText: activeImage.altText,
              url: activeImage.url,
              playbackKind: 'mp4',
              posterUrl: null,
            }}
            currentIndex={activeImageIndex}
            total={activePromptImages.length}
            copy={copy}
            onClose={() => setActiveImageState(null)}
            onPrevious={() => showAdjacentImage(-1)}
            onNext={() => showAdjacentImage(1)}
          />
        )
      ) : null}
    </>
  );
}
