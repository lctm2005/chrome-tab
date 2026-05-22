export function adoptUnassignedEntities(state, tabs = [], groups = [], activeSpaceId, options = {}) {
  cleanupMissingEntities(state, tabs, groups);

  if (options.adoptGroups === true) {
    for (const group of groups) {
      if (state.groupSpaces[group.id] === undefined) {
        state.groupSpaces[group.id] = activeSpaceId;
      }
    }
  }

  for (const tab of tabs) {
    if (isGroupedTab(tab)) {
      delete state.tabSpaces[tab.id];
      continue;
    }
    if (state.tabSpaces[tab.id] === undefined) {
      state.tabSpaces[tab.id] = activeSpaceId;
    }
  }

  cleanupMissingEntities(state, tabs, groups);
}

export function restoreSnapshotOwnership(state, tabs = [], groups = []) {
  const snapshots = state?.spaceSnapshots || {};
  if (!snapshots || Object.keys(snapshots).length === 0) return;

  if (!state.groupSpaces || typeof state.groupSpaces !== 'object') state.groupSpaces = {};
  if (!state.tabSpaces || typeof state.tabSpaces !== 'object') state.tabSpaces = {};

  const tabsByGroupId = groupedTabsByGroupId(tabs);
  const snapshotGroups = snapshotGroupCandidates(snapshots);
  restoreGroupedOwnership(state, groups, tabsByGroupId, snapshotGroups);
  restoreUngroupedOwnership(state, tabs, snapshotTabSpacesByUrl(snapshots));
}

export function cleanupMissingEntities(state, tabs = [], groups = []) {
  const liveTabIds = new Set(tabs.map((tab) => Number(tab.id)));
  const liveGroupIds = new Set(groups.map((group) => Number(group.id)));

  for (const tabId of Object.keys(state.tabSpaces || {})) {
    if (!liveTabIds.has(Number(tabId))) delete state.tabSpaces[tabId];
  }
  for (const tabId of Object.keys(state.renamedTabs || {})) {
    if (!liveTabIds.has(Number(tabId))) delete state.renamedTabs[tabId];
  }
  for (const groupId of Object.keys(state.groupSpaces || {})) {
    if (!liveGroupIds.has(Number(groupId))) delete state.groupSpaces[groupId];
  }
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

export function closableTabsForSpace(tabs = [], state, spaceId, shouldClose) {
  return tabsForSpace(tabs, state, spaceId).filter(shouldClose);
}

export function tabHasSpaceOwner(tab, state) {
  if (isGroupedTab(tab)) return state.groupSpaces[tab.groupId] !== undefined;
  return state.tabSpaces[tab.id] !== undefined;
}

function isGroupedTab(tab) {
  return Number.isFinite(Number(tab?.groupId)) && Number(tab.groupId) !== -1;
}

export function closableTabsOutsideSpace(tabs = [], state, activeSpaceId, shouldClose) {
  return tabs.filter((tab) => {
    if (!shouldClose(tab)) return false;
    if (!tabHasSpaceOwner(tab, state)) return true;
    return !tabBelongsToSpace(tab, state, activeSpaceId);
  });
}

export function fallbackSpaceAfterDelete(spaces = [], deletedSpaceId, preferredSpaceId = 'default') {
  const remaining = spaces.filter((space) => space?.id && space.id !== deletedSpaceId);
  return remaining.find((space) => space.id === preferredSpaceId) || remaining[0] || null;
}

export function removeSpaceReferences(state, spaceId) {
  for (const [groupId, ownerSpaceId] of Object.entries(state.groupSpaces || {})) {
    if (ownerSpaceId === spaceId) delete state.groupSpaces[groupId];
  }
  for (const [tabId, ownerSpaceId] of Object.entries(state.tabSpaces || {})) {
    if (ownerSpaceId === spaceId) delete state.tabSpaces[tabId];
  }
  delete state.groupOrder[spaceId];
  delete state.tabOrder[spaceId];
  delete state.spaceSnapshots[spaceId];
}

function restoreGroupedOwnership(state, groups, tabsByGroupId, snapshotGroups) {
  for (const group of groups || []) {
    if (state.groupSpaces[group.id] !== undefined) continue;
    const groupTabs = tabsByGroupId.get(Number(group.id)) || [];
    const groupUrls = new Set(groupTabs.map((tab) => tab.url).filter(Boolean));
    if (groupUrls.size === 0) continue;

    const match = bestSnapshotGroupMatch(group, groupUrls, snapshotGroups);
    if (!match) continue;

    state.groupSpaces[group.id] = match.spaceId;
    rememberGroupOrderKey(state, match.spaceId, `group:${group.id}`);
  }
}

function restoreUngroupedOwnership(state, tabs, tabSpacesByUrl) {
  for (const tab of tabs || []) {
    if (isGroupedTab(tab) || state.tabSpaces[tab.id] !== undefined || !tab.url) continue;
    const spaceIds = tabSpacesByUrl.get(tab.url) || new Set();
    if (spaceIds.size === 1) state.tabSpaces[tab.id] = [...spaceIds][0];
  }
}

function bestSnapshotGroupMatch(group, groupUrls, snapshotGroups) {
  let best = null;
  let ambiguous = false;

  for (const candidate of snapshotGroups) {
    if (!groupMatchesSnapshot(group, candidate)) continue;
    const overlap = countUrlOverlap(groupUrls, candidate.urls);
    if (overlap === 0) continue;
    if (!best || overlap > best.overlap) {
      best = { ...candidate, overlap };
      ambiguous = false;
    } else if (overlap === best.overlap && candidate.spaceId !== best.spaceId) {
      ambiguous = true;
    }
  }

  return ambiguous ? null : best;
}

function groupMatchesSnapshot(group, candidate) {
  const liveTitle = String(group?.title || 'Group');
  const snapshotTitle = String(candidate.title || 'Group');
  const chromeSnapshotTitle = snapshotTitle.slice(0, 32);
  return (
    (liveTitle === snapshotTitle || liveTitle === chromeSnapshotTitle) &&
    String(group?.color || 'grey') === String(candidate.color || 'grey')
  );
}

function countUrlOverlap(leftUrls, rightUrls) {
  let count = 0;
  for (const url of rightUrls) {
    if (leftUrls.has(url)) count += 1;
  }
  return count;
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
  for (const [spaceId, snapshot] of Object.entries(snapshots || {})) {
    for (const group of snapshot?.groups || []) {
      if (isUngroupedSnapshotGroup(group)) continue;
      const urls = new Set((group.tabs || []).map((tab) => tab.url).filter(Boolean));
      if (urls.size === 0) continue;
      candidates.push({
        spaceId,
        title: group.title || 'Group',
        color: group.color || 'grey',
        urls,
      });
    }
  }
  return candidates;
}

function snapshotTabSpacesByUrl(snapshots) {
  const map = new Map();
  for (const [spaceId, snapshot] of Object.entries(snapshots || {})) {
    for (const group of snapshot?.groups || []) {
      for (const tab of group.tabs || []) {
        if (!tab.url) continue;
        if (!map.has(tab.url)) map.set(tab.url, new Set());
        map.get(tab.url).add(spaceId);
      }
    }
  }
  return map;
}

function isUngroupedSnapshotGroup(group = {}) {
  return group.title === 'Ungrouped' && (group.color || 'grey') === 'grey';
}

function rememberGroupOrderKey(state, spaceId, key) {
  if (!state.groupOrder || typeof state.groupOrder !== 'object') return;
  const order = state.groupOrder[spaceId] || [];
  if (!order.includes(key)) state.groupOrder[spaceId] = [...order, key];
}
