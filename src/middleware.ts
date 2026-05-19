/**
 * middleware.ts 是 landing-pages 应用的 Edge 层请求桥接器。
 * 它位于 Next.js 路由解析之前，仅负责把公开 /{lang}/{slug} URL 内部 rewrite 到
 * /{slug}/{lan}，让 App Router 的 [landingPageSlug]/[lan]/page.tsx 能正常命中。
 *
 * 为什么用 rewrite 而不是把路由文件改成 [lang] 在前：
 * Next.js 不允许同一路径层级的两个 dynamic segment 使用不同名称（[landingPageSlug] 与 [lang]
 * 会在运行时触发 "different slug names" 崩溃）。rewrite 让浏览器可见 URL 始终保持 lang-first
 * 形态，同时绕过这个限制。
 *
 * 调用链：
 *   /{lang}/{slug} 请求到达 → 本 middleware → NextResponse.rewrite(/{slug}/{lang})
 *   → [landingPageSlug]/[lan]/page.tsx 服务端渲染 → 浏览器看到的 URL 仍是 /{lang}/{slug}
 *
 * Edge runtime 限制：不能使用 fs、path、pg 等 Node.js-only 模块；
 * 本文件只引用两个纯数据模块（无副作用导入），可安全运行在 Edge。
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { LANDING_LANGUAGE_OPTIONS } from '@/lib/landing-language';
import { getLandingPageConfigs } from '@/lib/landing-page-config';

// 在模块初始化时构建 Set，避免每次请求都重复遍历数组。
// 这两个集合在 Edge runtime 中随模块缓存，满足 Pillar 3 — 不在热路径上做冗余计算。
// Widened to Set<string> so we can safely call .has() with any runtime string segment from the URL.
// The type-level union from LANDING_LANGUAGE_OPTIONS.map(o => o.code) would require a cast at every
// .has() call site — widening here is the right tradeoff for a runtime guard that just needs equality.
const LANG_SET: Set<string> = new Set(LANDING_LANGUAGE_OPTIONS.map((option) => option.code));
const SLUG_SET: Set<string> = new Set(getLandingPageConfigs().map((config) => config.routeSlug));

/**
 * middleware 入口：匹配 /{lang}/{slug} 形态的请求并内部 rewrite 到 /{slug}/{lang}。
 * 只处理两段路径且第一段是已知语言、第二段是已知 slug 的请求；其余请求直接 pass-through。
 * rewrite 是服务端内部操作，不会改变浏览器看到的 URL。
 */
export function middleware(request: NextRequest) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);

  if (segments.length === 2) {
    const first = segments[0]!;
    const second = segments[1]!;
    // 仅当第一段是支持的语言、第二段是已知 landing slug 时才 rewrite。
    // 顺序很重要：lang 在前 slug 在后，对应公开 URL 形态；rewrite 后变成 slug 在前 lang 在后，
    // 对应 [landingPageSlug]/[lan]/page.tsx 的内部路由形态。
    if (LANG_SET.has(first) && SLUG_SET.has(second)) {
      const url = request.nextUrl.clone();
      url.pathname = `/${second}/${first}`;
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // 排除 _next/ 静态资源、landing-pages-static/ 资产前缀、api/ 路由和带扩展名的静态文件（favicon 等）。
  // /{slug}/api/prompts 分页 API 由 api/ 前缀排除，不会被误 rewrite。
  matcher: ['/((?!_next/|landing-pages-static/|api/|favicon\\.ico|.*\\.[^/]+$).*)'],
};
