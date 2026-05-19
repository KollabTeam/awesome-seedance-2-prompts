/**
 * prompt-tags.ts 定义 landing prompt gallery 的 tag 排序和展示映射规则。
 * 它位于 landing-pages 的共享领域层，被服务端 Notion 数据读取和客户端 toolbar 渲染共同使用；
 * 固定优先级覆盖 GPT Image 2 与 Seedance 2 目前的 Notion 枚举，后续新增 tag 会保留数据库选项顺序追加在后面。
 * `lasted` 是页面专用的特殊筛选项，不属于真实 Notion tag；它只用来触发“按最新创建时间排序”的读路径。
 */

export const PROMPT_GALLERY_LATEST_TAG = 'lasted';

export const PROMPT_GALLERY_TAG_PRIORITY = [
  'photography_cinematic',
  'portrait_person',
  'fashion_beauty',
  'product_brand_ad',
  'architecture_city',
  'anime_character',
  'typography_text',
  'social_ui_screenshot',
  'storyboard_sequence',
  'infographic_education',
  'fantasy_sci_fi',
  'object_design',
  'reference_edit',
  'food_drink',
  'vehicle_transport',
  'anime-illustration',
  'architecture-city',
  'cinematic-scene',
  'fantasy-sci-fi',
  'food-drink',
  'historical-retro',
  'infographic-knowledge',
  'nature-animal',
  'portrait-fashion',
  'product-brand',
  'reference-edit',
  'single-scene',
  'storyboard-sequence',
  'text-poster',
  'ui-social-layout',
  'vehicle-transport',
] as const;

export const PROMPT_GALLERY_TAG_LABEL_KEYS = {
  photography_cinematic: 'photographyCinematic',
  portrait_person: 'portraitPerson',
  fashion_beauty: 'fashionBeauty',
  product_brand_ad: 'productBrandAd',
  architecture_city: 'architectureCity',
  anime_character: 'animeCharacter',
  typography_text: 'typographyText',
  social_ui_screenshot: 'socialUiScreenshot',
  storyboard_sequence: 'storyboardSequence',
  infographic_education: 'infographicEducation',
  fantasy_sci_fi: 'fantasySciFi',
  object_design: 'objectDesign',
  reference_edit: 'referenceEdit',
  food_drink: 'foodDrink',
  vehicle_transport: 'vehicleTransport',
  'anime-illustration': 'animeIllustration',
  'architecture-city': 'architectureCity',
  'cinematic-scene': 'cinematicScene',
  'fantasy-sci-fi': 'fantasySciFi',
  'food-drink': 'foodDrink',
  'historical-retro': 'historicalRetro',
  'infographic-knowledge': 'infographicKnowledge',
  'nature-animal': 'natureAnimal',
  'portrait-fashion': 'portraitFashion',
  'product-brand': 'productBrand',
  'reference-edit': 'referenceEdit',
  'single-scene': 'singleScene',
  'storyboard-sequence': 'storyboardSequence',
  'text-poster': 'textPoster',
  'ui-social-layout': 'uiSocialLayout',
  'vehicle-transport': 'vehicleTransport',
} as const satisfies Record<(typeof PROMPT_GALLERY_TAG_PRIORITY)[number], string>;

export type PromptGalleryTagLabelKey = (typeof PROMPT_GALLERY_TAG_LABEL_KEYS)[keyof typeof PROMPT_GALLERY_TAG_LABEL_KEYS];
export type PromptGalleryTagLabels = Partial<Record<PromptGalleryTagLabelKey, string>>;

/**
 * 判断当前筛选值是否是“最新”特殊项。
 * 这个 helper 被客户端即时预览和服务端 SQL 读取共用；把特殊值集中在这里，
 * 是为了避免 toolbar、filter helper 和 DB query 各自硬编码一份 `lasted` 字面量后再次漂移。
 */
export function isPromptGalleryLatestTag(tag: string | null | undefined): boolean {
  return tag?.trim() === PROMPT_GALLERY_LATEST_TAG;
}

/**
 * 按已知概率优先级排序 tag，并把未知 tag 追加在后面。
 * 这个 helper 被 Notion schema options 和 fallback tags 共用；未知 tag 不丢弃，
 * 是为了数据库新增分类后页面无需发版就能出现新 chip，同时已知 chip 不会因筛选结果改变而跳动。
 */
export function sortPromptTagsByPriority(tags: string[]): string[] {
  const normalizedTags = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
  const knownTags = PROMPT_GALLERY_TAG_PRIORITY.filter((tag) => normalizedTags.includes(tag));
  const unknownTags = normalizedTags.filter((tag) => !PROMPT_GALLERY_TAG_PRIORITY.includes(tag as (typeof PROMPT_GALLERY_TAG_PRIORITY)[number]));

  return [...knownTags, ...unknownTags];
}

/**
 * 把未知 Notion tag 转成人类可读的 fallback 文案。
 * 这个方法只在 i18n 资源里没有对应 tag label 时使用；保留原始单词顺序但去掉下划线，
 * 是为了新 tag 上线后前端不会直接露出数据库枚举值，同时不阻塞内容发布流程。
 */
function humanizePromptTag(tag: string): string {
  return tag
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * 读取 tag 在当前 UI 语言下的展示文案。
 * 这个 helper 被 PromptGalleryToolbar 和 PromptCard 调用；返回值只用于展示和 aria 文案，
 * 筛选请求仍然传 Notion 原始 tag value，避免翻译文案反向污染 API 查询条件。
 */
export function getPromptTagLabel(tag: string, labels: PromptGalleryTagLabels | undefined): string {
  const labelKey = PROMPT_GALLERY_TAG_LABEL_KEYS[tag as (typeof PROMPT_GALLERY_TAG_PRIORITY)[number]];
  const localizedLabel = labelKey ? labels?.[labelKey]?.trim() : '';

  return localizedLabel || humanizePromptTag(tag);
}
