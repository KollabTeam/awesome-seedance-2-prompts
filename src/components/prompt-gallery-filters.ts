/**
 * prompt-gallery-filters.ts 收口 GPT Image 2 prompt gallery 的客户端筛选辅助逻辑。
 * 它位于 landing-pages 的交互层，被 PromptGallery 的搜索、tag 切换和分页请求复用；
 * 把 URL 参数和 tag 去重集中到这里，是为了避免首屏、筛选首屏和后续 cursor 分页产生参数漂移。
 * `lasted` 是页面专用排序项，不是数据库里的真实 tag，因此即时预览和请求 URL 都要显式识别它。
 */
import type { LandingLanguage } from '@/lib/landing-language';
import type { PromptGalleryItem } from '@/lib/notion-prompts';
import { isPromptGalleryLatestTag } from '@/lib/prompt-tags';

export const PROMPT_GALLERY_SEARCH_DEBOUNCE_MS = 240;

export type PromptGalleryFilterRequest = {
  key: string;
  selectedTag: string | null;
  searchQuery: string;
  sharedPromptId: string | null;
};

export type PromptGalleryRouteState = {
  selectedTag: string | null;
  sharedPromptId: string | null;
  /** 搜索关键词，对应 URL ?q= 参数；空字符串表示无搜索。 */
  searchInput: string;
};

/**
 * 生成当前筛选条件的稳定 key。
 * 这个 helper 被 PromptGallery 的请求防抖和过期响应丢弃逻辑使用；
 * key 不包含 cursor，是因为同一个筛选条件下的首屏和后续分页都属于同一条结果流。
 */
export function buildPromptGalleryFilterKey({
  language,
  selectedTag,
  searchQuery,
  sharedPromptId,
}: {
  language: LandingLanguage;
  selectedTag: string | null;
  searchQuery: string;
  sharedPromptId: string | null;
}): string {
  const params = new URLSearchParams({ lan: language });
  if (sharedPromptId) {
    params.set('id', sharedPromptId);
  }
  if (selectedTag) {
    params.set('tag', selectedTag);
  }
  if (searchQuery) {
    params.set('q', searchQuery);
  }

  return params.toString();
}

/**
 * 生成 prompt 分页 API 请求 URL。
 * 这个 helper 被首屏筛选和滚动分页共用；tag/search/cursor 都放进同一个 URLSearchParams，
 * 是为了保证用户先搜索再滚动时后续页面仍然查询同一组 Notion 过滤条件。
 */
export function buildPromptPageUrl({
  apiPath,
  cursor,
  language,
  selectedTag,
  searchQuery,
  sharedPromptId,
}: {
  apiPath: string;
  cursor: string | null;
  language: LandingLanguage;
  selectedTag: string | null;
  searchQuery: string;
  sharedPromptId: string | null;
}): string {
  const params = new URLSearchParams({ lan: language });
  if (sharedPromptId) {
    params.set('id', sharedPromptId);
    return `${apiPath}?${params.toString()}`;
  }
  if (cursor) {
    params.set('cursor', cursor);
  }
  if (selectedTag) {
    params.set('tag', selectedTag);
  }
  if (searchQuery) {
    params.set('q', searchQuery);
  }

  return `${apiPath}?${params.toString()}`;
}

/**
 * 用浏览器端已有卡片生成一次即时筛选预览。
 * 这个 helper 被 PromptGallery 在真正 Notion 请求返回前调用；它不替代服务端筛选，
 * 只让用户点击分类后立刻看到列表响应，同时后续仍由 API 返回权威的完整第一页。
 */
export function filterPromptItemsForImmediatePreview(
  items: PromptGalleryItem[],
  {
    selectedTag,
    searchQuery,
    sharedPromptId,
  }: {
    selectedTag: string | null;
    searchQuery: string;
    sharedPromptId: string | null;
  },
): PromptGalleryItem[] {
  if (sharedPromptId) {
    return items.filter((item) => item.id === sharedPromptId);
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredItems = items.filter((item) => {
    if (selectedTag && !isPromptGalleryLatestTag(selectedTag) && !item.tags.includes(selectedTag)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return `${item.title} ${item.prompt} ${item.authorName}`.toLowerCase().includes(normalizedQuery);
  });

  if (!isPromptGalleryLatestTag(selectedTag)) {
    return filteredItems;
  }

  return [...filteredItems].sort((left, right) => {
    const leftTime = left.notionCreatedAt ? new Date(left.notionCreatedAt).getTime() : Number.NEGATIVE_INFINITY;
    const rightTime = right.notionCreatedAt ? new Date(right.notionCreatedAt).getTime() : Number.NEGATIVE_INFINITY;

    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return left.id.localeCompare(right.id);
  });
}

/**
 * 决定当前筛选切换时客户端应先展示哪一组即时预览卡片。
 * 这个 helper 被 PromptGallery 在发起真实分页请求前调用；tag/search 可以安全地用本地未筛选首屏做即时反馈，
 * 但 `?id=` 单卡分享不能复用默认第一页缓存，因为目标 prompt 可能根本不在那一页里。
 * 因此分享态必须保留当前 SSR 单卡，直到按 `id` 的权威请求返回，避免 hydration 后先闪成空列表。
 */
export function resolvePromptGalleryImmediatePreviewItems({
  previewSourceItems,
  currentItems,
  request,
}: {
  previewSourceItems: PromptGalleryItem[];
  currentItems: PromptGalleryItem[];
  request: Pick<PromptGalleryFilterRequest, 'selectedTag' | 'searchQuery' | 'sharedPromptId'>;
}): PromptGalleryItem[] {
  if (request.sharedPromptId) {
    return currentItems;
  }

  return filterPromptItemsForImmediatePreview(previewSourceItems, request);
}

/**
 * 从浏览器地址读取 landing gallery 的当前路由状态。
 * 这个 helper 被 PromptGallery 的初始化和前进/后退同步共用；`?id=` 用于单卡分享直达，
 * `#tag` 用于公开筛选分享，二者同时存在时优先展示单卡，避免 hash 继续把分享态覆盖成列表筛选。
 */
export function readPromptGalleryRouteState(urlLike: string | URL): PromptGalleryRouteState {
  const url = typeof urlLike === 'string' ? new URL(urlLike) : new URL(urlLike.toString());
  const sharedPromptId = url.searchParams.get('id')?.trim() || null;
  // ?q= 是搜索关键词，即使在单卡分享态下也保留读取，方便刷新时恢复输入框内容。
  const searchInput = url.searchParams.get('q')?.trim() || '';

  if (sharedPromptId) {
    return {
      selectedTag: null,
      sharedPromptId,
      searchInput,
    };
  }

  const selectedTag = decodeURIComponent(url.hash.replace(/^#/, '').trim()) || null;
  return {
    selectedTag,
    sharedPromptId: null,
    searchInput,
  };
}

/**
 * 生成当前 landing gallery 应写回浏览器地址栏的 URL。
 * 这个 helper 被 PromptGallery 的 tag 切换、分享态退出和历史同步共用；
 * 默认 all 态不带 hash，分享单卡时只保留 `?id=`，避免 `id` 与 `#tag` 同时存在时再出现状态真相冲突。
 */
export function buildPromptGalleryBrowserUrl(currentUrlLike: string | URL, routeState: PromptGalleryRouteState): string {
  const currentUrl = typeof currentUrlLike === 'string' ? new URL(currentUrlLike) : new URL(currentUrlLike.toString());
  const nextUrl = new URL(currentUrl.toString());

  nextUrl.searchParams.delete('id');
  nextUrl.hash = '';

  // 无搜索时移除 ?q=，避免地址栏留下空参数。
  if (routeState.searchInput) {
    nextUrl.searchParams.set('q', routeState.searchInput);
  } else {
    nextUrl.searchParams.delete('q');
  }

  if (routeState.sharedPromptId) {
    nextUrl.searchParams.set('id', routeState.sharedPromptId);
    return nextUrl.toString();
  }

  if (routeState.selectedTag) {
    nextUrl.hash = encodeURIComponent(routeState.selectedTag);
  }

  return nextUrl.toString();
}

/**
 * 生成单张 prompt 的公开分享链接。
 * 这个 helper 只被卡片分享按钮调用；它始终收口到同一路由加 `?id=`，
 * 是为了让分享对象直接打开目标卡片，而不是先看到当前 tag 列表再自己找对应 prompt。
 */
export function buildPromptShareUrl(currentUrlLike: string | URL, promptId: string): string {
  // 分享链接不携带搜索词，保持 ?id= 单卡链接干净且可复制分享。
  return buildPromptGalleryBrowserUrl(currentUrlLike, {
    selectedTag: null,
    sharedPromptId: promptId,
    searchInput: '',
  });
}
