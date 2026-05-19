'use client';

/**
 * mixpanel-runtime.tsx 在 landing-pages 客户端启动 Mixpanel。
 * 它位于引流页浏览器埋点层，由根 layout 的 AnalyticsBody 挂载；
 * Mixpanel 与官网、fe-app 共用 project token，用来把匿名引流访问和登录后的产品行为串到同一条漏斗。
 */

import { useEffect } from 'react';

const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN || '';
const MIXPANEL_REPLAY_PERCENT = Number(process.env.NEXT_PUBLIC_MIXPANEL_REPLAY_PERCENT || '10') || 10;

let mixpanelStarted = false;

/**
 * 在浏览器端初始化 Mixpanel SDK。
 * 动态 import 避免把 SDK 放进公开 landing page 的首屏关键路径；
 * `track_pageview` 交给 SDK 自动监听 URL，是因为 landing-pages 没有 fe-app 那样的统一 React Router tracker。
 * 会话回放维持低抽样，既保留增长排查能力，又控制事件配额和公开页性能成本。
 * 回放配置显式关闭文本、输入和元素级额外屏蔽，让引流页访问可以按真实页面状态回放；
 * 浏览器 SDK 对密码等安全输入仍有不可关闭的内置保护。
 */
async function startMixpanel() {
  if (mixpanelStarted || !MIXPANEL_TOKEN) {
    return;
  }

  mixpanelStarted = true;

  try {
    const mod = await import('mixpanel-browser');
    mod.default.init(MIXPANEL_TOKEN, {
      autocapture: true,
      record_sessions_percent: MIXPANEL_REPLAY_PERCENT,
      track_pageview: 'url-with-path-and-query-string',
      persistence: 'localStorage',
      ignore_dnt: false,
      record_block_selector: '',
      record_mask_all_text: false,
      record_mask_all_inputs: false,
    });
  } catch {
    // 第三方埋点不可用时不影响公开页面渲染；下次客户端重挂载仍允许重试。
    mixpanelStarted = false;
  }
}

/**
 * 挂载 Mixpanel 的客户端生命周期。
 * 组件不渲染 UI，只负责在浏览器 hydration 后启动产品分析和抽样回放。
 */
export function MixpanelRuntime() {
  useEffect(() => {
    void startMixpanel();
  }, []);

  return null;
}
