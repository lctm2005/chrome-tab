import { createPrompt, formatAIError, getOriginPattern, parseTidyGroups } from './src/shared/ai.js';
import {
  appendAskSessionMessage,
  createAskSession,
  pruneAskSessions,
  sessionKeyForTab,
  updateAskSessionMessage,
} from './src/shared/ask-session.js';
import { renderMarkdown } from './src/shared/markdown.js';
import { createPreviewCommandHandler, isExtensionRuntime } from './src/shared/preview-runtime.js';
import {
  findShortcutConflict,
  formatShortcut,
  mergeShortcuts,
  normalizeShortcut,
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
  removeSpaceReferences,
  syncCollapsedGroupsFromChrome,
  tabBelongsToSpace as entityBelongsToSpace,
} from './src/shared/space-membership.js';
import {
  buildSpaceView,
  compactTabForAI,
  decorateTabs,
  planTidyGroups,
  planTidyTabNames,
  sanitizeTidyGroups,
  searchTabs,
} from './src/shared/tab-utils.js';

const legacyConfigName = ['ARC', 'SIDECAR_LOCAL_CONFIG'].join('');
const localConfig = window.SPACE_TABS_CONFIG || window[legacyConfigName] || {};
const extensionRuntime = isExtensionRuntime(window);
const previewSend = createPreviewCommandHandler();

let state = createDefaultState(localConfig);
let tabs = [];
let groups = [];
let spaceView = [];
let activeView = 'space';
let dragState = null;
let activeAIRequestId = '';
let panelPort = null;

const els = {
  activeSpaceName: document.querySelector('#activeSpaceName'),
  syncStatus: document.querySelector('#syncStatus'),
  settingsButton: document.querySelector('#settingsButton'),
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
    if (message?.type === 'panel:close') window.close();
  });
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
  els.askAIButton.addEventListener('click', () => runTask(askCustomPrompt));
  els.summarizePageButton.addEventListener('click', () => runTask(summarizeCurrentPage));
  els.testAIButton.addEventListener('click', () => runTask(testAI));
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

  const action = shortcutActionFromEvent(event, shortcuts);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  void runTask(() => runShortcutAction(action));
}

function shortcutActionFromEvent(event, shortcuts) {
  for (const action of SHORTCUT_ACTIONS) {
    if (['togglePanel', 'askSubmit', 'askAbort'].includes(action.id)) continue;
    if (shortcutMatchesEvent(shortcuts[action.id], event)) return action.id;
  }
  return '';
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

async function refreshTabs() {
  await loadTabs();
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

function render() {
  const activeSpace = currentSpace();
  const searchedTabs = searchTabs(tabs, els.searchInput.value);
  spaceView = buildSpaceView({
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

  const isAskView = activeView === 'ask';
  if (isAskView) ensureCurrentAskSession();
  els.activeSpaceName.textContent = isAskView ? 'Ask Page' : activeSpace.name;
  els.syncStatus.textContent = isAskView
    ? activePageStatus()
    : extensionRuntime
      ? `${tabCount(spaceView)} tabs in ${activeSpace.name}`
      : `${tabCount(spaceView)} preview tabs in ${activeSpace.name}`;
  els.spaceSearch.hidden = isAskView;
  els.groupsList.hidden = isAskView;
  els.askPageView.hidden = !isAskView;
  els.tidyNamesButton.hidden = isAskView;
  els.autoGroupButton.hidden = isAskView;

  renderGroups();
  if (isAskView) renderAskMessages();
  renderSpaces();
  updateAIRequestUI();
}

function renderGroups() {
  const ungrouped = spaceView.find((group) => group.key === 'ungrouped') || null;
  const tabGroups = spaceView.filter((group) => group.key !== 'ungrouped');

  if (tabGroups.length === 0 && !ungrouped) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No tabs in this Space. Move tabs here from a tab menu, or switch Spaces from the bottom dock.';
    els.groupsList.replaceChildren(empty);
    return;
  }

  const nodes = tabGroups.map(createGroupCard);
  if (ungrouped) nodes.push(createUngroupedSection(ungrouped));
  els.groupsList.replaceChildren(...nodes);
}

function createGroupCard(group) {
  const card = document.createElement('section');
  card.className = `group-card${group.collapsed ? ' collapsed' : ''}`;
  card.draggable = true;
  card.dataset.groupKey = group.key;
  card.addEventListener('dragstart', (event) => startGroupDrag(event, group));
  card.addEventListener('dragover', (event) => acceptGroupDrop(event, group));
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', (event) => dropGroup(event, group));
  card.addEventListener('dragend', clearDragState);

  const header = document.createElement('div');
  header.className = 'group-header';
  header.innerHTML = `
    <span class="group-dot" style="background:${groupColor(group.color)}"></span>
    <h2>${escapeHtml(group.title)}</h2>
    <span>${group.tabs.length}</span>
  `;
  header.addEventListener('click', () => runTask(() => toggleGroup(group)));
  header.addEventListener('contextmenu', (event) => showGroupContextMenu(event, group));

  const list = document.createElement('div');
  list.className = 'tab-list';
  list.dataset.groupKey = group.key;
  list.addEventListener('dragover', (event) => acceptTabDrop(event));
  list.addEventListener('drop', (event) => dropTabAtEnd(event, group));
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
  row.className = `tab-row${tab.active ? ' active' : ''}`;
  row.tabIndex = 0;
  row.draggable = true;
  row.dataset.tabId = String(tab.id);
  row.dataset.groupKey = groupKey;

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
  actions.append(
    actionButton('✎', 'Rename in panel', () => renameTab(tab)),
    actionButton('×', 'Close', () => closeTab(tab)),
  );

  row.append(favicon, label, actions);
  row.addEventListener('click', () => runTask(() => focusTab(tab)));
  row.addEventListener('contextmenu', (event) => showTabContextMenu(event, tab));
  row.addEventListener('dragstart', (event) => startTabDrag(event, tab, groupKey));
  row.addEventListener('dragover', (event) => acceptTabDrop(event));
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', (event) => dropTabBefore(event, tab, groupKey));
  row.addEventListener('dragend', clearDragState);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runTask(() => focusTab(tab));
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
  await closeSpaceTabs(space.id, () => true);

  const fallback = state.spaces.find((item) => item.id !== space.id);
  state.spaces = state.spaces.filter((item) => item.id !== space.id);
  removeSpaceReferences(state, space.id);
  activeView = 'space';
  if (state.activeSpaceId === space.id && fallback) state.activeSpaceId = fallback.id;

  await loadTabs({ adopt: false });
  if (state.activeSpaceId) {
    if (!tabs.some((tab) => tabBelongsToSpace(tab, state.activeSpaceId))) {
      await restoreSpaceSnapshot(state.activeSpaceId);
      await loadTabs({ adopt: false });
    }
    await ensureSpaceHasOpenTab(state.activeSpaceId);
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

async function switchSpace(spaceId) {
  const previousSpaceId = state.activeSpaceId;
  await loadTabs({ adopt: true });
  snapshotOpenSpace(previousSpaceId);

  activeView = 'space';

  const hasOpenTargetTabs = tabs.some((tab) => tabBelongsToSpace(tab, spaceId));
  if (!hasOpenTargetTabs) {
    await restoreSpaceSnapshot(spaceId);
    await loadTabs({ adopt: false });
  }
  await ensureSpaceHasOpenTab(spaceId, { active: false });

  state.activeSpaceId = spaceId;
  await focusFirstTabInSpace(spaceId);
  await closeSpaceTabs(previousSpaceId, shouldAutoCloseTab);
  await closeTabsOutsideActiveSpace();
  await saveState();
  await refreshTabs();
}

async function closeTabsOutsideActiveSpace() {
  await loadTabs({ adopt: false });

  for (const space of state.spaces) {
    if (space.id === state.activeSpaceId) continue;
    snapshotOpenSpace(space.id);
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
    await send('tabs:focus', { tabId: activeSpaceTabs[0].id });
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

function snapshotOpenSpace(spaceId) {
  const view = buildSpaceViewForSpace(spaceId);
  const snapshot = buildSpaceSnapshot({ view });
  if (snapshotTabCount(snapshot) > 0) state.spaceSnapshots[spaceId] = snapshot;
}

async function restoreSpaceSnapshot(spaceId) {
  const snapshot = state.spaceSnapshots[spaceId];
  if (!snapshot || snapshotTabCount(snapshot) === 0) return;

  let firstTabId = null;
  for (const group of snapshot.groups || []) {
    const createdTabIds = [];
    for (const tab of group.tabs || []) {
      const created = await send('tabs:create', { url: tab.url, active: false });
      const tabId = created.tab?.id;
      if (!tabId) continue;
      if (!firstTabId) firstTabId = tabId;
      createdTabIds.push(tabId);
    }

    if (createdTabIds.length === 0) continue;
    if (isUngroupedSnapshotGroup(group)) {
      for (const tabId of createdTabIds) state.tabSpaces[tabId] = spaceId;
      continue;
    }

    const result = await send('tabs:group', {
      title: group.title,
      color: group.color,
      tabIds: createdTabIds,
      collapsed: Boolean(group.collapsed),
    });
    if (result.groupId) {
      state.groupSpaces[result.groupId] = spaceId;
      addGroupOrderKey(spaceId, `group:${result.groupId}`);
    }
  }

  if (firstTabId) await send('tabs:focus', { tabId: firstTabId });
}

async function ensureSpaceHasOpenTab(spaceId, options = {}) {
  await loadTabs({ adopt: false });
  if (tabs.some((tab) => tabBelongsToSpace(tab, spaceId))) return;
  const created = await send('tabs:create', { url: 'chrome://newtab', active: options.active !== false });
  const tabId = created.tab?.id;
  if (tabId) state.tabSpaces[tabId] = spaceId;
  await loadTabs({ adopt: false });
}

async function focusFirstTabInSpace(spaceId) {
  await loadTabs({ adopt: false });
  const target = tabs.find((tab) => tabBelongsToSpace(tab, spaceId));
  if (target && !target.active) await send('tabs:focus', { tabId: target.id });
}

async function toggleGroup(group) {
  const nextCollapsed = !group.collapsed;
  state.collapsedGroups[group.key] = nextCollapsed;
  if (group.id !== 'ungrouped') {
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

  Object.assign(state.renamedTabs, planTidyTabNames(visibleTabs));
  await saveState();
  await refreshTabs();
  setStatus(`Renamed ${visibleTabs.length} tabs in the panel only.`);
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

  let plannedGroups = [];
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

function showTabContextMenu(event, tab) {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu(event, [
    menuAction('Rename', () => renameTab(tab)),
    menuSeparator(),
    menuLabel('Move to'),
    ...state.spaces
      .filter((space) => space.id !== state.activeSpaceId)
      .map((space) => menuAction(space.name, () => moveTabToSpace(tab, space.id))),
  ]);
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
  els.thinkingInput.value = state.ai.thinking;
  els.maxTokensInput.value = state.ai.maxTokens;
  renderShortcutSettings();
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
  await secretSet({ [SECRET_STORAGE_KEY]: { ai: { apiKey: state.ai.apiKey } } });
  await saveState();
  els.settingsDialog.close();
  render();
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
