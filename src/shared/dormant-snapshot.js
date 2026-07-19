import { chromeGroupTitleKey, groupTitleKey } from './group-title.js';
import {
  comparableSnapshotUrl,
  isRestorableSnapshotTab,
  snapshotTabIdentitiesConflict,
  snapshotGroupShouldPersist,
  snapshotHasPersistentContent,
} from './space-snapshot.js';
import { domainFromUrl } from './tab-utils.js';

export function dormantSnapshotGroupIndexFromKey(key) {
  const match = String(key || '').match(/^snapshot:(\d+):/);
  if (!match) return -1;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : -1;
}

export function dormantSnapshotGroupKey(index, group = {}, spaceId = '') {
  const identity = snapshotIdentity(group?.snapshotGroupId) ||
    storedSnapshotGroupTitle(group);
  return `snapshot:${index}:${encodeURIComponent(String(spaceId || ''))}:${identity}`;
}

/**
 * Reorders a durable snapshot from the visible group references. Stable group
 * identity is authoritative; ambiguous legacy metadata is deliberately left
 * in its existing relative order.
 */
export function projectSnapshotGroupOrder(
  snapshot,
  references = [],
  now = Date.now(),
) {
  const groups = validSnapshotGroups(snapshot);
  if (!groups || !Array.isArray(references)) return snapshot;

  const orderedIndexes = [];
  const consumed = new Set();
  for (const reference of references) {
    const index = storedGroupIndex(groups, reference);
    if (index < 0 || consumed.has(index)) continue;
    consumed.add(index);
    orderedIndexes.push(index);
  }
  if (orderedIndexes.length === 0) return snapshot;

  const nextIndexes = [
    ...orderedIndexes,
    ...groups.map((_, index) => index).filter((index) => !consumed.has(index)),
  ];
  if (nextIndexes.every((index, position) => index === position)) return snapshot;

  return persistentSnapshot(
    snapshot,
    nextIndexes.map((index) => cloneGroup(groups[index])),
    Number.isFinite(Number(now)) ? Number(now) : Date.now(),
  );
}

/**
 * Snapshot DOM keys contain the array index. Reordering must therefore move
 * collapse state, explicit group order, and per-group tab order atomically by
 * snapshotGroupId, otherwise state is silently applied to the wrong Tag.
 */
export function remapSnapshotGroupIndexedState({
  beforeSnapshot = null,
  afterSnapshot = null,
  spaceId = '',
  groupOrder = [],
  collapsedGroups = {},
  tabOrder = {},
} = {}) {
  const beforeGroups = validSnapshotGroups(beforeSnapshot) || [];
  const afterGroups = validSnapshotGroups(afterSnapshot) || [];
  const afterIndexesByIdentity = uniqueGroupIndexesByIdentity(afterGroups);
  const replacements = new Map();
  const beforeKeys = new Set();

  for (let index = 0; index < beforeGroups.length; index += 1) {
    const group = beforeGroups[index];
    const oldKey = dormantSnapshotGroupKey(index, group, spaceId);
    beforeKeys.add(oldKey);
    const identity = snapshotIdentity(group.snapshotGroupId);
    const nextIndex = identity ? afterIndexesByIdentity.get(identity) : undefined;
    if (nextIndex === undefined) continue;
    replacements.set(
      oldKey,
      dormantSnapshotGroupKey(nextIndex, afterGroups[nextIndex], spaceId),
    );
  }

  return {
    groupOrder: remapIndexedSequence(groupOrder, replacements, beforeKeys),
    collapsedGroups: remapIndexedRecord(collapsedGroups, replacements, beforeKeys),
    tabOrder: remapIndexedRecord(tabOrder, replacements, beforeKeys),
    replacements: Object.fromEntries(replacements),
  };
}

export function resolveDormantGroupReference(groups, reference = {}, groupKey = '') {
  const candidates = arrayValue(groups).filter(isRecord);
  const snapshotGroupId = snapshotIdentity(reference?.snapshotGroupId);
  if (snapshotGroupId) {
    return uniqueCandidate(candidates.filter((group) => (
      snapshotIdentity(group?.snapshotGroupId) === snapshotGroupId
    )));
  }

  const legacyKeys = new Set([
    cleanText(groupKey),
    cleanText(reference?.key),
    cleanText(reference?.dormantGroupKey),
  ].filter(Boolean));
  if (legacyKeys.size === 0) return null;
  return uniqueCandidate(candidates.filter((group) => legacyKeys.has(cleanText(group?.key))));
}

export function resolveDormantTabReference(group, reference = {}) {
  const candidates = arrayValue(group?.tabs).filter(isRecord);
  const snapshotTabId = snapshotIdentity(reference?.snapshotTabId);
  if (snapshotTabId) {
    return uniqueCandidate(candidates.filter((tab) => (
      snapshotIdentity(tab?.snapshotTabId) === snapshotTabId
    )));
  }

  const url = cleanText(reference?.url);
  if (!url) return null;
  const title = dormantTabTitle(reference);
  return uniqueCandidate(candidates.filter((tab) => (
    cleanText(tab?.url) === url && dormantTabTitle(tab) === title
  )));
}

export function projectDormantSnapshotGroupUpdate(
  snapshot,
  reference,
  updater,
  now = Date.now(),
) {
  const groups = validSnapshotGroups(snapshot);
  if (!groups || typeof updater !== 'function') return snapshot;
  const targetIndex = storedGroupIndex(groups, reference);
  if (targetIndex < 0) return snapshot;

  const updatedGroup = updater(cloneGroup(groups[targetIndex]));
  if (updatedGroup !== null && !validGroup(updatedGroup)) return snapshot;
  const nextGroups = groups.slice();
  if (updatedGroup && snapshotGroupShouldPersist(snapshot, updatedGroup)) {
    nextGroups[targetIndex] = cloneGroup(updatedGroup);
  } else {
    nextGroups.splice(targetIndex, 1);
  }
  return persistentSnapshot(
    snapshot,
    nextGroups,
    Number.isFinite(Number(now)) ? Number(now) : Date.now(),
  );
}

export function projectDormantSnapshotGroupRename(snapshot, reference, title, now = Date.now()) {
  return projectDormantSnapshotGroupUpdate(snapshot, reference, (group) => ({
    ...group,
    title,
  }), now);
}

export function projectDormantSnapshotGroupRemoval(snapshot, reference, now = Date.now()) {
  return projectDormantSnapshotGroupUpdate(snapshot, reference, () => null, now);
}

export function projectOpenedDormantTabRemoval(
  snapshot,
  tabReference,
  groupReference,
  now = Date.now(),
) {
  const groups = validSnapshotGroups(snapshot);
  if (!groups) return snapshot;
  const reference = {
    ...recordValue(groupReference),
    snapshotGroupId: snapshotIdentity(tabReference?.snapshotGroupId) ||
      snapshotIdentity(groupReference?.snapshotGroupId),
  };
  const groupIndex = storedGroupIndex(groups, reference);
  if (groupIndex < 0) return snapshot;
  const targetTab = resolveDormantTabReference(groups[groupIndex], tabReference);
  if (!targetTab) return snapshot;

  const nextGroup = {
    ...groups[groupIndex],
    tabs: groups[groupIndex].tabs.filter((tab) => tab !== targetTab),
  };
  const nextGroups = groups.slice();
  if (snapshotGroupShouldPersist(snapshot, nextGroup)) nextGroups[groupIndex] = nextGroup;
  else nextGroups.splice(groupIndex, 1);
  return persistentSnapshot(snapshot, nextGroups, now);
}

export function projectSnapshotTabsRemoval(snapshot, targets, now = Date.now()) {
  const groups = validSnapshotGroups(snapshot);
  if (!groups || !Array.isArray(targets)) return snapshot;
  const removals = new Map();
  for (const target of targets) {
    const candidate = uniqueSnapshotTabRemovalCandidate(groups, target, removals);
    if (!candidate) continue;
    if (!removals.has(candidate.groupIndex)) removals.set(candidate.groupIndex, new Set());
    removals.get(candidate.groupIndex).add(candidate.tab);
  }
  if (removals.size === 0) return snapshot;

  const nextGroups = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const removedTabs = removals.get(groupIndex);
    if (!removedTabs) {
      nextGroups.push(groups[groupIndex]);
      continue;
    }
    const nextGroup = {
      ...groups[groupIndex],
      tabs: groups[groupIndex].tabs.filter((tab) => !removedTabs.has(tab)),
    };
    if (snapshotGroupShouldPersist(snapshot, nextGroup)) nextGroups.push(nextGroup);
  }
  return persistentSnapshot(snapshot, nextGroups, now);
}

/**
 * Resolves one row for the close-event cleanup path without ever guessing
 * between duplicate saved pages. A durable row id is global and authoritative;
 * legacy URL, navigation, and title/domain fallbacks are accepted only when
 * exactly one compatible row remains in the requested group scope.
 */
export function resolveSnapshotTabRemovalMatch(snapshot, target, options = {}) {
  const groups = validSnapshotGroups(snapshot);
  if (!groups || !isRecord(target)) return null;
  const candidates = groups.flatMap((group, groupIndex) => (
    group.tabs.map((tab, tabIndex) => ({ group, groupIndex, tab, tabIndex }))
  ));
  const snapshotTabId = snapshotIdentity(target.snapshotTabId);
  if (snapshotTabId) {
    return uniqueCandidate(candidates.filter((candidate) => (
      snapshotIdentity(candidate.tab.snapshotTabId) === snapshotTabId
    )));
  }

  const requiredGroupKey = options.requireGroup
    ? cleanText(target.groupKey)
    : '';
  const compatible = candidates.filter((candidate) => (
    (!requiredGroupKey || chromeGroupTitleKey(candidate.group.title) === requiredGroupKey) &&
    !snapshotTabIdentitiesConflict(target, candidate.tab)
  ));
  const exactUrls = uniqueCleanTexts(target.urlIdentities);
  const exactMatches = compatible.filter((candidate) => (
    exactUrls.includes(cleanText(candidate.tab.url))
  ));
  if (exactMatches.length > 0) return uniqueCandidate(exactMatches);

  const navigationUrls = uniqueCleanTexts(target.navigationUrlKeys);
  const navigationMatches = compatible.filter((candidate) => (
    navigationUrls.includes(comparableSnapshotUrl(candidate.tab.url))
  ));
  if (navigationMatches.length > 0) return uniqueCandidate(navigationMatches);
  if (exactUrls.length > 0) return null;

  const titleDomainPairs = arrayValue(target.titleDomainPairs).filter(isTitleDomainPair);
  return uniqueCandidate(compatible.filter((candidate) => (
    titleDomainPairs.some((pair) => (
      pair.titleKey === savedTabTitleKey(candidate.tab) &&
      pair.domain === domainFromUrl(candidate.tab.url)
    ))
  )));
}

/**
 * Associates a live tab with the transient record created when a saved row was
 * opened. Durable row identity wins, then the current Chrome tab id. A legacy
 * URL fallback additionally requires one compatible record and one live tab
 * with that URL, preventing a normal duplicate tab from editing another row.
 */
export function resolveOpenedDormantRecordForLiveTab(
  tab,
  records,
  { groupReference = {}, liveTabs } = {},
) {
  if (!isRecord(tab)) return null;
  const candidates = arrayValue(records).filter(isRecord);
  const snapshotTabId = snapshotIdentity(tab.snapshotTabId);
  if (snapshotTabId) {
    const stableMatches = candidates.filter((record) => (
      snapshotIdentity(record.snapshotTabId) === snapshotTabId
    ));
    if (stableMatches.length > 0) return uniqueCandidate(stableMatches);
  }

  const tabId = safeTabId(tab.id);
  if (tabId !== null) {
    const tabIdMatches = candidates.filter((record) => (
      safeTabId(record.tabId) === tabId &&
      !snapshotTabIdentitiesConflict(tab, record)
    ));
    if (tabIdMatches.length > 0) return uniqueCandidate(tabIdMatches);
  }
  if (snapshotTabId) return null;

  const urlIdentity = cleanText(tab.url);
  if (!urlIdentity) return null;
  const legacyMatches = candidates.filter((record) => (
    cleanText(record.urlIdentity || record.url) === urlIdentity &&
    openedRecordGroupMatches(tab, record, groupReference)
  ));
  if (legacyMatches.length !== 1) return null;

  const liveCandidates = Array.isArray(liveTabs) ? liveTabs : [tab];
  const sameUrlLiveTabs = liveCandidates.filter((candidate) => (
    isRecord(candidate) && cleanText(candidate.url) === urlIdentity
  ));
  if (sameUrlLiveTabs.length !== 1) return null;
  const onlyLiveTabId = safeTabId(sameUrlLiveTabs[0].id);
  if (tabId !== null ? onlyLiveTabId !== tabId : sameUrlLiveTabs[0] !== tab) return null;
  return legacyMatches[0];
}

/**
 * Persists the exact mixed live/saved row order shown for one Tag. Chrome-only
 * rows that cannot be restored remain governed by live tabOrder and are not
 * converted into misleading saved pages.
 */
export function projectSnapshotTabOrder(
  snapshot,
  groupReference,
  orderedTabs,
  now = Date.now(),
) {
  const groups = validSnapshotGroups(snapshot);
  if (
    !groups ||
    !Array.isArray(orderedTabs) ||
    !orderedTabs.every(isRecord)
  ) return snapshot;
  const targetIndex = storedGroupIndex(groups, groupReference);
  if (targetIndex < 0) return snapshot;

  const tabs = orderedTabs
    .filter((tab) => !tab.pinned && isRestorableSnapshotTab(tab))
    .map(snapshotTabFromVisibleRow);
  if (sameRecords(tabs, groups[targetIndex].tabs)) return snapshot;

  const nextGroups = groups.slice();
  const nextGroup = { ...groups[targetIndex], tabs };
  if (snapshotGroupShouldPersist(snapshot, nextGroup)) nextGroups[targetIndex] = nextGroup;
  else nextGroups.splice(targetIndex, 1);
  return persistentSnapshot(
    snapshot,
    nextGroups,
    Number.isFinite(Number(now)) ? Number(now) : Date.now(),
  );
}

function uniqueSnapshotTabRemovalCandidate(groups, target, removals) {
  if (!isRecord(target)) return null;
  const snapshotTabId = snapshotIdentity(target.snapshotTabId);
  const targetUrl = cleanText(target.url);
  if (!snapshotTabId && !targetUrl) return null;
  const groupTitle = Object.hasOwn(target, 'groupTitle')
    ? cleanText(target.groupTitle)
    : null;
  const groupColor = cleanText(target.groupColor);
  const candidates = [];

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    if (!snapshotTabId && !legacyRemovalGroupMatches(group, groupTitle, groupColor)) continue;
    for (const candidate of group.tabs) {
      if (removals.get(groupIndex)?.has(candidate)) continue;
      const matches = snapshotTabId
        ? snapshotIdentity(candidate.snapshotTabId) === snapshotTabId
        : cleanText(candidate.url) === targetUrl;
      if (matches) candidates.push({ groupIndex, tab: candidate });
    }
  }
  return uniqueCandidate(candidates);
}

function openedRecordGroupMatches(tab, record, groupReference) {
  const targetGroupId = snapshotIdentity(tab.snapshotGroupId) ||
    snapshotIdentity(groupReference?.snapshotGroupId);
  const recordGroupId = snapshotIdentity(record.snapshotGroupId);
  if (targetGroupId && recordGroupId) return targetGroupId === recordGroupId;

  const targetGroupKey = chromeGroupTitleKey(
    groupReference?.title || groupReference?.displayTitle,
  );
  const recordGroupKey = cleanText(record.groupKey) ||
    chromeGroupTitleKey(record.groupTitle);
  if (!targetGroupKey || targetGroupKey !== recordGroupKey) return false;
  const targetColor = normalizedColor(groupReference?.color);
  const recordColor = normalizedColor(record.groupColor);
  return !targetColor || !recordColor || targetColor === recordColor;
}

function savedTabTitleKey(tab) {
  return groupTitleKey(tab?.displayTitle || tab?.title || tab?.url);
}

function isTitleDomainPair(pair) {
  return isRecord(pair) &&
    cleanText(pair.titleKey) &&
    cleanText(pair.domain) &&
    pair.domain !== 'unknown';
}

function uniqueCleanTexts(values) {
  return [...new Set(arrayValue(values).map(cleanText).filter(Boolean))];
}

function safeTabId(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && !value.trim())
  ) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

function normalizedColor(value) {
  return cleanText(value).toLowerCase();
}

function legacyRemovalGroupMatches(group, title, color) {
  const candidateTitle = storedSnapshotGroupTitle(group);
  if (title !== null && candidateTitle !== title) return false;
  return !color || (cleanText(group.color) || (
    candidateTitle === 'Ungrouped' ? 'grey' : 'blue'
  )) === color;
}

function storedGroupIndex(groups, reference = {}) {
  if (!isRecord(reference)) return -1;
  const snapshotGroupId = snapshotIdentity(reference.snapshotGroupId);
  if (snapshotGroupId) {
    return uniqueIndex(groups, (group) => (
      snapshotIdentity(group.snapshotGroupId) === snapshotGroupId
    ));
  }

  const title = cleanText(reference.title);
  if (!title) return -1;
  const color = cleanText(reference.color) || (title === 'Ungrouped' ? 'grey' : 'blue');
  const metadataIndex = uniqueIndex(groups, (group) => (
    storedSnapshotGroupTitle(group) === title &&
    (cleanText(group.color) || (title === 'Ungrouped' ? 'grey' : 'blue')) === color
  ));
  if (metadataIndex < 0) return -1;

  const keyIndex = dormantSnapshotGroupIndexFromKey(reference.key);
  return keyIndex < 0 || keyIndex === metadataIndex ? metadataIndex : -1;
}

function persistentSnapshot(snapshot, groups, now) {
  const nextSnapshot = { ...snapshot, updatedAt: now, groups };
  return snapshotHasPersistentContent(nextSnapshot) ? nextSnapshot : null;
}

function validSnapshotGroups(snapshot) {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.groups)) return null;
  return snapshot.groups.every(validGroup) ? snapshot.groups : null;
}

function validGroup(group) {
  return isRecord(group) && Array.isArray(group.tabs) && group.tabs.every(isRecord);
}

function cloneGroup(group) {
  return {
    ...group,
    tabs: group.tabs.map((tab) => ({ ...tab })),
  };
}

function snapshotTabFromVisibleRow(tab) {
  const record = {
    title: String(tab.title || tab.url),
    url: String(tab.url).trim(),
  };
  const snapshotTabId = snapshotIdentity(tab.snapshotTabId);
  if (snapshotTabId) record.snapshotTabId = snapshotTabId;
  const panelTitle = cleanText(tab.panelTitle);
  if (panelTitle) record.panelTitle = panelTitle;
  return record;
}

function sameRecords(left, right) {
  return left.length === right.length && left.every((record, index) => {
    const candidate = right[index];
    const keys = Object.keys(record).sort();
    const candidateKeys = Object.keys(candidate).sort();
    return keys.length === candidateKeys.length &&
      keys.every((key, keyIndex) => (
        key === candidateKeys[keyIndex] && record[key] === candidate[key]
      ));
  });
}

function uniqueIndex(values, predicate) {
  let match = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (!predicate(values[index])) continue;
    if (match >= 0) return -1;
    match = index;
  }
  return match;
}

function uniqueCandidate(candidates) {
  return candidates.length === 1 ? candidates[0] : null;
}

function uniqueGroupIndexesByIdentity(groups) {
  const indexes = new Map();
  const duplicates = new Set();
  for (let index = 0; index < groups.length; index += 1) {
    const identity = snapshotIdentity(groups[index]?.snapshotGroupId);
    if (!identity) continue;
    if (indexes.has(identity)) duplicates.add(identity);
    else indexes.set(identity, index);
  }
  for (const identity of duplicates) indexes.delete(identity);
  return indexes;
}

function remapIndexedSequence(values, replacements, beforeKeys) {
  const output = [];
  const seen = new Set();
  for (const rawKey of arrayValue(values)) {
    const key = String(rawKey);
    const nextKey = replacements.get(key) || (beforeKeys.has(key) ? '' : key);
    if (!nextKey || seen.has(nextKey)) continue;
    seen.add(nextKey);
    output.push(nextKey);
  }
  return output;
}

function remapIndexedRecord(value, replacements, beforeKeys) {
  const source = recordValue(value);
  const output = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!beforeKeys.has(key)) output[key] = cloneValue(entry);
  }
  for (const [oldKey, nextKey] of replacements) {
    if (Object.hasOwn(source, oldKey)) output[nextKey] = cloneValue(source[oldKey]);
  }
  return output;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
}

function dormantTabTitle(tab) {
  return cleanText(tab?.title || tab?.displayTitle);
}

function storedSnapshotGroupTitle(group = {}) {
  return Object.hasOwn(group || {}, 'title') ? cleanText(group?.title) : 'Ungrouped';
}

function snapshotIdentity(value) {
  return cleanText(value);
}

function cleanText(value) {
  return String(value || '').trim();
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function recordValue(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
