export function adoptUnassignedEntities(state, tabs = [], groups = [], activeSpaceId) {
  cleanupMissingEntities(state, tabs, groups);

  for (const group of groups) {
    if (state.groupSpaces[group.id] === undefined) {
      state.groupSpaces[group.id] = activeSpaceId;
    }
  }

  for (const tab of tabs) {
    if (tab.groupId > 0) {
      delete state.tabSpaces[tab.id];
      continue;
    }
    if (state.tabSpaces[tab.id] === undefined) {
      state.tabSpaces[tab.id] = activeSpaceId;
    }
  }

  cleanupMissingEntities(state, tabs, groups);
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
  if (tab.groupId > 0) return state.groupSpaces[tab.groupId] === spaceId;
  return state.tabSpaces[tab.id] === spaceId;
}

export function tabsForSpace(tabs = [], state, spaceId) {
  return tabs.filter((tab) => tabBelongsToSpace(tab, state, spaceId));
}

export function closableTabsForSpace(tabs = [], state, spaceId, shouldClose) {
  return tabsForSpace(tabs, state, spaceId).filter(shouldClose);
}

export function tabHasSpaceOwner(tab, state) {
  if (tab.groupId > 0) return state.groupSpaces[tab.groupId] !== undefined;
  return state.tabSpaces[tab.id] !== undefined;
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
