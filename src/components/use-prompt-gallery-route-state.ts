'use client';

/**
 * use-prompt-gallery-route-state.ts 管理 landing prompt gallery 的浏览器地址栏状态。
 * 它位于 landing-pages 的客户端交互层，被 PromptGallery 和 LandingPageShell（header 搜索）复用；
 * 把 `#tag`、`?id=` 和 `?q=` 的读取、写回和前进/后退同步抽到独立 hook，
 * 是为了避免 gallery 容器和 header 各自持有独立搜索状态，同时保证两个消费方读到同一份真相。
 *
 * 多实例同步策略：
 * - `commitSearchInput` 使用 `window.history.replaceState`（不触发 `popstate`）。
 * - 调用后额外 dispatch `gallery:statechange` 自定义事件，让同页面的其他 hook 实例及时 re-sync。
 * - `popstate`、`hashchange` 和 `gallery:statechange` 三个事件共用同一个 `syncFromWindowLocation` 回调。
 */
import { useCallback, useEffect, useState } from 'react';

import {
  buildPromptGalleryBrowserUrl,
  readPromptGalleryRouteState,
  type PromptGalleryRouteState,
} from './prompt-gallery-filters';

/** 同页面多实例 hook 之间用来通知彼此地址栏已由 replaceState 修改的自定义事件名称。 */
const GALLERY_STATE_CHANGE_EVENT = 'gallery:statechange';

type CommitRouteStateOptions = {
  replace?: boolean;
};

/**
 * 维护 prompt gallery 的 URL 路由态（tag、单卡分享、搜索关键词）。
 * `selectedTag` 用 `#tag` 暴露给公开分享，`sharedPromptId` 用 `?id=` 直达单卡，`searchInput` 用 `?q=` 持久化搜索词；
 * tag 与单卡互斥，是因为单卡直达需要一条稳定的唯一真相，不能被 hash 筛选覆盖回列表态。
 * 同一页面可以有多个 hook 实例（gallery body + header），它们通过 `GALLERY_STATE_CHANGE_EVENT` 自定义事件保持同步。
 */
export function usePromptGalleryRouteState() {
  const [routeState, setRouteState] = useState<PromptGalleryRouteState>({
    selectedTag: null,
    sharedPromptId: null,
    searchInput: '',
  });
  const [isRouteStateReady, setIsRouteStateReady] = useState(false);

  const syncFromWindowLocation = useCallback(() => {
    setRouteState(readPromptGalleryRouteState(window.location.href));
    setIsRouteStateReady(true);
  }, []);

  useEffect(() => {
    syncFromWindowLocation();

    window.addEventListener('popstate', syncFromWindowLocation);
    window.addEventListener('hashchange', syncFromWindowLocation);
    // 监听同页面其他实例（header、gallery body）通过 replaceState 触发的状态变更，
    // 避免多实例各自持有过期 searchInput 导致 header 与 gallery 搜索框不同步。
    window.addEventListener(GALLERY_STATE_CHANGE_EVENT, syncFromWindowLocation);
    return () => {
      window.removeEventListener('popstate', syncFromWindowLocation);
      window.removeEventListener('hashchange', syncFromWindowLocation);
      window.removeEventListener(GALLERY_STATE_CHANGE_EVENT, syncFromWindowLocation);
    };
  }, [syncFromWindowLocation]);

  /**
   * 把新的 gallery 路由状态写回浏览器地址栏。
   * 这个方法被 tag 点击、分享态退出和搜索清除单卡态共用；
   * 默认使用 pushState 保留用户的筛选轨迹，只有内部纠偏时才显式 replace，避免回退栈被无意义污染。
   * 调用后 dispatch `gallery:statechange` 通知同页面其他 hook 实例（如 header 搜索框）同步。
   */
  const commitRouteState = useCallback((nextState: PromptGalleryRouteState, options: CommitRouteStateOptions = {}) => {
    const nextUrl = buildPromptGalleryBrowserUrl(window.location.href, nextState);
    const historyMethod = options.replace ? window.history.replaceState : window.history.pushState;

    historyMethod.call(window.history, null, '', nextUrl);
    setRouteState(nextState);
    // pushState 不触发 popstate，replaceState 同样不触发；
    // 通过自定义事件通知同页面的其他 hook 实例同步读取新 URL。
    window.dispatchEvent(new Event(GALLERY_STATE_CHANGE_EVENT));
  }, []);

  /**
   * 切换当前选中的公开 tag。
   * 这个方法只暴露 tag 语义，并且总是清掉 `sharedPromptId`，
   * 是为了保证用户离开单卡分享态后地址栏重新回到 `#tag` 或默认 all 的公开列表语义。
   */
  const commitTagSelection = useCallback((tag: string | null) => {
    commitRouteState({
      selectedTag: tag,
      sharedPromptId: null,
      searchInput: routeState.searchInput,
    });
  }, [commitRouteState, routeState.searchInput]);

  /**
   * 清除当前单卡分享态但保留已有 tag 和搜索词。
   * 搜索输入、切换 toolbar tag 或其它会离开"只看这一张卡"的操作，都应该先调用它，
   * 避免地址栏继续挂着一个和当前列表内容不一致的 `?id=`。
   */
  const clearSharedPromptId = useCallback((options: CommitRouteStateOptions = {}) => {
    if (!routeState.sharedPromptId) {
      return;
    }

    commitRouteState(
      {
        selectedTag: routeState.selectedTag,
        sharedPromptId: null,
        searchInput: routeState.searchInput,
      },
      options,
    );
  }, [commitRouteState, routeState.selectedTag, routeState.sharedPromptId, routeState.searchInput]);

  /**
   * 更新搜索关键词并写回 ?q= URL 参数。
   * 使用 replaceState（不增加历史条目），避免用户每次键入都污染 back-stack；
   * 为空时 buildPromptGalleryBrowserUrl 会自动删除 ?q= 参数，保持地址栏干净。
   * 这个方法被 PromptGallery toolbar 输入框和 LandingPageShell header 搜索框共用；
   * 调用后会 dispatch gallery:statechange，保证两个消费方 hook 实例都同步到最新值。
   */
  const commitSearchInput = useCallback((value: string) => {
    if (routeState.sharedPromptId) {
      // 搜索时离开单卡分享态，但保留已有 tag。
      commitRouteState(
        {
          selectedTag: routeState.selectedTag,
          sharedPromptId: null,
          searchInput: value,
        },
        { replace: true },
      );
      return;
    }

    const nextState: PromptGalleryRouteState = {
      selectedTag: routeState.selectedTag,
      sharedPromptId: null,
      searchInput: value,
    };
    const nextUrl = buildPromptGalleryBrowserUrl(window.location.href, nextState);
    window.history.replaceState(null, '', nextUrl);
    setRouteState(nextState);
    window.dispatchEvent(new Event(GALLERY_STATE_CHANGE_EVENT));
  }, [commitRouteState, routeState.selectedTag, routeState.sharedPromptId]);

  return {
    isRouteStateReady,
    selectedTag: routeState.selectedTag,
    sharedPromptId: routeState.sharedPromptId,
    searchInput: routeState.searchInput,
    commitRouteState,
    commitTagSelection,
    clearSharedPromptId,
    commitSearchInput,
  };
}
