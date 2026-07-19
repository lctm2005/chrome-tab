import { chromeGroupTitleKey } from './group-title.js';
import {
  comparableSnapshotUrl,
  isUngroupedSnapshotGroup,
  snapshotTabIdentitiesConflict,
} from './space-snapshot.js';

const TAB_MATCH_MODES = Object.freeze([
  'stable',
  'exact',
  'recently-opened',
  'navigation-fallback',
]);

/**
 * Combines the current Chrome groups with saved-only snapshot rows.
 *
 * Stable snapshot group identities are authoritative. Legacy groups may fall
 * back to a unique Chrome-title-and-color match, but two conflicting stable
 * identities are never merged just because their presentation matches.
 */
export function mergeLiveAndDormantGroups({
  liveGroups = [],
  dormantGroups = [],
  collapsedGroups = {},
  recentlyOpenedTabs = [],
} = {}) {
  const liveEntries = cloneGroupEntries(liveGroups);
  const dormantEntries = cloneGroupEntries(dormantGroups);
  const liveMatchByDormantTab = matchDormantTabsToLiveTabs(
    dormantEntries,
    liveEntries,
    recentlyOpenedTabs,
  );
  const liveGroupMatches = matchDormantGroupsToLiveGroups(liveEntries, dormantEntries);
  const ungroupedIndex = liveEntries.findIndex((entry) => entry.group.key === 'ungrouped');
  let ungrouped = ungroupedIndex >= 0 ? liveEntries[ungroupedIndex].group : null;
  const matchedLiveIndexes = new Set(liveGroupMatches.values());
  const snapshotOrderedOutput = [];

  for (let dormantIndex = 0; dormantIndex < dormantEntries.length; dormantIndex += 1) {
    const entry = dormantEntries[dormantIndex];
    const dormantGroup = entry.group;
    dormantGroup.collapsed = Boolean(
      collapsedGroups[dormantGroup.key] ?? dormantGroup.collapsed,
    );

    if (entry.ungrouped) {
      if (!ungrouped && dormantGroup.tabs.length > 0) {
        dormantGroup.tabs = dormantGroup.tabs.filter((tab) => !liveMatchByDormantTab.has(tab));
        ungrouped = dormantGroup;
      } else if (ungrouped) {
        const matchingLiveEntry = liveEntries[ungroupedIndex];
        ungrouped.tabs = matchingLiveEntry
          ? mergeTabsInSnapshotOrder(matchingLiveEntry, entry, liveMatchByDormantTab)
          : [...ungrouped.tabs, ...dormantGroup.tabs.filter((tab) => !liveMatchByDormantTab.has(tab))];
      }
      continue;
    }

    const matchingLiveIndex = liveGroupMatches.get(dormantIndex);
    if (matchingLiveIndex !== undefined) {
      const matchingLiveGroup = liveEntries[matchingLiveIndex].group;
      matchingLiveGroup.title = dormantGroup.title;
      matchingLiveGroup.displayTitle = dormantGroup.displayTitle || dormantGroup.title;
      matchingLiveGroup.tabs = mergeTabsInSnapshotOrder(
        liveEntries[matchingLiveIndex],
        entry,
        liveMatchByDormantTab,
      );
      snapshotOrderedOutput.push(matchingLiveGroup);
      continue;
    }

    dormantGroup.tabs = dormantGroup.tabs.filter((tab) => !liveMatchByDormantTab.has(tab));
    snapshotOrderedOutput.push(dormantGroup);
  }

  // Stored snapshot order is the durable user order and already includes
  // matched live groups. Truly new live-only groups follow that saved block in
  // their current Chrome order until the next snapshot checkpoint records them.
  const liveOnlyOutput = liveEntries
    .filter((_, index) => index !== ungroupedIndex && !matchedLiveIndexes.has(index))
    .map((entry) => entry.group);

  return ungrouped
    ? [...snapshotOrderedOutput, ...liveOnlyOutput, ungrouped]
    : [...snapshotOrderedOutput, ...liveOnlyOutput];
}

function cloneGroupEntries(groups) {
  return (groups || []).map((sourceGroup) => {
    const group = {
      ...sourceGroup,
      tabs: (sourceGroup.tabs || []).map((tab) => ({ ...tab })),
    };
    return {
      group,
      identity: stableGroupIdentity(group),
      metadataKey: groupMetadataKey(group),
      ungrouped: isUngroupedSnapshotGroup(group),
    };
  });
}

function stableGroupIdentity(group) {
  const ids = new Set([
    group.snapshotGroupId,
    ...group.tabs.map((tab) => tab.snapshotGroupId),
  ].map(cleanIdentity).filter(Boolean));
  return {
    id: ids.size === 1 ? [...ids][0] : '',
    ambiguous: ids.size > 1,
  };
}

function matchDormantGroupsToLiveGroups(liveEntries, dormantEntries) {
  const matches = new Map();
  const consumedLiveIndexes = new Set();
  const liveStableIndexes = indexesByStableIdentity(liveEntries);
  const dormantStableIndexes = indexesByStableIdentity(dormantEntries);

  for (const [identity, dormantIndexes] of dormantStableIndexes) {
    const liveIndexes = liveStableIndexes.get(identity) || [];
    if (liveIndexes.length !== 1 || dormantIndexes.length !== 1) continue;
    const dormantIndex = dormantIndexes[0];
    const liveIndex = liveIndexes[0];
    if (liveEntries[liveIndex].ungrouped || dormantEntries[dormantIndex].ungrouped) continue;
    matches.set(dormantIndex, liveIndex);
    consumedLiveIndexes.add(liveIndex);
  }

  const unmatchedLive = liveEntries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => (
      !entry.ungrouped &&
      !entry.identity.ambiguous &&
      !consumedLiveIndexes.has(index)
    ));
  const unmatchedDormant = dormantEntries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => (
      !entry.ungrouped &&
      !entry.identity.ambiguous &&
      !matches.has(index)
    ));
  const liveMetadataIndexes = indexesByMetadata(unmatchedLive);
  const dormantMetadataIndexes = indexesByMetadata(unmatchedDormant);

  for (const [metadataKey, dormantIndexes] of dormantMetadataIndexes) {
    const liveIndexes = liveMetadataIndexes.get(metadataKey) || [];
    if (liveIndexes.length !== 1 || dormantIndexes.length !== 1) continue;
    const dormantIndex = dormantIndexes[0];
    const liveIndex = liveIndexes[0];
    const liveIdentity = liveEntries[liveIndex].identity.id;
    const dormantIdentity = dormantEntries[dormantIndex].identity.id;
    if (liveIdentity && dormantIdentity) continue;
    matches.set(dormantIndex, liveIndex);
  }

  return matches;
}

function indexesByStableIdentity(entries) {
  const indexes = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const identity = entries[index].identity.id;
    if (!identity) continue;
    appendIndex(indexes, identity, index);
  }
  return indexes;
}

function indexesByMetadata(indexedEntries) {
  const indexes = new Map();
  for (const { entry, index } of indexedEntries) {
    appendIndex(indexes, entry.metadataKey, index);
  }
  return indexes;
}

function appendIndex(indexes, key, index) {
  if (!indexes.has(key)) indexes.set(key, []);
  indexes.get(key).push(index);
}

function matchDormantTabsToLiveTabs(dormantEntries, liveEntries, recentlyOpenedTabs) {
  const dormantTabs = dormantEntries.flatMap((entry) => (
    entry.group.tabs.map((tab) => ({ tab, entry }))
  ));
  const livePool = liveEntries.flatMap((entry) => (
    entry.group.tabs.map((tab) => ({
      tab,
      entry,
      snapshotTabId: cleanIdentity(tab.snapshotTabId),
      exactUrl: exactUrl(tab.url),
      navigationUrl: comparableSnapshotUrl(tab.url),
      consumed: false,
    }))
  ));
  const liveMatchByDormantTab = new Map();

  for (const matchMode of TAB_MATCH_MODES) {
    for (const sameGroupOnly of [true, false]) {
      for (const dormant of dormantTabs) {
        if (liveMatchByDormantTab.has(dormant.tab)) continue;
        const opened = matchMode === 'recently-opened'
          ? recentlyOpenedRecord(dormant, recentlyOpenedTabs)
          : null;
        const match = livePool.find((candidate) => (
          (!sameGroupOnly || groupsMatch(dormant.entry, candidate.entry)) &&
          tabMatches(dormant, candidate, matchMode, opened)
        ));
        if (!match) continue;
        match.consumed = true;
        liveMatchByDormantTab.set(dormant.tab, match);
      }
    }
  }
  return liveMatchByDormantTab;
}

function mergeTabsInSnapshotOrder(liveEntry, dormantEntry, liveMatchByDormantTab) {
  const placedLiveTabs = new Set();
  const ordered = [];
  for (const dormantTab of dormantEntry.group.tabs) {
    const match = liveMatchByDormantTab.get(dormantTab);
    if (!match) {
      ordered.push(dormantTab);
      continue;
    }
    // A stable row may have moved to another Tag. Consume its old saved copy,
    // but render the live row only in its current matching group.
    if (match.entry !== liveEntry) continue;
    ordered.push(match.tab);
    placedLiveTabs.add(match.tab);
  }
  for (const liveTab of liveEntry.group.tabs) {
    if (!placedLiveTabs.has(liveTab)) ordered.push(liveTab);
  }
  return ordered;
}

function tabMatches(dormant, candidate, matchMode, opened) {
  if (candidate.consumed) return false;
  if (snapshotTabIdentitiesConflict(dormant.tab, candidate)) return false;
  const dormantSnapshotTabId = cleanIdentity(dormant.tab.snapshotTabId);
  if (matchMode === 'stable') {
    return Boolean(
      dormantSnapshotTabId &&
      candidate.snapshotTabId === dormantSnapshotTabId
    );
  }
  if (stableGroupsConflict(dormant.entry, candidate.entry)) return false;
  if (matchMode === 'exact') {
    const dormantUrl = exactUrl(dormant.tab.url);
    return Boolean(dormantUrl && candidate.exactUrl === dormantUrl);
  }
  if (matchMode === 'recently-opened') {
    return Boolean(opened && liveTabMatchesOpenedRecord(candidate.tab, opened));
  }
  const dormantNavigationUrl = comparableSnapshotUrl(dormant.tab.url);
  return Boolean(
    dormantNavigationUrl &&
    candidate.navigationUrl === dormantNavigationUrl
  );
}

function groupsMatch(left, right) {
  if (left.identity.ambiguous || right.identity.ambiguous) return false;
  if (left.identity.id && right.identity.id) {
    return left.identity.id === right.identity.id;
  }
  return left.metadataKey === right.metadataKey;
}

function stableGroupsConflict(left, right) {
  return Boolean(
    left.identity.id &&
    right.identity.id &&
    left.identity.id !== right.identity.id
  );
}

function recentlyOpenedRecord(dormant, records) {
  const dormantUrl = exactUrl(dormant.tab.url);
  return (records || []).find((record) => (
    dormantUrl &&
    exactUrl(record.urlIdentity || record.url) === dormantUrl &&
    openedRecordMatchesGroup(record, dormant.entry)
  )) || null;
}

function openedRecordMatchesGroup(record, entry) {
  const recordIdentity = cleanIdentity(record.snapshotGroupId);
  if (recordIdentity && entry.identity.id) {
    return recordIdentity === entry.identity.id;
  }
  const recordTitleKey = record.groupKey || chromeGroupTitleKey(record.groupTitle);
  if (recordTitleKey !== chromeGroupTitleKey(entry.group.title)) return false;
  return !record.groupColor || normalizeColor(record.groupColor) === normalizeColor(entry.group.color);
}

function liveTabMatchesOpenedRecord(tab, opened) {
  const tabId = Number(opened.tabId);
  return Number.isSafeInteger(tabId) && Number(tab.id) === tabId;
}

function groupMetadataKey(group) {
  return `${chromeGroupTitleKey(group.title)}\n${normalizeColor(group.color)}`;
}

function normalizeColor(color) {
  return String(color || 'grey').trim().toLowerCase() || 'grey';
}

function cleanIdentity(value) {
  return String(value || '').trim();
}

function exactUrl(value) {
  return String(value || '').trim();
}
