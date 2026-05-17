const SPACE_COLORS = ['blue', 'green', 'purple', 'yellow', 'pink', 'cyan', 'orange'];
const GROUP_COLORS = ['blue', 'green', 'purple', 'yellow', 'pink', 'cyan', 'orange'];
const UNGROUPED_TITLE = 'Ungrouped';

export function createArcImportPlan(input, options = {}) {
  const data = parseArcInput(input);
  const source = pickArcSource(data);
  const existingSpaces = Array.isArray(options.existingSpaces) ? options.existingSpaces : [];
  const now = Number(options.now ?? Date.now());
  const usedIds = new Set(existingSpaces.map((space) => String(space.id || '')));
  const usedNames = new Set(existingSpaces.map((space) => String(space.name || space.title || '')));
  const itemsById = new Map(source.items.map((item) => [item.id, item]).filter(([id]) => id));

  const summary = {
    source: source.name,
    spaces: 0,
    folders: 0,
    tabs: 0,
    skipped: {
      emptyFolders: 0,
      invalidTabs: 0,
      unsupportedItems: 0,
      easel: 0,
      splitView: 0,
    },
  };
  const spaces = [];
  const spaceSnapshots = {};

  for (const [index, arcSpace] of orderedSpaces(source)) {
    const originalName = cleanText(arcSpace.title) || 'Arc Space';
    const importedSpace = {
      id: uniqueId(`arc-${arcSpace.id || originalName}`, usedIds),
      name: uniqueImportedName(originalName, usedNames),
      icon: iconForSpace(arcSpace, originalName),
      color: SPACE_COLORS[index % SPACE_COLORS.length],
    };
    const snapshotGroups = buildSnapshotGroupsForSpace(arcSpace, itemsById, summary);
    spaces.push(importedSpace);
    spaceSnapshots[importedSpace.id] = {
      version: 1,
      updatedAt: now,
      groups: snapshotGroups,
    };
    summary.spaces += 1;
  }

  return { spaces, spaceSnapshots, summary };
}

export function appendArcImportPlan(state, plan) {
  const spaces = Array.isArray(plan?.spaces) ? plan.spaces : [];
  const snapshots = plan?.spaceSnapshots && typeof plan.spaceSnapshots === 'object'
    ? plan.spaceSnapshots
    : {};
  if (!Array.isArray(state.spaces)) state.spaces = [];
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') state.spaceSnapshots = {};

  state.spaces.push(...spaces);
  Object.assign(state.spaceSnapshots, snapshots);

  return {
    importedSpaces: spaces.length,
    importedTabs: Object.values(snapshots).reduce((sum, snapshot) => (
      sum + arrayValue(snapshot?.groups).reduce((groupSum, group) => groupSum + arrayValue(group?.tabs).length, 0)
    ), 0),
  };
}

function parseArcInput(input) {
  if (typeof input !== 'string') return input || {};
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Arc import file is empty.');
  return JSON.parse(trimmed);
}

function pickArcSource(data = {}) {
  const candidates = [
    firebaseSource(data),
    sidebarSyncSource(data),
    sidebarSource(data),
  ];
  return candidates.find((source) => source.spaces.length || source.items.length) || {
    name: 'unknown',
    orderedSpaceIds: [],
    spaces: [],
    items: [],
  };
}

function firebaseSource(data) {
  const syncData = data.firebaseSyncState?.syncData || {};
  return {
    name: 'firebaseSyncState',
    orderedSpaceIds: arrayValue(syncData.orderedSpaceIDs?.value),
    spaces: normalizeRecords(syncData.spaceModels),
    items: normalizeRecords(syncData.items),
  };
}

function sidebarSyncSource(data) {
  const syncState = data.sidebarSyncState || {};
  return {
    name: 'sidebarSyncState',
    orderedSpaceIds: arrayValue(syncState.container?.value?.orderedSpaceIDs),
    spaces: normalizeRecords(syncState.spaceModels),
    items: normalizeRecords(syncState.items),
  };
}

function sidebarSource(data) {
  const containers = arrayValue(data.sidebar?.containers);
  const spaces = [];
  const items = [];
  for (const container of containers) {
    spaces.push(...normalizeRecords(container?.spaces));
    items.push(...normalizeRecords(container?.items));
  }
  return {
    name: 'sidebar',
    orderedSpaceIds: spaces.map((space) => space.id).filter(Boolean),
    spaces,
    items,
  };
}

function normalizeRecords(records) {
  return arrayValue(records)
    .map(normalizeRecord)
    .filter((record) => record && typeof record === 'object');
}

function normalizeRecord(record) {
  if (!record) return null;
  if (typeof record === 'string') {
    const trimmed = record.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      return normalizeRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (record.value && typeof record.value === 'object') return record.value;
  return record;
}

function orderedSpaces(source) {
  const spacesById = new Map(source.spaces.map((space) => [space.id, space]).filter(([id]) => id));
  const ordered = [];
  const used = new Set();
  for (const id of source.orderedSpaceIds) {
    const space = spacesById.get(id);
    if (!space || used.has(id)) continue;
    ordered.push(space);
    used.add(id);
  }
  for (const space of source.spaces) {
    if (!space.id || used.has(space.id)) continue;
    ordered.push(space);
    used.add(space.id);
  }
  return ordered.map((space, index) => [index, space]);
}

function buildSnapshotGroupsForSpace(space, itemsById, summary) {
  const groupMap = new Map();
  const ungroupedTabs = [];
  const rootIds = containerIdsForSpace(space, itemsById);
  const visited = new Set();

  for (const rootId of rootIds) {
    const root = itemsById.get(rootId);
    if (!root) continue;
    visitItem(root, {
      folderPath: [],
      groupMap,
      ungroupedTabs,
      itemsById,
      summary,
      visited,
    });
  }

  const groups = [...groupMap.values()].map((group, index) => ({
    title: group.title,
    color: GROUP_COLORS[index % GROUP_COLORS.length],
    collapsed: false,
    tabs: group.tabs,
  }));
  if (ungroupedTabs.length) {
    groups.push({
      title: UNGROUPED_TITLE,
      color: 'grey',
      collapsed: false,
      tabs: ungroupedTabs,
    });
  }
  return groups;
}

function visitItem(item, context) {
  if (!item?.id || context.visited.has(item.id)) return 0;
  context.visited.add(item.id);

  const data = item.data || {};
  if (data.itemContainer) {
    return visitChildren(item.childrenIds, context);
  }

  if (data.list !== undefined) {
    context.summary.folders += 1;
    const folderName = cleanText(item.title) || 'Folder';
    const beforeTabs = context.summary.tabs;
    const childTabs = visitChildren(item.childrenIds, {
      ...context,
      folderPath: [...context.folderPath, folderName],
    });
    if (childTabs === 0 && context.summary.tabs === beforeTabs) {
      context.summary.skipped.emptyFolders += 1;
    }
    return childTabs;
  }

  if (data.tab) {
    const tab = tabFromArcItem(item);
    if (!tab) {
      context.summary.skipped.invalidTabs += 1;
      return 0;
    }
    if (context.folderPath.length) {
      const title = context.folderPath.join(' / ');
      if (!context.groupMap.has(title)) context.groupMap.set(title, { title, tabs: [] });
      context.groupMap.get(title).tabs.push(tab);
    } else {
      context.ungroupedTabs.push(tab);
    }
    context.summary.tabs += 1;
    return 1;
  }

  if (data.easel) {
    context.summary.skipped.easel += 1;
    return 0;
  }

  if (data.splitView) {
    context.summary.skipped.splitView += 1;
    return 0;
  }

  context.summary.skipped.unsupportedItems += 1;
  return 0;
}

function visitChildren(childIds, context) {
  return arrayValue(childIds).reduce((sum, childId) => {
    const child = context.itemsById.get(childId);
    if (!child) return sum;
    return sum + visitItem(child, context);
  }, 0);
}

function tabFromArcItem(item) {
  const tab = item.data?.tab || {};
  const url = cleanText(tab.savedURL);
  if (!isImportableUrl(url)) return null;
  return {
    title: cleanText(item.title) || cleanText(tab.savedTitle) || url,
    url,
  };
}

function isImportableUrl(url) {
  return /^(https?:|file:)/.test(url) || url === 'chrome://newtab';
}

function containerIdsForSpace(space, itemsById) {
  const ids = [
    ...containerIdsFromList(space.newContainerIDs),
    ...containerIdsFromList(space.containerIDs),
  ];
  for (const item of itemsById.values()) {
    if (item.data?.itemContainer?.containerType?.spaceItems?._0 === space.id) ids.push(item.id);
  }
  return [...new Set(ids.filter(Boolean))];
}

function containerIdsFromList(list) {
  return arrayValue(list)
    .filter((value) => typeof value === 'string')
    .filter((value) => value !== 'pinned' && value !== 'unpinned');
}

function iconForSpace(space, fallbackName) {
  const iconType = space.customInfo?.iconType || {};
  return cleanText(iconType.emoji_v2) || cleanText(fallbackName).slice(0, 1).toUpperCase() || 'S';
}

function uniqueImportedName(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  let candidate = `${name} (Arc)`;
  let index = 2;
  while (usedNames.has(candidate)) candidate = `${name} (Arc ${index++})`;
  usedNames.add(candidate);
  return candidate;
}

function uniqueId(raw, usedIds) {
  const base = cleanText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'arc-space';
  let candidate = base;
  let index = 2;
  while (usedIds.has(candidate)) candidate = `${base}-${index++}`;
  usedIds.add(candidate);
  return candidate;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}
