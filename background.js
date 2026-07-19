import {
  buildChatCompletionRequest,
  extractAssistantText,
  extractFinishReason,
  outputTokenBudgetForPurpose,
  parseChatStreamEvent,
} from './src/shared/ai.js';
import { providerRequiresApiKey } from './src/shared/ai-providers.js';
import {
  appendAskSessionMessage,
  materializeAskSessionForTurn,
  pruneAskSessions,
} from './src/shared/ask-session.js';
import {
  askSessionRevision,
  checkpointAskStream,
  claimAskStream,
  finalizeAskStream,
  interruptOrphanedAskStreams,
  markAskStreamPending,
  normalizeAskStreamBinding,
} from './src/shared/ask-stream.js';
import { extractCurrentPage } from './src/shared/page-extraction.js';
import { chromeGroupTitle } from './src/shared/group-title.js';
import { normalizePanelWindowId, shouldRouteToPanel } from './src/shared/panel-routing.js';
import {
  BROWSER_SESSION_STORAGE_KEY,
  createDefaultState,
  forgetActiveSpaceForWindow,
  mergeStoredState,
  resetChromeSessionBindings,
  serializeGroup,
  serializeTab,
  SHARED_STATE_LOCK_NAME,
  STORAGE_KEY,
  WINDOW_STATE_KEY,
} from './src/shared/state.js';
import { reduceTabLifecycleEvent } from './src/shared/tab-lifecycle.js';
import { moveIndexAfterTabs, moveIndexBeforeTab } from './src/shared/tab-move.js';
import { tabCloseGuardMismatch } from './src/shared/tab-close-transaction.js';

const activeAIRequests = new Map();
const ASK_STREAM_CHECKPOINT_INTERVAL_MS = 750;
const ASK_STREAM_RECOVERY_ALARM_PREFIX = 'spaceTabsAskStreamRecovery:';
const ASK_STREAM_RECOVERY_DELAY_MINUTES = 1;
const ASK_STREAM_PENDING_RECOVERY_GRACE_MS = 60 * 1000;
const ASK_STREAM_WORKER_ID = crypto.randomUUID();
const sidePanelPorts = new Map();
const LIFECYCLE_EVENT_PREFIX = 'spaceTabsLifecycleEvent:';
const LIFECYCLE_SUPPRESSION_PREFIX = 'spaceTabsLifecycleSuppression:';
const LIFECYCLE_SUPPRESSION_VALID_MS = 5 * 60 * 1000;
const WINDOW_CLOSE_UNGROUP_SETTLE_MS = 250;
const WINDOW_CLOSE_EXTENSION_ONLY_RECHECK_MS = 500;
const WINDOW_FOCUS_CONFIRMATION_ATTEMPTS = 5;
const WINDOW_FOCUS_CONFIRMATION_POLL_MS = 50;
const TAB_MOVE_RETRY_DELAY_MS = 50;
const TAB_MOVE_ATTEMPTS = 3;
const LIFECYCLE_GROUP_QUERY_FAILED = Object.freeze({ queryFailed: true });
const pendingLifecycleReservations = new Map();
let lifecycleEventSequence = 0;
let lifecycleDrainPromise = null;
let lifecycleDrainRequested = false;

chrome.runtime.onInstalled.addListener(() => {
  scheduleLifecycleDrain();
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error('Space Tabs side panel setup failed:', error));
  }
});

chrome.runtime.onStartup?.addListener(() => {
  scheduleLifecycleDrain();
  return recoverAskStreamsAtWorkerStart();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  return handleAskStreamRecoveryAlarm(alarm)
    .catch((error) => console.error('Space Tabs Ask stream recovery failed:', error));
});

chrome.tabs.onRemoved?.addListener((tabId, removeInfo) => {
  void captureRemovedLifecycleEvent(tabId, removeInfo);
});

chrome.tabs.onCreated?.addListener((tab) => {
  void captureCreatedLifecycleEvent({
    type: 'created',
    tabId: tab?.id,
    tab: serializeTab(tab || {}),
  });
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (!['url', 'title', 'groupId', 'pinned'].some((key) => Object.hasOwn(changeInfo || {}, key))) return;
  void captureUpdatedLifecycleEvent({
    type: 'updated',
    tabId,
    changeInfo: lifecycleChangeInfo(changeInfo),
    tab: serializeTab(tab || {}),
  });
});

chrome.tabs.onMoved?.addListener((tabId, moveInfo) => {
  void journalLifecycleEvent({ type: 'moved', tabId, moveInfo });
});

chrome.tabs.onDetached?.addListener((tabId, detachInfo) => {
  void journalLifecycleEvent({ type: 'detached', tabId, detachInfo });
});

chrome.tabs.onAttached?.addListener((tabId, attachInfo) => {
  void journalLifecycleEvent({ type: 'attached', tabId, attachInfo });
});

chrome.tabs.onReplaced?.addListener((addedTabId, removedTabId) => {
  void journalLifecycleEvent({ type: 'replaced', addedTabId, removedTabId });
});

chrome.tabGroups.onCreated?.addListener((group) => {
  void journalLifecycleEvent({ type: 'group-updated', source: 'created', group: lifecycleGroupRecord(group) });
});

chrome.tabGroups.onUpdated?.addListener((group) => {
  void journalLifecycleEvent({ type: 'group-updated', source: 'updated', group: lifecycleGroupRecord(group) });
});

chrome.tabGroups.onMoved?.addListener((group) => {
  void journalLifecycleEvent({ type: 'group-updated', source: 'moved', group: lifecycleGroupRecord(group) });
});

chrome.tabGroups.onRemoved?.addListener((group) => {
  void journalLifecycleEvent({ type: 'group-removed', group: lifecycleGroupRecord(group) });
});

chrome.windows.onRemoved?.addListener((windowId) => {
  void cleanupClosedWindowState(windowId)
    .catch((error) => console.error('Space Tabs window cleanup failed:', error));
});

scheduleLifecycleDrain();
void recoverAskStreamsAtWorkerStart();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  sidePanelPorts.set(port, {
    visible: true,
    windowId: normalizePanelWindowId(port.sender?.tab?.windowId),
  });
  port.onMessage.addListener((message) => {
    if (message?.type === 'panel:visibility') {
      const record = sidePanelPorts.get(port);
      if (record) {
        record.visible = message.visible !== false;
        const windowId = normalizePanelWindowId(message.windowId);
        if (windowId !== null) record.windowId = windowId;
      }
    }
  });
  port.onDisconnect.addListener(() => sidePanelPorts.delete(port));
});

async function handleMessage(message, sender = {}) {
  switch (message?.type) {
    case 'panel:toggle':
      return togglePanel(sender, message.windowId);
    case 'panel:focus':
      return focusPanel(sender, message.windowId);
    case 'shortcut:action':
      return forwardShortcutAction(message.action, sender, message.windowId);
    case 'tabs:list':
      return listTabs(message.windowId);
    case 'tabs:listAll':
      return listAllTabs();
    case 'tabs:create':
      return createTab(message.url, message.active, message.windowId);
    case 'tabs:openUnique':
      return openUniqueTab(
        message.url,
        message.matchUrl,
        Number.isFinite(Number(message.preferredTabId)) ? Number(message.preferredTabId) : sender.tab?.id,
        message.windowId,
      );
    case 'tabs:focus':
      return focusTab(message.tabId, {
        focusGuard: message.focusGuard,
        skipChanged: message.skipChanged === true,
      });
    case 'tabs:duplicate':
      return duplicateTab(message.tabId);
    case 'tabs:discard':
      return discardTab(message.tabId);
    case 'tabs:close':
      return closeTab(message.tabId, {
        preserveSnapshot: message.preserveSnapshot !== false,
        closeGuard: message.closeGuard,
        skipChanged: message.skipChanged === true,
        requiredActiveSurvivorTabId: message.requiredActiveSurvivorTabId,
        requiredTargetTabGuards: message.requiredTargetTabGuards,
      });
    case 'tabs:group':
      return groupTabs(message.tabIds, message.title, message.color, message.collapsed);
    case 'tabs:groupExisting':
      return addTabsToGroup(message.groupId, message.tabIds);
    case 'tabs:move':
      return moveTab(message.tabId, message.index, message.windowId);
    case 'tabs:moveRelative':
      return moveTabRelative(
        message.tabId,
        message.anchorTabId,
        message.edge,
        message.expectedGroupId,
      );
    case 'tabs:ungroup':
      return ungroupTabs(message.tabIds);
    case 'groups:update':
      return updateGroup(message.groupId, message.update);
    case 'groups:move':
      return moveGroup(message.groupId, message.index);
    case 'pages:extract':
      return extractPages(message.tabIds, message.options);
    case 'ask:begin':
      return beginAskStreamTurn(message.askTurn);
    case 'ai:chat':
      return runChatCompletion(
        message.settings,
        message.messages,
        message.requestId,
        message.stream,
        message.purpose,
        message.itemCount,
        message.askStream,
      );
    case 'ai:abort':
      return abortChatCompletion(message.requestId);
    default:
      throw new Error(`Unknown message type: ${message?.type}`);
  }
}

async function togglePanel(sender = {}, requestedWindowId) {
  const windowId = await sidePanelWindowId(sender, requestedWindowId);
  const visiblePorts = getVisibleSidePanelPorts(windowId);
  if (visiblePorts.length > 0) {
    for (const port of visiblePorts) {
      try {
        port.postMessage({ type: 'panel:close' });
      } catch {
        sidePanelPorts.delete(port);
      }
    }
    return { closed: true };
  }

  if (await openSidePanel(windowId)) {
    return { opened: true };
  }
  throw new Error('Cannot open the side panel from this page.');
}

async function focusPanel(sender = {}, requestedWindowId) {
  if (
    requestedWindowId !== undefined &&
    normalizePanelWindowId(requestedWindowId) === null
  ) return { focused: false };
  const windowId = await sidePanelWindowId(sender, requestedWindowId);
  if (normalizePanelWindowId(windowId) === null) return { focused: false };
  if (getVisibleSidePanelPorts(windowId).length > 0) {
    return { focused: false, alreadyOpen: true };
  }
  return { focused: await openSidePanel(windowId) };
}

async function forwardShortcutAction(action, sender = {}, requestedWindowId) {
  if (!action) throw new Error('Missing shortcut action.');
  const windowId = await sidePanelWindowId(sender, requestedWindowId);
  const visiblePorts = getVisibleSidePanelPorts(windowId);
  if (visiblePorts.length === 0) {
    if (await openSidePanel(windowId)) {
      return { opened: true, forwarded: false };
    }
    return { forwarded: false };
  }

  for (const port of visiblePorts) {
    try {
      port.postMessage({ type: 'shortcut:action', action });
    } catch {
      sidePanelPorts.delete(port);
    }
  }
  return { forwarded: true };
}

function getVisibleSidePanelPorts(windowId) {
  return [...sidePanelPorts.entries()]
    .filter(([, record]) => shouldRouteToPanel(record, windowId))
    .map(([port]) => port);
}

async function sidePanelWindowId(sender = {}, requestedWindowId) {
  const requested = normalizePanelWindowId(requestedWindowId);
  if (requested !== null) return requested;
  if (Number.isFinite(sender.tab?.windowId)) return sender.tab.windowId;
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (Number.isFinite(activeTab?.windowId)) return activeTab.windowId;
  const focusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  return focusedWindow?.id;
}

async function openSidePanel(windowId) {
  if (!chrome.sidePanel?.open || !Number.isFinite(windowId)) return false;
  await chrome.sidePanel.open({ windowId });
  return true;
}

async function listTabs(windowId) {
  const numericWindowId = Number(windowId);
  const query = Number.isFinite(numericWindowId) ? { windowId: numericWindowId } : { currentWindow: true };
  const [queriedTabs, existingTabs, existingGroups, lifecycleProtection] = await Promise.all([
    chrome.tabs.query(query),
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    listLifecycleProtectionTabIds(),
  ]);
  const ownExtensionPrefix = chrome.runtime.getURL('');
  const tabs = queriedTabs.filter((tab) => !tabUrl(tab).startsWith(ownExtensionPrefix));
  const allTabs = existingTabs.filter((tab) => !tabUrl(tab).startsWith(ownExtensionPrefix));
  const targetWindowId = Number.isFinite(numericWindowId) ? numericWindowId : queriedTabs[0]?.windowId;
  const groups = Number.isFinite(targetWindowId)
    ? existingGroups.filter((group) => Number(group.windowId) === Number(targetWindowId))
    : [];
  const visibleGroupIds = new Set(tabs.map((tab) => Number(tab.groupId)).filter((groupId) => groupId !== -1));
  return {
    tabs: tabs.sort((a, b) => a.index - b.index).map(serializeTab),
    groups: groups.filter((group) => visibleGroupIds.has(Number(group.id))).map(serializeGroup),
    allTabs: allTabs
      .sort((left, right) => Number(left.windowId) - Number(right.windowId) || left.index - right.index)
      .map(serializeTab),
    allGroups: existingGroups.map(serializeGroup),
    existingTabIds: existingTabs.map((tab) => Number(tab.id)).filter(Number.isFinite),
    existingWindowIds: [...new Set(existingTabs
      .map((tab) => Number(tab.windowId))
      .filter((windowId) => Number.isSafeInteger(windowId) && windowId >= 0))]
      .sort((left, right) => left - right),
    existingGroupIds: existingGroups.map((group) => Number(group.id)).filter(Number.isFinite),
    pendingLifecycleTabIds: lifecycleProtection.pendingLifecycleTabIds,
    suppressedLifecycleTabIds: lifecycleProtection.suppressedLifecycleTabIds,
  };
}

async function listLifecycleProtectionTabIds() {
  const storageSession = chrome.storage?.session;
  if (!storageSession) return { pendingLifecycleTabIds: [], suppressedLifecycleTabIds: [] };
  const beforeRead = pendingLifecycleEventsForStorage(storageSession);
  const storedSession = await storageSession.get(null);
  const afterRead = pendingLifecycleEventsForStorage(storageSession);
  const persistedEvents = Object.entries(storedSession)
    .filter(([key, value]) => (
      key.startsWith(LIFECYCLE_EVENT_PREFIX) &&
      value &&
      typeof value === 'object'
    ))
    .map(([, event]) => event);
  const pendingLifecycleTabIds = [...new Set([
    ...beforeRead,
    ...persistedEvents,
    ...afterRead,
  ].flatMap(lifecycleEventTabIds))].sort((left, right) => left - right);
  const now = Date.now();
  const suppressedLifecycleTabIds = [...new Set(Object.entries(storedSession)
    .map(([key, value]) => currentLifecycleSuppressionTabId(key, value, now))
    .filter((tabId) => tabId !== null))]
    .sort((left, right) => left - right);
  return { pendingLifecycleTabIds, suppressedLifecycleTabIds };
}

function pendingLifecycleEventsForStorage(storageSession) {
  return [...pendingLifecycleReservations.values()]
    .filter((reservation) => reservation.storageSession === storageSession)
    .map((reservation) => reservation.event);
}

function lifecycleEventTabIds(event = {}) {
  return [event.tabId, event.removedTabId, event.addedTabId, event.tab?.id]
    .map(normalizeLifecycleTabId)
    .filter((tabId) => tabId !== null);
}

function normalizeLifecycleTabId(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const tabId = Number(value);
  return Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null;
}

function currentLifecycleSuppressionTabId(key, value, now = Date.now()) {
  if (value?.disposition !== 'panel-managed') return null;
  const tabId = normalizeLifecycleTabId(value.tabId);
  if (tabId === null || key !== lifecycleSuppressionKey(tabId)) return null;
  const createdAt = Number(value.createdAt);
  const age = Number(now) - createdAt;
  if (!Number.isFinite(createdAt) || !Number.isFinite(age) || age < 0 || age >= LIFECYCLE_SUPPRESSION_VALID_MS) {
    return null;
  }
  return tabId;
}

async function listAllTabs() {
  const [queriedTabs, existingGroups] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
  ]);
  const ownExtensionPrefix = chrome.runtime.getURL('');
  const tabs = queriedTabs.filter((tab) => !tabUrl(tab).startsWith(ownExtensionPrefix));
  const visibleGroupIds = new Set(tabs.map((tab) => Number(tab.groupId)).filter((groupId) => groupId !== -1));
  const sortByBrowserPosition = (left, right) => (
    Number(left.windowId) - Number(right.windowId) || left.index - right.index
  );
  return {
    tabs: tabs
      .sort(sortByBrowserPosition)
      .map(serializeTab),
    // Deletion candidates intentionally exclude this extension's own pages,
    // while window-safety checks must still see them as live survivors. If a
    // Workbench tab is the only non-target tab, Chrome will keep the window
    // open and no temporary new-tab keepalive is necessary.
    allChromeTabs: queriedTabs
      .sort(sortByBrowserPosition)
      .map(serializeTab),
    groups: existingGroups
      .filter((group) => visibleGroupIds.has(Number(group.id)))
      .map(serializeGroup),
  };
}

async function createTab(url = 'chrome://newtab', active = true, windowId) {
  const targetWindowId = normalizePanelWindowId(windowId);
  const createProperties = { url, active: active !== false };
  if (targetWindowId !== null) createProperties.windowId = targetWindowId;
  const tab = await chrome.tabs.create(createProperties);
  return { tab: serializeTab(tab) };
}

async function openUniqueTab(url, matchUrl = url, preferredTabId, windowId) {
  const targetWindowId = normalizePanelWindowId(windowId);
  const tabs = await chrome.tabs.query(targetWindowId === null ? {} : { windowId: targetWindowId });
  const matches = tabs.filter((tab) => tabUrl(tab).startsWith(String(matchUrl || url)));
  const existing = matches.find((tab) => Number(tab.id) === Number(preferredTabId)) ||
    matches.find((tab) => tab.active) ||
    matches[0];
  if (!existing?.id) {
    const createProperties = { url, active: true };
    if (targetWindowId !== null) createProperties.windowId = targetWindowId;
    return { tab: serializeTab(await chrome.tabs.create(createProperties)), reused: false };
  }
  const update = { active: true };
  if (tabUrl(existing) !== String(url || '')) update.url = url;
  let tab = await chrome.tabs.update(existing.id, update);
  if (Number(tab.groupId) !== -1) {
    await chrome.tabs.ungroup([existing.id]);
    tab = await chrome.tabs.get(existing.id);
  }
  const duplicateIds = matches
    .filter((match) => Number(match.id) !== Number(existing.id))
    .map((match) => match.id)
    .filter(Number.isFinite);
  if (duplicateIds.length) await removeTabsPanelManaged(duplicateIds);
  if (Number.isFinite(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
  return { tab: serializeTab(tab), reused: true, closedDuplicates: duplicateIds.length };
}

function tabUrl(tab = {}) {
  return String(tab.pendingUrl || tab.url || '');
}

async function focusTab(tabId, options = {}) {
  try {
    const id = Number(tabId);
    if (options.focusGuard) {
      const current = await chrome.tabs.get(id);
      const mismatch = tabCloseGuardMismatch(current, options.focusGuard);
      if (mismatch) return guardedTabFocusChanged(options, mismatch);
    }
    const tab = await chrome.tabs.update(id, { active: true });
    if (options.focusGuard) {
      const mismatch = tabCloseGuardMismatch(tab, options.focusGuard);
      if (mismatch) return guardedTabFocusChanged(options, mismatch);
    }
    let focusConfirmed = null;
    if (Number.isSafeInteger(Number(tab.windowId))) {
      const windowId = Number(tab.windowId);
      const focusedWindow = await chrome.windows.update(windowId, { focused: true });
      focusConfirmed = await confirmWindowFocus(windowId, focusedWindow);
    }
    return { tab: serializeTab(tab), focusConfirmed };
  } catch (error) {
    if (isMissingChromeEntityError(error) && options.focusGuard) {
      return guardedTabFocusChanged(options, 'missing-or-replaced');
    }
    if (isMissingChromeEntityError(error)) return { tab: null, missing: true };
    throw error;
  }
}

function guardedTabFocusChanged(options, reason) {
  if (options.skipChanged) return { tab: null, skipped: true, reason: String(reason) };
  throw new Error('That tab changed before it could be focused. Open the Command Palette and choose it again.');
}

async function confirmWindowFocus(windowId, updatedWindow) {
  if (updatedWindow?.focused === true) return true;
  for (let attempt = 0; attempt < WINDOW_FOCUS_CONFIRMATION_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, WINDOW_FOCUS_CONFIRMATION_POLL_MS));
    }
    const currentWindow = await chrome.windows.get(windowId);
    if (currentWindow?.focused === true) return true;
  }
  return false;
}

async function duplicateTab(tabId) {
  try {
    const tab = await chrome.tabs.duplicate(Number(tabId));
    return { tab: serializeTab(tab) };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { tab: null, missing: true };
    throw error;
  }
}

async function discardTab(tabId) {
  try {
    const tab = await chrome.tabs.discard(Number(tabId));
    return { tab: serializeTab(tab) };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { tab: null, missing: true };
    throw error;
  }
}

async function closeTab(tabId, options = {}) {
  try {
    const id = Number(tabId);
    if (!Number.isSafeInteger(id) || id < 0) return {};
    if (options.closeGuard) await assertCurrentTabMatchesCloseGuard(id, options.closeGuard);
    if (options.preserveSnapshot === false) {
      await assertRequiredActiveSurvivorTab(id, options.requiredActiveSurvivorTabId);
      await assertRequiredTargetTabGuards(id, options.requiredTargetTabGuards);
      await chrome.tabs.remove(id);
    } else {
      await removeTabsPanelManaged([id], {
        closeGuard: options.closeGuard,
        requiredActiveSurvivorTabId: options.requiredActiveSurvivorTabId,
        requiredTargetTabGuards: options.requiredTargetTabGuards,
      });
    }
    return {};
  } catch (error) {
    if (options.skipChanged && error?.code === 'TAB_CLOSE_GUARD_CHANGED') {
      return { skipped: true, reason: error.reason };
    }
    if (isMissingChromeEntityError(error) && !options.closeGuard) return { missing: true };
    if (isMissingChromeEntityError(error)) {
      const changed = guardedTabCloseChangedError();
      if (options.skipChanged) return { skipped: true, reason: changed.reason };
      throw changed;
    }
    throw error;
  }
}

function guardedTabCloseChangedError(reason = 'missing-or-replaced') {
  const error = new Error('This tab changed after deletion was confirmed. No additional tabs were closed; review the updated Space and try again.');
  error.code = 'TAB_CLOSE_GUARD_CHANGED';
  error.reason = String(reason);
  return error;
}

async function assertCurrentTabMatchesCloseGuard(tabId, closeGuard) {
  let currentTab;
  try {
    currentTab = await chrome.tabs.get(tabId);
  } catch (error) {
    if (isMissingChromeEntityError(error)) throw guardedTabCloseChangedError();
    throw error;
  }
  const mismatch = tabCloseGuardMismatch(currentTab, closeGuard);
  if (mismatch) throw guardedTabCloseChangedError(mismatch);
}

async function assertRequiredActiveSurvivorTab(tabId, requiredActiveSurvivorTabId) {
  if (requiredActiveSurvivorTabId === undefined) return;
  const survivorTabId = normalizeLifecycleTabId(requiredActiveSurvivorTabId);
  if (survivorTabId === null) throw guardedTabCloseChangedError('survivor-missing');

  const closingTab = await chrome.tabs.get(tabId);
  let survivorTab;
  try {
    survivorTab = await chrome.tabs.get(survivorTabId);
  } catch (error) {
    if (isMissingChromeEntityError(error)) {
      throw guardedTabCloseChangedError('survivor-missing');
    }
    throw error;
  }
  if (survivorTabId === tabId) throw guardedTabCloseChangedError('survivor-same-tab');
  if (Number(survivorTab.windowId) !== Number(closingTab.windowId)) {
    throw guardedTabCloseChangedError('survivor-wrong-window');
  }
  if (survivorTab.active !== true) {
    throw guardedTabCloseChangedError('survivor-not-active');
  }
}

async function assertRequiredTargetTabGuards(closingTabId, requiredTargetTabGuards) {
  if (requiredTargetTabGuards === undefined) return;
  if (!Array.isArray(requiredTargetTabGuards) || requiredTargetTabGuards.length > 512) {
    throw guardedTabCloseChangedError('target-missing');
  }
  const seen = new Set();
  for (const guard of requiredTargetTabGuards) {
    const tabId = normalizeLifecycleTabId(guard?.tabId);
    const windowId = normalizePanelWindowId(guard?.windowId);
    const groupId = Number(guard?.groupId);
    if (
      tabId === null || tabId === Number(closingTabId) || seen.has(tabId) || windowId === null ||
      !Number.isSafeInteger(groupId) || groupId < -1
    ) {
      throw guardedTabCloseChangedError('target-missing');
    }
    seen.add(tabId);
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (error) {
      if (isMissingChromeEntityError(error)) {
        throw guardedTabCloseChangedError('target-missing');
      }
      throw error;
    }
    if (Number(tab.windowId) !== windowId) {
      throw guardedTabCloseChangedError('target-wrong-window');
    }
    if (Number(tab.groupId) !== groupId) {
      throw guardedTabCloseChangedError('target-wrong-group');
    }
  }
}

async function removeTabsPanelManaged(tabIds, options = {}) {
  const ids = [...new Set(tabIds.map(Number).filter((id) => Number.isSafeInteger(id) && id >= 0))];
  if (!chrome.storage?.session) {
    if (options.closeGuard) await assertCurrentTabMatchesCloseGuard(ids[0], options.closeGuard);
    await assertRequiredActiveSurvivorTab(ids[0], options.requiredActiveSurvivorTabId);
    await assertRequiredTargetTabGuards(ids[0], options.requiredTargetTabGuards);
    await chrome.tabs.remove(ids.length === 1 ? ids[0] : ids);
    return;
  }

  for (const tabId of ids) {
    const suppressionKey = lifecycleSuppressionKey(tabId);
    await chrome.storage.session.set({
      [suppressionKey]: {
        tabId,
        disposition: 'panel-managed',
        createdAt: Date.now(),
      },
    });
    try {
      if (options.closeGuard) await assertCurrentTabMatchesCloseGuard(tabId, options.closeGuard);
      await assertRequiredActiveSurvivorTab(tabId, options.requiredActiveSurvivorTabId);
      await assertRequiredTargetTabGuards(tabId, options.requiredTargetTabGuards);
      await chrome.tabs.remove(tabId);
    } catch (error) {
      await chrome.storage.session.remove(suppressionKey).catch(() => undefined);
      throw error;
    }
  }
}

function lifecycleSuppressionKey(tabId) {
  return `${LIFECYCLE_SUPPRESSION_PREFIX}${Number(tabId)}`;
}

async function captureRemovedLifecycleEvent(tabId, removeInfo = {}) {
  if (!chrome.storage?.session || !chrome.storage?.local) return null;
  const reserved = reserveLifecycleEvent({
    type: 'removed',
    tabId,
    windowId: removeInfo.windowId,
    isWindowClosing: removeInfo.isWindowClosing === true,
  });
  return captureReservedLifecycleEvent(reserved, async () => {
    const suppressionKey = lifecycleSuppressionKey(tabId);
    let suppression = null;
    try {
      suppression = (await chrome.storage.session.get(suppressionKey))[suppressionKey] || null;
    } catch {
      suppression = null;
    }
    const removalTabId = normalizeLifecycleTabId(tabId);
    const suppressionTabId = currentLifecycleSuppressionTabId(
      suppressionKey,
      suppression,
    );
    const suppressionIsCurrent = removalTabId !== null && suppressionTabId === removalTabId;
    return persistLifecycleJournalEntry({
      ...reserved,
      ...(suppressionIsCurrent ? { suppressed: true, disposition: 'panel-managed' } : {}),
      ...(suppression ? { suppressionKey } : {}),
    });
  });
}

function lifecycleChangeInfo(changeInfo = {}) {
  const result = {};
  for (const key of ['url', 'title', 'groupId', 'pinned']) {
    if (Object.hasOwn(changeInfo, key)) result[key] = changeInfo[key];
  }
  return result;
}

async function journalLifecycleEvent(event = {}) {
  if (!chrome.storage?.session || !chrome.storage?.local) return null;
  const reserved = reserveLifecycleEvent(event);
  return captureReservedLifecycleEvent(
    reserved,
    () => persistLifecycleJournalEntry(reserved),
  );
}

function reserveLifecycleEvent(event = {}) {
  lifecycleEventSequence += 1;
  const eventId = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${lifecycleEventSequence}-${Math.random().toString(36).slice(2)}`;
  const reserved = {
    ...event,
    eventId,
    capturedAt: Date.now(),
    sequence: lifecycleEventSequence,
  };
  pendingLifecycleReservations.set(eventId, {
    event: reserved,
    storageSession: chrome.storage?.session,
  });
  return reserved;
}

async function captureReservedLifecycleEvent(reserved, capture) {
  try {
    return await capture();
  } catch (error) {
    pendingLifecycleReservations.delete(reserved.eventId);
    scheduleLifecycleDrain();
    console.error('Space Tabs lifecycle event capture failed:', error);
    return null;
  }
}

async function persistLifecycleJournalEntry(event) {
  const journalKey = `${LIFECYCLE_EVENT_PREFIX}${event.eventId}`;
  await chrome.storage.session.set({
    [journalKey]: event,
  });
  scheduleLifecycleDrain();
  return journalKey;
}

async function captureCreatedLifecycleEvent(event = {}) {
  if (!chrome.storage?.session || !chrome.storage?.local) return null;
  const reserved = reserveLifecycleEvent(event);
  return captureReservedLifecycleEvent(reserved, () => withLifecycleStateLock(async () => {
    const [storedSession, storedLocal] = await Promise.all([
      chrome.storage.session.get(WINDOW_STATE_KEY),
      chrome.storage.local.get(STORAGE_KEY),
    ]);
    const windowId = lifecycleEventWindowId(reserved);
    const workspace = mergeStoredState(storedLocal[STORAGE_KEY], createDefaultState());
    const mappedSpaceId = windowId !== null
      ? String(storedSession[WINDOW_STATE_KEY]?.activeSpaceIds?.[windowId] || '')
      : '';
    const knownSpaceIds = new Set(workspace.spaces.map((space) => String(space?.id || '')));
    const windowSpaceId = knownSpaceIds.has(mappedSpaceId)
      ? mappedSpaceId
      : String(workspace.activeSpaceId || '');
    return persistLifecycleJournalEntry({
      ...reserved,
      ...(windowSpaceId ? { windowSpaceId } : {}),
    });
  }));
}

async function captureUpdatedLifecycleEvent(event = {}) {
  if (!chrome.storage?.session || !chrome.storage?.local) return null;
  const reserved = reserveLifecycleEvent(event);
  return captureReservedLifecycleEvent(reserved, () => withLifecycleStateLock(async () => {
    // Read the per-window mapping and durable workspace under the same lock as
    // saveState's paired transaction. Otherwise an onUpdated event can capture
    // the temporary first half of a Space switch that is subsequently rolled
    // back and bind an unowned tab to the wrong Space.
    const [storedSession, storedLocal] = await Promise.all([
      chrome.storage.session.get(WINDOW_STATE_KEY),
      chrome.storage.local.get(STORAGE_KEY),
    ]);
    const windowId = lifecycleEventWindowId(reserved);
    const workspace = mergeStoredState(storedLocal[STORAGE_KEY], createDefaultState());
    const mappedSpaceId = windowId !== null
      ? String(storedSession[WINDOW_STATE_KEY]?.activeSpaceIds?.[windowId] || '')
      : '';
    const knownSpaceIds = new Set(workspace.spaces.map((space) => String(space?.id || '')));
    const storedWorkspace = storedLocal[STORAGE_KEY];
    const activeSpaceId = String(
      storedWorkspace && Object.hasOwn(storedWorkspace, 'activeSpaceId')
        ? storedWorkspace.activeSpaceId
        : workspace.activeSpaceId,
    );
    const windowSpaceId = knownSpaceIds.has(mappedSpaceId)
      ? mappedSpaceId
      : knownSpaceIds.has(activeSpaceId) ? activeSpaceId : '';
    return persistLifecycleJournalEntry({
      ...reserved,
      windowSpaceCaptured: true,
      ...(windowSpaceId ? { windowSpaceId } : {}),
    });
  }));
}

function scheduleLifecycleDrain() {
  if (!chrome.storage?.session || !chrome.storage?.local) return null;
  lifecycleDrainRequested = true;
  if (lifecycleDrainPromise) return lifecycleDrainPromise;
  lifecycleDrainPromise = Promise.resolve()
    .then(async () => {
      do {
        lifecycleDrainRequested = false;
        await withLifecycleStateLock(drainLifecycleJournal);
      } while (lifecycleDrainRequested);
    })
    .catch((error) => console.error('Space Tabs lifecycle journal failed:', error))
    .finally(() => {
      lifecycleDrainPromise = null;
    });
  return lifecycleDrainPromise;
}

async function withLifecycleStateLock(task) {
  if (!globalThis.navigator?.locks?.request) return task();
  return globalThis.navigator.locks.request(SHARED_STATE_LOCK_NAME, { mode: 'exclusive' }, task);
}

async function cleanupClosedWindowState(windowId) {
  for (const [port, record] of sidePanelPorts) {
    if (normalizePanelWindowId(record.windowId) === normalizePanelWindowId(windowId)) {
      sidePanelPorts.delete(port);
    }
  }
  await withLifecycleStateLock(async () => {
    const stored = await chrome.storage.session.get(WINDOW_STATE_KEY);
    const windowState = stored[WINDOW_STATE_KEY];
    const nextWindowState = forgetActiveSpaceForWindow(windowState, windowId);
    if (Object.keys(nextWindowState.activeSpaceIds).length ===
      Object.keys(windowState?.activeSpaceIds || {}).length) return;
    await chrome.storage.session.set({ [WINDOW_STATE_KEY]: nextWindowState });
  });
}

async function drainLifecycleJournal() {
  const storedSession = await chrome.storage.session.get(null);
  const journalEntries = Object.entries(storedSession)
    .filter(([key, value]) => key.startsWith(LIFECYCLE_EVENT_PREFIX) && value && typeof value === 'object')
    .sort((left, right) => (
      Number(left[1].capturedAt || 0) - Number(right[1].capturedAt || 0) ||
      Number(left[1].sequence || 0) - Number(right[1].sequence || 0) ||
      left[0].localeCompare(right[0])
    ));
  if (journalEntries.length === 0) return;
  // Chrome can deliver onCreated before a checkpoint rollback closes the new
  // tab while the created-event capture is still waiting for the shared state
  // lock. Its later onRemoved event can already be durable at this point. Do
  // not acknowledge that removal ahead of an in-flight reservation: otherwise
  // the delayed create is replayed last and resurrects a closed tab as a
  // snapshot row with no subsequent removal left to clean it up.
  if (hasUnpersistedLifecycleReservation(chrome.storage.session, journalEntries)) return;
  const windowClosingRemovals = journalEntries.flatMap(([, event], index) => (
    event.type === 'removed' && event.isWindowClosing === true
      ? [{ index, tabId: Number(event.tabId), windowId: lifecycleEventWindowId(event) }]
      : []
  ));
  const matchingLaterWindowClose = (event, index) => {
    const tabId = Number(event.tabId);
    const windowId = lifecycleEventWindowId(event);
    return windowClosingRemovals.some((removal) => (
      removal.index > index &&
      removal.tabId === tabId &&
      (windowId === null || removal.windowId === null || removal.windowId === windowId)
    ));
  };
  const unsettledUngroup = journalEntries.find(([, event], index) => {
    if (
      event.type !== 'updated' ||
      !Object.hasOwn(event.changeInfo || {}, 'groupId') ||
      Number(event.changeInfo.groupId) !== -1 ||
      matchingLaterWindowClose(event, index)
    ) return false;
    const capturedAt = Number(event.capturedAt);
    const age = Date.now() - capturedAt;
    return Number.isFinite(capturedAt) && age >= 0 && age < WINDOW_CLOSE_UNGROUP_SETTLE_MS;
  });
  if (unsettledUngroup) {
    const capturedAt = Number(unsettledUngroup[1].capturedAt);
    const remaining = Math.max(1, WINDOW_CLOSE_UNGROUP_SETTLE_MS - (Date.now() - capturedAt));
    // Keep the journal and shared lock alive briefly so Chrome's immediately
    // following isWindowClosing removal can join this durable batch. A normal
    // user ungroup has no such removal and is applied after this short settle.
    await new Promise((resolve) => setTimeout(resolve, remaining));
    return drainLifecycleJournal();
  }

  const browserSessionId = await getOrCreateBrowserSessionId();
  const storedLocal = await chrome.storage.local.get(STORAGE_KEY);
  let workspaceState = resetChromeSessionBindings(
    mergeStoredState(storedLocal[STORAGE_KEY], createDefaultState()),
    browserSessionId,
  );

  for (const [index, [journalKey, rawEvent]] of journalEntries.entries()) {
    const preserveGroupForWindowClose = rawEvent.type === 'updated' &&
      Object.hasOwn(rawEvent.changeInfo || {}, 'groupId') &&
      Number(rawEvent.changeInfo?.groupId) === -1 &&
      matchingLaterWindowClose(rawEvent, index);
    const windowId = lifecycleEventWindowId(rawEvent);
    const mappedWindowSpaceId = windowId === null
      ? ''
      : storedSession[WINDOW_STATE_KEY]?.activeSpaceIds?.[windowId];
    const capturedWindowSpace = rawEvent.windowSpaceCaptured === true;
    const windowSpaceId = lifecycleKnownSpaceId(workspaceState, rawEvent.windowSpaceId) ||
      (capturedWindowSpace || windowId === null
        ? ''
        : lifecycleKnownSpaceId(workspaceState, mappedWindowSpaceId) ||
          lifecycleKnownSpaceId(workspaceState, workspaceState.activeSpaceId));
    const event = await enrichLifecycleEvent(workspaceState, {
      ...rawEvent,
      sessionId: rawEvent.sessionId || browserSessionId,
      ...(windowSpaceId ? { windowSpaceId } : {}),
      ...(preserveGroupForWindowClose ? { preserveGroupForWindowClose: true } : {}),
    });
    workspaceState = reduceTabLifecycleEvent({
      state: workspaceState,
      event,
      now: Number(rawEvent.capturedAt) || Date.now(),
    });
    await chrome.storage.local.set({ [STORAGE_KEY]: workspaceState });
    const acknowledgedKeys = [journalKey];
    if (typeof rawEvent.suppressionKey === 'string') acknowledgedKeys.push(rawEvent.suppressionKey);
    await chrome.storage.session.remove(acknowledgedKeys);
    const reservation = pendingLifecycleReservations.get(rawEvent.eventId);
    if (reservation?.storageSession === chrome.storage.session) {
      pendingLifecycleReservations.delete(rawEvent.eventId);
    }
  }
}

function hasUnpersistedLifecycleReservation(storageSession, journalEntries) {
  const persistedEventIds = new Set(journalEntries.map(([, event]) => String(event.eventId)));
  return pendingLifecycleEventsForStorage(storageSession).some((event) => (
    !persistedEventIds.has(String(event.eventId))
  ));
}

function lifecycleEventWindowId(event = {}) {
  const windowId = Number(event.windowId ?? event.tab?.windowId ?? event.group?.windowId);
  return Number.isSafeInteger(windowId) && windowId >= 0 ? windowId : null;
}

async function getOrCreateBrowserSessionId() {
  const stored = await chrome.storage.session.get(BROWSER_SESSION_STORAGE_KEY);
  const existing = stored[BROWSER_SESSION_STORAGE_KEY];
  if (typeof existing === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(existing)) return existing;
  const sessionId = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await chrome.storage.session.set({ [BROWSER_SESSION_STORAGE_KEY]: sessionId });
  return sessionId;
}

async function enrichLifecycleEvent(state, event) {
  if (event.type === 'group-updated' || event.type === 'group-removed') {
    return enrichGroupLifecycleEvent(state, event);
  }
  if (event.type === 'created') return enrichCreatedLifecycleEvent(state, event);
  if (event.type === 'updated') {
    const currentTab = await chrome.tabs.get(Number(event.tabId)).catch(() => null);
    const changeInfo = { ...event.changeInfo };
    if (currentTab) {
      if (Object.hasOwn(changeInfo, 'url')) changeInfo.url = tabUrl(currentTab);
      if (Object.hasOwn(changeInfo, 'title')) changeInfo.title = String(currentTab.title || '');
      if (Object.hasOwn(changeInfo, 'groupId')) changeInfo.groupId = currentTab.groupId;
      if (Object.hasOwn(changeInfo, 'pinned')) changeInfo.pinned = Boolean(currentTab.pinned);
    }
    const currentEvent = {
      ...event,
      changeInfo,
      ...(currentTab ? { tab: serializeTab(currentTab) } : {}),
    };
    const binding = state.tabLifecycle?.[Number(event.tabId)];
    const inferredWindowClose = await missingUngroupedTabBelongedToClosedWindow(
      currentEvent,
      binding,
      currentTab,
    );
    // Closing a whole window makes Chrome emit a synthetic groupId:-1 update
    // immediately before the tab removal. Keep the saved Tag when either the
    // matching removal is in this durable batch or Chrome confirms that the
    // tab's known prior window disappeared before its removal was journaled.
    if (
      (event.preserveGroupForWindowClose === true || inferredWindowClose) &&
      Number(changeInfo.groupId) === -1
    ) return { ...currentEvent, preserveGroupForWindowClose: true };
    if (!binding) {
      return enrichCreatedLifecycleEvent(state, currentEvent);
    }
    const hasImplicitGroupChange = Object.hasOwn(currentEvent.tab || {}, 'groupId') &&
      Number(currentEvent.tab.groupId) !== Number(binding.groupId);
    if (
      !Object.hasOwn(changeInfo, 'groupId') &&
      !hasImplicitGroupChange &&
      binding.provisional !== true
    ) return currentEvent;
    const currentGroupId = Object.hasOwn(changeInfo, 'groupId')
      ? changeInfo.groupId
      : currentEvent.tab?.groupId;
    const targetGroup = await lifecycleTargetGroup(state, currentEvent, currentGroupId);
    if (targetGroup === LIFECYCLE_GROUP_QUERY_FAILED) {
      return { ...currentEvent, deferGroupMembership: true };
    }
    if (!targetGroup) return currentEvent;
    const ordering = await lifecycleGroupOrdering(
      state,
      currentGroupId,
      currentEvent.tab?.windowId,
      targetGroup,
    );
    return { ...currentEvent, targetGroup: { ...targetGroup, ...ordering } };
  }
  if (event.type === 'moved') return enrichMovedLifecycleEvent(state, event);
  if (event.type === 'replaced') {
    const tab = await chrome.tabs.get(Number(event.addedTabId)).catch(() => null);
    return tab ? { ...event, tab: serializeTab(tab) } : event;
  }
  return event;
}

async function missingUngroupedTabBelongedToClosedWindow(event, binding, currentTab) {
  if (
    currentTab ||
    Number(event.changeInfo?.groupId) !== -1 ||
    !binding ||
    Number(binding.groupId) < 0
  ) return false;
  const windowIds = [event.windowId, event.tab?.windowId, binding.windowId]
    .map(normalizeLifecycleWindowId)
    .filter((windowId) => windowId !== null);
  const uniqueWindowIds = [...new Set(windowIds)];
  if (uniqueWindowIds.length !== 1) return false;
  const [windowId] = uniqueWindowIds;
  try {
    const remainingTabs = await chrome.tabs.query({ windowId });
    if (Array.isArray(remainingTabs)) {
      if (remainingTabs.length === 0) return true;
      const ownExtensionPrefix = chrome.runtime.getURL('');
      if (!remainingTabs.every((tab) => tabUrl(tab).startsWith(ownExtensionPrefix))) return false;
      // During chrome.windows.remove, user pages can disappear slightly before
      // a Workbench/side-panel extension page. An extension-only remainder is
      // therefore ambiguous: check once more before treating Chrome's
      // synthetic groupId:-1 as a real user ungroup.
      await new Promise((resolve) => setTimeout(resolve, WINDOW_CLOSE_EXTENSION_ONLY_RECHECK_MS));
      const recheckedTabs = await chrome.tabs.query({ windowId });
      if (Array.isArray(recheckedTabs)) return recheckedTabs.length === 0;
    }
  } catch {
    // Fall through to an explicit window existence check. Query failures alone
    // are not evidence that Chrome closed the window.
  }
  try {
    await chrome.windows.get(windowId);
    return false;
  } catch (error) {
    return isMissingChromeWindowError(error);
  }
}

function normalizeLifecycleWindowId(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const windowId = Number(value);
  return Number.isSafeInteger(windowId) && windowId >= 0 ? windowId : null;
}

function isMissingChromeWindowError(error) {
  return /No window with id/i.test(error?.message || String(error));
}

async function enrichGroupLifecycleEvent(state, event) {
  const groupId = Number(event.group?.id ?? event.groupId);
  if (!Number.isSafeInteger(groupId) || groupId < 0) return event;
  const currentGroup = event.type === 'group-removed'
    ? event.group
    : await chrome.tabGroups.get(groupId).catch(() => event.group);
  const target = lifecycleGroupTarget(state, groupId);
  if (!target) return { ...event, groupId, group: currentGroup };
  const ordering = await lifecycleGroupOrdering(
    state,
    groupId,
    currentGroup?.windowId,
    target,
  );
  return {
    ...event,
    groupId,
    group: currentGroup,
    ...target,
    ...ordering,
  };
}

async function lifecycleGroupOrdering(state, groupId, rawWindowId, target) {
  const windowId = Number(rawWindowId);
  if (!Number.isSafeInteger(windowId)) return {};
  const windowTabs = await chrome.tabs.query({ windowId }).catch(() => null);
  if (!windowTabs) return {};
  const orderedGroupIds = [];
  const orderedSnapshotGroupIds = [];
  const orderedTabIds = [];
  const seen = new Set();
  for (const tab of windowTabs.sort((left, right) => Number(left.index) - Number(right.index))) {
    const candidateId = Number(tab.groupId);
    if (candidateId === Number(groupId) && Number.isSafeInteger(Number(tab.id))) {
      orderedTabIds.push(Number(tab.id));
    }
    if (!Number.isSafeInteger(candidateId) || candidateId < 0 || seen.has(candidateId)) continue;
    const candidateTarget = candidateId === Number(groupId)
      ? target
      : lifecycleGroupTarget(state, candidateId);
    if (!candidateTarget || candidateTarget.spaceId !== target.spaceId) continue;
    seen.add(candidateId);
    orderedGroupIds.push(candidateId);
    orderedSnapshotGroupIds.push(candidateTarget.snapshotGroupId);
  }
  return { orderedGroupIds, orderedSnapshotGroupIds, orderedTabIds };
}

function lifecycleGroupTarget(state, groupId) {
  const bindings = Object.values(state.tabLifecycle).filter((binding) => (
    Number(binding?.groupId) === Number(groupId)
  ));
  const peerSpaceIds = uniqueNonEmptyStrings(bindings.map((binding) => binding.spaceId));
  const ownedSpaceId = String(state.groupSpaces?.[groupId] || '').trim();
  const candidateSpaceIds = uniqueNonEmptyStrings([ownedSpaceId, ...peerSpaceIds]);
  if (candidateSpaceIds.length !== 1) return null;
  const spaceId = candidateSpaceIds[0];
  const snapshotGroupIds = uniqueNonEmptyStrings(bindings
    .filter((binding) => String(binding.spaceId || '') === spaceId)
    .map((binding) => binding.snapshotGroupId));
  if (snapshotGroupIds.length !== 1) return null;
  return { spaceId, snapshotGroupId: snapshotGroupIds[0] };
}

function lifecycleGroupRecord(group = {}) {
  return {
    ...serializeGroup(group),
    ...(Object.hasOwn(group, 'title') ? { title: String(group.title ?? '') } : {}),
    ...(Number.isSafeInteger(Number(group.windowId)) ? { windowId: Number(group.windowId) } : {}),
  };
}

async function enrichCreatedLifecycleEvent(state, event) {
  const tabId = Number(event.tabId ?? event.tab?.id);
  if (!Number.isSafeInteger(tabId) || tabId < 0) return event;
  let currentTab = null;
  try {
    currentTab = await chrome.tabs.get(tabId);
  } catch (error) {
    // A durable created event can outlive a tab when a checkpoint rollback or
    // service-worker restart reorders delivery. Captured payload is useful for
    // transient API failures, but must never resurrect a tab Chrome confirms
    // no longer exists.
    if (isMissingChromeEntityError(error)) return null;
  }
  const tab = currentTab ? serializeTab(currentTab) : event.tab;
  const groupId = Number(tab?.groupId ?? event.groupId ?? -1);
  const spaceId = lifecycleSpaceForTab(state, { ...tab, id: tabId, groupId }, event);
  if (!spaceId) return { ...event, type: 'created', tabId, tab };
  const targetGroup = await lifecycleTargetGroup(
    state,
    { ...event, type: 'created', tabId, tab },
    groupId,
    spaceId,
  );
  if (targetGroup === LIFECYCLE_GROUP_QUERY_FAILED) {
    return { ...event, type: 'created', tabId, tab };
  }
  return {
    ...event,
    type: 'created',
    tabId,
    tab,
    groupId,
    spaceId,
    ...(targetGroup ? { targetGroup } : {}),
  };
}

function lifecycleSpaceForTab(state, tab = {}, event = {}) {
  const tabId = Number(tab.id);
  const groupId = Number(tab.groupId);
  const acceptKnown = (value) => lifecycleKnownSpaceId(state, value);

  if (Number.isSafeInteger(groupId) && groupId >= 0) {
    const owned = acceptKnown(state.groupSpaces?.[groupId]);
    if (owned) return owned;
    const peerSpaceIds = uniqueNonEmptyStrings(Object.values(state.tabLifecycle)
      .filter((binding) => Number(binding?.groupId) === groupId)
      .map((binding) => acceptKnown(binding?.spaceId)));
    if (peerSpaceIds.length === 1) return peerSpaceIds[0];
  }
  const tabSpaceId = acceptKnown(state.tabSpaces?.[tabId]);
  if (tabSpaceId) return tabSpaceId;

  return acceptKnown(event.windowSpaceId);
}

async function lifecycleTargetGroup(state, event, rawGroupId, fallbackSpaceId = '') {
  const tabId = Number(event.tabId);
  const binding = state.tabLifecycle?.[tabId] || {};
  const groupId = Number(rawGroupId);
  if (!Number.isSafeInteger(groupId)) return null;

  if (groupId < 0) {
    const spaceId = String(fallbackSpaceId || binding.spaceId || '');
    if (!spaceId) return null;
    const snapshot = state.spaceSnapshots?.[spaceId];
    const boundSnapshotGroup = Number(binding.groupId) < 0 &&
      String(binding.spaceId || '') === spaceId
      ? (snapshot?.groups || []).find((group) => (
        group.snapshotGroupId === binding.snapshotGroupId
      ))
      : null;
    if (boundSnapshotGroup) {
      return {
        spaceId,
        snapshotGroupId: boundSnapshotGroup.snapshotGroupId,
        title: boundSnapshotGroup.title || 'Ungrouped',
        color: boundSnapshotGroup.color || 'grey',
        collapsed: Boolean(boundSnapshotGroup.collapsed),
      };
    }
    const existing = (snapshot?.groups || []).find((group) => (
      (group.title || 'Ungrouped') === 'Ungrouped' && (group.color || 'grey') === 'grey'
    ));
    return {
      spaceId,
      snapshotGroupId: existing?.snapshotGroupId || `group:${event.eventId}`,
      title: 'Ungrouped',
      color: 'grey',
      collapsed: false,
    };
  }

  const peerBindings = Object.values(state.tabLifecycle).filter((candidate) => (
    Number(candidate?.tabId) !== tabId && Number(candidate?.groupId) === groupId
  ));
  const peerSpaceIds = uniqueNonEmptyStrings(peerBindings.map((candidate) => candidate.spaceId));
  if (peerSpaceIds.length > 1) return null;
  const ownedSpaceId = String(state.groupSpaces?.[groupId] || '');
  const physicalBindings = await lifecyclePhysicalGroupBindings(state, event, groupId);
  if (physicalBindings === null && !ownedSpaceId) return LIFECYCLE_GROUP_QUERY_FAILED;
  const physicalSpaceIds = uniqueNonEmptyStrings((physicalBindings || [])
    .map((candidate) => candidate.spaceId));
  const isUnownedCrossSpaceGroup = !ownedSpaceId && physicalSpaceIds.length > 1;
  const windowSpaceId = lifecycleKnownSpaceId(state, event.windowSpaceId);
  if (isUnownedCrossSpaceGroup && !windowSpaceId) return null;
  const spaceId = ownedSpaceId ||
    (isUnownedCrossSpaceGroup ? windowSpaceId : '') ||
    peerSpaceIds[0] ||
    String(fallbackSpaceId || binding.spaceId || '');
  if (!spaceId) return null;

  const peerSnapshotGroupIds = uniqueNonEmptyStrings(peerBindings
    .filter((candidate) => candidate.spaceId === spaceId)
    .map((candidate) => candidate.snapshotGroupId));
  if (peerSnapshotGroupIds.length > 1) return null;
  const chromeGroup = chrome.tabGroups.get
    ? await chrome.tabGroups.get(groupId).catch(() => null)
    : null;
  const snapshotGroups = state.spaceSnapshots?.[spaceId]?.groups || [];
  let snapshotGroupId = peerSnapshotGroupIds[0] || '';
  // A side-panel checkpoint can commit the binding before the matching native
  // groupId event reaches this worker. Rollback can also restore an exact
  // tab/group binding whose historical Tag is intentionally absent from the
  // current snapshot. In both cases the binding describes this exact live
  // entity, so retain its stable identity instead of inventing a second Tag.
  if (
    !snapshotGroupId &&
    Number(binding.groupId) === groupId &&
    String(binding.spaceId || '') === spaceId &&
    String(binding.snapshotGroupId || '').trim()
  ) {
    snapshotGroupId = binding.snapshotGroupId;
  }
  if (!snapshotGroupId && chromeGroup) {
    const matches = snapshotGroups.filter((group) => (
      lifecycleChromeGroupTitle(group, 'Tabs') === lifecyclePhysicalGroupTitle(chromeGroup, 'Tabs') &&
      String(group.color || 'blue') === String(chromeGroup.color || 'blue')
    ));
    if (matches.length > 1) return null;
    snapshotGroupId = matches[0]?.snapshotGroupId || '';
  }
  if (!snapshotGroupId) snapshotGroupId = `group:${event.eventId}`;
  const snapshotGroup = snapshotGroups.find((group) => group.snapshotGroupId === snapshotGroupId);
  return {
    spaceId,
    snapshotGroupId,
    title: lifecycleGroupTitle(snapshotGroup, chromeGroup, 'Tabs'),
    color: snapshotGroup?.color || chromeGroup?.color || 'blue',
    collapsed: Boolean(snapshotGroup?.collapsed ?? chromeGroup?.collapsed),
  };
}

function lifecycleChromeGroupTitle(group, fallback) {
  if (!Object.hasOwn(group, 'title')) return chromeGroupTitle(fallback);
  const title = String(group.title);
  return title === '' ? '' : chromeGroupTitle(title, fallback);
}

function lifecyclePhysicalGroupTitle(group, fallback) {
  if (!Object.hasOwn(group, 'title')) return fallback;
  return String(group.title ?? '');
}

function lifecycleGroupTitle(snapshotGroup, chromeGroup, fallback) {
  if (snapshotGroup && Object.hasOwn(snapshotGroup, 'title')) return String(snapshotGroup.title);
  if (chromeGroup && Object.hasOwn(chromeGroup, 'title')) return String(chromeGroup.title ?? '');
  return fallback;
}

async function lifecyclePhysicalGroupBindings(state, event, groupId) {
  const windowId = lifecycleEventWindowId(event);
  if (windowId === null) return [];
  const windowTabs = await chrome.tabs.query({ windowId }).catch(() => null);
  if (!windowTabs) return null;
  return windowTabs
    .filter((tab) => Number(tab.groupId) === groupId)
    .map((tab) => state.tabLifecycle?.[Number(tab.id)])
    .filter(Boolean);
}

function lifecycleKnownSpaceId(state, value) {
  const spaceId = String(value || '').trim();
  const knownSpaceIds = new Set(state.spaces.map((space) => String(space?.id || '')).filter(Boolean));
  return spaceId && (knownSpaceIds.size === 0 || knownSpaceIds.has(spaceId)) ? spaceId : '';
}

async function enrichMovedLifecycleEvent(state, event) {
  const tabId = Number(event.tabId);
  const binding = state.tabLifecycle?.[tabId];
  if (!binding) return event;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return event;
  const windowTabs = await chrome.tabs.query({ windowId: tab.windowId }).catch(() => []);
  const groupId = Number(tab.groupId);
  const spaceId = String(
    (Number.isSafeInteger(groupId) && groupId >= 0 ? state.groupSpaces?.[groupId] : '') ||
    binding.spaceId ||
    ''
  );
  const orderedTabIds = windowTabs
    .filter((candidate) => (
      Number.isSafeInteger(groupId) && groupId >= 0
        ? Number(candidate.groupId) === groupId
        : Number(candidate.groupId) < 0 && state.tabSpaces?.[candidate.id] === spaceId
    ))
    .sort((left, right) => Number(left.index) - Number(right.index))
    .map((candidate) => candidate.id);
  return {
    ...event,
    windowId: tab.windowId,
    orderedTabIds,
    spaceId,
    groupKey: Number.isSafeInteger(groupId) && groupId >= 0 ? `group:${groupId}` : 'ungrouped',
  };
}

function uniqueNonEmptyStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

async function groupTabs(tabIds, title = 'Tabs', color = 'blue', collapsed = false) {
  const ids = normalizedRequestedTabIds(tabIds);
  const tabs = await existingTabs(ids);
  if (ids.length === 0 || tabs.length !== ids.length) return { groupId: null, missing: true };
  const windowIds = new Set(tabs.map((tab) => normalizePanelWindowId(tab.windowId)));
  if (windowIds.size !== 1 || windowIds.has(null)) {
    throw new Error('Selected tabs must be in the same Chrome window.');
  }
  const [windowId] = windowIds;
  try {
    const groupId = await chrome.tabs.group({
      tabIds: ids,
      createProperties: { windowId },
    });
    const groupTitle = String(title ?? '');
    await chrome.tabGroups.update(groupId, {
      title: groupTitle === '' ? '' : chromeGroupTitle(groupTitle),
      color,
      collapsed: Boolean(collapsed),
    });
    return { groupId };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { groupId: null, missing: true };
    throw error;
  }
}

async function addTabsToGroup(groupId, tabIds) {
  const ids = normalizedRequestedTabIds(tabIds);
  const targetGroupId = Number(groupId);
  if (!Number.isFinite(targetGroupId)) return { groupId: null, missing: false };
  const tabs = await existingTabs(ids);
  if (ids.length === 0 || tabs.length !== ids.length) return { groupId: null, missing: true };
  // Re-submitting every member of an existing group is not a harmless no-op in
  // Chrome: it can replace the physical group id. That breaks the stable saved
  // Tag identity and can reduce a long logical title to Chrome's compact title.
  // Only move tabs whose authoritative browser membership actually differs.
  const movingIds = tabs
    .filter((tab) => Number(tab.groupId) !== targetGroupId)
    .map((tab) => Number(tab.id));
  if (movingIds.length === 0) return { groupId: targetGroupId };
  try {
    const nextGroupId = await chrome.tabs.group({ groupId: targetGroupId, tabIds: movingIds });
    return { groupId: nextGroupId };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { groupId: null, missing: true };
    throw error;
  }
}

async function moveTab(tabId, index, windowId) {
  const moveProperties = { index: normalizeTabMoveIndex(index) };
  const targetWindowId = normalizePanelWindowId(windowId);
  if (targetWindowId !== null) moveProperties.windowId = targetWindowId;
  for (let attempt = 1; attempt <= TAB_MOVE_ATTEMPTS; attempt += 1) {
    try {
      await chrome.tabs.move(Number(tabId), moveProperties);
      return {};
    } catch (error) {
      if (isMissingChromeEntityError(error)) return { missing: true };
      if (attempt < TAB_MOVE_ATTEMPTS && isTabMoveTemporarilyBlocked(error)) {
        await new Promise((resolve) => setTimeout(resolve, TAB_MOVE_RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
  return {};
}

async function moveTabRelative(tabId, anchorTabId, edge, expectedGroupId) {
  const sourceId = Number(tabId);
  const anchorId = Number(anchorTabId);
  const expectedGroup = Number(expectedGroupId);
  if (!Number.isSafeInteger(sourceId) || sourceId < 0 ||
      !Number.isSafeInteger(anchorId) || anchorId < 0) {
    throw new Error('A live source tab and anchor tab are required for this move.');
  }
  if (sourceId === anchorId) return {};
  if (!['before', 'after'].includes(edge)) {
    throw new Error('A tab move must be before or after its anchor.');
  }
  if (!Number.isInteger(expectedGroup) || expectedGroup < -1) {
    throw new Error('A valid target tab group is required for this move.');
  }

  for (let attempt = 1; attempt <= TAB_MOVE_ATTEMPTS; attempt += 1) {
    let stage = 'reading source and anchor tabs';
    try {
      const [source, anchor] = await Promise.all([
        chrome.tabs.get(sourceId),
        chrome.tabs.get(anchorId),
      ]);
      if (Number(source.windowId) !== Number(anchor.windowId)) {
        throw new Error('The source tab and target tab must be in the same Chrome window.');
      }
      if (Number(source.groupId) !== expectedGroup || Number(anchor.groupId) !== expectedGroup) {
        throw new Error('The target tab group changed while moving this tab.');
      }
      const index = edge === 'before'
        ? moveIndexBeforeTab(source.index, anchor.index)
        : moveIndexAfterTabs(source.index, [anchor.index]);
      if (index === null) throw new Error('Chrome returned an invalid tab position.');
      stage = 'moving the source tab';
      if (index !== Number(source.index)) await chrome.tabs.move(sourceId, { index });

      stage = 'verifying the moved tab';
      const [moved, currentAnchor] = await Promise.all([
        chrome.tabs.get(sourceId),
        chrome.tabs.get(anchorId),
      ]);
      const placed = edge === 'before'
        ? Number(moved.index) + 1 === Number(currentAnchor.index)
        : Number(moved.index) === Number(currentAnchor.index) + 1;
      if (!placed || Number(moved.groupId) !== expectedGroup) {
        throw new Error('Chrome did not place the tab at the requested position.');
      }
      return {};
    } catch (error) {
      if (isMissingChromeEntityError(error)) {
        return {
          missing: true,
          missingStage: stage,
          missingMessage: error?.message || String(error),
        };
      }
      if (attempt < TAB_MOVE_ATTEMPTS && isTabMoveTemporarilyBlocked(error)) {
        await new Promise((resolve) => setTimeout(resolve, TAB_MOVE_RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
  return {};
}

async function ungroupTabs(tabIds) {
  const ids = [...new Set((Array.isArray(tabIds) ? tabIds : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id >= 0))];
  let currentTabs = await existingTabs(ids);
  if (!ids.length || currentTabs.length !== ids.length) return { missing: true };

  for (let attempt = 1; attempt <= TAB_MOVE_ATTEMPTS; attempt += 1) {
    const groupedIds = currentTabs
      .filter((tab) => Number(tab.groupId) >= 0)
      .map((tab) => Number(tab.id));
    if (groupedIds.length === 0) return {};
    try {
      await chrome.tabs.ungroup(groupedIds);
    } catch (error) {
      if (isMissingChromeEntityError(error)) return { missing: true };
      if (attempt < TAB_MOVE_ATTEMPTS && isTabMoveTemporarilyBlocked(error)) {
        await new Promise((resolve) => setTimeout(resolve, TAB_MOVE_RETRY_DELAY_MS));
        currentTabs = await existingTabs(ids);
        if (currentTabs.length !== ids.length) return { missing: true };
        continue;
      }
      throw error;
    }

    currentTabs = await existingTabs(ids);
    if (currentTabs.length !== ids.length) return { missing: true };
    if (currentTabs.every((tab) => Number(tab.groupId) === -1)) return {};
    if (attempt < TAB_MOVE_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, TAB_MOVE_RETRY_DELAY_MS));
    }
  }
  throw new Error('Chrome did not ungroup every selected tab. No Space change was saved.');
}

async function updateGroup(groupId, update = {}) {
  const safeUpdate = {};
  if ('title' in update) {
    const title = String(update.title ?? '');
    safeUpdate.title = title === '' ? '' : chromeGroupTitle(title, 'Group');
  }
  if ('color' in update) safeUpdate.color = update.color;
  if ('collapsed' in update) safeUpdate.collapsed = Boolean(update.collapsed);
  try {
    const group = await chrome.tabGroups.update(Number(groupId), safeUpdate);
    return { group: serializeGroup(group) };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { group: null, missing: true };
    throw error;
  }
}

async function moveGroup(groupId, index) {
  try {
    await chrome.tabGroups.move(Number(groupId), { index: Math.max(0, Number(index) || 0) });
    return {};
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { missing: true };
    throw error;
  }
}

async function existingTabs(tabIds = []) {
  const ids = normalizedRequestedTabIds(tabIds);
  const existing = [];
  for (const id of ids) {
    try {
      existing.push(await chrome.tabs.get(id));
    } catch (error) {
      if (!isMissingChromeEntityError(error)) throw error;
    }
  }
  return existing;
}

function normalizedRequestedTabIds(tabIds = []) {
  return [...new Set((Array.isArray(tabIds) ? tabIds : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id >= 0))];
}

function isMissingChromeEntityError(error) {
  return /No (tab|group) with id/i.test(error?.message || String(error));
}

function normalizeTabMoveIndex(value) {
  if (value === null || value === undefined || value === '') {
    throw new Error('A valid tab move index is required.');
  }
  const index = Number(value);
  if (!Number.isInteger(index) || index < -1) {
    throw new Error('A valid tab move index is required.');
  }
  return index;
}

function isTabMoveTemporarilyBlocked(error) {
  return /Tabs cannot be edited right now.*user may be dragging a tab/i.test(
    error?.message || String(error),
  );
}

async function extractPages(tabIds = [], options = {}) {
  const ids = [...new Set((tabIds || []).map(Number).filter(Number.isFinite))].slice(0, 24);
  const maxCharsPerPage = clampInteger(options?.maxCharsPerPage, 1000, 20000, 12000);
  const maxTotalChars = clampInteger(options?.maxTotalChars, maxCharsPerPage, 120000, 60000);
  const pages = [];
  const failures = [];
  let remainingChars = maxTotalChars;

  for (const tabId of ids) {
    if (remainingChars <= 0) {
      failures.push({
        tabId,
        reason: 'content-limit',
        error: 'Not sent because the Ask Page content limit was reached.',
      });
      continue;
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!/^https?:/.test(tabUrl(tab))) throw new Error('Only an http(s) current page can be read by Ask Page.');
      const limit = Math.min(maxCharsPerPage, remainingChars);
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        args: [limit],
        func: extractCurrentPage,
      });
      const page = result?.result || {
        title: tab.title,
        url: tabUrl(tab),
        text: '',
        charCount: 0,
        originalCharCount: 0,
        truncated: false,
      };
      pages.push({ ...page, tabId });
      remainingChars -= Number(page.charCount) || String(page.text || '').length;
    } catch (error) {
      failures.push({ tabId, reason: 'read-failed', error: error?.message || String(error) });
    }
  }

  return {
    pages,
    failures,
    totalChars: pages.reduce((sum, page) => sum + (Number(page.charCount) || String(page.text || '').length), 0),
    truncated: pages.some((page) => page.truncated) || pages.length < ids.length - failures.length,
  };
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

async function runChatCompletion(
  settings,
  messages,
  requestId = '',
  stream = false,
  purpose = '',
  itemCount,
  askStream,
) {
  outputTokenBudgetForPurpose(purpose, itemCount);
  if (providerRequiresApiKey(settings) && !settings?.apiKey) {
    throw new Error('AI API key is missing. Add it in Settings.');
  }
  const hasAskStream = askStream !== undefined && askStream !== null;
  const binding = hasAskStream ? normalizeAskStreamBinding(askStream) : null;
  if (hasAskStream && (!binding || purpose !== 'ask-page' || stream !== true)) {
    throw new Error('Ask stream persistence requires a valid streaming Ask Page message.');
  }
  const safeRequestId = requestId || binding?.requestId || crypto.randomUUID();
  if (binding && binding.requestId !== safeRequestId) {
    throw new Error('Ask stream persistence does not match this AI request.');
  }
  const controller = new AbortController();
  activeAIRequests.set(safeRequestId, controller);
  let persistence = null;
  let terminalPersisted = false;
  try {
    persistence = binding ? await beginAskStreamPersistence(binding) : null;
    let payload;
    try {
      if (controller.signal.aborted) {
        const stopped = new Error('AI request was stopped.');
        stopped.name = 'AbortError';
        throw stopped;
      }
      payload = await fetchChatCompletion(settings, messages, purpose, itemCount, controller.signal, stream
        ? async (text) => {
          await notifyAIStream(safeRequestId, text);
          await persistence?.checkpoint(text);
        }
        : null);
    } catch (error) {
      const stopped = error?.name === 'AbortError';
      if (!persistence) {
        throw stopped ? new Error('AI request was stopped.') : error;
      }
      const errorMessage = stopped
        ? 'AI request was stopped.'
        : String(error?.message || error);
      await persistence.finalize({
        status: stopped ? 'stopped' : 'failed',
        text: persistence.text,
        error: errorMessage,
      });
      terminalPersisted = true;
      return {
        text: persistence.text,
        usage: null,
        finishReason: null,
        askPersisted: true,
        askStatus: stopped ? 'stopped' : 'failed',
        askError: errorMessage,
      };
    }

    const response = {
      text: extractAssistantText(payload),
      usage: payload.usage || null,
      finishReason: extractFinishReason(payload),
    };
    if (persistence) {
      await persistence.finalize({
        status: 'complete',
        text: response.text,
        finishReason: response.finishReason,
      });
      terminalPersisted = true;
      response.askPersisted = true;
      response.askStatus = 'complete';
    }
    return response;
  } finally {
    activeAIRequests.delete(safeRequestId);
    if (binding) {
      if (terminalPersisted) await clearAskStreamRecoveryAlarm(binding.requestId);
      else scheduleAskStreamRecoveryAlarm(binding.requestId);
    }
  }
}

function notifyAIStream(requestId, text) {
  return chrome.runtime.sendMessage({ type: 'ai:stream', requestId, text }).catch(() => null);
}

async function abortChatCompletion(requestId = '') {
  if (!requestId) {
    for (const controller of activeAIRequests.values()) controller.abort();
    return { aborted: true };
  }
  const controller = activeAIRequests.get(requestId);
  if (!controller) return { aborted: false };
  controller.abort();
  return { aborted: true };
}

async function beginAskStreamPersistence(binding) {
  await persistAskStreamMutation(binding, (sessions) => (
    claimAskStream(sessions, binding, ASK_STREAM_WORKER_ID)
  ));
  scheduleAskStreamRecoveryAlarm(binding.requestId);
  let latestText = '';
  let lastCheckpointAt = null;

  return {
    get text() {
      return latestText;
    },
    async checkpoint(text) {
      latestText = String(text);
      const now = Date.now();
      if (
        lastCheckpointAt !== null &&
        now - lastCheckpointAt < ASK_STREAM_CHECKPOINT_INTERVAL_MS
      ) return;
      lastCheckpointAt = now;
      await persistAskStreamMutation(binding, (sessions) => (
        checkpointAskStream(sessions, binding, latestText, now)
      )).catch(() => null);
    },
    finalize(outcome) {
      return persistAskStreamMutation(binding, (sessions) => (
        finalizeAskStream(sessions, binding, outcome)
      ));
    },
  };
}

async function beginAskStreamTurn(value = {}) {
  const sessionKey = String(value.sessionKey || '');
  const requestId = String(value.requestId || '').trim();
  if (!requestId || requestId.length > 512) {
    throw new Error('Ask stream persistence requires a valid request id.');
  }

  const binding = await withLifecycleStateLock(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const workspace = mergeStoredState(stored[STORAGE_KEY], createDefaultState());
    const latestSession = materializeAskSessionForTurn(
      workspace.askSessions,
      value.sourceTab,
      value.projectedSession,
    );
    if (latestSession.key !== sessionKey) {
      throw new Error('The prepared Ask conversation no longer matches the current page. Nothing was sent; try again.');
    }
    if (askSessionRevision(latestSession) !== String(value.preparedSessionRevision || '')) {
      throw new Error('The Ask conversation changed before it could be sent. Nothing was sent; try again.');
    }

    appendAskSessionMessage(latestSession, 'user', String(value.prompt || ''));
    const assistant = appendAskSessionMessage(latestSession, 'assistant', 'Thinking...');
    markAskStreamPending(assistant, requestId);
    const durableBinding = {
      sessionKey: latestSession.key,
      messageId: assistant.id,
      requestId,
    };
    const pruneOptions = value.pruneOptions || {};
    workspace.askSessions = pruneAskSessions(workspace.askSessions, {
      ...pruneOptions,
      activeKey: latestSession.key,
      inFlightKeys: [latestSession.key, ...(pruneOptions.inFlightKeys || [])],
    });
    workspace.activeAskSessionKey = latestSession.key;
    workspace.ai = { ...workspace.ai, apiKey: '' };
    delete workspace.ai.maxTokens;
    await chrome.storage.local.set({ [STORAGE_KEY]: workspace });
    return durableBinding;
  });

  try {
    await scheduleAskStreamRecoveryAlarm(binding.requestId);
  } catch (error) {
    await persistAskStreamMutation(binding, (sessions) => (
      finalizeAskStream(sessions, binding, { status: 'interrupted', text: '' })
    ));
    await clearAskStreamRecoveryAlarm(binding.requestId);
    throw error;
  }
  return binding;
}

async function persistAskStreamMutation(binding, mutate) {
  return withLifecycleStateLock(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const workspace = mergeStoredState(stored[STORAGE_KEY], createDefaultState());
    const target = mutate(workspace.askSessions);
    if (!target) {
      throw new Error('The Ask conversation changed before its provider response could be saved.');
    }
    workspace.ai = { ...workspace.ai, apiKey: '' };
    delete workspace.ai.maxTokens;
    await chrome.storage.local.set({ [STORAGE_KEY]: workspace });
    return target;
  });
}

function askStreamRecoveryAlarmName(requestId) {
  return `${ASK_STREAM_RECOVERY_ALARM_PREFIX}${requestId}`;
}

function scheduleAskStreamRecoveryAlarm(requestId) {
  return chrome.alarms.create(askStreamRecoveryAlarmName(requestId), {
    delayInMinutes: ASK_STREAM_RECOVERY_DELAY_MINUTES,
  });
}

async function clearAskStreamRecoveryAlarm(requestId) {
  try {
    return await chrome.alarms.clear(askStreamRecoveryAlarmName(requestId));
  } catch {
    return false;
  }
}

async function handleAskStreamRecoveryAlarm(alarm) {
  const name = String(alarm.name);
  if (!name.startsWith(ASK_STREAM_RECOVERY_ALARM_PREFIX)) return;
  const requestId = name.slice(ASK_STREAM_RECOVERY_ALARM_PREFIX.length);
  if (!requestId) return;
  if (activeAIRequests.has(requestId)) {
    scheduleAskStreamRecoveryAlarm(requestId);
    return;
  }
  try {
    await recoverInterruptedAskStreams(requestId, {
      ownerId: '',
      pendingBefore: Number.POSITIVE_INFINITY,
    });
  } catch (error) {
    scheduleAskStreamRecoveryAlarm(requestId);
    throw error;
  }
  await clearAskStreamRecoveryAlarm(requestId);
}

async function recoverAskStreamsAtWorkerStart() {
  try {
    return await recoverInterruptedAskStreams('', {
      ownerId: ASK_STREAM_WORKER_ID,
      pendingBefore: Date.now() - ASK_STREAM_PENDING_RECOVERY_GRACE_MS,
    });
  } catch (error) {
    console.error('Space Tabs could not recover interrupted Ask streams:', error);
    return [];
  }
}

async function recoverInterruptedAskStreams(requestId, options = {}) {
  return withLifecycleStateLock(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const workspace = mergeStoredState(stored[STORAGE_KEY], createDefaultState());
    const interrupted = interruptOrphanedAskStreams(workspace.askSessions, {
      ownerId: options.ownerId,
      requestId,
      pendingBefore: options.pendingBefore,
    });
    if (interrupted.length === 0) return interrupted;
    workspace.ai = { ...workspace.ai, apiKey: '' };
    delete workspace.ai.maxTokens;
    await chrome.storage.local.set({ [STORAGE_KEY]: workspace });
    return interrupted;
  });
}

async function fetchChatCompletion(settings, messages, purpose, itemCount, signal, onStream = null) {
  const request = buildChatCompletionRequest(settings, messages, purpose, itemCount);
  if (onStream) request.body.stream = true;
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal,
  });

  if (!response.ok) {
    const rawBody = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { error: { message: rawBody } };
    }
    const providerError = payload?.error;
    const message = (typeof providerError === 'string' ? providerError : providerError?.message) ||
      payload?.message || rawBody || response.statusText || 'Request failed';
    const code = providerError?.code ?? payload?.code;
    const codeDetail = code === undefined || code === null || String(code).trim() === ''
      ? ''
      : `, code ${String(code).trim()}`;
    throw new Error(
      `AI provider rejected the request (HTTP ${response.status}${codeDetail}): ${String(message).trim()}`,
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!onStream || !contentType.includes('text/event-stream') || !response.body) {
    return response.json();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage = null;
  let finishReason = null;
  let streamDone = false;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const event = parseChatStreamEvent(line);
      if (!event) continue;
      if (event.done) {
        streamDone = true;
        break;
      }
      if (event.usage) usage = event.usage;
      if (event.finishReason) finishReason = event.finishReason;
      if (event.text) {
        text += event.text;
        await onStream(text);
      }
    }
    if (streamDone) {
      await reader.cancel().catch(() => null);
      break;
    }
    if (done) break;
  }
  const finalEvent = streamDone ? null : parseChatStreamEvent(buffer);
  if (finalEvent?.text) {
    text += finalEvent.text;
    await onStream(text);
  }
  if (finalEvent?.usage) usage = finalEvent.usage;
  if (finalEvent?.finishReason) finishReason = finalEvent.finishReason;
  return {
    choices: [{ message: { content: text }, finish_reason: finishReason }],
    usage,
  };
}
