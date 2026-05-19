/**
 * page-shell-classes.ts 保存 GPT Image 2 landing page 壳层样式 token。
 * 它位于 landing-pages 的展示层，被 LandingPageShell 独占使用。
 * 当前承载 "Atelier Editorial" 视觉系统：
 *   - header：1px hairline 下边框，Fraunces italic 品牌文字，JetBrains Mono 语言选择器
 *   - hero：非对称两列网格（1.18fr / 0.82fr），外边距 56px 0 64px（桌面），无 min-height 约束
 *   - 标记笔下划线通过 SVG data URL 实现，让长标题换行时下划线跟随单词而不是整行
 * 把 header/hero 样式集中在这里而不是分散到组件内联，是为了让视觉微调只触发这一个文件的 HMR，
 * 不再把页面壳层和数据逻辑耦合在同一个热更新边界里。
 */

/** SVG marker 下划线数据 URL，与 mockup 中 .marker 的笔触完全一致。 */
export const MARKER_UNDERLINE_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox%3D'0 0 240 24' preserveAspectRatio%3D'none'%3E%3Cpath d%3D'M3 15 C36 19 68 10 103 15 C139 20 166 11 201 15 C218 17 231 13 237 15' stroke%3D'%23D2502A' stroke-width%3D'3.5' stroke-linecap%3D'round' fill%3D'none'%2F%3E%3C%2Fsvg%3E\")";

export const pageShellClasses = {
  /* ── 页头：sticky 悬浮在 viewport 顶部，hairline 下边框 + paper 半透明背景 + backdrop blur。
   * 滚动时 header 跟随视口保持可见，让 Kollab 品牌入口和语言切换始终可达；
   * 半透明纸色 + blur 让头部既不抢内容焦点又能与滚动到下方的卡片视觉清晰分层。
   * z-30 高于 lightbox backdrop 的内容层但低于 PhotoSlider portal（z 50+），
   * 避免遮挡全屏图片预览同时压住普通滚动内容。 */
  header:
    'sticky top-0 z-30 w-full border-b border-[var(--hairline)] bg-[rgba(244,238,223,0.85)] backdrop-blur-md backdrop-saturate-150',
  /* 桌面 56px / 移动 50px：sticky 状态下保持紧凑，让 hero / 卡片区获得更多视口空间。
   * 之前 78px / 68px 是非 sticky 设计的留白，悬浮后过厚会压缩主内容。 */
  headerInner:
    'mx-auto flex min-h-[56px] w-[min(1240px,calc(100%-112px))] items-center justify-between max-[900px]:w-[min(1240px,calc(100%-48px))] max-[480px]:w-[min(1240px,calc(100%-32px))] max-[480px]:min-h-[50px]',

  /* brand 渲染 Kollab wordmark SVG，hover 时整块淡化；
   * 链接指向官网产品页 /product，让访客从落地页可以无障碍回流到主站。 */
  brandLink:
    'inline-flex items-center text-[var(--ink-primary)] hover:opacity-75 transition-opacity duration-200',
  brandLogo: 'block h-[22px] w-auto max-[480px]:h-[20px]',

  /* 右侧动作组：搜索框 + 语言切换。flex 排成一行，gap 16px 让它们之间留呼吸空间但不脱节。 */
  headerActions: 'flex items-center gap-[16px] max-[480px]:gap-[10px]',

  /* header 搜索区：desktop ~220px、tablet(480–900px) ~180px、mobile(<480px) 隐藏。
   * 移动端隐藏是因为工具栏搜索框（toolbar）已覆盖手机端的搜索入口；
   * 两者绑定同一 URL ?q= 真相，移动端用户仍可在工具栏搜索，刷新后两侧同步恢复。
   * 这里用 max-[480px]:hidden 与 header min-h 断点对齐，保证 50px 紧凑头部在手机上不被搜索框撑宽。 */
  headerSearchWrap:
    'relative hidden min-[480px]:flex items-center',
  /** 放大镜图标：绝对定位在搜索框左侧，ink-secondary，与 toolbar 搜索图标对称 */
  headerSearchIcon:
    'pointer-events-none absolute left-[10px] top-1/2 w-[14px] h-[14px] -translate-y-1/2 text-[var(--ink-secondary)]',
  /** header 搜索输入框：比 toolbar 版本更紧凑（高度约 32px），paper-soft 底边框样式一致；
   * desktop 220px / tablet 180px；Source Serif 4 正文，Fraunces italic placeholder。
   * 使用底边框而非全框，与 header 其他控件（语言选择器）保持 hairline 风格统一。 */
  headerSearchInput:
    'w-[220px] max-[900px]:w-[180px] border-0 border-b border-[var(--hairline)] rounded-none py-[6px] pl-[32px] pr-[8px] bg-[rgba(244,238,223,0)] text-[var(--ink-primary)] text-[13.5px] outline-none focus:border-b-[var(--ink-primary)] transition-colors duration-200 [font-family:var(--font-serif-body),Georgia,serif] placeholder:[font-family:var(--font-fraunces),Georgia,serif] placeholder:italic placeholder:text-[rgba(92,84,74,0.72)] placeholder:[font-variation-settings:"opsz"_72]',

  /* 语言切换：JetBrains Mono 小号元数据 + chevron ── */
  languageSelectWrap: 'relative inline-flex items-center gap-2',
  languageSelect:
    'appearance-none border-0 border-b border-[var(--hairline)] rounded-none py-[7px] pl-0 pr-[22px] bg-transparent text-[var(--ink-primary)] cursor-pointer font-[var(--font-mono)] text-[10.5px] font-medium tracking-[0.12em] outline-none focus:border-b-[var(--ink-primary)] hover:border-b-[var(--ink-primary)] transition-colors duration-200 max-[480px]:max-w-[112px]',
  languageSelectChevron:
    'pointer-events-none absolute right-0 top-1/2 -translate-y-[54%] text-[var(--ink-secondary)] text-[11px]',

  /* ── Hero：56px/64px 外边距，非对称两列，无 min-height 约束 ── */
  hero: 'mx-auto w-[min(1240px,calc(100%-112px))] pt-[56px] pb-[64px] max-[900px]:w-[min(1240px,calc(100%-48px))] max-[900px]:pt-[40px] max-[900px]:pb-[32px] max-[480px]:w-[min(1240px,calc(100%-32px))] max-[480px]:pt-[48px]',
  /* 非对称网格：左列（H1 + eyebrow）更宽，右列（lede + note）固定最小宽度。
   * 在 900px 以下折叠为单列，间距收窄为 26px。 */
  heroGrid:
    'grid [grid-template-columns:minmax(0,1.18fr)_minmax(320px,0.82fr)] [gap:clamp(32px,5vw,76px)] items-end max-[900px]:[grid-template-columns:1fr] max-[900px]:gap-[26px] max-[900px]:items-start',
  heroCopy: 'max-w-[44ch] pb-[2px]',
  heroRule: 'mt-[42px] border-0 border-t border-[var(--hairline)] max-[900px]:mt-[34px]',

  /* eyebrow：JetBrains Mono，ink-secondary，带星形 doodle ── */
  eyebrow:
    'inline-flex items-center gap-[9px] mb-[12px] text-[var(--ink-secondary)] font-[var(--font-mono)] text-[11.5px] font-medium tracking-[0.12em] leading-[1.3] max-[480px]:text-[10.5px] max-[480px]:tracking-[0.1em]',

  /* H1：Fraunces italic 展示字号，clamp 控制流式字号。
   * leading-[1.18] 让两行 H1 之间留出明显的垂直呼吸，配合 titleLineOffset 的横向错位形成编辑体节奏。
   * max-w-[16ch] 兜底避免在 5xl 屏上 H1 横向沿宽，但不再窄到挤断单行（例如 "Prompts Gallery"）。 */
  title:
    'm-0 max-w-[16ch] font-[var(--font-fraunces)] italic text-[clamp(2.2rem,5.6vw,4.2rem)] font-[650] leading-[1.18] tracking-0 [font-variation-settings:"opsz"_144] text-[var(--ink-primary)] max-[900px]:max-w-[14ch] max-[480px]:text-[clamp(2.15rem,14vw,3.25rem)]',
  /* .line span 是按 ` / ` 分隔符显式切出的独立行；用 whitespace-nowrap 强制单行，
   * 避免列宽收紧时再把 "Prompts Gallery" 这类已经合理短的行二次断到三行。
   * 之前移除 nowrap 是为整段标题（无 `/` 分隔）不溢出列宽，现在 9 个 locale 都已经显式带 ` / `，
   * 每行各自就是合理短的 phrase，加 nowrap 安全。 */
  titleLine: 'block whitespace-nowrap',
  /* 第二行（带 marker 下划线那行）向右明显缩进，形成编辑体左右错落感。
   * clamp 让小屏缩进收窄不撑出列宽；桌面端用 ~2.6em 才能在大字号下肉眼可见错位。 */
  titleLineOffset: 'pl-[clamp(1.2em,3vw,2.6em)]',
  /* marker span：SVG 笔触下划线跟随文字宽度，用 background-image 而非 text-decoration
   * 是为了让多行 H1 每行下划线单独跟随，不是横跨整个容器宽度。
   * 不加 white-space:nowrap，让标题在窄列时能自然换行，背景图按行自适应。 */
  titleMarker: 'inline pb-[0.18em] [background-repeat:no-repeat] [background-size:100%_0.32em] [background-position:0_100%]',

  /* marginNote + curved-arrow doodle ── */
  noteRow: 'inline-flex items-end gap-[10px] mb-[16px] text-[var(--marker)]',
  heroNote: 'font-[var(--font-caveat)] text-[20px] font-semibold leading-[1]',

  /* lede：Source Serif 4 正文字号，ink-primary ── */
  lede: 'm-0 text-[var(--ink-primary)] text-[17px] leading-[1.75]',
} as const;
