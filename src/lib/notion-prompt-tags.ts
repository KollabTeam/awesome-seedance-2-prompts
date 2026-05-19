/**
 * notion-prompt-tags.ts owns Notion tag property parsing for prompt landing pages.
 * It is used by notion-prompts.ts for both per-page tag values and database-level option lists, keeping tag schema
 * compatibility separate from prompt text/media parsing.
 */
import { sortPromptTagsByPriority } from '@/lib/prompt-tags';

type MultiSelectOptionLike = {
  name?: string;
};

type NotionPromptTagPropertyLike = {
  type?: string;
  multi_select?: MultiSelectOptionLike[];
};

type NotionDatabasePropertyLike = {
  type?: string;
  multi_select?: {
    options?: MultiSelectOptionLike[];
  };
};

type NotionDatabaseResponse = {
  properties?: Record<string, NotionDatabasePropertyLike>;
};

const NOTION_TAG_PROPERTY_CANDIDATES = ['tags', 'Tags'];

/**
 * 返回 Notion query 使用的 tags 属性名。
 * 这个 helper 被服务端过滤条件调用；默认使用用户新增的 `tags` 字段，
 * 同时允许运行时通过环境变量改名，避免将来数据库字段重命名时必须重新发布代码。
 */
export function getNotionTagPropertyName(): string {
  return process.env.NOTION_GPT_IMAGE_PROMPTS_TAGS_PROPERTY || 'Tags';
}

/**
 * 从 Notion multi_select property 里读取 prompt 标签。
 * 这个 helper 被 parseNotionPromptPage 调用；同时兼容 `tags` 和 `Tags`，
 * 是为了让数据库字段大小写调整时页面不会重新退回旧的关键词推导标签。
 */
export function readTagProperty(properties: Record<string, NotionPromptTagPropertyLike>): string[] {
  for (const propertyName of NOTION_TAG_PROPERTY_CANDIDATES) {
    const property = properties[propertyName];
    const tags = property?.type === 'multi_select' && Array.isArray(property.multi_select) ? property.multi_select : [];
    const normalizedTags = tags.map((tag) => tag.name?.trim() || '').filter(Boolean);

    if (normalizedTags.length > 0) {
      return Array.from(new Set(normalizedTags));
    }
  }

  return [];
}

/**
 * 从 Notion database schema 里读取 Tags multi_select 的完整选项。
 * 这个 helper 被 getNotionPromptTagOptions 调用；比从当前分页 items 反推更完整，
 * 因为用户筛选后当前页可能只剩一个 tag，但 toolbar 仍需要展示数据库里的其它可选 tag。
 */
function readTagOptionsFromDatabase(payload: unknown): string[] {
  const database = payload as NotionDatabaseResponse;
  const tagPropertyCandidates = Array.from(new Set([getNotionTagPropertyName(), ...NOTION_TAG_PROPERTY_CANDIDATES]));

  for (const propertyName of tagPropertyCandidates) {
    const property = database.properties?.[propertyName];
    const options = property?.type === 'multi_select' && Array.isArray(property.multi_select?.options) ? property.multi_select.options : [];
    const tags = options.map((option) => option.name?.trim() || '').filter(Boolean);

    if (tags.length > 0) {
      return sortPromptTagsByPriority(tags);
    }
  }

  return [];
}

/**
 * 从 Notion database schema 读取完整 tag options。
 * 这个方法只在首屏请求调用；它复用页面数据的缓存策略，
 * 是为了通过现有 prompt page payload 下发完整 tag 列表，而不是新增一个前端专用接口。
 */
export async function getNotionPromptTagOptions({
  token,
  databaseId,
  notionVersion,
  requestInit,
}: {
  token: string;
  databaseId: string;
  notionVersion: string;
  requestInit: RequestInit & { next?: { revalidate: number } };
}): Promise<string[]> {
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': notionVersion,
      },
      cache: requestInit.cache,
      ...(requestInit.next ? { next: requestInit.next } : {}),
    } satisfies RequestInit & { next?: { revalidate: number } });

    if (!response.ok) {
      return [];
    }

    return readTagOptionsFromDatabase(await response.json());
  } catch {
    return [];
  }
}
