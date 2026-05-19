/**
 * handdrawn-prompt-prefill.ts 负责把手绘双模型卡片的 prompt 组装成 task prefill 文本。
 * 它位于 landing-pages 的 CTA handoff 层，被 HandDrawnPromptCard 和对应测试复用，
 * 用来在仍旧只支持单条字符串 prefill 的 `/task` 契约下，显式标出 image/video 两个步骤，
 * 同时保持源 prompt 正文原样透传，避免 landing-pages 在真正的数据源修复前擅自改写执行输入。
 */

const PAIRED_PROMPT_EXECUTION_NOTE =
  'Run the following as two separate steps. Do not copy text from VIDEO_PROMPT into IMAGE_PROMPT.';
const PREVIOUS_IMAGE_REFERENCE_NOTE =
  'Use the image generated in the immediately previous /gpt-image-2 step as the input image.';

/**
 * 组装混合 prompt 卡片要预填进任务输入框的单条多段消息。
 * 这个文本会被 landing-pages 的 Try in Kollab CTA 直接写入 handoff 存储，再由 task 页首轮自动发送，
 * 所以这里必须同时保留真实的 `/gpt-image-2`、`/seedance-2` 命令边界，以及“两个步骤不要串味”的总说明。
 * 当前前后端还没有结构化 imagePrompt/videoPrompt 契约，因此先用显式 section header 做兼容修复，
 * 但不在这里清洗或裁剪 prompt 正文，避免来源问题被展示层静默掩盖。
 */
export function buildHandDrawnPairedPromptPrefill({
  primaryPrompt,
  secondaryPrompt,
}: {
  primaryPrompt: string;
  secondaryPrompt: string;
}): string {
  const normalizedPrimaryPrompt = primaryPrompt.trim();
  const normalizedSecondaryPrompt = secondaryPrompt.trim();
  const normalizedVideoPrompt = [
    `/seedance-2 ${PREVIOUS_IMAGE_REFERENCE_NOTE}`,
    normalizedSecondaryPrompt,
  ]
    .filter(Boolean)
    .join(' ');

  return [
    PAIRED_PROMPT_EXECUTION_NOTE,
    '',
    'IMAGE_PROMPT',
    `/gpt-image-2 ${normalizedPrimaryPrompt}`,
    '',
    'VIDEO_PROMPT',
    normalizedVideoPrompt,
  ].join('\n');
}
