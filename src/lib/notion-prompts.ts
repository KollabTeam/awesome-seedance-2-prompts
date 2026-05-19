/**
 * notion-prompts.ts 负责 landing prompt gallery 的服务端读取入口。
 * 它位于 landing-pages 的页面/API 数据层：公共展示只读取同步后的 Postgres read model，
 * Notion 解析 helper 只用于同步链路和回归测试，避免页面在数据库异常时静默展示旧 CMS 或内置数据。
 */
import { DEFAULT_LANDING_LANGUAGE, getLandingPromptPropertyCandidates, type LandingLanguage } from '@/lib/landing-language';
import type { PromptGalleryMedia } from '@/lib/server/landing-prompts/types';

import { readTagProperty } from './notion-prompt-tags';
import { getSyncedGptImagePromptsPage, getSyncedLandingPromptsPage } from './notion-prompts-read-path';

export { isLandingPagesLocalDebugEnv, shouldUseLandingPromptDbReadPath } from './notion-prompts-read-path';

export type PromptGalleryItem = {
  id: string;
  title: string;
  prompt: string;
  secondaryPrompt?: string | null;
  notionCreatedAt: string | null;
  likeCount: number;
  media?: PromptGalleryMedia[];
  imageUrl: string | null;
  imageUrls: string[];
  authorName: string;
  authorUrl: string | null;
  authorAvatarUrl: string | null;
  sourceUrl: string | null;
  tags: string[];
  accentIndex: number;
};

type RichTextLike = {
  plain_text?: string;
  text?: {
    content?: string;
  };
};

type FileLike = {
  type?: string;
  external?: {
    url?: string;
  };
  file?: {
    url?: string;
  };
};

type MultiSelectOptionLike = {
  name?: string;
};

type PropertyLike = {
  type?: string;
  title?: RichTextLike[];
  rich_text?: RichTextLike[];
  url?: string | null;
  files?: FileLike[];
  multi_select?: MultiSelectOptionLike[];
  number?: number | null;
  formula?: {
    type?: string;
    number?: number | null;
  };
};

type NotionPageLike = {
  id?: string;
  created_time?: string;
  properties?: Record<string, PropertyLike>;
};

export const NOTION_PROMPTS_PAGE_SIZE = 10;
export const NOTION_PROMPTS_CACHE_SECONDS = 600;

const LIKE_PROPERTY_CANDIDATES = ['Like', 'Likes', 'like', 'likes'];

export type PromptGalleryPage = {
  items: PromptGalleryItem[];
  hasMore: boolean;
  nextCursor: string | null;
  availableTags: string[];
};

/**
 * 合并 Notion rich text 片段。
 * 这个 helper 被 title、prompt、author 和 tweet id 字段共用；
 * 之所以不直接读取第一个片段，是因为 Notion API 会把同一个单元格按样式拆成多个 rich text block。
 */
function richTextToPlainText(items: RichTextLike[] | undefined): string {
  if (!Array.isArray(items)) {
    return '';
  }

  return items
    .map((item) => item.plain_text || item.text?.content || '')
    .join('')
    .trim();
}

/**
 * 从 Notion property 中读取纯文本。
 * 这个方法被 parseNotionPromptPage 调用，用来兼容 title 和 rich_text 两种数据库列类型。
 */
function readTextProperty(properties: Record<string, PropertyLike>, name: string): string {
  const property = properties[name];
  if (!property) {
    return '';
  }

  if (property.type === 'title') {
    return richTextToPlainText(property.title);
  }

  if (property.type === 'rich_text') {
    return richTextToPlainText(property.rich_text);
  }

  return '';
}

/**
 * 按 landing 语言读取 Notion prompt 文本。
 * 这个方法被 parseNotionPromptPage 调用；候选字段由 landing-language 统一维护，
 * 这样数据库里新增 `Prompt XX` 翻译列后，首屏、分页 API 和测试都会走同一套字段优先级。
 */
function readPromptForLanguage(properties: Record<string, PropertyLike>, language: LandingLanguage): string {
  for (const propertyName of getLandingPromptPropertyCandidates(language)) {
    const value = readTextProperty(properties, propertyName);
    if (value) {
      return value;
    }
  }

  return '';
}

/**
 * 从 Notion files property 里读取所有可用图片 URL。
 * 这个方法同时支持 external 和 Notion-hosted file URL；后者会过期，因此页面只把它当作运行时展示源。
 * 返回数组而不是只取第一张，是为了让客户端 lightbox 能按 Notion 的 Images 字段完整浏览多图。
 */
function readFileUrls(properties: Record<string, PropertyLike>, name: string): string[] {
  const property = properties[name];
  const files = property?.type === 'files' && Array.isArray(property.files) ? property.files : [];
  return files
    .map((file) => (file.type === 'external' ? file.external?.url : file.file?.url))
    .filter((url): url is string => Boolean(url));
}

/**
 * 从 Notion files property 里读取第一张可用图片 URL。
 * 这个兼容 helper 被旧字段 imageUrl 和作者头像调用；prompt 图片的新 UI 读取 imageUrls，
 * 但保留 imageUrl 可以避免分页 API 的既有消费者和旧测试夹具被迫同步重写。
 */
function readFirstFileUrl(properties: Record<string, PropertyLike>, name: string): string | null {
  return readFileUrls(properties, name)[0] || null;
}

/**
 * 从 Notion url property 中读取链接。
 * 这个方法被来源链接字段调用；返回 null 而不是空字符串，是为了让 UI 能明确区分“没有来源”和“有来源但为空”。
 */
function readUrlProperty(properties: Record<string, PropertyLike>, name: string): string | null {
  const property = properties[name];
  return property?.type === 'url' && property.url ? property.url : null;
}

/**
 * 从 Notion number 或 number formula property 读取推荐信号。
 * 这个 helper 只给同步解析测试和旧 Notion page mapper 使用；公共页面仍读取已经落库的 likeCount。
 */
function readNumberProperty(properties: Record<string, PropertyLike>, names: string[]): number {
  for (const name of names) {
    const property = properties[name];
    const value =
      property?.type === 'number'
        ? property.number
        : property?.type === 'formula' && property.formula?.type === 'number'
          ? property.formula.number
          : null;

    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
  }

  return 0;
}

/**
 * 规范化 Notion page 时间戳。
 * 这个 mapper 只保留可序列化 ISO 字符串，方便 API payload 后续直接参与推荐 freshness 计算。
 */
function readNotionTimestamp(value: string | undefined): string | null {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * 从标题和 prompt 中推导卡片标签。
 * 这个方法被 Notion 解析和 fallback 数据共用；它只生成少量稳定标签，
 * 是为了让 Bento Grid 有筛选/扫读线索，同时不把标签作为新的内容真相源。
 */
function deriveTags(title: string, prompt: string): string[] {
  const text = `${title} ${prompt}`.toLowerCase();
  const candidates: Array<[string, string]> = [
    ['Cinematic', 'cinematic'],
    ['Product', 'product'],
    ['Portrait', 'portrait'],
    ['Editorial', 'editorial'],
    ['Architecture', 'architect'],
    ['Texture', 'texture'],
    ['Light', 'light'],
    ['3D', '3d'],
    ['Photo', 'photo'],
  ];

  const tags = candidates
    .filter(([, needle]) => text.includes(needle))
    .map(([label]) => label)
    .slice(0, 3);

  return tags.length > 0 ? tags : ['Prompt', 'Image', 'Gallery'];
}

/**
 * 将单条 Notion page 转换成 gallery item。
 * 这个方法被服务端 fetch 结果和单元测试直接调用；prompt 字段根据当前 landing language 选择对应 `Prompt XX` 列，
 * tags 仍优先用英文 prompt 推导，是为了避免中文/日文等翻译内容让英文关键词标签全部退回默认值。
 */
export function parseNotionPromptPage(page: unknown, index: number, language: LandingLanguage = DEFAULT_LANDING_LANGUAGE): PromptGalleryItem {
  const notionPage = page as NotionPageLike;
  const properties = notionPage.properties || {};
  const title = readTextProperty(properties, 'Name') || `GPT Image prompt ${index + 1}`;
  const prompt = readPromptForLanguage(properties, language);
  const tagPrompt = readPromptForLanguage(properties, DEFAULT_LANDING_LANGUAGE) || prompt;
  const authorName = readTextProperty(properties, 'Author Name') || 'Unknown creator';
  const imageUrls = readFileUrls(properties, 'Images');
  const media: PromptGalleryMedia[] = imageUrls.map((imageUrl, imageIndex) => ({
    id: `${notionPage.id || `notion-${index}`}-image-${imageIndex}`,
    type: 'image',
    url: imageUrl,
    playbackKind: 'mp4',
    posterUrl: null,
    cardUrl: null,
    detailUrl: null,
    width: null,
    height: null,
    durationMs: null,
  }));
  const notionTags = readTagProperty(properties);

  return {
    id: notionPage.id || `notion-${index}`,
    title,
    prompt,
    secondaryPrompt: null,
    notionCreatedAt: readNotionTimestamp(notionPage.created_time),
    likeCount: readNumberProperty(properties, LIKE_PROPERTY_CANDIDATES),
    media,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    authorName,
    authorUrl: readUrlProperty(properties, 'Author URL'),
    authorAvatarUrl: readFirstFileUrl(properties, 'Author Avatar'),
    sourceUrl: readUrlProperty(properties, 'Tweet URL'),
    tags: notionTags.length > 0 ? notionTags : deriveTags(title, tagPrompt),
    accentIndex: index,
  };
}

/**
 * 读取一页指定 source 的 prompt。
 * 页面首屏和分页 API 都调用这个方法；它只查同步后的 Postgres read model，
 * 这样数据库缺数据或连接失败会显式暴露，而不是回退到不同来源导致线上内容真假混在一起。
 */
export async function getLandingPromptsPage({
  sourceSlug,
  cursor,
  pageSize = NOTION_PROMPTS_PAGE_SIZE,
  language = DEFAULT_LANDING_LANGUAGE,
  tag,
  query,
  id,
}: {
  sourceSlug: string;
  cursor?: string | null;
  pageSize?: number;
  language?: LandingLanguage;
  tag?: string | null;
  query?: string | null;
  id?: string | null;
}): Promise<PromptGalleryPage> {
  return getSyncedLandingPromptsPage({ sourceSlug, cursor, pageSize, language, tag, query, id });
}

/**
 * 读取一页 GPT Image 2 prompt。
 * 这个 wrapper 保留既有调用点与测试名称，避免多 landing page 改造把历史 GPT Image 页面一起打碎。
 */
export async function getGptImagePromptsPage({
  cursor,
  pageSize = NOTION_PROMPTS_PAGE_SIZE,
  language = DEFAULT_LANDING_LANGUAGE,
  tag,
  query,
  id,
}: {
  cursor?: string | null;
  pageSize?: number;
  language?: LandingLanguage;
  tag?: string | null;
  query?: string | null;
  id?: string | null;
} = {}): Promise<PromptGalleryPage> {
  return getSyncedGptImagePromptsPage({ cursor, pageSize, language, tag, query, id });
}

/**
 * 读取一页 Seedance 2 prompt。
 * 这个 helper 主要给 Seedance 落地页与其分页 API 使用，让新的视频 prompt 页面不再伪装成 GPT Image 别名。
 */
export async function getSeedance2PromptsPage({
  cursor,
  pageSize = NOTION_PROMPTS_PAGE_SIZE,
  language = DEFAULT_LANDING_LANGUAGE,
  tag,
  query,
  id,
}: {
  cursor?: string | null;
  pageSize?: number;
  language?: LandingLanguage;
  tag?: string | null;
  query?: string | null;
  id?: string | null;
} = {}): Promise<PromptGalleryPage> {
  return getLandingPromptsPage({
    sourceSlug: 'seedance-2',
    cursor,
    pageSize,
    language,
    tag,
    query,
    id,
  });
}

/**
 * 从同步数据库读取 GPT Image 2 prompt 首屏列表。
 * 页面旧调用点仍通过这个方法拿数组；内部只取默认 10 条，
 * 是为了兼容既有 SEO 渲染代码，同时把真正分页状态交给 getGptImagePromptsPage。
 */
export async function getGptImagePrompts(): Promise<PromptGalleryItem[]> {
  const page = await getGptImagePromptsPage();
  return page.items;
}
