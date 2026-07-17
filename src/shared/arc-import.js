const SPACE_COLORS = ['blue', 'green', 'purple', 'yellow', 'pink', 'cyan', 'orange'];
const GROUP_COLORS = ['blue', 'green', 'purple', 'yellow', 'pink', 'cyan', 'orange'];
const UNGROUPED_TITLE = 'Ungrouped';

export function createArcImportPlan(input, options = {}) {
  const data = parseArcInput(input);
  const source = pickArcSource(data);
  const existingSpaces = Array.isArray(options.existingSpaces) ? options.existingSpaces : [];
  const now = Number(options.now ?? Date.now());
  const existingIds = new Set(existingSpaces.map((space) => String(space?.id || '')).filter(Boolean));
  const existingNames = new Set(existingSpaces
    .map((space) => String(space?.name || space?.title || ''))
    .filter(Boolean));
  const importedIds = new Set();
  const importedNames = new Set();
  const itemsById = new Map(source.items.map((item) => [item.id, item]).filter(([id]) => id));

  const summary = emptyImportSummary(source.name);
  const spaces = [];
  const spaceSnapshots = {};
  const spacePreviews = [];
  const conflicts = [];

  for (const [index, arcSpace] of orderedSpaces(source)) {
    const sourceSpaceId = cleanText(arcSpace.id);
    const originalName = cleanText(arcSpace.title) || 'Arc Space';
    const idResolution = resolveUniqueId(
      `arc-${sourceSpaceId || originalName}`,
      existingIds,
      importedIds,
    );
    const nameResolution = resolveUniqueImportedName(originalName, existingNames, importedNames);
    const importedSpace = {
      id: idResolution.resolved,
      name: nameResolution.resolved,
      icon: iconForSpace(arcSpace, originalName),
      color: SPACE_COLORS[index % SPACE_COLORS.length],
    };
    const counts = emptyImportCounts();
    const snapshotGroups = buildSnapshotGroupsForSpace(arcSpace, itemsById, counts);
    const spaceConflicts = [
      conflictForResolution('id', idResolution, importedSpace.id, sourceSpaceId),
      conflictForResolution('name', nameResolution, importedSpace.id, sourceSpaceId),
    ].filter(Boolean);

    spaces.push(importedSpace);
    spaceSnapshots[importedSpace.id] = {
      version: 1,
      updatedAt: now,
      groups: snapshotGroups,
    };
    spacePreviews.push({
      spaceId: importedSpace.id,
      sourceSpaceId,
      originalId: idResolution.original,
      resolvedId: idResolution.resolved,
      originalName,
      resolvedName: importedSpace.name,
      folders: counts.folders,
      tabs: counts.tabs,
      skipped: { ...counts.skipped },
      conflicts: spaceConflicts,
    });
    conflicts.push(...spaceConflicts);
    summary.spaces += 1;
    addImportCounts(summary, counts);
  }

  return { spaces, spaceSnapshots, summary, spacePreviews, conflicts };
}

export function appendArcImportPlan(state, plan) {
  const spaces = Array.isArray(plan?.spaces) ? plan.spaces : [];
  const snapshots = plan?.spaceSnapshots && typeof plan.spaceSnapshots === 'object'
    ? plan.spaceSnapshots
    : {};
  assertAppendIdsAvailable(state, spaces);
  if (!Array.isArray(state.spaces)) state.spaces = [];
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') state.spaceSnapshots = {};

  const importedSnapshots = {};
  for (const space of spaces) {
    const id = cleanText(space.id);
    if (Object.hasOwn(snapshots, id)) importedSnapshots[id] = snapshots[id];
  }
  state.spaces.push(...spaces);
  Object.assign(state.spaceSnapshots, importedSnapshots);

  return {
    importedSpaces: spaces.length,
    importedSpaceIds: spaces.map((space) => space.id),
    importedTabs: Object.values(importedSnapshots).reduce((sum, snapshot) => (
      sum + arrayValue(snapshot?.groups).reduce((groupSum, group) => groupSum + arrayValue(group?.tabs).length, 0)
    ), 0),
  };
}

function assertAppendIdsAvailable(state, spaces) {
  const occupiedIds = new Set(arrayValue(state?.spaces)
    .map((space) => cleanText(space?.id))
    .filter(Boolean));
  for (const id of Object.keys(state?.spaceSnapshots || {})) occupiedIds.add(id);

  const incomingIds = new Set();
  for (const space of spaces) {
    const id = cleanText(space?.id);
    if (!id || ['__proto__', 'prototype', 'constructor'].includes(id)) {
      throw new Error('Arc import contains a Space without a valid id. Preview the file again.');
    }
    if (occupiedIds.has(id) || incomingIds.has(id)) {
      throw new Error(`Arc import Space id "${id}" is no longer available. Preview the file again.`);
    }
    incomingIds.add(id);
  }
}

export function selectArcImportPlan(plan, selectedIds) {
  const selected = selectedIdSet(selectedIds);
  const spaces = arrayValue(plan?.spaces).filter((space) => selected.has(String(space?.id || '')));
  const selectedSpaceIds = new Set(spaces.map((space) => String(space.id)));
  const spaceSnapshots = Object.fromEntries(spaces
    .filter((space) => plan?.spaceSnapshots?.[space.id])
    .map((space) => [space.id, plan.spaceSnapshots[space.id]]));
  const spacePreviews = selectedSpacePreviews(plan, spaces);
  const conflicts = spacePreviews.length > 0
    ? spacePreviews.flatMap((preview) => preview.conflicts.map((conflict) => ({ ...conflict })))
    : arrayValue(plan?.conflicts)
      .filter((conflict) => selectedSpaceIds.has(String(conflict?.spaceId || '')))
      .map((conflict) => ({ ...conflict }));
  const summary = selectedImportSummary(plan, spaces, spacePreviews);

  return { spaces, spaceSnapshots, summary, spacePreviews, conflicts };
}

function emptyImportSummary(source = 'unknown') {
  return {
    source,
    spaces: 0,
    folders: 0,
    tabs: 0,
    skipped: emptySkippedCounts(),
  };
}

function emptyImportCounts() {
  return {
    folders: 0,
    tabs: 0,
    skipped: emptySkippedCounts(),
  };
}

function emptySkippedCounts() {
  return {
    emptyFolders: 0,
    invalidTabs: 0,
    unsupportedItems: 0,
    easel: 0,
    splitView: 0,
  };
}

function addImportCounts(target, counts) {
  target.folders += Number(counts?.folders) || 0;
  target.tabs += Number(counts?.tabs) || 0;
  for (const key of Object.keys(target.skipped)) {
    target.skipped[key] += Number(counts?.skipped?.[key]) || 0;
  }
}

function selectedImportSummary(plan, spaces, previews) {
  const summary = emptyImportSummary(String(plan?.summary?.source || 'unknown'));
  summary.spaces = spaces.length;

  if (previews.length === spaces.length) {
    for (const preview of previews) addImportCounts(summary, preview);
    return summary;
  }

  summary.folders = Number(plan?.summary?.folders) || 0;
  summary.tabs = Number(plan?.summary?.tabs) || 0;
  summary.skipped = {
    ...summary.skipped,
    ...(plan?.summary?.skipped || {}),
  };
  return summary;
}

function selectedSpacePreviews(plan, spaces) {
  if (spaces.length === 0) return [];
  const previews = arrayValue(plan?.spacePreviews);
  if (previews.length === 0) {
    if (spaces.length === arrayValue(plan?.spaces).length) return [];
    throw new Error('This Arc import plan cannot recalculate a partial selection. Preview the file again.');
  }

  const previewsBySpaceId = new Map();
  for (const preview of previews) {
    const spaceId = String(preview?.spaceId || '');
    if (!spaceId) continue;
    const records = previewsBySpaceId.get(spaceId) || [];
    records.push(preview);
    previewsBySpaceId.set(spaceId, records);
  }

  return spaces.map((space) => {
    const records = previewsBySpaceId.get(String(space.id)) || [];
    if (records.length !== 1) {
      throw new Error(`Arc import preview metadata is incomplete for Space "${space.name || space.id}".`);
    }
    return cloneSpacePreview(records[0]);
  });
}

function selectedIdSet(selectedIds) {
  if (selectedIds instanceof Set || Array.isArray(selectedIds)) {
    return new Set([...selectedIds].map(String).filter(Boolean));
  }
  return new Set();
}

function cloneSpacePreview(preview) {
  return {
    ...preview,
    skipped: {
      ...emptySkippedCounts(),
      ...(preview?.skipped || {}),
    },
    conflicts: arrayValue(preview?.conflicts).map((conflict) => ({ ...conflict })),
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

  let selected = null;
  let selectedCompleteness = [];
  for (const source of candidates) {
    const completeness = arcSourceCompleteness(source);
    if (completeness[0] === 0) continue;
    if (!selected || compareCompleteness(completeness, selectedCompleteness) > 0) {
      selected = source;
      selectedCompleteness = completeness;
    }
  }

  return selected || {
    name: 'unknown',
    orderedSpaceIds: [],
    spaces: [],
    items: [],
  };
}

function arcSourceCompleteness(source) {
  const spaces = orderedSpaces(source).map(([, space]) => space);
  const itemsById = new Map(source.items.map((item) => [item.id, item]).filter(([id]) => id));
  let linkedSpaces = 0;
  let spacesWithTabs = 0;
  let tabs = 0;
  let folders = 0;
  let titledSpaces = 0;

  for (const space of spaces) {
    if (cleanText(space.title)) titledSpaces += 1;
    if (containerIdsForSpace(space, itemsById).some((id) => itemsById.has(id))) {
      linkedSpaces += 1;
    }

    const counts = emptyImportCounts();
    buildSnapshotGroupsForSpace(space, itemsById, counts);
    if (counts.tabs > 0) spacesWithTabs += 1;
    tabs += counts.tabs;
    folders += counts.folders;
  }

  // Preserve the most Spaces first, then prefer the source whose Space records
  // are backed by the most complete, actually importable item trees.
  return [spaces.length, linkedSpaces, spacesWithTabs, tabs, folders, titledSpaces];
}

function compareCompleteness(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
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
      restorable: true,
      tabs: ungroupedTabs,
    });
  }
  return groups;
}

function visitItem(item, context) {
  if (context.visited.has(item.id)) return 0;
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
  const tab = item.data.tab;
  const url = cleanText(tab.savedURL);
  if (!isImportableUrl(url)) return null;
  return {
    title: cleanText(item.title) || cleanText(tab.savedTitle) || url,
    url,
  };
}

function isImportableUrl(url) {
  return /^(https?:|file:)/.test(url);
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
  return cleanText(iconType.emoji_v2) || cleanText(fallbackName).slice(0, 1).toUpperCase();
}

function resolveUniqueImportedName(name, existingNames, importedNames) {
  let candidate = `${name} (Arc)`;
  let index = 2;
  const collisionReasons = new Set();
  if (!recordCollisionReasons(name, existingNames, importedNames, collisionReasons)) {
    importedNames.add(name);
    return { original: name, resolved: name, collisionReasons: [] };
  }
  while (recordCollisionReasons(candidate, existingNames, importedNames, collisionReasons)) {
    candidate = `${name} (Arc ${index++})`;
  }
  importedNames.add(candidate);
  return { original: name, resolved: candidate, collisionReasons: [...collisionReasons] };
}

function resolveUniqueId(raw, existingIds, importedIds) {
  const base = cleanText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let candidate = base;
  let index = 2;
  const collisionReasons = new Set();
  while (recordCollisionReasons(candidate, existingIds, importedIds, collisionReasons)) {
    candidate = `${base}-${index++}`;
  }
  importedIds.add(candidate);
  return { original: base, resolved: candidate, collisionReasons: [...collisionReasons] };
}

function recordCollisionReasons(candidate, existingValues, importedValues, reasons) {
  const existingCollision = existingValues.has(candidate);
  const batchCollision = importedValues.has(candidate);
  if (existingCollision) reasons.add('existing-space');
  if (batchCollision) reasons.add('import-batch');
  return existingCollision || batchCollision;
}

function conflictForResolution(field, resolution, spaceId, sourceSpaceId) {
  if (resolution.original === resolution.resolved) return null;
  const collisionReasons = arrayValue(resolution.collisionReasons);
  return {
    spaceId,
    sourceSpaceId,
    field,
    original: resolution.original,
    resolved: resolution.resolved,
    reason: collisionReasons.length > 1 ? 'mixed' : collisionReasons[0],
  };
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}
