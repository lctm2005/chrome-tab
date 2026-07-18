import {
  chromeGroupTitleKey,
  groupTitleKey,
  legacyChromeGroupTitleKey,
} from './group-title.js';
import {
  comparableSnapshotUrl,
  snapshotTabIdentitiesConflict,
} from './space-snapshot.js';
import { reduceTabLifecycleEvent } from './tab-lifecycle.js';

export function adoptUnassignedEntities(state, tabs = [], groups = [], activeSpaceId, options = {}) {
  cleanupMissingEntities(state, tabs, groups, options);

  if (options.adoptGroups === true) {
    for (const group of groups) {
      if (state.groupSpaces[group.id] === undefined) {
        state.groupSpaces[group.id] = activeSpaceId;
      }
    }
  }

  const activeGroupedTab = tabs.find((tab) => (
    isGroupedTab(tab) &&
    tab.active &&
    state.groupSpaces[tab.groupId] === undefined
  ));
  if (activeGroupedTab && activeSpaceId) {
    state.groupSpaces[activeGroupedTab.groupId] = activeSpaceId;
    rememberGroupOrderKey(state, activeSpaceId, `group:${activeGroupedTab.groupId}`);
  }

  for (const tab of tabs) {
    if (isGroupedTab(tab)) {
      if (state.groupSpaces[tab.groupId] === undefined && state.tabSpaces[tab.id] !== undefined) {
        state.groupSpaces[tab.groupId] = state.tabSpaces[tab.id];
        rememberGroupOrderKey(state, state.tabSpaces[tab.id], `group:${tab.groupId}`);
      }
      delete state.tabSpaces[tab.id];
      continue;
    }
    if (state.tabSpaces[tab.id] === undefined) {
      state.tabSpaces[tab.id] = activeSpaceId;
    }
  }

  cleanupMissingEntities(state, tabs, groups, options);
}

export function captureLiveSpaceOwnership(state = {}, tabs = [], groups = []) {
  const liveTabs = Array.isArray(tabs) ? tabs : [];
  const liveGroups = Array.isArray(groups) ? groups : [];
  const validSpaceIds = new Set((state.spaces || []).map((space) => String(space?.id || '')).filter(Boolean));
  const tabOwnership = liveTabs
    .filter((tab) => !isGroupedTab(tab))
    .flatMap((tab) => {
      const id = Number(tab?.id);
      const windowId = Number(tab?.windowId);
      const spaceId = String(state.tabSpaces?.[id] || '');
      if (!isChromeEntityId(id) || !Number.isSafeInteger(windowId) || !validSpaceIds.has(spaceId)) return [];
      return [{
        id,
        windowId,
        url: liveTabUrl(tab),
        spaceId,
      }];
    });
  const tabsByGroupId = new Map();
  for (const tab of liveTabs) {
    if (isGroupedTab(tab) && !tabsByGroupId.has(Number(tab.groupId))) {
      tabsByGroupId.set(Number(tab.groupId), tab);
    }
  }
  const groupsById = new Map(liveGroups.map((group) => [Number(group?.id), group]));
  const groupOwnership = Object.entries(state.groupSpaces || {}).flatMap(([value, owner]) => {
    const id = Number(value);
    const spaceId = String(owner || '');
    const group = groupsById.get(id);
    const windowId = Number(group?.windowId ?? tabsByGroupId.get(id)?.windowId);
    if (!isChromeEntityId(id) || !Number.isSafeInteger(windowId) || !validSpaceIds.has(spaceId)) return [];
    return [{ id, windowId, spaceId }];
  });
  const lifecycle = liveTabs.flatMap((tab) => {
    const id = Number(tab?.id);
    const windowId = Number(tab?.windowId);
    const binding = state.tabLifecycle?.[id];
    const spaceId = String(binding?.spaceId || '');
    if (
      !isChromeEntityId(id) ||
      !Number.isSafeInteger(windowId) ||
      !binding ||
      typeof binding !== 'object' ||
      !validSpaceIds.has(spaceId)
    ) return [];
    return [{
      id,
      windowId,
      url: liveTabUrl(tab),
      binding: { ...binding },
    }];
  });
  return { tabs: tabOwnership, groups: groupOwnership, lifecycle };
}

export function restoreLiveSpaceOwnership(
  state = {},
  tabs = [],
  groups = [],
  captured = {},
  fallbackSpaceForWindow = () => state.activeSpaceId,
) {
  const liveTabs = Array.isArray(tabs) ? tabs : [];
  const liveGroups = Array.isArray(groups) ? groups : [];
  const validSpaceIds = new Set((state.spaces || []).map((space) => String(space?.id || '')).filter(Boolean));
  const fallbackSpaceId = validSpaceIds.has(String(state.activeSpaceId || ''))
    ? String(state.activeSpaceId)
    : [...validSpaceIds][0] || '';
  const tabsById = new Map(liveTabs.map((tab) => [Number(tab?.id), tab]));
  const tabsByGroupId = new Map();
  for (const tab of liveTabs) {
    if (isGroupedTab(tab) && !tabsByGroupId.has(Number(tab.groupId))) {
      tabsByGroupId.set(Number(tab.groupId), tab);
    }
  }
  const groupsById = new Map(liveGroups.map((group) => [Number(group?.id), group]));
  state.groupSpaces = {};
  state.tabSpaces = {};
  state.tabLifecycle = {};
  if (!state.renamedTabs || typeof state.renamedTabs !== 'object') state.renamedTabs = {};

  let restoredGroups = 0;
  for (const record of Array.isArray(captured?.groups) ? captured.groups : []) {
    const id = Number(record?.id);
    const currentGroup = groupsById.get(id);
    const currentWindowId = Number(currentGroup?.windowId ?? tabsByGroupId.get(id)?.windowId);
    const spaceId = String(record?.spaceId || '');
    if (
      !isChromeEntityId(id) ||
      currentWindowId !== Number(record?.windowId) ||
      !validSpaceIds.has(spaceId)
    ) continue;
    state.groupSpaces[id] = spaceId;
    restoredGroups += 1;
  }

  let restoredTabs = 0;
  for (const record of Array.isArray(captured?.tabs) ? captured.tabs : []) {
    const id = Number(record?.id);
    const current = tabsById.get(id);
    const spaceId = String(record?.spaceId || '');
    if (
      !current ||
      isGroupedTab(current) ||
      Number(current.windowId) !== Number(record?.windowId) ||
      liveTabUrl(current) !== String(record?.url || '') ||
      !validSpaceIds.has(spaceId)
    ) continue;
    state.tabSpaces[id] = spaceId;
    restoredTabs += 1;
  }

  let restoredLifecycle = 0;
  for (const record of Array.isArray(captured?.lifecycle) ? captured.lifecycle : []) {
    const id = Number(record?.id);
    const current = tabsById.get(id);
    const binding = record?.binding;
    if (
      !current ||
      Number(current.windowId) !== Number(record?.windowId) ||
      liveTabUrl(current) !== String(record?.url || '') ||
      !lifecycleSnapshotIdentityExists(state, binding)
    ) continue;
    state.tabLifecycle[id] = {
      ...binding,
      tabId: id,
      windowId: Number(current.windowId),
      groupId: Number.isInteger(Number(current.groupId)) ? Number(current.groupId) : -1,
      url: liveTabUrl(current),
    };
    restoreLifecyclePanelTitle(state, id, binding);
    restoredLifecycle += 1;
  }

  const existingTabIds = liveTabs.map((tab) => Number(tab?.id)).filter(isChromeEntityId);
  const existingGroupIds = liveGroups.map((group) => Number(group?.id)).filter(isChromeEntityId);
  const windowIds = new Set(liveTabs
    .map((tab) => Number(tab?.windowId))
    .filter(Number.isSafeInteger));
  for (const windowId of windowIds) {
    const requestedFallback = String(fallbackSpaceForWindow(windowId) || '');
    const windowFallback = validSpaceIds.has(requestedFallback) ? requestedFallback : fallbackSpaceId;
    const windowTabs = liveTabs.filter((tab) => Number(tab?.windowId) === windowId);
    const windowGroupIds = new Set(windowTabs
      .filter(isGroupedTab)
      .map((tab) => Number(tab.groupId)));
    const windowGroups = liveGroups.filter((group) => (
      Number(group?.windowId) === windowId || windowGroupIds.has(Number(group?.id))
    ));
    adoptUnassignedEntities(state, windowTabs, windowGroups, windowFallback, {
      adoptGroups: true,
      existingTabIds,
      existingGroupIds,
    });
  }
  return { restoredTabs, restoredGroups, restoredLifecycle };
}

export function restoreSnapshotOwnership(state, tabs = [], groups = []) {
  const metadata = {
    groupTitles: {},
    renamedTabs: {},
  };
  const snapshots = state?.spaceSnapshots || {};
  if (!snapshots || Object.keys(snapshots).length === 0) return metadata;

  if (!state.groupSpaces || typeof state.groupSpaces !== 'object') state.groupSpaces = {};
  if (!state.tabSpaces || typeof state.tabSpaces !== 'object') state.tabSpaces = {};
  if (!state.renamedTabs || typeof state.renamedTabs !== 'object') state.renamedTabs = {};

  const tabsByGroupId = groupedTabsByGroupId(tabs);
  const snapshotGroups = snapshotGroupCandidates(snapshots);
  restoreGroupedOwnership(state, groups, tabsByGroupId, snapshotGroups, metadata);
  restoreUngroupedOwnership(state, tabs, snapshotTabCandidates(snapshots), metadata);
  return metadata;
}

export function markDormantTabsOpenInOtherWindows(
  dormantView = [],
  otherWindowTabs = [],
  state = {},
  spaceId = '',
) {
  const ephemeralIds = new Set((state?.ephemeralTabIds || []).map(Number).filter(Number.isFinite));
  const pool = (Array.isArray(otherWindowTabs) ? otherWindowTabs : [])
    .filter((tab) => (
      isChromeEntityId(tab?.id) &&
      !ephemeralIds.has(Number(tab.id)) &&
      tabBelongsToSpace(tab, state, spaceId)
    ))
    .map((tab) => ({
      tab,
      snapshotTabId: String(tab.snapshotTabId || '').trim(),
      snapshotGroupId: String(tab.snapshotGroupId || '').trim(),
      urlIdentity: snapshotUrlIdentity(tab.url),
      navigationUrlKey: comparableSnapshotUrl(tab.url),
      consumed: false,
    }));
  const groups = (Array.isArray(dormantView) ? dormantView : []).map((group) => ({
    ...group,
    tabs: (Array.isArray(group?.tabs) ? group.tabs : []).map((tab) => ({ ...tab })),
  }));

  for (const matchMode of ['stable-identity', 'exact', 'navigation-fallback']) {
    for (const group of groups) {
      for (const tab of group.tabs) {
        if (isChromeEntityId(tab.foreignWindowTabId)) continue;
        const snapshotTabId = String(tab.snapshotTabId || '').trim();
        const snapshotGroupId = String(tab.snapshotGroupId || group.snapshotGroupId || '').trim();
        const urlIdentity = snapshotUrlIdentity(tab.url);
        const navigationUrlKey = comparableSnapshotUrl(tab.url);
        const candidates = pool.filter((entry) => {
          if (entry.consumed) return false;
          if (matchMode === 'stable-identity') {
            return Boolean(snapshotTabId && entry.snapshotTabId === snapshotTabId);
          }
          if (
            snapshotTabId && entry.snapshotTabId && entry.snapshotTabId !== snapshotTabId
          ) return false;
          if (
            snapshotGroupId && entry.snapshotGroupId && entry.snapshotGroupId !== snapshotGroupId
          ) return false;
          if (matchMode === 'exact') {
            return Boolean(urlIdentity && entry.urlIdentity === urlIdentity);
          }
          return Boolean(navigationUrlKey && entry.navigationUrlKey === navigationUrlKey);
        });
        const match = candidates.find((entry) => (
          snapshotGroupId && entry.snapshotGroupId === snapshotGroupId
        )) || candidates[0];
        if (!match) continue;
        match.consumed = true;
        tab.foreignWindowTabId = match.tab.id;
        tab.foreignWindowId = match.tab.windowId;
      }
    }
  }
  return groups;
}

export function cleanupMissingEntities(state, tabs = [], groups = [], options = {}) {
  const liveTabIds = new Set(
    (Array.isArray(options.existingTabIds) ? options.existingTabIds : tabs.map((tab) => tab.id))
      .filter(isChromeEntityId),
  );
  for (const tabId of Array.isArray(options.pendingLifecycleTabIds)
    ? options.pendingLifecycleTabIds
    : []) {
    if (isChromeEntityId(tabId)) liveTabIds.add(tabId);
  }
  const liveGroupIds = new Set(
    (Array.isArray(options.existingGroupIds) ? options.existingGroupIds : groups.map((group) => group.id))
      .filter(isChromeEntityId),
  );
  const groupedTabIds = new Set(
    tabs.filter(isGroupedTab).map((tab) => tab.id).filter(isChromeEntityId),
  );
  for (const tab of tabs) {
    if (isChromeEntityId(tab?.id)) liveTabIds.add(tab.id);
    if (isGroupedTab(tab)) liveGroupIds.add(tab.groupId);
  }
  for (const group of groups) {
    if (isChromeEntityId(group?.id)) liveGroupIds.add(group.id);
  }

  for (const tabId of Object.keys(state.tabSpaces || {})) {
    if (!liveTabIds.has(Number(tabId))) delete state.tabSpaces[tabId];
  }
  for (const tabId of Object.keys(state.renamedTabs || {})) {
    if (!liveTabIds.has(Number(tabId))) delete state.renamedTabs[tabId];
  }
  for (const groupId of Object.keys(state.groupSpaces || {})) {
    if (!liveGroupIds.has(Number(groupId))) delete state.groupSpaces[groupId];
  }
  for (const tabId of Object.keys(state.tabGroups || {})) {
    if (!liveTabIds.has(Number(tabId)) || groupedTabIds.has(Number(tabId))) delete state.tabGroups[tabId];
  }
  reconcileMissingLifecycleTabs(state, options);
  const usedVirtualGroups = new Set(Object.values(state.tabGroups || {}));
  for (const groupKey of Object.keys(state.virtualGroups || {})) {
    if (!usedVirtualGroups.has(groupKey)) delete state.virtualGroups[groupKey];
  }
}

export function planLifecycleCleanupDeferral(
  state,
  options = {},
  previousObservations = {},
  now = Date.now(),
  graceMs = 500,
  maxObservationGapMs = 5_000,
) {
  if (
    !Array.isArray(options.existingTabIds) ||
    !Array.isArray(options.existingWindowIds) ||
    !Array.isArray(options.pendingLifecycleTabIds) ||
    !Array.isArray(options.suppressedLifecycleTabIds) ||
    !Number.isFinite(Number(now)) ||
    !Number.isFinite(Number(graceMs)) ||
    Number(graceMs) < 0 ||
    !Number.isFinite(Number(maxObservationGapMs)) ||
    Number(maxObservationGapMs) < 0
  ) return { deferredTabIds: [], observations: {} };

  const observedAt = Number(now);
  const delay = Number(graceMs);
  const maxObservationGap = Number(maxObservationGapMs);
  const existingTabIds = new Set(options.existingTabIds.filter(isChromeEntityId));
  const existingWindowIds = new Set(options.existingWindowIds.filter(isChromeEntityId));
  const pendingLifecycleTabIds = new Set(options.pendingLifecycleTabIds.filter(isChromeEntityId));
  const suppressedLifecycleTabIds = new Set(
    options.suppressedLifecycleTabIds.filter(isChromeEntityId),
  );
  const prior = previousObservations && typeof previousObservations === 'object' &&
    !Array.isArray(previousObservations)
    ? previousObservations
    : {};
  const observations = {};
  const deferredTabIds = [];

  for (const [key, binding] of Object.entries(state?.tabLifecycle || {})) {
    const tabId = Number(key);
    const windowId = Number(binding?.windowId);
    if (
      !isChromeEntityId(tabId) ||
      existingTabIds.has(tabId) ||
      pendingLifecycleTabIds.has(tabId) ||
      suppressedLifecycleTabIds.has(tabId) ||
      !isChromeEntityId(windowId) ||
      !existingWindowIds.has(windowId)
    ) continue;
    const identity = JSON.stringify([
      String(binding?.sessionId || ''),
      String(binding?.spaceId || ''),
      String(binding?.snapshotGroupId || ''),
      String(binding?.snapshotTabId || ''),
      String(binding?.trackingMode || ''),
      windowId,
      String(binding?.groupId ?? ''),
      String(binding?.url || ''),
    ]);
    const previous = prior[tabId];
    const previousAt = Number(previous?.firstObservedAt);
    const previousLastAt = Number(previous?.lastObservedAt);
    const sameObservation = previous?.identity === identity &&
      Number.isFinite(previousAt) &&
      Number.isFinite(previousLastAt) &&
      previousAt <= previousLastAt &&
      previousLastAt <= observedAt &&
      observedAt - previousLastAt <= maxObservationGap;
    const firstObservedAt = sameObservation ? previousAt : observedAt;
    if (observedAt - firstObservedAt >= delay) continue;
    observations[tabId] = { identity, firstObservedAt, lastObservedAt: observedAt };
    deferredTabIds.push(tabId);
  }

  return {
    deferredTabIds: deferredTabIds.sort((left, right) => left - right),
    observations,
  };
}

function reconcileMissingLifecycleTabs(state, options) {
  if (
    !Array.isArray(options.existingTabIds) ||
    !Array.isArray(options.existingWindowIds) ||
    !Array.isArray(options.pendingLifecycleTabIds) ||
    !Array.isArray(options.suppressedLifecycleTabIds)
  ) return;

  const existingTabIds = new Set(options.existingTabIds.filter(isChromeEntityId));
  const existingWindowIds = new Set(options.existingWindowIds.filter(isChromeEntityId));
  const pendingLifecycleTabIds = new Set(options.pendingLifecycleTabIds.filter(isChromeEntityId));
  const suppressedLifecycleTabIds = new Set(
    options.suppressedLifecycleTabIds.filter(isChromeEntityId),
  );
  let reconciled = state;
  for (const [key, binding] of Object.entries(state.tabLifecycle || {})) {
    const tabId = Number(key);
    if (
      !isChromeEntityId(tabId) ||
      existingTabIds.has(tabId) ||
      pendingLifecycleTabIds.has(tabId)
    ) continue;
    const windowId = Number(binding?.windowId);
    reconciled = reduceTabLifecycleEvent({
      state: reconciled,
      event: {
        type: 'removed',
        tabId,
        binding,
        suppressed: suppressedLifecycleTabIds.has(tabId),
        isWindowClosing: !isChromeEntityId(windowId) || !existingWindowIds.has(windowId),
      },
      now: Date.now(),
    });
  }
  replaceObjectContents(state, reconciled);
}

function replaceObjectContents(target, replacement) {
  if (target === replacement) return;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, replacement);
}

export function syncCollapsedGroupsFromChrome(state, groups = []) {
  for (const group of groups) {
    state.collapsedGroups[`group:${group.id}`] = Boolean(group.collapsed);
  }
}

export function tabBelongsToSpace(tab, state, spaceId) {
  if (isGroupedTab(tab)) return state.groupSpaces[tab.groupId] === spaceId;
  return state.tabSpaces[tab.id] === spaceId;
}

export function tabsForSpace(tabs = [], state, spaceId) {
  return tabs.filter((tab) => tabBelongsToSpace(tab, state, spaceId));
}

export function planSpaceTabDeletion(tabs = [], state, spaceId) {
  const ownedTabs = tabsForSpace(tabs, state, spaceId);
  return {
    closingTabs: ownedTabs.filter((tab) => !tab.pinned),
    preservedPinnedTabs: ownedTabs.filter((tab) => Boolean(tab.pinned)),
  };
}

export function spaceTabDeletionFingerprint(plan = {}) {
  return JSON.stringify([
    ...(Array.isArray(plan?.closingTabs) ? plan.closingTabs : [])
      .map((tab) => [Number(tab?.id), false]),
    ...(Array.isArray(plan?.preservedPinnedTabs) ? plan.preservedPinnedTabs : [])
      .map((tab) => [Number(tab?.id), true]),
  ].sort((left, right) => left[0] - right[0]));
}

export function reassignPinnedTabsAfterSpaceDelete(
  state,
  tabs = [],
  deletedSpaceId,
  fallbackSpaceId,
) {
  if (!fallbackSpaceId || fallbackSpaceId === deletedSpaceId) return [];
  const { preservedPinnedTabs } = planSpaceTabDeletion(tabs, state, deletedSpaceId);
  for (const tab of preservedPinnedTabs) {
    if (isGroupedTab(tab)) state.groupSpaces[tab.groupId] = fallbackSpaceId;
    else state.tabSpaces[tab.id] = fallbackSpaceId;
    if (state.tabLifecycle?.[tab.id] && typeof state.tabLifecycle[tab.id] === 'object') {
      state.tabLifecycle[tab.id] = {
        ...state.tabLifecycle[tab.id],
        spaceId: fallbackSpaceId,
        groupId: isGroupedTab(tab) ? Number(tab.groupId) : -1,
        pinned: true,
        trackingMode: 'live',
      };
    }
  }
  return preservedPinnedTabs.map((tab) => tab.id);
}

export function reassignTabsFromRemovedSpaces(
  state,
  tabs = [],
  removedSpaceIds = [],
  fallbackSpaceId,
) {
  const removed = new Set(Array.from(removedSpaceIds || [], String));
  const fallbackForTab = typeof fallbackSpaceId === 'function'
    ? fallbackSpaceId
    : () => fallbackSpaceId;
  const reassignedTabIds = [];
  const reassignedGroupIds = new Set();
  const reassignedSpaceIds = new Set();
  for (const tab of tabs) {
    const targetSpaceId = String(fallbackForTab(tab) || '');
    if (!targetSpaceId || removed.has(targetSpaceId)) continue;
    const lifecycleOwnedByRemovedSpace = removed.has(String(state.tabLifecycle?.[tab.id]?.spaceId));
    if (isGroupedTab(tab)) {
      if (!removed.has(String(state.groupSpaces?.[tab.groupId])) && !lifecycleOwnedByRemovedSpace) continue;
      state.groupSpaces[tab.groupId] = targetSpaceId;
      reassignedGroupIds.add(tab.groupId);
    } else {
      if (!removed.has(String(state.tabSpaces?.[tab.id])) && !lifecycleOwnedByRemovedSpace) continue;
      state.tabSpaces[tab.id] = targetSpaceId;
    }
    if (lifecycleOwnedByRemovedSpace) {
      state.tabLifecycle[tab.id] = {
        ...state.tabLifecycle[tab.id],
        spaceId: targetSpaceId,
        trackingMode: 'live',
      };
    }
    reassignedTabIds.push(tab.id);
    reassignedSpaceIds.add(targetSpaceId);
  }
  return {
    tabIds: reassignedTabIds,
    groupIds: [...reassignedGroupIds],
    spaceIds: [...reassignedSpaceIds],
  };
}

export function closableTabsForSpace(tabs = [], state, spaceId, shouldClose) {
  return tabsForSpace(tabs, state, spaceId).filter(shouldClose);
}

export function tabHasSpaceOwner(tab, state) {
  if (isGroupedTab(tab)) return state.groupSpaces[tab.groupId] !== undefined;
  return state.tabSpaces[tab.id] !== undefined;
}

function isGroupedTab(tab) {
  return isChromeEntityId(tab?.groupId);
}

function isChromeEntityId(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function liveTabUrl(tab) {
  return String(tab?.pendingUrl || tab?.url || '');
}

function lifecycleSnapshotIdentityExists(state, binding) {
  return snapshotTabsForIdentity(state, binding).length > 0;
}

function restoreLifecyclePanelTitle(state, tabId, binding) {
  if (Object.hasOwn(state.renamedTabs, tabId)) return;
  const matchingTabs = snapshotTabsForIdentity(state, binding);
  if (matchingTabs.length !== 1) return;
  const panelTitle = cleanPanelTitle(matchingTabs[0]?.panelTitle);
  if (panelTitle) state.renamedTabs[tabId] = panelTitle;
}

export function setLiveTabPanelTitle(state = {}, tabId, value = '') {
  const id = Number(tabId);
  if (!Number.isSafeInteger(id) || id < 0) return false;
  if (!state.renamedTabs || typeof state.renamedTabs !== 'object') state.renamedTabs = {};
  const panelTitle = cleanPanelTitle(value);
  if (panelTitle) state.renamedTabs[id] = panelTitle;
  else delete state.renamedTabs[id];

  const binding = state.tabLifecycle?.[id];
  if (!binding || typeof binding !== 'object') return true;
  if (panelTitle) binding.panelTitle = panelTitle;
  else delete binding.panelTitle;
  for (const snapshotTab of snapshotTabsForIdentity(state, binding)) {
    if (panelTitle) snapshotTab.panelTitle = panelTitle;
    else delete snapshotTab.panelTitle;
  }
  return true;
}

function snapshotTabsForIdentity(state, identity = {}) {
  const spaceId = String(identity?.spaceId || '');
  const snapshotGroupId = String(identity?.snapshotGroupId || '');
  const snapshotTabId = String(identity?.snapshotTabId || '');
  if (!spaceId || !snapshotGroupId || !snapshotTabId) return [];
  return (state.spaceSnapshots?.[spaceId]?.groups || []).flatMap((group) => (
    String(group?.snapshotGroupId || '') === snapshotGroupId
      ? (group?.tabs || []).filter((tab) => String(tab?.snapshotTabId || '') === snapshotTabId)
      : []
  ));
}

function snapshotUrlIdentity(url) {
  return String(url || '').trim();
}

export function closableTabsOutsideSpace(tabs = [], state, activeSpaceId, shouldClose) {
  return tabs.filter((tab) => {
    if (!shouldClose(tab)) return false;
    if (!tabHasSpaceOwner(tab, state)) return false;
    return !tabBelongsToSpace(tab, state, activeSpaceId);
  });
}

export function fallbackSpaceAfterDelete(spaces = [], deletedSpaceId, preferredSpaceId = 'default') {
  const remaining = spaces.filter((space) => space?.id && space.id !== deletedSpaceId);
  return remaining.find((space) => space.id === preferredSpaceId) || remaining[0] || null;
}

export function removeSpaceReferences(state, spaceId) {
  const removedCollapsedGroupKeys = new Set();
  for (const [groupId, ownerSpaceId] of Object.entries(state.groupSpaces || {})) {
    if (ownerSpaceId !== spaceId) continue;
    removedCollapsedGroupKeys.add(`group:${groupId}`);
    delete state.groupSpaces[groupId];
  }
  for (const [tabId, ownerSpaceId] of Object.entries(state.tabSpaces || {})) {
    if (ownerSpaceId === spaceId) delete state.tabSpaces[tabId];
  }
  delete state.groupOrder?.[spaceId];
  delete state.tabOrder?.[spaceId];
  delete state.spaceSnapshots?.[spaceId];
  delete state.spaceContexts?.[spaceId];
  delete state.collapsedSpaceGroups?.[spaceId];
  const askSessionKey = `space:${spaceId}`;
  delete state.askSessions?.[askSessionKey];
  if (state.activeAskSessionKey === askSessionKey) state.activeAskSessionKey = '';
  for (const [groupKey, group] of Object.entries(state.virtualGroups || {})) {
    if (group?.spaceId !== spaceId) continue;
    removedCollapsedGroupKeys.add(groupKey);
    delete state.virtualGroups[groupKey];
  }
  for (const [tabId, groupKey] of Object.entries(state.tabGroups || {})) {
    if (!state.virtualGroups?.[groupKey]) delete state.tabGroups[tabId];
  }
  for (const [tabId, binding] of Object.entries(state.tabLifecycle || {})) {
    if (binding?.spaceId === spaceId) delete state.tabLifecycle[tabId];
  }
  const folderPrefix = `folder:${spaceId}:`;
  const encodedSpaceId = encodeURIComponent(spaceId);
  for (const groupKey of Object.keys(state.collapsedGroups || {})) {
    const snapshotParts = groupKey.split(':');
    const scopedSnapshotKey = snapshotParts[0] === 'snapshot' &&
      /^\d+$/.test(snapshotParts[1] || '') &&
      snapshotParts[2] === encodedSpaceId;
    if (
      removedCollapsedGroupKeys.has(groupKey) ||
      groupKey.startsWith(folderPrefix) ||
      scopedSnapshotKey
    ) {
      delete state.collapsedGroups[groupKey];
    }
  }
  if (Array.isArray(state.operationHistory)) {
    state.operationHistory = state.operationHistory.filter((operation) => operation?.spaceId !== spaceId);
  }
  if (Array.isArray(state.lastArcImport?.spaceIds) && state.lastArcImport.spaceIds.includes(spaceId)) {
    const remainingSpaceIds = state.lastArcImport.spaceIds.filter((id) => id !== spaceId);
    if (remainingSpaceIds.length === 0) {
      state.lastArcImport = null;
    } else {
      const hasAfterFingerprints = state.lastArcImport.afterFingerprints &&
        typeof state.lastArcImport.afterFingerprints === 'object';
      const afterFingerprints = Object.fromEntries(remainingSpaceIds.flatMap((id) => (
        Object.hasOwn(state.lastArcImport.afterFingerprints || {}, id)
          ? [[id, state.lastArcImport.afterFingerprints[id]]]
          : []
      )));
      state.lastArcImport = {
        ...state.lastArcImport,
        spaceIds: remainingSpaceIds,
        ...(hasAfterFingerprints ? { afterFingerprints } : {}),
      };
    }
  }
}

function restoreGroupedOwnership(state, groups, tabsByGroupId, snapshotGroups, metadata) {
  for (const group of groups || []) {
    const groupTabs = tabsByGroupId.get(Number(group.id)) || [];
    if (!groupTabs.some((tab) => tab?.url)) continue;

    const hasExistingOwner = state.groupSpaces[group.id] !== undefined;
    const existingSpaceId = String(state.groupSpaces[group.id] || '');
    const identifiedGroupTabs = groupTabs.map((tab) => {
      const binding = state.tabLifecycle?.[tab.id];
      const bindingMatches = binding &&
        Number(binding.groupId) === Number(group.id) &&
        (!existingSpaceId || String(binding.spaceId || '') === existingSpaceId);
      return bindingMatches
        ? {
          ...tab,
          snapshotTabId: binding.snapshotTabId,
          snapshotGroupId: binding.snapshotGroupId,
        }
        : tab;
    });
    const candidates = hasExistingOwner
      ? snapshotGroups.filter((candidate) => candidate.spaceId === existingSpaceId)
      : snapshotGroups;
    const match = bestSnapshotGroupMatch(group, identifiedGroupTabs, candidates);
    if (!match) continue;

    // Known ownership is authoritative, but a fresh side panel still needs
    // the matching snapshot's full logical title and panel-only tab names.
    // Chrome's physical group title can be a compact collision-safe label.
    if (!hasExistingOwner) state.groupSpaces[group.id] = match.spaceId;
    rememberGroupOrderKey(state, match.spaceId, `group:${group.id}`);
    restoreMatchedGroupMetadata(state, group, identifiedGroupTabs, match.candidates, metadata);
  }
}

function restoreMatchedGroupMetadata(state, group, groupTabs, candidates, metadata) {
  const logicalTitles = new Set(candidates.map((candidate) => candidate.title));
  if (logicalTitles.size === 1) {
    metadata.groupTitles[group.id] = [...logicalTitles][0];
  }

  for (const tab of groupTabs) {
    if (!isChromeEntityId(tab?.id) || !tab.url || Object.hasOwn(state.renamedTabs, tab.id)) continue;
    const matchingTabs = matchedSnapshotTabsForLiveTab(tab, candidates);
    if (matchingTabs.length === 0) continue;
    const panelTitles = matchingTabs.map((snapshotTab) => cleanPanelTitle(snapshotTab?.panelTitle));
    if (panelTitles.some((title) => !title)) continue;
    const uniquePanelTitles = new Set(panelTitles);
    if (uniquePanelTitles.size !== 1) continue;
    const panelTitle = [...uniquePanelTitles][0];
    state.renamedTabs[tab.id] = panelTitle;
    metadata.renamedTabs[tab.id] = panelTitle;
  }
}

function restoreUngroupedOwnership(state, tabs, candidates, metadata) {
  for (const tab of tabs || []) {
    if (isGroupedTab(tab) || !isChromeEntityId(tab?.id)) continue;
    const existingSpaceId = String(state.tabSpaces[tab.id] || '');
    const lifecycle = state.tabLifecycle?.[tab.id];
    const identity = lifecycle && typeof lifecycle === 'object' ? lifecycle : tab;
    const snapshotTabId = String(identity?.snapshotTabId || '');
    const snapshotGroupId = String(identity?.snapshotGroupId || '');
    const identitySpecified = Boolean(snapshotTabId || snapshotGroupId);
    let matches = [];

    if (identitySpecified) {
      const spaceId = String(identity?.spaceId || existingSpaceId || '');
      if (!spaceId || !snapshotTabId || !snapshotGroupId) continue;
      if (existingSpaceId && existingSpaceId !== spaceId) continue;
      matches = candidates.filter((candidate) => (
        candidate.spaceId === spaceId &&
        candidate.snapshotGroupId === snapshotGroupId &&
        candidate.snapshotTabId === snapshotTabId
      ));
      if (matches.length !== 1) continue;
    } else {
      const url = snapshotUrlIdentity(liveTabUrl(tab));
      if (!url) continue;
      const urlMatches = candidates.filter((candidate) => candidate.url === url);
      const spaceIds = new Set(urlMatches.map((candidate) => candidate.spaceId));
      if (!existingSpaceId && spaceIds.size === 1) {
        state.tabSpaces[tab.id] = [...spaceIds][0];
      }
      const ownerSpaceId = existingSpaceId || String(state.tabSpaces[tab.id] || '');
      if (!ownerSpaceId) continue;
      matches = urlMatches.filter((candidate) => candidate.spaceId === ownerSpaceId);
      if (matches.length !== 1) continue;
    }

    const match = matches[0];
    if (!existingSpaceId) state.tabSpaces[tab.id] = match.spaceId;
    if (Object.hasOwn(state.renamedTabs, tab.id)) continue;
    const panelTitle = cleanPanelTitle(match.panelTitle);
    if (!panelTitle) continue;
    state.renamedTabs[tab.id] = panelTitle;
    metadata.renamedTabs[tab.id] = panelTitle;
  }
}

function bestSnapshotGroupMatch(group, groupTabs, snapshotGroups) {
  const liveSnapshotGroupIds = new Set(groupTabs
    .map((tab) => snapshotIdentity(tab?.snapshotGroupId))
    .filter(Boolean));
  if (liveSnapshotGroupIds.size > 1) return null;
  const liveSnapshotGroupId = [...liveSnapshotGroupIds][0] || '';
  let bestIdentityRank = -1;
  let bestStableTabOverlap = -1;
  let bestUrlOverlap = -1;
  let candidates = [];

  for (const candidate of snapshotGroups) {
    const candidateSnapshotGroupId = snapshotIdentity(candidate.snapshotGroupId);
    if (
      liveSnapshotGroupId &&
      candidateSnapshotGroupId &&
      liveSnapshotGroupId !== candidateSnapshotGroupId
    ) continue;
    const stableTabOverlap = countStableTabIdentityOverlap(groupTabs, candidate.tabs);
    const identityRank = liveSnapshotGroupId && candidateSnapshotGroupId
      ? 2
      : stableTabOverlap > 0 ? 1 : 0;
    if (identityRank === 0 && !groupMatchesSnapshot(group, candidate)) continue;
    const urlOverlap = countCompatibleUrlOverlap(groupTabs, candidate.tabs);
    if (identityRank === 0 && urlOverlap === 0) continue;
    const isBetter = identityRank > bestIdentityRank || (
      identityRank === bestIdentityRank && (
        stableTabOverlap > bestStableTabOverlap || (
          stableTabOverlap === bestStableTabOverlap && urlOverlap > bestUrlOverlap
        )
      )
    );
    const isEqual = identityRank === bestIdentityRank &&
      stableTabOverlap === bestStableTabOverlap &&
      urlOverlap === bestUrlOverlap;
    if (isBetter) {
      bestIdentityRank = identityRank;
      bestStableTabOverlap = stableTabOverlap;
      bestUrlOverlap = urlOverlap;
      candidates = [candidate];
    } else if (isEqual) {
      candidates.push(candidate);
    }
  }

  const spaceIds = new Set(candidates.map((candidate) => candidate.spaceId));
  if (spaceIds.size !== 1) return null;
  return {
    spaceId: [...spaceIds][0],
    overlap: bestUrlOverlap,
    candidates,
  };
}

function matchedSnapshotTabsForLiveTab(tab, candidates) {
  const snapshotTabs = candidates.flatMap((candidate) => candidate.tabs);
  const snapshotTabId = snapshotIdentity(tab?.snapshotTabId);
  if (snapshotTabId) {
    const identityMatches = snapshotTabs.filter((snapshotTab) => (
      snapshotIdentity(snapshotTab?.snapshotTabId) === snapshotTabId
    ));
    if (identityMatches.length > 0) return identityMatches;
    return snapshotTabs.filter((snapshotTab) => (
      !snapshotIdentity(snapshotTab?.snapshotTabId) && snapshotTab?.url === tab.url
    ));
  }
  return snapshotTabs.filter((snapshotTab) => snapshotTab?.url === tab.url);
}

function groupMatchesSnapshot(group, candidate) {
  const liveTitle = group && Object.hasOwn(group, 'title')
    ? String(group.title)
    : 'Group';
  const snapshotTitle = candidate.title;
  const titleMatches = (
    chromeGroupTitleKey(liveTitle) === chromeGroupTitleKey(snapshotTitle) ||
    groupTitleKey(liveTitle) === legacyChromeGroupTitleKey(snapshotTitle)
  );
  return (
    titleMatches &&
    String(group?.color || 'grey') === String(candidate.color)
  );
}

function countStableTabIdentityOverlap(liveTabs, snapshotTabs) {
  const liveIds = new Set(liveTabs
    .map((tab) => snapshotIdentity(tab?.snapshotTabId))
    .filter(Boolean));
  const matchedIds = new Set();
  for (const tab of snapshotTabs) {
    const snapshotTabId = snapshotIdentity(tab?.snapshotTabId);
    if (snapshotTabId && liveIds.has(snapshotTabId)) matchedIds.add(snapshotTabId);
  }
  return matchedIds.size;
}

function countCompatibleUrlOverlap(liveTabs, snapshotTabs) {
  const snapshotTabsByUrl = new Map();
  for (const snapshotTab of snapshotTabs) {
    const url = snapshotTab?.url;
    const entries = snapshotTabsByUrl.get(url) || [];
    entries.push(snapshotTab);
    snapshotTabsByUrl.set(url, entries);
  }
  const matchedUrls = new Set();
  for (const liveTab of liveTabs) {
    if (!liveTab?.url || matchedUrls.has(liveTab.url)) continue;
    const match = (snapshotTabsByUrl.get(liveTab.url) || []).some((snapshotTab) => (
      !snapshotTabIdentitiesConflict(liveTab, snapshotTab)
    ));
    if (match) matchedUrls.add(liveTab.url);
  }
  return matchedUrls.size;
}

function groupedTabsByGroupId(tabs) {
  const map = new Map();
  for (const tab of tabs || []) {
    if (!isGroupedTab(tab)) continue;
    const groupId = Number(tab.groupId);
    if (!map.has(groupId)) map.set(groupId, []);
    map.get(groupId).push(tab);
  }
  return map;
}

function snapshotGroupCandidates(snapshots) {
  const candidates = [];
  for (const [spaceId, snapshot] of Object.entries(snapshots)) {
    for (const group of snapshot?.groups || []) {
      if (isUngroupedSnapshotGroup(group)) continue;
      const urls = new Set((group.tabs || []).map((tab) => tab.url).filter(Boolean));
      if (urls.size === 0) continue;
      candidates.push({
        spaceId,
        snapshotGroupId: snapshotIdentity(group?.snapshotGroupId),
        title: Object.hasOwn(group, 'title') ? String(group.title) : 'Group',
        color: group.color || 'grey',
        tabs: group.tabs,
      });
    }
  }
  return candidates;
}

function snapshotTabCandidates(snapshots) {
  const candidates = [];
  for (const [spaceId, snapshot] of Object.entries(snapshots)) {
    for (const group of snapshot?.groups || []) {
      if (isUngroupedSnapshotGroup(group) && group?.restorable !== true) continue;
      for (const tab of group.tabs || []) {
        const url = snapshotUrlIdentity(tab?.url);
        if (!url) continue;
        candidates.push({
          spaceId,
          snapshotGroupId: String(group?.snapshotGroupId || ''),
          snapshotTabId: String(tab?.snapshotTabId || ''),
          url,
          panelTitle: cleanPanelTitle(tab?.panelTitle),
        });
      }
    }
  }
  return candidates;
}

function isUngroupedSnapshotGroup(group = {}) {
  return group.title === 'Ungrouped' && (group.color || 'grey') === 'grey';
}

function cleanPanelTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function snapshotIdentity(value) {
  return String(value || '').trim();
}

function rememberGroupOrderKey(state, spaceId, key) {
  if (!state.groupOrder || typeof state.groupOrder !== 'object') return;
  const order = state.groupOrder[spaceId] || [];
  if (!order.includes(key)) state.groupOrder[spaceId] = [...order, key];
}
