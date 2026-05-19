/**
 * sources.ts resolves landing prompt source configuration from public slugs and Postgres rows.
 * It is the boundary that lets `/gpt-image-2-prompts` keep a readable URL while the database uses stable
 * `landing_type` values that can be extended for future prompt sources such as Seedance.
 */
import type { QueryResultRow } from 'pg';

import { queryLandingPromptDb } from './db';
import type { LandingPromptPropertyMap, LandingPromptSourceConfig } from './types';

export type LandingPromptSourceRow = QueryResultRow & {
  landing_type: string;
  slug: string;
  name: string;
  notion_database_id: string;
  notion_version: string;
  prompt_property_map: LandingPromptPropertyMap | string;
  tag_property_name: string;
  image_property_name: string;
  author_avatar_property_name: string;
  s3_prefix: string;
};

/**
 * Normalizes a public source slug into its internal landing_type form.
 * This is used before DB lookups and by tests so route params cannot accidentally create a second naming convention.
 */
export function normalizeLandingPromptSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/-/g, '_');
}

/**
 * Converts one database source row into runtime configuration.
 * 这里允许不同 landing source 各自覆盖 Notion database id，
 * 是为了让 test/editorial 环境可以单独切换某个页面的 CMS 数据源，而不需要改动种子行或影响其它页面。
 */
export function mapLandingPromptSourceRow(row: LandingPromptSourceRow): LandingPromptSourceConfig {
  const promptPropertyMap =
    typeof row.prompt_property_map === 'string'
      ? (JSON.parse(row.prompt_property_map) as LandingPromptPropertyMap)
      : row.prompt_property_map;

  const notionDatabaseIdOverrideByLandingType: Partial<Record<string, string | undefined>> = {
    gpt_image_2: process.env.NOTION_GPT_IMAGE_PROMPTS_DATABASE_ID,
    seedance_2: process.env.NOTION_SEEDANCE_PROMPTS_DATABASE_ID,
    gpt_image_2_seedance_2: process.env.NOTION_GPT_IMAGE_SEEDANCE_PROMPTS_DATABASE_ID,
  };

  return {
    landingType: row.landing_type,
    slug: row.slug,
    name: row.name,
    notionDatabaseId: notionDatabaseIdOverrideByLandingType[row.landing_type] || row.notion_database_id,
    notionVersion: row.notion_version || '2022-06-28',
    promptPropertyMap,
    tagPropertyName: row.tag_property_name || 'Tags',
    imagePropertyName: row.image_property_name || 'Images',
    authorAvatarPropertyName: row.author_avatar_property_name || 'Author Avatar',
    s3Prefix: row.s3_prefix,
  };
}

/**
 * Loads one enabled landing prompt source by route slug.
 * Public and internal API handlers call this first so disabled sources return 404 before touching Notion or media storage.
 */
export async function getLandingPromptSourceBySlug(slug: string): Promise<LandingPromptSourceConfig | null> {
  const normalizedLandingType = normalizeLandingPromptSlug(slug);
  const rows = await queryLandingPromptDb<LandingPromptSourceRow>(
    `
      SELECT
        landing_type,
        slug,
        name,
        notion_database_id,
        notion_version,
        prompt_property_map,
        tag_property_name,
        image_property_name,
        author_avatar_property_name,
        s3_prefix
      FROM landing_prompt_source
      WHERE enabled = TRUE
        AND (slug = $1 OR landing_type = $2)
      LIMIT 1
    `,
    [slug, normalizedLandingType],
  );

  return rows[0] ? mapLandingPromptSourceRow(rows[0]) : null;
}

/**
 * Loads all sources that should be included in manual or scheduled sync.
 * Sync-enabled is checked here rather than in the scheduler so manual backfills and cron share the same source contract.
 */
export async function getSyncEnabledLandingPromptSources(): Promise<LandingPromptSourceConfig[]> {
  const rows = await queryLandingPromptDb<LandingPromptSourceRow>(
    `
      SELECT
        landing_type,
        slug,
        name,
        notion_database_id,
        notion_version,
        prompt_property_map,
        tag_property_name,
        image_property_name,
        author_avatar_property_name,
        s3_prefix
      FROM landing_prompt_source
      WHERE enabled = TRUE
        AND sync_enabled = TRUE
      ORDER BY landing_type ASC
    `,
  );

  return rows.map(mapLandingPromptSourceRow);
}
