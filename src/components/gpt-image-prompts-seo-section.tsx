/**
 * gpt-image-prompts-seo-section.tsx 渲染 GPT Image 2 prompt 落地页底部的 SEO 文章与 FAQ。
 * 它位于 landing-pages 的服务端内容层，被 gpt-image-prompts-page 作为 gallery 后的长文补充区插入。
 * 当前实现遵循 "Atelier Editorial" 设计：
 *   - mono eyebrow "№ Essay · GPT Image 2"
 *   - Fraunces italic H2（无 marker 下划线，用"庄重"取代"强调"）
 *   - 两列正文（CSS columns）+ 首段首字母放大（Fraunces italic drop-cap）
 *   - 3 个编号 tips：大号 Caveat 序号 + marker 下划线，Fraunces italic tip 标题，Source Serif 4 正文
 *   - 一段 Caveat pull-quote（marker 橙色）+ Source Serif 4 italic 署名
 *   - FAQ：mono "Q. 0X" + ivy 小圆点，Fraunces italic 问题，Source Serif 4 答案，hairline 分隔线
 */

/** tip SVG 序号下划线，比 hero marker 更小，适合 36px Caveat 字号。 */
const TIP_NUMBER_UNDERLINE_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox%3D'0 0 60 10' preserveAspectRatio%3D'none'%3E%3Cpath d%3D'M2 6 C15 8 24 3 35 6 C44 8 51 4 58 6' stroke%3D'%23D2502A' stroke-width%3D'2.1' stroke-linecap%3D'round' fill%3D'none'%2F%3E%3C%2Fsvg%3E\")";

type GptImagePromptsSeoFaq = {
  question: string;
  answer: string;
};

export type GptImagePromptsSeoGuideCopy = {
  sectionLabel: string;
  title: string;
  intro: string[];
  writingTitle: string;
  writingPoints: string[];
  faqTitle: string;
  faqs: GptImagePromptsSeoFaq[];
};

type GptImagePromptsSeoSectionProps = {
  copy: GptImagePromptsSeoGuideCopy;
};

/**
 * 输出 GPT Image 2 prompts 的文章正文和 FAQ。
 * 这个组件被服务端落地页调用；渲染采用全服务端静态标记，无客户端状态，
 * 是为了保证 SEO 正文在 JS 禁用或慢速网络下也能被完整索引。
 * CSS columns 两列布局只依赖 CSS，无 JS 测量，在 SSR 和浏览器端行为完全一致。
 * drop-cap 用 ::first-letter 伪元素实现，不需要额外 DOM 包裹，维护成本最低。
 */
export function GptImagePromptsSeoSection({ copy }: GptImagePromptsSeoSectionProps) {
  return (
    <section
      className="border-t border-[var(--hairline)] pt-[72px] pb-[78px]"
      aria-label={copy.sectionLabel}
    >
      <div className="mx-auto w-[min(1240px,calc(100%-112px))] max-[900px]:w-[min(1240px,calc(100%-48px))] max-[480px]:w-[min(1240px,calc(100%-32px))]">
        {/* ── mono eyebrow ── */}
        <p className="m-0 mb-[18px] text-[var(--ink-secondary)] font-[var(--font-mono)] text-[10.5px] font-medium tracking-[0.12em] leading-[1.2]">
          № Essay · GPT Image 2
        </p>

        {/* ── Fraunces italic H2，无 marker 下划线（庄重而不强调） ── */}
        <h2 className="max-w-[12ch] m-0 mb-[34px] text-[var(--ink-primary)] font-[var(--font-fraunces),Georgia,serif] text-[clamp(2rem,5vw,3.5rem)] italic font-[650] leading-[1.03] tracking-0 [font-variation-settings:'opsz'_144]">
          {copy.title}
        </h2>

        {/* ── 两列正文：CSS columns，首段 drop-cap ── */}
        <div
          className="[columns:2_320px] [column-gap:56px] max-w-[980px] max-[900px]:[columns:1]"
          /* drop-cap 通过全局 CSS ::first-letter 在 .essay-dropcap 上实现；
           * 这里用内联 style 标注，避免 Tailwind 扫不到 ::first-letter 伪类 */
        >
          {copy.intro.map((paragraph, index) => (
            <p
              key={paragraph}
              className={
                index === 0
                  ? 'm-0 mb-[18px] text-[var(--ink-primary)] text-[17px] leading-[1.8] [&::first-letter]:float-left [&::first-letter]:pr-[0.1em] [&::first-letter]:pt-[0.08em] [&::first-letter]:font-[var(--font-fraunces),Georgia,serif] [&::first-letter]:text-[4.4em] [&::first-letter]:italic [&::first-letter]:leading-[0.78] [&::first-letter]:[font-variation-settings:"opsz"_144]'
                  : 'm-0 mb-[18px] text-[var(--ink-primary)] text-[17px] leading-[1.8]'
              }
            >
              {paragraph}
            </p>
          ))}
        </div>

        {/* ── Pull-quote：Caveat marker 色 + Source Serif 4 italic 署名 ── */}
        <blockquote className="max-w-[760px] my-[44px] text-[var(--marker)] font-[var(--font-caveat),cursive] text-[clamp(1.8rem,4vw,2.4rem)] font-semibold leading-[1.08]">
          &ldquo;先写主体、再写约束。&rdquo; 这是一切高质量提示词的起点。
          <cite className="block mt-[10px] text-[var(--ink-secondary)] font-[var(--font-serif-body),Georgia,serif] text-[14px] italic leading-[1.4] not-italic">
            — 摘自 Kollab 编辑台手记
          </cite>
        </blockquote>

        {/* ── 3 个编号 tips：Caveat 序号 + marker SVG 下划线，Fraunces italic 标题 ── */}
        <div className="grid [grid-template-columns:repeat(3,1fr)] gap-[28px] mt-[44px] mb-[66px] max-[900px]:[grid-template-columns:1fr]">
          {copy.writingPoints.map((point, index) => (
            <article key={point} className="pt-[20px] border-t border-[var(--hairline)]">
              {/* Caveat 序号：marker 橙色 + marker SVG 底线 */}
              <span
                className="inline-block min-w-[36px] mb-[12px] pb-[3px] text-[var(--marker)] font-[var(--font-caveat),cursive] text-[36px] font-semibold leading-[0.95] [background-repeat:no-repeat] [background-size:100%_0.28em] [background-position:0_100%]"
                style={{ backgroundImage: TIP_NUMBER_UNDERLINE_SVG }}
                aria-hidden="true"
              >
                {index + 1}
              </span>
              {/* Fraunces italic tip 标题 */}
              <h3 className="m-0 mb-[8px] text-[var(--ink-primary)] font-[var(--font-fraunces),Georgia,serif] text-[22px] italic font-[500] leading-[1.1] [font-variation-settings:'opsz'_72]">
                {copy.writingTitle}
              </h3>
              {/* Source Serif 4 正文 */}
              <p className="m-0 text-[var(--ink-secondary)] text-[16px] leading-[1.75]">
                {point}
              </p>
            </article>
          ))}
        </div>

        {/* ── FAQ：mono Q.0X + ivy 圆点，Fraunces italic 问题，hairline 分隔线 ── */}
        <div className="border-t border-[var(--hairline)]">
          {copy.faqs.map((faq, index) => (
            <article
              key={faq.question}
              className="grid [grid-template-columns:118px_minmax(0,0.95fr)] gap-[30px] py-[34px] border-b border-[var(--hairline)] max-[900px]:[grid-template-columns:1fr] max-[900px]:gap-[12px]"
            >
              {/* mono mark "Q. 0X" + ivy 圆点前缀 */}
              <span
                className="inline-flex items-center gap-[9px] text-[var(--ink-secondary)] font-[var(--font-mono)] text-[11px] font-medium leading-[1.5] tracking-[0.12em] before:content-[''] before:w-[6px] before:h-[6px] before:rounded-full before:bg-[var(--ivy)] before:flex-none"
              >
                Q. {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                {/* Fraunces italic 问题 */}
                <h3 className="m-0 mb-[8px] text-[var(--ink-primary)] font-[var(--font-fraunces),Georgia,serif] text-[22px] italic font-[500] leading-[1.18] [font-variation-settings:'opsz'_72]">
                  {faq.question}
                </h3>
                {/* Source Serif 4 答案 */}
                <p className="m-0 max-w-[66ch] text-[var(--ink-secondary)] text-[16px] leading-[1.75]">
                  {faq.answer}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
