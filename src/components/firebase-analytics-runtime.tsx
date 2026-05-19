'use client';

/**
 * firebase-analytics-runtime.tsx 在 landing-pages 客户端启动 Firebase Analytics。
 * 它位于引流页浏览器埋点层，由根 layout 的 AnalyticsBody 挂载；
 * SDK 初始化放到客户端 effect 中，是因为 Firebase Analytics 依赖浏览器存储能力，不能在服务端布局中运行。
 */

import { useEffect } from 'react';
import { getApps, initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';

const FIREBASE_APP_NAME = 'kollab-landing-pages-analytics';
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || '',
};

let firebaseAnalyticsStarted = false;

/**
 * 校验 Firebase Web config 是否完整。
 * 父级 analytics 组件已经做了统一门禁，这里仍保留客户端防线，
 * 避免将来有人单独挂载本 runtime 时用空配置创建 Firebase app。
 */
function hasFirebaseAnalyticsConfig(): boolean {
  return Object.values(firebaseConfig).every(Boolean);
}

/**
 * 在浏览器端初始化 Firebase Analytics。
 * 这个函数只被组件 effect 调用，并用模块级状态防止 Next 客户端重渲染时重复创建 app；
 * `isSupported()` 放在初始化前，是为了兼容隐私模式或禁用 IndexedDB 的浏览器。
 */
async function startFirebaseAnalytics() {
  if (firebaseAnalyticsStarted || !hasFirebaseAnalyticsConfig()) {
    return;
  }

  firebaseAnalyticsStarted = true;

  if (!(await isSupported())) {
    return;
  }

  const existingApp = getApps().find((app) => app.name === FIREBASE_APP_NAME);
  const app = existingApp ?? initializeApp(firebaseConfig, FIREBASE_APP_NAME);
  getAnalytics(app);
}

/**
 * 挂载 Firebase Analytics 的客户端生命周期。
 * 组件不渲染 UI，只把 GPT Image 2 / Seedance 2 引流页访问纳入 Firebase Web 数据流；
 * 第三方 SDK 失败时静默回退，避免埋点故障影响公开页面首屏和 SEO。
 */
export function FirebaseAnalyticsRuntime() {
  useEffect(() => {
    void startFirebaseAnalytics().catch(() => {
      firebaseAnalyticsStarted = false;
    });
  }, []);

  return null;
}
