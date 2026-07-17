import { isChromeNewTabUrl } from './tab-utils.js';
import {
  comparableSnapshotUrl,
  sanitizeSpaceSnapshot,
  snapshotHasPersistentContent,
} from './space-snapshot.js';
import { tabCloseGuardMismatch } from './tab-close-transaction.js';

const SPACE_DELETION_INTENT_VERSION = 1;

/**
 * Captures the complete user-visible intent reviewed by a Space deletion.
 *
 * Live rows are removed from the saved snapshot projection because
 * snapshotOpenSpace() may persist those same rows during the deletion
 * checkpoint. This keeps the fingerprint stable across that bookkeeping while
 * still protecting every saved-only row, Context, Ask message, source Space,
 * fallback Space, and physical page that the confirmed action affects.
 */
export function spaceDeletionIntentFingerprint({
  state = {},
  deletingSpaceId = '',
  plan = {},
} = {}) {
  const source = objectCollection(state);
  const spaceId = String(deletingSpaceId || '');
  const spaces = Array.isArray(source.spaces) ? source.spaces : [];
  const deletingSpace = spaces.find((space) => String(space?.id || '') === spaceId) || null;
  const fallbackSpace = spaceDeletionFallback(spaces, spaceId);
  const liveTabs = normalizedDeletionIntentTabs(plan);
  const askSession = source.askSessions?.[`space:${spaceId}`];

  return `space-deletion-intent-v${SPACE_DELETION_INTENT_VERSION}:${JSON.stringify({
    deletingSpace: deletionSpaceIdentity(deletingSpace),
    fallbackSpace: deletionSpaceIdentity(fallbackSpace),
    liveTabs: liveTabs.map(({ sourceTab, ...tab }) => tab),
    savedOnlySnapshot: deletionSavedOnlySnapshot(
      source.spaceSnapshots?.[spaceId],
      liveTabs.map((tab) => tab.sourceTab),
    ),
    context: String(source.spaceContexts?.[spaceId] || ''),
    askSession: deletionAskSessionContent(askSession),
  })}`;
}

/**
 * Revalidates one reviewed Space-deletion target against a fresh Chrome
 * inventory. The result is deliberately data-only so both transaction tests
 * and UI callers can fail closed without coupling safety to an error string.
 */
export function spaceDeletionCloseCandidateMismatch({
  expectedTab,
  currentTabs = [],
  state = {},
  deletingSpaceId = '',
} = {}) {
  const expectedTabId = liveTabId(expectedTab?.id);
  if (expectedTabId === null) return 'missing-or-replaced';
  const candidates = (Array.isArray(currentTabs) ? currentTabs : [])
    .filter((tab) => liveTabId(tab?.id) === expectedTabId);
  if (candidates.length !== 1) return 'missing-or-replaced';

  const currentTab = candidates[0];
  const physicalMismatch = tabCloseGuardMismatch(currentTab, {
    tabId: expectedTabId,
    requireUnpinned: true,
    windowId: expectedTab?.windowId,
    groupId: expectedTab?.groupId,
    url: String(expectedTab?.pendingUrl || expectedTab?.url || ''),
  });
  if (physicalMismatch) return physicalMismatch;

  const expectedStableId = String(expectedTab?.snapshotTabId || '');
  if (expectedStableId && String(currentTab?.snapshotTabId || '') !== expectedStableId) {
    return 'stable-identity-changed';
  }
  const expectedSessionId = String(expectedTab?.sessionId || '');
  if (expectedSessionId && String(currentTab?.sessionId || '') !== expectedSessionId) {
    return 'stable-identity-changed';
  }
  if (!liveTabBelongsToSpace(currentTab, state, deletingSpaceId)) return 'moved-space';
  return '';
}

/**
 * Captures every mutable owner involved in a Space deletion before either an
 * active-Space transition or an inactive-Space close checkpoint begins.
 */
export function createSpaceDeletionRollbackJournal({
  beforeState = {},
  deletingSpaceId = '',
  durableActiveSpaceId = '',
  windowSpaceState = {},
  activeView = 'space',
  deletingActiveSpace = false,
} = {}) {
  return {
    beforeState: structuredClone(beforeState || {}),
    deletingSpaceId: String(deletingSpaceId || ''),
    durableActiveSpaceId: String(durableActiveSpaceId || ''),
    windowSpaceState: structuredClone(windowSpaceState || {}),
    activeView: String(activeView || 'space'),
    deletingActiveSpace: Boolean(deletingActiveSpace),
    createdTabIds: [],
    checkpointState: null,
    closedTabIds: [],
  };
}

/**
 * Restores the pre-transition workspace while keeping the deleting Space's
 * latest durable close checkpoint as its recovery snapshot.
 */
export function projectSpaceDeletionRecoveryState({
  beforeState = {},
  checkpointState = null,
  deletingSpaceId = '',
} = {}) {
  const recovered = structuredClone(beforeState || {});
  const spaceId = String(deletingSpaceId || '');
  if (!spaceId || !checkpointState) return recovered;

  const checkpointSnapshots = checkpointState.spaceSnapshots;
  if (!checkpointSnapshots || !Object.hasOwn(checkpointSnapshots, spaceId)) {
    if (recovered.spaceSnapshots && typeof recovered.spaceSnapshots === 'object') {
      delete recovered.spaceSnapshots[spaceId];
    }
  } else if (!checkpointSnapshots[spaceId]) {
    if (recovered.spaceSnapshots && typeof recovered.spaceSnapshots === 'object') {
      delete recovered.spaceSnapshots[spaceId];
    }
  } else {
    if (!recovered.spaceSnapshots || typeof recovered.spaceSnapshots !== 'object') {
      recovered.spaceSnapshots = {};
    }
    recovered.spaceSnapshots[spaceId] = structuredClone(checkpointSnapshots[spaceId]);
  }

  if (
    checkpointState.tabLifecycle &&
    typeof checkpointState.tabLifecycle === 'object' &&
    !Array.isArray(checkpointState.tabLifecycle)
  ) {
    recovered.tabLifecycle = objectCollection(recovered.tabLifecycle);
    for (const [tabId, binding] of Object.entries(recovered.tabLifecycle)) {
      if (String(binding?.spaceId || '') === spaceId) delete recovered.tabLifecycle[tabId];
    }
    for (const [tabId, binding] of Object.entries(checkpointState.tabLifecycle)) {
      if (String(binding?.spaceId || '') === spaceId) {
        recovered.tabLifecycle[tabId] = structuredClone(binding);
      }
    }
  }
  return recovered;
}

/**
 * Projects the durable rollback before physical placeholder cleanup. The
 * visible Space comes from the pre-delete state, while retained placeholders
 * belong to the Space whose deletion was aborted. Those identities differ for
 * an inactive-Space deletion and must never be conflated.
 */
export function projectSpaceDeletionRollbackState({
  beforeState = {},
  checkpointState = null,
  deletingSpaceId = '',
  createdTabIds = [],
  closedTabIds = [],
} = {}) {
  const placeholderSpaceId = String(deletingSpaceId || '');
  const recovered = projectSpaceDeletionRecoveryState({
    beforeState,
    checkpointState,
    deletingSpaceId: placeholderSpaceId,
  });
  const restoreActiveSpaceId = String(
    recovered.activeSpaceId || placeholderSpaceId,
  );
  const retainAsEphemeral = snapshotHasPersistentContent(
    recovered.spaceSnapshots?.[placeholderSpaceId],
  );
  const projected = projectSpaceDeletionPlaceholderMetadata(recovered, {
    retainedTabIds: createdTabIds,
    restoreSpaceId: placeholderSpaceId,
    retainAsEphemeral,
  });
  // The close checkpoint is the authoritative recovery snapshot, but a
  // physical Chrome close cannot be rolled back. Do not resurrect its old
  // live ownership while restoring the saved rows that represent it.
  for (const tabId of uniqueTabIds(closedTabIds)) removeTabMetadata(projected, tabId);
  return {
    state: projected,
    restoreActiveSpaceId,
    placeholderSpaceId,
    retainAsEphemeral,
  };
}

/**
 * Plans cleanup from the tabs that are alive right now. A created tab is kept
 * whenever closing every created candidate would leave its window empty.
 */
export function planSpaceDeletionPlaceholderCleanup(tabs = [], createdTabIds = []) {
  const createdIds = uniqueTabIds(createdTabIds);
  const liveTabs = (Array.isArray(tabs) ? tabs : [])
    .map(normalizeLiveTab)
    .filter(Boolean);
  const liveTabsById = new Map(liveTabs.map((tab) => [tab.id, tab]));
  const liveCreatedTabs = createdIds
    .map((id) => liveTabsById.get(id))
    .filter(Boolean);
  const missingTabIds = createdIds.filter((id) => !liveTabsById.has(id));
  const candidatesByWindow = new Map();
  const retainLiveTabIds = liveCreatedTabs
    .filter((tab) => !tab.cleanupSafe)
    .map((tab) => tab.id);
  const retainTabIds = [...retainLiveTabIds];

  for (const tab of liveCreatedTabs.filter((candidate) => candidate.cleanupSafe)) {
    if (tab.windowId === null) {
      retainTabIds.push(tab.id);
      continue;
    }
    if (!candidatesByWindow.has(tab.windowId)) candidatesByWindow.set(tab.windowId, []);
    candidatesByWindow.get(tab.windowId).push(tab);
  }

  const closeTabIds = [];
  for (const [windowId, candidates] of candidatesByWindow) {
    const candidateIds = new Set(candidates.map((tab) => tab.id));
    const hasOtherSurvivor = liveTabs.some((tab) => (
      tab.windowId === windowId && !candidateIds.has(tab.id)
    ));
    if (hasOtherSurvivor) {
      closeTabIds.push(...candidates.map((tab) => tab.id));
      continue;
    }

    const keep = candidates.find((tab) => tab.active) || candidates.at(-1);
    retainTabIds.push(keep.id);
    closeTabIds.push(...candidates
      .filter((tab) => tab.id !== keep.id)
      .map((tab) => tab.id));
  }

  return { closeTabIds, retainTabIds, retainLiveTabIds, missingTabIds };
}

/**
 * Finds windows whose current deletion targets are every live tab in that
 * window. The caller must create or identify a non-target keepalive before any
 * of those targets can be closed safely.
 */
export function planSpaceDeletionWindowKeepalives(tabs = [], closingTabIds = []) {
  const closingIds = new Set(uniqueTabIds(closingTabIds));
  const liveTabs = (Array.isArray(tabs) ? tabs : [])
    .map(normalizeLiveTab)
    .filter(Boolean);
  const affectedWindowIds = new Set(liveTabs
    .filter((tab) => closingIds.has(tab.id) && tab.windowId !== null)
    .map((tab) => tab.windowId));

  return [...affectedWindowIds].filter((windowId) => !liveTabs.some((tab) => (
    tab.windowId === windowId && !closingIds.has(tab.id)
  )));
}

/**
 * Removes metadata for tabs that are gone and reassigns every surviving
 * keepalive to the Space whose deletion was aborted.
 */
export function projectSpaceDeletionPlaceholderMetadata(state = {}, {
  removedTabIds = [],
  retainedTabIds = [],
  liveRetainedTabIds = [],
  restoreSpaceId = '',
  retainAsEphemeral = false,
} = {}) {
  const projected = structuredClone(state || {});
  const removedIds = uniqueTabIds(removedTabIds);
  const retainedIds = uniqueTabIds(retainedTabIds);
  const liveRetainedIds = new Set(uniqueTabIds(liveRetainedTabIds));
  const affectedIds = new Set([...removedIds, ...retainedIds]);

  projected.tabSpaces = objectCollection(projected.tabSpaces);
  projected.tabGroups = objectCollection(projected.tabGroups);
  projected.renamedTabs = objectCollection(projected.renamedTabs);
  projected.tabLifecycle = objectCollection(projected.tabLifecycle);
  projected.ephemeralTabIds = (Array.isArray(projected.ephemeralTabIds)
    ? projected.ephemeralTabIds
    : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && !affectedIds.has(id));

  for (const tabId of removedIds) removeTabMetadata(projected, tabId);

  const spaceId = String(restoreSpaceId || '');
  for (const tabId of retainedIds) {
    delete projected.tabGroups[tabId];
    delete projected.renamedTabs[tabId];
    removeTabFromSavedOrder(projected.tabOrder, tabId);
    if (retainAsEphemeral && !liveRetainedIds.has(tabId)) {
      delete projected.tabSpaces[tabId];
      delete projected.tabLifecycle[tabId];
      projected.ephemeralTabIds.push(tabId);
      continue;
    }
    if (spaceId) projected.tabSpaces[tabId] = spaceId;
    else delete projected.tabSpaces[tabId];
    if (projected.tabLifecycle[tabId] && typeof projected.tabLifecycle[tabId] === 'object') {
      projected.tabLifecycle[tabId] = {
        ...projected.tabLifecycle[tabId],
        spaceId,
        groupId: -1,
        trackingMode: 'live',
      };
    }
  }

  return projected;
}

/**
 * Runs rollback effects in their safety-critical order while retaining every
 * failure. Physical cleanup is skipped unless the recovered workspace was
 * durable first; the UI refresh is always attempted.
 */
export async function collectSpaceDeletionRollbackFailures({
  saveRecovery,
  cleanup,
  saveCleanup,
  refresh,
} = {}) {
  const failures = [];
  let recoverySaved = false;
  try {
    await saveRecovery?.();
    recoverySaved = true;
  } catch (error) {
    failures.push({
      stage: 'saving the restored workspace before placeholder cleanup',
      error,
    });
  }

  if (recoverySaved) {
    try {
      const cleanupFailures = await cleanup?.();
      if (Array.isArray(cleanupFailures)) failures.push(...cleanupFailures);
    } catch (error) {
      failures.push({ stage: 'cleaning up aborted deletion placeholders', error });
    }
    try {
      await saveCleanup?.();
    } catch (error) {
      failures.push({ stage: 'saving aborted deletion placeholder cleanup', error });
    }
  }

  try {
    await refresh?.();
  } catch (error) {
    failures.push({ stage: 'refreshing the restored workspace and saved tabs', error });
  }
  return failures;
}

export function createCommittedSpaceDeletionError(spaceName, cause) {
  const name = String(spaceName || '').trim() || 'the Space';
  const detail = cause?.message || String(cause || 'the post-delete refresh failed');
  const error = new Error(
    `Deleted ${name}, but the remaining Space could not finish opening or refreshing. ` +
    `The deletion is saved; the next normal panel refresh will reconcile the view. Details: ${detail}`,
    { cause },
  );
  error.spaceDeletionCommitted = true;
  return error;
}

function normalizedDeletionIntentTabs(plan = {}) {
  return [
    ...(Array.isArray(plan?.closingTabs) ? plan.closingTabs : [])
      .map((tab) => ({ tab, pinned: false })),
    ...(Array.isArray(plan?.preservedPinnedTabs) ? plan.preservedPinnedTabs : [])
      .map((tab) => ({ tab, pinned: true })),
  ]
    .map(({ tab, pinned }) => {
      const id = liveTabId(tab?.id);
      if (id === null) return null;
      return {
        id,
        pinned,
        windowId: liveTabId(tab?.windowId),
        groupId: Number.isSafeInteger(Number(tab?.groupId)) ? Number(tab.groupId) : null,
        url: String(tab?.pendingUrl || tab?.url || '').trim(),
        sourceTab: tab,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id - right.id || Number(left.pinned) - Number(right.pinned));
}

function deletionSavedOnlySnapshot(snapshot, liveTabs = []) {
  if (!snapshot || !Array.isArray(snapshot.groups)) return null;
  const sanitized = sanitizeSpaceSnapshot(snapshot, { preserveDuplicateUrls: true });

  const rows = sanitized.groups.flatMap((group, groupIndex) => (
    group.tabs.map((tab, tabIndex) => ({
      groupIndex,
      tabIndex,
      tab,
      matchedLive: false,
    }))
  ));
  const targets = liveTabs.map((tab) => ({
    snapshotTabId: String(tab?.snapshotTabId || ''),
    snapshotGroupId: String(tab?.snapshotGroupId || ''),
    url: String(tab?.pendingUrl || tab?.url || '').trim(),
    matchedSnapshot: false,
  }));

  for (const target of targets) {
    if (!target.snapshotTabId) continue;
    const row = preferredSavedRow(rows, target, (candidate) => (
      String(candidate.tab?.snapshotTabId || '') === target.snapshotTabId
    ));
    if (!row) continue;
    row.matchedLive = true;
    target.matchedSnapshot = true;
  }
  for (const target of targets) {
    if (target.matchedSnapshot || !target.url) continue;
    const row = preferredSavedRow(rows, target, (candidate) => (
      String(candidate.tab.url).trim() === target.url
    ));
    if (!row) continue;
    row.matchedLive = true;
    target.matchedSnapshot = true;
  }
  for (const target of targets) {
    if (target.matchedSnapshot) continue;
    const comparableUrl = comparableSnapshotUrl(target.url);
    if (!comparableUrl) continue;
    const row = preferredSavedRow(rows, target, (candidate) => (
      comparableSnapshotUrl(candidate.tab?.url) === comparableUrl
    ));
    if (row) row.matchedLive = true;
  }

  const groups = sanitized.groups.flatMap((group, groupIndex) => {
    const savedTabs = rows
      .filter((row) => row.groupIndex === groupIndex && !row.matchedLive)
      .sort((left, right) => left.tabIndex - right.tabIndex)
      .map((row) => deletionSavedTabContent(row.tab));
    if (savedTabs.length === 0) return [];
    return [{
      title: String(group.title || ''),
      color: String(group.color),
      restorable: Boolean(group.restorable),
      tabs: savedTabs,
    }];
  });
  return groups.length > 0 ? { groups } : null;
}

function preferredSavedRow(rows, target, predicate) {
  const available = rows.filter((row) => !row.matchedLive && predicate(row));
  if (!target.snapshotGroupId) return available[0] || null;
  return available.find((row) => (
    String(row.tab?.snapshotGroupId || '') === target.snapshotGroupId
  )) || available[0] || null;
}

function deletionSavedTabContent(tab = {}) {
  const panelTitle = String(tab.panelTitle || '').trim();
  return {
    title: String(tab.title),
    url: String(tab.url).trim(),
    ...(panelTitle ? { panelTitle } : {}),
  };
}

function deletionAskSessionContent(session) {
  if (!session || !Array.isArray(session.messages)) return null;
  const messages = session.messages
    .map((message) => ({
      role: message?.role === 'user' ? 'user' : 'assistant',
      text: String(message?.text || ''),
    }))
    .filter((message) => message.text);
  if (messages.length === 0) return null;
  return {
    title: String(session.title || ''),
    url: String(session.url || ''),
    messages,
  };
}

function spaceDeletionFallback(spaces = [], deletingSpaceId = '') {
  const remaining = spaces.filter((space) => (
    space?.id && String(space.id) !== deletingSpaceId
  ));
  return remaining.find((space) => String(space.id) === 'default') || remaining[0] || null;
}

function deletionSpaceIdentity(space) {
  if (!space) return null;
  return {
    id: String(space.id || ''),
    name: String(space.name || ''),
    icon: String(space.icon || ''),
    color: String(space.color || ''),
  };
}

function normalizeLiveTab(tab) {
  const id = liveTabId(tab?.id);
  if (id === null) return null;
  const rawWindowId = Number(tab?.windowId);
  return {
    id,
    windowId: Number.isSafeInteger(rawWindowId) && rawWindowId >= 0 ? rawWindowId : null,
    active: tab?.active === true,
    cleanupSafe: !Boolean(tab?.pinned) && isChromeNewTabUrl(tab?.pendingUrl || tab?.url),
  };
}

function liveTabBelongsToSpace(tab, state, spaceId) {
  const expectedSpaceId = String(spaceId || '');
  if (!expectedSpaceId) return false;
  const groupId = Number(tab?.groupId);
  if (Number.isSafeInteger(groupId) && groupId >= 0) {
    return String(state?.groupSpaces?.[groupId] || '') === expectedSpaceId;
  }
  return String(state?.tabSpaces?.[tab?.id] || '') === expectedSpaceId;
}

function liveTabId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

function uniqueTabIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id >= 0))];
}

function objectCollection(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function removeTabMetadata(state, tabId) {
  delete state.tabSpaces[tabId];
  delete state.tabGroups[tabId];
  delete state.renamedTabs[tabId];
  delete state.tabLifecycle[tabId];
  state.ephemeralTabIds = state.ephemeralTabIds.filter((id) => Number(id) !== tabId);
  removeTabFromSavedOrder(state.tabOrder, tabId);
}

function removeTabFromSavedOrder(tabOrder, tabId) {
  if (!tabOrder || typeof tabOrder !== 'object') return;
  for (const groupOrders of Object.values(tabOrder)) {
    if (!groupOrders || typeof groupOrders !== 'object') continue;
    for (const [groupKey, ids] of Object.entries(groupOrders)) {
      if (!Array.isArray(ids)) continue;
      groupOrders[groupKey] = ids.filter((id) => Number(id) !== tabId);
    }
  }
}
