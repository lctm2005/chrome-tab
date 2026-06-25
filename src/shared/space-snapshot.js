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

export function comparableSnapshotUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return raw.split(/[?#]/)[0] || raw;
  }
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

export function removeSnapshotTabs(snapshot, targets = []) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  if (!snapshot) return null;

  const remainingUrlMatches = new Map();
  for (const target of targets || []) {
    const key = comparableSnapshotUrl(target?.url);
    if (!key) continue;
    remainingUrlMatches.set(key, (remainingUrlMatches.get(key) || 0) + 1);
  }
  if (remainingUrlMatches.size === 0) return snapshot;

  let changed = false;
  const groups = [];
  for (const group of snapshot.groups || []) {
    const tabs = [];
    for (const tab of group.tabs || []) {
      const key = comparableSnapshotUrl(tab.url);
      const remaining = remainingUrlMatches.get(key) || 0;
      if (key && remaining > 0) {
        remainingUrlMatches.set(key, remaining - 1);
        changed = true;
        continue;
      }
      tabs.push(tab);
    }
    if (tabs.length > 0) groups.push({ ...group, tabs });
  }

  return changed ? { ...snapshot, groups } : snapshot;
}

export function updateSnapshotTab(snapshot, target = {}, replacement = {}) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  const replacementTab = sanitizeReplacementTab(replacement);
  if (!snapshot || !replacementTab) return snapshot;

  const targetUrl = String(target.url || '');
  const targetGroupTitle = String(target.groupTitle || '');
  const targetGroupColor = String(target.groupColor || '');
  let changed = false;
  let matchedGroup = false;
  const groups = [];

  for (const group of snapshot.groups || []) {
    const groupMatches = (
      (!targetGroupTitle || String(group.title || 'Ungrouped') === targetGroupTitle) &&
      (!targetGroupColor || String(group.color || 'grey') === targetGroupColor)
    );
    if (!groupMatches) {
      groups.push(group);
      continue;
    }

    matchedGroup = true;
    let replaced = false;
    const tabs = [];
    for (const tab of group.tabs || []) {
      if (!replaced && targetUrl && tab.url === targetUrl) {
        tabs.push(replacementTab);
        replaced = true;
        changed = true;
        continue;
      }
      tabs.push(tab);
    }
    if (!replaced) {
      tabs.push(replacementTab);
      changed = true;
    }
    groups.push({ ...group, tabs });
  }

  if (!matchedGroup) {
    groups.push({
      title: targetGroupTitle || 'Ungrouped',
      color: targetGroupColor || (targetGroupTitle === 'Ungrouped' ? 'grey' : 'blue'),
      tabs: [replacementTab],
    });
    changed = true;
  }

  return changed ? sanitizeSpaceSnapshot({ ...snapshot, groups }) : snapshot;
}

export function mergeSpaceSnapshot(liveSnapshot, storedSnapshot) {
  liveSnapshot = sanitizeSpaceSnapshot(liveSnapshot);
  storedSnapshot = sanitizeSpaceSnapshot(storedSnapshot);
  if (!storedSnapshot || snapshotTabCount(storedSnapshot) === 0) return liveSnapshot || null;
  if (!liveSnapshot || snapshotTabCount(liveSnapshot) === 0) return storedSnapshot;

  const liveUrls = new Set(snapshotTabs(liveSnapshot)
    .map((tab) => comparableSnapshotUrl(tab.url))
    .filter(Boolean));
  const liveGroupsByKey = new Map((liveSnapshot.groups || []).map((group) => [snapshotGroupKey(group), group]));
  const mergedGroups = [];

  for (const storedGroup of storedSnapshot.groups || []) {
    const key = snapshotGroupKey(storedGroup);
    const liveGroup = liveGroupsByKey.get(key);
    const dormantTabs = (storedGroup.tabs || [])
      .filter((tab) => !liveUrls.has(comparableSnapshotUrl(tab.url)));
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
    .map((group) => {
      const title = group.title || 'Ungrouped';
      return {
        ...group,
        title,
        color: group.color || (title === 'Ungrouped' ? 'grey' : 'blue'),
        tabs: dedupeSnapshotTabs((group.tabs || [])
          .filter(isRestorableSnapshotTab)
          .map((tab) => ({
            ...tab,
            title: tab.title || tab.url || 'Untitled',
            url: String(tab.url || '').trim(),
          }))),
      };
    })
    .filter((group) => group.tabs.length > 0);
  return { ...snapshot, groups };
}

function snapshotTabs(snapshot = {}) {
  return (snapshot.groups || []).flatMap((group) => group.tabs || []);
}

function sanitizeReplacementTab(tab = {}) {
  const url = String(tab.url || '').trim();
  if (!isRestorableSnapshotTab({ url })) return null;
  return {
    title: tab.title || url || 'Untitled',
    url,
  };
}

function dedupeSnapshotTabs(tabs = []) {
  const firstUrlByKey = new Map();
  const deduped = [];
  for (const tab of tabs) {
    const url = String(tab.url || '');
    const key = comparableSnapshotUrl(tab.url) || String(tab.url || '');
    const firstUrl = firstUrlByKey.get(key);
    if (key && firstUrl !== undefined && firstUrl !== url) continue;
    if (key && firstUrl === undefined) firstUrlByKey.set(key, url);
    deduped.push(tab);
  }
  return deduped;
}

function snapshotGroupKey(group = {}) {
  return `${group.title || 'Ungrouped'}\n${group.color || 'grey'}`;
}
