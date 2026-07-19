function chromeTabIndex(value) {
  if (value === null || value === undefined || value === '') return null;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function indexAfterRemovingSource(sourceIndex, insertionIndex) {
  return sourceIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
}

export function moveIndexBeforeTab(sourceIndexValue, targetIndexValue) {
  const sourceIndex = chromeTabIndex(sourceIndexValue);
  const targetIndex = chromeTabIndex(targetIndexValue);
  if (sourceIndex === null || targetIndex === null) return null;
  return indexAfterRemovingSource(sourceIndex, targetIndex);
}

export function moveIndexAfterTabs(sourceIndexValue, targetIndexValues = []) {
  const sourceIndex = chromeTabIndex(sourceIndexValue);
  if (sourceIndex === null) return null;
  const targetIndexes = (Array.isArray(targetIndexValues) ? targetIndexValues : [])
    .map(chromeTabIndex)
    .filter((index) => index !== null && index !== sourceIndex);
  if (targetIndexes.length === 0) return sourceIndex;
  const insertionIndex = Math.max(...targetIndexes) + 1;
  return indexAfterRemovingSource(sourceIndex, insertionIndex);
}

export function planTabDropOrder({
  tabId: tabIdValue,
  targetTabIds = [],
  beforeTabId: beforeTabIdValue = null,
} = {}) {
  const tabId = chromeTabIndex(tabIdValue);
  if (tabId === null) return invalidDropPlan();

  const originalOrder = uniqueChromeTabIds(targetTabIds);
  const targetOrder = originalOrder.filter((id) => id !== tabId);
  const hasBeforeTab = beforeTabIdValue !== null && beforeTabIdValue !== undefined;
  if (hasBeforeTab) {
    const beforeTabId = chromeTabIndex(beforeTabIdValue);
    if (beforeTabId === null) return invalidDropPlan();
    if (beforeTabId === tabId) {
      return {
        status: 'noop',
        order: originalOrder,
        anchorTabId: beforeTabId,
        edge: 'before',
      };
    }
    const insertAt = targetOrder.indexOf(beforeTabId);
    if (insertAt < 0) {
      return { status: 'stale', order: originalOrder, anchorTabId: beforeTabId, edge: 'before' };
    }
    targetOrder.splice(insertAt, 0, tabId);
    return {
      status: sameTabOrder(targetOrder, originalOrder) ? 'noop' : 'move',
      order: targetOrder,
      anchorTabId: beforeTabId,
      edge: 'before',
    };
  }

  const anchorTabId = targetOrder.at(-1) ?? null;
  targetOrder.push(tabId);
  return {
    status: sameTabOrder(targetOrder, originalOrder) ? 'noop' : 'move',
    order: targetOrder,
    anchorTabId,
    edge: 'after',
  };
}

/**
 * Plans a drag against the rows the user can actually see. Saved-only rows do
 * not have Chrome tab ids, so they participate in the durable visible order
 * while the browser move is anchored to the closest live peer.
 */
export function planMixedTabDropOrder({
  tab,
  targetTabs = [],
  beforeTab = null,
} = {}) {
  const tabId = liveTabId(tab);
  const sourceKey = visibleTabKey(tab);
  const rows = Array.isArray(targetTabs) ? [...targetTabs] : [];
  const rowKeys = rows.map(visibleTabKey);
  if (
    tabId === null ||
    !sourceKey ||
    rowKeys.some((key) => !key) ||
    new Set(rowKeys).size !== rowKeys.length
  ) return invalidMixedDropPlan();

  const originalLiveOrder = rows.map(liveTabId).filter((id) => id !== null);
  const sourceWasInTarget = rowKeys.includes(sourceKey);
  const hasBeforeTab = beforeTab !== null && beforeTab !== undefined;
  const beforeKey = hasBeforeTab ? visibleTabKey(beforeTab) : '';
  if (hasBeforeTab && !beforeKey) return invalidMixedDropPlan();
  if (beforeKey === sourceKey) {
    return sourceWasInTarget
      ? mixedDropPlan('noop', rows, originalLiveOrder, null, null)
      : mixedDropPlan('stale', rows, originalLiveOrder, null, null);
  }

  const nextRows = rows.filter((_, index) => rowKeys[index] !== sourceKey);
  if (hasBeforeTab) {
    const insertAt = nextRows.findIndex((row) => visibleTabKey(row) === beforeKey);
    if (insertAt < 0) {
      return mixedDropPlan('stale', rows, originalLiveOrder, null, null);
    }
    nextRows.splice(insertAt, 0, tab);
  } else {
    nextRows.push(tab);
  }

  const nextKeys = nextRows.map(visibleTabKey);
  const status = sameValueOrder(nextKeys, rowKeys) ? 'noop' : 'move';
  if (status === 'noop') {
    return mixedDropPlan(status, nextRows, originalLiveOrder, null, null);
  }
  const anchor = nearestLiveAnchor(nextRows, sourceKey);
  return mixedDropPlan(
    status,
    nextRows,
    nextRows.map(liveTabId).filter((id) => id !== null),
    anchor.tabId,
    anchor.edge,
  );
}

/**
 * Places a newly duplicated Chrome tab immediately after the source in the
 * order the user can currently see. The visible order is authoritative here:
 * a saved order can temporarily omit a newly adopted or replaced source tab,
 * which would otherwise sort the duplicate ahead of its source.
 */
export function tabOrderAfterDuplicate(visibleTabIds = [], sourceTabIdValue, duplicateTabIdValue) {
  const sourceTabId = chromeTabIndex(sourceTabIdValue);
  const duplicateTabId = chromeTabIndex(duplicateTabIdValue);
  if (sourceTabId === null || duplicateTabId === null || sourceTabId === duplicateTabId) {
    return uniqueChromeTabIds(visibleTabIds);
  }

  const order = uniqueChromeTabIds(visibleTabIds).filter((tabId) => tabId !== duplicateTabId);
  if (!order.includes(sourceTabId)) order.push(sourceTabId);
  order.splice(order.indexOf(sourceTabId) + 1, 0, duplicateTabId);
  return order;
}

function uniqueChromeTabIds(values = []) {
  const seen = new Set();
  const ids = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = chromeTabIndex(value);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function visibleTabKey(tab) {
  const tabId = liveTabId(tab);
  if (tabId !== null) return `live:${tabId}`;
  if (!tab || typeof tab !== 'object' || tab.dormant !== true) return '';
  const snapshotTabId = String(tab.snapshotTabId || '').trim();
  if (snapshotTabId) return `snapshot:${snapshotTabId}`;
  const renderedId = String(tab.id || '').trim();
  return renderedId ? `dormant:${renderedId}` : '';
}

function liveTabId(tab) {
  if (!tab || typeof tab !== 'object' || tab.dormant === true) return null;
  return chromeTabIndex(tab.id);
}

function nearestLiveAnchor(rows, sourceKey) {
  const sourceIndex = rows.findIndex((row) => visibleTabKey(row) === sourceKey);
  for (let distance = 1; distance < rows.length; distance += 1) {
    const followingId = liveTabId(rows[sourceIndex + distance]);
    if (followingId !== null) return { tabId: followingId, edge: 'before' };
    const precedingId = liveTabId(rows[sourceIndex - distance]);
    if (precedingId !== null) return { tabId: precedingId, edge: 'after' };
  }
  return { tabId: null, edge: null };
}

function mixedDropPlan(status, visibleTabs, order, anchorTabId, edge) {
  return { status, visibleTabs, order, anchorTabId, edge };
}

function invalidMixedDropPlan() {
  return mixedDropPlan('invalid', [], [], null, null);
}

function sameTabOrder(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameValueOrder(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalidDropPlan() {
  return { status: 'invalid', order: [], anchorTabId: null, edge: null };
}
