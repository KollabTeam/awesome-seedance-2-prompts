/**
 * sync.ts orchestrates Notion -> Postgres -> S3/CDN refreshes for standalone prompt landing pages.
 * It runs inside apps/landing-pages internal routes or scheduled jobs; apps/server only owns the SQL migration runner,
 * so all data normalization, media mirroring, and read-model writes stay colocated with the landing app.
 */
import crypto from 'node:crypto';

import { withLandingPromptDbClient } from './db';
import { mirrorLandingPromptAsset, type MirroredLandingAsset } from './assets';
import {
  fetchLandingPromptNotionPage,
  parseLandingPromptNotionPage,
  type LandingPromptNotionPageResult,
  type NotionPromptPageLike,
} from './notion';
import { syncPromptAssets } from './asset-writes';
import { archiveMissingPrompts, formatSyncError, upsertLandingPromptRow } from './sync-writes';
import { LandingPromptSyncRunStatus, type LandingPromptSourceConfig } from './types';

export type LandingPromptSyncDbClient = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export type LandingPromptSyncResult = {
  landingType: string;
  status: LandingPromptSyncRunStatus.Succeeded | LandingPromptSyncRunStatus.Partial;
  pulledCount: number;
  updatedCount: number;
  archivedCount: number;
  assetSuccessCount: number;
  assetFailedCount: number;
};

type SyncLandingPromptSourceInput = {
  source: LandingPromptSourceConfig;
  client?: LandingPromptSyncDbClient;
  pageSize?: number;
  fetchPage?: (input: {
    source: LandingPromptSourceConfig;
    cursor?: string | null;
    pageSize?: number;
  }) => Promise<LandingPromptNotionPageResult>;
  mirrorAsset?: (input: {
    sourceUrl: string;
    s3Prefix: string;
    notionPageId: string;
    position: number;
    avatar?: boolean;
  }) => Promise<MirroredLandingAsset>;
  idFactory?: () => string;
};

type AdvisoryLockRow = {
  locked: boolean;
};

const DEFAULT_SYNC_PAGE_SIZE = 100;

/**
 * Runs a complete sync for one configured landing source.
 * It uses a Postgres advisory lock to prevent overlapping cron/manual runs from racing on the same `landing_type`.
 */
async function syncLandingPromptSourceWithClient({
  source,
  client,
  pageSize = DEFAULT_SYNC_PAGE_SIZE,
  fetchPage = fetchLandingPromptNotionPage,
  mirrorAsset = mirrorLandingPromptAsset,
  idFactory = crypto.randomUUID,
}: Required<Pick<SyncLandingPromptSourceInput, 'source' | 'client'>> & Omit<SyncLandingPromptSourceInput, 'source' | 'client'>): Promise<LandingPromptSyncResult> {
  const lockKey = `landing_prompt_sync:${source.landingType}`;
  const lockResult = await client.query<AdvisoryLockRow>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]);
  if (!lockResult.rows[0]?.locked) {
    throw new Error('landing_prompt_sync_already_running');
  }

  const syncRunId = idFactory();
  let pulledCount = 0;
  let updatedCount = 0;
  let archivedCount = 0;
  let assetSuccessCount = 0;
  let assetFailedCount = 0;
  let fetchedNotionPageCount = 0;
  let dataTransactionStarted = false;

  try {
    await client.query(
      `
        INSERT INTO landing_prompt_sync_run (
          id,
          landing_type,
          status,
          started_at
        ) VALUES ($1, $2, $3, NOW())
      `,
      [syncRunId, source.landingType, LandingPromptSyncRunStatus.Running],
    );

    // Public pages read directly from the active DB rows, so all prompt/asset/archive mutations publish together.
    // sync_run itself is inserted outside the transaction to preserve a failure row even when data writes roll back.
    await client.query('BEGIN');
    dataTransactionStarted = true;

    const maxPages = Number.parseInt(process.env.LANDING_PROMPTS_SYNC_MAX_PAGES || '100', 10);
    const seenNotionPageIds: string[] = [];
    let cursor: string | null = null;
    let pageIndex = 0;

    do {
      const notionPage = await fetchPage({ source, cursor, pageSize });
      fetchedNotionPageCount += notionPage.pages.length;
      for (const [pageOffset, page] of notionPage.pages.entries()) {
        const parsed = parseLandingPromptNotionPage(page as NotionPromptPageLike, source, pageIndex * pageSize + pageOffset);
        const hasPromptText =
          Object.values(parsed.prompts).some((prompt) => prompt.trim().length > 0) ||
          Object.values(parsed.secondaryPrompts || {}).some((prompt) => prompt.trim().length > 0);
        if (!hasPromptText) {
          continue;
        }

        seenNotionPageIds.push(parsed.notionPageId);
        const promptId = await upsertLandingPromptRow({ client, parsed, idFactory });
        const assetCounts = await syncPromptAssets({ source, parsed, promptId, client, idFactory, mirrorAsset });
        pulledCount += 1;
        updatedCount += 1;
        assetSuccessCount += assetCounts.successCount;
        assetFailedCount += assetCounts.failedCount;
      }

      cursor = notionPage.hasMore ? notionPage.nextCursor : null;
      pageIndex += 1;
    } while (cursor && pageIndex < (Number.isFinite(maxPages) ? maxPages : 100));

    // 不在超过安全页数后继续 archive：这代表 Notion pagination 异常或数据量超出预期，
    // 继续归档会把本次没拉到的历史 prompt 误判为已删除。
    if (cursor) {
      throw new Error('landing_prompt_sync_max_pages_exceeded');
    }
    // 如果 Notion 确实返回了页面但没有任何可用 prompt，通常代表字段名、权限或 schema 异常。
    // 这种情况下禁止 archive 旧内容，避免一次配置错误把线上 landing page 清空。
    if (fetchedNotionPageCount > 0 && seenNotionPageIds.length === 0) {
      throw new Error('landing_prompt_sync_no_valid_prompts');
    }

    archivedCount = await archiveMissingPrompts({ client, source, seenNotionPageIds });
    const status = assetFailedCount > 0 ? LandingPromptSyncRunStatus.Partial : LandingPromptSyncRunStatus.Succeeded;
    await client.query(
      `
        UPDATE landing_prompt_sync_run
        SET status = $1,
            finished_at = NOW(),
            pulled_count = $2,
            updated_count = $3,
            archived_count = $4,
            asset_success_count = $5,
            asset_failed_count = $6
        WHERE id = $7
      `,
      [status, pulledCount, updatedCount, archivedCount, assetSuccessCount, assetFailedCount, syncRunId],
    );
    await client.query('UPDATE landing_prompt_source SET last_synced_at = NOW(), updated_at = NOW() WHERE landing_type = $1', [source.landingType]);
    await client.query('COMMIT');
    dataTransactionStarted = false;

    return {
      landingType: source.landingType,
      status,
      pulledCount,
      updatedCount,
      archivedCount,
      assetSuccessCount,
      assetFailedCount,
    };
  } catch (error) {
    if (dataTransactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Keep reporting the original sync error. A rollback failure normally means the connection is already broken, and
        // replacing the root cause here would make the sync_run diagnostics less useful.
      }
      dataTransactionStarted = false;
    }
    await client.query(
      `
        UPDATE landing_prompt_sync_run
        SET status = $1,
            finished_at = NOW(),
            pulled_count = $2,
            updated_count = $3,
            archived_count = $4,
            asset_success_count = $5,
            asset_failed_count = $6,
            error_message = $7
        WHERE id = $8
      `,
      [
        LandingPromptSyncRunStatus.Failed,
        pulledCount,
        updatedCount,
        archivedCount,
        assetSuccessCount,
        assetFailedCount,
        formatSyncError(error),
        syncRunId,
      ],
    );
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
  }
}

/**
 * Public sync entrypoint for one landing source.
 * Tests pass a fake client; production callers omit it so the operation runs on one checked-out Postgres client.
 */
export async function syncLandingPromptSource(input: SyncLandingPromptSourceInput): Promise<LandingPromptSyncResult> {
  if (input.client) {
    return syncLandingPromptSourceWithClient({ ...input, client: input.client });
  }

  return withLandingPromptDbClient((client) => syncLandingPromptSourceWithClient({ ...input, client }));
}
