/**
 * Freezes the user-visible tab target while the Command Palette still reflects
 * one coherent render. Foreign-window tabs are rendered through their saved
 * row, so their physical Chrome id must win over the dormant-looking row id.
 */
export function captureCommandPaletteTabSelection(item = {}, liveTabs = []) {
  const source = record(item);
  const tab = record(source.tab);
  const tabId = paletteLiveTabId(tab);
  const physical = uniquePhysicalTab(liveTabs, tabId) || (tabId === chromeTabId(tab.id) ? tab : {});
  const live = tabId !== null;
  return {
    spaceId: clean(source.spaceId || tab.spaceId),
    mode: live ? 'live' : 'dormant',
    tabId,
    url: tabUrl(live ? physical : tab),
    snapshotTabId: identity(live ? physical.snapshotTabId : tab.snapshotTabId),
    sessionId: identity(live ? physical.sessionId : tab.sessionId),
    groupKey: clean(tab.dormantGroupKey),
  };
}

/**
 * Resolves a frozen selection against a freshly loaded browser + workspace
 * projection. A Chrome replacement may change the physical id, but only one
 * candidate with the same durable identity and URL is allowed to follow it.
 */
export function resolveCommandPaletteTabSelection(reference = {}, context = {}) {
  const spaceId = clean(reference.spaceId);
  if (!spaceId || !array(context.spaces).some((space) => clean(space?.id) === spaceId)) return null;

  const entries = paletteEntries(context.spaceView, spaceId);
  const liveTabs = array(context.liveTabs);
  if (reference.mode === 'live') {
    return resolveLiveSelection(reference, spaceId, entries, liveTabs);
  }
  return resolveDormantSelection(reference, spaceId, entries, liveTabs);
}

export function commandPaletteFocusGuard(tab = {}) {
  const tabId = chromeTabId(tab.id);
  if (tabId === null) return null;
  return {
    tabId,
    windowId: tab.windowId,
    groupId: tab.groupId,
    url: tabUrl(tab),
  };
}

function resolveLiveSelection(reference, spaceId, entries, liveTabs) {
  const expectedTabId = chromeTabId(reference.tabId);
  let candidates = expectedTabId === null
    ? []
    : entries.filter((entry) => paletteLiveTabId(entry.tab) === expectedTabId);
  let replaced = false;

  if (candidates.length !== 1) {
    const snapshotTabId = identity(reference.snapshotTabId);
    if (!snapshotTabId) return null;
    candidates = entries.filter((entry) => {
      const tabId = paletteLiveTabId(entry.tab);
      const physical = uniquePhysicalTab(liveTabs, tabId);
      return tabId !== null &&
        identity(physical?.snapshotTabId) === snapshotTabId &&
        tabUrl(physical) === String(reference.url || '') &&
        sessionMatches(reference, physical);
    });
    if (candidates.length !== 1) return null;
    replaced = paletteLiveTabId(candidates[0].tab) !== expectedTabId;
  }

  const entry = candidates[0];
  const tabId = paletteLiveTabId(entry.tab);
  const physical = uniquePhysicalTab(liveTabs, tabId);
  if (!physical || tabUrl(physical) !== String(reference.url || '')) return null;
  if (identity(reference.snapshotTabId) &&
      identity(physical.snapshotTabId) !== identity(reference.snapshotTabId)) return null;
  if (!sessionMatches(reference, physical)) return null;
  return {
    mode: 'live',
    spaceId,
    tab: physical,
    paletteTab: entry.tab,
    groupKey: entry.groupKey,
    replaced,
  };
}

function resolveDormantSelection(reference, spaceId, entries, liveTabs) {
  const snapshotTabId = identity(reference.snapshotTabId);
  const expectedUrl = String(reference.url || '');
  const candidates = entries.filter((entry) => {
    if (tabUrl(entry.tab) !== expectedUrl) return false;
    if (snapshotTabId) return identity(entry.tab.snapshotTabId) === snapshotTabId;
    return clean(entry.groupKey) === clean(reference.groupKey);
  });
  if (candidates.length !== 1) return null;

  const entry = candidates[0];
  const tabId = paletteLiveTabId(entry.tab);
  if (tabId === null) {
    return {
      mode: 'dormant',
      spaceId,
      tab: entry.tab,
      groupKey: entry.groupKey,
      replaced: false,
    };
  }

  const physical = uniquePhysicalTab(liveTabs, tabId);
  if (!physical || tabUrl(physical) !== expectedUrl) return null;
  if (snapshotTabId && identity(physical.snapshotTabId) &&
      identity(physical.snapshotTabId) !== snapshotTabId) return null;
  return {
    mode: 'live',
    spaceId,
    tab: physical,
    paletteTab: entry.tab,
    groupKey: entry.groupKey,
    replaced: false,
  };
}

function paletteEntries(spaceView, spaceId) {
  return array(spaceView).flatMap((group) => {
    const groupSpaceId = clean(group?.spaceId);
    return array(group?.tabs).flatMap((tab) => {
      const tabSpaceId = clean(tab?.spaceId || groupSpaceId);
      if (tabSpaceId !== spaceId) return [];
      return [{ tab, groupKey: clean(group?.key || tab?.dormantGroupKey) }];
    });
  });
}

function paletteLiveTabId(tab = {}) {
  const foreignTabId = chromeTabId(tab.foreignWindowTabId);
  if (foreignTabId !== null) return foreignTabId;
  return tab.dormant === true ? null : chromeTabId(tab.id);
}

function uniquePhysicalTab(liveTabs, tabId) {
  if (tabId === null) return null;
  const matches = array(liveTabs).filter((tab) => chromeTabId(tab?.id) === tabId);
  return matches.length === 1 ? matches[0] : null;
}

function sessionMatches(reference, tab) {
  const expected = identity(reference.sessionId);
  return !expected || identity(tab?.sessionId) === expected;
}

function chromeTabId(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

function tabUrl(tab = {}) {
  return String(tab?.pendingUrl || tab?.url || '');
}

function identity(value) {
  return clean(value).slice(0, 128);
}

function clean(value) {
  return String(value ?? '').trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
