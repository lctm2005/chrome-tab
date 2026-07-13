import { normalizeAIProviderSettings } from './ai-providers.js';
import { DEFAULT_MAX_TOKENS, normalizeMaxTokens } from './ai.js';
import { mergeShortcuts, normalizeShortcut } from './shortcuts.js';

export const STORAGE_KEY = 'spaceTabsState';
export const SECRET_STORAGE_KEY = 'spaceTabsSecrets';
const LEGACY_TOGGLE_PANEL_SHORTCUT = 'Meta+S';
const LEGACY_DEFAULT_AI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
const LEGACY_DEFAULT_AI_MODEL = 'glm-5.1';
const LEGACY_DEFAULT_MAX_TOKENS = new Set([1024, 2048, 32768]);
const INVALID_V7_DEFAULT_MAX_TOKENS = 1_000_000;

export function createDefaultState(localConfig = {}) {
  const ai = localConfig.ai || {};
  const aiProviderInput = {
    baseUrl: normalizeUrl(ai.baseUrl || ''),
    model: ai.model || '',
  };
  if (ai.provider) aiProviderInput.provider = ai.provider;
  const normalizedAI = normalizeAIProviderSettings(aiProviderInput);
  return {
    version: 8,
    theme: 'purple',
    activeSpaceId: 'default',
    spaces: [
      { id: 'default', name: 'Default', icon: 'D', color: 'blue' },
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
    spaceContexts: {},
    spaceSnapshots: {},
    onboarding: {
      version: 1,
      completed: false,
    },
    lastArcImport: null,
    shortcuts: mergeShortcuts(),
    ai: {
      provider: normalizedAI.provider,
      baseUrl: normalizedAI.baseUrl,
      model: normalizedAI.model,
      apiKey: ai.apiKey || '',
      thinking: ai.thinking || 'disabled',
      language: ai.language || 'zh-CN',
      temperature: Number(ai.temperature ?? 0.6),
      maxTokens: normalizeMaxTokens(ai.maxTokens, DEFAULT_MAX_TOKENS),
    },
  };
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
    spaceContexts: { ...defaults.spaceContexts, ...(stored.spaceContexts || {}) },
    spaceSnapshots: { ...defaults.spaceSnapshots, ...(stored.spaceSnapshots || {}) },
    onboarding: normalizeOnboarding(stored.onboarding, defaults.onboarding),
    lastArcImport: normalizeLastArcImport(stored.lastArcImport),
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

function normalizeOnboarding(value, fallback = { version: 1, completed: false }) {
  if (!value || typeof value !== 'object') return { ...fallback };
  return {
    version: Number(value.version) || Number(fallback.version) || 1,
    completed: value.completed === true,
  };
}

function normalizeLastArcImport(value) {
  if (!value || typeof value !== 'object') return null;
  const spaceIds = Array.isArray(value.spaceIds)
    ? [...new Set(value.spaceIds.map(String).filter(Boolean))]
    : [];
  if (spaceIds.length === 0) return null;
  return {
    spaceIds,
    importedAt: Number(value.importedAt) || 0,
  };
}

function migrateAISettings(storedAI = {}, defaultAI = {}, storedVersion = 0) {
  let ai = { ...defaultAI, ...(storedAI || {}) };
  if (Number(storedVersion) < 7 && LEGACY_DEFAULT_MAX_TOKENS.has(Number(storedAI?.maxTokens))) {
    ai.maxTokens = defaultAI.maxTokens;
  }
  if (Number(storedVersion) < 8 && Number(storedAI?.maxTokens) === INVALID_V7_DEFAULT_MAX_TOKENS) {
    ai.maxTokens = defaultAI.maxTokens;
  }
  ai.maxTokens = normalizeMaxTokens(ai.maxTokens, defaultAI.maxTokens);
  if (isLegacyBuiltInAISettings(storedAI)) {
    ai.baseUrl = defaultAI.baseUrl || '';
    ai.model = defaultAI.model || '';
  }
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
