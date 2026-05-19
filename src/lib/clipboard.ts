/**
 * clipboard.ts 提供 landing-pages 应用共享的剪贴板写入工具。
 * 它位于 landing-pages 工具库层，被 prompt 卡片的复制 / 分享文字链接和 icon 按钮共用；
 * 集中实现是为了让 Clipboard API + textarea fallback 这一套兜底逻辑只维护一份，
 * 避免几个调用点各自抄一遍代码 + 各自抄漏分支判断的双重风险。
 */

/**
 * 通过隐藏 textarea + execCommand 把文本复制到剪贴板。
 * 这个 fallback 只服务现代 Clipboard API 不可用或被 IAB / 老 Safari / 隐私模式拒绝的场景；
 * 离屏 textarea 必须手动 select 并清理，所以放在独立函数里集中处理 DOM 副作用。
 */
function copyViaTextareaFallback(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * 把文本写入系统剪贴板，优先走异步 Clipboard API，仅在它失败时回落到 textarea + execCommand。
 * 这个 helper 被 prompt 卡片的复制 / 分享 button 和文字链接共用；它不抛错，
 * 全部失败时静默吞掉异常（最常见原因是浏览器扩展拦截 / 内嵌浏览器权限问题，调用方无法做更多）。
 * 关键决策：双路径必须互斥——如果 Clipboard API 已经成功写入，重复调 execCommand 会再操作一次 DOM 浪费资源，
 * 因此走 await 后只在 reject / 抛错时才回落 fallback，而不是无条件双跑。
 */
export async function copyTextWithFallback(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* Clipboard API 不可用或被拒，落到 textarea fallback */
  }
  try {
    copyViaTextareaFallback(text);
  } catch {
    /* 所有路径都失败：静默吞掉，调用方有自己的 UI 反馈 */
  }
}
