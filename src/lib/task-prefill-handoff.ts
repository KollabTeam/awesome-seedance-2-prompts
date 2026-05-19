/**
 * task-prefill-handoff 负责把 landing-pages 的长 prompt 暂存在浏览器侧。
 * 它位于 landing-pages 的 CTA 跳转层，被 prompt-gallery-card 复用，用来把真正的正文留在
 * session/localStorage，只让新开 task 的 URL 携带短 handoff id，避免 Try in Kollab
 * 再次生成超长 `/task?prefill=...` 链接。
 */

const TASK_PREFILL_HANDOFF_STORAGE_PREFIX = 'taskPrefillHandoff';
const TASK_PREFILL_HANDOFF_QUERY_PARAM = 'prefillHandoff';

interface TaskPrefillHandoffPayload {
  prefill: string;
  autoSubmit: boolean;
  createdAt: number;
}

/**
 * 计算 handoff payload 在浏览器存储中的键名。
 * landing-pages 与 fe-app 需要共享同一前缀，才能让独立 app 打开的 `/task`
 * 读取到这里预先写入的 prompt，因此键名规则必须保持稳定。
 */
function getTaskPrefillHandoffStorageKey(handoffId: string): string {
  return `${TASK_PREFILL_HANDOFF_STORAGE_PREFIX}:${handoffId.trim()}`;
}

/**
 * 构造一次性 prompt payload。
 * 这里只缓存 trim 后的正文和 autoSubmit 标记，不缓存完整 task URL，
 * 是为了让登录恢复路径保持短小，同时保留产品侧真正需要的首轮输入。
 */
function buildTaskPrefillHandoffPayload({
  prefill,
  autoSubmit = false,
}: {
  prefill: string;
  autoSubmit?: boolean;
}): TaskPrefillHandoffPayload {
  const normalizedPrefill = prefill.trim();
  if (!normalizedPrefill) {
    throw new Error('Task prefill handoff requires a non-empty prompt');
  }

  return {
    prefill: normalizedPrefill,
    autoSubmit,
    createdAt: Date.now(),
  };
}

/**
 * 安全写入浏览器存储通道。
 * 某些浏览器环境可能禁用 sessionStorage 或 localStorage；这里返回布尔值，
 * 让上层以“任意一个通道写入成功即可继续”的策略兼容同标签和跨标签恢复。
 */
function tryWriteTaskPrefillHandoff(
  storage: Pick<Storage, 'setItem'>,
  storageKey: string,
  serializedPayload: string,
): boolean {
  try {
    storage.setItem(storageKey, serializedPayload);
    return true;
  } catch {
    return false;
  }
}

/**
 * 将 prompt 写进浏览器存储，并返回对应的短 task 路径。
 * 登录恢复优先读 sessionStorage，再回退 localStorage，因此这里同时写两份副本；
 * 只要至少一个通道成功，就返回 `/task?prefillHandoff=<id>` 供 CTA 打开。
 */
export function buildTaskPathFromPrefillHandoff({
  prefill,
  autoSubmit = false,
}: {
  prefill: string;
  autoSubmit?: boolean;
}): string {
  const handoffId = globalThis.crypto.randomUUID();
  const storageKey = getTaskPrefillHandoffStorageKey(handoffId);
  const serializedPayload = JSON.stringify(
    buildTaskPrefillHandoffPayload({
      prefill,
      autoSubmit,
    }),
  );
  const wroteSession = tryWriteTaskPrefillHandoff(
    window.sessionStorage,
    storageKey,
    serializedPayload,
  );
  const wroteLocal = tryWriteTaskPrefillHandoff(
    window.localStorage,
    storageKey,
    serializedPayload,
  );

  if (!wroteSession && !wroteLocal) {
    throw new Error('Unable to persist task prefill handoff');
  }

  return `/task?${TASK_PREFILL_HANDOFF_QUERY_PARAM}=${encodeURIComponent(handoffId)}`;
}
