/**
 * handdrawn-prompt-seo-section.tsx 渲染手绘落地页底部的 guide 与 FAQ。
 * 它位于 landing-pages 的服务端内容层，被 Seedance 等手绘变体页面插入到 gallery 后方；
 * 这块正文继续承接可索引主题说明，但视觉上改成便签纸和铅笔批注，
 * 避免底部长文又退回 GPT Image 那套霓虹面板。
 */
import type { GptImagePromptsSeoGuideCopy } from '@/components/gpt-image-prompts-seo-section';

type HandDrawnPromptSeoSectionProps = {
  copy: GptImagePromptsSeoGuideCopy;
};

const wobbleMd = '26px 18px 28px 14px / 14px 30px 18px 28px';

/**
 * 输出手绘风格的正文说明与 FAQ。
 * 内容结构继续复用统一的 SEO guide copy，避免不同视觉变体各自发散出第二套内容模型；
 * 这里的职责只是在纸张语义下重新组织阅读节奏和 FAQ 卡片样式。
 */
export function HandDrawnPromptSeoSection({ copy }: HandDrawnPromptSeoSectionProps) {
  return (
    <section className="mx-auto mt-12 w-[min(94vw,1080px)] pb-12 max-[640px]:mt-10" aria-label={copy.sectionLabel}>
      <div
        className="border-[3px] border-[#2d2d2d] bg-[#fffdf9] px-6 py-6 shadow-[8px_8px_0px_0px_#2d2d2d] max-[640px]:px-4 max-[640px]:py-5"
        style={{ borderRadius: wobbleMd, transform: 'rotate(-0.7deg)' }}
      >
        <div className="grid gap-7">
          <div className="grid gap-4">
            <h2 className="m-0 text-[clamp(1.8rem,4vw,3rem)] leading-tight" style={{ fontFamily: 'var(--font-handwritten-heading)' }}>
              {copy.title}
            </h2>
            {copy.intro.map((paragraph) => (
              <p
                key={paragraph}
                className="m-0 text-[20px] leading-[1.5] text-[#2d2d2d]/82 max-[640px]:text-[18px]"
                style={{ fontFamily: 'var(--font-handwritten-body)' }}
              >
                {paragraph}
              </p>
            ))}
          </div>

          <div className="grid gap-4">
            <h3 className="m-0 text-[14px] font-bold uppercase tracking-[0.18em] text-[#2d5da1]">{copy.writingTitle}</h3>
            <ul
              className="m-0 grid gap-3 pl-5 text-[20px] leading-[1.5] text-[#2d2d2d]/82 max-[640px]:text-[18px]"
              style={{ fontFamily: 'var(--font-handwritten-body)' }}
            >
              {copy.writingPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4">
            <h3 className="m-0 text-[14px] font-bold uppercase tracking-[0.18em] text-[#ff4d4d]">{copy.faqTitle}</h3>
            <div className="grid gap-4">
              {copy.faqs.map((faq, index) => (
                <article
                  key={faq.question}
                  className="border-[3px] border-[#2d2d2d] bg-[#fff9c4] px-4 py-4 shadow-[4px_4px_0px_0px_#2d2d2d]"
                  style={{ borderRadius: wobbleMd, transform: index % 2 === 0 ? 'rotate(-0.4deg)' : 'rotate(0.5deg)' }}
                >
                  <h4 className="m-0 text-[20px] leading-[1.3]" style={{ fontFamily: 'var(--font-handwritten-heading)' }}>
                    {faq.question}
                  </h4>
                  <p
                    className="mt-2 mb-0 text-[18px] leading-[1.5] text-[#2d2d2d]/82"
                    style={{ fontFamily: 'var(--font-handwritten-body)' }}
                  >
                    {faq.answer}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
