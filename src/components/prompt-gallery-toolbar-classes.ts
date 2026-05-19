/**
 * prompt-gallery-toolbar-classes.ts 保存 GPT Image 2 gallery 搜索与筛选栏样式。
 * 它位于 landing-pages 的展示层，被 PromptGalleryToolbar 独占使用。
 * 当前承载 "Atelier Editorial" 工具栏风格：
 *   - 搜索框：paper-soft 填充，单条 hairline 底边框，Source Serif 4 italic placeholder，mono 放大镜图标
 *   - tag 筛选：文字标签用中点（·）分隔，激活态用 marker SVG 下划线，悬停态用 hairline 底边线渐进展开
 *   - 移动端：折叠为 hairline 边框 select，JetBrains Mono 小号元数据
 * 把样式集中在这里而不是组件内联，是为了让工具栏视觉微调不触发 PromptGalleryToolbar 组件模块的重新加载。
 */

/** 激活态 tag SVG 下划线数据 URL，笔触比 hero marker 细，适合 14px 标签字号。 */
export const TAG_ACTIVE_UNDERLINE_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox%3D'0 0 120 10' preserveAspectRatio%3D'none'%3E%3Cpath d%3D'M2 6 C18 9 35 3 52 6 C70 9 86 4 118 6' stroke%3D'%23D2502A' stroke-width%3D'2.2' stroke-linecap%3D'round' fill%3D'none'%2F%3E%3C%2Fsvg%3E\")";

export const promptGalleryToolbarClasses = {
  /** 工具栏外层：1px hairline 底边框，下方与 gallery 区域通过 border-top 衔接 */
  toolbar: 'border-b border-[var(--hairline)]',
  galleryToolbar: 'mx-auto mb-0 w-[min(1240px,calc(100%-112px))] max-[900px]:w-[min(1240px,calc(100%-48px))] max-[480px]:w-[min(1240px,calc(100%-32px))]',

  /** 工具栏内布局：搜索框上、tag 列表下纵向堆叠。
   * 旧的左右两列 + items-center 在 tag 换行 wrap 时会把首行垂直居中对齐搜索框中线，
   * 视觉上像 tag 被吊起来一半且排版漂浮；改纵向堆叠后 tag 占满全宽，wrap 自然，整体更平衡。 */
  toolbarInner: 'flex flex-col gap-[16px] py-[22px] max-[900px]:gap-[14px]',

  /** toolbarLabel 只在移动端 select 上方显示；桌面端 eyebrow 已在 hero 区承担了这个角色 */
  toolbarLabel: 'text-[11px] font-medium tracking-[0.12em] text-[var(--ink-secondary)] font-[var(--font-mono)]',

  /** 搜索框容器：相对定位，用于 mono 放大镜图标的绝对定位 */
  searchBox: 'relative',

  /** 放大镜图标：mono ink-secondary，绝对定位在输入框左侧 */
  searchIcon:
    'pointer-events-none absolute left-[15px] top-1/2 w-[17px] h-[17px] -translate-y-1/2 text-[var(--ink-secondary)]',

  /** 搜索输入：paper-soft 填充，单条 hairline 底边框，Source Serif 4 正文；
   * placeholder 用 Fraunces italic 与正文形成对比，增强 editorial 质感；
   * focus 时底边线加深为 ink-primary，给出清晰的焦点反馈而不依赖 outline。 */
  searchInput:
    'w-full border-0 border-b border-[var(--hairline)] rounded-none py-[13px] pl-[43px] pr-[12px] bg-[var(--paper-soft)] text-[var(--ink-primary)] text-[15.5px] outline-none focus:border-b-[var(--ink-primary)] transition-colors duration-200 [font-family:var(--font-serif-body),Georgia,serif] placeholder:[font-family:var(--font-fraunces),Georgia,serif] placeholder:italic placeholder:text-[rgba(92,84,74,0.86)] placeholder:[font-variation-settings:"opsz"_72]',

  /** tag 列表：flex-wrap 自然换行，多行间距 8px，隐藏 scrollbar 和 overflow 相关类已全部移除。
   * wrap 而非横向滚动，是为了让所有 tag 在同一视觉面板里可见，方便用户扫描，
   * 不依赖用户主动滑动才能看到更多筛选项。 */
  filters:
    'flex items-center flex-wrap gap-[9px] gap-y-[8px] py-[6px] max-[900px]:hidden',

  /** 中点分隔符：ink-secondary 低透明度 */
  filterDot: 'text-[rgba(92,84,74,0.55)] text-[12px] flex-none',

  /** tag 按钮基础态：文字链接无边框，ink-secondary，Source Serif 4，悬停时 hairline 底边线渐进展开 */
  filterTag:
    'relative border-0 p-0 pb-[4px] bg-[linear-gradient(var(--hairline),var(--hairline))_left_calc(100%-1px)_/_0_1px_no-repeat] text-[var(--ink-secondary)] cursor-pointer font-[var(--font-serif-body),Georgia,serif] text-[14px] leading-[1.3] transition-[background-size,color] duration-[240ms] ease-[ease] hover:[background-size:100%_1px] hover:text-[var(--ink-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--marker)]',

  /** tag 激活态：marker SVG 下划线替代 hairline，颜色切换到 ink-primary */
  filterTagActive:
    'text-[var(--ink-primary)] [background-image:var(--tag-active-underline)] [background-repeat:no-repeat] [background-size:100%_0.38em] [background-position:left_100%] hover:[background-size:100%_0.38em]',

  /** 移动端 select 包裹层：在 900px 以下显示，桌面端隐藏 */
  mobileFilterSelectWrap: 'hidden max-[900px]:block max-[900px]:relative',

  /** 移动端 select：hairline 边框，JetBrains Mono，外观重置 */
  mobileFilterSelect:
    'hidden max-[900px]:block max-[900px]:w-full max-[900px]:appearance-none max-[900px]:border max-[900px]:border-[var(--hairline)] max-[900px]:rounded-none max-[900px]:bg-[var(--paper-soft)] max-[900px]:px-[12px] max-[900px]:pr-[36px] max-[900px]:py-[10px] max-[900px]:text-[var(--ink-primary)] max-[900px]:font-[var(--font-mono)] max-[900px]:text-[11px] max-[900px]:font-medium max-[900px]:tracking-[0.1em] max-[900px]:outline-none max-[900px]:focus:border-[var(--ink-primary)] max-[900px]:transition-colors max-[900px]:duration-200',

  /** 移动端 select chevron 图标 */
  mobileFilterSelectIcon:
    'hidden max-[900px]:pointer-events-none max-[900px]:absolute max-[900px]:right-[10px] max-[900px]:top-1/2 max-[900px]:block max-[900px]:h-4 max-[900px]:w-4 max-[900px]:-translate-y-1/2 max-[900px]:text-[var(--ink-secondary)]',
};
