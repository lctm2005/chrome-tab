import { ASK_SESSION_LIMITS } from './ask-session.js';
import {
  isUngroupedSnapshotGroup,
  sanitizeSpaceSnapshot,
} from './space-snapshot.js';

export const SPACE_BACKUP_FORMAT = 'space-context-workspaces';
export const SPACE_BACKUP_VERSION = 1;
export const WORKSPACE_STORAGE_BUDGET_BYTES = 8 * 1024 * 1024;

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
    askSessions: normalizeSpaceAskSessions(state.askSessions, validSpaceIds),
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
  state.askSessions = backup.askSessions;
  state.activeAskSessionKey = backup.askSessions[`space:${backup.activeSpaceId}`]
    ? `space:${backup.activeSpaceId}`
    : '';
  state.collapsedSpaceGroups = backup.collapsedSpaceGroups;

  state.groupSpaces = {};
  state.tabSpaces = {};
  state.virtualGroups = {};
  state.tabGroups = {};
  state.ephemeralTabIds = [];
  state.renamedTabs = {};
  state.groupOrder = {};
  state.tabOrder = {};
  state.collapsedGroups = {};

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
 * user-authored Space, Tag, saved-page, context, or Ask content.
 */
export function fingerprintPortableWorkspaceContent(state = {}) {
  const backup = createSpaceBackup(state, 0);
  return fingerprintPortableContent('workspace', {
    spaces: backup.spaces,
    spaceContexts: backup.spaceContexts,
    spaceSnapshots: backup.spaceSnapshots,
    askSessions: portableAskSessionsContent(backup.askSessions),
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
  const askKey = `space:${id}`;
  return fingerprintPortableContent('space', {
    space,
    context: backup.spaceContexts[id] || '',
    snapshot: backup.spaceSnapshots[id] || null,
    askSession: portableAskSessionContent(backup.askSessions[askKey]),
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
    const clean = sanitizeSpaceSnapshot(snapshot);
    const portable = clean ? portableSnapshot(clean) : null;
    if ((portable?.groups || []).length > 0) normalized[spaceId] = portable;
  }
  return normalized;
}

function portableSnapshot(snapshot) {
  const preserveGroups = Boolean(snapshot.preserveGroups);
  const groups = (snapshot.groups || []).map((group) => ({
    title: String(group.title || 'Ungrouped'),
    color: String(group.color || 'grey'),
    collapsed: Boolean(group.collapsed),
    ...(group.restorable ? { restorable: true } : {}),
    tabs: (group.tabs || [])
      .filter((tab) => isPortableTabUrl(tab.url))
      .map((tab) => ({
        title: String(tab.title || tab.url || 'Untitled'),
        url: String(tab.url || ''),
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

function normalizeSpaceAskSessions(sessions, validSpaceIds) {
  const normalized = {};
  for (const spaceId of validSpaceIds) {
    const key = `space:${spaceId}`;
    const session = sessions?.[key];
    if (!session) continue;
    normalized[key] = {
      key,
      spaceId,
      title: String(session.title || 'Space'),
      url: '',
      createdAt: finiteTimestamp(session.createdAt),
      updatedAt: finiteTimestamp(session.updatedAt),
      messages: (Array.isArray(session.messages) ? session.messages : [])
        .slice(-ASK_SESSION_LIMITS.maxMessagesPerSession)
        .map((message, index) => ({
          id: String(message?.id || `${finiteTimestamp(message?.createdAt)}-${index}`),
          role: message?.role === 'user' ? 'user' : 'assistant',
          text: String(message?.text || '').slice(0, ASK_SESSION_LIMITS.maxMessageChars),
          createdAt: finiteTimestamp(message?.createdAt),
          ...(message?.updatedAt ? { updatedAt: finiteTimestamp(message.updatedAt) } : {}),
        }))
        .filter((message) => message.text),
    };
  }
  return normalized;
}

function normalizeSpaceFlags(flags, validSpaceIds) {
  return Object.fromEntries(Object.entries(flags || {})
    .filter(([spaceId]) => validSpaceIds.has(spaceId))
    .map(([spaceId, value]) => [spaceId, Boolean(value)]));
}

function countSnapshotTabs(snapshots) {
  return Object.values(snapshots || {}).reduce((total, snapshot) => (
    total + (snapshot?.groups || []).reduce((sum, group) => sum + (group.tabs || []).length, 0)
  ), 0);
}

function finiteTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
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
    return ['http:', 'https:', 'file:', 'chrome:'].includes(new URL(String(value || '')).protocol);
  } catch {
    return false;
  }
}

function fingerprintPortableContent(scope, value) {
  const canonical = stablePortableValue(value);
  const serialized = JSON.stringify(canonical);
  return `portable-${scope}-v${PORTABLE_CONTENT_FINGERPRINT_VERSION}-${fnv1a(serialized)}`;
}

function portableAskSessionsContent(sessions = {}) {
  return Object.fromEntries(Object.entries(sessions)
    .map(([key, session]) => [key, portableAskSessionContent(session)])
    .filter(([, session]) => session));
}

function portableAskSessionContent(session) {
  if (!session) return null;
  const messages = (session.messages || []).map((message) => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    text: String(message.text || ''),
  }));
  if (messages.length === 0) return null;
  return {
    key: String(session.key || ''),
    spaceId: String(session.spaceId || ''),
    title: String(session.title || ''),
    messages,
  };
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
