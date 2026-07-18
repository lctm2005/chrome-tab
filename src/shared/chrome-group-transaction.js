export function captureTabGroupMembership(tabs = [], groups = [], tabIds = []) {
  const tabById = new Map((tabs || [])
    .map((tab) => [chromeTabId(tab?.id), tab])
    .filter(([tabId]) => tabId !== null));
  const groupById = new Map((groups || [])
    .map((group) => [chromeGroupId(group?.id), group])
    .filter(([groupId]) => groupId !== null));
  const capturedTabs = uniqueChromeTabIds(tabIds)
    .map((tabId) => tabById.get(tabId))
    .filter(Boolean)
    .map((tab) => {
      const windowId = chromeTabId(tab.windowId);
      const index = chromeTabIndex(tab.index);
      return {
        tabId: Number(tab.id),
        groupId: chromeGroupId(tab.groupId) ?? -1,
        ...(windowId === null ? {} : { windowId }),
        ...(index === null ? {} : { index }),
      };
    });
  const groupedTabs = new Map();

  for (const tab of capturedTabs) {
    if (tab.groupId < 0) continue;
    if (!groupedTabs.has(tab.groupId)) {
      const group = groupById.get(tab.groupId) || {};
      groupedTabs.set(tab.groupId, {
        groupId: tab.groupId,
        title: group.title === ''
          ? ''
          : cleanText(group.displayTitle) || cleanText(group.title) || 'Group',
        color: cleanText(group.color) || 'blue',
        collapsed: group.collapsed === true,
        tabIds: [],
      });
    }
    groupedTabs.get(tab.groupId).tabIds.push(tab.tabId);
  }

  return {
    tabs: capturedTabs,
    groups: [...groupedTabs.values()],
  };
}

/**
 * Selects the canonical live Tag without relying on Chrome's incidental group
 * ids. A durable snapshot identity wins; otherwise the user-visible/durable
 * group order wins and the original input order is the final stable fallback.
 */
export function orderDuplicateChromeGroups(groups = [], options = {}) {
  const canonicalSnapshotGroupId = String(options.canonicalSnapshotGroupId || '').trim();
  const explicitCanonicalGroupIds = new Set((options.canonicalGroupIds || [])
    .map(chromeGroupId)
    .filter((groupId) => groupId !== null));
  const lifecycleCanonicalGroupIds = new Set(Object.values(options.tabLifecycle || {})
    .filter((binding) => (
      canonicalSnapshotGroupId &&
      String(binding?.snapshotGroupId || '').trim() === canonicalSnapshotGroupId
    ))
    .map((binding) => chromeGroupId(binding?.groupId))
    .filter((groupId) => groupId !== null));
  // A live stable row is stronger evidence than a binding's cached physical
  // group id. Native Chrome events can update that cache asynchronously while
  // the snapshot row identity remains exact.
  const canonicalGroupIds = explicitCanonicalGroupIds.size > 0
    ? explicitCanonicalGroupIds
    : lifecycleCanonicalGroupIds;
  const visibleIndexes = new Map((options.visibleGroupKeys || [])
    .map((key, index) => [String(key), index]));
  const durableIndexes = new Map((options.groupOrder || [])
    .map((key, index) => [String(key), index]));
  const missingIndex = Number.MAX_SAFE_INTEGER;

  return (groups || []).map((group, sourceIndex) => {
    const groupId = chromeGroupId(group.id);
    const key = String(group.key);
    return {
      group,
      sourceIndex,
      canonicalRank: Number(!canonicalGroupIds.has(groupId)),
      visibleRank: visibleIndexes.has(key) ? visibleIndexes.get(key) : missingIndex,
      durableRank: durableIndexes.has(key) ? durableIndexes.get(key) : missingIndex,
    };
  })
    .sort((left, right) => {
      return (
        left.canonicalRank - right.canonicalRank ||
        left.visibleRank - right.visibleRank ||
        left.durableRank - right.durableRank ||
        left.sourceIndex - right.sourceIndex
      );
    })
    .map(({ group }) => group);
}

export function captureChromeGroupMutationMemory({
  state,
  logicalTitles,
  selectedTabIds,
  selectionAnchorTabId,
  dormantSpaceView,
  dormantSpaceViewSpaceId,
}) {
  return {
    state: structuredClone(state),
    logicalTitles: [...logicalTitles],
    selectedTabIds: [...selectedTabIds],
    selectionAnchorTabId,
    dormantSpaceView: structuredClone(dormantSpaceView),
    dormantSpaceViewSpaceId,
  };
}

export function projectChromeGroupRollbackMemory(snapshot, groupIdReplacements = new Map()) {
  const state = structuredClone(snapshot.state);
  remapChromeGroupBindings(state, groupIdReplacements);
  return {
    state,
    logicalTitles: remapLogicalChromeGroupTitles(
      new Map(snapshot.logicalTitles),
      groupIdReplacements,
    ),
    selectedTabIds: new Set(snapshot.selectedTabIds),
    selectionAnchorTabId: snapshot.selectionAnchorTabId,
    dormantSpaceView: structuredClone(snapshot.dormantSpaceView),
    dormantSpaceViewSpaceId: snapshot.dormantSpaceViewSpaceId,
  };
}

export function captureChromeGroupTitleRollback(titles, group = {}) {
  const remembered = Array.isArray(titles) ? titles : [];
  const groupId = chromeGroupIdFromKey(group?.key) ?? chromeGroupId(group?.id);
  if (
    groupId === null ||
    remembered.some((item) => chromeGroupId(item?.groupId) === groupId)
  ) return remembered;
  return [
    ...remembered,
    {
      groupId,
      title: group.title === ''
        ? ''
        : cleanText(group.title) || cleanText(group.displayTitle) || 'Group',
    },
  ];
}

export function resolveChromeGroupIdReplacement(groupId, groupIdReplacements = new Map()) {
  const originalGroupId = chromeGroupId(groupId);
  if (originalGroupId === null) return null;
  const replacements = normalizedChromeGroupIdReplacements(groupIdReplacements);
  const visited = new Set();
  let currentGroupId = originalGroupId;

  while (replacements.has(currentGroupId)) {
    if (visited.has(currentGroupId)) {
      throw new Error(`Chrome group replacement cycle includes ${currentGroupId}.`);
    }
    visited.add(currentGroupId);
    const nextGroupId = replacements.get(currentGroupId);
    if (nextGroupId === currentGroupId) return currentGroupId;
    currentGroupId = nextGroupId;
  }
  return currentGroupId;
}

export function remapLogicalChromeGroupTitles(
  logicalTitles,
  groupIdReplacements = new Map(),
) {
  const projected = new Map();
  const sourceByTarget = new Map();

  for (const [rawGroupId, title] of logicalTitles) {
    const groupId = chromeGroupId(rawGroupId);
    if (groupId === null) {
      throw new Error(`Invalid logical Chrome group id "${String(rawGroupId)}".`);
    }
    const targetGroupId = resolveChromeGroupIdReplacement(groupId, groupIdReplacements);
    if (sourceByTarget.has(targetGroupId)) {
      throw new Error(
        `Logical Chrome groups ${sourceByTarget.get(targetGroupId)} and ${groupId} both map to ${targetGroupId}.`,
      );
    }
    sourceByTarget.set(targetGroupId, groupId);
    projected.set(targetGroupId, title);
  }
  return projected;
}

export async function restoreTabGroupMembership(
  snapshot = {},
  operations = {},
  groupIdReplacements = new Map(),
) {
  const currentTabs = await operations.listTabs();
  const currentById = new Map((currentTabs || [])
    .map((tab) => [chromeTabId(tab?.id), tab])
    .filter(([tabId]) => tabId !== null));
  const capturedTabs = Array.isArray(snapshot.tabs) ? snapshot.tabs : [];
  const changedTabs = capturedTabs.filter((captured) => {
    const current = currentById.get(chromeTabId(captured?.tabId));
    return current && (chromeGroupId(current.groupId) ?? -1) !== (chromeGroupId(captured.groupId) ?? -1);
  });
  const accidentallyGroupedTabIds = changedTabs
    .filter((captured) => {
      const current = currentById.get(Number(captured.tabId));
      return (chromeGroupId(current?.groupId) ?? -1) >= 0;
    })
    .map((captured) => Number(captured.tabId));

  if (accidentallyGroupedTabIds.length > 0) {
    const result = await operations.ungroupTabs(accidentallyGroupedTabIds);
    assertRollbackEntityStillExists(result);
  }

  for (const group of Array.isArray(snapshot.groups) ? snapshot.groups : []) {
    const originalGroupId = chromeGroupId(group?.groupId);
    if (originalGroupId === null) continue;
    const existingTabIds = uniqueChromeTabIds(group.tabIds)
      .filter((tabId) => currentById.has(tabId));
    if (existingTabIds.length === 0) continue;
    const needsRestore = existingTabIds.some((tabId) => {
      const captured = capturedTabs.find((tab) => Number(tab?.tabId) === tabId);
      const current = currentById.get(tabId);
      return (chromeGroupId(current?.groupId) ?? -1) !== (chromeGroupId(captured?.groupId) ?? -1);
    });
    if (!needsRestore) continue;

    let restoredGroupId = chromeGroupId(await operations.addTabsToGroup(originalGroupId, existingTabIds));
    if (restoredGroupId === null) {
      restoredGroupId = chromeGroupId(await operations.createGroup(existingTabIds, {
        title: group.title === '' ? '' : cleanText(group.title) || 'Group',
        color: cleanText(group.color) || 'blue',
        collapsed: group.collapsed === true,
      }));
    }
    if (restoredGroupId === null) {
      throw new Error(`Could not restore Chrome group "${cleanText(group.title) || 'Group'}".`);
    }
    if (restoredGroupId !== originalGroupId) {
      groupIdReplacements.set(originalGroupId, restoredGroupId);
    }
  }

  await restoreTabPositions(capturedTabs, currentTabs, operations.moveTab);

  return groupIdReplacements;
}

export async function restoreTabPositions(capturedTabs = [], currentTabs = [], moveTab) {
  if (typeof moveTab !== 'function') return;
  const currentIds = new Set((currentTabs || [])
    .map((tab) => chromeTabId(tab?.id))
    .filter((tabId) => tabId !== null));
  const originalPositions = (capturedTabs || [])
    .filter((captured) => (
      currentIds.has(chromeTabId(captured?.tabId)) &&
      chromeTabIndex(captured?.index) !== null
    ))
    .sort((left, right) => (
      (chromeTabId(left.windowId) ?? -1) - (chromeTabId(right.windowId) ?? -1) ||
      Number(left.index) - Number(right.index)
    ));
  for (const position of originalPositions) {
    const result = await moveTab(position.tabId, {
      index: Number(position.index),
      ...(chromeTabId(position.windowId) === null ? {} : { windowId: Number(position.windowId) }),
    });
    assertRollbackEntityStillExists(result);
  }
}

function assertRollbackEntityStillExists(result) {
  if (result?.missing === true) {
    throw new Error('A tab closed or was replaced while Chrome group membership was being restored.');
  }
}

export function remapChromeGroupBindings(state, groupIdReplacements = new Map()) {
  for (const [rawPreviousGroupId, rawNextGroupId] of groupIdReplacements) {
    const previousGroupId = chromeGroupId(rawPreviousGroupId);
    const nextGroupId = chromeGroupId(rawNextGroupId);
    if (previousGroupId === null || nextGroupId === null || previousGroupId === nextGroupId) continue;
    const previousKey = `group:${previousGroupId}`;
    const nextKey = `group:${nextGroupId}`;

    if (Object.hasOwn(state.groupSpaces || {}, previousGroupId)) {
      state.groupSpaces[nextGroupId] = state.groupSpaces[previousGroupId];
      delete state.groupSpaces[previousGroupId];
    }
    if (Object.hasOwn(state.collapsedGroups || {}, previousKey)) {
      state.collapsedGroups[nextKey] = state.collapsedGroups[previousKey];
      delete state.collapsedGroups[previousKey];
    }
    for (const [spaceId, keys] of Object.entries(state.groupOrder || {})) {
      state.groupOrder[spaceId] = uniqueValues((keys || [])
        .map((key) => key === previousKey ? nextKey : key));
    }
    for (const order of Object.values(state.tabOrder || {})) {
      if (!Object.hasOwn(order || {}, previousKey)) continue;
      order[nextKey] = uniqueValues([...(order[previousKey] || []), ...(order[nextKey] || [])]);
      delete order[previousKey];
    }
    for (const binding of Object.values(state.tabLifecycle || {})) {
      if (chromeGroupId(binding?.groupId) === previousGroupId) binding.groupId = nextGroupId;
    }
  }
  return state;
}

export async function runChromeGroupMutationTransaction({ apply, checkpoint, rollback }) {
  try {
    const result = await apply();
    await checkpoint(result);
    return result;
  } catch (error) {
    try {
      await rollback(error);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `${errorMessage(error)} Chrome group rollback was incomplete.`,
        { cause: error },
      );
    }
    throw error;
  }
}

function uniqueChromeTabIds(values = []) {
  return [...new Set((values || [])
    .map(chromeTabId)
    .filter((tabId) => tabId !== null))];
}

function chromeTabId(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function chromeGroupId(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function chromeGroupIdFromKey(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^group:(\d+)$/);
  return match ? chromeGroupId(match[1]) : null;
}

function normalizedChromeGroupIdReplacements(groupIdReplacements) {
  const normalized = new Map();
  for (const [rawPreviousGroupId, rawNextGroupId] of groupIdReplacements) {
    const previousGroupId = chromeGroupId(rawPreviousGroupId);
    const nextGroupId = chromeGroupId(rawNextGroupId);
    if (previousGroupId === null || nextGroupId === null) continue;
    if (
      normalized.has(previousGroupId) &&
      normalized.get(previousGroupId) !== nextGroupId
    ) {
      throw new Error(`Chrome group ${previousGroupId} has conflicting replacement ids.`);
    }
    normalized.set(previousGroupId, nextGroupId);
  }
  return normalized;
}

function chromeTabIndex(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueValues(values = []) {
  return [...new Set(values)];
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}
