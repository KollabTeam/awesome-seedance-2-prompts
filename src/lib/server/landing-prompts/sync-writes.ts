/**
 * sync-writes.ts owns the Postgres write helpers used by landing prompt sync orchestration.
 * It sits under apps/landing-pages server-only code so Notion parsing, S3 mirroring, and DB read-model writes remain
 * local to the standalone landing app while sync.ts stays focused on pagination and run-state orchestration.
 */
import type { LandingPromptSyncDbClient } from './sync';
import { LandingPromptStatus, type LandingPromptSourceConfig, type ParsedLandingPromptPage } from './types';

type PromptUpsertRow = {
  id: string;
};

/**
 * 归一化落库的 prompts JSON。
 * 旧 landing source 仍然写单层 `{ lang: text }` 结构；
 * 双 prompt source 写 `{ primary: {...}, secondary: {...} }`，这样 DB 保持单列真相，
 * query 层再按 source 能力拆成 `prompt / secondaryPrompt`。
 */
function buildPromptPayload(parsed: ParsedLandingPromptPage): Record<string, unknown> {
  if (!parsed.secondaryPrompts) {
    return parsed.prompts;
  }

  return {
    primary: parsed.prompts,
    secondary: parsed.secondaryPrompts,
  };
}

/**
 * Returns an error string short enough for landing_prompt_asset.error_message.
 * External media hosts can return verbose network errors; truncating here keeps sync rows useful without bloating DB rows.
 */
export function formatSyncError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Inserts or updates the normalized prompt row and returns its stable database id.
 * The unique `(landing_type, notion_page_id)` key is the real identity, so a random id is only used on first insert.
 * `notion_created_at` and `like_count` are stored even though current UI does not sort by them yet, because
 * recommendation ranking should use the synced DB source of truth instead of reaching back into Notion at request time.
 * `prompts` 现在兼容单 prompt 和双 prompt source，因此这里在写入前统一归一结构，
 * 避免后续又为了第二段 prompt 文本扩出并行列或旁路缓存。
 * 冲突更新时刻意不覆盖 `status`：admin 的人工归档是运营真相，sync 只负责刷新内容字段，
 * 不能把已手工隐藏的 prompt 在下一轮 Notion 同步里悄悄恢复成 active。
 */
export async function upsertLandingPromptRow({
  client,
  parsed,
  idFactory,
}: {
  client: LandingPromptSyncDbClient;
  parsed: ParsedLandingPromptPage;
  idFactory: () => string;
}): Promise<string> {
  const result = await client.query<PromptUpsertRow>(
    `
      INSERT INTO landing_prompt (
        id,
        landing_type,
        notion_page_id,
        notion_created_at,
        notion_last_edited_at,
        title,
        prompts,
        author_name,
        author_url,
        source_url,
        tags,
        like_count,
        sort_order,
        status,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        $8,
        $9,
        $10,
        $11::jsonb,
        $12,
        $13,
        $14,
        NOW()
      )
      ON CONFLICT (landing_type, notion_page_id)
      DO UPDATE SET
        notion_created_at = EXCLUDED.notion_created_at,
        notion_last_edited_at = EXCLUDED.notion_last_edited_at,
        title = EXCLUDED.title,
        prompts = EXCLUDED.prompts,
        author_name = EXCLUDED.author_name,
        author_url = EXCLUDED.author_url,
        source_url = EXCLUDED.source_url,
        tags = EXCLUDED.tags,
        like_count = EXCLUDED.like_count,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
      RETURNING id
    `,
    [
      idFactory(),
      parsed.landingType,
      parsed.notionPageId,
      parsed.notionCreatedAt,
      parsed.notionLastEditedAt,
      parsed.title,
      JSON.stringify(buildPromptPayload(parsed)),
      parsed.authorName,
      parsed.authorUrl,
      parsed.sourceUrl,
      JSON.stringify(parsed.tags),
      parsed.likeCount,
      parsed.sortOrder,
      LandingPromptStatus.Active,
    ]
  );

  const promptId = result.rows[0]?.id;
  if (!promptId) {
    throw new Error('landing_prompt_upsert_missing_id');
  }

  return promptId;
}

/**
 * Marks prompts that disappeared from Notion as archived.
 * The rows are retained for diagnostics, while public queries only read active prompts.
 */
export async function archiveMissingPrompts({
  client,
  source,
  seenNotionPageIds,
}: {
  client: LandingPromptSyncDbClient;
  source: LandingPromptSourceConfig;
  seenNotionPageIds: string[];
}): Promise<number> {
  const result = await client.query(
    `
      UPDATE landing_prompt
      SET status = $4,
          updated_at = NOW()
      WHERE landing_type = $1
        AND status = $2
        AND NOT (notion_page_id = ANY($3::text[]))
      RETURNING id
    `,
    [source.landingType, LandingPromptStatus.Active, seenNotionPageIds, LandingPromptStatus.Archived]
  );

  return result.rowCount ?? result.rows.length;
}
