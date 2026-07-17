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

export function selectEligibleTabSource(tabList = [], rememberedTab = null, isEligible = Boolean) {
  const tabs = Array.isArray(tabList) ? tabList : [];
  const eligibleTabs = tabs.filter((tab) => isEligible(tab));
  const activeTab = eligibleTabs.find((tab) => tab.active);
  if (activeTab) return activeTab;

  if (rememberedTab) {
    const refreshed = tabs.find((tab) => Number(tab?.id) === Number(rememberedTab.id));
    const candidate = refreshed
      ? { ...rememberedTab, ...refreshed, active: false }
      : rememberedTab;
    if (isEligible(candidate)) return candidate;
  }

  return [...eligibleTabs]
    .filter((tab) => Number.isFinite(Number(tab.lastAccessed)) && Number(tab.lastAccessed) > 0)
    .sort((left, right) => Number(right.lastAccessed) - Number(left.lastAccessed))[0] || null;
}

/**
 * Merges a page observed while resolving an activation event into the panel's
 * tab cache. A merely observed page is deliberately inactive and must not
 * clear the current active page. Only the activation that wins the controller
 * race is authoritative enough to replace the cache's active page.
 */
export function mergeTabActivationCache(tabList = [], observedTab = {}, options = {}) {
  const source = Array.isArray(tabList) ? tabList : [];
  const authoritative = options.authoritative === true;
  const observedActive = authoritative ? Boolean(observedTab?.active) : false;
  const observedId = Number(observedTab?.id);
  let cachedTab = null;
  let found = false;
  const tabs = source.map((candidate) => {
    if (Number.isFinite(observedId) && Number(candidate?.id) === observedId) {
      found = true;
      cachedTab = { ...candidate, ...observedTab, active: observedActive };
      return cachedTab;
    }
    if (authoritative && candidate?.active) return { ...candidate, active: false };
    return candidate;
  });
  if (!found) {
    cachedTab = { ...observedTab, active: observedActive };
    tabs.push(cachedTab);
  }
  return { tabs, tab: cachedTab };
}

/**
 * Resolves Chrome activation events without allowing an older async tabs.get
 * response to replace a newer eligible page. Ineligible activations (such as
 * the Workbench extension tab itself) deliberately do not supersede the last
 * real page, because users must focus the Workbench to ask about that page.
 */
export function createEligibleTabActivationController(options = {}) {
  const getTab = options.getTab || (async () => null);
  const isEligible = options.isEligible || Boolean;
  const now = options.now || Date.now;
  const onObserve = options.onObserve || (() => undefined);
  const onActivate = options.onActivate || (() => undefined);
  const onError = options.onError || (() => undefined);
  let nextSequence = 0;
  let latestCommittedSequence = 0;
  let latestActivatedAt = 0;
  const tabGenerations = new Map();
  const pendingCounts = new Map();

  function tabKey(value) {
    const tabId = Number(value);
    return Number.isFinite(tabId) ? String(tabId) : '';
  }

  function generationFor(key) {
    return key ? tabGenerations.get(key) || 0 : 0;
  }

  function commit(tab, sequence, activeInfo, activation) {
    if (!isEligible(tab, activeInfo)) return false;
    onObserve(tab, activeInfo, activation);
    if (sequence < latestCommittedSequence) return false;
    latestCommittedSequence = sequence;
    onActivate(tab, activeInfo, activation);
    return true;
  }

  function nextActivation() {
    const sequence = ++nextSequence;
    latestActivatedAt = Math.max(now(), latestActivatedAt + 1);
    return { sequence, activatedAt: latestActivatedAt };
  }

  async function handle(activeInfo = {}) {
    const activation = nextActivation();
    const { sequence } = activation;
    const key = tabKey(activeInfo.tabId);
    const generation = generationFor(key);
    if (key) pendingCounts.set(key, (pendingCounts.get(key) || 0) + 1);
    let result = false;
    try {
      const tab = await getTab(activeInfo);
      if (generation === generationFor(key)) {
        result = commit(tab, sequence, activeInfo, activation);
      }
    } catch (error) {
      onError(error, activeInfo);
    } finally {
      if (key) {
        const remaining = pendingCounts.get(key) - 1;
        if (remaining > 0) pendingCounts.set(key, remaining);
        else {
          pendingCounts.delete(key);
          tabGenerations.delete(key);
        }
      }
    }
    return result;
  }

  function commitFresh(tab, activeInfo = {}) {
    const activation = nextActivation();
    return commit(tab, activation.sequence, activeInfo, activation);
  }

  function invalidate(tabId) {
    const key = tabKey(tabId);
    if (!key) return false;
    if (pendingCounts.has(key)) tabGenerations.set(key, generationFor(key) + 1);
    return true;
  }

  return { handle, commitFresh, invalidate };
}
