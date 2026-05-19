/**
 * route.ts exposes an internal landing prompt sync endpoint inside the standalone landing-pages app.
 * It is called by Kubernetes CronJobs or manual operator requests to refresh Notion prompt data into Postgres and S3;
 * public page/API reads use the synced DB rows and never call this route.
 */
import { getLandingPromptSourceBySlug } from '@/lib/server/landing-prompts/sources';
import { syncLandingPromptSource } from '@/lib/server/landing-prompts/sync';

export const runtime = 'nodejs';

type SyncRouteContext = {
  params: Promise<{ landingSlug: string }> | { landingSlug: string };
};

/**
 * Checks the internal sync token from either `x-internal-token` or a Bearer header.
 * The token is deliberately required even for in-cluster CronJobs so a public ingress path cannot trigger heavy
 * Notion/S3 sync work by accident.
 */
export function isAuthorizedLandingPromptSyncRequest(request: Request, expectedToken = process.env.LANDING_PROMPTS_INTERNAL_TOKEN || ''): boolean {
  if (!expectedToken) {
    return false;
  }

  const headerToken = request.headers.get('x-internal-token') || '';
  const bearerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  return headerToken === expectedToken || bearerToken === expectedToken;
}

/**
 * Determines whether this environment may write landing prompt sync data.
 * The flag is still checked at route time because test and production may share prompt tables through
 * LANDING_PROMPTS_DB_* overrides, and operators need a deployment-level switch before allowing CronJobs to write rows.
 */
export function isLandingPromptSyncEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LANDING_PROMPTS_SYNC_ENABLED !== 'false';
}

/**
 * Resolves App Router dynamic params across Next versions.
 * Some generated route types expose params as a Promise, so awaiting it keeps this endpoint compatible with current
 * landing-pages type generation.
 */
async function resolveSyncRouteParams(context: SyncRouteContext): Promise<{ landingSlug: string }> {
  return await context.params;
}

/**
 * Runs one landing prompt source sync.
 * The response uses compact machine-readable error codes because this is an internal operator/CronJob API, not a UI.
 */
export async function POST(request: Request, context: SyncRouteContext) {
  if (!isAuthorizedLandingPromptSyncRequest(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isLandingPromptSyncEnabled()) {
    return Response.json({ error: 'sync_disabled' }, { status: 409 });
  }

  const params = await resolveSyncRouteParams(context);
  const source = await getLandingPromptSourceBySlug(params.landingSlug);
  if (!source) {
    return Response.json({ error: 'landing_prompt_source_not_found' }, { status: 404 });
  }

  try {
    const result = await syncLandingPromptSource({ source });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Internal cron diagnostics need the exact landing source and thrown message because the HTTP response is
    // intentionally compact; without this log, operators have to jump to Postgres sync_run rows just to identify the
    // failing source or distinguish transient Notion 5xx from schema/config regressions.
    console.error('[landing-prompt-sync] failed', {
      landingSlug: params.landingSlug,
      landingType: source.landingType,
      error: message,
    });
    return Response.json(
      {
        error: message === 'landing_prompt_sync_already_running' ? 'already_running' : 'sync_failed',
      },
      {
        status: message === 'landing_prompt_sync_already_running' ? 409 : 500,
      },
    );
  }
}
