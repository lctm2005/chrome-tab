import { normalizeAIProviderSettings } from './ai-providers.js';
import { normalizeArcImportToken } from './action-safety.js';
import { mergeShortcuts, normalizeShortcut } from './shortcuts.js';

export const STORAGE_KEY = 'spaceTabsState';
export const SECRET_STORAGE_KEY = 'spaceTabsSecrets';
export const WINDOW_STATE_KEY = 'spaceTabsWindowState';
export const BROWSER_SESSION_STORAGE_KEY = 'spaceTabsBrowserSession';
export const SHARED_STATE_LOCK_NAME = 'space-tabs-shared-state';
const LEGACY_TOGGLE_PANEL_SHORTCUT = 'Meta+S';
const LEGACY_DEFAULT_ASK_SUBMIT_SHORTCUT = 'Meta+Enter';
const LEGACY_DEFAULT_ASK_ABORT_SHORTCUT = 'Control+C';
const LEGACY_DEFAULT_AI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
const DOMESTIC_CODING_AI_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
const LEGACY_DEFAULT_AI_MODEL = 'glm-5.1';
const MAX_BROWSER_SESSION_ID_LENGTH = 200;
const LIVE_ID_OPERATION_TYPES = new Set(['tidy-names', 'auto-group', 'restore-backup']);

export function createDefaultState(localConfig = {}) {
  const ai = localConfig.ai || {};
  const aiProviderInput = {
    baseUrl: normalizeUrl(ai.baseUrl || ''),
    model: ai.model || '',
  };
  if (ai.provider) aiProviderInput.provider = ai.provider;
  const normalizedAI = normalizeAIProviderSettings(aiProviderInput);
  return {
    version: 12,
    browserSessionId: normalizeBrowserSessionId(localConfig.browserSessionId),
    theme: 'purple',
    activeSpaceId: 'default',
    spaces: [
      { id: 'default', name: 'Default', icon: 'D', color: 'blue' },
    ],
    groupSpaces: {},
    tabSpaces: {},
    virtualGroups: {},
    tabGroups: {},
    tabLifecycle: {},
    ephemeralTabIds: [],
    renamedTabs: {},
    groupOrder: {},
    tabOrder: {},
    collapsedGroups: {},
    collapsedSpaceGroups: {},
    askSessions: {},
    activeAskSessionKey: '',
    spaceContexts: {},
    spaceSnapshots: {},
    onboarding: {
      version: 2,
      completed: false,
      stage: 'choose',
    },
    lastArcImport: null,
    operationHistory: [],
    shortcuts: mergeShortcuts(),
    ai: {
      provider: normalizedAI.provider,
      baseUrl: normalizedAI.baseUrl,
      model: normalizedAI.model,
      apiKey: ai.apiKey || '',
      thinking: ai.thinking || 'disabled',
      language: ai.language || 'zh-CN',
      temperature: Number(ai.temperature ?? 0.6),
    },
  };
}

/**
 * Starts a state object in a new Chrome session without discarding portable
 * user data. Chrome tab and group ids can be reused after a browser restart,
 * so every map derived from those ids must be rebuilt from the live browser.
 */
export function resetChromeSessionBindings(state, sessionId) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  const nextSessionId = normalizeBrowserSessionId(sessionId);
  if (!nextSessionId || normalizeBrowserSessionId(state.browserSessionId) === nextSessionId) return state;

  return {
    ...state,
    browserSessionId: nextSessionId,
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    tabGroups: {},
    tabLifecycle: {},
    virtualGroups: {},
    ephemeralTabIds: [],
    groupOrder: {},
    tabOrder: {},
    collapsedGroups: {},
    operationHistory: (Array.isArray(state.operationHistory) ? state.operationHistory : [])
      .filter((operation) => !LIVE_ID_OPERATION_TYPES.has(operation?.type)),
  };
}

export function normalizeWindowSpaceState(value, spaces = []) {
  const source = value && typeof value === 'object' && value.activeSpaceIds && typeof value.activeSpaceIds === 'object'
    ? value.activeSpaceIds
    : {};
  const validSpaceIds = new Set((Array.isArray(spaces) ? spaces : [])
    .map((space) => typeof space?.id === 'string' ? space.id : '')
    .filter(Boolean));
  const activeSpaceIds = {};
  for (const [windowId, spaceId] of Object.entries(source)) {
    const key = normalizedWindowIdKey(windowId);
    if (key === '' || !validSpaceIds.has(spaceId)) continue;
    activeSpaceIds[key] = spaceId;
  }
  return { activeSpaceIds };
}

export function activeSpaceForWindow(windowState, windowId, spaces = [], fallbackSpaceId = '') {
  const normalized = normalizeWindowSpaceState(windowState, spaces);
  const key = normalizedWindowIdKey(windowId);
  if (key !== '' && normalized.activeSpaceIds[key]) return normalized.activeSpaceIds[key];
  const validSpaceIds = new Set((Array.isArray(spaces) ? spaces : [])
    .map((space) => typeof space?.id === 'string' ? space.id : '')
    .filter(Boolean));
  if (validSpaceIds.has(fallbackSpaceId)) return fallbackSpaceId;
  return validSpaceIds.values().next().value || '';
}

export function tabWindowBelongsToSpace(
  tab,
  windowState,
  spaces = [],
  spaceId = '',
  fallbackSpaceId = '',
) {
  if (normalizedWindowIdKey(tab?.windowId) === '' || !spaceId) return false;
  return activeSpaceForWindow(windowState, tab.windowId, spaces, fallbackSpaceId) === spaceId;
}

export function activeSpaceForStorage(spaces = [], durableSpaceId = '', windowSpaceId = '') {
  const validSpaceIds = new Set((Array.isArray(spaces) ? spaces : [])
    .map((space) => typeof space?.id === 'string' ? space.id : '')
    .filter(Boolean));
  if (validSpaceIds.has(durableSpaceId)) return durableSpaceId;
  if (validSpaceIds.has(windowSpaceId)) return windowSpaceId;
  return validSpaceIds.values().next().value || '';
}

export function rememberActiveSpaceForWindow(windowState, windowId, spaceId, spaces = []) {
  const normalized = normalizeWindowSpaceState(windowState, spaces);
  const key = normalizedWindowIdKey(windowId);
  const validSpaceIds = new Set((Array.isArray(spaces) ? spaces : [])
    .map((space) => typeof space?.id === 'string' ? space.id : '')
    .filter(Boolean));
  if (key !== '' && validSpaceIds.has(spaceId)) normalized.activeSpaceIds[key] = spaceId;
  return normalized;
}

/**
 * Moves every window that is still viewing a deleted Space to the same
 * user-visible fallback while preserving independent choices in other
 * windows. Invalid legacy entries are discarded at the same boundary.
 */
export function reassignDeletedSpaceWindows(
  windowState,
  deletedSpaceId,
  fallbackSpaceId,
  spaces = [],
) {
  const source = windowState && typeof windowState === 'object' &&
    windowState.activeSpaceIds && typeof windowState.activeSpaceIds === 'object' &&
    !Array.isArray(windowState.activeSpaceIds)
    ? windowState.activeSpaceIds
    : {};
  const validSpaceIds = new Set((Array.isArray(spaces) ? spaces : [])
    .map((space) => typeof space?.id === 'string' ? space.id : '')
    .filter(Boolean));
  const deletedId = String(deletedSpaceId || '');
  const fallbackId = String(fallbackSpaceId || '');
  const activeSpaceIds = {};

  for (const [windowId, currentSpaceId] of Object.entries(source)) {
    const key = normalizedWindowIdKey(windowId);
    if (key === '') continue;
    const nextSpaceId = deletedId && currentSpaceId === deletedId
      ? fallbackId
      : currentSpaceId;
    if (validSpaceIds.has(nextSpaceId)) activeSpaceIds[key] = nextSpaceId;
  }
  return { activeSpaceIds };
}

export function forgetActiveSpaceForWindow(windowState, windowId) {
  const source = windowState && typeof windowState === 'object' && !Array.isArray(windowState)
    ? windowState
    : {};
  const activeSpaceIds = source.activeSpaceIds && typeof source.activeSpaceIds === 'object' &&
    !Array.isArray(source.activeSpaceIds)
    ? { ...source.activeSpaceIds }
    : {};
  const key = normalizedWindowIdKey(windowId);
  if (key !== '') delete activeSpaceIds[key];
  return { ...source, activeSpaceIds };
}

export function mergeStoredState(stored, defaults = createDefaultState()) {
  if (!stored || typeof stored !== 'object') return defaults;
  const compatibleSpaceModel = Number(stored.version) >= 4 && Number(stored.version) <= Number(defaults.version);
  const spaces = normalizeDefaultSpace(compatibleSpaceModel
    ? validSpaces(stored.spaces, defaults.spaces)
    : migrateSpaces(stored.spaces, defaults.spaces), stored.version);
  const activeSpaceId = spaces.some((space) => space.id === stored.activeSpaceId)
    ? stored.activeSpaceId
    : spaces[0].id;

  return {
    version: defaults.version,
    browserSessionId: normalizeBrowserSessionId(stored.browserSessionId)
      || normalizeBrowserSessionId(defaults.browserSessionId),
    theme: stored.theme || defaults.theme || 'purple',
    activeSpaceId,
    spaces,
    groupSpaces: compatibleSpaceModel ? { ...defaults.groupSpaces, ...(stored.groupSpaces || {}) } : defaults.groupSpaces,
    tabSpaces: compatibleSpaceModel ? { ...defaults.tabSpaces, ...(stored.tabSpaces || {}) } : defaults.tabSpaces,
    virtualGroups: compatibleSpaceModel ? { ...defaults.virtualGroups, ...(stored.virtualGroups || {}) } : defaults.virtualGroups,
    tabGroups: compatibleSpaceModel ? { ...defaults.tabGroups, ...(stored.tabGroups || {}) } : defaults.tabGroups,
    tabLifecycle: compatibleSpaceModel && stored.tabLifecycle && typeof stored.tabLifecycle === 'object' && !Array.isArray(stored.tabLifecycle)
      ? { ...defaults.tabLifecycle, ...stored.tabLifecycle }
      : defaults.tabLifecycle,
    ephemeralTabIds: compatibleSpaceModel && Array.isArray(stored.ephemeralTabIds)
      ? stored.ephemeralTabIds.map(Number).filter(Number.isFinite)
      : defaults.ephemeralTabIds,
    renamedTabs: { ...defaults.renamedTabs, ...(stored.renamedTabs || {}) },
    groupOrder: compatibleSpaceModel ? { ...defaults.groupOrder, ...(stored.groupOrder || {}) } : defaults.groupOrder,
    tabOrder: compatibleSpaceModel ? { ...defaults.tabOrder, ...(stored.tabOrder || {}) } : defaults.tabOrder,
    collapsedGroups: compatibleSpaceModel ? { ...defaults.collapsedGroups, ...(stored.collapsedGroups || {}) } : defaults.collapsedGroups,
    collapsedSpaceGroups: { ...defaults.collapsedSpaceGroups, ...(stored.collapsedSpaceGroups || {}) },
    askSessions: { ...defaults.askSessions, ...(stored.askSessions || {}) },
    activeAskSessionKey: stored.activeAskSessionKey || defaults.activeAskSessionKey,
    spaceContexts: { ...defaults.spaceContexts, ...(stored.spaceContexts || {}) },
    spaceSnapshots: { ...defaults.spaceSnapshots, ...(stored.spaceSnapshots || {}) },
    onboarding: normalizeOnboarding(stored.onboarding, defaults.onboarding),
    lastArcImport: normalizeLastArcImport(stored.lastArcImport),
    operationHistory: normalizeOperationHistory(stored.operationHistory),
    shortcuts: migrateShortcuts(stored.shortcuts, defaults.shortcuts, stored.version, defaults.version),
    ai: migrateAISettings(stored.ai, defaults.ai, stored.version),
  };
}

function normalizeDefaultSpace(spaces, storedVersion = 0) {
  if (Number(storedVersion) >= 7) return spaces;
  return spaces.map((space) => space.id === 'default'
    ? { ...space, name: 'Default', icon: 'D' }
    : space);
}

function normalizeOnboarding(value, fallback = { version: 2, completed: false, stage: 'choose' }) {
  if (!value || typeof value !== 'object') return { ...fallback };
  const completed = value.completed === true;
  const stage = completed
    ? 'done'
    : value.stage === 'ai' ? 'ai' : 'choose';
  return {
    version: 2,
    completed,
    stage,
  };
}

function normalizeLastArcImport(value) {
  if (!value || typeof value !== 'object') return null;
  const spaceIds = Array.isArray(value.spaceIds)
    ? [...new Set(value.spaceIds.map(String).filter((id) => id && isSafeRecordKey(id)))]
    : [];
  if (spaceIds.length === 0) return null;
  const normalized = {
    spaceIds,
    importedAt: Number(value.importedAt) || 0,
  };
  const token = normalizeArcImportToken(value.token);
  if (token) normalized.token = token;
  const storedFingerprints = value.afterFingerprints && typeof value.afterFingerprints === 'object'
    ? value.afterFingerprints
    : {};
  const afterFingerprints = Object.fromEntries(spaceIds
    .map((spaceId) => [
      spaceId,
      Object.hasOwn(storedFingerprints, spaceId)
        ? String(storedFingerprints[spaceId] || '').trim().slice(0, 200)
        : '',
    ])
    .filter(([, fingerprint]) => fingerprint));
  if (Object.keys(afterFingerprints).length > 0) normalized.afterFingerprints = afterFingerprints;
  return normalized;
}

function normalizeOperationHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((operation) => operation && typeof operation === 'object')
    .slice(-10)
    .map((operation, index) => ({
      ...operation,
      id: String(operation.id || `${Number(operation.createdAt) || 0}-${index}`),
      type: String(operation.type || 'workspace'),
      summary: String(operation.summary || 'Workspace change').slice(0, 240),
      createdAt: Number(operation.createdAt) || 0,
      status: operation.status === 'undone' ? 'undone' : 'applied',
    }));
}

function migrateAISettings(storedAI = {}, defaultAI = {}, storedVersion = 0) {
  const normalizedStoredAI = storedAI && typeof storedAI === 'object' ? storedAI : {};
  const ai = { ...defaultAI, ...normalizedStoredAI };
  if (!normalizedStoredAI.provider && normalizedStoredAI.baseUrl) {
    if (normalizeUrl(normalizedStoredAI.baseUrl) === LEGACY_DEFAULT_AI_BASE_URL) ai.provider = 'z-ai';
    else delete ai.provider;
  }
  delete ai.maxTokens;
  if (isLegacyBuiltInAISettings(normalizedStoredAI)) {
    ai.provider = defaultAI.provider;
    ai.baseUrl = defaultAI.baseUrl || '';
    ai.model = defaultAI.model || '';
  }
  const normalizedBaseUrl = normalizeUrl(ai.baseUrl);
  if (normalizedBaseUrl === LEGACY_DEFAULT_AI_BASE_URL) ai.baseUrl = DOMESTIC_CODING_AI_BASE_URL;
  if (
    Number(storedVersion) < 12 &&
    [LEGACY_DEFAULT_AI_BASE_URL, DOMESTIC_CODING_AI_BASE_URL].includes(normalizedBaseUrl) &&
    String(ai.model || '').trim().toLowerCase() === 'glm-5.1'
  ) ai.model = 'glm-5.2';
  return normalizeAIProviderSettings({
    ...ai,
    baseUrl: normalizeUrl(ai.baseUrl || ''),
    model: String(ai.model || '').trim(),
  });
}

function isLegacyBuiltInAISettings(ai = {}) {
  return (
    !ai?.provider &&
    !ai?.apiKey &&
    normalizeUrl(ai?.baseUrl) === LEGACY_DEFAULT_AI_BASE_URL &&
    String(ai?.model || '') === LEGACY_DEFAULT_AI_MODEL
  );
}

function migrateShortcuts(storedShortcuts = {}, defaultShortcuts = {}, storedVersion = 0, currentVersion = 0) {
  const shortcuts = mergeShortcuts(storedShortcuts, defaultShortcuts);
  if (
    Number(storedVersion) < 4 &&
    normalizeShortcut(storedShortcuts.togglePanel) === LEGACY_TOGGLE_PANEL_SHORTCUT
  ) {
    shortcuts.togglePanel = defaultShortcuts.togglePanel;
  }
  if (
    Number(storedVersion) < 9 &&
    Number(currentVersion) >= 9 &&
    normalizeShortcut(storedShortcuts.askSubmit) === LEGACY_DEFAULT_ASK_SUBMIT_SHORTCUT
  ) {
    shortcuts.askSubmit = defaultShortcuts.askSubmit;
  }
  if (
    Number(storedVersion) < 10 &&
    Number(currentVersion) >= 10 &&
    normalizeShortcut(storedShortcuts.askAbort) === LEGACY_DEFAULT_ASK_ABORT_SHORTCUT
  ) {
    shortcuts.askAbort = defaultShortcuts.askAbort;
  }
  return shortcuts;
}

export function serializeTab(tab) {
  return {
    id: tab.id,
    title: tab.title || 'Untitled',
    url: tab.pendingUrl || tab.url || '',
    favIconUrl: tab.favIconUrl || '',
    pinned: Boolean(tab.pinned),
    muted: Boolean(tab.mutedInfo?.muted),
    active: Boolean(tab.active),
    groupId: tab.groupId ?? -1,
    index: tab.index ?? 0,
    windowId: tab.windowId,
    audible: Boolean(tab.audible),
    lastAccessed: Number(tab.lastAccessed) || 0,
  };
}

export function serializeGroup(group) {
  return {
    id: group.id,
    title: Object.hasOwn(group, 'title') ? String(group.title) : 'Group',
    color: group.color || 'grey',
    collapsed: Boolean(group.collapsed),
  };
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeBrowserSessionId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_BROWSER_SESSION_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    !isSafeRecordKey(normalized)
  ) return '';
  return normalized;
}

function normalizedWindowIdKey(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? String(value) : '';
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return '';
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? String(numeric) : '';
}

function isSafeRecordKey(value) {
  return !['__proto__', 'prototype', 'constructor'].includes(String(value));
}

function validSpaces(spaces, fallback) {
  if (!Array.isArray(spaces) || spaces.length === 0) return fallback;
  const valid = spaces
    .filter((space) => typeof space?.id === 'string' && typeof space?.name === 'string')
    .map((space) => ({
      id: space.id,
      name: space.name,
      icon: space.icon || space.name.slice(0, 1).toUpperCase(),
      color: space.color || 'blue',
    }));
  return valid.length ? valid : fallback;
}

function migrateSpaces(spaces, fallback) {
  const custom = validSpaces(spaces, [])
    .filter((space) => !isLegacyBuiltInSpace(space));
  return custom.length ? custom : fallback;
}

function isLegacyBuiltInSpace(space) {
  return (
    (space.id === 'work' && space.name === 'Work') ||
    (space.id === 'focus' && space.name === 'Focus') ||
    (space.id === 'personal' && space.name === 'Personal')
  );
}
