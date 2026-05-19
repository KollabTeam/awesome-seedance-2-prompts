/**
 * route.ts 提供 landing-pages 容器的健康检查端点。
 * 它位于 Next.js route handler 层，被 Docker healthcheck、K8S readiness 和 liveness 探针调用；
 * 健康检查不依赖 Notion，避免 CMS 抖动时把整个容器错误标记为不可用。
 */

/**
 * 返回轻量健康状态。
 * 这个方法被 `/api/health` 调用，固定返回 200，
 * 用来证明 Next 进程已经启动，且多 landing route 共用的容器入口可达。
 */
export function GET() {
  return Response.json({ ok: true, service: 'landing-pages' });
}
