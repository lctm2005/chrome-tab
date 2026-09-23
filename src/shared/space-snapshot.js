import { chromeGroupTitleKey, groupTitleKey } from './group-title.js';
import { isChromeNewTabUrl } from './tab-utils.js';

export function shouldAutoCloseTab(tab = {}, options = {}) {
  if (tab.pinned) return false;
  const protocol = restorableProtocol(tab.url);
  if (protocol === 'http:' || protocol === 'https:') return true;
  return protocol === 'file:' && options.fileSchemeAccess === true;
}

export function clearableUngroupedTabs(tabs = [], options = {}) {
  return (Array.isArray(tabs) ? tabs : []).filter((tab) => (
    !isForeignWindowMarker(tab) && shouldAutoCloseTab(tab, options)
  ));
}

export function isRestorableSnapshotTab(tab = {}) {
  const protocol = restorableProtocol(tab.url);
  return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
}

function isForeignWindowMarker(tab) {
  const tabId = tab?.foreignWindowTabId;
  return Number.isSafeInteger(tabId) && tabId >= 0;
}

export function buildSpaceSnapshot({ view = [], now = Date.now() } = {}) {
  const groups = view
    .map(snapshotGroupRecord)
    .filter((group) => group.tabs.length > 0);
  const hasLifecycleIdentity = groups.some((group) => (
    group.snapshotGroupId || group.tabs.some((tab) => tab.snapshotTabId)
  ));
  return {
    version: 1,
    updatedAt: now,
    ...(hasLifecycleIdentity ? { identityVersion: 1 } : {}),
    groups,
  };
}

export function snapshotTabCount(snapshot = {}) {
  return (snapshot?.groups || []).reduce((sum, group) => sum + (group.tabs || []).length, 0);
}

// Stable row identity must outrank the physical Chrome Tag title. Chrome
// shortens long titles with a hash, while saved snapshots retain the user's
// full logical title.
export function uniqueSnapshotGroupForTabId(groups = [], snapshotTabId = '') {
  const stableTabId = String(snapshotTabId || '').trim();
  if (!stableTabId) return null;
  const matches = groups.filter((group) => (
    (group?.tabs || []).some((tab) => (
      String(tab?.snapshotTabId || '').trim() === stableTabId
    ))
  ));
  return matches.length === 1 ? matches[0] : null;
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

/**
 * Combines saved Tags whose user-visible names normalize to the same value.
 *
 * The first Tag is the canonical one: its title, color, collapsed state,
 * stable identity, and any future group metadata remain authoritative. Rows
 * from later duplicates are appended in their original group/tab order and
 * are copied whole so saved-page metadata is never reconstructed or dropped.
 * Ungrouped and unnamed groups are excluded because neither represents an
 * explicit, safely-identifiable Tag name.
 */
export function mergeDuplicateSnapshotTags(snapshot, now = Date.now()) {
  if (!snapshot || !Array.isArray(snapshot.groups)) {
    return { snapshot, mergedCount: 0, merges: [], snapshotGroupIdReplacements: {} };
  }

  const groups = [];
  const canonicalByTitle = new Map();
  const mergesByTitle = new Map();
  const snapshotGroupIdReplacements = {};
  let mergedCount = 0;

  for (const sourceGroup of snapshot.groups) {
    const sourceTabs = Array.isArray(sourceGroup?.tabs) ? sourceGroup.tabs : [];
    const titleKey = isUngroupedSnapshotGroup(sourceGroup)
      ? ''
      : groupTitleKey(sourceGroup?.title);
    const canonicalIndex = titleKey ? canonicalByTitle.get(titleKey) : undefined;
    if (canonicalIndex === undefined) {
      const group = {
        ...sourceGroup,
        tabs: sourceTabs.map((tab) => ({ ...tab })),
      };
      groups.push(group);
      if (titleKey) canonicalByTitle.set(titleKey, groups.length - 1);
      continue;
    }

    const canonical = groups[canonicalIndex];
    const canonicalId = String(canonical.snapshotGroupId || '').trim();
    const duplicateId = String(sourceGroup?.snapshotGroupId || '').trim();
    canonical.tabs.push(...sourceTabs.map((tab) => {
      const row = { ...tab };
      if (
        canonicalId && duplicateId && canonicalId !== duplicateId &&
        String(row.snapshotGroupId || '').trim() === duplicateId
      ) {
        row.snapshotGroupId = canonicalId;
      }
      return row;
    }));
    mergedCount += 1;
    const merge = mergesByTitle.get(titleKey) || {
      title: String(canonical.title),
      mergedCount: 0,
      appendedRowCount: 0,
    };
    merge.mergedCount += 1;
    merge.appendedRowCount += sourceTabs.length;
    mergesByTitle.set(titleKey, merge);

    if (canonicalId && duplicateId && canonicalId !== duplicateId) {
      snapshotGroupIdReplacements[duplicateId] = canonicalId;
    }
  }

  if (mergedCount === 0) {
    return { snapshot, mergedCount: 0, merges: [], snapshotGroupIdReplacements: {} };
  }
  return {
    snapshot: {
      ...snapshot,
      updatedAt: Number.isFinite(Number(now)) ? Number(now) : snapshot.updatedAt,
      groups,
    },
    mergedCount,
    merges: [...mergesByTitle.values()],
    snapshotGroupIdReplacements,
  };
}

/**
 * Combines saved and physical duplicate-Tag summaries without double-counting
 * the same named Tags represented in both views. Distinct normalized names are
 * additive; for one name, the larger duplicate count is what will disappear.
 */
export function combineDuplicateTagMergePlans(snapshotMerges = [], liveMerges = []) {
  const byTitle = new Map();
  const include = (source, kind) => {
    for (const candidate of Array.isArray(source) ? source : []) {
      const titleKey = groupTitleKey(candidate?.title);
      if (!titleKey) continue;
      const mergedCount = Math.max(0, Math.trunc(Number(candidate?.mergedCount) || 0));
      const existing = byTitle.get(titleKey) || {
        title: String(candidate.title),
        snapshotMergedCount: 0,
        liveMergedCount: 0,
        appendedRowCount: 0,
      };
      if (kind === 'snapshot') {
        existing.snapshotMergedCount = Math.max(existing.snapshotMergedCount, mergedCount);
        existing.appendedRowCount = Math.max(
          existing.appendedRowCount,
          Math.max(0, Math.trunc(Number(candidate?.appendedRowCount) || 0)),
        );
      } else {
        existing.liveMergedCount = Math.max(existing.liveMergedCount, mergedCount);
      }
      byTitle.set(titleKey, existing);
    }
  };
  include(snapshotMerges, 'snapshot');
  include(liveMerges, 'live');

  const merges = [...byTitle.values()]
    .map((merge) => ({
      ...merge,
      mergedCount: Math.max(merge.snapshotMergedCount, merge.liveMergedCount),
    }))
    .filter((merge) => merge.mergedCount > 0);
  return {
    mergedCount: merges.reduce((sum, merge) => sum + merge.mergedCount, 0),
    merges,
  };
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

export function snapshotTabIdentitiesConflict(left = {}, right = {}) {
  const leftId = String(left?.snapshotTabId || '').trim();
  const rightId = String(right?.snapshotTabId || '').trim();
  return Boolean(leftId && rightId && leftId !== rightId);
}

export function dropTemporarySnapshotGroups(snapshot) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  if (!snapshot) return null;
  return {
    ...snapshot,
    groups: snapshot.groups.filter((group) => !isTemporaryUngroupedSnapshotGroup(group)),
  };
}

export function removeSnapshotTab(snapshot, target = {}) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  if (!snapshot) return null;
  const targetSnapshotTabId = String(target.snapshotTabId || '');
  const targetUrl = snapshotUrlIdentity(target.url);
  const targetHasGroupTitle = Object.hasOwn(target, 'groupTitle');
  const targetGroupTitle = String(target.groupTitle || '');
  const targetGroupColor = String(target.groupColor || '');
  let removed = false;
  const groups = [];

  for (const group of snapshot.groups) {
    const groupMatches = targetSnapshotTabId
      ? group.tabs.some((tab) => String(tab.snapshotTabId || '') === targetSnapshotTabId)
      : (
        (!targetHasGroupTitle || group.title === targetGroupTitle) &&
        (!targetGroupColor || group.color === targetGroupColor)
    );
    const tabs = [];
    for (const tab of group.tabs) {
      const rowMatches = targetSnapshotTabId
        ? String(tab.snapshotTabId || '') === targetSnapshotTabId
        : targetUrl && snapshotUrlIdentity(tab.url) === targetUrl;
      if (!removed && groupMatches && rowMatches) {
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
  for (const group of snapshot.groups) {
    const tabs = group.tabs.filter((tab) => !consumedTabs.has(tab));
    const nextGroup = { ...group, tabs };
    if (snapshotGroupShouldPersist(snapshot, nextGroup)) groups.push(nextGroup);
  }

  return { ...snapshot, groups };
}

export function updateSnapshotTab(snapshot, target = {}, replacement = {}, options = {}) {
  const requireExisting = options.requireExisting === true;
  snapshot = sanitizeSpaceSnapshot(snapshot, { preserveDuplicateUrls: requireExisting });
  const replacementTab = sanitizeReplacementTab(replacement);
  if (!snapshot || !replacementTab) return snapshot;
  if (requireExisting) {
    return updateExistingSnapshotTab(snapshot, target, replacementTab);
  }

  const targetSnapshotTabId = String(target.snapshotTabId || '');
  const targetUrl = snapshotUrlIdentity(target.url);
  const targetHasGroupTitle = Object.hasOwn(target, 'groupTitle');
  const targetGroupTitle = String(target.groupTitle || '');
  const targetGroupColor = String(target.groupColor || '');
  let matchedGroup = false;
  const groups = [];

  for (const group of snapshot.groups) {
    const groupMatches = targetSnapshotTabId
      ? group.tabs.some((tab) => String(tab.snapshotTabId || '') === targetSnapshotTabId)
      : (
        (!targetHasGroupTitle || group.title === targetGroupTitle) &&
        (!targetGroupColor || group.color === targetGroupColor)
      );
    if (!groupMatches) {
      groups.push(group);
      continue;
    }

    matchedGroup = true;
    let replaced = false;
    const tabs = [];
    for (const tab of group.tabs) {
      const rowMatches = targetSnapshotTabId
        ? String(tab.snapshotTabId || '') === targetSnapshotTabId
        : targetUrl && snapshotUrlIdentity(tab.url) === targetUrl;
      if (!replaced && rowMatches) {
        tabs.push(tab.snapshotTabId
          ? { ...replacementTab, snapshotTabId: tab.snapshotTabId }
          : replacementTab);
        replaced = true;
        continue;
      }
      tabs.push(tab);
    }
    if (!replaced) {
      tabs.push(replacementTab);
    }
    groups.push({ ...group, tabs });
  }

  if (!matchedGroup) {
    groups.push({
      title: targetHasGroupTitle ? targetGroupTitle : 'Ungrouped',
      color: targetGroupColor || (targetGroupTitle === 'Ungrouped' ? 'grey' : 'blue'),
      tabs: [replacementTab],
    });
  }

  return sanitizeSpaceSnapshot({ ...snapshot, groups });
}

function updateExistingSnapshotTab(snapshot, target, replacementTab) {
  const targetSnapshotTabId = String(target.snapshotTabId || '').trim();
  const targetUrl = snapshotUrlIdentity(target.url);
  const targetHasGroupTitle = Object.hasOwn(target, 'groupTitle');
  const targetGroupTitle = String(target.groupTitle || '');
  const targetGroupColor = String(target.groupColor || '');
  const candidates = [];

  for (let groupIndex = 0; groupIndex < snapshot.groups.length; groupIndex += 1) {
    const group = snapshot.groups[groupIndex];
    const groupMatches = targetSnapshotTabId || (
      (!targetHasGroupTitle || group.title === targetGroupTitle) &&
      (!targetGroupColor || group.color === targetGroupColor)
    );
    if (!groupMatches) continue;
    for (let tabIndex = 0; tabIndex < group.tabs.length; tabIndex += 1) {
      const tab = group.tabs[tabIndex];
      const rowMatches = targetSnapshotTabId
        ? String(tab.snapshotTabId || '').trim() === targetSnapshotTabId
        : targetUrl && snapshotUrlIdentity(tab.url) === targetUrl;
      if (rowMatches) candidates.push({ groupIndex, tabIndex, tab });
    }
  }
  if (candidates.length !== 1) return snapshot;

  const match = candidates[0];
  const groups = snapshot.groups.slice();
  const tabs = groups[match.groupIndex].tabs.slice();
  tabs[match.tabIndex] = match.tab.snapshotTabId
    ? { ...replacementTab, snapshotTabId: match.tab.snapshotTabId }
    : replacementTab;
  groups[match.groupIndex] = { ...groups[match.groupIndex], tabs };
  return sanitizeSpaceSnapshot({ ...snapshot, groups }, { preserveDuplicateUrls: true });
}

/**
 * Retitles the one stored group represented by an explicit live-group rename.
 * This is intentionally action-specific: a generic
 * snapshot merge cannot distinguish a rename from an Auto Group move when
 * historical Tags are preserved.
 */
export function retitleSnapshotGroup(
  snapshot,
  sourceGroup = {},
  nextTitle = '',
  now = Date.now(),
) {
  snapshot = sanitizeSpaceSnapshot(snapshot);
  if (!snapshot) return null;

  const cleanTitle = String(nextTitle || '').trim();
  const sourceSnapshotGroupId = String(sourceGroup.snapshotGroupId || '').trim();
  if (!cleanTitle) return snapshot;

  if (sourceSnapshotGroupId) {
    const identityIndexes = snapshot.groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => (
        String(group.snapshotGroupId || '').trim() === sourceSnapshotGroupId
      ));
    if (
      identityIndexes.length !== 1 ||
      identityIndexes[0].group.title === cleanTitle
    ) return snapshot;
    return retitledSnapshot(snapshot, identityIndexes[0].index, cleanTitle, now);
  }

  const sourceTitle = Object.hasOwn(sourceGroup, 'title')
    ? String(sourceGroup.title).trim()
    : '';
  const sourceColor = String(
    sourceGroup.color || (sourceTitle === 'Ungrouped' ? 'grey' : 'blue'),
  );
  if (!sourceTitle || sourceTitle === cleanTitle) return snapshot;

  const candidateIndexes = snapshot.groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => (
      group.title === sourceTitle &&
      group.color === sourceColor
    ));
  if (candidateIndexes.length === 0) return snapshot;

  let targetIndex = -1;
  let bestScore = { exactCount: 0, totalCount: 0 };
  let tied = false;
  for (const candidate of candidateIndexes) {
    const score = urlOverlapScore(candidate.group.tabs, sourceGroup.tabs || []);
    const comparison = compareUrlOverlapScores(score, bestScore);
    if (comparison > 0) {
      targetIndex = candidate.index;
      bestScore = score;
      tied = false;
    } else if (score.totalCount > 0 && comparison === 0) {
      tied = true;
    }
  }

  if (tied || bestScore.totalCount === 0) targetIndex = -1;
  if (targetIndex < 0 && candidateIndexes.length === 1) {
    targetIndex = candidateIndexes[0].index;
  }
  if (targetIndex < 0) return snapshot;

  return retitledSnapshot(snapshot, targetIndex, cleanTitle, now);
}

function retitledSnapshot(snapshot, targetIndex, cleanTitle, now) {
  return {
    ...snapshot,
    updatedAt: Number.isFinite(Number(now)) ? Number(now) : snapshot.updatedAt,
    groups: snapshot.groups.map((group, index) => (
      index === targetIndex ? { ...group, title: cleanTitle } : group
    )),
  };
}

export function mergeSpaceSnapshot(liveSnapshot, storedSnapshot) {
  liveSnapshot = sanitizeSpaceSnapshot(liveSnapshot);
  storedSnapshot = sanitizeSpaceSnapshot(storedSnapshot);
  if (
    !storedSnapshot ||
    !snapshotHasPersistentContent(storedSnapshot)
  ) return liveSnapshot || null;
  if (!liveSnapshot || snapshotTabCount(liveSnapshot) === 0) return storedSnapshot;

  const {
    consumedTabs: liveStoredMatches,
    consumerTabByCandidateTab: liveTabByStoredTab,
  } = matchSnapshotTabs(
    snapshotTabEntries(liveSnapshot),
    snapshotTabEntries(storedSnapshot),
  );
  const liveGroupsByKey = new Map();
  for (const group of liveSnapshot.groups) {
    const key = snapshotGroupKey(group);
    const existing = liveGroupsByKey.get(key);
    liveGroupsByKey.set(key, existing
      ? { ...existing, tabs: [...existing.tabs, ...group.tabs] }
      : group);
  }
  const storedGroupKeys = new Set(storedSnapshot.groups.map(snapshotGroupKey));
  const storedChromeGroupKeyCounts = countSnapshotChromeGroupKeys(storedSnapshot.groups);
  const mergedGroups = [];

  for (const storedGroup of storedSnapshot.groups) {
    const key = snapshotGroupKey(storedGroup);
    let liveGroup = liveGroupsByKey.get(key);
    if (liveGroup && !stableGroupIdentityIsCredible(liveGroup, storedGroup)) {
      liveGroup = null;
    }
    let liveKey = key;
    let preserveStoredTitle = false;
    if (!liveGroup) {
      const physicalTitleMatch = liveGroupMatchByChromeTitle(
        storedGroup,
        liveGroupsByKey,
        storedChromeGroupKeyCounts,
      );
      liveGroup = physicalTitleMatch?.group;
      liveKey = physicalTitleMatch?.key || key;
      preserveStoredTitle = Boolean(liveGroup);
    }
    if (!liveGroup && !storedSnapshot.preserveGroups) {
      const overlapMatch = liveGroupMatchByUrlOverlap(storedGroup, liveGroupsByKey, storedGroupKeys);
      liveGroup = overlapMatch?.group;
      liveKey = overlapMatch?.key || key;
    }
    if (liveGroup) {
      mergedGroups.push({
        ...storedGroup,
        ...liveGroup,
        ...(preserveStoredTitle ? { title: storedGroup.title } : {}),
        tabs: mergeSnapshotTabsInStoredOrder({
          liveTabs: liveGroup.tabs,
          storedTabs: storedGroup.tabs,
          liveStoredMatches,
          liveTabByStoredTab,
        }),
      });
      liveGroupsByKey.delete(liveKey);
    } else {
      const dormantTabs = storedGroup.tabs
        .filter((tab) => !liveStoredMatches.has(tab));
      if (!snapshotGroupShouldPersist(storedSnapshot, { ...storedGroup, tabs: dormantTabs })) {
        continue;
      }
      mergedGroups.push({
        ...storedGroup,
        tabs: dormantTabs,
      });
    }
  }

  for (const group of liveGroupsByKey.values()) {
    if (group.tabs.length > 0) mergedGroups.push(group);
  }

  return {
    // A snapshot is a portable record and may contain metadata written by a
    // newer version or an importer. Refreshing its live rows must not silently
    // strip those top-level extension fields during a Space round trip.
    ...storedSnapshot,
    ...liveSnapshot,
    version: liveSnapshot.version || storedSnapshot.version || 1,
    updatedAt: liveSnapshot.updatedAt || Date.now(),
    ...(liveSnapshot.identityVersion || storedSnapshot.identityVersion
      ? { identityVersion: liveSnapshot.identityVersion || storedSnapshot.identityVersion }
      : {}),
    ...(liveSnapshot.preserveGroups || storedSnapshot.preserveGroups ? { preserveGroups: true } : {}),
    groups: mergedGroups.filter((group) => snapshotGroupShouldPersist({
      preserveGroups: Boolean(liveSnapshot.preserveGroups || storedSnapshot.preserveGroups),
    }, group)),
  };
}

function mergeSnapshotTabsInStoredOrder({
  liveTabs = [],
  storedTabs = [],
  liveStoredMatches = new Set(),
  liveTabByStoredTab = new Map(),
} = {}) {
  const availableLiveTabs = new Set(liveTabs);
  const consumedLiveTabs = new Set();
  const ordered = [];
  for (const storedTab of storedTabs) {
    const matchingLiveTab = liveTabByStoredTab.get(storedTab);
    if (matchingLiveTab && availableLiveTabs.has(matchingLiveTab)) {
      ordered.push({ ...storedTab, ...matchingLiveTab });
      consumedLiveTabs.add(matchingLiveTab);
    } else if (!liveStoredMatches.has(storedTab)) {
      ordered.push(storedTab);
    }
  }
  for (const liveTab of liveTabs) {
    if (!consumedLiveTabs.has(liveTab)) ordered.push(liveTab);
  }
  return ordered;
}

export function mergeOpenSpaceSnapshot(view = [], storedSnapshot = null) {
  const liveSnapshot = buildSpaceSnapshot({ view });
  const storedWithoutTemporaryUngrouped = dropTemporarySnapshotGroups(storedSnapshot);
  return mergeSpaceSnapshot(liveSnapshot, storedWithoutTemporaryUngrouped);
}

export function isUngroupedSnapshotGroup(group = {}) {
  return group.title === 'Ungrouped' && (group.color || 'grey') === 'grey';
}

export function sanitizeSpaceSnapshot(snapshot, options = {}) {
  if (!snapshot) return null;
  const groups = (snapshot.groups || [])
    .map((group) => {
      const title = Object.hasOwn(group, 'title') ? String(group.title) : 'Ungrouped';
      return {
        ...group,
        title,
        color: group.color || (title === 'Ungrouped' ? 'grey' : 'blue'),
        tabs: options.preserveDuplicateUrls
          ? (group.tabs || []).filter(isRestorableSnapshotTab).map(sanitizeSnapshotTab)
          : dedupeSnapshotTabs((group.tabs || [])
            .filter(isRestorableSnapshotTab)
            .map(sanitizeSnapshotTab), snapshot.identityVersion),
      };
    })
    .filter((group) => snapshotGroupShouldPersist(snapshot, group));
  return { ...snapshot, groups };
}

function snapshotTabRecord(tab = {}) {
  const record = {
    // `displayTitle` can be a panel-only rename. Keep Chrome's page title as
    // the durable title and persist the custom label separately in
    // `panelTitle`, otherwise a routine refresh silently replaces page
    // metadata with the sidebar label.
    title: tab.title || tab.url,
    url: String(tab.url).trim(),
  };
  if (tab.snapshotTabId) record.snapshotTabId = String(tab.snapshotTabId);
  const panelTitle = cleanPanelTitle(tab.panelTitle);
  if (panelTitle) record.panelTitle = panelTitle;
  return record;
}

function snapshotGroupRecord(group = {}) {
  const record = {
    title: Object.hasOwn(group, 'title') ? String(group.title) : 'Ungrouped',
    color: group.color || 'grey',
    collapsed: Boolean(group.collapsed),
    tabs: (group.tabs || [])
      .filter((tab) => !tab.pinned)
      .filter(isRestorableSnapshotTab)
      .map(snapshotTabRecord),
  };
  if (group.snapshotGroupId) record.snapshotGroupId = String(group.snapshotGroupId);
  if (isUngroupedSnapshotGroup(record)) record.restorable = true;
  return record;
}

function sanitizeSnapshotTab(tab = {}) {
  const sanitized = {
    ...tab,
    title: tab.title || tab.url,
    url: String(tab.url).trim(),
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
  let best = null;
  let bestScore = { exactCount: 0, totalCount: 0 };
  let tied = false;
  for (const [key, group] of liveGroupsByKey) {
    if (reservedGroupKeys.has(key)) continue;
    const score = urlOverlapScore(storedGroup.tabs, group.tabs);
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

function liveGroupMatchByChromeTitle(
  storedGroup = {},
  liveGroupsByKey = new Map(),
  storedChromeGroupKeyCounts = new Map(),
) {
  const expectedKey = snapshotChromeGroupKey(storedGroup);
  if (storedChromeGroupKeyCounts.get(expectedKey) !== 1) return null;
  const matches = [...liveGroupsByKey.entries()].filter(([, group]) => (
    snapshotChromeGroupKey(group) === expectedKey
  ));
  if (matches.length !== 1) return null;
  const [key, group] = matches[0];
  const storedGroupId = String(storedGroup.snapshotGroupId || '').trim();
  const liveGroupId = String(group.snapshotGroupId || '').trim();
  if (storedGroupId && liveGroupId && storedGroupId !== liveGroupId) return null;
  return { key, group };
}

function countSnapshotChromeGroupKeys(groups = []) {
  const counts = new Map();
  for (const group of groups) {
    const key = snapshotChromeGroupKey(group);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function snapshotChromeGroupKey(group = {}) {
  return `${chromeGroupTitleKey(group.title)}\n${group.color}`;
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
  const sanitized = {
    title: tab.title || url,
    url,
  };
  if (tab.snapshotTabId) sanitized.snapshotTabId = String(tab.snapshotTabId);
  const panelTitle = cleanPanelTitle(tab.panelTitle);
  if (panelTitle) sanitized.panelTitle = panelTitle;
  return sanitized;
}

function dedupeSnapshotTabs(tabs = [], identityVersion = 0) {
  const seenKeys = new Set();
  const identityAware = Number(identityVersion) >= 1;
  const deduped = [];
  for (const tab of tabs) {
    const url = snapshotUrlIdentity(tab.url);
    const key = identityAware && tab.snapshotTabId
      ? `id:${tab.snapshotTabId}`
      : `url:${url}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(tab);
  }
  return deduped;
}

function snapshotUrlIdentity(url) {
  return String(url || '').trim();
}

function restorableProtocol(value) {
  const url = String(value || '').trim();
  if (!url || isChromeNewTabUrl(url) || url.startsWith('chrome-extension://')) return '';
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

function snapshotTabEntries(snapshot = {}) {
  return snapshot.groups.flatMap((group) => {
    const groupKey = snapshotGroupKey(group);
    const groupMetadataKey = snapshotChromeGroupKey(group);
    return group.tabs.map((tab) => ({ tab, groupKey, groupMetadataKey }));
  });
}

function targetSnapshotGroupKey(target = {}) {
  const hasTitle = Object.hasOwn(target, 'groupTitle');
  const title = String(target.groupTitle || '');
  const color = String(target.groupColor || '');
  if (!hasTitle && !color) return '';
  return snapshotGroupKey({
    title: hasTitle ? title : 'Ungrouped',
    color: color || (title === 'Ungrouped' ? 'grey' : 'blue'),
  });
}

function matchSnapshotTabs(consumers = [], candidates = [], { preferSameGroup = true } = {}) {
  const consumedTabs = new Set();
  const matchedConsumers = new Set();
  const consumerTabByCandidateTab = new Map();
  const candidateIndex = indexSnapshotMatchCandidates(candidates);
  const preparedConsumers = consumers.map((consumer) => {
    const exactUrl = snapshotUrlIdentity(consumer?.tab?.url);
    return {
      consumer,
      snapshotTabId: String(consumer?.tab?.snapshotTabId || '').trim(),
      exactUrl,
      fallbackUrl: comparableSnapshotUrl(exactUrl),
    };
  });
  let exactCount = 0;

  for (let consumerIndex = 0; consumerIndex < preparedConsumers.length; consumerIndex += 1) {
    const prepared = preparedConsumers[consumerIndex];
    if (!prepared.snapshotTabId) continue;
    const match = uniqueUnconsumedSnapshotCandidate(
      candidateIndex.identity.get(prepared.snapshotTabId),
      consumedTabs,
      () => true,
    );
    if (!match) continue;
    consumedTabs.add(match.tab);
    matchedConsumers.add(consumerIndex);
    consumerTabByCandidateTab.set(match.tab, prepared.consumer.tab);
    exactCount += 1;
  }

  const matchPass = (exact) => {
    for (let consumerIndex = 0; consumerIndex < preparedConsumers.length; consumerIndex += 1) {
      if (matchedConsumers.has(consumerIndex)) continue;
      const prepared = preparedConsumers[consumerIndex];
      const key = exact ? prepared.exactUrl : prepared.fallbackUrl;
      const match = firstIndexedSnapshotMatch({
        index: exact ? candidateIndex.exact : candidateIndex.fallback,
        key,
        groupKey: prepared.consumer?.groupKey,
        preferSameGroup,
        consumedTabs,
        predicate: (candidate) => !snapshotTabIdentitiesConflict(
          prepared.consumer?.tab,
          candidate.tab,
        ),
      });
      if (!match) continue;

      consumedTabs.add(match.tab);
      matchedConsumers.add(consumerIndex);
      consumerTabByCandidateTab.set(match.tab, prepared.consumer.tab);
      if (exact) exactCount += 1;
    }
  };

  matchPass(true);
  matchPass(false);
  return {
    consumedTabs,
    consumerTabByCandidateTab,
    exactCount,
    totalCount: matchedConsumers.size,
  };
}

function indexSnapshotMatchCandidates(candidates) {
  const identity = new Map();
  const exact = createSnapshotMatchIndex();
  const fallback = createSnapshotMatchIndex();
  for (const candidate of candidates) {
    const snapshotTabId = String(candidate?.tab?.snapshotTabId || '').trim();
    if (snapshotTabId) addSnapshotMatchBucketEntry(identity, snapshotTabId, candidate);
    const exactUrl = snapshotUrlIdentity(candidate?.tab?.url);
    addSnapshotMatchCandidate(exact, exactUrl, candidate);
    const fallbackUrl = comparableSnapshotUrl(exactUrl);
    if (fallbackUrl) addSnapshotMatchCandidate(fallback, fallbackUrl, candidate);
  }
  return { identity, exact, fallback };
}

function createSnapshotMatchIndex() {
  return {
    all: new Map(),
    byGroup: new Map(),
  };
}

function addSnapshotMatchCandidate(index, key, candidate) {
  addSnapshotMatchBucketEntry(index.all, key, candidate);
  if (!candidate?.groupKey) return;
  if (!index.byGroup.has(candidate.groupKey)) index.byGroup.set(candidate.groupKey, new Map());
  addSnapshotMatchBucketEntry(index.byGroup.get(candidate.groupKey), key, candidate);
}

function addSnapshotMatchBucketEntry(buckets, key, candidate) {
  if (!buckets.has(key)) buckets.set(key, { candidates: [], cursor: 0 });
  buckets.get(key).candidates.push(candidate);
}

function firstIndexedSnapshotMatch({
  index,
  key,
  groupKey,
  preferSameGroup,
  consumedTabs,
  predicate,
}) {
  const sameGroupMatch = preferSameGroup && groupKey
    ? firstUnconsumedSnapshotCandidate(
      index.byGroup.get(groupKey)?.get(key),
      consumedTabs,
      predicate,
    )
    : null;
  return sameGroupMatch || firstUnconsumedSnapshotCandidate(
    index.all.get(key),
    consumedTabs,
    predicate,
  );
}

function firstUnconsumedSnapshotCandidate(bucket, consumedTabs, predicate) {
  if (!bucket) return null;
  while (
    bucket.cursor < bucket.candidates.length &&
    consumedTabs.has(bucket.candidates[bucket.cursor].tab)
  ) {
    bucket.cursor += 1;
  }
  return bucket.candidates
    .slice(bucket.cursor)
    .find((candidate) => !consumedTabs.has(candidate.tab) && predicate(candidate)) || null;
}

function uniqueUnconsumedSnapshotCandidate(bucket, consumedTabs, predicate) {
  const available = (bucket?.candidates || []).filter((candidate) => (
    !consumedTabs.has(candidate.tab) && predicate(candidate)
  ));
  return available.length === 1 ? available[0] : null;
}

function stableGroupIdentityIsCredible(liveGroup = {}, storedGroup = {}) {
  const liveSnapshotGroupId = String(liveGroup.snapshotGroupId || '').trim();
  const storedSnapshotGroupId = String(storedGroup.snapshotGroupId || '').trim();
  if (!liveSnapshotGroupId || !storedSnapshotGroupId) return true;
  if (snapshotChromeGroupKey(liveGroup) === snapshotChromeGroupKey(storedGroup)) return true;

  const storedTabsById = new Map();
  for (const tab of storedGroup.tabs) {
    storedTabsById.set(String(tab.snapshotTabId || '').trim(), tab);
  }
  for (const tab of liveGroup.tabs) {
    const snapshotTabId = String(tab.snapshotTabId || '').trim();
    const storedTab = snapshotTabId && storedTabsById.get(snapshotTabId);
    if (Boolean(storedTab) && snapshotUrlIdentity(tab.url) === snapshotUrlIdentity(storedTab.url)) {
      return true;
    }
  }
  return false;
}

function snapshotGroupKey(group = {}) {
  const snapshotGroupId = String(group.snapshotGroupId || '').trim();
  return snapshotGroupId
    ? `id:${snapshotGroupId}`
    : `metadata:${group.title}\n${group.color}`;
}

function isTemporaryUngroupedSnapshotGroup(group = {}) {
  return isUngroupedSnapshotGroup(group) && group.restorable !== true;
}
