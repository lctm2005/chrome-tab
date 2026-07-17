export function tabSelectionFromClick({
  orderedTabIds = [],
  selectedTabIds = [],
  anchorTabId = null,
  clickedTabId,
  additive = false,
  range = false,
} = {}) {
  const clicked = normalizeTabId(clickedTabId);
  if (clicked === null) return normalizeSelection(selectedTabIds, anchorTabId);

  const ordered = normalizeTabIds(orderedTabIds);
  const selected = new Set(normalizeTabIds(selectedTabIds));

  if (range) {
    const normalizedAnchor = normalizeTabId(anchorTabId);
    const anchor = normalizedAnchor === null ? clicked : normalizedAnchor;
    const anchorIndex = ordered.indexOf(anchor);
    const clickedIndex = ordered.indexOf(clicked);
    if (anchorIndex >= 0 && clickedIndex >= 0) {
      const [start, end] = [anchorIndex, clickedIndex].sort((a, b) => a - b);
      return {
        selectedTabIds: ordered.slice(start, end + 1),
        anchorTabId: anchor,
      };
    }
  }

  if (additive) {
    if (selected.has(clicked)) selected.delete(clicked);
    else selected.add(clicked);
    return {
      selectedTabIds: [...selected],
      anchorTabId: clicked,
    };
  }

  return {
    selectedTabIds: [clicked],
    anchorTabId: clicked,
  };
}

export function selectionForContextMenu({ selectedTabIds = [], clickedTabId } = {}) {
  const clicked = normalizeTabId(clickedTabId);
  if (clicked === null) return [];
  const selected = normalizeTabIds(selectedTabIds);
  return selected.includes(clicked) ? selected : [clicked];
}

export function replaceSelectionTabId({
  selectedTabIds = [],
  anchorTabId = null,
  removedTabId,
  addedTabId,
} = {}) {
  const removed = normalizeTabId(removedTabId);
  const added = normalizeTabId(addedTabId);
  const selection = normalizeSelection(selectedTabIds, anchorTabId);
  if (removed === null || added === null || removed === added) return selection;

  const replaced = selection.selectedTabIds.map((tabId) => (
    tabId === removed ? added : tabId
  ));
  return {
    selectedTabIds: normalizeTabIds(replaced),
    anchorTabId: selection.anchorTabId === removed ? added : selection.anchorTabId,
  };
}

export function resolveFreshTabSelection({
  requestedTabIds = [],
  tabs = [],
  isEligible = () => true,
} = {}) {
  const requested = normalizeTabIds(requestedTabIds);
  if (requested.length === 0) {
    return {
      status: 'empty',
      requestedTabIds: [],
      selectedTabs: [],
      unavailableTabIds: [],
    };
  }

  const tabsById = new Map();
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const id = normalizeTabId(tab?.id);
    if (id === null || tabsById.has(id)) continue;
    tabsById.set(id, tab);
  }
  const eligible = typeof isEligible === 'function' ? isEligible : () => true;
  const selectedTabs = [];
  const unavailableTabIds = [];
  for (const id of requested) {
    const tab = tabsById.get(id);
    if (!tab || !eligible(tab)) unavailableTabIds.push(id);
    else selectedTabs.push(tab);
  }

  return {
    status: unavailableTabIds.length > 0 ? 'stale' : 'ready',
    requestedTabIds: requested,
    selectedTabs,
    unavailableTabIds,
  };
}

function normalizeSelection(selectedTabIds, anchorTabId) {
  const anchor = normalizeTabId(anchorTabId);
  return {
    selectedTabIds: normalizeTabIds(selectedTabIds),
    anchorTabId: anchor,
  };
}

function normalizeTabIds(values) {
  const ids = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = normalizeTabId(value);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeTabId(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : null;
}
