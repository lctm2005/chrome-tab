import { comparableSnapshotUrl } from './space-snapshot.js';

const ORGANIZATION_FINGERPRINT_VERSION = 2;

/**
 * Builds the logical Auto Group input without presenting saved snapshot rows as
 * extra copies of tabs that are already open.
 *
 * Snapshot rows are the stable spine of the candidate list. An open tab is
 * matched to at most one snapshot row, preferring its current group, and any
 * unmatched open tabs are appended afterwards. This keeps numeric planner ids
 * stable while the same logical Space state is being reviewed.
 */
export function buildOrganizationCandidates({ liveGroups = [], snapshot = null } = {}) {
  const liveEntries = flattenLiveGroups(liveGroups);
  const snapshotEntries = flattenSnapshot(snapshot);
  const liveMatchBySnapshotKey = matchLiveEntriesToSnapshot(liveEntries, snapshotEntries);
  const matchedLiveIndexes = new Set(liveMatchBySnapshotKey.values());
  const candidates = [];

  for (const snapshotEntry of snapshotEntries) {
    const liveIndex = liveMatchBySnapshotKey.get(snapshotEntry.key);
    const liveEntry = liveIndex === undefined ? null : liveEntries[liveIndex];
    candidates.push(candidateFromSnapshot(candidates.length + 1, snapshotEntry, liveEntry));
  }

  for (let liveIndex = 0; liveIndex < liveEntries.length; liveIndex += 1) {
    if (matchedLiveIndexes.has(liveIndex)) continue;
    candidates.push(candidateFromUnmatchedLive(candidates.length + 1, liveEntries[liveIndex]));
  }

  return {
    candidates,
    fingerprint: fingerprintCandidates(candidates, snapshot),
  };
}

/**
 * Rebinds an AI proposal to the current candidate ids without trusting their
 * positional ids from the preview. Page titles and unrelated rows may change
 * while the preview is open; the targets themselves must retain a stable live
 * tab id or a unique saved Tag + URL identity.
 */
export function rebaseOrganizationPlan({
  previewCandidates = [],
  currentCandidates = [],
  plannedGroups = [],
} = {}) {
  const previewById = indexCandidates(previewCandidates);
  indexCandidates(currentCandidates);
  const assignments = normalizeAssignments(plannedGroups, previewById);
  const currentIdByPreviewId = new Map();
  const usedCurrentIds = new Set();

  for (const assignment of assignments) {
    if (currentIdByPreviewId.has(assignment.candidateId)) continue;
    const previewCandidate = previewById.get(assignment.candidateId);
    const currentCandidate = resolveCurrentPlanCandidate(
      previewCandidate,
      previewCandidates,
      currentCandidates,
    );
    const currentId = Number(currentCandidate.id);
    if (usedCurrentIds.has(currentId)) {
      throw stalePlanError('could not be matched unambiguously');
    }
    usedCurrentIds.add(currentId);
    currentIdByPreviewId.set(assignment.candidateId, currentId);
  }

  return plannedGroups.map((group) => ({
    ...group,
    tabIds: arrayValue(group?.tabIds).map((candidateId) => {
      const currentId = currentIdByPreviewId.get(Number(candidateId));
      if (!Number.isSafeInteger(currentId)) {
        throw stalePlanError('is no longer available');
      }
      return currentId;
    }),
  }));
}

/**
 * Applies a confirmed Auto Group plan to the saved snapshot explicitly.
 *
 * Unlike merge-by-URL snapshot refreshes, this function only moves candidate
 * rows named by the confirmed plan. Unplanned rows and group metadata retain
 * their original order. Empty source groups are intentionally preserved so a
 * live-tab regroup cannot silently erase a historical Tag.
 */
export function applyOrganizationPlanToSnapshot({
  snapshot = null,
  candidates = [],
  plannedGroups = [],
  now = Date.now(),
} = {}) {
  const source = cloneSnapshot(snapshot);
  const originalSnapshotTabCount = snapshotTabCount(source);
  const candidateById = indexCandidates(candidates);
  const assignments = normalizeAssignments(plannedGroups, candidateById);
  if (assignments.length === 0) return source;

  const groups = source.groups;
  const assignedSnapshotLocations = new Set();
  const originalGroupIndexesByTitle = groupIndexesByTitle(groups);
  const moves = [];

  for (const assignment of assignments) {
    const candidate = candidateById.get(assignment.candidateId);
    const location = snapshotLocation(candidate);
    let tabRecord;

    if (location) {
      const locationKey = snapshotLocationKey(location.groupIndex, location.tabIndex);
      if (assignedSnapshotLocations.has(locationKey)) {
        throw new Error(`Organization candidates reuse snapshot row ${locationKey}.`);
      }
      tabRecord = snapshotTabAt(source, location, candidate);
      assignedSnapshotLocations.add(locationKey);
      const sourceTitle = normalizedGroupTitle(groups[location.groupIndex]?.title);
      if (normalizedGroupTitle(assignment.title) === sourceTitle) {
        continue;
      }
    } else if (candidate?.source?.kind === 'live') {
      tabRecord = snapshotTabFromLiveCandidate(candidate);
    } else {
      throw new Error(`Organization candidate ${assignment.candidateId} has no usable source.`);
    }

    moves.push({
      ...assignment,
      candidate,
      location,
      tabRecord,
    });
  }
  if (moves.length === 0) return source;

  const removalIndexesByGroup = new Map();
  for (const move of moves) {
    if (!move.location) continue;
    if (!removalIndexesByGroup.has(move.location.groupIndex)) {
      removalIndexesByGroup.set(move.location.groupIndex, new Set());
    }
    removalIndexesByGroup.get(move.location.groupIndex).add(move.location.tabIndex);
  }

  for (const [groupIndex, tabIndexes] of removalIndexesByGroup) {
    groups[groupIndex].tabs = groups[groupIndex].tabs.filter((_, tabIndex) => !tabIndexes.has(tabIndex));
  }

  const plannedTargetGroupIndexByTitle = new Map();

  for (const move of moves) {
    const titleKey = normalizedGroupTitle(move.title);
    let targetGroupIndex = plannedTargetGroupIndexByTitle.get(titleKey);
    if (targetGroupIndex === undefined) {
      const originalTargetIndexes = originalGroupIndexesByTitle.get(titleKey) || [];
      if (originalTargetIndexes.length > 0) {
        // Same-named source rows were already retained at their exact snapshot
        // locations above. A genuinely incoming row may join an existing
        // target, but it must never relocate or combine those source histories.
        [targetGroupIndex] = originalTargetIndexes;
      } else {
        targetGroupIndex = groups.length;
        groups.push({
          title: move.title,
          color: move.color || 'blue',
          collapsed: false,
          tabs: [],
        });
      }
      plannedTargetGroupIndexByTitle.set(titleKey, targetGroupIndex);
    }
    groups[targetGroupIndex].tabs.push(move.tabRecord);
  }

  const expectedCount = originalSnapshotTabCount + moves.filter((move) => !move.location).length;
  const actualCount = groups.reduce((sum, group) => sum + group.tabs.length, 0);
  if (actualCount !== expectedCount) {
    throw new Error(`Organization snapshot changed tab count from ${expectedCount} to ${actualCount}.`);
  }

  return {
    ...source,
    preserveGroups: true,
    updatedAt: finiteTimestamp(now, source.updatedAt),
    groups,
  };
}

function flattenLiveGroups(liveGroups) {
  const entries = [];
  arrayValue(liveGroups).forEach((group, groupIndex) => {
    const currentGroup = normalizeCurrentGroup(group, groupIndex, 'live');
    arrayValue(group?.tabs).forEach((tab, tabIndex) => {
      entries.push({
        group,
        groupIndex,
        tab,
        tabIndex,
        currentGroup,
        exactUrl: exactUrlIdentity(tab?.url),
        fallbackUrl: comparableSnapshotUrl(tab?.url),
      });
    });
  });
  return entries;
}

function flattenSnapshot(snapshot) {
  const entries = [];
  arrayValue(snapshot?.groups).forEach((group, groupIndex) => {
    const currentGroup = normalizeCurrentGroup(group, groupIndex, 'snapshot');
    arrayValue(group?.tabs).forEach((tab, tabIndex) => {
      entries.push({
        key: snapshotLocationKey(groupIndex, tabIndex),
        group,
        groupIndex,
        tab,
        tabIndex,
        currentGroup,
        exactUrl: exactUrlIdentity(tab?.url),
        fallbackUrl: comparableSnapshotUrl(tab?.url),
      });
    });
  });
  return entries;
}

function matchLiveEntriesToSnapshot(liveEntries, snapshotEntries) {
  const matchBySnapshotKey = new Map();
  const matchedLiveIndexes = new Set();
  const matchedSnapshotKeys = new Set();

  // Reserve every complete-URL match before considering navigation fallback.
  // Otherwise an earlier live sibling such as `?id=3` could consume the saved
  // `?id=1` row before the actual `?id=1` live tab is visited.
  matchLiveEntriesByUrl({
    liveEntries,
    snapshotEntries,
    liveUrlKey: 'exactUrl',
    snapshotUrlKey: 'exactUrl',
    matchBySnapshotKey,
    matchedLiveIndexes,
    matchedSnapshotKeys,
  });
  matchLiveEntriesByUrl({
    liveEntries,
    snapshotEntries,
    liveUrlKey: 'fallbackUrl',
    snapshotUrlKey: 'fallbackUrl',
    matchBySnapshotKey,
    matchedLiveIndexes,
    matchedSnapshotKeys,
  });

  return matchBySnapshotKey;
}

function matchLiveEntriesByUrl({
  liveEntries,
  snapshotEntries,
  liveUrlKey,
  snapshotUrlKey,
  matchBySnapshotKey,
  matchedLiveIndexes,
  matchedSnapshotKeys,
}) {
  for (let liveIndex = 0; liveIndex < liveEntries.length; liveIndex += 1) {
    if (matchedLiveIndexes.has(liveIndex)) continue;
    const liveEntry = liveEntries[liveIndex];
    const urlKey = liveEntry[liveUrlKey];
    if (!urlKey) continue;
    const candidates = snapshotEntries.filter((entry) => (
      !matchedSnapshotKeys.has(entry.key) && entry[snapshotUrlKey] === urlKey
    ));
    const match = candidates.find((entry) => sameGroup(entry.currentGroup, liveEntry.currentGroup, true)) ||
      candidates.find((entry) => sameGroup(entry.currentGroup, liveEntry.currentGroup, false)) ||
      candidates[0];
    if (!match) continue;
    matchBySnapshotKey.set(match.key, liveIndex);
    matchedLiveIndexes.add(liveIndex);
    matchedSnapshotKeys.add(match.key);
  }
}

function candidateFromSnapshot(id, snapshotEntry, liveEntry) {
  const snapshotSource = {
    groupIndex: snapshotEntry.groupIndex,
    tabIndex: snapshotEntry.tabIndex,
    groupTitle: snapshotEntry.currentGroup.title,
    groupColor: snapshotEntry.currentGroup.color,
    url: String(snapshotEntry.tab?.url || ''),
  };
  if (!liveEntry) {
    return {
      id,
      title: snapshotDisplayTitle(snapshotEntry.tab),
      pageTitle: String(snapshotEntry.tab?.title || snapshotEntry.tab?.url || 'Untitled'),
      panelTitle: cleanText(snapshotEntry.tab?.panelTitle),
      url: String(snapshotEntry.tab?.url || ''),
      pinned: false,
      dormant: true,
      currentGroup: snapshotEntry.currentGroup,
      source: {
        kind: 'snapshot',
        snapshot: snapshotSource,
      },
    };
  }

  return {
    id,
    title: liveDisplayTitle(liveEntry.tab),
    pageTitle: String(liveEntry.tab?.title || liveEntry.tab?.url || 'Untitled'),
    panelTitle: cleanText(liveEntry.tab?.panelTitle),
    url: String(liveEntry.tab?.url || ''),
    pinned: Boolean(liveEntry.tab?.pinned),
    dormant: false,
    currentGroup: liveEntry.currentGroup,
    source: {
      kind: 'live',
      live: liveSource(liveEntry),
      snapshot: snapshotSource,
    },
  };
}

function candidateFromUnmatchedLive(id, liveEntry) {
  return {
    id,
    title: liveDisplayTitle(liveEntry.tab),
    pageTitle: String(liveEntry.tab?.title || liveEntry.tab?.url || 'Untitled'),
    panelTitle: cleanText(liveEntry.tab?.panelTitle),
    url: String(liveEntry.tab?.url || ''),
    pinned: Boolean(liveEntry.tab?.pinned),
    dormant: false,
    currentGroup: liveEntry.currentGroup,
    source: {
      kind: 'live',
      live: liveSource(liveEntry),
      snapshot: null,
    },
  };
}

function liveSource(entry) {
  return {
    tabId: entry.tab?.id ?? null,
    groupId: entry.group?.id ?? null,
    groupIndex: entry.groupIndex,
    tabIndex: entry.tabIndex,
  };
}

function resolveCurrentPlanCandidate(previewCandidate, previewCandidates, currentCandidates) {
  const liveTabId = Number(previewCandidate?.source?.live?.tabId);
  let currentCandidate;

  if (Number.isSafeInteger(liveTabId)) {
    const matches = currentCandidates.filter((candidate) => (
      Number(candidate?.source?.live?.tabId) === liveTabId
    ));
    if (matches.length !== 1) throw stalePlanError('is no longer open');
    [currentCandidate] = matches;
    if (exactUrlIdentity(currentCandidate.url) !== exactUrlIdentity(previewCandidate.url)) {
      throw stalePlanError('navigated to another page');
    }
  } else {
    const previewMatches = snapshotIdentityMatches(previewCandidates, previewCandidate);
    const currentMatches = snapshotIdentityMatches(currentCandidates, previewCandidate);
    if (previewMatches.length === 0 || currentMatches.length === 0) {
      throw stalePlanError('saved row changed or was removed');
    }
    if (previewMatches.length !== 1 || currentMatches.length !== 1) {
      throw stalePlanError('saved row could not be matched unambiguously');
    }
    [currentCandidate] = currentMatches;
  }

  if (currentCandidate.pinned) throw stalePlanError('was pinned');
  if (
    normalizedGroupTitle(currentCandidate.currentGroup?.title) !==
    normalizedGroupTitle(previewCandidate.currentGroup?.title)
  ) {
    throw stalePlanError('moved to another Tag');
  }
  return currentCandidate;
}

function snapshotIdentityMatches(candidates, previewCandidate) {
  const source = previewCandidate?.source?.snapshot;
  const groupTitle = normalizedGroupTitle(source?.groupTitle || previewCandidate?.currentGroup?.title);
  const url = exactUrlIdentity(source?.url !== undefined ? source.url : previewCandidate?.url);
  if (!source || !groupTitle || !url) return [];
  return arrayValue(candidates).filter((candidate) => {
    const candidateSource = candidate?.source?.snapshot;
    return candidateSource &&
      normalizedGroupTitle(candidateSource.groupTitle || candidate?.currentGroup?.title) === groupTitle &&
      exactUrlIdentity(candidateSource.url !== undefined ? candidateSource.url : candidate?.url) === url;
  });
}

function stalePlanError(reason) {
  return new Error(`An Auto Group target ${reason}. Review a fresh preview before applying groups.`);
}

function normalizeCurrentGroup(group, groupIndex, source) {
  const title = cleanText(group?.title) || 'Ungrouped';
  const color = cleanText(group?.color) || (title === 'Ungrouped' ? 'grey' : 'blue');
  const fallbackKey = source === 'live' && group?.id !== undefined && group?.id !== null
    ? `group:${group.id}`
    : `${source}:${groupIndex}:${title}`;
  return {
    id: group?.id ?? null,
    key: cleanText(group?.key) || fallbackKey,
    title,
    color,
    collapsed: Boolean(group?.collapsed),
    source,
  };
}

function sameGroup(left, right, includeColor) {
  if (normalizedGroupTitle(left?.title) !== normalizedGroupTitle(right?.title)) return false;
  return !includeColor || cleanText(left?.color) === cleanText(right?.color);
}

function indexCandidates(candidates) {
  const byId = new Map();
  for (const candidate of arrayValue(candidates)) {
    const id = Number(candidate?.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid organization candidate id: ${candidate?.id}.`);
    if (byId.has(id)) throw new Error(`Duplicate organization candidate id: ${id}.`);
    byId.set(id, candidate);
  }
  return byId;
}

function normalizeAssignments(plannedGroups, candidateById) {
  const assignedIds = new Set();
  const assignments = [];
  for (const group of arrayValue(plannedGroups)) {
    const title = cleanText(group?.title);
    const tabIds = arrayValue(group?.tabIds);
    if (!title && tabIds.length > 0) throw new Error('Organization plan group title is required.');
    for (const value of tabIds) {
      const candidateId = Number(value);
      if (!Number.isSafeInteger(candidateId) || !candidateById.has(candidateId)) {
        throw new Error(`Organization plan references unknown candidate id: ${value}.`);
      }
      if (assignedIds.has(candidateId)) {
        throw new Error(`Organization plan assigns candidate ${candidateId} more than once.`);
      }
      assignedIds.add(candidateId);
      assignments.push({
        candidateId,
        title,
        color: cleanText(group?.color) || 'blue',
      });
    }
  }
  return assignments;
}

function snapshotLocation(candidate) {
  const location = candidate?.source?.snapshot;
  if (!location) return null;
  const groupIndex = Number(location.groupIndex);
  const tabIndex = Number(location.tabIndex);
  if (!Number.isSafeInteger(groupIndex) || groupIndex < 0 || !Number.isSafeInteger(tabIndex) || tabIndex < 0) {
    throw new Error(`Organization candidate ${candidate?.id} has an invalid snapshot location.`);
  }
  return { ...location, groupIndex, tabIndex };
}

function snapshotTabAt(snapshot, location, candidate) {
  const group = snapshot.groups[location.groupIndex];
  const tab = group?.tabs?.[location.tabIndex];
  if (!tab) throw new Error(`Organization snapshot row ${snapshotLocationKey(location.groupIndex, location.tabIndex)} no longer exists.`);
  const expectedUrl = exactUrlIdentity(location.url !== undefined ? location.url : candidate?.url);
  const actualUrl = exactUrlIdentity(tab.url);
  if (actualUrl !== expectedUrl) {
    throw new Error(`Organization snapshot row ${snapshotLocationKey(location.groupIndex, location.tabIndex)} changed while the plan was open.`);
  }
  return { ...tab };
}

function snapshotTabFromLiveCandidate(candidate) {
  const url = String(candidate?.url || '').trim();
  if (!url) throw new Error(`Organization candidate ${candidate?.id} has no URL to save.`);
  const tab = {
    title: cleanText(candidate?.pageTitle) || cleanText(candidate?.title) || url,
    url,
  };
  const panelTitle = cleanText(candidate?.panelTitle);
  if (panelTitle) tab.panelTitle = panelTitle;
  return tab;
}

function cloneSnapshot(snapshot) {
  return {
    ...(snapshot && typeof snapshot === 'object' ? snapshot : {}),
    version: Number(snapshot?.version) || 1,
    updatedAt: finiteTimestamp(snapshot?.updatedAt, 0),
    groups: arrayValue(snapshot?.groups).map((group) => ({
      ...group,
      tabs: arrayValue(group?.tabs).map((tab) => ({ ...tab })),
    })),
  };
}

function groupIndexesByTitle(groups) {
  const byTitle = new Map();
  groups.forEach((group, groupIndex) => {
    const titleKey = normalizedGroupTitle(group?.title);
    if (!titleKey) return;
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, []);
    byTitle.get(titleKey).push(groupIndex);
  });
  return byTitle;
}

function fingerprintCandidates(candidates, snapshot) {
  const value = JSON.stringify(stableValue({
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      pageTitle: candidate.pageTitle,
      panelTitle: candidate.panelTitle,
      url: candidate.url,
      dormant: candidate.dormant,
      currentGroup: candidate.currentGroup,
      source: candidate.source,
    })),
    // Empty historical groups have no candidates, but are still user data.
    // Include the complete group records so deleting or renaming one while a
    // preview is open invalidates the proposal instead of being overwritten.
    snapshotGroups: arrayValue(snapshot?.groups),
  }));
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `organization-v${ORGANIZATION_FINGERPRINT_VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}-${candidates.length}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .sort()
    .map((key) => [key, stableValue(value[key])]));
}

function snapshotDisplayTitle(tab) {
  return cleanText(tab?.panelTitle) || cleanText(tab?.title) || cleanText(tab?.url) || 'Untitled';
}

function liveDisplayTitle(tab) {
  return cleanText(tab?.displayTitle) || cleanText(tab?.panelTitle) || cleanText(tab?.title) || cleanText(tab?.url) || 'Untitled';
}

function normalizedGroupTitle(value) {
  return cleanText(value).toLowerCase();
}

function snapshotLocationKey(groupIndex, tabIndex) {
  return `${groupIndex}:${tabIndex}`;
}

function snapshotTabCount(snapshot) {
  return arrayValue(snapshot?.groups).reduce((sum, group) => sum + arrayValue(group?.tabs).length, 0);
}

function finiteTimestamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function exactUrlIdentity(value) {
  return String(value || '').trim();
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}
