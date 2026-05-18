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
  isUngroupedSnapshotGroup,
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
  syncCollapsedGroupsFromChrome,
  tabBelongsToSpace as entityBelongsToSpace,
} from './src/shared/space-membership.js';
import {
  buildSpaceView,
  compactTabForAI,
  decorateTabs,
  domainFromUrl,
  planTidyGroups,
  planTidyTabNames,
  preferredFocusableTab,
  sanitizeTidyGroups,
  searchTabs,
  titleForDomain,
} from './src/shared/tab-utils.js';

const legacyConfigName = ['ARC', 'SIDECAR_LOCAL_CONFIG'].join('');
const localConfig = window.SPACE_TABS_CONFIG || window[legacyConfigName] || {};
const extensionRuntime = isExtensionRuntime(window);
const previewSend = createPreviewCommandHandler();

let state = createDefaultState(localConfig);
let tabs = [];
let groups = [];
let spaceView = [];
let dormantSpaceView = [];
let dormantSpaceViewSpaceId = '';
let activeView = 'space';
let dragState = null;
let activeAIRequestId = '';
let activePanelAction = '';
let panelPort = null;
let selectedTabIds = new Set();
let selectionAnchorTabId = null;
let pendingArcImportText = '';

const els = {
  activeSpaceName: document.querySelector('#activeSpaceName'),
  syncStatus: document.querySelector('#syncStatus'),
  settingsButton: document.querySelector('#settingsButton'),
  collapseGroupsButton: document.querySelector('#collapseGroupsButton'),
  spaceSearch: document.querySelector('#spaceSearch'),
  searchInput: document.querySelector('#searchInput'),
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
};

init();

async function init() {
  try {
    connectPanelPort();
    await loadState();
    bindEvents();
    renderSettings();
    await refreshTabs();
    if (extensionRuntime) setInterval(refreshTabs, 2500);
  } catch (error) {
    els.syncStatus.textContent = 'Failed to initialize';
    if (activeView === 'ask') addAskMessage('assistant', formatAIError(error));
  }
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
    notifyPanelVisibility(document.visibilityState !== 'hidden');
  });
  window.addEventListener('focus', () => notifyPanelVisibility(true));
  window.addEventListener('pageshow', () => notifyPanelVisibility(true));
  window.addEventListener('pagehide', () => notifyPanelVisibility(false));
}

function notifyPanelVisibility(visible) {
  try {
    panelPort?.postMessage({ type: 'panel:visibility', visible });
  } catch {
    // The port is intentionally best-effort; Chrome can keep side panels alive while hidden.
  }
}

async function loadState() {
  const defaults = createDefaultState(localConfig);
  const stored = await storageGet();
  state = mergeStoredState(stored[STORAGE_KEY], defaults);
  const secrets = await secretGet();

  if (localConfig.ai?.apiKey) {
    state.ai = {
      ...state.ai,
      ...localConfig.ai,
      baseUrl: String(localConfig.ai.baseUrl || state.ai.baseUrl).trim().replace(/\/+$/, ''),
      maxTokens: Number(localConfig.ai.maxTokens ?? state.ai.maxTokens),
      temperature: Number(localConfig.ai.temperature ?? state.ai.temperature),
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
    renderSettings();
    els.settingsDialog.showModal();
  });
  els.searchInput.addEventListener('input', render);
  els.tidyNamesButton.addEventListener('click', () => runTask(tidyTabNames));
  els.autoGroupButton.addEventListener('click', () => runTask(autoGroupTabs));
  els.collapseGroupsButton.addEventListener('click', () => runTask(toggleSpaceGroups));
  els.askAIButton.addEventListener('click', () => runTask(askCustomPrompt));
  els.summarizePageButton.addEventListener('click', () => runTask(summarizeCurrentPage));
  els.testAIButton.addEventListener('click', () => runTask(testAI));
  els.clearApiKeyButton.addEventListener('click', () => runTask(clearApiKey));
  els.arcImportInput.addEventListener('change', () => runTask(previewArcImportFile));
  els.importArcButton.addEventListener('click', () => runTask(importArcFile));
  els.saveSettingsButton.addEventListener('click', (event) => runTask(() => saveSettings(event)));
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
  if (action === 'focusSearch') {
    activeView = 'space';
    render();
    els.searchInput.focus();
    els.searchInput.select();
    return;
  }
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
  await loadTabs();
  await loadDormantSpaceView(state.activeSpaceId, { force: Boolean(options.reloadDormant) });
  render();
  await saveState();
}

async function loadTabs({ adopt = true } = {}) {
  const response = await send('tabs:list');
  tabs = decorateTabs(response.tabs || [], state);
  groups = response.groups || [];
  if (adopt) adoptUnassignedEntities(state, tabs, groups, state.activeSpaceId);
  else cleanupMissingEntities(state, tabs, groups);
  syncCollapsedGroupsFromChrome(state, groups);
}

async function loadDormantSpaceView(spaceId, options = {}) {
  if (!options.force && dormantSpaceViewSpaceId === spaceId) return;
  let snapshot = null;
  if (extensionRuntime) {
    const response = await send('bookmarks:loadSpaceSnapshot', { spaceId }).catch(() => null);
    snapshot = response?.snapshot || null;
  }
  snapshot ||= state.spaceSnapshots?.[spaceId] || null;
  dormantSpaceView = dormantGroupsFromSnapshot(snapshot);
  dormantSpaceViewSpaceId = spaceId;
}

function render() {
  const activeSpace = currentSpace();
  const searchedTabs = searchTabs(tabs, els.searchInput.value);
  const liveSpaceView = buildSpaceView({
    activeSpaceId: state.activeSpaceId,
    tabs: searchedTabs,
    groups,
    groupSpaces: state.groupSpaces,
    tabSpaces: state.tabSpaces,
    groupOrder: state.groupOrder,
    tabOrder: state.tabOrder,
    collapsedGroups: state.collapsedGroups,
    includeUngrouped: true,
  });
  spaceView = mergeDormantSpaceView(liveSpaceView, dormantSpaceView, els.searchInput.value);
  syncSelectedTabsToVisibleSpace();

  const isAskView = activeView === 'ask';
  const groupsCollapsed = !isAskView && isSpaceGroupsCollapsed();
  if (isAskView) ensureCurrentAskSession();
  els.activeSpaceName.textContent = isAskView ? 'Ask Page' : activeSpace.name;
  els.syncStatus.textContent = activePanelAction
    ? panelActionStatus(activePanelAction)
    : isAskView
    ? activePageStatus()
    : extensionRuntime
      ? `${tabCount(spaceView)} tabs in ${activeSpace.name}`
      : `${tabCount(spaceView)} preview tabs in ${activeSpace.name}`;
  els.spaceSearch.hidden = isAskView || groupsCollapsed;
  els.groupsList.hidden = isAskView;
  els.askPageView.hidden = !isAskView;
  els.tidyNamesButton.hidden = isAskView;
  els.autoGroupButton.hidden = isAskView;
  els.collapseGroupsButton.hidden = isAskView;
  els.collapseGroupsButton.textContent = groupsCollapsed ? '⌄' : '⌃';
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

function mergeDormantSpaceView(liveView, dormantView, query) {
  const openUrls = new Set(liveView.flatMap((group) => group.tabs.map((tab) => tab.url).filter(Boolean)));
  const needle = String(query || '').trim().toLowerCase();
  const dormantGroups = dormantView
    .map((group) => ({
      ...group,
      collapsed: Boolean(state.collapsedGroups[group.key] ?? group.collapsed),
      tabs: group.tabs.filter((tab) => {
        if (openUrls.has(tab.url)) return false;
        if (!needle) return true;
        return [tab.title, tab.displayTitle, tab.url, tab.domain]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      }),
    }))
    .filter((group) => group.tabs.length > 0);

  const ungrouped = liveView.find((group) => group.key === 'ungrouped') || null;
  const liveGroups = liveView.filter((group) => group.key !== 'ungrouped');
  return ungrouped ? [...liveGroups, ...dormantGroups, ungrouped] : [...liveGroups, ...dormantGroups];
}

function dormantGroupsFromSnapshot(snapshot = {}) {
  return (snapshot?.groups || [])
    .map((group, groupIndex) => {
      const title = group.title || 'Ungrouped';
      const key = `bookmark:${groupIndex}:${title}`;
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

  if (tabGroups.length === 0 && !ungrouped) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No tabs in this Space. Move tabs here from a tab menu, or switch Spaces from the bottom dock.';
    els.groupsList.replaceChildren(empty);
    return;
  }

  const nodes = createFolderTree(tabGroups).map(createFolderTreeNode);
  if (ungrouped) nodes.push(createUngroupedSection(ungrouped));
  els.groupsList.replaceChildren(...nodes);
}

function createFolderTree(groupsToRender) {
  const root = [];
  const folders = new Map();

  for (const group of groupsToRender) {
    const parts = folderTitleParts(group.title);
    if (parts.length <= 1) {
      root.push({ type: 'group', group });
      continue;
    }

    let children = root;
    const folderParts = parts.slice(0, -1);
    for (let index = 0; index < folderParts.length; index += 1) {
      const path = folderParts.slice(0, index + 1);
      const key = folderKey(path);
      let folder = folders.get(key);
      if (!folder) {
        folder = {
          type: 'folder',
          key,
          title: folderParts[index],
          path,
          children: [],
        };
        folders.set(key, folder);
        children.push(folder);
      }
      children = folder.children;
    }
    children.push({
      type: 'group',
      group: {
        ...group,
        displayTitle: parts.at(-1),
      },
    });
  }

  return root;
}

function createFolderTreeNode(node) {
  if (node.type === 'folder') return createFolderSection(node);
  return createGroupCard(node.group);
}

function createFolderSection(folder) {
  const collapsed = Boolean(state.collapsedGroups[folder.key]);
  const section = document.createElement('section');
  section.className = `folder-section${collapsed ? ' collapsed' : ''}`;
  section.dataset.folderKey = folder.key;
  section.style.setProperty('--folder-depth', String(Math.max(0, folder.path.length - 1)));

  const header = document.createElement('button');
  header.className = 'folder-header';
  header.type = 'button';
  header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  header.innerHTML = `
    <span class="folder-caret">${collapsed ? '›' : '⌄'}</span>
    <span class="folder-icon">▣</span>
    <strong>${escapeHtml(folder.title)}</strong>
    <span>${folderTabCount(folder)}</span>
  `;
  header.addEventListener('click', () => runTask(() => toggleFolder(folder.key)));

  const children = document.createElement('div');
  children.className = 'folder-children';
  if (!collapsed) children.replaceChildren(...folder.children.map(createFolderTreeNode));

  section.append(header, children);
  return section;
}

async function toggleFolder(folderKey) {
  state.collapsedGroups[folderKey] = !state.collapsedGroups[folderKey];
  await saveState();
  render();
}

function folderTabCount(folder) {
  return folder.children.reduce((sum, child) => (
    sum + (child.type === 'folder' ? folderTabCount(child) : child.group.tabs.length)
  ), 0);
}

function folderTitleParts(title) {
  return String(title || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

function folderKey(parts) {
  return `folder:${state.activeSpaceId}:${parts.join('/')}`;
}

function createGroupCard(group) {
  const card = document.createElement('section');
  card.className = `group-card${group.collapsed ? ' collapsed' : ''}`;
  card.draggable = !group.dormant;
  card.dataset.groupKey = group.key;
  if (!group.dormant) {
    card.addEventListener('dragstart', (event) => startGroupDrag(event, group));
    card.addEventListener('dragover', (event) => acceptGroupDrop(event, group));
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (event) => dropGroup(event, group));
    card.addEventListener('dragend', clearDragState);
  }

  const header = document.createElement('div');
  header.className = 'group-header';
  header.innerHTML = `
    <span class="group-dot" style="background:${groupColor(group.color)}"></span>
    <h2>${escapeHtml(group.displayTitle || group.title)}</h2>
    <span>${group.tabs.length}</span>
  `;
  header.addEventListener('click', () => runTask(() => toggleGroup(group)));
  if (!group.dormant) header.addEventListener('contextmenu', (event) => showGroupContextMenu(event, group));

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

  const favicon = document.createElement('span');
  favicon.className = 'favicon';
  if (tab.favIconUrl) {
    const img = document.createElement('img');
    img.src = tab.favIconUrl;
    img.alt = '';
    favicon.append(img);
  } else {
    favicon.textContent = (tab.displayTitle || tab.title || tab.domain || '?').slice(0, 1).toUpperCase();
  }

  const label = document.createElement('div');
  label.innerHTML = `
    <div class="tab-title">${escapeHtml(tab.displayTitle || tab.title || tab.url || 'Untitled')}</div>
    <div class="tab-domain">${escapeHtml(tab.domain || tab.url || '')}</div>
  `;

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (tab.dormant) {
    actions.append(actionButton('↗', 'Open', () => openDormantTab(tab, groupKey)));
  } else {
    actions.append(
      actionButton('✎', 'Rename in panel', () => renameTab(tab)),
      actionButton('×', 'Close', () => closeTab(tab)),
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

function renderSpaces() {
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
  askButton.textContent = '🧠';
  askButton.addEventListener('click', () => runTask(openAskPage));

  const addButton = document.createElement('button');
  addButton.className = 'space add-space';
  addButton.type = 'button';
  addButton.title = 'Add Space';
  addButton.setAttribute('aria-label', 'Add Space');
  addButton.textContent = '+';
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
  await send('bookmarks:removeSpace', { spaceId: space.id }).catch(() => null);
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
  await saveState();
  await refreshTabs();
}

async function clearUngroupedTabs(group) {
  const closable = group.tabs.filter(shouldAutoCloseTab);
  if (closable.length === 0) return;

  const closingIds = new Set(closable.map((tab) => tab.id));
  const remainingSpaceTabs = tabs.filter((tab) => (
    tabBelongsToSpace(tab, state.activeSpaceId) && !closingIds.has(tab.id)
  ));
  if (remainingSpaceTabs.length === 0) {
    const created = await send('tabs:create', { url: 'chrome://newtab', active: false });
    const tabId = created.tab?.id;
    if (tabId) state.tabSpaces[tabId] = state.activeSpaceId;
  }

  for (const tab of closable) {
    delete state.tabSpaces[tab.id];
    delete state.renamedTabs[tab.id];
    await send('tabs:close', { tabId: tab.id });
  }
  await saveState();
  await refreshTabs();
  setStatus(`Cleared ${closable.length} temporary tabs.`);
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

  if (group.id === 'ungrouped') {
    const tabIds = group.tabs.map((tab) => tab.id);
    if (tabIds.length === 0) return;
    const result = await send('tabs:group', {
      title: clean,
      color: 'grey',
      tabIds,
    });
    if (result.groupId) state.groupSpaces[result.groupId] = state.activeSpaceId;
    for (const tabId of tabIds) delete state.tabSpaces[tabId];
  } else {
    await send('groups:update', { groupId: group.id, update: { title: clean } });
  }

  await saveState();
  await refreshTabs();
}

async function groupSelectedTabs(tabIds) {
  const ids = tabIds.map(Number).filter(Number.isFinite);
  if (ids.length < 2) {
    setStatus('Select at least two tabs to group.');
    return;
  }

  await loadTabs({ adopt: true });
  const selectedTabs = ids
    .map((id) => tabs.find((tab) => tab.id === id))
    .filter((tab) => tab && tabBelongsToSpace(tab, state.activeSpaceId) && !tab.pinned);

  if (selectedTabs.length < 2) {
    setStatus('Select at least two tabs in this Space to group.');
    return;
  }

  const result = await send('tabs:group', {
    title: selectedGroupTitle(selectedTabs),
    color: nextGroupColor(),
    tabIds: selectedTabs.map((tab) => tab.id),
  });
  if (result.groupId) {
    state.groupSpaces[result.groupId] = state.activeSpaceId;
    addGroupOrderKey(state.activeSpaceId, `group:${result.groupId}`);
  }
  for (const tab of selectedTabs) {
    delete state.tabSpaces[tab.id];
  }
  selectedTabIds = new Set(selectedTabs.map((tab) => tab.id));
  selectionAnchorTabId = selectedTabs.at(-1)?.id ?? null;
  await saveState();
  await refreshTabs();
  setStatus(`Grouped ${selectedTabs.length} selected tabs.`);
}

async function closeTab(tab) {
  delete state.tabSpaces[tab.id];
  delete state.renamedTabs[tab.id];
  await saveState();
  await send('tabs:close', { tabId: tab.id });
  await refreshTabs();
}

async function moveTabToSpace(tab, spaceId) {
  if (tab.groupId > 0) {
    await send('tabs:ungroup', { tabIds: [tab.id] });
  }
  state.tabSpaces[tab.id] = spaceId;
  delete state.renamedTabs[tab.id];
  await saveState();
  await closeTabsOutsideActiveSpace();
  await refreshTabs();
  setStatus(`Moved tab to ${spaceName(spaceId)}.`);
}

async function moveGroupToSpace(group, spaceId) {
  if (group.id === 'ungrouped') {
    for (const tab of group.tabs) state.tabSpaces[tab.id] = spaceId;
  } else {
    state.groupSpaces[group.id] = spaceId;
  }
  await saveState();
  await closeTabsOutsideActiveSpace();
  await refreshTabs();
  setStatus(`Moved group to ${spaceName(spaceId)}.`);
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
    const existing = groups.find((group) => (
      state.groupSpaces[group.id] === state.activeSpaceId &&
      group.title === dormantGroup.title
    ));
    const result = existing
      ? await send('tabs:groupExisting', { groupId: existing.id, tabIds: [tabId] })
      : await send('tabs:group', {
        title: dormantGroup.title,
        color: dormantGroup.color,
        tabIds: [tabId],
        collapsed: false,
      });
    if (result.groupId) {
      state.groupSpaces[result.groupId] = state.activeSpaceId;
      addGroupOrderKey(state.activeSpaceId, `group:${result.groupId}`);
    }
    delete state.tabSpaces[tabId];
  }

  await saveState();
  await refreshTabs();
}

async function switchSpace(spaceId) {
  const previousSpaceId = state.activeSpaceId;
  await loadTabs({ adopt: true });
  await snapshotOpenSpace(previousSpaceId);

  activeView = 'space';

  await ensureSpaceHasOpenTab(spaceId, { active: false });

  state.activeSpaceId = spaceId;
  await loadDormantSpaceView(spaceId, { force: true });
  await focusFirstTabInSpace(spaceId, { force: true });
  await closeSpaceTabs(previousSpaceId, shouldAutoCloseTab);
  await closeTabsOutsideActiveSpace();
  await focusFirstTabInSpace(spaceId, { force: true });
  await collapseGroupsInSpace(spaceId);
  await discardInactiveTabsInSpace(spaceId);
  await saveState();
  await refreshTabs();
}

async function closeTabsOutsideActiveSpace() {
  await loadTabs({ adopt: false });

  for (const space of state.spaces) {
    if (space.id === state.activeSpaceId) continue;
    await snapshotOpenSpace(space.id);
    await closeSpaceTabs(space.id, shouldAutoCloseTab, { reloadBeforeClose: false });
  }

  await loadTabs({ adopt: false });
  const unownedOrForeignTabs = closableTabsOutsideSpace(tabs, state, state.activeSpaceId, shouldAutoCloseTab);
  for (const tab of unownedOrForeignTabs) {
    delete state.tabSpaces[tab.id];
    delete state.renamedTabs[tab.id];
    await send('tabs:close', { tabId: tab.id });
  }
  await loadTabs({ adopt: false });

  const activeSpaceTabs = tabs.filter((tab) => tabBelongsToSpace(tab, state.activeSpaceId));
  if (activeSpaceTabs.length && !activeSpaceTabs.some((tab) => tab.active)) {
    await send('tabs:focus', { tabId: preferredFocusableTab(activeSpaceTabs).id });
  }

  await saveState();
}

async function closeSpaceTabs(spaceId, shouldClose, options = {}) {
  if (options.reloadBeforeClose !== false) await loadTabs({ adopt: false });
  const closableTabs = closableTabsForSpace(tabs, state, spaceId, shouldClose);
  for (const tab of closableTabs) {
    delete state.tabSpaces[tab.id];
    delete state.renamedTabs[tab.id];
    await send('tabs:close', { tabId: tab.id });
  }
  await loadTabs({ adopt: false });
}

async function snapshotOpenSpace(spaceId) {
  const view = buildSpaceViewForSpace(spaceId);
  const snapshot = buildSpaceSnapshot({ view });
  if (snapshotTabCount(snapshot) === 0) return;
  const previousSnapshot = state.spaceSnapshots[spaceId];
  state.spaceSnapshots[spaceId] = snapshot;
  const space = state.spaces.find((item) => item.id === spaceId);
  if (space && !sameSnapshotGroups(previousSnapshot, snapshot)) await saveSpaceSnapshotToBookmarks(space, snapshot);
}

async function saveSpaceSnapshotToBookmarks(space, snapshot) {
  if (!extensionRuntime || snapshotTabCount(snapshot) === 0) return;
  await send('bookmarks:saveSpaceSnapshot', { space, snapshot }).catch(() => null);
  if (space?.id === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
}

function sameSnapshotGroups(left, right) {
  return JSON.stringify(left?.groups || []) === JSON.stringify(right?.groups || []);
}

async function ensureSpaceHasOpenTab(spaceId, options = {}) {
  await loadTabs({ adopt: false });
  if (tabs.some((tab) => tabBelongsToSpace(tab, spaceId))) return;
  const created = await send('tabs:create', { url: 'chrome://newtab', active: options.active !== false });
  const tabId = created.tab?.id;
  if (tabId) state.tabSpaces[tabId] = spaceId;
  await loadTabs({ adopt: false });
}

async function ensureSpaceOpenFromSnapshot(spaceId, options = {}) {
  await loadDormantSpaceView(spaceId, { force: true });
  await ensureSpaceHasOpenTab(spaceId, options);
  await collapseGroupsInSpace(spaceId);
}

async function collapseGroupsInSpace(spaceId) {
  await loadTabs({ adopt: false });
  const groupIds = new Set(
    tabs
      .filter((tab) => tab.groupId > 0 && tabBelongsToSpace(tab, spaceId))
      .map((tab) => tab.groupId)
  );
  for (const group of groups) {
    if (!groupIds.has(group.id)) continue;
    state.collapsedGroups[`group:${group.id}`] = true;
    if (!group.collapsed) {
      await send('groups:update', { groupId: group.id, update: { collapsed: true } });
    }
  }
  if (groupIds.size) await loadTabs({ adopt: false });
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
  const target = preferredFocusableTab(tabs.filter((tab) => tabBelongsToSpace(tab, spaceId)));
  if (target && (options.force || !target.active)) await send('tabs:focus', { tabId: target.id });
}

async function toggleGroup(group) {
  const nextCollapsed = !group.collapsed;
  state.collapsedGroups[group.key] = nextCollapsed;
  if (!group.dormant && group.id !== 'ungrouped') {
    await send('groups:update', { groupId: group.id, update: { collapsed: nextCollapsed } });
  }
  await saveState();
  await refreshTabs();
}

function startGroupDrag(event, group) {
  if (event.target.closest('.tab-row')) return;
  dragState = { type: 'group', groupKey: group.key };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', group.key);
}

function acceptGroupDrop(event, group) {
  if (dragState?.type !== 'group' || dragState.groupKey === group.key) return;
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
}

function dropGroup(event, targetGroup) {
  if (dragState?.type !== 'group') return;
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  runTask(() => reorderGroup(dragState.groupKey, targetGroup.key));
}

async function reorderGroup(sourceKey, targetKey) {
  if (!sourceKey || sourceKey === targetKey) return;
  const order = reorderKeys(spaceView.map((group) => group.key), sourceKey, targetKey);
  state.groupOrder[state.activeSpaceId] = order;

  const sourceGroupId = groupIdFromKey(sourceKey);
  const targetIndex = firstTabIndexForGroupKey(targetKey);
  if (sourceGroupId && Number.isFinite(targetIndex)) {
    await send('groups:move', { groupId: sourceGroupId, index: targetIndex });
  }

  await saveState();
  await refreshTabs();
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
  if (dragState?.type !== 'tab' || event.target.closest('.tab-row')) return;
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  runTask(() => reorderTab(dragState.tabId, targetGroup.key, null));
}

async function reorderTab(tabId, targetGroupKey, beforeTabId) {
  const tab = tabs.find((item) => item.id === Number(tabId));
  const sourceGroup = spaceView.find((group) => group.tabs.some((item) => item.id === Number(tabId)));
  const targetGroup = spaceView.find((group) => group.key === targetGroupKey);
  if (!tab || !sourceGroup || !targetGroup) return;

  const targetGroupId = groupIdFromKey(targetGroupKey);
  if (targetGroupId && tab.groupId !== targetGroupId) {
    await send('tabs:groupExisting', { groupId: targetGroupId, tabIds: [tab.id] });
    state.groupSpaces[targetGroupId] = state.activeSpaceId;
    delete state.tabSpaces[tab.id];
  } else if (!targetGroupId && tab.groupId > 0) {
    await send('tabs:ungroup', { tabIds: [tab.id] });
    state.tabSpaces[tab.id] = state.activeSpaceId;
  }

  const spaceTabOrder = ensureTabOrderForSpace(state.activeSpaceId);
  if (sourceGroup.key !== targetGroupKey) {
    spaceTabOrder[sourceGroup.key] = (spaceTabOrder[sourceGroup.key] || sourceGroup.tabs.map((item) => item.id))
      .filter((id) => id !== tab.id);
  }

  const targetIds = targetGroup.tabs.map((item) => item.id).filter((id) => id !== tab.id);
  const insertAt = beforeTabId ? Math.max(0, targetIds.indexOf(beforeTabId)) : targetIds.length;
  targetIds.splice(insertAt, 0, tab.id);
  spaceTabOrder[targetGroupKey] = targetIds;

  const targetIndex = beforeTabId
    ? tabs.find((item) => item.id === beforeTabId)?.index
    : lastTabIndexForGroup(targetGroup) + 1;
  if (Number.isFinite(targetIndex)) {
    await send('tabs:move', { tabId: tab.id, index: targetIndex });
  }

  await saveState();
  await refreshTabs();
}

function clearDragState(event) {
  event?.currentTarget?.classList?.remove('drag-over');
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
    const tabsWithContext = await addTidyContext(visibleTabs);
    Object.assign(state.renamedTabs, planTidyTabNames(tabsWithContext));
    await saveState();
    await refreshTabs();
    setStatus(`Renamed ${visibleTabs.length} tabs in the panel only.`);
  } finally {
    endPanelAction();
  }
}

async function autoGroupTabs() {
  const candidates = tabs.filter((tab) => (
    state.tabSpaces[tab.id] === state.activeSpaceId &&
    tab.groupId <= 0 &&
    !tab.url.startsWith('chrome://')
  ));
  if (candidates.length === 0) {
    setStatus('No ungrouped tabs in this Space to auto group.');
    return;
  }

  beginPanelAction('autoGroup');
  let plannedGroups = [];
  try {
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
    for (const group of plannedGroups) {
      const result = await send('tabs:group', group);
      if (result.groupId) state.groupSpaces[result.groupId] = state.activeSpaceId;
      for (const tabId of group.tabIds) delete state.tabSpaces[tabId];
    }

    await saveState();
    await refreshTabs();
    setStatus(`Created ${plannedGroups.length} tab groups in ${currentSpace().name}.`);
  } finally {
    endPanelAction();
  }
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
  els.tidyNamesButton.textContent = tidyBusy ? '…' : '🧹';
  els.autoGroupButton.textContent = groupBusy ? '…' : '🗂';
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
    await saveArcImportBookmarks(plan);
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

async function saveArcImportBookmarks(plan) {
  const spaces = Array.isArray(plan?.spaces) ? plan.spaces : [];
  const snapshots = plan?.spaceSnapshots || {};
  for (const space of spaces) {
    const snapshot = snapshots[space.id];
    if (snapshot) await saveSpaceSnapshotToBookmarks(space, snapshot);
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

  const items = [];
  if (contextTabIds.length > 1) {
    items.push(
      menuAction(`Group ${contextTabIds.length} selected tabs`, () => groupSelectedTabs(contextTabIds)),
      menuSeparator(),
    );
  }
  items.push(
    menuAction('Rename', () => renameTab(tab)),
    menuSeparator(),
    menuLabel('Move to'),
    ...state.spaces
      .filter((space) => space.id !== state.activeSpaceId)
      .map((space) => menuAction(space.name, () => moveTabToSpace(tab, space.id))),
  );

  showContextMenu(event, items);
}

function showGroupContextMenu(event, group) {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu(event, [
    menuAction('Rename', () => renameGroup(group)),
    menuSeparator(),
    menuLabel('Move to'),
    ...state.spaces
      .filter((space) => space.id !== state.activeSpaceId)
      .map((space) => menuAction(space.name, () => moveGroupToSpace(group, space.id))),
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
  els.contextMenu.replaceChildren(...items);
  els.contextMenu.hidden = false;
  els.contextMenu.style.left = '0px';
  els.contextMenu.style.top = '0px';
  const rect = els.contextMenu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - rect.width - 8);
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

function menuLabel(label) {
  const item = document.createElement('div');
  item.className = 'context-label';
  item.textContent = label;
  return item;
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
  els.apiKeyStatus.textContent = apiKeyStatusText();
  els.clearApiKeyButton.hidden = !state.ai.apiKey;
  els.clearApiKeyButton.disabled = Boolean(localConfig.ai?.apiKey);
  els.thinkingInput.value = state.ai.thinking;
  els.maxTokensInput.value = state.ai.maxTokens;
  renderShortcutSettings();
}

function apiKeyStatusText() {
  if (localConfig.ai?.apiKey) return 'API key is configured by config.local.js.';
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

async function saveSettings(event) {
  event.preventDefault();
  const shortcuts = currentShortcutsFromForm();
  const conflict = shortcutConflict(shortcuts);
  if (conflict) {
    setSettingsStatus(`${conflict.label} conflicts with ${conflict.otherLabel}. Pick a different shortcut.`);
    return;
  }
  state.ai = currentAISettingsFromForm();
  state.shortcuts = shortcuts;
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
  button.textContent = text;
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
    groupOrder: state.groupOrder,
    tabOrder: state.tabOrder,
    collapsedGroups: state.collapsedGroups,
    includeUngrouped: true,
  });
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

function addGroupOrderKey(spaceId, key) {
  const order = state.groupOrder[spaceId] || [];
  if (!order.includes(key)) state.groupOrder[spaceId] = [...order, key];
}

function ensureTabOrderForSpace(spaceId) {
  if (!state.tabOrder[spaceId]) state.tabOrder[spaceId] = {};
  return state.tabOrder[spaceId];
}

function reorderKeys(keys, sourceKey, targetKey) {
  const next = keys.filter((key) => key !== sourceKey);
  const targetIndex = next.indexOf(targetKey);
  next.splice(targetIndex < 0 ? next.length : targetIndex, 0, sourceKey);
  return next;
}

function groupIdFromKey(key) {
  const match = String(key || '').match(/^group:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function firstTabIndexForGroupKey(key) {
  const group = spaceView.find((item) => item.key === key);
  if (!group?.tabs?.length) return Number.NaN;
  const indexes = group.tabs.map((tab) => Number(tab.index)).filter(Number.isFinite);
  return indexes.length ? Math.min(...indexes) : Number.NaN;
}

function lastTabIndexForGroup(group) {
  if (!group?.tabs?.length) return tabs.length;
  const indexes = group.tabs.map((tab) => Number(tab.index)).filter(Number.isFinite);
  return indexes.length ? Math.max(...indexes) : tabs.length;
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
  els.askMessages.replaceChildren(...(session.messages || []).map(createAskMessageElement));
  els.askMessages.scrollTop = els.askMessages.scrollHeight;
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
