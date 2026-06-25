import { mergeShortcuts, normalizeShortcut } from './shortcuts.js';

export const STORAGE_KEY = 'spaceTabsState';
export const SECRET_STORAGE_KEY = 'spaceTabsSecrets';
const LEGACY_TOGGLE_PANEL_SHORTCUT = 'Meta+S';
const LEGACY_DEFAULT_AI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
const LEGACY_DEFAULT_AI_MODEL = 'glm-5.1';

export function createDefaultState(localConfig = {}) {
  const ai = localConfig.ai || {};
  return {
    version: 4,
    theme: 'purple',
    activeSpaceId: 'default',
    spaces: [
      { id: 'default', name: 'Space', icon: 'S', color: 'blue' },
    ],
    groupSpaces: {},
    tabSpaces: {},
    virtualGroups: {},
    tabGroups: {},
    ephemeralTabIds: [],
    renamedTabs: {},
    groupOrder: {},
    tabOrder: {},
    collapsedGroups: {},
    collapsedSpaceGroups: {},
    askSessions: {},
    activeAskSessionKey: '',
    spaceSnapshots: {},
    shortcuts: mergeShortcuts(),
    ai: {
      provider: ai.provider || 'openai-compatible',
      baseUrl: normalizeUrl(ai.baseUrl || ''),
      model: ai.model || '',
      apiKey: ai.apiKey || '',
      thinking: ai.thinking || 'disabled',
      language: ai.language || 'zh-CN',
      temperature: Number(ai.temperature ?? 0.6),
      maxTokens: Number(ai.maxTokens ?? 2048),
    },
  };
}

export function mergeStoredState(stored, defaults = createDefaultState()) {
  if (!stored || typeof stored !== 'object') return defaults;
  const compatibleSpaceModel = stored.version === defaults.version;
  const spaces = compatibleSpaceModel
    ? validSpaces(stored.spaces, defaults.spaces)
    : migrateSpaces(stored.spaces, defaults.spaces);
  const activeSpaceId = spaces.some((space) => space.id === stored.activeSpaceId)
    ? stored.activeSpaceId
    : spaces[0].id;

  return {
    version: defaults.version,
    theme: stored.theme || defaults.theme || 'purple',
    activeSpaceId,
    spaces,
    groupSpaces: compatibleSpaceModel ? { ...defaults.groupSpaces, ...(stored.groupSpaces || {}) } : defaults.groupSpaces,
    tabSpaces: compatibleSpaceModel ? { ...defaults.tabSpaces, ...(stored.tabSpaces || {}) } : defaults.tabSpaces,
    virtualGroups: compatibleSpaceModel ? { ...defaults.virtualGroups, ...(stored.virtualGroups || {}) } : defaults.virtualGroups,
    tabGroups: compatibleSpaceModel ? { ...defaults.tabGroups, ...(stored.tabGroups || {}) } : defaults.tabGroups,
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
    spaceSnapshots: { ...defaults.spaceSnapshots, ...(stored.spaceSnapshots || {}) },
    shortcuts: migrateShortcuts(stored.shortcuts, defaults.shortcuts, stored.version, defaults.version),
    ai: migrateAISettings(stored.ai, defaults.ai),
  };
}

function migrateAISettings(storedAI = {}, defaultAI = {}) {
  const ai = { ...defaultAI, ...(storedAI || {}) };
  if (isLegacyBuiltInAISettings(storedAI)) {
    ai.baseUrl = defaultAI.baseUrl || '';
    ai.model = defaultAI.model || '';
  }
  return ai;
}

function isLegacyBuiltInAISettings(ai = {}) {
  return (
    !ai?.apiKey &&
    normalizeUrl(ai?.baseUrl) === LEGACY_DEFAULT_AI_BASE_URL &&
    String(ai?.model || '') === LEGACY_DEFAULT_AI_MODEL
  );
}

function migrateShortcuts(storedShortcuts = {}, defaultShortcuts = {}, storedVersion = 0, currentVersion = 0) {
  const shortcuts = mergeShortcuts(storedShortcuts, defaultShortcuts);
  if (
    Number(storedVersion) < Number(currentVersion) &&
    normalizeShortcut(storedShortcuts.togglePanel) === LEGACY_TOGGLE_PANEL_SHORTCUT
  ) {
    shortcuts.togglePanel = defaultShortcuts.togglePanel;
  }
  return shortcuts;
}

export function serializeTab(tab) {
  return {
    id: tab.id,
    title: tab.title || 'Untitled',
    url: tab.url || '',
    favIconUrl: tab.favIconUrl || '',
    pinned: Boolean(tab.pinned),
    muted: Boolean(tab.mutedInfo?.muted),
    active: Boolean(tab.active),
    groupId: tab.groupId ?? -1,
    index: tab.index ?? 0,
    windowId: tab.windowId,
    audible: Boolean(tab.audible),
  };
}

export function serializeGroup(group) {
  return {
    id: group.id,
    title: group.title || 'Group',
    color: group.color || 'grey',
    collapsed: Boolean(group.collapsed),
  };
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
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
