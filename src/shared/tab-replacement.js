import { replaceSelectionTabId } from './tab-selection.js';

/**
 * Rebinds panel-local state after Chrome replaces one live tab id with another.
 * The transform is deliberately UI-free so callers can apply the returned model
 * before handling drag cancellation or rendering side effects.
 */
export function migratePanelTabIdReplacement(model = {}, replacement = {}) {
  const source = isRecord(model) ? model : {};
  const replacementSource = isRecord(replacement) ? replacement : {};
  const addedTabId = normalizeTabId(replacementSource.addedTabId);
  const removedTabId = normalizeTabId(replacementSource.removedTabId);
  if (
    addedTabId === null ||
    removedTabId === null ||
    addedTabId === removedTabId
  ) {
    return { ...source, replacementApplied: false, dragInvalidated: false };
  }

  const replacementTab = isRecord(replacementSource.replacementTab)
    ? replacementSource.replacementTab
    : {};
  const liveTabs = migrateLiveTabCollection(
    source.tabs,
    removedTabId,
    addedTabId,
    replacementTab,
  );
  const foreignLiveTabs = migrateLiveTabCollection(
    source.foreignLiveTabs,
    removedTabId,
    addedTabId,
    replacementTab,
  );
  const selection = replaceSelectionTabId({
    selectedTabIds: iterableValues(source.selectedTabIds),
    anchorTabId: source.selectionAnchorTabId,
    removedTabId,
    addedTabId,
  });
  return {
    ...source,
    replacementApplied: true,
    visibleTabsChanged: liveTabs.changed || foreignLiveTabs.changed,
    tabs: liveTabs.tabs,
    foreignLiveTabs: foreignLiveTabs.tabs,
    dragInvalidated: source.dragState?.type === 'tab' &&
      tabIdEquals(source.dragState.tabId, removedTabId),
    selectedTabIds: selection.selectedTabIds,
    selectionAnchorTabId: selection.anchorTabId,
    recentlyOpenedDormantTabs: migrateDormantTabs(
      source.recentlyOpenedDormantTabs,
      removedTabId,
      addedTabId,
    ),
    syntheticPlaceholderTabIds: migrateSyntheticTabIds(
      source.syntheticPlaceholderTabIds,
      removedTabId,
      addedTabId,
    ),
  };
}

function migrateLiveTabCollection(tabs, removedTabId, addedTabId, replacementTab) {
  if (!Array.isArray(tabs)) return { tabs: [], changed: false };

  let removedTab = null;
  let addedTab = null;
  let insertionIndex = -1;
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (!isRecord(tab)) continue;
    const tabId = normalizeTabId(tab.id);
    if (tabId !== removedTabId && tabId !== addedTabId) continue;
    if (insertionIndex < 0) insertionIndex = index;
    if (tabId === removedTabId && removedTab === null) removedTab = tab;
    if (tabId === addedTabId && addedTab === null) addedTab = tab;
  }

  if (insertionIndex < 0) return { tabs, changed: false };

  const migratedTab = {
    ...(removedTab || {}),
    ...(addedTab || {}),
    ...replacementTab,
    id: addedTabId,
  };
  const migratedTabs = [];
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    const tabId = isRecord(tab) ? normalizeTabId(tab.id) : null;
    if (index === insertionIndex) migratedTabs.push(migratedTab);
    if (tabId === removedTabId || tabId === addedTabId) continue;
    migratedTabs.push(tab);
  }
  return { tabs: migratedTabs, changed: true };
}

function migrateDormantTabs(tabs, removedTabId, addedTabId) {
  if (!Array.isArray(tabs)) return [];
  return tabs.map((tab) => (
    tabIdEquals(tab?.tabId, removedTabId) ? { ...tab, tabId: addedTabId } : tab
  ));
}

function migrateSyntheticTabIds(tabIds, removedTabId, addedTabId) {
  const migrated = new Set(iterableValues(tabIds));
  if (migrated.delete(removedTabId)) migrated.add(addedTabId);
  return [...migrated];
}

function iterableValues(value) {
  return Array.isArray(value) || value instanceof Set ? [...value] : [];
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeTabId(value) {
  if (value === null || value === undefined || value === '') return null;
  const tabId = Number(value);
  return Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null;
}

function tabIdEquals(value, expected) {
  return normalizeTabId(value) === expected;
}
