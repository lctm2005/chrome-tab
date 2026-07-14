export function shouldAutoCloseTab(tab = {}) {
  return !tab.pinned;
}

export function isRestorableSnapshotTab(tab = {}) {
  const url = String(tab.url || '').trim();
  return Boolean(url) &&
    url !== 'chrome://newtab' &&
    !url.startsWith('chrome-extension://');
}

export function buildSpaceSnapshot({ view = [], now = Date.now() } = {}) {
  return {
    version: 1,
    updatedAt: now,
    groups: view
      .map(snapshotGroupRecord)
      .filter((group) => group.tabs.length > 0),
  };
}

export function snapshotTabCount(snapshot = {}) {
  return (snapshot?.groups || []).reduce((sum, group) => sum + (group.tabs || []).length, 0);
}

export function snapshotGroupShouldPersist(snapshot = {}, group = {}) {
  return (group.tabs || []).length > 0 || Boolean(
    snapshot?.preserveGroups && !isUngroupedSnapshotGroup(group)
  );
}

export function snapshotHasPersistentContent(snapshot = {}) {
  return snapshotTabCount(snapshot) > 0 || Boolean(
    snapshot?.preserveGroups &&
    (snapshot.groups || []).some((group) => !isUngroupedSnapshotGroup(group))
  );
}

// Query/hash-insensitive fallback for navigation matching. Persisted rows use the
// complete trimmed URL as their identity and must never be deduplicated by this key.
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
    groups: (snapshot.groups || []).filter((group) => !isTemporaryUngroupedSnapshotGroup(group)),
  };
}

export function removeSnapshotTab(snapshot, target = {}) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  if (!snapshot) return null;
  const targetUrl = snapshotUrlIdentity(target.url);
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
      if (!removed && groupMatches && targetUrl && snapshotUrlIdentity(tab.url) === targetUrl) {
        removed = true;
        continue;
      }
      tabs.push(tab);
    }
    const nextGroup = { ...group, tabs };
    if (snapshotGroupShouldPersist(snapshot, nextGroup)) groups.push(nextGroup);
  }

  return { ...snapshot, groups };
}

export function removeSnapshotTabs(snapshot, targets = []) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  if (!snapshot) return null;

  const consumers = (targets || [])
    .filter((target) => snapshotUrlIdentity(target?.url))
    .map((target) => ({
      tab: target,
      groupKey: targetSnapshotGroupKey(target),
    }));
  if (consumers.length === 0) return snapshot;

  const { consumedTabs } = matchSnapshotTabs(
    consumers,
    snapshotTabEntries(snapshot),
  );
  if (consumedTabs.size === 0) return snapshot;

  const groups = [];
  for (const group of snapshot.groups || []) {
    const tabs = (group.tabs || []).filter((tab) => !consumedTabs.has(tab));
    const nextGroup = { ...group, tabs };
    if (snapshotGroupShouldPersist(snapshot, nextGroup)) groups.push(nextGroup);
  }

  return { ...snapshot, groups };
}

export function updateSnapshotTab(snapshot, target = {}, replacement = {}) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  const replacementTab = sanitizeReplacementTab(replacement);
  if (!snapshot || !replacementTab) return snapshot;

  const targetUrl = snapshotUrlIdentity(target.url);
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
      if (!replaced && targetUrl && snapshotUrlIdentity(tab.url) === targetUrl) {
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
  if (
    !storedSnapshot ||
    !snapshotHasPersistentContent(storedSnapshot)
  ) return liveSnapshot || null;
  if (!liveSnapshot || snapshotTabCount(liveSnapshot) === 0) return storedSnapshot;

  const { consumedTabs: liveStoredMatches } = matchSnapshotTabs(
    snapshotTabEntries(liveSnapshot),
    snapshotTabEntries(storedSnapshot),
  );
  const liveGroupsByKey = new Map((liveSnapshot.groups || []).map((group) => [snapshotGroupKey(group), group]));
  const storedGroupKeys = new Set((storedSnapshot.groups || []).map(snapshotGroupKey));
  const mergedGroups = [];

  for (const storedGroup of storedSnapshot.groups || []) {
    const key = snapshotGroupKey(storedGroup);
    let liveGroup = liveGroupsByKey.get(key);
    let liveKey = key;
    if (!liveGroup && !storedSnapshot.preserveGroups) {
      const overlapMatch = liveGroupMatchByUrlOverlap(storedGroup, liveGroupsByKey, storedGroupKeys);
      liveGroup = overlapMatch?.group;
      liveKey = overlapMatch?.key || key;
    }
    const dormantTabs = (storedGroup.tabs || [])
      .filter((tab) => !liveStoredMatches.has(tab));
    if (liveGroup) {
      mergedGroups.push({
        ...liveGroup,
        tabs: [...(liveGroup.tabs || []), ...dormantTabs],
      });
      liveGroupsByKey.delete(liveKey);
    } else if (snapshotGroupShouldPersist(storedSnapshot, { ...storedGroup, tabs: dormantTabs })) {
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
    ...(liveSnapshot.preserveGroups || storedSnapshot.preserveGroups ? { preserveGroups: true } : {}),
    groups: mergedGroups.filter((group) => snapshotGroupShouldPersist({
      preserveGroups: Boolean(liveSnapshot.preserveGroups || storedSnapshot.preserveGroups),
    }, group)),
  };
}

export function mergeOpenSpaceSnapshot(view = [], storedSnapshot = null) {
  const liveSnapshot = buildSpaceSnapshot({ view });
  const storedWithoutTemporaryUngrouped = dropTemporarySnapshotGroups(storedSnapshot);
  return mergeSpaceSnapshot(liveSnapshot, storedWithoutTemporaryUngrouped);
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
          .map(sanitizeSnapshotTab)),
      };
    })
    .filter((group) => snapshotGroupShouldPersist(snapshot, group));
  return { ...snapshot, groups };
}

function snapshotTabRecord(tab = {}) {
  const record = {
    title: tab.displayTitle || tab.title || tab.url || 'Untitled',
    url: String(tab.url || '').trim(),
  };
  const panelTitle = cleanPanelTitle(tab.panelTitle);
  if (panelTitle) record.panelTitle = panelTitle;
  return record;
}

function snapshotGroupRecord(group = {}) {
  const record = {
    title: group.title || 'Ungrouped',
    color: group.color || 'grey',
    collapsed: Boolean(group.collapsed),
    tabs: (group.tabs || [])
      .filter(shouldAutoCloseTab)
      .filter(isRestorableSnapshotTab)
      .map(snapshotTabRecord),
  };
  if (isUngroupedSnapshotGroup(record)) record.restorable = true;
  return record;
}

function sanitizeSnapshotTab(tab = {}) {
  const sanitized = {
    ...tab,
    title: tab.title || tab.url || 'Untitled',
    url: String(tab.url || '').trim(),
  };
  const panelTitle = cleanPanelTitle(tab.panelTitle);
  if (panelTitle) sanitized.panelTitle = panelTitle;
  else delete sanitized.panelTitle;
  return sanitized;
}

function cleanPanelTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function liveGroupMatchByUrlOverlap(
  storedGroup = {},
  liveGroupsByKey = new Map(),
  reservedGroupKeys = new Set(),
) {
  if (!(storedGroup.tabs || []).some((tab) => snapshotUrlIdentity(tab.url))) return null;

  let best = null;
  let bestScore = { exactCount: 0, totalCount: 0 };
  let tied = false;
  for (const [key, group] of liveGroupsByKey) {
    if (reservedGroupKeys.has(key)) continue;
    const score = urlOverlapScore(storedGroup.tabs || [], group.tabs || []);
    const comparison = compareUrlOverlapScores(score, bestScore);
    if (comparison > 0) {
      best = { key, group };
      bestScore = score;
      tied = false;
    } else if (score.totalCount > 0 && comparison === 0) {
      tied = true;
    }
  }
  return bestScore.totalCount > 0 && !tied ? best : null;
}

function urlOverlapScore(leftTabs = [], rightTabs = []) {
  const { exactCount, totalCount } = matchSnapshotTabs(
    leftTabs.map((tab) => ({ tab })),
    rightTabs.map((tab) => ({ tab })),
    { preferSameGroup: false },
  );
  return { exactCount, totalCount };
}

function compareUrlOverlapScores(left, right) {
  if (left.exactCount !== right.exactCount) {
    return left.exactCount - right.exactCount;
  }
  return left.totalCount - right.totalCount;
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
  const seenUrls = new Set();
  const deduped = [];
  for (const tab of tabs) {
    const url = snapshotUrlIdentity(tab.url);
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    deduped.push(tab);
  }
  return deduped;
}

function snapshotUrlIdentity(url) {
  return String(url || '').trim();
}

function snapshotTabEntries(snapshot = {}) {
  return (snapshot.groups || []).flatMap((group) => {
    const groupKey = snapshotGroupKey(group);
    return (group.tabs || []).map((tab) => ({ tab, groupKey }));
  });
}

function targetSnapshotGroupKey(target = {}) {
  const title = String(target.groupTitle || '');
  const color = String(target.groupColor || '');
  if (!title && !color) return '';
  return snapshotGroupKey({
    title: title || 'Ungrouped',
    color: color || (title === 'Ungrouped' ? 'grey' : 'blue'),
  });
}

function matchSnapshotTabs(consumers = [], candidates = [], { preferSameGroup = true } = {}) {
  const consumedTabs = new Set();
  const matchedConsumers = new Set();
  let exactCount = 0;

  const matchPass = (exact) => {
    for (let consumerIndex = 0; consumerIndex < consumers.length; consumerIndex += 1) {
      if (matchedConsumers.has(consumerIndex)) continue;
      const consumer = consumers[consumerIndex];
      const consumerUrl = snapshotUrlIdentity(consumer?.tab?.url);
      if (!consumerUrl) continue;
      const fallbackKey = exact ? '' : comparableSnapshotUrl(consumerUrl);
      if (!exact && !fallbackKey) continue;

      const matches = (candidate) => {
        if (consumedTabs.has(candidate.tab)) return false;
        const candidateUrl = snapshotUrlIdentity(candidate?.tab?.url);
        return exact
          ? candidateUrl === consumerUrl
          : comparableSnapshotUrl(candidateUrl) === fallbackKey;
      };
      const sameGroupMatch = preferSameGroup && consumer.groupKey
        ? candidates.find((candidate) => candidate.groupKey === consumer.groupKey && matches(candidate))
        : null;
      const match = sameGroupMatch || candidates.find(matches);
      if (!match) continue;

      consumedTabs.add(match.tab);
      matchedConsumers.add(consumerIndex);
      if (exact) exactCount += 1;
    }
  };

  matchPass(true);
  matchPass(false);
  return {
    consumedTabs,
    exactCount,
    totalCount: matchedConsumers.size,
  };
}

function snapshotGroupKey(group = {}) {
  return `${group.title || 'Ungrouped'}\n${group.color || 'grey'}`;
}

function isTemporaryUngroupedSnapshotGroup(group = {}) {
  return isUngroupedSnapshotGroup(group) && group.restorable !== true;
}
