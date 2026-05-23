export function shouldAutoCloseTab(tab = {}) {
  return !tab.pinned;
}

export function isRestorableSnapshotTab(tab = {}) {
  const url = String(tab.url || '').trim();
  return Boolean(url) && url !== 'chrome://newtab';
}

export function buildSpaceSnapshot({ view = [], now = Date.now() } = {}) {
  return {
    version: 1,
    updatedAt: now,
    groups: view
      .map((group) => ({
        title: group.title || 'Ungrouped',
        color: group.color || 'grey',
        collapsed: Boolean(group.collapsed),
        tabs: (group.tabs || [])
          .filter(shouldAutoCloseTab)
          .filter(isRestorableSnapshotTab)
          .map((tab) => ({
            title: tab.displayTitle || tab.title || tab.url || 'Untitled',
            url: String(tab.url || '').trim(),
          })),
      }))
      .filter((group) => group.tabs.length > 0),
  };
}

export function snapshotTabCount(snapshot = {}) {
  return (snapshot?.groups || []).reduce((sum, group) => sum + (group.tabs || []).length, 0);
}

export function dropTemporarySnapshotGroups(snapshot) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  if (!snapshot) return null;
  return {
    ...snapshot,
    groups: (snapshot.groups || []).filter((group) => !isUngroupedSnapshotGroup(group)),
  };
}

export function removeSnapshotTab(snapshot, target = {}) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  if (!snapshot) return null;
  const targetUrl = String(target.url || '');
  const targetGroupTitle = String(target.groupTitle || '');
  const targetGroupColor = String(target.groupColor || '');
  let removed = false;
  const groups = [];

  for (const group of snapshot.groups || []) {
    const groupMatches = (
      (!targetGroupTitle || String(group.title || 'Ungrouped') === targetGroupTitle) &&
      (!targetGroupColor || String(group.color || 'grey') === targetGroupColor)
    );
    const tabs = [];
    for (const tab of group.tabs || []) {
      if (!removed && groupMatches && targetUrl && tab.url === targetUrl) {
        removed = true;
        continue;
      }
      tabs.push(tab);
    }
    if (tabs.length > 0) groups.push({ ...group, tabs });
  }

  return { ...snapshot, groups };
}

export function mergeSpaceSnapshot(liveSnapshot, storedSnapshot) {
  liveSnapshot = sanitizeSpaceSnapshot(liveSnapshot);
  storedSnapshot = sanitizeSpaceSnapshot(storedSnapshot);
  if (!storedSnapshot || snapshotTabCount(storedSnapshot) === 0) return liveSnapshot || null;
  if (!liveSnapshot || snapshotTabCount(liveSnapshot) === 0) return storedSnapshot;

  const liveUrls = new Set(snapshotTabs(liveSnapshot).map((tab) => tab.url).filter(Boolean));
  const liveGroupsByKey = new Map((liveSnapshot.groups || []).map((group) => [snapshotGroupKey(group), group]));
  const mergedGroups = [];

  for (const storedGroup of storedSnapshot.groups || []) {
    const key = snapshotGroupKey(storedGroup);
    const liveGroup = liveGroupsByKey.get(key);
    const dormantTabs = (storedGroup.tabs || []).filter((tab) => !liveUrls.has(tab.url));
    if (liveGroup) {
      mergedGroups.push({
        ...liveGroup,
        tabs: [...(liveGroup.tabs || []), ...dormantTabs],
      });
      liveGroupsByKey.delete(key);
    } else if (dormantTabs.length > 0) {
      mergedGroups.push({
        ...storedGroup,
        tabs: dormantTabs,
      });
    }
  }

  for (const group of liveGroupsByKey.values()) {
    if ((group.tabs || []).length > 0) mergedGroups.push(group);
  }

  return {
    version: liveSnapshot.version || storedSnapshot.version || 1,
    updatedAt: liveSnapshot.updatedAt || Date.now(),
    groups: mergedGroups.filter((group) => (group.tabs || []).length > 0),
  };
}

export function isUngroupedSnapshotGroup(group = {}) {
  return group.title === 'Ungrouped' && (group.color || 'grey') === 'grey';
}

export function sanitizeSpaceSnapshot(snapshot) {
  if (!snapshot) return null;
  const groups = (snapshot.groups || [])
    .map((group) => ({
      ...group,
      title: group.title || 'Ungrouped',
      color: group.color || (group.title === 'Ungrouped' ? 'grey' : 'blue'),
      tabs: (group.tabs || [])
        .filter(isRestorableSnapshotTab)
        .map((tab) => ({
          ...tab,
          title: tab.title || tab.url || 'Untitled',
          url: String(tab.url || '').trim(),
        })),
    }))
    .filter((group) => group.tabs.length > 0);
  return { ...snapshot, groups };
}

function snapshotTabs(snapshot = {}) {
  return (snapshot.groups || []).flatMap((group) => group.tabs || []);
}

function snapshotGroupKey(group = {}) {
  return `${group.title || 'Ungrouped'}\n${group.color || 'grey'}`;
}
