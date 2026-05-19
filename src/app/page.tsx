/**
 * page.tsx 提供 landing-pages 服务根路径的轻量跳转入口。
 * 它位于 landing-pages 的 App Router 默认路由层；公网真实入口始终走各自的顶级 route slug，
 * 这里只为本地调试和容器直连保留一个稳定起点，避免去掉单一 basePath 后根路径直接落成 404。
 */
import { redirect } from 'next/navigation';

import { DEFAULT_LANDING_ROUTE_SLUG } from '@/lib/landing-language';

// 页面层强制动态渲染，避免 App Router Full Route Cache 复用旧的首屏 HTML。
// 生产的 Notion 保护仍由数据层 fetch revalidate=600 承担；这里不再缓存整页，是为了本地调试和客户端 hydrate 都拿到同一版 payload。
export const dynamic = 'force-dynamic';

/**
 * 根路径不承载独立 SEO 内容，因此直接跳转到默认 landing page。
 * 对外真正可索引的 metadata 已经下沉到 `/{landingPageSlug}` 和 `/{landingPageSlug}/{lan}`。
 */
export default function LandingPagesRootRedirect() {
  redirect(`/${DEFAULT_LANDING_ROUTE_SLUG}`);
}
