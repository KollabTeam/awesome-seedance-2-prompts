/**
 * analytics.tsx 负责给独立 landing-pages 应用装载生产 Web 埋点。
 * 它位于 GPT Image 2 / Seedance 2 引流页的根布局层，被 App Router layout 挂载；
 * 这里复用官网与 fe-app 的同一组公开 provider，让引流页访问可以进入统一的增长、SEO、回放和产品漏斗口径。
 */

import { FirebaseAnalyticsRuntime } from './firebase-analytics-runtime';
import { MixpanelRuntime } from './mixpanel-runtime';

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID || '';
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';
const AHREFS_ANALYTICS_KEY = process.env.NEXT_PUBLIC_AHREFS_ANALYTICS_KEY || '';
const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || '';
const APP_ENV = process.env.VITE_APP_ENV || 'development';
const PRODUCTION_ANALYTICS_HOSTS = new Set(['kollab.im', 'www.kollab.im']);
const LANDING_PUBLIC_HOST_SIGNAL = process.env.NEXT_PUBLIC_PROXY_TARGET || '';
const REQUIRED_ANALYTICS_CONFIG = [
  GTM_ID,
  GA_MEASUREMENT_ID,
  AHREFS_ANALYTICS_KEY,
  CLARITY_PROJECT_ID,
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  process.env.NEXT_PUBLIC_MIXPANEL_TOKEN,
];

/**
 * 从部署注入的公开 URL 中提取 landing-pages 实际服务域名。
 * App Router 根布局在服务端渲染，不能读取浏览器 location；部署脚本传入 `NEXT_PUBLIC_PROXY_TARGET`
 * 是为了和 website 使用同一个 host gate，确保 alpha/test 即便使用 production build 也不会写入正式统计口径。
 */
function getConfiguredLandingHost(): string {
  try {
    return new URL(LANDING_PUBLIC_HOST_SIGNAL).hostname;
  } catch {
    return LANDING_PUBLIC_HOST_SIGNAL;
  }
}

/**
 * 校验 landing-pages 埋点公开配置是否完整。
 * 这里要求所有 provider 同时具备配置，是为了避免部分 SDK 启动、部分 SDK 缺失后造成
 * GPT Image 2 / Seedance 2 页面在不同后台里的访问口径互相对不上。
 */
function hasRequiredAnalyticsConfig(): boolean {
  return REQUIRED_ANALYTICS_CONFIG.every(Boolean);
}

const ANALYTICS_ENABLED = APP_ENV === 'production'
  && PRODUCTION_ANALYTICS_HOSTS.has(getConfiguredLandingHost())
  && hasRequiredAnalyticsConfig();

/**
 * 渲染 head 级第三方脚本。
 * GTM 作为增长侧低代码分发层，GA4 负责基础 page_view，Ahrefs 补 SEO 数据，
 * Clarity 提供会话回放和热力图；它们都只在正式生产域名且配置齐全时输出。
 */
export function AnalyticsHead() {
  if (!ANALYTICS_ENABLED) {
    return null;
  }

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`,
        }}
      />
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`,
        }}
      />
      <script async src="https://analytics.ahrefs.com/analytics.js" data-key={AHREFS_ANALYTICS_KEY} />
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,"clarity","script","${CLARITY_PROJECT_ID}");`,
        }}
      />
    </>
  );
}

/**
 * 渲染 body 级第三方 runtime。
 * Firebase 与 Mixpanel 需要浏览器存储和 history 环境，所以放在客户端 runtime 中启动；
 * GTM noscript iframe 保留在 body 开头，保证禁用 JavaScript 的访问仍能进入 GTM 基础统计。
 */
export function AnalyticsBody() {
  if (!ANALYTICS_ENABLED) {
    return null;
  }

  return (
    <>
      <FirebaseAnalyticsRuntime />
      <MixpanelRuntime />
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
        />
      </noscript>
    </>
  );
}
