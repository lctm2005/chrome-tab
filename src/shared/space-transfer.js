import {
  isUngroupedSnapshotGroup,
  sanitizeSpaceSnapshot,
  snapshotGroupShouldPersist,
  snapshotHasPersistentContent,
} from './space-snapshot.js';

export const SPACE_BACKUP_FORMAT = 'space-context-workspaces';
export const SPACE_BACKUP_VERSION = 1;
export const WORKSPACE_STORAGE_BUDGET_BYTES = 8 * 1024 * 1024;

export function captureSnapshotIdentityOverlay(snapshots = {}) {
  const overlay = {};
  for (const [spaceId, source] of Object.entries(snapshots || {})) {
    const snapshot = sanitizeSpaceSnapshot(source, { preserveDuplicateUrls: true });
    if (!snapshot) continue;
    const groups = snapshot.groups.map((group) => [
      overlayIdentity(group.snapshotGroupId),
      group.tabs.map((tab) => overlayIdentity(tab.snapshotTabId)),
    ]);
    if (groups.some(([groupId, tabIds]) => groupId || tabIds.some(Boolean))) {
      overlay[spaceId] = groups;
    }
  }
  return overlay;
}

export function restoreSnapshotIdentityOverlay(snapshots = {}, overlay = {}) {
  const restored = { ...(snapshots || {}) };
  for (const [spaceId, source] of Object.entries(snapshots || {})) {
    const snapshot = sanitizeSpaceSnapshot(source, { preserveDuplicateUrls: true });
    const records = Array.isArray(overlay?.[spaceId]) ? overlay[spaceId] : null;
    if (!snapshot || !records) continue;
    const usedGroupIds = new Set();
    const usedTabIds = new Set();
    let hasIdentity = false;
    const groups = snapshot.groups.map((group, groupIndex) => {
      const record = Array.isArray(records[groupIndex]) ? records[groupIndex] : [];
      const snapshotGroupId = uniqueOverlayIdentity(record[0], usedGroupIds);
      const tabRecords = Array.isArray(record[1]) ? record[1] : [];
      const tabs = group.tabs.map((tab, tabIndex) => {
        const snapshotTabId = uniqueOverlayIdentity(tabRecords[tabIndex], usedTabIds);
        if (snapshotTabId) hasIdentity = true;
        return snapshotTabId ? { ...tab, snapshotTabId } : tab;
      });
      if (snapshotGroupId) hasIdentity = true;
      return {
        ...group,
        ...(snapshotGroupId ? { snapshotGroupId } : {}),
        tabs,
      };
    });
    restored[spaceId] = {
      ...snapshot,
      ...(hasIdentity ? { identityVersion: 1 } : {}),
      groups,
    };
  }
  return restored;
}

function overlayIdentity(value) {
  const id = String(value || '').trim();
  return id.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) ? id : '';
}

function uniqueOverlayIdentity(value, used) {
  const id = overlayIdentity(value);
  if (!id || used.has(id)) return '';
  used.add(id);
  return id;
}

export function transferSnapshotGroupsBetweenSpaces({
  sourceSnapshot = null,
  targetSnapshot = null,
  snapshotGroupIds = [],
  snapshotTabIds = [],
  now = Date.now(),
} = {}) {
  const source = sanitizeSpaceSnapshot(sourceSnapshot, { preserveDuplicateUrls: true });
  const target = sanitizeSpaceSnapshot(targetSnapshot, { preserveDuplicateUrls: true });
  const selectedGroupIds = new Set(identityList(snapshotGroupIds).map(cleanIdentity).filter(Boolean));
  const selectedTabIds = new Set(identityList(snapshotTabIds).map(cleanIdentity).filter(Boolean));
  if (!source || (selectedGroupIds.size === 0 && selectedTabIds.size === 0)) {
    return { sourceSnapshot: source, targetSnapshot: target, movedGroups: [] };
  }

  const movingGroups = [];
  const remainingGroups = [];
  for (const group of source.groups) {
    const groupId = cleanIdentity(group.snapshotGroupId);
    const selectedByGroup = Boolean(groupId && selectedGroupIds.has(groupId));
    const selectedByTab = group.tabs.some((tab) => (
      selectedTabIds.has(cleanIdentity(tab.snapshotTabId))
    ));
    (selectedByGroup || selectedByTab ? movingGroups : remainingGroups).push(group);
  }
  if (movingGroups.length === 0) {
    return { sourceSnapshot: source, targetSnapshot: target, movedGroups: [] };
  }

  const movedTabIds = new Set(movingGroups.flatMap((group) => (
    group.tabs.map((tab) => cleanIdentity(tab.snapshotTabId)).filter(Boolean)
  )));
  const movedGroupIds = new Set(movingGroups
    .map((group) => cleanIdentity(group.snapshotGroupId))
    .filter(Boolean));
  const targetGroupsByMovedId = new Map();
  const retainedTargetGroups = [];

  for (const group of target?.groups || []) {
    const groupId = cleanIdentity(group.snapshotGroupId);
    const tabs = group.tabs.filter((tab) => (
      !movedTabIds.has(cleanIdentity(tab.snapshotTabId))
    ));
    if (groupId && movedGroupIds.has(groupId)) {
      if (!targetGroupsByMovedId.has(groupId)) targetGroupsByMovedId.set(groupId, []);
      targetGroupsByMovedId.get(groupId).push(...tabs);
      continue;
    }
    const nextGroup = { ...group, tabs };
    if (snapshotGroupShouldPersist(target, nextGroup)) retainedTargetGroups.push(nextGroup);
  }

  const transferredGroups = movingGroups.map((group) => {
    const groupId = cleanIdentity(group.snapshotGroupId);
    const targetOnlyTabs = groupId ? targetGroupsByMovedId.get(groupId) || [] : [];
    return {
      ...group,
      tabs: [...group.tabs, ...targetOnlyTabs],
    };
  });
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const sourceNext = {
    ...source,
    updatedAt: timestamp,
    groups: remainingGroups,
  };
  const targetNext = {
    ...(target || {}),
    version: target?.version || source.version || 1,
    updatedAt: timestamp,
    ...(target?.identityVersion || source.identityVersion
      ? { identityVersion: target?.identityVersion || source.identityVersion }
      : {}),
    ...(target?.preserveGroups || source.preserveGroups ? { preserveGroups: true } : {}),
    groups: [...retainedTargetGroups, ...transferredGroups],
  };

  return {
    sourceSnapshot: snapshotHasPersistentContent(sourceNext) ? sourceNext : null,
    targetSnapshot: targetNext,
    movedGroups: transferredGroups,
  };
}

/**
 * Snapshot group keys contain their array index. Moving one saved group can
 * therefore change every later key even though those Tags did not move. Keep
 * explicit user ordering attached to durable group identity and discard stale
 * snapshot keys, while leaving live Chrome/virtual group keys untouched.
 */
export function remapSnapshotGroupOrderKeys({
  order = [],
  beforeSnapshot = null,
  afterSnapshot = null,
  spaceId = '',
} = {}) {
  const before = sanitizeSpaceSnapshot(beforeSnapshot, { preserveDuplicateUrls: true });
  const after = sanitizeSpaceSnapshot(afterSnapshot, { preserveDuplicateUrls: true });
  const beforeIdentityByKey = new Map((before?.groups || []).flatMap((group, index) => {
    const snapshotGroupId = cleanIdentity(group.snapshotGroupId);
    return snapshotGroupId
      ? [[indexedSnapshotGroupKey(index, group, spaceId), snapshotGroupId]]
      : [];
  }));
  const nextKeyByIdentity = new Map((after?.groups || []).flatMap((group, index) => {
    const snapshotGroupId = cleanIdentity(group.snapshotGroupId);
    return snapshotGroupId
      ? [[snapshotGroupId, indexedSnapshotGroupKey(index, group, spaceId)]]
      : [];
  }));
  const remapped = [];
  const seen = new Set();
  for (const rawKey of identityList(order)) {
    const key = String(rawKey);
    const snapshotGroupId = beforeIdentityByKey.get(key);
    const nextKey = snapshotGroupId
      ? nextKeyByIdentity.get(snapshotGroupId)
      : key.startsWith('snapshot:')
      ? ''
      : key;
    if (!nextKey || seen.has(nextKey)) continue;
    seen.add(nextKey);
    remapped.push(nextKey);
  }
  return remapped;
}

function indexedSnapshotGroupKey(index, group, spaceId) {
  return `snapshot:${index}:${encodeURIComponent(String(spaceId))}:${group.snapshotGroupId}`;
}

export function serializedJsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertWorkspaceStorageBudget(value, maxBytes = WORKSPACE_STORAGE_BUDGET_BYTES) {
  const bytes = serializedJsonBytes(value);
  if (bytes <= maxBytes) return bytes;
  const usedMB = (bytes / (1024 * 1024)).toFixed(1);
  const maxMB = (maxBytes / (1024 * 1024)).toFixed(0);
  throw new Error(
    `This workspace would use ${usedMB} MB in Chrome storage, above the safe ${maxMB} MB budget. ` +
    'Reduce imported Spaces or saved tabs and try again. Nothing was changed.',
  );
}
const PORTABLE_CONTENT_FINGERPRINT_VERSION = 1;

export function createSpaceBackup(state = {}, now = Date.now()) {
  const spaces = normalizeSpaces(state.spaces);
  if (spaces.length === 0) throw new Error('A Space backup needs at least one valid Space.');

  const validSpaceIds = new Set(spaces.map((space) => space.id));
  const activeSpaceId = validSpaceIds.has(String(state.activeSpaceId))
    ? String(state.activeSpaceId)
    : spaces[0].id;

  return {
    format: SPACE_BACKUP_FORMAT,
    version: SPACE_BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    activeSpaceId,
    spaces,
    spaceContexts: normalizeSpaceContexts(state.spaceContexts, validSpaceIds),
    spaceSnapshots: normalizeSpaceSnapshots(state.spaceSnapshots, validSpaceIds),
    collapsedSpaceGroups: normalizeSpaceFlags(state.collapsedSpaceGroups, validSpaceIds),
  };
}

export function parseSpaceBackup(input) {
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error('This is not valid JSON.');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This is not a Space backup.');
  }
  if (parsed.format !== SPACE_BACKUP_FORMAT) {
    throw new Error('This file was not exported by Space.');
  }
  if (Number(parsed.version) !== SPACE_BACKUP_VERSION) {
    throw new Error(`Unsupported Space backup version: ${parsed.version || 'unknown'}.`);
  }

  const normalized = createSpaceBackup(parsed, validDate(parsed.exportedAt));
  normalized.exportedAt = new Date(validDate(parsed.exportedAt)).toISOString();
  return normalized;
}

export function restoreSpaceBackup(state, input) {
  const backup = parseSpaceBackup(input);
  state.spaces = backup.spaces;
  state.activeSpaceId = backup.activeSpaceId;
  state.spaceContexts = backup.spaceContexts;
  state.spaceSnapshots = backup.spaceSnapshots;
  state.collapsedSpaceGroups = backup.collapsedSpaceGroups;

  state.groupSpaces = {};
  state.tabSpaces = {};
  state.tabLifecycle = {};
  state.virtualGroups = {};
  state.tabGroups = {};
  state.ephemeralTabIds = [];
  state.renamedTabs = {};
  state.groupOrder = {};
  state.tabOrder = {};
  state.collapsedGroups = {};
  state.lastArcImport = null;

  return {
    spaces: backup.spaces.length,
    contexts: Object.values(backup.spaceContexts).filter(Boolean).length,
    savedTabs: countSnapshotTabs(backup.spaceSnapshots),
  };
}

/**
 * Fingerprints the user-authored data a portable restore replaces.
 *
 * Selection, collapse state, and timestamps are intentionally excluded: they
 * can change while someone merely views the restored Spaces and do not carry
 * user-authored Space, Tag, saved-page, or context content.
 */
export function fingerprintPortableWorkspaceContent(state = {}) {
  const backup = createSpaceBackup(state, 0);
  return fingerprintPortableContent('workspace', {
    spaces: backup.spaces,
    spaceContexts: backup.spaceContexts,
    spaceSnapshots: backup.spaceSnapshots,
  });
}

/**
 * Fingerprints one Space's portable content without depending on which Space
 * is active or on unrelated Spaces. Arc import Undo uses one fingerprint per
 * imported Space so it cannot delete a Space that has since been edited.
 */
export function fingerprintPortableSpaceContent(state = {}, spaceId) {
  const backup = createSpaceBackup(state, 0);
  return fingerprintPortableSpaceFromBackup(backup, spaceId);
}

export function fingerprintPortableSpacesContent(state = {}, spaceIds = []) {
  const backup = createSpaceBackup(state, 0);
  const ids = [...new Set((spaceIds || []).map(String).filter(Boolean))];
  return Object.fromEntries(ids.map((spaceId) => [
    spaceId,
    fingerprintPortableSpaceFromBackup(backup, spaceId),
  ]));
}

function fingerprintPortableSpaceFromBackup(backup, spaceId) {
  const id = String(spaceId || '');
  const space = backup.spaces.find((candidate) => candidate.id === id) || null;
  return fingerprintPortableContent('space', {
    space,
    context: backup.spaceContexts[id] || '',
    snapshot: backup.spaceSnapshots[id] || null,
  });
}

function normalizeSpaces(spaces) {
  const normalized = [];
  const seen = new Set();
  for (const space of Array.isArray(spaces) ? spaces : []) {
    const id = String(space?.id || '').trim().slice(0, 128);
    const name = String(space?.name || '').trim().slice(0, 200);
    if (!id || !name || !isSafeRecordKey(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      id,
      name,
      icon: String(space.icon || name.slice(0, 1).toUpperCase()),
      color: String(space.color || 'blue'),
    });
  }
  return normalized;
}

function normalizeSpaceContexts(contexts, validSpaceIds) {
  const normalized = {};
  for (const [spaceId, context] of Object.entries(contexts || {})) {
    if (!validSpaceIds.has(spaceId)) continue;
    normalized[spaceId] = String(context || '');
  }
  return normalized;
}

function normalizeSpaceSnapshots(snapshots, validSpaceIds) {
  const normalized = {};
  for (const [spaceId, snapshot] of Object.entries(snapshots || {})) {
    if (!validSpaceIds.has(spaceId)) continue;
    const clean = sanitizeSpaceSnapshot(snapshot, { preserveDuplicateUrls: true });
    const portable = clean ? portableSnapshot(clean) : null;
    if ((portable?.groups || []).length > 0) normalized[spaceId] = portable;
  }
  return normalized;
}

function portableSnapshot(snapshot) {
  const preserveGroups = Boolean(snapshot.preserveGroups);
  const groups = snapshot.groups.map((group) => ({
    title: String(group.title),
    color: String(group.color),
    collapsed: Boolean(group.collapsed),
    ...(group.restorable ? { restorable: true } : {}),
    tabs: group.tabs
      .filter((tab) => isPortableTabUrl(tab.url))
      .map((tab) => ({
        title: String(tab.title),
        url: String(tab.url),
        ...(tab.panelTitle ? { panelTitle: String(tab.panelTitle) } : {}),
      })),
  })).filter((group) => (
    group.tabs.length > 0 || (preserveGroups && !isUngroupedSnapshotGroup(group))
  ));

  return {
    version: Number(snapshot.version || 1),
    updatedAt: finiteTimestamp(snapshot.updatedAt),
    ...(preserveGroups ? { preserveGroups: true } : {}),
    groups,
  };
}

function fingerprintPortableContent(scope, value) {
  const canonical = stablePortableValue(value);
  const serialized = JSON.stringify(canonical);
  return `portable-${scope}-v${PORTABLE_CONTENT_FINGERPRINT_VERSION}-${fnv1a(serialized)}`;
}

function stablePortableValue(value) {
  if (Array.isArray(value)) return value.map(stablePortableValue);
  if (!value || typeof value !== 'object') return value;

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (['createdAt', 'updatedAt', 'exportedAt', 'collapsed'].includes(key)) continue;
    normalized[key] = stablePortableValue(value[key]);
  }
  return normalized;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeSpaceFlags(flags, validSpaceIds) {
  return Object.fromEntries(Object.entries(flags || {})
    .filter(([spaceId]) => validSpaceIds.has(spaceId))
    .map(([spaceId, value]) => [spaceId, Boolean(value)]));
}

function countSnapshotTabs(snapshots) {
  return Object.values(snapshots).reduce((total, snapshot) => (
    total + snapshot.groups.reduce((sum, group) => sum + group.tabs.length, 0)
  ), 0);
}

function finiteTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function cleanIdentity(value) {
  return String(value || '').trim();
}

function identityList(value) {
  return Array.isArray(value) ? value : [];
}

function validDate(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function isSafeRecordKey(value) {
  return !['__proto__', 'prototype', 'constructor'].includes(String(value));
}

function isPortableTabUrl(value) {
  try {
    return ['http:', 'https:', 'file:', 'chrome:'].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}
