/**
 * types.ts defines the landing prompt read model shared by server-only sync/query code and public gallery payloads.
 * It lives inside apps/landing-pages because this standalone landing app owns the prompt data backend;
 * the SQL is only placed under apps/server/migrations so the existing deployment runner creates the tables.
 */
export const LANDING_PROMPT_LANGUAGES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'ru', 'pt-BR'] as const;

export type LandingPromptLanguage = (typeof LANDING_PROMPT_LANGUAGES)[number];

/**
 * landing prompt 状态值对齐仓库里通用的 BlockStatus 语义。
 * admin 删除动作需要直接把状态写成 -1，因此 landing-pages 自己的同步与查询也必须使用同一套数值，
 * 避免同一张表在 public read path 与 admin write path 之间来回做字符串/数字转换。
 */
export enum LandingPromptStatus {
  Archived = -1,
  Invalid = 0,
  Active = 1,
}

export enum LandingPromptAssetKind {
  PromptMedia = 'prompt_media',
  AuthorAvatar = 'author_avatar',
}

export enum LandingPromptAssetMediaType {
  Image = 'image',
  Video = 'video',
  Unknown = 'unknown',
}

export enum LandingPromptAssetStatus {
  Active = 'active',
  Failed = 'failed',
  Stale = 'stale',
}

export enum LandingPromptSyncRunStatus {
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Partial = 'partial',
}

export type LandingPromptLocalizedPropertyMap = Partial<Record<LandingPromptLanguage, string>> & {
  fallback?: string[];
};

export type LandingPromptPropertyMap =
  | LandingPromptLocalizedPropertyMap
  | {
      primary: LandingPromptLocalizedPropertyMap;
      secondary: LandingPromptLocalizedPropertyMap;
    };

export type LandingPromptSourceConfig = {
  landingType: string;
  slug: string;
  name: string;
  notionDatabaseId: string;
  notionVersion: string;
  promptPropertyMap: LandingPromptPropertyMap;
  tagPropertyName: string;
  imagePropertyName: string;
  authorAvatarPropertyName: string;
  s3Prefix: string;
};

export type ParsedLandingPromptMedia = {
  sourceUrl: string;
  position: number;
  posterSourceUrl?: string | null;
};

export type ParsedLandingPromptPage = {
  landingType: string;
  notionPageId: string;
  notionCreatedAt: Date | null;
  notionLastEditedAt: Date | null;
  title: string;
  prompts: Record<LandingPromptLanguage, string>;
  secondaryPrompts: Record<LandingPromptLanguage, string> | null;
  authorName: string;
  authorUrl: string | null;
  authorAvatarSourceUrl: string | null;
  sourceUrl: string | null;
  tags: string[];
  likeCount: number;
  media: ParsedLandingPromptMedia[];
  sortOrder: number;
};

export type PromptGalleryMedia = {
  id: string;
  type: 'image' | 'video';
  url: string;
  playbackKind: 'mp4' | 'hls';
  posterUrl: string | null;
  cardUrl: string | null;
  detailUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};
