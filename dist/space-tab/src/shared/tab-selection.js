export function tabSelectionFromClick({
  orderedTabIds = [],
  selectedTabIds = [],
  anchorTabId = null,
  clickedTabId,
  additive = false,
  range = false,
} = {}) {
  const clicked = Number(clickedTabId);
  if (!Number.isFinite(clicked)) return normalizeSelection(selectedTabIds, anchorTabId);

  const ordered = orderedTabIds.map(Number).filter(Number.isFinite);
  const selected = new Set(selectedTabIds.map(Number).filter(Number.isFinite));

  if (range) {
    const anchor = Number.isFinite(Number(anchorTabId)) ? Number(anchorTabId) : clicked;
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
  const clicked = Number(clickedTabId);
  if (!Number.isFinite(clicked)) return [];
  const selected = selectedTabIds.map(Number).filter(Number.isFinite);
  return selected.includes(clicked) ? selected : [clicked];
}

function normalizeSelection(selectedTabIds, anchorTabId) {
  return {
    selectedTabIds: selectedTabIds.map(Number).filter(Number.isFinite),
    anchorTabId: Number.isFinite(Number(anchorTabId)) ? Number(anchorTabId) : null,
  };
}
