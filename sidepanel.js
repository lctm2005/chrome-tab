import { createPrompt, formatAIError, getOriginPattern, parseTidyGroups } from './src/shared/ai.js';
import {
  appendAskSessionMessage,
  createAskSession,
  pruneAskSessions,
  sessionKeyForTab,
  updateAskSessionMessage,
} from './src/shared/ask-session.js';
import {
  appendArcImportPlan,
  createArcImportPlan,
} from './src/shared/arc-import.js';
import { createFolderTree, folderTitleParts, movedGroupTitleForFolderDrop } from './src/shared/folder-tree.js';
import { renderMarkdown } from './src/shared/markdown.js';
import { createPreviewCommandHandler, isExtensionRuntime } from './src/shared/preview-runtime.js';
import {
  findShortcutConflict,
  formatShortcut,
  mergeShortcuts,
  normalizeShortcut,
  shortcutActionFromEvent,
  shouldIgnoreShortcutInEditable,
  shortcutFromEvent,
  shortcutMatchesEvent,
  SHORTCUT_ACTIONS,
} from './src/shared/shortcuts.js';
import {
  createDefaultState,
  mergeStoredState,
  SECRET_STORAGE_KEY,
  STORAGE_KEY,
} from './src/shared/state.js';
import {
  selectionForContextMenu,
  tabSelectionFromClick,
} from './src/shared/tab-selection.js';
import {
  buildSpaceSnapshot,
  comparableSnapshotUrl,
  dropTemporarySnapshotGroups,
  isUngroupedSnapshotGroup,
  mergeSpaceSnapshot,
  removeSnapshotTabs,
  removeSnapshotTab,
  sanitizeSpaceSnapshot,
  shouldAutoCloseTab,
  snapshotTabCount,
} from './src/shared/space-snapshot.js';
import {
  adoptUnassignedEntities,
  cleanupMissingEntities,
  closableTabsForSpace,
  closableTabsOutsideSpace,
  fallbackSpaceAfterDelete,
  removeSpaceReferences,
  restoreSnapshotOwnership,
  syncCollapsedGroupsFromChrome,
  tabBelongsToSpace as entityBelongsToSpace,
} from './src/shared/space-membership.js';
import {
  buildSpaceView,
  compactTabForAI,
  decorateTabs,
  domainFromUrl,
  groupTitleKey,
  planTidyGroups,
  planTidyTabNames,
  planDuplicateUrlClosures,
  preferredFocusableTab,
  sanitizeTidyGroups,
  titleForDomain,
} from './src/shared/tab-utils.js';

const legacyConfigName = ['ARC', 'SIDECAR_LOCAL_CONFIG'].join('');
const localConfig = window.SPACE_TABS_CONFIG || window[legacyConfigName] || {};
const extensionRuntime = isExtensionRuntime(window);
const previewSend = createPreviewCommandHandler();
const AUTO_GROUP_ICON = `
  <svg class="archive-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5.5 8.5h13l1.4 4.2v4.8a1.5 1.5 0 0 1-1.5 1.5H5.6a1.5 1.5 0 0 1-1.5-1.5v-4.8L5.5 8.5Z"></path>
    <path d="M7.4 5.5h9.2a1.4 1.4 0 0 1 1.3.9l.8 2.1H5.3l.8-2.1a1.4 1.4 0 0 1 1.3-.9Z"></path>
    <path d="M9 12.7h6"></path>
  </svg>
`;

let state = createDefaultState(localConfig);
let tabs = [];
let groups = [];
let spaceView = [];
let dormantSpaceView = [];
let dormantSpaceViewSpaceId = '';
const syntheticPlaceholderTabIds = new Set();
let activeView = 'space';
let dragState = null;
let activeAIRequestId = '';
let activePanelAction = '';
let panelPort = null;
let selectedTabIds = new Set();
let selectionAnchorTabId = null;
let pendingArcImportText = '';
let renderedGroupContexts = new Map();
let renderedGroupDragContexts = new Map();
let lastGroupDragEndedAt = 0;
let lastRenderedGroupsSignature = '';
let lastRenderedAskSignature = '';
let lastRenderedSpacesSignature = '';
let recentlyOpenedDormantTabs = [];

const els = {
  activeSpaceName: document.querySelector('#activeSpaceName'),
  syncStatus: document.querySelector('#syncStatus'),
  settingsButton: document.querySelector('#settingsButton'),
  collapseGroupsButton: document.querySelector('#collapseGroupsButton'),
  tidyNamesButton: document.querySelector('#tidyNamesButton'),
  autoGroupButton: document.querySelector('#autoGroupButton'),
  groupsList: document.querySelector('#groupsList'),
  askPageView: document.querySelector('#askPageView'),
  askMessages: document.querySelector('#askMessages'),
  askPagePrompt: document.querySelector('#askPagePrompt'),
  askAIButton: document.querySelector('#askAIButton'),
  summarizePageButton: document.querySelector('#summarizePageButton'),
  testAIButton: document.querySelector('#testAIButton'),
  settingsStatus: document.querySelector('#settingsStatus'),
  arcImportInput: document.querySelector('#arcImportInput'),
  importArcButton: document.querySelector('#importArcButton'),
  arcImportStatus: document.querySelector('#arcImportStatus'),
  spacesList: document.querySelector('#spacesList'),
  contextMenu: document.querySelector('#contextMenu'),
  actionDialog: document.querySelector('#actionDialog'),
  actionDialogTitle: document.querySelector('#actionDialogTitle'),
  actionDialogMessage: document.querySelector('#actionDialogMessage'),
  actionDialogLabel: document.querySelector('#actionDialogLabel'),
  actionDialogInput: document.querySelector('#actionDialogInput'),
  actionDialogClose: document.querySelector('#actionDialogClose'),
  actionDialogCancel: document.querySelector('#actionDialogCancel'),
  actionDialogConfirm: document.querySelector('#actionDialogConfirm'),
  settingsDialog: document.querySelector('#settingsDialog'),
  baseUrlInput: document.querySelector('#baseUrlInput'),
  modelInput: document.querySelector('#modelInput'),
  languageInput: document.querySelector('#languageInput'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  apiKeyStatus: document.querySelector('#apiKeyStatus'),
  clearApiKeyButton: document.querySelector('#clearApiKeyButton'),
  thinkingInput: document.querySelector('#thinkingInput'),
  maxTokensInput: document.querySelector('#maxTokensInput'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  shortcutsList: document.querySelector('#shortcutsList'),
  themeOptions: document.querySelector('.theme-options'),
};

init();

async function init() {
  try {
    connectPanelPort();
    await loadState();
    bindEvents();
    renderSettings();
    await refreshTabs({ adopt: true, adoptGroups: !hasKnownSpaceOwnership() });
    if (extensionRuntime) setInterval(() => refreshTabs({ adopt: true }), 2500);
  } catch (error) {
    els.syncStatus.textContent = 'Failed to initialize';
    if (activeView === 'ask') addAskMessage('assistant', formatAIError(error));
  }
}

function hasKnownSpaceOwnership() {
  return Object.keys(state.groupSpaces || {}).length > 0 ||
    Object.keys(state.tabSpaces || {}).length > 0;
}

function connectPanelPort() {
  if (!extensionRuntime || !chrome.runtime.connect) return;
  panelPort = chrome.runtime.connect({ name: 'sidepanel' });
  panelPort.onMessage.addListener((message) => {
    if (message?.type === 'panel:close') {
      notifyPanelVisibility(false);
      window.close();
    }
    if (message?.type === 'shortcut:action') {
      void runTask(() => runShortcutAction(message.action));
    }
  });
  notifyPanelVisibility(true);
  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState !== 'hidden';
    if (!visible) persistCurrentSpaceSnapshot();
    notifyPanelVisibility(visible);
  });
  window.addEventListener('focus', () => notifyPanelVisibility(true));
  window.addEventListener('pageshow', () => notifyPanelVisibility(true));
  window.addEventListener('pagehide', () => {
    persistCurrentSpaceSnapshot();
    notifyPanelVisibility(false);
  });
}

function notifyPanelVisibility(visible) {
  try {
    panelPort?.postMessage({ type: 'panel:visibility', visible });
  } catch {
    // The port is intentionally best-effort; Chrome can keep side panels alive while hidden.
  }
}

function persistCurrentSpaceSnapshot() {
  if (!state?.activeSpaceId) return;
  snapshotOpenSpace(state.activeSpaceId);
  void saveState();
}

async function loadState() {
  const defaults = createDefaultState(localConfig);
  const stored = await storageGet();
  state = mergeStoredState(stored[STORAGE_KEY], defaults);
  applyTheme(state.theme);
  sanitizeStoredSpaceSnapshots();
  const secrets = await secretGet();

  if (localConfig.ai?.apiKey) {
    state.ai = {
      ...localConfig.ai,
      ...state.ai,
      apiKey: localConfig.ai.apiKey,
      baseUrl: String(state.ai.baseUrl || localConfig.ai.baseUrl || '').trim().replace(/\/+$/, ''),
      maxTokens: Number(state.ai.maxTokens ?? localConfig.ai.maxTokens ?? 2048),
      temperature: Number(state.ai.temperature ?? localConfig.ai.temperature ?? 0.6),
    };
  } else if (secrets[SECRET_STORAGE_KEY]?.ai?.apiKey) {
    state.ai.apiKey = secrets[SECRET_STORAGE_KEY].ai.apiKey;
  }

  await saveState();
}

async function saveState() {
  await storageSet({ [STORAGE_KEY]: stateForStorage() });
}

function bindEvents() {
  els.settingsButton.addEventListener('click', () => {
    state.tempTheme = state.theme || 'purple';
    renderSettings();
    els.settingsDialog.showModal();
  });
  els.tidyNamesButton.addEventListener('click', () => runTask(tidyTabNames));
  els.autoGroupButton.addEventListener('click', () => runTask(autoGroupTabs));
  els.collapseGroupsButton.addEventListener('click', () => runTask(toggleSpaceGroups));
  els.askAIButton.addEventListener('click', () => runTask(askCustomPrompt));
  els.summarizePageButton.addEventListener('click', () => runTask(summarizeCurrentPage));
  els.testAIButton.addEventListener('click', () => runTask(testAI));
  els.clearApiKeyButton.addEventListener('click', () => runTask(clearApiKey));
  els.arcImportInput.addEventListener('change', () => runTask(previewArcImportFile));
  els.importArcButton.addEventListener('click', () => runTask(importArcFile));
  els.saveSettingsButton.addEventListener('click', (event) => {
    event.preventDefault();
    runTask(() => saveSettings());
  });

  els.themeOptions.addEventListener('click', (event) => {
    const btn = event.target.closest('.theme-option');
    if (!btn) return;
    state.tempTheme = btn.dataset.theme;
    applyTheme(state.tempTheme);
    for (const option of els.themeOptions.querySelectorAll('.theme-option')) {
      option.classList.toggle('active', option.dataset.theme === state.tempTheme);
    }
  });

  els.settingsDialog.addEventListener('close', () => {
    if (state.tempTheme) {
      applyTheme(state.theme);
      delete state.tempTheme;
    }
  });

  window.addEventListener('contextmenu', handleGroupHeaderContextMenu, { capture: true });
  window.addEventListener('mousedown', handleGroupHeaderMouseDown, { capture: true });
  document.addEventListener('click', hideContextMenu);
  document.addEventListener('keydown', handleDocumentKeydown);
}

function handleDocumentKeydown(event) {
  const shortcutInput = event.target?.closest?.('.shortcut-input');
  if (shortcutInput) {
    captureShortcutInput(event, shortcutInput);
    return;
  }

  if (event.key === 'Escape') hideContextMenu();

  const shortcuts = mergeShortcuts(state.shortcuts);
  if (shortcutMatchesEvent(shortcuts.askAbort, event) && activeAIRequestId) {
    event.preventDefault();
    event.stopPropagation();
    void abortActiveAIRequest();
    return;
  }

  if (shortcutMatchesEvent(shortcuts.togglePanel, event)) {
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
    return;
  }

  if (activeView === 'ask' && shortcutMatchesEvent(shortcuts.askSubmit, event)) {
    event.preventDefault();
    event.stopPropagation();
    if (activeAIRequestId) void abortActiveAIRequest();
    else void runTask(askCustomPrompt);
    return;
  }

  if (isEditableTarget(event.target) && shouldIgnoreShortcutInEditable(event)) return;

  const action = shortcutActionFromEvent(event, shortcuts, {
    exclude: ['togglePanel', 'askSubmit', 'askAbort'],
  });
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  void runTask(() => runShortcutAction(action));
}

function captureShortcutInput(event, input) {
  if (event.key === 'Tab') return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Backspace' || event.key === 'Delete') {
    input.value = '';
    input.dataset.shortcut = '';
    return;
  }
  const shortcut = shortcutFromEvent(event);
  if (!shortcut) return;
  input.value = formatShortcut(shortcut);
  input.dataset.shortcut = shortcut;
}

function isEditableTarget(target) {
  const node = target?.closest?.('input, textarea, select, [contenteditable="true"]');
  return Boolean(node);
}

async function runShortcutAction(action) {
  if (action === 'openAsk') {
    openAskPage();
    return;
  }
  if (action === 'tidyNames') {
    await tidyTabNames();
    return;
  }
  if (action === 'autoGroup') {
    await autoGroupTabs();
    return;
  }
  if (action === 'addSpace') {
    await addSpace();
    return;
  }
  if (action === 'previousSpace') {
    await activateAdjacentSpace(-1);
    return;
  }
  if (action === 'nextSpace') {
    await activateAdjacentSpace(1);
  }
}

async function activateAdjacentSpace(direction) {
  const index = state.spaces.findIndex((space) => space.id === state.activeSpaceId);
  if (index < 0 || state.spaces.length < 2) return;
  const nextIndex = (index + direction + state.spaces.length) % state.spaces.length;
  await activateSpace(state.spaces[nextIndex].id);
  focusPanelForShortcuts();
}

function togglePanel() {
  if (!extensionRuntime) {
    activeView = activeView === 'ask' ? 'space' : 'ask';
    render();
    return;
  }
  window.close();
  setTimeout(() => setStatus('Use the Chrome shortcut again to open Space Tabs.'), 120);
}

async function refreshTabs(options = {}) {
  await loadTabs({ adopt: Boolean(options.adopt), adoptGroups: Boolean(options.adoptGroups) });
  if (await materializeLegacyVirtualGroups(state.activeSpaceId)) {
    await loadTabs({ adopt: false });
  }
  snapshotOpenSpace(state.activeSpaceId);
  await loadDormantSpaceView(state.activeSpaceId, { force: Boolean(options.reloadDormant) });
  render();
  await saveState();
}

async function loadTabs({ adopt = false, adoptGroups = false } = {}) {
  const previousTabs = tabs;
  const response = await send('tabs:list');
  tabs = decorateTabs(response.tabs || [], state);
  groups = response.groups || [];
  const contentTabs = tabs.filter((tab) => !isEphemeralTab(tab));
  removeStaleActiveSpaceTabsFromSnapshot(previousTabs, contentTabs);
  cleanupEphemeralTabIds();
  restoreSnapshotOwnership(state, contentTabs, groups);
  if (adopt) adoptUnassignedEntities(state, contentTabs, groups, state.activeSpaceId, { adoptGroups });
  else cleanupMissingEntities(state, contentTabs, groups);
  syncCollapsedGroupsFromChrome(state, groups);
}

function removeStaleActiveSpaceTabsFromSnapshot(previousTabs = [], currentTabs = []) {
  if (!previousTabs.length || !state.activeSpaceId) return;
  const currentById = new Map(currentTabs.map((tab) => [Number(tab.id), tab]));
  const currentUrlKeys = new Set(currentTabs
    .map((tab) => comparableSnapshotUrl(tab.url))
    .filter(Boolean));
  const staleTabs = previousTabs.filter((tab) => {
    if (isEphemeralTab(tab) || !tabBelongsToSpace(tab, state.activeSpaceId)) return false;
    const oldUrlKey = comparableSnapshotUrl(tab.url);
    if (!oldUrlKey) return false;
    const nextTab = currentById.get(Number(tab.id));
    if (!nextTab) return true;
    const nextUrlKey = comparableSnapshotUrl(nextTab.url);
    return oldUrlKey && oldUrlKey !== nextUrlKey && !currentUrlKeys.has(oldUrlKey);
  });
  if (staleTabs.length === 0) return;
  removeTabsFromSpaceSnapshot(state.activeSpaceId, staleTabs);
}

async function materializeLegacyVirtualGroups(spaceId = state.activeSpaceId) {
  const virtualEntries = Object.entries(state.virtualGroups || {})
    .filter(([, group]) => group?.spaceId === spaceId);
  if (virtualEntries.length === 0) return false;

  let changed = false;
  for (const [groupKey, group] of virtualEntries) {
    const tabIds = tabs
      .filter((tab) => (
        !tab.pinned &&
        !isEphemeralTab(tab) &&
        !isGroupedTab(tab) &&
        state.tabSpaces[tab.id] === spaceId &&
        state.tabGroups?.[tab.id] === groupKey
      ))
      .map((tab) => tab.id);
    if (tabIds.length === 0) continue;

    const existing = chromeGroupForTitle(group.title, spaceId);
    const groupId = existing
      ? await addTabsToChromeGroup(existing.id, tabIds, spaceId)
      : await createChromeGroup(tabIds, {
        title: group.title,
        color: group.color,
        collapsed: Boolean(group.collapsed ?? state.collapsedGroups[groupKey]),
        spaceId,
        sourceKey: groupKey,
      });
    if (groupId === null) continue;

    if (existing) bindChromeGroup(groupId, spaceId, { sourceKey: groupKey });
    changed = true;
  }

  cleanupUnusedVirtualGroups();
  return changed;
}

async function loadDormantSpaceView(spaceId, options = {}) {
  if (!options.force && dormantSpaceViewSpaceId === spaceId) return;
  const snapshot = sanitizeStoredSpaceSnapshot(spaceId);
  dormantSpaceView = dormantGroupsFromSnapshot(snapshot);
  dormantSpaceViewSpaceId = spaceId;
}

function render() {
  const activeSpace = currentSpace();
  const liveSpaceView = buildSpaceView({
    activeSpaceId: state.activeSpaceId,
    tabs,
    groups,
    groupSpaces: state.groupSpaces,
    tabSpaces: state.tabSpaces,
    virtualGroups: state.virtualGroups,
    tabGroups: state.tabGroups,
    groupOrder: state.groupOrder,
    tabOrder: state.tabOrder,
    collapsedGroups: state.collapsedGroups,
    includeUngrouped: true,
  });
  spaceView = mergeDormantSpaceView(liveSpaceView, dormantSpaceView);
  syncSelectedTabsToVisibleSpace();

  const isAskView = activeView === 'ask';
  const groupsCollapsed = !isAskView && isSpaceGroupsCollapsed();
  if (isAskView) ensureCurrentAskSession();
  els.activeSpaceName.textContent = isAskView ? 'Ask Page' : activeSpace.name;
  els.syncStatus.textContent = activePanelAction
    ? panelActionStatus(activePanelAction)
    : isAskView
    ? activePageStatus()
    : '';
  els.groupsList.hidden = isAskView;
  els.askPageView.hidden = !isAskView;
  els.tidyNamesButton.hidden = isAskView;
  els.autoGroupButton.hidden = isAskView;
  els.collapseGroupsButton.hidden = isAskView;
  els.collapseGroupsButton.innerHTML = groupsCollapsed
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
  els.collapseGroupsButton.title = groupsCollapsed ? 'Expand groups' : 'Collapse groups';
  els.collapseGroupsButton.setAttribute('aria-label', els.collapseGroupsButton.title);
  els.collapseGroupsButton.classList.toggle('active', groupsCollapsed);
  els.groupsList.classList.toggle('groups-collapsed', groupsCollapsed);

  renderGroups();
  if (isAskView) renderAskMessages();
  renderSpaces();
  updateAIRequestUI();
  updatePanelActionUI();
}

function mergeDormantSpaceView(liveView, dormantView) {
  const liveTabs = liveView.flatMap((group) => group.tabs || []);
  const openUrls = new Set(liveTabs.map((tab) => comparableSnapshotUrl(tab.url)).filter(Boolean));
  const ungrouped = cloneGroup(liveView.find((group) => group.key === 'ungrouped') || null);
  const liveGroups = liveView
    .filter((group) => group.key !== 'ungrouped')
    .map(cloneGroup);
  const liveGroupsByTitle = new Map();
  for (const group of liveGroups) {
    const titleKey = groupTitleKey(group.title);
    if (titleKey && !liveGroupsByTitle.has(titleKey)) liveGroupsByTitle.set(titleKey, group);
  }

  const dormantGroups = [];
  const dormantUngroupedTabs = [];
  for (const group of dormantView || []) {
    const matchingLiveGroup = liveGroupsByTitle.get(groupTitleKey(group.title));
    const liveCandidates = matchingLiveGroup?.tabs?.length ? matchingLiveGroup.tabs : liveTabs;
    const dormantGroup = {
      ...group,
      collapsed: Boolean(state.collapsedGroups[group.key] ?? group.collapsed),
      tabs: group.tabs.filter((tab) => !isDormantTabAlreadyOpen(tab, group, liveCandidates, openUrls)),
    };
    if (dormantGroup.tabs.length === 0) continue;

    if (isUngroupedSnapshotGroup(dormantGroup)) {
      dormantUngroupedTabs.push(...dormantGroup.tabs);
      continue;
    }

    if (matchingLiveGroup) {
      matchingLiveGroup.tabs.push(...dormantGroup.tabs);
      continue;
    }

    dormantGroups.push(dormantGroup);
  }

  if (ungrouped) ungrouped.tabs.push(...dormantUngroupedTabs);
  return ungrouped ? [...liveGroups, ...dormantGroups, ungrouped] : [...liveGroups, ...dormantGroups];
}

function cloneGroup(group) {
  return group ? { ...group, tabs: [...(group.tabs || [])] } : null;
}

function dormantGroupsFromSnapshot(snapshot = {}) {
  return (snapshot?.groups || [])
    .map((group, groupIndex) => {
      const title = group.title || 'Ungrouped';
      const key = snapshotGroupKey(groupIndex, group);
      return {
        id: key,
        key,
        title,
        color: group.color || (title === 'Ungrouped' ? 'grey' : 'blue'),
        collapsed: Boolean(state.collapsedGroups[key] ?? true),
        dormant: true,
        tabs: (group.tabs || []).map((tab, tabIndex) => ({
          id: `${key}:${tabIndex}`,
          title: tab.title || tab.url || 'Untitled',
          displayTitle: tab.title || tab.url || 'Untitled',
          url: tab.url,
          domain: domainFromUrl(tab.url),
          favIconUrl: '',
          active: false,
          pinned: false,
          muted: false,
          groupId: -1,
          index: tabIndex,
          audible: false,
          dormant: true,
          dormantGroupKey: key,
        })),
      };
    })
    .filter((group) => group.tabs.length > 0);
}

function renderGroups() {
  const ungrouped = spaceView.find((group) => group.key === 'ungrouped') || null;
  const tabGroups = isSpaceGroupsCollapsed()
    ? []
    : spaceView.filter((group) => group.key !== 'ungrouped');
  const signature = groupsRenderSignature(tabGroups, ungrouped);
  if (signature === lastRenderedGroupsSignature) return;
  lastRenderedGroupsSignature = signature;
  renderedGroupContexts = new Map();
  renderedGroupDragContexts = new Map();

  if (tabGroups.length === 0 && !ungrouped) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No tabs in this Space. Move tabs here from a tab menu, or switch Spaces from the bottom dock.';
    els.groupsList.replaceChildren(empty);
    return;
  }

  const tree = createFolderTree(tabGroups, { activeSpaceId: state.activeSpaceId });
  renderedGroupContexts = groupContextsFromFolderTree(tree);
  renderedGroupDragContexts = groupDragContextsFromFolderTree(tree);
  const nodes = tree.map(createFolderTreeNode);
  if (ungrouped) nodes.push(createUngroupedSection(ungrouped));
  els.groupsList.replaceChildren(...nodes);
}

function groupContextsFromFolderTree(nodes) {
  const contexts = new Map();
  for (const node of nodes) {
    if (node.type === 'folder') {
      for (const [key, group] of groupContextsFromFolderTree(node.children)) {
        contexts.set(key, group);
      }
      continue;
    }
    if (node.group?.key) contexts.set(node.group.key, node.group);
  }
  return contexts;
}

function groupDragContextsFromFolderTree(nodes) {
  const contexts = new Map();
  for (const node of nodes) {
    if (node.type === 'folder') {
      const childContexts = groupDragContextsFromFolderTree(node.children);
      const groupKeys = [];
      for (const [key, context] of childContexts) {
        contexts.set(key, context);
        groupKeys.push(...context.groupKeys);
      }
      contexts.set(node.key, {
        type: 'folder',
        key: node.key,
        path: node.path,
        groupKeys: uniqueKeys(groupKeys),
      });
      continue;
    }
    if (node.group?.key) {
      contexts.set(node.group.key, {
        type: 'group',
        key: node.group.key,
        path: folderTitleParts(node.group.title),
        dormant: Boolean(node.group.dormant),
        groupKeys: [node.group.key],
      });
    }
  }
  return contexts;
}

function uniqueKeys(keys) {
  return [...new Set(keys.filter(Boolean))];
}

function groupsRenderSignature(tabGroups, ungrouped) {
  return JSON.stringify({
    activeSpaceId: state.activeSpaceId,
    collapsed: isSpaceGroupsCollapsed(),
    groups: [...tabGroups, ungrouped].filter(Boolean).map((group) => ({
      key: group.key,
      id: group.id,
      title: group.title,
      displayTitle: group.displayTitle,
      color: group.color,
      collapsed: Boolean(group.collapsed),
      dormant: Boolean(group.dormant),
      tabs: group.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        displayTitle: tab.displayTitle,
        url: tab.url,
        domain: tab.domain,
        favIconUrl: tab.favIconUrl,
        active: Boolean(tab.active),
        pinned: Boolean(tab.pinned),
        muted: Boolean(tab.muted),
        dormant: Boolean(tab.dormant),
      })),
    })),
  });
}

function createFolderTreeNode(node) {
  if (node.type === 'folder') return createFolderSection(node);
  if (node.type === 'folder-tabs') return createFolderTabs(node.group);
  return createGroupCard(node.group);
}

function handleGroupHeaderContextMenu(event) {
  const header = groupHeaderFromEvent(event);
  if (!header) return;
  event.preventDefault();
  event.stopPropagation();
  const group = groupContextFromHeader(header);
  if (group) {
    showGroupContextMenu(event, group);
    return;
  }
  const folder = folderContextFromHeader(header);
  if (folder) showFolderContextMenu(event, folder);
  else hideContextMenu();
}

function handleGroupHeaderMouseDown(event) {
  const isSecondaryMouse = event.button === 2 || (event.button === 0 && event.ctrlKey);
  if (!isSecondaryMouse) return;
  const header = groupHeaderFromEvent(event);
  if (!header) return;
  event.preventDefault();
  event.stopPropagation();
  hideContextMenu();
}

function groupHeaderFromEvent(event) {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const header = target?.closest?.('.group-header, .folder-header');
  if (!header || !els.groupsList.contains(header)) return null;
  return header;
}

function groupContextFromHeader(header) {
  if (!header.classList.contains('group-header')) return null;
  const key = header.dataset.groupKey || header.closest('[data-group-key]')?.dataset.groupKey;
  const group = key ? renderedGroupContexts.get(key) : null;
  if (!group) return null;
  return group;
}

function folderContextFromHeader(header) {
  if (!header.classList.contains('folder-header')) return null;
  const key = header.dataset.folderKey ||
    header.dataset.dragKey ||
    header.closest('[data-folder-key]')?.dataset.folderKey;
  const context = key ? renderedGroupDragContexts.get(key) : null;
  return context?.type === 'folder' ? context : null;
}

function createFolderSection(folder) {
  const collapsed = Boolean(state.collapsedGroups[folder.key]);
  const dragContext = renderedGroupDragContexts.get(folder.key);
  const canDragFolder = Boolean(dragContext?.groupKeys?.length);
  const section = document.createElement('section');
  section.className = `folder-section${collapsed ? ' collapsed' : ''}`;
  section.dataset.folderKey = folder.key;
  section.style.setProperty('--folder-depth', String(Math.max(0, folder.path.length - 1)));

  const header = document.createElement('button');
  header.className = 'folder-header';
  header.type = 'button';
  header.draggable = canDragFolder;
  header.dataset.folderKey = folder.key;
  header.dataset.dragKey = folder.key;
  header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (canDragFolder) {
    header.addEventListener('dragstart', (event) => startFolderDrag(event, folder));
    header.addEventListener('dragend', clearDragState);
    header.addEventListener('dragover', (event) => acceptFolderDrop(event, folder));
    header.addEventListener('dragleave', () => header.classList.remove('drag-over'));
    header.addEventListener('drop', (event) => dropFolder(event, folder));
  }

  const folderSvg = collapsed
    ? folderIconSvg('folder-svg-icon')
    : folderOpenIconSvg('folder-svg-icon');

  header.innerHTML = `
    <span class="folder-caret" aria-hidden="true"></span>
    <span class="folder-icon">${folderSvg}</span>
    <strong>${escapeHtml(folder.title)}</strong>
  `;
  header.addEventListener('click', (event) => handleFolderHeaderClick(event, folder));

  const children = document.createElement('div');
  children.className = 'folder-children';
  if (!collapsed) children.replaceChildren(...folder.children.map(createFolderTreeNode));

  section.append(header, children);
  return section;
}

async function toggleFolder(folderKey) {
  state.collapsedGroups[folderKey] = !state.collapsedGroups[folderKey];
  await saveState();
  lastRenderedGroupsSignature = '';
  render();
}

function createGroupCard(group) {
  const canDragGroup = Boolean(group.key && group.key !== 'ungrouped');
  const card = document.createElement('section');
  card.className = `group-card${group.collapsed ? ' collapsed' : ''}`;
  card.dataset.groupKey = group.key;
  if (canDragGroup) {
    card.addEventListener('dragover', (event) => acceptGroupOrTabDrop(event, group));
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (event) => dropGroupOrTab(event, group));
  }

  const header = document.createElement('div');
  header.className = 'group-header';
  header.dataset.groupKey = group.key;
  header.dataset.dragKey = group.key;
  header.draggable = canDragGroup;
  if (canDragGroup) {
    header.addEventListener('dragstart', (event) => startGroupDrag(event, group));
    header.addEventListener('dragend', clearDragState);
  }
  header.innerHTML = `
    <span class="group-grip" title="Drag group"><svg draggable="false" viewBox="0 0 24 24" width="10" height="10" fill="currentColor" style="vertical-align: middle;"><circle cx="9" cy="5" r="2.2"></circle><circle cx="9" cy="12" r="2.2"></circle><circle cx="9" cy="19" r="2.2"></circle><circle cx="15" cy="5" r="2.2"></circle><circle cx="15" cy="12" r="2.2"></circle><circle cx="15" cy="19" r="2.2"></circle></svg></span>
    ${groupFolderIcon(group.color, group.collapsed)}
    <h2>${escapeHtml(group.displayTitle || group.title)}</h2>
  `;
  const actions = document.createElement('div');
  actions.className = 'group-actions';
  actions.append(actionButton('×', 'Delete group', () => deleteGroup(group)));
  header.append(actions);
  header.addEventListener('click', (event) => handleGroupHeaderClick(event, group));

  const list = document.createElement('div');
  list.className = 'tab-list';
  list.dataset.groupKey = group.key;
  if (!group.dormant) {
    list.addEventListener('dragover', (event) => acceptTabDrop(event));
    list.addEventListener('drop', (event) => dropTabAtEnd(event, group));
  }
  if (!group.collapsed) list.replaceChildren(...group.tabs.map((tab) => createTabRow(tab, group.key)));

  card.append(header, list);
  return card;
}

function createFolderTabs(group) {
  const canDragGroup = Boolean(group.key && group.key !== 'ungrouped');
  const section = document.createElement('section');
  section.className = `folder-direct-group${group.collapsed ? ' collapsed' : ''}`;
  section.dataset.groupKey = group.key;
  if (canDragGroup) {
    section.addEventListener('dragover', (event) => acceptGroupOrTabDrop(event, group));
    section.addEventListener('dragleave', () => section.classList.remove('drag-over'));
    section.addEventListener('drop', (event) => dropGroupOrTab(event, group));
  }

  const header = document.createElement('div');
  header.className = 'group-header folder-direct-header';
  header.dataset.groupKey = group.key;
  header.dataset.dragKey = group.key;
  header.draggable = canDragGroup;
  if (canDragGroup) {
    header.addEventListener('dragstart', (event) => startGroupDrag(event, group));
    header.addEventListener('dragend', clearDragState);
  }
  header.innerHTML = `
    <span class="group-grip" title="Drag group"><svg draggable="false" viewBox="0 0 24 24" width="10" height="10" fill="currentColor" style="vertical-align: middle;"><circle cx="9" cy="5" r="2.2"></circle><circle cx="9" cy="12" r="2.2"></circle><circle cx="9" cy="19" r="2.2"></circle><circle cx="15" cy="5" r="2.2"></circle><circle cx="15" cy="12" r="2.2"></circle><circle cx="15" cy="19" r="2.2"></circle></svg></span>
    ${groupFolderIcon(group.color, group.collapsed)}
    <h2>${escapeHtml(group.displayTitle || 'Tabs')}</h2>
  `;
  const actions = document.createElement('div');
  actions.className = 'group-actions';
  actions.append(actionButton('×', 'Delete group', () => deleteGroup(group)));
  header.append(actions);
  header.addEventListener('click', (event) => handleGroupHeaderClick(event, group));

  const list = document.createElement('div');
  list.className = 'tab-list folder-direct-list';
  list.dataset.groupKey = group.key;
  if (!group.dormant) {
    list.addEventListener('dragover', (event) => acceptTabDrop(event));
    list.addEventListener('drop', (event) => dropTabAtEnd(event, group));
  }
  if (!group.collapsed) list.replaceChildren(...group.tabs.map((tab) => createTabRow(tab, group.key)));
  section.append(header, list);
  return section;
}

function createUngroupedSection(group) {
  const section = document.createElement('section');
  section.className = 'ungrouped-section';
  section.dataset.groupKey = group.key;

  const divider = document.createElement('div');
  divider.className = 'ungrouped-divider';
  const line = document.createElement('span');
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.textContent = 'Clear';
  clearButton.disabled = group.tabs.length === 0;
  clearButton.addEventListener('click', () => runTask(() => clearUngroupedTabs(group)));
  divider.append(line, clearButton);

  const newTabButton = document.createElement('button');
  newTabButton.className = 'new-tab-row';
  newTabButton.type = 'button';
  newTabButton.innerHTML = '<span>+</span><strong>New Tab</strong>';
  newTabButton.addEventListener('click', () => runTask(newTabInActiveSpace));

  const list = document.createElement('div');
  list.className = 'tab-list ungrouped-list';
  list.dataset.groupKey = group.key;
  list.addEventListener('dragover', (event) => acceptTabDrop(event));
  list.addEventListener('drop', (event) => dropTabAtEnd(event, group));
  list.replaceChildren(...group.tabs.map((tab) => createTabRow(tab, group.key)));

  section.append(divider, newTabButton, list);
  return section;
}

function groupFolderIcon(color, collapsed = false) {
  const svg = collapsed
    ? folderIconSvg('group-folder-icon')
    : folderOpenIconSvg('group-folder-icon');
  return `<span class="group-icon" style="color:${groupColor(color)}">${svg}</span>`;
}

function folderIconSvg(className) {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
}

function folderOpenIconSvg(className) {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2A2 2 0 0 0 12 6h8a2 2 0 0 1 2 2v2"></path></svg>`;
}

function createTabRow(tab, groupKey) {
  const row = document.createElement('div');
  const selected = !tab.dormant && selectedTabIds.has(tab.id);
  row.className = [
    'tab-row',
    tab.active ? 'active' : '',
    tab.dormant ? 'dormant' : '',
    selected ? 'selected' : '',
  ].filter(Boolean).join(' ');
  row.tabIndex = 0;
  row.draggable = !tab.dormant;
  row.dataset.tabId = String(tab.id);
  row.dataset.groupKey = groupKey;
  row.setAttribute('aria-selected', selected ? 'true' : 'false');

  const favicon = createFavicon(tab);

  const label = document.createElement('div');
  label.className = 'tab-label';
  label.innerHTML = `
    <div class="tab-title">${escapeHtml(tab.displayTitle || tab.title || tab.url || 'Untitled')}</div>
    <div class="tab-domain">${escapeHtml(tab.domain || tab.url || '')}</div>
  `;

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (tab.dormant) {
    actions.append(
      actionButton('↗', 'Open', () => openDormantTab(tab, groupKey)),
      actionButton('×', 'Remove saved tab', () => removeDormantTab(tab, groupKey)),
    );
  } else {
    actions.append(
      actionButton('✎', 'Rename in panel', () => renameTab(tab)),
      actionButton('×', 'Close', () => closeTab(tab, groupKey)),
    );
  }

  row.append(favicon, label, actions);
  row.addEventListener('click', (event) => handleTabClick(event, tab));
  if (!tab.dormant) {
    row.addEventListener('contextmenu', (event) => showTabContextMenu(event, tab));
    row.addEventListener('dragstart', (event) => startTabDrag(event, tab, groupKey));
    row.addEventListener('dragover', (event) => acceptTabDrop(event));
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (event) => dropTabBefore(event, tab, groupKey));
    row.addEventListener('dragend', clearDragState);
  }
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runTask(() => tab.dormant ? openDormantTab(tab, groupKey) : focusTab(tab));
  });
  return row;
}

function createFavicon(tab) {
  const favicon = document.createElement('span');
  favicon.className = 'favicon';
  const iconUrl = faviconUrlForTab(tab);
  if (iconUrl) {
    const img = document.createElement('img');
    img.src = iconUrl;
    img.alt = '';
    img.draggable = false;
    img.addEventListener('error', () => {
      img.remove();
      favicon.textContent = faviconFallbackText(tab);
    }, { once: true });
    favicon.append(img);
  } else {
    favicon.textContent = faviconFallbackText(tab);
  }
  return favicon;
}

function faviconUrlForTab(tab) {
  const pageUrl = String(tab?.url || '').trim();
  if (extensionRuntime && pageUrl && chrome?.runtime?.getURL) {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '32');
    return url.toString();
  }
  return safeImageUrl(tab?.favIconUrl);
}

function safeImageUrl(value) {
  const url = String(value || '').trim();
  if (/^(data:image\/|blob:|https?:|chrome-extension:)/.test(url)) return url;
  return '';
}

function faviconFallbackText(tab) {
  return (tab.displayTitle || tab.title || tab.domain || '?').slice(0, 1).toUpperCase();
}

function renderSpaces() {
  const signature = spacesRenderSignature();
  if (signature === lastRenderedSpacesSignature) return;
  lastRenderedSpacesSignature = signature;

  const spaceButtons = state.spaces.map((space) => {
    const button = document.createElement('button');
    button.className = `space${activeView === 'space' && space.id === state.activeSpaceId ? ' active' : ''}`;
    button.type = 'button';
    button.title = space.name;
    button.setAttribute('aria-label', space.name);
    button.textContent = space.icon || space.name.slice(0, 1).toUpperCase();
    button.addEventListener('click', () => runTask(() => activateSpace(space.id)));
    button.addEventListener('contextmenu', (event) => showSpaceContextMenu(event, space));
    return button;
  });

  const askButton = document.createElement('button');
  askButton.className = `space ask-space${activeView === 'ask' ? ' active' : ''}`;
  askButton.type = 'button';
  askButton.title = 'Ask Page';
  askButton.setAttribute('aria-label', 'Ask Page');
  askButton.innerHTML = `<svg class="brain-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v14"/><path d="M12 12h6"/><path d="M12 12H6"/></svg>`;
  askButton.addEventListener('click', () => runTask(openAskPage));

  const addButton = document.createElement('button');
  addButton.className = 'space add-space';
  addButton.type = 'button';
  addButton.title = 'Add Space';
  addButton.setAttribute('aria-label', 'Add Space');
  addButton.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
  addButton.addEventListener('click', () => runTask(addSpace));

  const spacesGroup = document.createElement('div');
  spacesGroup.className = 'dock-group dock-spaces';
  spacesGroup.setAttribute('aria-label', 'Spaces');
  spacesGroup.replaceChildren(...spaceButtons, addButton);

  const askGroup = document.createElement('div');
  askGroup.className = 'dock-group dock-ask';
  askGroup.setAttribute('aria-label', 'Ask');
  askGroup.replaceChildren(askButton);

  els.spacesList.replaceChildren(spacesGroup, askGroup);
}

function spacesRenderSignature() {
  return JSON.stringify([
    activeView,
    state.activeSpaceId,
    (state.spaces || []).map((space) => [space.id, space.name, space.icon || '']),
  ]);
}

async function addSpace() {
  const name = await askText({
    title: 'New Space',
    label: 'Space name',
    value: 'New Space',
    confirmText: 'Create',
  });
  if (name === null) return;
  const clean = name.trim();
  if (!clean) return;

  const space = {
    id: uniqueSpaceId(clean),
    name: clean,
    icon: clean.slice(0, 1).toUpperCase(),
    color: nextSpaceColor(),
  };
  state.spaces.push(space);
  await activateSpace(space.id);
}

async function activateSpace(spaceId) {
  if (!state.spaces.some((space) => space.id === spaceId)) return;
  if (spaceId !== state.activeSpaceId) {
    await switchSpace(spaceId);
    return;
  }
  activeView = 'space';
  state.activeSpaceId = spaceId;
  await saveState();
  render();
  await refreshTabs();
}

async function renameSpace(space) {
  const nextName = await askText({
    title: 'Rename Space',
    label: 'Space name',
    value: space.name || 'Space',
    confirmText: 'Save',
  });
  if (nextName === null) return;
  const clean = nextName.trim();
  if (!clean) return;
  space.name = clean;
  space.icon = clean.slice(0, 1).toUpperCase();
  await saveState();
  render();
}

async function deleteSpace(space) {
  if (state.spaces.length <= 1) {
    setStatus('Keep at least one Space.');
    return;
  }
  const ok = await askConfirm({
    title: 'Delete Space',
    message: `Delete "${space.name}" and close every tab in it? This also removes saved tab groups for this Space.`,
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;

  await loadTabs({ adopt: true });
  const deletingActiveSpace = state.activeSpaceId === space.id;
  const fallback = fallbackSpaceAfterDelete(state.spaces, space.id);

  if (deletingActiveSpace && fallback) {
    await snapshotOpenSpace(space.id);
    activeView = 'space';
    state.activeSpaceId = fallback.id;
    await ensureSpaceOpenFromSnapshot(fallback.id, { active: true });
    await focusFirstTabInSpace(fallback.id, { force: true });
    await collapseGroupsInSpace(fallback.id);
    await discardInactiveTabsInSpace(fallback.id);
    await saveState();
  }

  await closeSpaceTabs(space.id, () => true);

  state.spaces = state.spaces.filter((item) => item.id !== space.id);
  removeSpaceReferences(state, space.id);
  activeView = 'space';
  if (state.activeSpaceId === space.id && fallback) state.activeSpaceId = fallback.id;

  await loadTabs({ adopt: false });
  if (state.activeSpaceId) {
    await ensureSpaceOpenFromSnapshot(state.activeSpaceId);
    await focusFirstTabInSpace(state.activeSpaceId, { force: true });
    await collapseGroupsInSpace(state.activeSpaceId);
    await discardInactiveTabsInSpace(state.activeSpaceId);
  }
  await closeTabsOutsideActiveSpace();
  await saveState();
  await refreshTabs();
  setStatus(`Deleted ${space.name}.`);
}

async function newTabInActiveSpace() {
  const created = await send('tabs:create', { url: 'chrome://newtab', active: true });
  const tabId = created.tab?.id;
  if (tabId) state.tabSpaces[tabId] = state.activeSpaceId;
  await closeEphemeralTabs();
  await saveState();
  await refreshTabs();
}

async function clearUngroupedTabs(group) {
  const closable = group.tabs.filter((tab) => !tab.dormant && shouldAutoCloseTab(tab));
  const dormantClosable = group.tabs.filter((tab) => tab.dormant && shouldAutoCloseTab(tab));
  if (closable.length === 0 && dormantClosable.length === 0) return;

  const closingIds = new Set(closable.map((tab) => tab.id));
  const remainingSpaceTabs = tabs.filter((tab) => (
    tabBelongsToSpace(tab, state.activeSpaceId) && !closingIds.has(tab.id)
  ));
  if (remainingSpaceTabs.length === 0) {
    const created = await send('tabs:create', { url: 'chrome://newtab', active: false });
    const tabId = created.tab?.id;
    if (tabId) {
      state.tabSpaces[tabId] = state.activeSpaceId;
    }
  }

  for (const tab of closable) {
    delete state.tabSpaces[tab.id];
    delete state.renamedTabs[tab.id];
    delete state.tabGroups?.[tab.id];
    forgetEphemeralTab(tab.id);
    await send('tabs:close', { tabId: tab.id });
  }
  if (dormantClosable.length > 0) removeTemporarySnapshotTabs(state.activeSpaceId);
  await saveState();
  await refreshTabs({ reloadDormant: dormantClosable.length > 0 });
  setStatus(`Cleared ${closable.length + dormantClosable.length} temporary tabs.`);
}

function handleTabClick(event, tab) {
  if (tab.dormant) {
    event.preventDefault();
    runTask(() => openDormantTab(tab, tab.dormantGroupKey));
    return;
  }
  const additive = event.metaKey || event.ctrlKey;
  const range = event.shiftKey;
  updateTabSelection(tab.id, { additive, range });
  if (additive || range) {
    event.preventDefault();
    render();
    return;
  }
  runTask(() => focusTab(tab));
}

async function focusTab(tab) {
  await send('tabs:focus', { tabId: tab.id });
  await refreshTabs();
}

async function renameTab(tab) {
  const nextName = await askText({
    title: 'Rename Tab',
    label: 'Panel title',
    value: tab.displayTitle || tab.title || '',
    confirmText: 'Save',
  });
  if (nextName === null) return;
  const clean = nextName.trim();
  if (clean) state.renamedTabs[tab.id] = clean;
  else delete state.renamedTabs[tab.id];
  await saveState();
  await refreshTabs();
}

async function duplicateTab(tab) {
  const sourceGroup = groupForTab(tab);
  const result = await send('tabs:duplicate', { tabId: tab.id });
  const duplicated = result.tab;
  if (!duplicated?.id) {
    setStatus('Could not duplicate tab.');
    return;
  }

  if (isGroupedTab(tab)) {
    if (Number(duplicated.groupId) !== Number(tab.groupId)) {
      await addTabsToChromeGroup(tab.groupId, [duplicated.id], state.activeSpaceId);
    } else {
      bindChromeGroup(duplicated.groupId, state.activeSpaceId);
      clearLocalTabGrouping([duplicated.id]);
    }
  } else {
    state.tabSpaces[duplicated.id] = state.activeSpaceId;
    const localGroupKey = state.tabGroups?.[tab.id] || (
      sourceGroup && isVirtualGroupKey(sourceGroup.key) ? sourceGroup.key : ''
    );
    if (localGroupKey) state.tabGroups[duplicated.id] = localGroupKey;
    else delete state.tabGroups?.[duplicated.id];
  }

  if (state.renamedTabs?.[tab.id]) {
    state.renamedTabs[duplicated.id] = state.renamedTabs[tab.id];
  }
  rememberDuplicatedTabOrder(tab, duplicated.id, sourceGroup);

  await saveState();
  await refreshTabs();
  setStatus('Duplicated tab.');
}

async function renameGroup(group) {
  const nextName = await askText({
    title: 'Rename Group',
    label: 'Group title',
    value: group.title || 'Group',
    confirmText: 'Save',
  });
  if (nextName === null) return;
  const clean = nextName.trim();
  if (!clean) return;

  if (group.dormant) {
    renameDormantSnapshotGroup(group, clean);
  } else if (group.id === 'ungrouped') {
    const tabIds = group.tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
    if (tabIds.length === 0) return;
    await createChromeGroup(tabIds, { title: clean, color: nextGroupColor() });
  } else if (isVirtualGroupKey(group.key)) {
    state.virtualGroups[group.key] = {
      ...(state.virtualGroups[group.key] || {}),
      id: group.key,
      title: clean,
      color: group.color || state.virtualGroups[group.key]?.color || 'blue',
      spaceId: state.activeSpaceId,
    };
  } else {
    await send('groups:update', { groupId: group.id, update: { title: clean } });
    bindChromeGroup(group.id, state.activeSpaceId);
  }

  await saveState();
  await refreshTabs();
}

async function renameFolderGroup(folderContext) {
  const groups = groupsForFolderContext(folderContext);
  if (groups.length === 0) return;

  const sourcePath = folderContext.path || [];
  const currentName = sourcePath.at(-1) || 'Group';
  const nextName = await askText({
    title: 'Rename Group',
    label: 'Group title',
    value: currentName,
    confirmText: 'Save',
  });
  if (nextName === null) return;
  const clean = nextName.trim();
  if (!clean) return;

  const replacements = new Map();
  const visibleKeys = spaceView.map((group) => group.key);
  for (const group of groups) {
    const title = renamedFolderGroupTitle(group, sourcePath, clean);
    const nextKey = await retitleGroupWithoutSaving(group, title);
    if (nextKey) replacements.set(group.key, nextKey);
  }
  replaceGroupOrderKeys(replacements, visibleKeys);

  await saveState();
  await refreshTabs();
  setStatus(`Renamed group "${currentName}" to "${clean}".`);
}

async function groupSelectedTabs(tabIds) {
  const ids = tabIds.map(Number).filter(Number.isFinite);
  if (ids.length === 0) {
    setStatus('Select a tab to group.');
    return;
  }

  await loadTabs({ adopt: true });
  const selectedTabs = ids
    .map((id) => tabs.find((tab) => tab.id === id))
    .filter((tab) => tab && tabBelongsToSpace(tab, state.activeSpaceId) && !tab.pinned);

  if (selectedTabs.length === 0) {
    setStatus('Select a tab in this Space to group.');
    return;
  }

  const groupId = await createChromeGroup(selectedTabs.map((tab) => tab.id), {
    title: selectedGroupTitle(selectedTabs),
    color: nextGroupColor(),
  });
  if (groupId === null) return;
  selectedTabIds = new Set(selectedTabs.map((tab) => tab.id));
  selectionAnchorTabId = selectedTabs.at(-1)?.id ?? null;
  await saveState();
  await refreshTabs();
  setStatus(`Grouped ${selectedTabs.length === 1 ? '1 tab' : `${selectedTabs.length} selected tabs`}.`);
}

async function closeTab(tab, groupKey = '') {
  const sourceGroup = groupKey
    ? spaceView.find((group) => group.key === groupKey)
    : spaceView.find((group) => (group.tabs || []).some((item) => Number(item.id) === Number(tab.id)));
  removeClosedTabFromSnapshot(tab, sourceGroup);
  removeTabFromSavedOrder(tab.id);
  delete state.tabSpaces[tab.id];
  delete state.renamedTabs[tab.id];
  delete state.tabGroups?.[tab.id];
  forgetEphemeralTab(tab.id);
  await saveState();
  await send('tabs:close', { tabId: tab.id });
  await refreshTabs({ reloadDormant: true });
}

async function removeDormantTab(tab, groupKey = '') {
  const dormantGroup = dormantSpaceView.find((group) => (
    group.key === groupKey || group.key === tab.dormantGroupKey
  ));
  removeOpenedDormantTabFromSnapshot(tab, dormantGroup);
  await saveState();
  await refreshTabs({ reloadDormant: true });
  setStatus('Removed saved tab.');
}

async function moveTabToSpace(tab, spaceId) {
  const sourceGroup = groupForTab(tab);
  const targetGroupKey = ensureMovedTabTargetGroup(tab, sourceGroup, spaceId);
  if (isGroupedTab(tab)) {
    await send('tabs:ungroup', { tabIds: [tab.id] });
  }
  state.tabSpaces[tab.id] = spaceId;
  state.tabGroups[tab.id] = targetGroupKey;
  removeTabFromSavedOrder(tab.id);
  const targetOrder = ensureTabOrderForSpace(spaceId);
  targetOrder[targetGroupKey] = uniqueKeys([...(targetOrder[targetGroupKey] || []), tab.id]);
  await saveState();
  await closeTabsOutsideActiveSpace();
  await refreshTabs();
  setStatus(`Moved tab to ${spaceName(spaceId)}.`);
}

function groupForTab(tab) {
  const tabId = Number(tab?.id);
  if (!Number.isFinite(tabId)) return null;
  return spaceView.find((group) => (
    !group.dormant &&
    (group.tabs || []).some((item) => Number(item.id) === tabId)
  )) || null;
}

function ensureMovedTabTargetGroup(tab, sourceGroup, spaceId) {
  const sourceTitle = sourceGroup?.key && sourceGroup.key !== 'ungrouped'
    ? sourceGroup.displayTitle || sourceGroup.title
    : '';
  const title = sourceTitle || titleForDomain(tab.domain || domainFromUrl(tab.url), tab.displayTitle || tab.title);
  const color = sourceGroup?.key && sourceGroup.key !== 'ungrouped'
    ? sourceGroup.color || nextGroupColor()
    : nextGroupColor();
  return ensureVirtualGroupForTitle(title || 'Tabs', color, spaceId);
}

async function moveGroupToSpace(group, spaceId) {
  if (group.dormant) {
    moveDormantSnapshotGroup(group, spaceId);
  } else if (group.id === 'ungrouped') {
    for (const tab of group.tabs) {
      state.tabSpaces[tab.id] = spaceId;
      delete state.tabGroups?.[tab.id];
    }
  } else if (isVirtualGroupKey(group.key)) {
    state.virtualGroups[group.key] = {
      ...(state.virtualGroups[group.key] || {}),
      id: group.key,
      title: group.title,
      color: group.color,
      spaceId,
    };
    for (const tab of group.tabs) state.tabSpaces[tab.id] = spaceId;
    state.groupOrder[state.activeSpaceId] = (state.groupOrder[state.activeSpaceId] || [])
      .filter((key) => key !== group.key);
    addGroupOrderKey(spaceId, group.key);
  } else {
    state.groupSpaces[group.id] = spaceId;
    addGroupOrderKey(spaceId, group.key);
    for (const tab of group.tabs) {
      delete state.tabSpaces[tab.id];
      delete state.tabGroups?.[tab.id];
    }
  }
  await saveState();
  await closeTabsOutsideActiveSpace();
  await refreshTabs();
  setStatus(`Moved group to ${spaceName(spaceId)}.`);
}

async function moveFolderGroupToSpace(folderContext, spaceId) {
  const groups = groupsForFolderContext(folderContext);
  if (groups.length === 0) return;
  moveGroupsWithoutSaving(groups, spaceId);
  await saveState();
  await closeTabsOutsideActiveSpace();
  await refreshTabs();
  setStatus(`Moved group to ${spaceName(spaceId)}.`);
}

async function deleteGroup(group) {
  if (!group || group.id === 'ungrouped') return;
  if (group.dormant) {
    deleteDormantSnapshotGroup(group);
    await saveState();
    await refreshTabs();
    setStatus(`Deleted saved group "${group.displayTitle || group.title}".`);
    return;
  }
  const deletedTabs = await deleteGroupsAndTabs([group]);
  await refreshTabs({ reloadDormant: true });
  setStatus(`Deleted group "${group.displayTitle || group.title}" and ${deletedTabs} tags.`);
}

async function deleteFolderGroup(folderContext) {
  const groups = groupsForFolderContext(folderContext);
  if (groups.length === 0) return;
  const deletedTabs = await deleteGroupsAndTabs(groups);
  await refreshTabs({ reloadDormant: true });
  setStatus(`Deleted group "${folderContext.path?.at(-1) || 'Group'}" and ${deletedTabs} tags.`);
}

function groupsForFolderContext(folderContext) {
  const seen = new Set();
  return (folderContext?.groupKeys || [])
    .map((key) => renderedGroupContexts.get(key))
    .filter((group) => {
      if (!group?.key || group.id === 'ungrouped' || seen.has(group.key)) return false;
      seen.add(group.key);
      return true;
    });
}

function renamedFolderGroupTitle(group, sourcePath, nextLeafTitle) {
  const currentPath = folderTitleParts(group.title);
  const source = sourcePath || [];
  const targetPath = [...source.slice(0, -1), nextLeafTitle];
  const suffix = pathStartsWith(currentPath, source)
    ? currentPath.slice(source.length)
    : currentPath.slice(-1);
  return uniqueAdjacentPathParts([...targetPath, ...suffix]).join(' / ');
}

function pathStartsWith(path, prefix) {
  if (!prefix?.length || path.length < prefix.length) return false;
  return prefix.every((part, index) => path[index] === part);
}

async function retitleGroupWithoutSaving(group, title) {
  if (!group || group.id === 'ungrouped') return '';
  if (group.dormant) {
    renameDormantSnapshotGroup(group, title);
    return group.key;
  }
  if (isVirtualGroupKey(group.key)) {
    state.virtualGroups[group.key] = {
      ...(state.virtualGroups[group.key] || {}),
      id: group.key,
      title,
      color: group.color || state.virtualGroups[group.key]?.color || 'blue',
      spaceId: state.activeSpaceId,
      collapsed: Boolean(state.collapsedGroups[group.key] ?? group.collapsed),
    };
    return group.key;
  }
  return retitleGroupForNestedMove(group, title);
}

function moveGroupsWithoutSaving(groups, spaceId) {
  moveDormantSnapshotGroupsToSpace(groups.filter((group) => group.dormant), spaceId);
  const removedKeys = new Set();
  for (const group of groups.filter((item) => !item.dormant)) {
    removedKeys.add(group.key);
    if (group.id === 'ungrouped') {
      for (const tab of group.tabs || []) {
        state.tabSpaces[tab.id] = spaceId;
        delete state.tabGroups?.[tab.id];
      }
    } else if (isVirtualGroupKey(group.key)) {
      state.virtualGroups[group.key] = {
        ...(state.virtualGroups[group.key] || {}),
        id: group.key,
        title: group.title,
        color: group.color,
        spaceId,
      };
      for (const tab of group.tabs || []) state.tabSpaces[tab.id] = spaceId;
      addGroupOrderKey(spaceId, group.key);
    } else {
      state.groupSpaces[group.id] = spaceId;
      addGroupOrderKey(spaceId, group.key);
      for (const tab of group.tabs || []) {
        delete state.tabSpaces[tab.id];
        delete state.tabGroups?.[tab.id];
      }
    }
  }
  state.groupOrder[state.activeSpaceId] = (state.groupOrder[state.activeSpaceId] || [])
    .filter((key) => !removedKeys.has(key));
}

function moveDormantSnapshotGroupsToSpace(groups, spaceId) {
  if (!groups.length) return;
  const snapshot = activeSpaceSnapshot();
  if (!snapshot) return;
  const records = snapshotGroupRecords(snapshot);
  const indexes = new Set(groups.map((group) => snapshotGroupIndexFromKey(group.key)).filter((index) => index >= 0));
  if (indexes.size === 0) return;

  const moving = records.filter((record) => indexes.has(record.index)).map((record) => record.group);
  const remaining = records.filter((record) => !indexes.has(record.index)).map((record) => record.group);
  replaceActiveSpaceSnapshotGroups(remaining);

  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') state.spaceSnapshots = {};
  const targetSnapshot = sanitizeSpaceSnapshot(state.spaceSnapshots[spaceId]) || {
    version: 1,
    updatedAt: Date.now(),
    groups: [],
  };
  targetSnapshot.groups = [...(targetSnapshot.groups || []), ...moving];
  targetSnapshot.updatedAt = Date.now();
  state.spaceSnapshots[spaceId] = targetSnapshot;
}

async function deleteGroupsAndTabs(groups) {
  const dormantTabCount = groups.reduce((count, group) => (
    count + (group?.tabs || []).filter((tab) => tab.dormant).length
  ), 0);
  const liveTabIds = uniqueKeys(groups
    .flatMap((group) => group?.tabs || [])
    .filter((tab) => !tab.dormant)
    .map((tab) => Number(tab.id))
    .filter(Number.isFinite));

  deleteDormantSnapshotGroups(groups.filter((group) => group.dormant));
  for (const group of groups.filter((item) => !item.dormant)) {
    deleteDormantSnapshotGroup(group);
  }

  if (liveTabIds.length > 0) await ensureActiveSpaceHasOpenTabAfterClosing(liveTabIds);

  const removedKeys = new Set();
  for (const group of groups.filter((item) => !item.dormant)) {
    if (!group || group.id === 'ungrouped') continue;
    removedKeys.add(group.key);
    if (isVirtualGroupKey(group.key)) delete state.virtualGroups?.[group.key];
    else delete state.groupSpaces[group.id];
    delete state.collapsedGroups[group.key];
    delete state.tabOrder[state.activeSpaceId]?.[group.key];
  }
  for (const tabId of liveTabIds) {
    removeTabFromSavedOrder(tabId);
    delete state.tabSpaces[tabId];
    delete state.renamedTabs[tabId];
    delete state.tabGroups?.[tabId];
    forgetEphemeralTab(tabId);
  }
  state.groupOrder[state.activeSpaceId] = (state.groupOrder[state.activeSpaceId] || [])
    .filter((key) => !removedKeys.has(key));

  await saveState();
  for (const tabId of liveTabIds) {
    await send('tabs:close', { tabId });
  }
  return liveTabIds.length + dormantTabCount;
}

async function ensureActiveSpaceHasOpenTabAfterClosing(tabIds = []) {
  const closingIds = new Set(tabIds.map(Number).filter(Number.isFinite));
  if (closingIds.size === 0 || !state.activeSpaceId) return;
  await loadTabs({ adopt: false });
  const remainingTabs = tabs.filter((tab) => (
    !closingIds.has(Number(tab.id)) &&
    !isEphemeralTab(tab) &&
    tabBelongsToSpace(tab, state.activeSpaceId)
  ));
  if (remainingTabs.length > 0) return;

  const created = await send('tabs:create', { url: 'chrome://newtab', active: true });
  const tabId = created.tab?.id;
  if (tabId) state.tabSpaces[tabId] = state.activeSpaceId;
  await loadTabs({ adopt: false });
}

function deleteDormantSnapshotGroups(groups) {
  if (!groups.length) return;
  const snapshot = activeSpaceSnapshot();
  if (!snapshot) return;
  const records = snapshotGroupRecords(snapshot);
  const indexes = new Set(groups.map((group) => snapshotGroupIndexFromKey(group.key)).filter((index) => index >= 0));
  if (indexes.size === 0) return;
  replaceActiveSpaceSnapshotGroups(records
    .filter((record) => !indexes.has(record.index))
    .map((record) => record.group));
}

function replaceGroupOrderKeys(replacements, fallbackOrder = []) {
  if (!replacements?.size) return;
  const order = fallbackOrder.length ? fallbackOrder : state.groupOrder[state.activeSpaceId] || [];
  state.groupOrder[state.activeSpaceId] = uniqueKeys(order.map((key) => replacements.get(key) || key));
}

async function openDormantTab(tab, groupKey) {
  const url = tab?.url || '';
  if (!url) return;
  const created = await send('tabs:create', { url, active: true });
  const tabId = created.tab?.id;
  if (!tabId) return;

  const dormantGroup = dormantSpaceView.find((group) => group.key === groupKey || group.key === tab.dormantGroupKey);
  if (!dormantGroup || isUngroupedSnapshotGroup(dormantGroup)) {
    state.tabSpaces[tabId] = state.activeSpaceId;
  } else {
    const existing = chromeGroupForTitle(dormantGroup.title, state.activeSpaceId);
    if (existing) {
      await addTabsToChromeGroup(existing.id, [tabId], state.activeSpaceId);
    } else {
      await createChromeGroup([tabId], {
        title: dormantGroup.title,
        color: dormantGroup.color,
        collapsed: false,
      });
    }
  }

  removeOpenedDormantTabFromSnapshot(tab, dormantGroup);
  rememberOpenedDormantTab(tab, dormantGroup, tabId);
  await closeEphemeralTabs();
  await saveState();
  await refreshTabs();
}

async function switchSpace(spaceId) {
  const previousSpaceId = state.activeSpaceId;
  await loadTabs({ adopt: false });
  await snapshotOpenSpace(previousSpaceId);

  activeView = 'space';

  const keepAliveTab = await ensureSwitchKeepAliveTab(spaceId, previousSpaceId);

  state.activeSpaceId = spaceId;
  await loadDormantSpaceView(spaceId, { force: true });
  await focusFirstTabInSpace(spaceId, {
    force: true,
    allowEphemeral: true,
    ephemeralTabId: keepAliveTab?.id,
  });
  await closeSpaceTabs(previousSpaceId, shouldAutoCloseTab);
  await closeEphemeralTabsExcept(keepAliveTab?.id);
  await closeTabsOutsideActiveSpace();
  await closeExtraFallbackTabs(keepAliveTab?.id);
  await focusFirstTabInSpace(spaceId, {
    force: true,
    allowEphemeral: true,
    ephemeralTabId: keepAliveTab?.id,
  });
  await collapseGroupsInSpace(spaceId);
  await discardInactiveTabsInSpace(spaceId);
  await saveState();
  await refreshTabs();
}

async function ensureSwitchKeepAliveTab(spaceId, previousSpaceId) {
  await loadTabs({ adopt: false });
  const existing = preferredFocusableTab(tabs.filter((tab) => !isEphemeralTab(tab) && tabBelongsToSpace(tab, spaceId)));
  if (existing) return existing;

  const reusable = reusableFallbackTab(previousSpaceId);
  if (reusable) {
    if (hasDormantContent(spaceId)) {
      delete state.tabSpaces[reusable.id];
      delete state.tabGroups?.[reusable.id];
      rememberEphemeralTab(reusable.id);
    } else {
      forgetEphemeralTab(reusable.id);
      state.tabSpaces[reusable.id] = spaceId;
      delete state.tabGroups?.[reusable.id];
    }
    await send('tabs:focus', { tabId: reusable.id });
    await loadTabs({ adopt: false });
    return tabs.find((tab) => Number(tab.id) === Number(reusable.id)) || reusable;
  }

  return ensureSpaceHasOpenTab(spaceId, { active: true });
}

function reusableFallbackTab(previousSpaceId) {
  return preferredFocusableTab(tabs.filter((tab) => (
    !tab.pinned &&
    tab.url === 'chrome://newtab' &&
    (isEphemeralTab(tab) || tabBelongsToSpace(tab, previousSpaceId))
  )));
}

async function closeExtraFallbackTabs(keepTabId) {
  await loadTabs({ adopt: false });
  const fallbackTabs = tabs.filter((tab) => !tab.pinned && tab.url === 'chrome://newtab');
  if (fallbackTabs.length <= 1) return;

  const keepId = Number(keepTabId);
  const keepTab = Number.isFinite(keepId)
    ? fallbackTabs.find((tab) => Number(tab.id) === keepId)
    : null;
  const keep = keepTab || preferredFocusableTab(fallbackTabs) || fallbackTabs[0];

  for (const tab of fallbackTabs) {
    if (Number(tab.id) === Number(keep.id)) continue;
    delete state.tabSpaces[tab.id];
    delete state.renamedTabs[tab.id];
    delete state.tabGroups?.[tab.id];
    forgetEphemeralTab(tab.id);
    await send('tabs:close', { tabId: tab.id });
  }
  await loadTabs({ adopt: false });
}

async function closeTabsOutsideActiveSpace() {
  await loadTabs({ adopt: false });
  await ensureActiveSpaceHasOpenTab();

  for (const space of state.spaces) {
    if (space.id === state.activeSpaceId) continue;
    await snapshotOpenSpace(space.id);
    await closeSpaceTabs(space.id, shouldAutoCloseTab, { reloadBeforeClose: false });
  }

  await loadTabs({ adopt: false });
  const unownedOrForeignTabs = closableTabsOutsideSpace(tabs, state, state.activeSpaceId, shouldAutoCloseTab);
  for (const tab of unownedOrForeignTabs) {
    if (isEphemeralTab(tab)) continue;
    delete state.tabSpaces[tab.id];
    delete state.renamedTabs[tab.id];
    delete state.tabGroups?.[tab.id];
    forgetEphemeralTab(tab.id);
    await send('tabs:close', { tabId: tab.id });
  }
  await loadTabs({ adopt: false });

  const activeSpaceTabs = tabs.filter((tab) => !isEphemeralTab(tab) && tabBelongsToSpace(tab, state.activeSpaceId));
  if (activeSpaceTabs.length && !activeSpaceTabs.some((tab) => tab.active)) {
    await send('tabs:focus', { tabId: preferredFocusableTab(activeSpaceTabs).id });
  }

  await saveState();
}

async function ensureActiveSpaceHasOpenTab() {
  if (!state.activeSpaceId) return;
  const activeSpaceTabs = tabs.filter((tab) => (
    isEphemeralTab(tab) || tabBelongsToSpace(tab, state.activeSpaceId)
  ));
  if (activeSpaceTabs.length > 0) return;
  await ensureSpaceHasOpenTab(state.activeSpaceId, { active: true });
  await loadTabs({ adopt: false });
}

async function closeSpaceTabs(spaceId, shouldClose, options = {}) {
  if (options.reloadBeforeClose !== false) await loadTabs({ adopt: false });
  const closableTabs = closableTabsForSpace(tabs, state, spaceId, shouldClose);
  for (const tab of closableTabs) {
    delete state.tabSpaces[tab.id];
    delete state.renamedTabs[tab.id];
    delete state.tabGroups?.[tab.id];
    forgetEphemeralTab(tab.id);
    await send('tabs:close', { tabId: tab.id });
  }
  await loadTabs({ adopt: false });
}

async function closeEphemeralTabs() {
  await loadTabs({ adopt: false });
  const ephemeralTabs = tabs.filter((tab) => isEphemeralTab(tab));
  for (const tab of ephemeralTabs) {
    forgetEphemeralTab(tab.id);
    await send('tabs:close', { tabId: tab.id });
  }
  if (ephemeralTabs.length) await loadTabs({ adopt: false });
}

async function closeEphemeralTabsExcept(keepTabId) {
  await loadTabs({ adopt: false });
  const keepId = Number(keepTabId);
  const ephemeralTabs = tabs.filter((tab) => (
    isEphemeralTab(tab) && Number(tab.id) !== keepId
  ));
  for (const tab of ephemeralTabs) {
    forgetEphemeralTab(tab.id);
    await send('tabs:close', { tabId: tab.id });
  }
  if (ephemeralTabs.length) await loadTabs({ adopt: false });
}

function snapshotOpenSpace(spaceId) {
  if (!spaceId) return;
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') state.spaceSnapshots = {};
  const view = buildSpaceViewForSpace(spaceId).filter((group) => group.key !== 'ungrouped');
  const liveSnapshot = buildSpaceSnapshot({ view });
  const storedSnapshot = dropTemporarySnapshotGroups(state.spaceSnapshots[spaceId]);
  const snapshot = mergeSpaceSnapshot(liveSnapshot, storedSnapshot);
  const previousSnapshot = state.spaceSnapshots[spaceId];
  if (snapshotTabCount(snapshot) === 0) {
    delete state.spaceSnapshots[spaceId];
    if (spaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
    return;
  }
  state.spaceSnapshots[spaceId] = snapshot;
  if (!sameSnapshotGroups(previousSnapshot, snapshot) && spaceId === dormantSpaceViewSpaceId) {
    dormantSpaceViewSpaceId = '';
  }
}

function sanitizeStoredSpaceSnapshots() {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') {
    state.spaceSnapshots = {};
    return;
  }
  for (const spaceId of Object.keys(state.spaceSnapshots)) {
    sanitizeStoredSpaceSnapshot(spaceId);
  }
}

function sanitizeStoredSpaceSnapshot(spaceId) {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') return null;
  const snapshot = sanitizeSpaceSnapshot(state.spaceSnapshots[spaceId]);
  if (snapshotTabCount(snapshot) === 0) {
    delete state.spaceSnapshots[spaceId];
    if (spaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
    return null;
  }
  state.spaceSnapshots[spaceId] = snapshot;
  return snapshot;
}

function removeTemporarySnapshotTabs(spaceId) {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') return;
  const snapshot = dropTemporarySnapshotGroups(state.spaceSnapshots?.[spaceId]);
  if (snapshotTabCount(snapshot) === 0) delete state.spaceSnapshots[spaceId];
  else state.spaceSnapshots[spaceId] = snapshot;
  if (spaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
}

function renameDormantSnapshotGroup(group, title) {
  updateDormantSnapshotGroup(group, (snapshotGroup) => ({
    ...snapshotGroup,
    title,
  }));
}

function deleteDormantSnapshotGroup(group) {
  updateDormantSnapshotGroup(group, () => null);
}

function moveDormantSnapshotGroup(group, spaceId) {
  let movingGroup = null;
  updateDormantSnapshotGroup(group, (snapshotGroup) => {
    movingGroup = snapshotGroup;
    return null;
  });
  if (!movingGroup) return;

  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') state.spaceSnapshots = {};
  const targetSnapshot = sanitizeSpaceSnapshot(state.spaceSnapshots[spaceId]) || {
    version: 1,
    updatedAt: Date.now(),
    groups: [],
  };
  targetSnapshot.groups = [...(targetSnapshot.groups || []), movingGroup];
  targetSnapshot.updatedAt = Date.now();
  state.spaceSnapshots[spaceId] = targetSnapshot;
}

function updateDormantSnapshotGroup(group, updater) {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') return;
  const snapshot = sanitizeSpaceSnapshot(state.spaceSnapshots[state.activeSpaceId]);
  if (!snapshot) return;
  const groupIndex = snapshotGroupIndexFromKey(group.key);
  let changed = false;
  const groups = [];

  for (let index = 0; index < (snapshot.groups || []).length; index += 1) {
    const snapshotGroup = snapshot.groups[index];
    const matches = index === groupIndex || (
      groupIndex < 0 &&
      snapshotGroup.title === group.title &&
      (snapshotGroup.color || 'grey') === (group.color || 'grey')
    );
    if (!matches) {
      groups.push(snapshotGroup);
      continue;
    }
    const nextGroup = updater({
      ...snapshotGroup,
      tabs: [...(snapshotGroup.tabs || [])],
    });
    if (nextGroup && (nextGroup.tabs || []).length > 0) groups.push(nextGroup);
    changed = true;
  }

  if (!changed) return;
  const nextSnapshot = {
    ...snapshot,
    updatedAt: Date.now(),
    groups,
  };
  if (snapshotTabCount(nextSnapshot) === 0) delete state.spaceSnapshots[state.activeSpaceId];
  else state.spaceSnapshots[state.activeSpaceId] = nextSnapshot;
  dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
}

function snapshotGroupIndexFromKey(key) {
  const match = String(key || '').match(/^snapshot:(\d+):/);
  return match ? Number(match[1]) : -1;
}

function snapshotGroupKey(index, group = {}) {
  return `snapshot:${index}:${group.title || 'Ungrouped'}`;
}

function removeOpenedDormantTabFromSnapshot(tab, dormantGroup) {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') return;
  const snapshot = removeSnapshotTab(state.spaceSnapshots[state.activeSpaceId], {
    url: tab?.url,
    groupTitle: dormantGroup?.title,
    groupColor: dormantGroup?.color,
  });
  if (snapshotTabCount(snapshot) === 0) delete state.spaceSnapshots[state.activeSpaceId];
  else state.spaceSnapshots[state.activeSpaceId] = snapshot;
  if (state.activeSpaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
}

function removeTabsFromSpaceSnapshot(spaceId, snapshotTabs) {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') return;
  const snapshot = removeSnapshotTabs(state.spaceSnapshots[spaceId], snapshotTabs);
  if (!snapshot) return;
  if (snapshotTabCount(snapshot) === 0) delete state.spaceSnapshots[spaceId];
  else state.spaceSnapshots[spaceId] = {
    ...snapshot,
    updatedAt: Date.now(),
  };
  if (spaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
}

function sameSnapshotGroups(left, right) {
  return JSON.stringify(left?.groups || []) === JSON.stringify(right?.groups || []);
}

function hasDormantContent(spaceId) {
  return snapshotTabCount(dropTemporarySnapshotGroups(state.spaceSnapshots?.[spaceId])) > 0;
}

async function ensureSpaceHasOpenTab(spaceId, options = {}) {
  await loadTabs({ adopt: false });
  const existing = preferredFocusableTab(tabs.filter((tab) => !isEphemeralTab(tab) && tabBelongsToSpace(tab, spaceId)));
  if (existing) return existing;
  const created = await send('tabs:create', { url: 'chrome://newtab', active: options.active !== false });
  const tabId = created.tab?.id;
  if (tabId) {
    if (hasDormantContent(spaceId)) rememberEphemeralTab(tabId);
    else state.tabSpaces[tabId] = spaceId;
  }
  await loadTabs({ adopt: false });
  return created.tab || null;
}

async function ensureSpaceOpenFromSnapshot(spaceId, options = {}) {
  await loadDormantSpaceView(spaceId, { force: true });
  await ensureSpaceHasOpenTab(spaceId, options);
  await collapseGroupsInSpace(spaceId);
}

async function collapseGroupsInSpace(spaceId) {
  await loadTabs({ adopt: false });
  const view = buildSpaceViewForSpace(spaceId).filter((group) => group.key !== 'ungrouped');
  for (const group of view) {
    state.collapsedGroups[group.key] = true;
    const groupId = groupIdFromKey(group.key);
    if (!group.dormant && groupId !== null) {
      await send('groups:update', { groupId, update: { collapsed: true } });
    }
  }
}

async function discardRestoredTabs(tabIds = []) {
  for (const tabId of tabIds) {
    try {
      await send('tabs:discard', { tabId });
    } catch {
      // Some URLs or Chrome states cannot be discarded; keep restore best-effort.
    }
  }
}

async function discardInactiveTabsInSpace(spaceId) {
  await loadTabs({ adopt: false });
  const discardableTabIds = tabs
    .filter((tab) => tabBelongsToSpace(tab, spaceId) && !tab.active && !tab.pinned)
    .map((tab) => tab.id);
  await discardRestoredTabs(discardableTabIds);
  if (discardableTabIds.length) await loadTabs({ adopt: false });
}

async function focusFirstTabInSpace(spaceId, options = {}) {
  await loadTabs({ adopt: false });
  const spaceTabs = tabs.filter((tab) => tabBelongsToSpace(tab, spaceId));
  const preferredEphemeral = tabs.find((tab) => (
    options.allowEphemeral &&
    Number.isFinite(Number(options.ephemeralTabId)) &&
    Number(tab.id) === Number(options.ephemeralTabId) &&
    isEphemeralTab(tab)
  ));
  const target = preferredFocusableTab(spaceTabs) ||
    preferredEphemeral ||
    (options.allowEphemeral ? preferredFocusableTab(tabs.filter(isEphemeralTab)) : null);
  if (target && (options.force || !target.active)) await send('tabs:focus', { tabId: target.id });
}

async function toggleGroup(group) {
  const nextCollapsed = !group.collapsed;
  state.collapsedGroups[group.key] = nextCollapsed;
  if (isVirtualGroupKey(group.key) && state.virtualGroups?.[group.key]) {
    state.virtualGroups[group.key].collapsed = nextCollapsed;
  } else {
    const groupId = groupIdFromKey(group.key);
    if (!group.dormant && groupId !== null) {
      await send('groups:update', { groupId, update: { collapsed: nextCollapsed } });
    }
  }
  await saveState();
  await refreshTabs();
}

function handleFolderHeaderClick(event, folder) {
  if (shouldSuppressHeaderClickAfterDrag(event)) return;
  runTask(() => toggleFolder(folder.key));
}

function handleGroupHeaderClick(event, group) {
  if (shouldSuppressHeaderClickAfterDrag(event)) return;
  runTask(() => toggleGroup(group));
}

function shouldSuppressHeaderClickAfterDrag(event) {
  if (Date.now() - lastGroupDragEndedAt > 350) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function startGroupDrag(event, group) {
  if (isInteractiveDragTarget(event.target)) return;
  const context = dragContextForTarget(group);
  if (!context?.groupKeys?.length) return;
  dragState = { type: 'group', key: context.key, groupKeys: context.groupKeys, sourceContext: context };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', context.key);
}

function startFolderDrag(event, folder) {
  if (isInteractiveDragTarget(event.target)) return;
  const context = dragContextForTarget(folder);
  if (!context?.groupKeys?.length) return;
  dragState = { type: 'group', key: context.key, groupKeys: context.groupKeys, sourceContext: context };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', context.key);
}

function acceptGroupDrop(event, target) {
  const targetContext = dragContextForTarget(target);
  if (!canDropGroupContext(targetContext)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('drag-over');
}

function acceptGroupOrTabDrop(event, targetGroup) {
  if (dragState?.type === 'tab') {
    acceptTabDrop(event);
    return;
  }
  acceptGroupDrop(event, targetGroup);
}

function acceptFolderDrop(event, folder) {
  if (dragState?.type === 'tab') {
    acceptTabDrop(event);
    return;
  }
  acceptGroupDrop(event, folder);
}

function dropGroup(event, target) {
  const targetContext = dragContextForTarget(target);
  if (!canDropGroupContext(targetContext)) return;
  const sourceKeys = [...dragState.groupKeys];
  const intent = groupDropIntent(event);
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
  runTask(() => (
    intent === 'inside'
      ? moveGroupBlockIntoContext(sourceKeys, targetContext)
      : moveGroupBlockBesideContext(sourceKeys, targetContext, intent)
  ));
}

function dropGroupOrTab(event, targetGroup) {
  if (dragState?.type === 'tab') {
    dropTabAtEnd(event, targetGroup);
    return;
  }
  dropGroup(event, targetGroup);
}

function dropFolder(event, folder) {
  if (dragState?.type === 'tab') {
    dropTabAtEnd(event, groupForFolderTabDrop(folder));
    return;
  }
  dropGroup(event, folder);
}

function groupDropIntent(event) {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const header = target?.closest?.('.group-header, .folder-header');
  const dropElement = header && event.currentTarget?.contains?.(header) ? header : event.currentTarget;
  const rect = dropElement?.getBoundingClientRect?.();
  if (!rect?.height) return 'inside';
  const ratio = (event.clientY - rect.top) / rect.height;
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'inside';
}

function canDropGroupContext(targetContext) {
  if (dragState?.type !== 'group' || !targetContext?.groupKeys?.length) return false;
  const sourceKeySet = new Set(dragState.groupKeys);
  return targetContext.groupKeys.some((key) => !sourceKeySet.has(key));
}

function dragContextForTarget(target) {
  const key = typeof target === 'string' ? target : target?.key;
  return key ? renderedGroupDragContexts.get(key) : null;
}

function isInteractiveDragTarget(target) {
  const element = target instanceof Element ? target : target?.parentElement;
  return Boolean(element?.closest?.('.tab-row, button:not(.folder-header), .group-actions'));
}

async function moveGroupBlockIntoContext(sourceKeys, targetContext) {
  const targetPath = targetContext?.path || [];
  if (!targetPath.length) return;

  const sourceContext = dragState?.sourceContext || dragContextForTarget(dragState?.key);
  const visibleKeys = spaceView.map((group) => group.key);
  const sourceBlock = sourceKeys.filter((key) => visibleKeys.includes(key));
  if (sourceBlock.length === 0) return;

  const nextKeys = [];
  const dormantMoves = [];
  for (const sourceKey of sourceBlock) {
    const group = spaceView.find((item) => item.key === sourceKey);
    if (!group) continue;
    const nextTitle = groupTitleForNestedMove(group, sourceContext, targetPath);
    if (!nextTitle) continue;
    if (group.dormant) {
      dormantMoves.push({ key: group.key, title: nextTitle });
      nextKeys.push(group.key);
    } else {
      nextKeys.push(await retitleGroupForNestedMove(group, nextTitle));
    }
  }
  if (nextKeys.length === 0) return;

  state.groupOrder[state.activeSpaceId] = groupOrderAfterNestedMove(visibleKeys, sourceKeys, targetContext, nextKeys);
  if (dormantMoves.length) moveDormantSnapshotGroupsToOrder(dormantMoves, state.groupOrder[state.activeSpaceId]);
  else reorderDormantSnapshotGroups(state.groupOrder[state.activeSpaceId]);

  await saveState();
  await refreshTabs();
}

async function moveGroupBlockBesideContext(sourceKeys, targetContext, placement = 'before') {
  const targetPath = targetPathForSiblingMove(targetContext);
  const sourceContext = dragState?.sourceContext || dragContextForTarget(dragState?.key);
  const visibleKeys = spaceView.map((group) => group.key);
  const sourceBlock = sourceKeys.filter((key) => visibleKeys.includes(key));
  if (sourceBlock.length === 0) return;

  const nextKeys = [];
  const dormantMoves = [];
  for (const sourceKey of sourceBlock) {
    const group = spaceView.find((item) => item.key === sourceKey);
    if (!group) continue;
    const nextTitle = groupTitleForNestedMove(group, sourceContext, targetPath);
    if (!nextTitle) continue;
    if (group.dormant) {
      dormantMoves.push({ key: group.key, title: nextTitle });
      nextKeys.push(group.key);
    } else {
      nextKeys.push(await retitleGroupForNestedMove(group, nextTitle));
    }
  }
  if (nextKeys.length === 0) return;

  state.groupOrder[state.activeSpaceId] = groupOrderAfterSiblingMove(
    visibleKeys,
    sourceKeys,
    targetContext,
    nextKeys,
    placement,
  );
  if (dormantMoves.length) moveDormantSnapshotGroupsToOrder(dormantMoves, state.groupOrder[state.activeSpaceId]);
  else reorderDormantSnapshotGroups(state.groupOrder[state.activeSpaceId]);

  await saveState();
  await refreshTabs();
}

function targetPathForSiblingMove(targetContext) {
  return Array.isArray(targetContext?.path) ? targetContext.path.slice(0, -1) : [];
}

function groupTitleForNestedMove(group, sourceContext, targetPath) {
  return movedGroupTitleForFolderDrop(
    group.title || group.displayTitle || 'Group',
    sourceContext,
    targetPath,
  );
}

async function retitleGroupForNestedMove(group, title) {
  if (isVirtualGroupKey(group.key)) {
    state.virtualGroups[group.key] = {
      ...(state.virtualGroups[group.key] || {}),
      id: group.key,
      title,
      color: group.color || state.virtualGroups[group.key]?.color || 'blue',
      spaceId: state.activeSpaceId,
      collapsed: Boolean(state.collapsedGroups[group.key] ?? group.collapsed),
    };
    return group.key;
  }

  const groupId = groupIdFromKey(group.key);
  if (groupId !== null) {
    await send('groups:update', { groupId, update: { title } });
    bindChromeGroup(groupId, state.activeSpaceId);
    return group.key;
  }

  const groupKey = createVirtualGroup({ title, color: group.color || nextGroupColor() });
  state.collapsedGroups[groupKey] = Boolean(state.collapsedGroups[group.key] ?? group.collapsed);
  for (const tab of group.tabs || []) {
    state.tabSpaces[tab.id] = state.activeSpaceId;
    state.tabGroups[tab.id] = groupKey;
  }
  return groupKey;
}

function reorderDormantSnapshotGroups(orderedKeys) {
  const snapshot = activeSpaceSnapshot();
  if (!snapshot) return;
  const records = snapshotGroupRecords(snapshot);
  const orderedIndexes = orderedKeys
    .map(snapshotGroupIndexFromKey)
    .filter((index) => index >= 0 && index < records.length);
  if (orderedIndexes.length === 0) return;

  const seen = new Set();
  const groups = [];
  for (const index of orderedIndexes) {
    if (seen.has(index)) continue;
    groups.push(records[index].group);
    seen.add(index);
  }
  for (const record of records) {
    if (!seen.has(record.index)) groups.push(record.group);
  }
  replaceActiveSpaceSnapshotGroups(groups);
}

function moveDormantSnapshotGroupsToOrder(moves, orderedKeys) {
  const snapshot = activeSpaceSnapshot();
  if (!snapshot) return;
  const records = snapshotGroupRecords(snapshot);
  const moveByIndex = new Map();
  for (const move of moves) {
    const index = snapshotGroupIndexFromKey(move.key);
    if (index >= 0 && index < records.length) moveByIndex.set(index, move);
  }
  if (moveByIndex.size === 0) return;

  const updated = records.map((record) => {
    const move = moveByIndex.get(record.index);
    if (!move) return record;
    return {
      ...record,
      group: {
        ...record.group,
        title: move.title,
      },
    };
  });
  const recordByKey = new Map(updated.map((record) => [record.key, record]));
  const seen = new Set();
  const groups = [];
  for (const key of orderedKeys || []) {
    const record = recordByKey.get(key);
    if (!record || seen.has(record.index)) continue;
    groups.push(record.group);
    seen.add(record.index);
  }
  for (const record of updated) {
    if (seen.has(record.index)) continue;
    groups.push(record.group);
  }
  replaceActiveSpaceSnapshotGroups(groups);
}

function activeSpaceSnapshot() {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') return null;
  return sanitizeSpaceSnapshot(state.spaceSnapshots[state.activeSpaceId]);
}

function snapshotGroupRecords(snapshot) {
  return (snapshot?.groups || []).map((group, index) => ({
    index,
    key: snapshotGroupKey(index, group),
    group: {
      ...group,
      tabs: [...(group.tabs || [])],
    },
  }));
}

function replaceActiveSpaceSnapshotGroups(groups) {
  const snapshot = activeSpaceSnapshot();
  if (!snapshot) return;
  const nextSnapshot = {
    ...snapshot,
    updatedAt: Date.now(),
    groups: groups.filter((group) => (group.tabs || []).length > 0),
  };
  if (snapshotTabCount(nextSnapshot) === 0) delete state.spaceSnapshots[state.activeSpaceId];
  else state.spaceSnapshots[state.activeSpaceId] = nextSnapshot;
  dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
}

function groupOrderAfterNestedMove(visibleKeys, sourceKeys, targetContext, nextKeys) {
  const sourceKeySet = new Set(sourceKeys);
  const nextKeySet = new Set(nextKeys);
  const base = visibleKeys.filter((key) => !sourceKeySet.has(key) && !nextKeySet.has(key));
  const targetKeys = (targetContext.groupKeys || []).filter((key) => !sourceKeySet.has(key) && base.includes(key));
  const targetIndex = targetKeys.length ? base.indexOf(targetKeys.at(-1)) + 1 : base.length;
  base.splice(targetIndex, 0, ...uniqueKeys(nextKeys));
  return base;
}

function groupOrderAfterSiblingMove(visibleKeys, sourceKeys, targetContext, nextKeys, placement = 'before') {
  const sourceKeySet = new Set(sourceKeys);
  const nextKeySet = new Set(nextKeys);
  const base = visibleKeys.filter((key) => !sourceKeySet.has(key) && !nextKeySet.has(key));
  const targetKeys = (targetContext?.groupKeys || [])
    .filter((key) => !sourceKeySet.has(key) && base.includes(key));
  const targetKey = placement === 'after' ? targetKeys.at(-1) : targetKeys[0];
  if (!targetKey) return visibleKeys;
  const targetIndex = base.indexOf(targetKey);
  const insertAt = placement === 'after' ? targetIndex + 1 : targetIndex;
  base.splice(insertAt, 0, ...uniqueKeys(nextKeys));
  return base;
}

function startTabDrag(event, tab, groupKey) {
  event.stopPropagation();
  dragState = { type: 'tab', tabId: tab.id, groupKey };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(tab.id));
}

function acceptTabDrop(event) {
  if (dragState?.type !== 'tab') return;
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
}

function dropTabBefore(event, targetTab, targetGroupKey) {
  if (dragState?.type !== 'tab') return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
  runTask(() => reorderTab(dragState.tabId, targetGroupKey, targetTab.id));
}

function dropTabAtEnd(event, targetGroup) {
  const targetRow = event.target.closest('.tab-row');
  if (dragState?.type !== 'tab' || (targetRow && !targetRow.classList.contains('dormant'))) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
  runTask(() => reorderTab(dragState.tabId, targetGroup.key, null, { targetGroup }));
}

async function reorderTab(tabId, targetGroupKey, beforeTabId, options = {}) {
  const numericTabId = Number(tabId);
  const tab = tabs.find((item) => item.id === numericTabId);
  const sourceGroup = spaceView.find((group) => liveTabsForOrdering(group).some((item) => item.id === numericTabId));
  const targetGroup = options.targetGroup || spaceView.find((group) => group.key === targetGroupKey);
  if (!tab || !sourceGroup || !targetGroup) return;

  let targetOrderKey = targetGroupKey;
  if (targetGroupKey === 'ungrouped') {
    if (isGroupedTab(tab)) await send('tabs:ungroup', { tabIds: [tab.id] });
    state.tabSpaces[tab.id] = state.activeSpaceId;
    delete state.tabGroups?.[tab.id];
  } else {
    const groupId = await ensureTabDropChromeGroup(targetGroup, tab.id);
    if (groupId === null) return;
    if (Number(tab.groupId) !== Number(groupId)) {
      await addTabsToChromeGroup(groupId, [tab.id], state.activeSpaceId);
    } else {
      bindChromeGroup(groupId, state.activeSpaceId);
      clearLocalTabGrouping([tab.id]);
    }
    targetOrderKey = `group:${groupId}`;
  }
  removeDormantSnapshotTabsForOpenTabs([tab]);

  const spaceTabOrder = ensureTabOrderForSpace(state.activeSpaceId);
  if (sourceGroup.key !== targetOrderKey) {
    const sourceIds = liveTabsForOrdering(sourceGroup).map((item) => item.id);
    spaceTabOrder[sourceGroup.key] = (spaceTabOrder[sourceGroup.key] || sourceIds)
      .filter((id) => id !== tab.id);
  }

  const targetIds = liveTabsForOrdering(targetGroup).map((item) => item.id).filter((id) => id !== tab.id);
  const numericBeforeTabId = Number(beforeTabId);
  const insertAt = Number.isFinite(numericBeforeTabId) ? Math.max(0, targetIds.indexOf(numericBeforeTabId)) : targetIds.length;
  targetIds.splice(insertAt, 0, tab.id);
  spaceTabOrder[targetOrderKey] = targetIds;

  const targetIndex = Number.isFinite(numericBeforeTabId)
    ? tabs.find((item) => item.id === numericBeforeTabId)?.index
    : tabInsertionIndexAtEndOfGroup(targetGroup);
  if (Number.isFinite(targetIndex)) {
    await send('tabs:move', { tabId: tab.id, index: targetIndex });
  }

  await saveState();
  await refreshTabs({ reloadDormant: true });
}

async function ensureTabDropChromeGroup(targetGroup, tabId) {
  if (targetGroup.key === 'ungrouped') return null;

  const existingGroupId = groupIdFromKey(targetGroup.key);
  if (existingGroupId !== null) {
    bindChromeGroup(existingGroupId, state.activeSpaceId);
    return existingGroupId;
  }

  const tabIds = uniqueNumberIds([
    ...liveTabsForOrdering(targetGroup).map((item) => item.id),
    tabId,
  ]);
  return createChromeGroup(tabIds, {
    title: targetGroup.title || targetGroup.displayTitle || 'Group',
    color: targetGroup.color || nextGroupColor(),
    collapsed: Boolean(targetGroup.collapsed),
    sourceKey: targetGroup.key,
  });
}

function groupForFolderTabDrop(folder) {
  const title = (folder?.path || []).join(' / ');
  const existing = spaceView.find((group) => (
    group.key !== 'ungrouped' &&
    folderTitleParts(group.title).join(' / ') === title
  ));
  if (existing) return existing;
  return {
    id: `folder-drop:${folder?.key || title}`,
    key: `folder-drop:${folder?.key || title}`,
    title: title || folder?.title || 'Group',
    displayTitle: folder?.title || title || 'Group',
    color: 'blue',
    collapsed: false,
    dormant: false,
    tabs: [],
  };
}

function liveTabsForOrdering(group) {
  return (group?.tabs || []).filter((tab) => (
    !tab.dormant && Number.isFinite(Number(tab.id))
  ));
}

function removeDormantSnapshotTabsForOpenTabs(openTabs) {
  const snapshot = sanitizeSpaceSnapshot(state.spaceSnapshots?.[state.activeSpaceId]);
  if (!snapshot) return;
  const openUrls = new Set(openTabs
    .map((tab) => comparableSnapshotUrl(tab.url))
    .filter(Boolean));
  if (openUrls.size === 0) return;

  let changed = false;
  const groups = [];
  for (const group of snapshot.groups || []) {
    const remainingTabs = (group.tabs || []).filter((tab) => {
      const remove = openUrls.has(comparableSnapshotUrl(tab.url));
      if (remove) changed = true;
      return !remove;
    });
    if (remainingTabs.length > 0) groups.push({ ...group, tabs: remainingTabs });
  }
  if (!changed) return;

  const nextSnapshot = {
    ...snapshot,
    updatedAt: Date.now(),
    groups,
  };
  if (snapshotTabCount(nextSnapshot) === 0) delete state.spaceSnapshots[state.activeSpaceId];
  else state.spaceSnapshots[state.activeSpaceId] = nextSnapshot;
  dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
}

function removeClosedTabFromSnapshot(tab, sourceGroup) {
  const snapshot = sanitizeSpaceSnapshot(state.spaceSnapshots?.[state.activeSpaceId]);
  if (!snapshot) return;
  const target = snapshotRemovalTargetForClosedTab(tab, sourceGroup);
  if (target.urlKeys.length === 0 && target.titleDomainPairs.length === 0) return;

  let result = removeSnapshotTabsForTarget(snapshot, target, { requireGroup: true });
  if (!result.changed && target.groupKey) {
    result = removeSnapshotTabsForTarget(snapshot, target, { requireGroup: false });
  }
  if (!result.changed) return;

  const nextSnapshot = {
    ...snapshot,
    updatedAt: Date.now(),
    groups: result.groups,
  };
  if (snapshotTabCount(nextSnapshot) === 0) delete state.spaceSnapshots[state.activeSpaceId];
  else state.spaceSnapshots[state.activeSpaceId] = nextSnapshot;
  dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
  forgetRecentlyOpenedDormantTab(tab.id);
}

function snapshotRemovalTargetForClosedTab(tab, sourceGroup) {
  pruneRecentlyOpenedDormantTabs();
  const tabId = Number(tab?.id);
  const recentlyOpenedMatches = recentlyOpenedDormantTabs.filter((item) => (
    Number.isFinite(tabId) && Number(item.tabId) === tabId
  ));
  const urlKeys = uniqueKeys([
    comparableSnapshotUrl(tab?.url),
    ...recentlyOpenedMatches.map((item) => item.urlKey),
  ]);
  const titleDomainPairs = uniqueTitleDomainPairs([
    {
      titleKey: tabTitleMatchKey(tab),
      domain: domainFromUrl(tab?.url),
    },
    ...recentlyOpenedMatches.map((item) => ({
      titleKey: item.titleKey,
      domain: item.domain,
    })),
  ]);
  return {
    urlKeys,
    titleDomainPairs,
    groupKey: groupTitleKey(sourceGroup?.title || ''),
  };
}

function removeSnapshotTabsForTarget(snapshot, target, options = {}) {
  const remainingUrlMatches = new Map(target.urlKeys.map((key) => [key, 1]));
  let fallbackRemoved = false;
  let changed = false;
  const groups = [];

  for (const group of snapshot.groups || []) {
    const groupMatches = !options.requireGroup ||
      !target.groupKey ||
      groupTitleKey(group.title) === target.groupKey;
    if (!groupMatches) {
      groups.push(group);
      continue;
    }

    const tabs = [];
    for (const snapshotTab of group.tabs || []) {
      const snapshotUrlKey = comparableSnapshotUrl(snapshotTab.url);
      const remainingUrlCount = remainingUrlMatches.get(snapshotUrlKey) || 0;
      if (snapshotUrlKey && remainingUrlCount > 0) {
        remainingUrlMatches.set(snapshotUrlKey, remainingUrlCount - 1);
        changed = true;
        continue;
      }

      if (!fallbackRemoved && snapshotTabMatchesTitleDomain(snapshotTab, target.titleDomainPairs)) {
        fallbackRemoved = true;
        changed = true;
        continue;
      }

      tabs.push(snapshotTab);
    }
    if (tabs.length > 0) groups.push({ ...group, tabs });
  }

  return { changed, groups };
}

function snapshotTabMatchesTitleDomain(tab, pairs) {
  const titleKey = tabTitleMatchKey(tab);
  const domain = domainFromUrl(tab?.url);
  return (pairs || []).some((pair) => (
    pair.titleKey &&
    pair.domain &&
    pair.domain !== 'unknown' &&
    pair.titleKey === titleKey &&
    pair.domain === domain
  ));
}

function uniqueTitleDomainPairs(pairs) {
  const seen = new Set();
  const unique = [];
  for (const pair of pairs || []) {
    if (!pair?.titleKey || !pair?.domain || pair.domain === 'unknown') continue;
    const key = `${pair.titleKey}\n${pair.domain}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ titleKey: pair.titleKey, domain: pair.domain });
  }
  return unique;
}

function rememberOpenedDormantTab(tab, dormantGroup, tabId) {
  const urlKey = comparableSnapshotUrl(tab?.url);
  const groupKey = groupTitleKey(dormantGroup?.title || '');
  if (!urlKey || !groupKey) return;
  pruneRecentlyOpenedDormantTabs();
  recentlyOpenedDormantTabs.push({
    urlKey,
    titleKey: tabTitleMatchKey(tab),
    domain: domainFromUrl(tab?.url),
    groupKey,
    tabId: Number.isFinite(Number(tabId)) ? Number(tabId) : null,
    openedAt: Date.now(),
  });
}

function isDormantTabAlreadyOpen(dormantTab, dormantGroup, liveTabs, openUrls) {
  const urlKey = comparableSnapshotUrl(dormantTab?.url);
  if (urlKey && openUrls.has(urlKey)) return true;

  const opened = recentlyOpenedDormantRecordForTab(dormantTab, dormantGroup);
  if (!opened) return false;
  return (liveTabs || []).some((liveTab) => liveTabMatchesOpenedDormantRecord(liveTab, opened));
}

function recentlyOpenedDormantRecordForTab(tab, dormantGroup) {
  pruneRecentlyOpenedDormantTabs();
  const urlKey = comparableSnapshotUrl(tab?.url);
  const titleKey = tabTitleMatchKey(tab);
  const domain = domainFromUrl(tab?.url);
  const groupKey = groupTitleKey(dormantGroup?.title || '');
  return recentlyOpenedDormantTabs.find((opened) => (
    opened.groupKey === groupKey &&
    (
      (urlKey && opened.urlKey === urlKey) ||
      (titleKey && opened.titleKey === titleKey && opened.domain === domain)
    )
  )) || null;
}

function liveTabMatchesOpenedDormantRecord(tab, opened) {
  if (Number.isFinite(Number(opened.tabId)) && Number(tab?.id) === Number(opened.tabId)) return true;
  const urlKey = comparableSnapshotUrl(tab?.url);
  if (urlKey && opened.urlKey === urlKey) return true;
  return Boolean(
    opened.titleKey &&
    opened.domain &&
    tabTitleMatchKey(tab) === opened.titleKey &&
    domainFromUrl(tab?.url) === opened.domain
  );
}

function pruneRecentlyOpenedDormantTabs() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  recentlyOpenedDormantTabs = recentlyOpenedDormantTabs.filter((item) => Number(item.openedAt) >= cutoff);
}

function forgetRecentlyOpenedDormantTab(tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id)) return;
  recentlyOpenedDormantTabs = recentlyOpenedDormantTabs.filter((item) => Number(item.tabId) !== id);
}

function tabTitleMatchKey(tab) {
  return groupTitleKey(tab?.displayTitle || tab?.title || tab?.url || '');
}

function clearDragState(event) {
  event?.currentTarget?.classList?.remove('drag-over');
  if (dragState?.type === 'group') lastGroupDragEndedAt = Date.now();
  dragState = null;
  document.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
}

async function tidyTabNames() {
  const visibleTabs = spaceView.flatMap((group) => group.tabs);
  if (visibleTabs.length === 0) {
    setStatus('No tabs in this Space to rename.');
    return;
  }

  beginPanelAction('tidyNames');
  try {
    const duplicateTabIds = planDuplicateUrlClosures(visibleTabs);
    const duplicateTabIdSet = new Set(duplicateTabIds);
    for (const tabId of duplicateTabIds) {
      delete state.tabSpaces[tabId];
      delete state.renamedTabs[tabId];
      delete state.tabGroups?.[tabId];
      forgetEphemeralTab(tabId);
      await send('tabs:close', { tabId });
    }

    const remainingTabs = visibleTabs.filter((tab) => !duplicateTabIdSet.has(Number(tab.id)));
    const tabsWithContext = await addTidyContext(remainingTabs);
    Object.assign(state.renamedTabs, planTidyTabNames(tabsWithContext));
    await saveState();
    await refreshTabs();
    const duplicateText = duplicateTabIds.length ? ` Removed ${duplicateTabIds.length} duplicate tabs.` : '';
    setStatus(`Renamed ${remainingTabs.length} tabs in the panel only.${duplicateText}`);
  } finally {
    endPanelAction();
  }
}

async function autoGroupTabs() {
  await loadTabs({ adopt: true });
  const candidates = tabs.filter((tab) => (
    state.tabSpaces[tab.id] === state.activeSpaceId &&
    !isGroupedTab(tab) &&
    !tab.url.startsWith('chrome://')
  ));
  const duplicateGroupCount = countDuplicateActiveGroups();
  if (candidates.length === 0 && duplicateGroupCount === 0) {
    setStatus('No ungrouped tabs in this Space to auto group.');
    return;
  }

  beginPanelAction('autoGroup');
  let plannedGroups = [];
  try {
    let mergedGroups = await mergeDuplicateGroupsInActiveSpace();
    if (mergedGroups) await loadTabs({ adopt: false });

    if (state.ai.apiKey) {
      try {
        await ensureAIHostPermission();
        const response = await send('ai:chat', {
          settings: state.ai,
          messages: createPrompt('tidy-tabs', { tabs: candidates.map(compactTabForAI) }),
        });
        plannedGroups = sanitizeTidyGroups(parseTidyGroups(response.text), candidates);
      } catch (error) {
        setStatus(`${formatAIError(error)} Using local grouping instead.`);
      }
    }

    if (plannedGroups.length === 0) plannedGroups = planTidyGroups(candidates);
    const existingGroupsByTitle = activeChromeGroupsByTitle();
    let createdGroups = 0;
    for (const group of plannedGroups) {
      const titleKey = groupTitleKey(group.title);
      let groupId = existingGroupsByTitle.get(titleKey)?.id;
      if (Number.isFinite(Number(groupId))) {
        await addTabsToChromeGroup(groupId, group.tabIds, state.activeSpaceId);
      } else {
        groupId = await createChromeGroup(group.tabIds, {
          title: group.title,
          color: group.color || nextGroupColor(),
        });
        if (groupId === null) continue;
        existingGroupsByTitle.set(titleKey, {
          id: groupId,
          title: group.title,
          color: group.color,
        });
        createdGroups += 1;
      }
    }

    mergedGroups += await mergeDuplicateGroupsInActiveSpace();
    await saveState();
    await refreshTabs();
    const groupedCount = plannedGroups.reduce((sum, group) => sum + group.tabIds.length, 0);
    const parts = [];
    if (createdGroups) parts.push(`created ${createdGroups}`);
    if (groupedCount) parts.push(`grouped ${groupedCount} tabs`);
    if (mergedGroups) parts.push(`merged ${mergedGroups} duplicate groups`);
    setStatus(`Auto group updated ${currentSpace().name}: ${parts.join(', ') || 'nothing changed'}.`);
  } finally {
    endPanelAction();
  }
}

function activeChromeGroupsByTitle() {
  const byTitle = new Map();
  for (const group of groups) {
    if (state.groupSpaces[group.id] !== state.activeSpaceId) continue;
    const titleKey = groupTitleKey(group.title);
    if (!titleKey || byTitle.has(titleKey)) continue;
    byTitle.set(titleKey, group);
  }
  return byTitle;
}

function countDuplicateActiveGroups() {
  return duplicateActiveGroupBuckets().reduce((sum, bucket) => sum + bucket.length - 1, 0);
}

function duplicateActiveGroupBuckets() {
  const buckets = new Map();
  for (const group of groups) {
    if (state.groupSpaces[group.id] !== state.activeSpaceId) continue;
    const titleKey = groupTitleKey(group.title);
    if (!titleKey) continue;
    if (!buckets.has(titleKey)) buckets.set(titleKey, []);
    buckets.get(titleKey).push({ ...group, key: `group:${group.id}` });
  }
  return [...buckets.values()].filter((bucket) => bucket.length > 1);
}

async function mergeDuplicateGroupsInActiveSpace() {
  let merged = 0;
  for (const bucket of duplicateActiveGroupBuckets()) {
    const [keep, ...duplicates] = bucket;
    for (const duplicate of duplicates) {
      const tabIds = tabs
        .filter((tab) => Number(tab.groupId) === Number(duplicate.id))
        .map((tab) => tab.id);
      if (tabIds.length) await addTabsToChromeGroup(keep.id, tabIds, state.activeSpaceId);
      delete state.groupSpaces[duplicate.id];
      delete state.collapsedGroups[duplicate.key];
      delete state.tabOrder[state.activeSpaceId]?.[duplicate.key];
      state.groupOrder[state.activeSpaceId] = (state.groupOrder[state.activeSpaceId] || [])
        .filter((key) => key !== duplicate.key);
      merged += 1;
    }
    addGroupOrderKey(state.activeSpaceId, keep.key);
  }
  return merged;
}

async function addTidyContext(visibleTabs) {
  return Promise.all(visibleTabs.map(async (tab) => {
    if (!/^https?:/.test(tab.url || '')) return tab;
    const outline = await send('page:outline', { tabId: tab.id }).catch(() => null);
    return {
      ...tab,
      title: outline?.title || tab.title,
      outlineHeadings: outline?.headings || [],
    };
  }));
}

async function toggleSpaceGroups() {
  const next = !isSpaceGroupsCollapsed();
  state.collapsedSpaceGroups[state.activeSpaceId] = next;
  await saveState();
  render();
  focusPanelForShortcuts();
}

function isSpaceGroupsCollapsed() {
  return Boolean(state.collapsedSpaceGroups?.[state.activeSpaceId]);
}

function beginPanelAction(action) {
  activePanelAction = action;
  setStatus(panelActionStatus(action));
  updatePanelActionUI();
}

function endPanelAction() {
  activePanelAction = '';
  updatePanelActionUI();
}

function panelActionStatus(action) {
  if (action === 'tidyNames') return 'Tidying tab names...';
  if (action === 'autoGroup') return 'Auto grouping tabs...';
  return 'Working...';
}

function updatePanelActionUI() {
  const tidyBusy = activePanelAction === 'tidyNames';
  const groupBusy = activePanelAction === 'autoGroup';
  const busy = Boolean(activePanelAction);

  els.tidyNamesButton.disabled = busy;
  els.autoGroupButton.disabled = busy;
  els.collapseGroupsButton.disabled = busy;
  els.tidyNamesButton.textContent = tidyBusy ? '...' : '🧹';
  els.autoGroupButton.innerHTML = groupBusy ? '...' : AUTO_GROUP_ICON;
  els.tidyNamesButton.classList.toggle('busy', tidyBusy);
  els.autoGroupButton.classList.toggle('busy', groupBusy);
}

function focusPanelForShortcuts() {
  const target = activeView === 'ask' ? els.askPagePrompt : els.groupsList;
  if (!target || target.hidden) return;
  if (target === els.groupsList) target.tabIndex = -1;
  if (extensionRuntime) {
    chrome.runtime.sendMessage({ type: 'panel:focus' }).catch(() => null);
  }
  for (const delay of [0, 80, 240, 600, 1200, 1800]) {
    setTimeout(() => {
      window.focus();
      target.focus({ preventScroll: true });
    }, delay);
  }
}

function openAskPage() {
  activeView = 'ask';
  ensureCurrentAskSession();
  render();
  els.askPagePrompt.focus();
}

async function summarizeCurrentPage() {
  if (activeAIRequestId) {
    await abortActiveAIRequest();
    return;
  }
  activeView = 'ask';
  render();
  const session = ensureCurrentAskSession();
  const statusMessage = addAskMessage('assistant', 'Reading the active page...', session.key);
  const requestId = beginAIRequest();
  try {
    await ensureActivePagePermission();
    await ensureAIHostPermission();
    const { page } = await send('page:extract');
    const { text } = await send('ai:chat', {
      settings: state.ai,
      requestId,
      messages: createPrompt('summarize-page', { ...page, language: state.ai.language }),
    });
    const answer = text || 'No AI text returned.';
    updateAskMessage(statusMessage, answer);
  } catch (error) {
    const message = formatAIError(error);
    updateAskMessage(statusMessage, message);
  } finally {
    endAIRequest(requestId);
  }
}

async function askCustomPrompt() {
  if (activeAIRequestId) {
    await abortActiveAIRequest();
    return;
  }
  const prompt = els.askPagePrompt.value.trim();
  if (!prompt) return;
  activeView = 'ask';
  render();
  const session = ensureCurrentAskSession();
  addAskMessage('user', prompt, session.key);
  const statusMessage = addAskMessage('assistant', 'Thinking...', session.key);
  const requestId = beginAIRequest();
  try {
    await ensureActivePagePermission();
    await ensureAIHostPermission();
    const { page } = await send('page:extract');
    const { text } = await send('ai:chat', {
      settings: state.ai,
      requestId,
      messages: createPrompt('custom', {
        prompt: `Question: ${prompt}\n\nCurrent page:\nTitle: ${page.title || 'Untitled'}\nURL: ${page.url || ''}\nText:\n${page.text || ''}`,
        language: state.ai.language,
      }),
    });
    const answer = text || 'No AI text returned.';
    els.askPagePrompt.value = '';
    updateAskMessage(statusMessage, answer);
  } catch (error) {
    const message = formatAIError(error);
    updateAskMessage(statusMessage, message);
  } finally {
    endAIRequest(requestId);
  }
}

async function testAI() {
  if (activeAIRequestId) {
    await abortActiveAIRequest();
    return;
  }
  setSettingsStatus('Testing AI configuration...');
  const requestId = beginAIRequest();
  try {
    const settings = currentAISettingsFromForm();
    if (!settings.apiKey) {
      throw new Error('AI API key is missing. Add it in Settings.');
    }
    await ensureAIHostPermission(settings);
    const { text } = await send('ai:chat', {
      settings,
      requestId,
      messages: createPrompt('custom', { prompt: 'Reply with one short sentence: AI is connected.', language: 'en' }),
    });
    const message = text || 'AI request returned no text.';
    setSettingsStatus(message);
  } catch (error) {
    const message = formatAIError(error);
    setSettingsStatus(message);
  } finally {
    endAIRequest(requestId);
  }
}

async function previewArcImportFile() {
  const file = els.arcImportInput.files?.[0];
  pendingArcImportText = '';
  els.importArcButton.disabled = true;
  if (!file) {
    setArcImportStatus('No Arc file selected.');
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    setArcImportStatus('This file is too large to import safely. Select Arc StorableSidebar.json.');
    return;
  }

  try {
    const text = await file.text();
    const plan = createArcImportPlan(text, { existingSpaces: state.spaces });
    pendingArcImportText = text;
    els.importArcButton.disabled = plan.spaces.length === 0;
    setArcImportStatus(formatArcImportSummary(plan.summary, 'Ready to append'));
  } catch (error) {
    setArcImportStatus(`Cannot read Arc file: ${error.message || String(error)}`);
  }
}

async function importArcFile() {
  if (!pendingArcImportText) {
    setArcImportStatus('Choose an Arc sidebar file first.');
    return;
  }

  try {
    const plan = createArcImportPlan(pendingArcImportText, { existingSpaces: state.spaces });
    const result = appendArcImportPlan(state, plan);
    await saveState();
    render();
    pendingArcImportText = '';
    els.arcImportInput.value = '';
    els.importArcButton.disabled = true;
    const message = `Imported ${result.importedSpaces} Spaces and ${result.importedTabs} tabs. Current Space stayed active.`;
    setArcImportStatus(message);
    setSettingsStatus(message);
  } catch (error) {
    setArcImportStatus(`Import failed: ${error.message || String(error)}`);
  }
}

function showTabContextMenu(event, tab) {
  event.preventDefault();
  event.stopPropagation();
  const contextTabIds = selectionForContextMenu({
    selectedTabIds: [...selectedTabIds],
    clickedTabId: tab.id,
  });
  selectedTabIds = new Set(contextTabIds);
  selectionAnchorTabId = tab.id;
  render();

  const items = [
    menuAction(contextTabIds.length === 1 ? 'Group tab' : `Group ${contextTabIds.length} selected tabs`, () => groupSelectedTabs(contextTabIds)),
    menuSeparator(),
    menuAction('Rename', () => renameTab(tab)),
    menuAction('Duplicate', () => duplicateTab(tab)),
    ...menuSection(moveToSpaceSubmenu((space) => moveTabToSpace(tab, space.id))),
  ];

  showContextMenu(event, items);
}

function showGroupContextMenu(event, group) {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu(event, [
    menuAction('Rename', () => renameGroup(group)),
    menuAction('Delete Group', () => deleteGroup(group)),
    ...menuSection(moveToSpaceSubmenu((space) => moveGroupToSpace(group, space.id))),
  ]);
}

function showFolderContextMenu(event, folderContext) {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu(event, [
    menuAction('Rename', () => renameFolderGroup(folderContext)),
    menuAction('Delete Group', () => deleteFolderGroup(folderContext)),
    ...menuSection(moveToSpaceSubmenu((space) => moveFolderGroupToSpace(folderContext, space.id))),
  ]);
}

function showSpaceContextMenu(event, space) {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu(event, [
    menuAction('Rename Space', () => renameSpace(space)),
    menuAction('Delete Space', () => deleteSpace(space)),
  ]);
}

function showContextMenu(event, items) {
  els.contextMenu.replaceChildren(...items.filter(Boolean));
  els.contextMenu.hidden = false;
  els.contextMenu.style.left = '0px';
  els.contextMenu.style.top = '0px';
  const rect = els.contextMenu.getBoundingClientRect();
  const submenuReserve = els.contextMenu.querySelector('.context-submenu') ? 202 : 0;
  const x = Math.min(event.clientX, window.innerWidth - rect.width - submenuReserve - 8);
  const y = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  els.contextMenu.style.left = `${Math.max(8, x)}px`;
  els.contextMenu.style.top = `${Math.max(8, y)}px`;
}

function hideContextMenu() {
  els.contextMenu.hidden = true;
}

function menuAction(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    hideContextMenu();
    await runTask(handler);
  });
  return button;
}

function moveToSpaceSubmenu(actionForSpace) {
  const spaces = state.spaces.filter((space) => space.id !== state.activeSpaceId);
  if (spaces.length === 0) return null;
  return menuSubmenu(
    'Move to',
    spaces.map((space) => menuAction(space.name, () => actionForSpace(space))),
  );
}

function menuSubmenu(label, items) {
  const wrapper = document.createElement('div');
  wrapper.className = 'context-submenu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'context-submenu-trigger';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = `<span>${escapeHtml(label)}</span><span class="context-submenu-arrow" aria-hidden="true">›</span>`;

  const panel = document.createElement('div');
  panel.className = 'context-submenu-panel';
  panel.setAttribute('role', 'menu');
  panel.replaceChildren(...items.filter(Boolean));

  const setOpen = (open) => {
    wrapper.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  wrapper.addEventListener('mouseenter', () => setOpen(true));
  wrapper.addEventListener('mouseleave', () => setOpen(false));
  wrapper.addEventListener('focusin', () => setOpen(true));
  wrapper.addEventListener('focusout', (event) => {
    if (!wrapper.contains(event.relatedTarget)) setOpen(false);
  });
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(true);
  });

  wrapper.append(trigger, panel);
  return wrapper;
}

function menuSection(item) {
  return item ? [menuSeparator(), item] : [];
}

function menuSeparator() {
  const item = document.createElement('div');
  item.className = 'context-separator';
  return item;
}

function askText({ title, label, value = '', confirmText = 'Save' }) {
  return openActionDialog({
    title,
    label,
    value,
    confirmText,
    withInput: true,
  });
}

async function askConfirm({ title, message, confirmText = 'Confirm', danger = false }) {
  const result = await openActionDialog({
    title,
    message,
    confirmText,
    danger,
    withInput: false,
  });
  return result === true;
}

function openActionDialog({
  title,
  message = '',
  label = '',
  value = '',
  confirmText = 'Save',
  danger = false,
  withInput = false,
}) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      els.actionDialog.removeEventListener('close', onClose);
      els.actionDialogClose.removeEventListener('click', onCancel);
      els.actionDialogCancel.removeEventListener('click', onCancel);
      els.actionDialog.querySelector('form').removeEventListener('submit', onSubmit);
      if (els.actionDialog.open) els.actionDialog.close();
      resolve(result);
    };

    const onSubmit = (event) => {
      event.preventDefault();
      finish(withInput ? els.actionDialogInput.value.trim() : true);
    };
    const onCancel = () => finish(null);
    const onClose = () => finish(null);

    els.actionDialogTitle.textContent = title;
    els.actionDialogMessage.textContent = message;
    els.actionDialogMessage.hidden = !message;
    els.actionDialogLabel.hidden = !withInput;
    els.actionDialogInput.value = value;
    els.actionDialogLabel.firstChild.textContent = label || 'Name';
    els.actionDialogConfirm.textContent = confirmText;
    els.actionDialogConfirm.classList.toggle('danger', danger);

    els.actionDialog.addEventListener('close', onClose);
    els.actionDialogClose.addEventListener('click', onCancel);
    els.actionDialogCancel.addEventListener('click', onCancel);
    els.actionDialog.querySelector('form').addEventListener('submit', onSubmit);
    els.actionDialog.showModal();
    if (withInput) {
      els.actionDialogInput.focus();
      els.actionDialogInput.select();
    } else {
      els.actionDialogConfirm.focus();
    }
  });
}

function renderSettings() {
  els.baseUrlInput.value = state.ai.baseUrl;
  els.modelInput.value = state.ai.model;
  els.languageInput.value = state.ai.language || 'zh-CN';
  els.apiKeyInput.value = state.ai.apiKey;
  els.apiKeyInput.placeholder = state.ai.apiKey ? 'API key configured' : 'Paste API key';
  const statusText = apiKeyStatusText();
  els.apiKeyStatus.textContent = statusText;
  els.apiKeyStatus.hidden = !statusText;
  els.clearApiKeyButton.hidden = !state.ai.apiKey || Boolean(localConfig.ai?.apiKey);
  els.clearApiKeyButton.disabled = Boolean(localConfig.ai?.apiKey);
  els.thinkingInput.value = state.ai.thinking;
  els.maxTokensInput.value = state.ai.maxTokens;

  const theme = state.tempTheme || state.theme || 'purple';
  for (const option of els.themeOptions.querySelectorAll('.theme-option')) {
    option.classList.toggle('active', option.dataset.theme === theme);
  }

  renderShortcutSettings();
}

function apiKeyStatusText() {
  if (localConfig.ai?.apiKey) return '';
  if (state.ai.apiKey) return 'API key is configured for this Chrome session.';
  return 'No API key configured.';
}

function renderShortcutSettings() {
  const shortcuts = mergeShortcuts(state.shortcuts);
  const rows = SHORTCUT_ACTIONS.map((action) => {
    const row = document.createElement('label');
    row.className = 'shortcut-row';

    const label = document.createElement('span');
    label.textContent = action.label;

    const input = document.createElement('input');
    input.className = 'shortcut-input';
    input.type = 'text';
    input.readOnly = true;
    input.spellcheck = false;
    input.dataset.shortcutAction = action.id;
    input.dataset.shortcut = shortcuts[action.id] || '';
    input.value = formatShortcut(input.dataset.shortcut);
    input.placeholder = 'Press keys';

    row.append(label, input);
    return row;
  });
  els.shortcutsList.replaceChildren(...rows);
}

async function saveSettings() {
  const shortcuts = currentShortcutsFromForm();
  const conflict = shortcutConflict(shortcuts);
  if (conflict) {
    setSettingsStatus(`${conflict.label} conflicts with ${conflict.otherLabel}. Pick a different shortcut.`);
    return;
  }
  state.ai = currentAISettingsFromForm();
  state.shortcuts = shortcuts;

  if (state.tempTheme) {
    state.theme = state.tempTheme;
    delete state.tempTheme;
  }

  await ensureAIHostPermission(state.ai).catch(() => null);
  if (state.ai.apiKey) await secretSet({ [SECRET_STORAGE_KEY]: { ai: { apiKey: state.ai.apiKey } } });
  else await secretRemove(SECRET_STORAGE_KEY);
  await saveState();
  els.settingsDialog.close();
  render();
}

async function clearApiKey() {
  if (localConfig.ai?.apiKey) {
    setSettingsStatus('API key comes from config.local.js. Remove it there and reload the extension.');
    return;
  }
  state.ai.apiKey = '';
  els.apiKeyInput.value = '';
  await secretRemove(SECRET_STORAGE_KEY);
  await saveState();
  renderSettings();
  setSettingsStatus('API key cleared. AI requests are disabled until you add a key.');
}

function currentAISettingsFromForm() {
  return {
    ...state.ai,
    baseUrl: els.baseUrlInput.value.trim().replace(/\/+$/, ''),
    model: els.modelInput.value.trim() || 'glm-5.1',
    language: els.languageInput.value || 'zh-CN',
    apiKey: els.apiKeyInput.value.trim(),
    thinking: els.thinkingInput.value,
    maxTokens: Number(els.maxTokensInput.value || 2048),
  };
}

function currentShortcutsFromForm() {
  const shortcuts = mergeShortcuts(state.shortcuts);
  for (const input of els.shortcutsList.querySelectorAll('.shortcut-input')) {
    const actionId = input.dataset.shortcutAction;
    if (!actionId) continue;
    shortcuts[actionId] = normalizeShortcut(input.dataset.shortcut || input.value);
  }
  return mergeShortcuts(shortcuts);
}

function shortcutConflict(shortcuts) {
  for (const action of SHORTCUT_ACTIONS) {
    const otherId = findShortcutConflict(shortcuts, action.id, shortcuts[action.id]);
    if (!otherId) continue;
    return {
      label: action.label,
      otherLabel: SHORTCUT_ACTIONS.find((item) => item.id === otherId)?.label || otherId,
    };
  }
  return null;
}

async function ensureAIHostPermission(settings = state.ai) {
  if (!extensionRuntime) return true;
  const origin = getOriginPattern(settings.baseUrl);
  const hasPermission = await chrome.permissions.contains({ origins: [origin] });
  if (hasPermission) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function ensureActivePagePermission() {
  if (!extensionRuntime) return true;
  const active = tabs.find((tab) => tab.active);
  const url = active?.url || '';
  if (!/^https?:/.test(url)) {
    throw new Error('Switch to an http or https page before using Ask Page.');
  }
  const origin = getOriginPattern(url);
  const hasPermission = await chrome.permissions.contains({ origins: [origin] });
  if (hasPermission) return true;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error(`Space Tabs needs permission to read ${new URL(url).hostname} for Ask Page.`);
  return true;
}

async function send(type, payload = {}) {
  if (!extensionRuntime) return previewSend(type, payload);
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || `Command failed: ${type}`);
  return response;
}

function beginAIRequest() {
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  activeAIRequestId = requestId;
  updateAIRequestUI();
  return requestId;
}

function endAIRequest(requestId) {
  if (activeAIRequestId !== requestId) return;
  activeAIRequestId = '';
  updateAIRequestUI();
}

async function abortActiveAIRequest() {
  if (!activeAIRequestId) return;
  const requestId = activeAIRequestId;
  activeAIRequestId = '';
  updateAIRequestUI();
  await send('ai:abort', { requestId }).catch(() => null);
  if (activeView === 'ask') setStatus('Ask stopped.');
}

function updateAIRequestUI() {
  const busy = Boolean(activeAIRequestId);
  els.askAIButton.textContent = busy ? 'Stop' : 'Ask';
  els.summarizePageButton.disabled = busy;
  els.testAIButton.textContent = busy ? 'Stop request' : 'Test AI';
}

async function storageGet() {
  if (extensionRuntime) return chrome.storage.local.get(STORAGE_KEY);
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

async function storageSet(value) {
  if (extensionRuntime) return chrome.storage.local.set(value);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

async function secretGet() {
  if (extensionRuntime && chrome.storage.session) return chrome.storage.session.get(SECRET_STORAGE_KEY);
  try {
    return JSON.parse(sessionStorage.getItem(SECRET_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

async function secretSet(value) {
  if (extensionRuntime && chrome.storage.session) return chrome.storage.session.set(value);
  sessionStorage.setItem(SECRET_STORAGE_KEY, JSON.stringify(value));
}

async function secretRemove(key) {
  if (extensionRuntime && chrome.storage.session) return chrome.storage.session.remove(key);
  sessionStorage.removeItem(key);
}

function stateForStorage() {
  return {
    ...state,
    ai: {
      ...state.ai,
      apiKey: '',
    },
  };
}

function actionButton(text, title, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  if (text === '×') {
    button.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  } else if (text === '✎') {
    button.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
  } else if (text === '↗') {
    button.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>`;
  } else {
    button.textContent = text;
  }
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    runTask(handler);
  });
  return button;
}

async function runTask(task) {
  try {
    await task();
  } catch (error) {
    const message = formatAIError(error);
    setStatus(message);
    if (activeView === 'ask') addAskMessage('assistant', message);
    console.error(error);
  }
}

function currentSpace() {
  return state.spaces.find((space) => space.id === state.activeSpaceId) || state.spaces[0];
}

function currentActiveTab() {
  return tabs.find((tab) => tab.active) || tabs[0] || {};
}

function ensureCurrentAskSession() {
  const tab = currentActiveTab();
  const key = sessionKeyForTab(tab);
  const session = ensureAskSessionByKey(key, tab);
  state.activeAskSessionKey = key;
  state.askSessions = pruneAskSessions(state.askSessions, {
    activeKey: key,
    openTabIds: tabs.map((item) => item.id),
  });
  return session;
}

function ensureAskSessionByKey(key, tab = currentActiveTab()) {
  const safeKey = key || sessionKeyForTab(tab);
  if (!state.askSessions[safeKey]) state.askSessions[safeKey] = createAskSession(tab);
  const session = state.askSessions[safeKey];
  if (tab?.id !== undefined) session.tabId = tab.id;
  if (tab?.title) session.title = tab.title;
  if (tab?.url) session.url = session.url || tab.url;
  return session;
}

function buildSpaceViewForSpace(spaceId) {
  return buildSpaceView({
    activeSpaceId: spaceId,
    tabs,
    groups,
    groupSpaces: state.groupSpaces,
    tabSpaces: state.tabSpaces,
    virtualGroups: state.virtualGroups,
    tabGroups: state.tabGroups,
    groupOrder: state.groupOrder,
    tabOrder: state.tabOrder,
    collapsedGroups: state.collapsedGroups,
    includeUngrouped: true,
  })
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter((tab) => !isEphemeralTab(tab)),
    }))
    .filter((group) => group.tabs.length > 0 || group.key === 'ungrouped');
}

function isEphemeralTab(tab) {
  return ephemeralTabIdSet().has(Number(tab.id)) && tab.url === 'chrome://newtab';
}

function ephemeralTabIdSet() {
  if (!Array.isArray(state.ephemeralTabIds)) state.ephemeralTabIds = [];
  for (const tabId of syntheticPlaceholderTabIds) {
    if (!state.ephemeralTabIds.includes(Number(tabId))) state.ephemeralTabIds.push(Number(tabId));
  }
  return new Set(state.ephemeralTabIds.map(Number).filter(Number.isFinite));
}

function rememberEphemeralTab(tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id)) return;
  syntheticPlaceholderTabIds.add(id);
  if (!Array.isArray(state.ephemeralTabIds)) state.ephemeralTabIds = [];
  if (!state.ephemeralTabIds.includes(id)) state.ephemeralTabIds.push(id);
}

function forgetEphemeralTab(tabId) {
  const id = Number(tabId);
  syntheticPlaceholderTabIds.delete(id);
  if (Array.isArray(state.ephemeralTabIds)) {
    state.ephemeralTabIds = state.ephemeralTabIds.filter((item) => Number(item) !== id);
  }
}

function cleanupEphemeralTabIds() {
  if (!Array.isArray(state.ephemeralTabIds)) state.ephemeralTabIds = [];
  const liveTabIds = new Set(tabs.map((tab) => Number(tab.id)));
  state.ephemeralTabIds = state.ephemeralTabIds
    .map(Number)
    .filter((tabId) => Number.isFinite(tabId) && liveTabIds.has(tabId));
  for (const tabId of [...syntheticPlaceholderTabIds]) {
    if (!liveTabIds.has(Number(tabId))) syntheticPlaceholderTabIds.delete(Number(tabId));
  }
}

function currentOrderedTabIds() {
  return spaceView.flatMap((group) => group.tabs.filter((tab) => !tab.dormant).map((tab) => tab.id));
}

function updateTabSelection(tabId, options = {}) {
  const next = tabSelectionFromClick({
    orderedTabIds: currentOrderedTabIds(),
    selectedTabIds: [...selectedTabIds],
    anchorTabId: selectionAnchorTabId,
    clickedTabId: tabId,
    additive: Boolean(options.additive),
    range: Boolean(options.range),
  });
  selectedTabIds = new Set(next.selectedTabIds);
  selectionAnchorTabId = next.anchorTabId;
}

function syncSelectedTabsToVisibleSpace() {
  const visibleIds = new Set(currentOrderedTabIds());
  selectedTabIds = new Set([...selectedTabIds].filter((id) => visibleIds.has(id)));
  if (!visibleIds.has(selectionAnchorTabId)) {
    selectionAnchorTabId = [...selectedTabIds].at(-1) ?? null;
  }
}

function tabBelongsToSpace(tab, spaceId) {
  return entityBelongsToSpace(tab, state, spaceId);
}

function isGroupedTab(tab) {
  return Number.isFinite(Number(tab?.groupId)) && Number(tab.groupId) !== -1;
}

function addGroupOrderKey(spaceId, key) {
  const order = state.groupOrder[spaceId] || [];
  if (!order.includes(key)) state.groupOrder[spaceId] = [...order, key];
}

function ensureTabOrderForSpace(spaceId) {
  if (!state.tabOrder[spaceId]) state.tabOrder[spaceId] = {};
  return state.tabOrder[spaceId];
}

function removeTabFromSavedOrder(tabId, spaceId = state.activeSpaceId) {
  const id = Number(tabId);
  const order = state.tabOrder?.[spaceId];
  if (!Number.isFinite(id) || !order) return;
  for (const key of Object.keys(order)) {
    order[key] = (order[key] || []).filter((item) => Number(item) !== id);
    if (order[key].length === 0) delete order[key];
  }
}

function rememberDuplicatedTabOrder(sourceTab, duplicatedTabId, sourceGroup, spaceId = state.activeSpaceId) {
  const sourceId = Number(sourceTab?.id);
  const duplicateId = Number(duplicatedTabId);
  if (!Number.isFinite(sourceId) || !Number.isFinite(duplicateId)) return;
  const groupKey = sourceGroup?.key || tabOrderKeyForTab(sourceTab);
  const order = ensureTabOrderForSpace(spaceId);
  const fallbackIds = sourceGroup ? liveTabsForOrdering(sourceGroup).map((tab) => Number(tab.id)) : [sourceId];
  const ids = (order[groupKey]?.length ? order[groupKey] : fallbackIds)
    .map(Number)
    .filter((id) => Number.isFinite(id) && id !== duplicateId);
  const sourceIndex = ids.indexOf(sourceId);
  ids.splice(sourceIndex >= 0 ? sourceIndex + 1 : ids.length, 0, duplicateId);
  order[groupKey] = uniqueKeys(ids);
}

function tabOrderKeyForTab(tab) {
  if (isGroupedTab(tab)) return `group:${tab.groupId}`;
  return state.tabGroups?.[tab?.id] || 'ungrouped';
}

async function createChromeGroup(tabIds, options = {}) {
  const ids = uniqueNumberIds(tabIds);
  if (ids.length === 0) return null;
  const result = await send('tabs:group', {
    tabIds: ids,
    title: options.title || 'Tabs',
    color: options.color || nextGroupColor(),
    collapsed: Boolean(options.collapsed),
  });
  const groupId = Number(result.groupId);
  if (!Number.isFinite(groupId)) return null;
  bindChromeGroup(groupId, options.spaceId || state.activeSpaceId, {
    sourceKey: options.sourceKey,
    collapsed: Boolean(options.collapsed),
  });
  clearLocalTabGrouping(ids);
  return groupId;
}

async function addTabsToChromeGroup(groupId, tabIds, spaceId = state.activeSpaceId) {
  const ids = uniqueNumberIds(tabIds);
  const numericGroupId = Number(groupId);
  if (!Number.isFinite(numericGroupId) || ids.length === 0) return null;
  const result = await send('tabs:groupExisting', { groupId: numericGroupId, tabIds: ids });
  const nextGroupId = Number(result.groupId);
  if (!Number.isFinite(nextGroupId)) return null;
  bindChromeGroup(nextGroupId, spaceId);
  clearLocalTabGrouping(ids);
  return nextGroupId;
}

function bindChromeGroup(groupId, spaceId = state.activeSpaceId, options = {}) {
  const numericGroupId = Number(groupId);
  if (!Number.isFinite(numericGroupId)) return '';
  const key = `group:${numericGroupId}`;
  state.groupSpaces[numericGroupId] = spaceId;
  if (options.sourceKey && options.sourceKey !== key) transferGroupLocalState(options.sourceKey, key, spaceId);
  if ('collapsed' in options) state.collapsedGroups[key] = Boolean(options.collapsed);
  addGroupOrderKey(spaceId, key);
  return key;
}

function transferGroupLocalState(sourceKey, targetKey, spaceId = state.activeSpaceId) {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;
  if (state.collapsedGroups[sourceKey] !== undefined && state.collapsedGroups[targetKey] === undefined) {
    state.collapsedGroups[targetKey] = state.collapsedGroups[sourceKey];
  }
  delete state.collapsedGroups[sourceKey];

  const order = state.tabOrder?.[spaceId];
  if (order?.[sourceKey]) {
    order[targetKey] = uniqueKeys([...(order[targetKey] || []), ...order[sourceKey]]);
    delete order[sourceKey];
  }

  const groupOrder = state.groupOrder[spaceId] || [];
  if (groupOrder.includes(sourceKey)) {
    state.groupOrder[spaceId] = uniqueKeys(groupOrder.map((key) => key === sourceKey ? targetKey : key));
  }
}

function clearLocalTabGrouping(tabIds) {
  for (const tabId of uniqueNumberIds(tabIds)) {
    delete state.tabSpaces[tabId];
    delete state.tabGroups?.[tabId];
  }
}

function chromeGroupForTitle(title, spaceId = state.activeSpaceId) {
  const titleKey = groupTitleKey(title);
  if (!titleKey) return null;
  return groups.find((group) => (
    state.groupSpaces[group.id] === spaceId &&
    groupTitleKey(group.title) === titleKey
  )) || null;
}

function cleanupUnusedVirtualGroups() {
  const used = new Set(Object.values(state.tabGroups || {}));
  for (const groupKey of Object.keys(state.virtualGroups || {})) {
    if (!used.has(groupKey)) delete state.virtualGroups[groupKey];
  }
}

function uniqueNumberIds(values = []) {
  return [...new Set((values || []).map(Number).filter(Number.isFinite))];
}

function groupIdFromKey(key) {
  const match = String(key || '').match(/^group:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isVirtualGroupKey(key) {
  return String(key || '').startsWith('vgroup:');
}

function createVirtualGroup({ title = 'Tabs', color = nextGroupColor(), spaceId = state.activeSpaceId } = {}) {
  if (!state.virtualGroups || typeof state.virtualGroups !== 'object') state.virtualGroups = {};
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const key = `vgroup:${id}`;
  state.virtualGroups[key] = {
    id: key,
    title: String(title || 'Tabs').slice(0, 64),
    color: color || 'blue',
    spaceId,
  };
  addGroupOrderKey(spaceId, key);
  return key;
}

function findVirtualGroupByTitle(title, spaceId = state.activeSpaceId) {
  const titleKey = groupTitleKey(title);
  if (!titleKey) return null;
  return Object.entries(state.virtualGroups || {}).find(([, group]) => (
    group?.spaceId === spaceId && groupTitleKey(group.title) === titleKey
  ))?.[0] || null;
}

function ensureVirtualGroupForTitle(title, color = nextGroupColor(), spaceId = state.activeSpaceId) {
  return findVirtualGroupByTitle(title, spaceId) || createVirtualGroup({ title, color, spaceId });
}

function firstTabIndexForGroupKey(key) {
  const group = spaceView.find((item) => item.key === key);
  if (!group?.tabs?.length) return Number.NaN;
  const indexes = group.tabs.map((tab) => Number(tab.index)).filter(Number.isFinite);
  return indexes.length ? Math.min(...indexes) : Number.NaN;
}

function tabInsertionIndexAtEndOfGroup(group) {
  const indexes = liveTabsForOrdering(group).map((tab) => Number(tab.index)).filter(Number.isFinite);
  return indexes.length ? Math.max(...indexes) + 1 : tabs.length;
}

function selectedGroupTitle(selectedTabs) {
  const domains = selectedTabs.map((tab) => tab.domain || domainFromUrl(tab.url));
  const uniqueDomains = [...new Set(domains.filter(Boolean))];
  if (uniqueDomains.length === 1) {
    return titleForDomain(uniqueDomains[0], selectedTabs[0]?.title || selectedTabs[0]?.displayTitle || '');
  }
  return 'Selected Tabs';
}

function activePageStatus() {
  const active = currentActiveTab();
  return active?.title ? `Chat with ${active.title}` : 'Chat with the active page';
}

function spaceName(spaceId) {
  return state.spaces.find((space) => space.id === spaceId)?.name || 'Space';
}

function tabCount(view) {
  return view.reduce((sum, group) => sum + group.tabs.length, 0);
}

function groupColor(color) {
  const colors = {
    grey: '#8a8580',
    blue: '#2f63ff',
    red: '#d94b3d',
    yellow: '#c99a16',
    green: '#2d9b63',
    pink: '#d65a9f',
    purple: '#7b61ff',
    cyan: '#1598ad',
    orange: '#d77824',
  };
  return colors[color] || colors.blue;
}

function setSettingsStatus(text) {
  els.settingsStatus.textContent = text;
}

function setArcImportStatus(text) {
  els.arcImportStatus.textContent = text;
}

function formatArcImportSummary(summary, prefix = 'Arc import') {
  if (!summary || summary.spaces === 0) return 'No Arc Spaces found in this file.';
  const skipped = Object.entries(summary.skipped || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => `${count} ${key}`)
    .join(', ');
  const skippedText = skipped ? ` Skipped: ${skipped}.` : '';
  return `${prefix}: ${summary.spaces} Spaces, ${summary.folders} folders, ${summary.tabs} tabs from ${summary.source}.${skippedText}`;
}

function renderAskMessages() {
  const session = ensureCurrentAskSession();
  const signature = askMessagesSignature(session);
  if (signature === lastRenderedAskSignature) return;

  const shouldStickToBottom = els.askMessages.scrollHeight - els.askMessages.scrollTop - els.askMessages.clientHeight < 24;
  els.askMessages.replaceChildren(...(session.messages || []).map(createAskMessageElement));
  if (shouldStickToBottom) els.askMessages.scrollTop = els.askMessages.scrollHeight;
  lastRenderedAskSignature = signature;
}

function askMessagesSignature(session) {
  return JSON.stringify([
    session?.key || '',
    (session?.messages || []).map((message) => [
      message.id,
      message.role,
      message.updatedAt || message.createdAt || 0,
      message.text,
    ]),
  ]);
}

function createAskMessageElement(message) {
  const node = document.createElement('div');
  node.className = `ask-message ${message.role === 'user' ? 'user' : 'assistant'}`;
  if (message.role === 'assistant') node.innerHTML = renderMarkdown(message.text);
  else node.textContent = message.text;
  return node;
}

function addAskMessage(role, text, sessionKey = state.activeAskSessionKey) {
  if (!text) return;
  const session = ensureAskSessionByKey(sessionKey);
  const message = appendAskSessionMessage(session, role, text);
  if (session.key === state.activeAskSessionKey && activeView === 'ask') renderAskMessages();
  void saveState();
  return { sessionKey: session.key, messageId: message.id };
}

function updateAskMessage(ref, text) {
  if (!ref) return;
  const session = ensureAskSessionByKey(ref.sessionKey);
  updateAskSessionMessage(session, ref.messageId, text);
  if (session.key === state.activeAskSessionKey && activeView === 'ask') renderAskMessages();
  void saveState();
}

function setStatus(text) {
  els.syncStatus.textContent = text;
}

function uniqueSpaceId(name) {
  const base = String(name || 'space')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'space';
  const used = new Set(state.spaces.map((space) => space.id));
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) candidate = `${base}-${index++}`;
  return candidate;
}

function nextSpaceColor() {
  const colors = ['blue', 'green', 'purple', 'yellow', 'pink', 'cyan', 'orange'];
  return colors[state.spaces.length % colors.length];
}

function nextGroupColor() {
  const colors = ['blue', 'green', 'purple', 'yellow', 'pink', 'cyan', 'orange'];
  return colors[groups.length % colors.length];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function applyTheme(themeName) {
  const name = themeName || 'purple';
  if (name === 'purple') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', name);
  }
}
