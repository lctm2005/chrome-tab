export async function closeTabIdsSequentially(tabIds = [], closeTab, options = {}) {
  const closedTabIds = [];
  for (const rawTabId of tabIds) {
    const tabId = Number(rawTabId);
    try {
      await options.beforeClose?.(tabId, {
        closedTabIds: [...closedTabIds],
      });
      await closeTab(tabId);
      closedTabIds.push(tabId);
    } catch (error) {
      return {
        closedTabIds,
        failedTabId: tabId,
        error,
      };
    }
  }
  return {
    closedTabIds,
    failedTabId: null,
    error: null,
  };
}

/**
 * Closes a reviewed batch while treating a last-moment target mismatch as a
 * protected skip instead of a transaction failure. Inspection happens before
 * every individual close; the close callback can also report a later guard
 * race that happened after inspection but before Chrome removed the tab.
 */
export async function closeGuardedTabIdsSequentially(
  tabIds = [],
  inspectTab,
  closeTab,
) {
  const closedTabIds = [];
  const skippedTabs = [];
  for (const rawTabId of tabIds) {
    const tabId = Number(rawTabId);
    try {
      const reason = await inspectTab(tabId, {
        closedTabIds: [...closedTabIds],
        skippedTabs: skippedTabs.map((entry) => ({ ...entry })),
      });
      if (reason) {
        skippedTabs.push({ tabId, reason: String(reason) });
        continue;
      }
      const response = await closeTab(tabId);
      if (response?.skipped === true) {
        skippedTabs.push({
          tabId,
          reason: String(response.reason || 'changed'),
        });
        continue;
      }
      closedTabIds.push(tabId);
    } catch (error) {
      return {
        closedTabIds,
        skippedTabs,
        failedTabId: tabId,
        error,
      };
    }
  }
  return {
    closedTabIds,
    skippedTabs,
    failedTabId: null,
    error: null,
  };
}

export async function rollbackCreatedTabsOnCheckpointFailure(
  createdTabIds = [],
  checkpoint,
  closeCreatedTab,
) {
  try {
    return await checkpoint();
  } catch (error) {
    const rollbackFailures = [];
    const ids = [...new Set(createdTabIds.map(Number).filter(Number.isSafeInteger))].reverse();
    for (const tabId of ids) {
      try {
        await closeCreatedTab(tabId);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        `${error?.message || String(error)} Checkpoint cleanup could not close every created tab.`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function runDestructiveTabClose({
  tabIds = [],
  checkpoint,
  beforeClose,
  closeTab,
  commit,
  reconcile,
}) {
  await checkpoint();
  const resolvedTabIds = typeof tabIds === 'function' ? await tabIds() : tabIds;
  const result = await closeTabIdsSequentially(resolvedTabIds, closeTab, { beforeClose });
  if (result.error) {
    await reconcileWithoutMaskingFailure(reconcile, result);
    throw result.error;
  }
  try {
    await commit(result.closedTabIds);
  } catch (error) {
    await reconcileWithoutMaskingFailure(reconcile, {
      ...result,
      error,
    });
    throw error;
  }
  return result.closedTabIds;
}

/**
 * Durable destructive-close transaction for user-reviewed batches whose
 * individual targets can become unsafe while the batch is running. Changed
 * targets are preserved, safe targets continue, and commit receives the exact
 * physical outcome so it never deletes metadata for a skipped tab.
 */
export async function runGuardedDestructiveTabClose({
  tabIds = [],
  checkpoint,
  inspectTab,
  closeTab,
  commit,
  reconcile,
}) {
  await checkpoint();
  const resolvedTabIds = typeof tabIds === 'function' ? await tabIds() : tabIds;
  const result = await closeGuardedTabIdsSequentially(
    resolvedTabIds,
    inspectTab,
    closeTab,
  );
  if (result.error) {
    await reconcileWithoutMaskingFailure(reconcile, result);
    throw result.error;
  }
  try {
    await commit({
      closedTabIds: [...result.closedTabIds],
      skippedTabs: result.skippedTabs.map((entry) => ({ ...entry })),
    });
  } catch (error) {
    await reconcileWithoutMaskingFailure(reconcile, {
      ...result,
      error,
    });
    throw error;
  }
  return result;
}

/**
 * Checks the physical Chrome properties that must still match immediately
 * before a destructive close. An empty string means the guard still matches;
 * any non-empty result is a fail-closed reason for the caller to surface.
 */
export function tabCloseGuardMismatch(tab, guard = {}) {
  const expectedTabId = chromeTabId(guard.tabId);
  const currentTabId = chromeTabId(tab?.id);
  if (expectedTabId === null || currentTabId !== expectedTabId) return 'missing-or-replaced';
  if (guard.requireUnpinned === true && tab?.pinned === true) return 'pinned';

  const expectedWindowId = chromeTabId(guard.windowId);
  if (expectedWindowId !== null && chromeTabId(tab?.windowId) !== expectedWindowId) {
    return 'moved-window';
  }

  const expectedGroupId = chromeGroupId(guard.groupId);
  if (expectedGroupId !== null && chromeGroupId(tab?.groupId) !== expectedGroupId) {
    return 'moved-group';
  }
  if (
    Object.hasOwn(guard, 'url') &&
    String(tab?.pendingUrl || tab?.url || '') !== String(guard.url || '')
  ) return 'navigated';
  return '';
}

/**
 * Creates the immutable physical identity passed to the background worker for
 * its final check immediately before chrome.tabs.remove().
 */
export function tabCloseGuardFor(tab = {}) {
  return {
    tabId: tab?.id,
    requireUnpinned: true,
    windowId: tab?.windowId,
    groupId: tab?.groupId,
    url: String(tab?.pendingUrl || tab?.url || ''),
  };
}

/**
 * Revalidates one reviewed Group Delete / Ungrouped Clear target using a fresh
 * browser inventory and the latest durable ownership projection.
 */
export function reviewedTabCloseCandidateMismatch({
  expectedTab,
  currentTabs = [],
  state = {},
  targetSpaceId = '',
  targetGroupKey = '',
} = {}) {
  const expectedTabId = chromeTabId(expectedTab?.id);
  if (expectedTabId === null) return 'missing-or-replaced';
  const matches = (Array.isArray(currentTabs) ? currentTabs : [])
    .filter((tab) => chromeTabId(tab?.id) === expectedTabId);
  if (matches.length !== 1) return 'missing-or-replaced';

  const currentTab = matches[0];
  const physicalMismatch = tabCloseGuardMismatch(
    currentTab,
    tabCloseGuardFor(expectedTab),
  );
  if (physicalMismatch) return physicalMismatch;

  const binding = objectRecord(state.tabLifecycle)?.[expectedTabId];
  const expectedSnapshotTabId = String(expectedTab?.snapshotTabId || '');
  if (
    expectedSnapshotTabId &&
    String(binding?.snapshotTabId || '') !== expectedSnapshotTabId
  ) return 'stable-identity-changed';
  const expectedSessionId = String(expectedTab?.sessionId || '');
  if (expectedSessionId && String(binding?.sessionId || '') !== expectedSessionId) {
    return 'stable-identity-changed';
  }

  if (
    targetSpaceId &&
    !tabMatchesDestructiveTarget(currentTab, state, targetSpaceId, targetGroupKey)
  ) return 'moved-space-or-group';
  if (
    !targetSpaceId &&
    targetGroupKey &&
    !tabMatchesTargetGroup(currentTab, state, targetGroupKey)
  ) return 'moved-group';
  return '';
}

/**
 * Answers whether a live tab still belongs to the reviewed Space and logical
 * group. This is also used after a partial batch to decide whether group
 * metadata must remain for protected or newly-added members.
 */
export function tabMatchesDestructiveTarget(
  tab,
  state = {},
  targetSpaceId = '',
  targetGroupKey = '',
) {
  const tabId = chromeTabId(tab?.id);
  if (tabId === null) return false;
  const groupId = chromeGroupId(tab?.groupId);
  const grouped = groupId !== null && groupId >= 0;
  const spaceMatches = grouped
    ? String(objectRecord(state.groupSpaces)?.[groupId] || '') === String(targetSpaceId || '')
    : String(objectRecord(state.tabSpaces)?.[tabId] || '') === String(targetSpaceId || '');
  if (!spaceMatches) return false;
  return !targetGroupKey || tabMatchesTargetGroup(tab, state, targetGroupKey);
}

function tabMatchesTargetGroup(tab, state, targetGroupKey) {
  const tabId = chromeTabId(tab?.id);
  const groupId = chromeGroupId(tab?.groupId);
  if (tabId === null || groupId === null) return false;
  const key = String(targetGroupKey);
  if (key === 'ungrouped') {
    return groupId === -1 && !String(objectRecord(state.tabGroups)?.[tabId] || '');
  }
  if (key.startsWith('group:')) {
    const expectedGroupId = chromeGroupId(key.slice('group:'.length));
    return expectedGroupId !== null && expectedGroupId >= 0 && groupId === expectedGroupId;
  }
  return groupId === -1 && String(objectRecord(state.tabGroups)?.[tabId] || '') === key;
}

async function reconcileWithoutMaskingFailure(reconcile, result) {
  try {
    await reconcile(result);
  } catch {
    // The original close or commit error is the actionable failure. Durable
    // recovery still starts from the checkpoint even if immediate UI refresh fails.
  }
}

function chromeTabId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

function chromeGroupId(value) {
  const groupId = Number(value);
  return Number.isSafeInteger(groupId) && groupId >= -1 ? groupId : null;
}

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
