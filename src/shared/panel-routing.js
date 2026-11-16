export function normalizePanelWindowId(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

export function shouldRouteToPanel(record, targetWindowId) {
  if (record?.visible !== true) return false;
  const target = normalizePanelWindowId(targetWindowId);
  if (target === null) return true;
  return normalizePanelWindowId(record.windowId) === target;
}

/**
 * A Workbench runs inside a Chrome tab, while a side panel is a non-tab
 * extension page. Prefer the host tab's window when one exists and otherwise
 * fall back to the window containing the side-panel page.
 */
export function resolvePanelHostBinding(hostTab, currentWindow) {
  const hostTabId = normalizePanelWindowId(hostTab?.id);
  const hostWindowId = normalizePanelWindowId(hostTab?.windowId);
  const currentWindowId = normalizePanelWindowId(currentWindow?.id);
  return {
    hostTabId,
    windowId: hostWindowId ?? currentWindowId,
  };
}

/**
 * Tracks the window containing a tab-hosted Workbench. Chrome fires onAttached
 * when a tab crosses windows and onMoved for index changes within a window.
 * Both signals are accepted for the host tab, but events for ordinary content
 * tabs are ignored so they can never redirect panel-scoped commands.
 */
export function createPanelWindowBindingController(options = {}) {
  const hostTabId = normalizePanelWindowId(options.hostTabId);
  let windowId = normalizePanelWindowId(options.windowId);
  let epoch = 0;
  const onRebind = typeof options.onRebind === 'function'
    ? options.onRebind
    : () => undefined;

  function current() {
    return { hostTabId, windowId, epoch };
  }

  function rebind(tabId, nextWindowId, source) {
    if (hostTabId === null || normalizePanelWindowId(tabId) !== hostTabId) return null;
    const normalizedWindowId = normalizePanelWindowId(nextWindowId);
    if (normalizedWindowId === null || normalizedWindowId === windowId) return null;
    const previousEpoch = epoch;
    const transition = {
      source,
      hostTabId,
      previousWindowId: windowId,
      windowId: normalizedWindowId,
      previousEpoch,
      epoch: previousEpoch + 1,
    };
    windowId = normalizedWindowId;
    epoch = transition.epoch;
    onRebind(transition);
    return transition;
  }

  return {
    current,
    isCurrent(binding) {
      return binding?.hostTabId === hostTabId &&
        binding?.windowId === windowId &&
        binding?.epoch === epoch;
    },
    confirm(binding, expectedEpoch = epoch) {
      if (expectedEpoch !== epoch) return null;
      if (normalizePanelWindowId(binding?.hostTabId) !== hostTabId) return null;
      return rebind(hostTabId, binding?.windowId, 'confirmed');
    },
    handleAttached(tabId, attachInfo = {}) {
      return rebind(tabId, attachInfo?.newWindowId, 'attached');
    },
    handleMoved(tabId, moveInfo = {}) {
      return rebind(tabId, moveInfo?.windowId, 'moved');
    },
  };
}

/**
 * Runs one state refresh against an immutable host-window binding. Each async
 * boundary checks the binding epoch before the next stage can mutate or
 * persist state. The stage implementations still receive the captured binding
 * so any Chrome query or storage mapping is scoped to that original window.
 */
export async function runPanelWindowRefreshTransaction(
  controller,
  binding,
  synchronize,
  refresh,
) {
  if (!controller.isCurrent(binding)) return false;
  if (await synchronize(binding) === false) return false;
  if (!controller.isCurrent(binding)) return false;
  if (await refresh(binding) === false) return false;
  return controller.isCurrent(binding);
}

/**
 * Re-checks a Workbench host after initialization and waits until the newest
 * rebind task is stable. Promise identity matters here: if A's reconciliation
 * is being awaited when the host moves B → C, the loop observes C's newer task
 * and confirms the host again before initialization can expose the UI.
 */
export async function confirmPanelWindowBindingAfterInitialization(
  controller,
  resolveBinding,
  currentRebindTask,
) {
  while (true) {
    const expectedBinding = controller.current();
    const confirmedBinding = await resolveBinding();
    controller.confirm(confirmedBinding, expectedBinding.epoch);
    const pendingRebind = currentRebindTask();
    await pendingRebind;
    if (pendingRebind === currentRebindTask()) return controller.current();
  }
}

const PANEL_WINDOW_SCOPED_COMMANDS = new Set([
  'tabs:list',
  'tabs:create',
  'tabs:openUnique',
]);

export function createPanelCommandMessage(type, payload = {}, windowId) {
  const normalizedWindowId = normalizePanelWindowId(windowId);
  if (
    PANEL_WINDOW_SCOPED_COMMANDS.has(type) &&
    normalizedWindowId !== null &&
    payload.windowId === undefined
  ) {
    return { type, ...payload, windowId: normalizedWindowId };
  }
  return { type, ...payload };
}
