import {
  createPrompt,
  formatAIError,
  getOriginPattern,
  parseTidyGroups,
  parseTidyNames,
} from './src/shared/ai.js';
import {
  AI_PROVIDER_CATALOG,
  CUSTOM_AI_PROVIDER_ID,
  normalizeAIProviderSettings,
  providerRequiresApiKey,
  providerById,
} from './src/shared/ai-providers.js';
import {
  appendAskSessionMessage,
  createSpaceAskSession,
  pruneAskSessions,
  sessionKeyForSpace,
  updateAskSessionMessage,
} from './src/shared/ask-session.js';
import {
  appendAskSourceLinks,
  selectAskSpaceSources,
} from './src/shared/ask-sources.js';
import {
  appendArcImportPlan,
  createArcImportPlan,
  selectArcImportPlan,
} from './src/shared/arc-import.js';
import { buildCommandPaletteItems } from './src/shared/command-palette.js';
import {
  createFolderTree,
  folderTitleParts,
  movedGroupTitleForFolderDrop,
  renamedFolderGroupTitle,
} from './src/shared/folder-tree.js';
import { renderMarkdown } from './src/shared/markdown.js';
import {
  applyOrganizationPlanToSnapshot,
  buildOrganizationCandidates,
} from './src/shared/organization-plan.js';
import {
  fingerprintTidyNameTargets,
  isOperationUndoVisible,
} from './src/shared/operation-safety.js';
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
  comparableSnapshotUrl,
  dropTemporarySnapshotGroups,
  isUngroupedSnapshotGroup,
  mergeOpenSpaceSnapshot,
  removeSnapshotTabs,
  removeSnapshotTab,
  sanitizeSpaceSnapshot,
  shouldAutoCloseTab,
  snapshotGroupShouldPersist,
  snapshotHasPersistentContent,
  snapshotTabCount,
  updateSnapshotTab,
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
  assertWorkspaceStorageBudget,
  createSpaceBackup,
  fingerprintPortableSpacesContent,
  fingerprintPortableWorkspaceContent,
  parseSpaceBackup,
  restoreSpaceBackup,
} from './src/shared/space-transfer.js';
import {
  buildGroupPreviewItems,
  buildSpaceView,
  compactTabForAI,
  decorateTabs,
  domainFromUrl,
  groupTitleKey,
  isPageShortcutCapableUrl,
  planGroupPreviewPlacement,
  planTidyTabNames,
  preferredFocusableTab,
  sanitizeTidyGroups,
  titleForDomain,
} from './src/shared/tab-utils.js';

const legacyConfigName = ['ARC', 'SIDECAR_LOCAL_CONFIG'].join('');
const localConfig = window.SPACE_TABS_CONFIG || window[legacyConfigName] || {};
const extensionRuntime = isExtensionRuntime(window);
const pageParams = new URLSearchParams(window.location.search);
const layoutMode = pageParams.get('layout') === 'workbench'
  ? 'workbench'
  : 'sidepanel';
const workbenchMode = layoutMode === 'workbench';
document.documentElement.dataset.layout = layoutMode;
const previewSend = createPreviewCommandHandler();
const CUSTOM_MODEL_VALUE = '__custom__';
const GROUP_PREVIEW_OPEN_DELAY_MS = 2000;
const GROUP_PREVIEW_CLOSE_DELAY_MS = 140;
const OPERATION_UNDO_VISIBLE_MS = 10_000;
const TIDY_NAMES_ICON = `
  <span class="tidy-icon" aria-hidden="true">🧹</span>
`;
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
let activeView = workbenchMode && pageParams.get('view') === 'settings'
  ? 'settings'
  : workbenchMode
  ? 'ask'
  : 'space';
let dragState = null;
let activeAIRequestId = '';
let activePanelAction = '';
let panelPort = null;
let panelWindowId = null;
let selectedTabIds = new Set();
let selectionAnchorTabId = null;
let pendingArcImportText = '';
let pendingArcImportPlan = null;
let arcImportSelectionGeneration = 0;
let pendingSpaceBackup = null;
let pendingOnboardingArcPlan = null;
let pendingOnboardingArcText = '';
let onboardingArcSelectionGeneration = 0;
let onboardingStep = 0;
let onboardingPath = '';
let onboardingResult = '';
let renderedGroupContexts = new Map();
let renderedGroupDragContexts = new Map();
let lastGroupDragEndedAt = 0;
let lastRenderedGroupsSignature = '';
let lastRenderedAskSignature = '';
let lastRenderedSpacesSignature = '';
let recentlyOpenedDormantTabs = [];
let groupPreviewPopover = null;
let groupPreviewAnchor = null;
let groupPreviewGroup = null;
let groupPreviewQuery = '';
let groupPreviewOpenTimer = 0;
let groupPreviewCloseTimer = 0;
let workbenchToastTimer = 0;
let workbenchToastHideTimer = 0;
let operationRecordHideTimer = 0;
let activeTaskCount = 0;
let taskQueue = Promise.resolve();
let sharedRefreshRunning = false;
let commandPaletteItems = [];
let commandPaletteIndex = 0;
const activeAskStreams = new Map();

const SHARED_STATE_LOCK_NAME = 'space-tabs-shared-state';

const els = {
  activeSpaceName: document.querySelector('#activeSpaceName'),
  syncStatus: document.querySelector('#syncStatus'),
  settingsButton: document.querySelector('#settingsButton'),
  commandPaletteButton: document.querySelector('#commandPaletteButton'),
  openWorkbenchButton: document.querySelector('#openWorkbenchButton'),
  collapseGroupsButton: document.querySelector('#collapseGroupsButton'),
  tidyNamesButton: document.querySelector('#tidyNamesButton'),
  autoGroupButton: document.querySelector('#autoGroupButton'),
  groupsList: document.querySelector('#groupsList'),
  askPageView: document.querySelector('#askPageView'),
  askScope: document.querySelector('#askScope'),
  askProvider: document.querySelector('#askProvider'),
  askSourceSummary: document.querySelector('#askSourceSummary'),
  askSourceHint: document.querySelector('#askSourceHint'),
  askSourceList: document.querySelector('#askSourceList'),
  askMessages: document.querySelector('#askMessages'),
  askPagePrompt: document.querySelector('#askPagePrompt'),
  askAIButton: document.querySelector('#askAIButton'),
  testAIButton: document.querySelector('#testAIButton'),
  settingsStatus: document.querySelector('#settingsStatus'),
  arcImportInput: document.querySelector('#arcImportInput'),
  arcImportChooseButton: document.querySelector('#arcImportChooseButton'),
  importArcButton: document.querySelector('#importArcButton'),
  undoArcImportButton: document.querySelector('#undoArcImportButton'),
  arcImportStatus: document.querySelector('#arcImportStatus'),
  exportSpaceDataButton: document.querySelector('#exportSpaceDataButton'),
  spaceBackupInput: document.querySelector('#spaceBackupInput'),
  restoreSpaceDataButton: document.querySelector('#restoreSpaceDataButton'),
  spaceBackupStatus: document.querySelector('#spaceBackupStatus'),
  spacesList: document.querySelector('#spacesList'),
  contextMenu: document.querySelector('#contextMenu'),
  workbenchToast: document.querySelector('#workbenchToast'),
  operationRecord: document.querySelector('#operationRecord'),
  operationRecordText: document.querySelector('#operationRecordText'),
  undoOrganizationButton: document.querySelector('#undoOrganizationButton'),
  actionDialog: document.querySelector('#actionDialog'),
  actionDialogTitle: document.querySelector('#actionDialogTitle'),
  actionDialogMessage: document.querySelector('#actionDialogMessage'),
  actionDialogPreview: document.querySelector('#actionDialogPreview'),
  actionDialogLabel: document.querySelector('#actionDialogLabel'),
  actionDialogInput: document.querySelector('#actionDialogInput'),
  actionDialogClose: document.querySelector('#actionDialogClose'),
  actionDialogCancel: document.querySelector('#actionDialogCancel'),
  actionDialogConfirm: document.querySelector('#actionDialogConfirm'),
  settingsDialog: document.querySelector('#settingsDialog'),
  runOnboardingButton: document.querySelector('#runOnboardingButton'),
  settingsOpenWorkbenchButton: document.querySelector('#settingsOpenWorkbenchButton'),
  onboardingDialog: document.querySelector('#onboardingDialog'),
  onboardingProgress: document.querySelector('#onboardingProgress'),
  onboardingStepLabel: document.querySelector('#onboardingStepLabel'),
  onboardingChooseStep: document.querySelector('#onboardingChooseStep'),
  onboardingFreshStep: document.querySelector('#onboardingFreshStep'),
  onboardingArcStep: document.querySelector('#onboardingArcStep'),
  onboardingFinishStep: document.querySelector('#onboardingFinishStep'),
  onboardingFooter: document.querySelector('#onboardingFooter'),
  onboardingSpaceNameInput: document.querySelector('#onboardingSpaceNameInput'),
  onboardingArcInput: document.querySelector('#onboardingArcInput'),
  onboardingArcChooseButton: document.querySelector('#onboardingArcChooseButton'),
  onboardingArcStatus: document.querySelector('#onboardingArcStatus'),
  onboardingArcSpaces: document.querySelector('#onboardingArcSpaces'),
  onboardingFinishMessage: document.querySelector('#onboardingFinishMessage'),
  onboardingProviderInput: document.querySelector('#onboardingProviderInput'),
  onboardingBaseUrlInput: document.querySelector('#onboardingBaseUrlInput'),
  onboardingModelInput: document.querySelector('#onboardingModelInput'),
  onboardingCustomModelLabel: document.querySelector('#onboardingCustomModelLabel'),
  onboardingCustomModelInput: document.querySelector('#onboardingCustomModelInput'),
  onboardingApiKeyInput: document.querySelector('#onboardingApiKeyInput'),
  onboardingThinkingInput: document.querySelector('#onboardingThinkingInput'),
  onboardingTestAIButton: document.querySelector('#onboardingTestAIButton'),
  onboardingAIStatus: document.querySelector('#onboardingAIStatus'),
  onboardingSkipAIButton: document.querySelector('#onboardingSkipAIButton'),
  onboardingBackButton: document.querySelector('#onboardingBackButton'),
  onboardingNextButton: document.querySelector('#onboardingNextButton'),
  skipOnboardingButton: document.querySelector('#skipOnboardingButton'),
  onboardingOpenWorkbenchButton: document.querySelector('#onboardingOpenWorkbenchButton'),
  onboardingExportButton: document.querySelector('#onboardingExportButton'),
  onboardingUndoArcButton: document.querySelector('#onboardingUndoArcButton'),
  providerInput: document.querySelector('#providerInput'),
  baseUrlInput: document.querySelector('#baseUrlInput'),
  modelInput: document.querySelector('#modelInput'),
  customModelLabel: document.querySelector('#customModelLabel'),
  customModelInput: document.querySelector('#customModelInput'),
  languageInput: document.querySelector('#languageInput'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  apiKeyStatus: document.querySelector('#apiKeyStatus'),
  clearApiKeyButton: document.querySelector('#clearApiKeyButton'),
  thinkingInput: document.querySelector('#thinkingInput'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  shortcutsList: document.querySelector('#shortcutsList'),
  themeOptions: document.querySelector('.theme-options'),
  commandPaletteDialog: document.querySelector('#commandPaletteDialog'),
  commandPaletteInput: document.querySelector('#commandPaletteInput'),
  commandPaletteResults: document.querySelector('#commandPaletteResults'),
};

if (workbenchMode) document.querySelector('.shell').append(els.settingsDialog);

init();

async function init() {
  try {
    clearLegacyArcFileHandleStorage();
    panelWindowId = await currentPanelWindowId();
    if (!workbenchMode) connectPanelPort();
    await withSharedStateLock(async () => {
      await loadState({ stateLocked: true });
      await refreshTabs({ adopt: true });
    });
    bindEvents();
    renderSettings();
    await maybeShowOnboarding();
    if (extensionRuntime) setInterval(() => void refreshSharedState(), 2500);
  } catch (error) {
    els.syncStatus.textContent = 'Failed to initialize';
    if (activeView === 'ask') {
      try {
        await addAskMessage('assistant', formatAIError(error));
      } catch (persistenceError) {
        console.error(persistenceError);
      }
    }
    console.error(error);
  }
}

function clearLegacyArcFileHandleStorage() {
  try {
    window.indexedDB?.deleteDatabase?.('space-tabs-local-files');
  } catch {
    // Older builds stored a FileSystemFileHandle here. It is obsolete because
    // Chromium blocks that API from choosing Arc's file under macOS ~/Library.
  }
}

async function currentPanelWindowId() {
  if (!extensionRuntime || !chrome.windows?.getCurrent) return null;
  try {
    const currentWindow = await chrome.windows.getCurrent();
    return Number.isFinite(currentWindow?.id) ? currentWindow.id : null;
  } catch {
    return null;
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
  void withSharedStateLock(async () => {
    await syncStateFromStorage();
    await loadTabs({ adopt: false });
    snapshotOpenSpace(state.activeSpaceId);
    await saveState();
  });
}

async function loadState(options = {}) {
  const load = async () => {
    await syncStateFromStorage();
    await saveState();
  };
  if (options.stateLocked) return load();
  return withSharedStateLock(load);
}

async function syncStateFromStorage() {
  const tempTheme = state?.tempTheme;
  const defaults = createDefaultState(localConfig);
  const [stored, secrets] = await Promise.all([storageGet(), secretGet()]);
  const nextState = mergeStoredState(stored[STORAGE_KEY], defaults);

  if (localConfig.ai?.apiKey) {
    const localAISettings = { ...localConfig.ai };
    delete localAISettings.maxTokens;
    nextState.ai = {
      ...localAISettings,
      ...nextState.ai,
      apiKey: localConfig.ai.apiKey,
      baseUrl: String(nextState.ai.baseUrl || localConfig.ai.baseUrl || '').trim().replace(/\/+$/, ''),
      temperature: Number(nextState.ai.temperature ?? localConfig.ai.temperature ?? 0.6),
    };
  } else if (secrets[SECRET_STORAGE_KEY]?.ai?.apiKey) {
    nextState.ai.apiKey = secrets[SECRET_STORAGE_KEY].ai.apiKey;
  }

  if (tempTheme) nextState.tempTheme = tempTheme;
  state = nextState;
  applyTheme(state.tempTheme || state.theme);
  sanitizeStoredSpaceSnapshots();
  lastRenderedGroupsSignature = '';
  lastRenderedAskSignature = '';
  lastRenderedSpacesSignature = '';
  return state;
}

async function saveState() {
  await storageSet({ [STORAGE_KEY]: stateForStorage() });
}

function bindEvents() {
  if (extensionRuntime && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleRuntimeEvent);
  }
  els.settingsButton.addEventListener('click', () => runTask(async () => {
    if (!workbenchMode) {
      await openWorkbench({ view: 'settings' });
      return;
    }
    state.tempTheme = state.theme || 'purple';
    renderSettings();
    activeView = 'settings';
    render();
  }));
  els.openWorkbenchButton.addEventListener('click', () => runTask(openWorkbench));
  els.commandPaletteButton.addEventListener('click', openCommandPalette);
  els.undoOrganizationButton.addEventListener('click', () => runTask(undoLastOperation));
  els.settingsOpenWorkbenchButton.addEventListener('click', () => runTask(openWorkbench));
  els.runOnboardingButton.addEventListener('click', () => {
    els.settingsDialog.close();
    activeView = workbenchMode ? 'ask' : 'space';
    render();
    openOnboarding({ restart: true });
  });
  els.tidyNamesButton.addEventListener('click', startTidyNamesFromUserGesture);
  els.autoGroupButton.addEventListener('click', startAutoGroupFromUserGesture);
  els.collapseGroupsButton.addEventListener('click', () => runTask(toggleSpaceGroups));
  els.askAIButton.addEventListener('click', startAskFromUserGesture);
  els.testAIButton.addEventListener('click', () => startTestAIFromUserGesture(settingsAIControls()));
  els.clearApiKeyButton.addEventListener('click', () => runTask(clearApiKey));
  els.providerInput.addEventListener('change', () => renderAIProviderFields(settingsFromProviderSelection()));
  els.modelInput.addEventListener('change', () => updateCustomModelVisibility());
  els.arcImportInput.addEventListener('change', () => runTask(previewArcImportFile));
  els.arcImportInput.addEventListener('cancel', (event) => event.stopPropagation());
  els.arcImportChooseButton.addEventListener('click', () => startArcFileSelectionFromUserGesture('settings'));
  els.importArcButton.addEventListener('click', () => runTask(importArcFile));
  els.undoArcImportButton.addEventListener('click', () => runTask(undoLastArcImport));
  els.exportSpaceDataButton.addEventListener('click', () => runTask(exportSpaceData));
  els.spaceBackupInput.addEventListener('change', () => runTask(previewSpaceBackupFile));
  els.restoreSpaceDataButton.addEventListener('click', () => runTask(restoreSpaceData));
  els.saveSettingsButton.addEventListener('click', (event) => {
    event.preventDefault();
    runTask(() => saveSettings());
  });
  els.onboardingSpaceNameInput.addEventListener('input', renderOnboarding);
  for (const button of els.onboardingDialog.querySelectorAll('[data-onboarding-path]')) {
    button.addEventListener('click', () => {
      const path = button.dataset.onboardingPath;
      chooseOnboardingPath(path);
      if (path === 'arc') startArcFileSelectionFromUserGesture('onboarding');
    });
  }
  els.onboardingArcInput.addEventListener('change', () => runTask(previewOnboardingArcFile));
  els.onboardingArcInput.addEventListener('cancel', (event) => event.stopPropagation());
  els.onboardingArcChooseButton.addEventListener('click', () => startArcFileSelectionFromUserGesture('onboarding'));
  els.onboardingArcSpaces.addEventListener('change', renderOnboarding);
  els.onboardingProviderInput.addEventListener('change', () => {
    renderAIProviderFields(
      settingsFromProviderSelection(onboardingAIControls()),
      onboardingAIControls(),
    );
    renderOnboarding();
  });
  els.onboardingModelInput.addEventListener('change', () => {
    updateCustomModelVisibility(onboardingAIControls());
    renderOnboarding();
  });
  els.onboardingCustomModelInput.addEventListener('input', renderOnboarding);
  els.onboardingBaseUrlInput.addEventListener('input', renderOnboarding);
  els.onboardingApiKeyInput.addEventListener('input', renderOnboarding);
  els.onboardingThinkingInput.addEventListener('change', renderOnboarding);
  els.onboardingTestAIButton.addEventListener('click', () => startTestAIFromUserGesture(onboardingAIControls()));
  els.onboardingSkipAIButton.addEventListener('click', () => runTask(() => finishOnboarding(true)));
  els.onboardingBackButton.addEventListener('click', goBackOnboarding);
  els.onboardingNextButton.addEventListener('click', () => runTask(continueOnboarding));
  els.skipOnboardingButton.addEventListener('click', () => runTask(() => finishOnboarding(false)));
  els.onboardingOpenWorkbenchButton.addEventListener('click', () => runTask(saveOnboardingAIAndFinish));
  els.onboardingExportButton.addEventListener('click', () => runTask(exportSpaceData));
  els.onboardingUndoArcButton.addEventListener('click', () => runTask(async () => {
    clearOnboardingArcSelection();
    els.onboardingApiKeyInput.value = '';
    els.onboardingDialog.close();
    await undoLastArcImport({ confirm: false });
  }));
  els.onboardingDialog.addEventListener('cancel', (event) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    clearOnboardingArcSelection();
    els.onboardingApiKeyInput.value = '';
    els.onboardingDialog.close();
    render();
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
    clearSettingsArcSelection();
    if (state.tempTheme) {
      applyTheme(state.theme);
      delete state.tempTheme;
    }
    if (workbenchMode && activeView === 'settings') {
      activeView = 'ask';
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      window.history.replaceState(null, '', url);
      render();
    }
  });

  els.commandPaletteInput.addEventListener('input', () => renderCommandPalette());
  els.commandPaletteResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-command-index]');
    if (!button) return;
    commandPaletteIndex = Number(button.dataset.commandIndex) || 0;
    const prepared = prepareSelectedCommandPaletteItemFromUserGesture();
    void runTask(() => runSelectedCommandPaletteItem(prepared));
  });
  els.commandPaletteDialog.addEventListener('keydown', handleCommandPaletteKeydown);
  els.commandPaletteDialog.addEventListener('close', () => {
    commandPaletteItems = [];
    commandPaletteIndex = 0;
  });

  window.addEventListener('contextmenu', handleGroupHeaderContextMenu, { capture: true });
  window.addEventListener('mousedown', handleGroupHeaderMouseDown, { capture: true });
  els.groupsList.addEventListener('scroll', () => positionGroupPreview(), { passive: true });
  window.addEventListener('resize', hideGroupPreview);
  document.addEventListener('click', () => {
    hideContextMenu();
    hideGroupPreview();
  });
  document.addEventListener('keydown', handleDocumentKeydown, { capture: true });
}

function handleRuntimeEvent(message) {
  if (message?.type !== 'ai:stream' || !message.requestId) return;
  const stream = activeAskStreams.get(message.requestId);
  if (!stream) return;
  stream.text = String(message.text || '');
  void updateAskMessage(stream.messageRef, stream.text || 'Thinking...', { persist: false });
}

function handleDocumentKeydown(event) {
  const shortcutInput = event.target?.closest?.('.shortcut-input');
  if (shortcutInput) {
    captureShortcutInput(event, shortcutInput);
    return;
  }

  if (event.key === 'Escape') {
    hideContextMenu();
    hideGroupPreview();
  }

  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    event.stopPropagation();
    openCommandPalette();
    return;
  }

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
    else startAskFromUserGesture();
    return;
  }

  if (isEditableTarget(event.target) && shouldIgnoreShortcutInEditable(event)) return;

  const action = shortcutActionFromEvent(event, shortcuts, {
    exclude: ['togglePanel', 'askSubmit', 'askAbort'],
  });
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  const organizationRequest = prepareOrganizationRequestForAction(action);
  void runTask(() => runShortcutAction(action, organizationRequest));
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

function openCommandPalette() {
  if (els.onboardingDialog.open || els.actionDialog.open) return;
  if (els.settingsDialog.open && !workbenchMode) els.settingsDialog.close();
  els.commandPaletteInput.value = '';
  commandPaletteIndex = 0;
  renderCommandPalette();
  if (!els.commandPaletteDialog.open) els.commandPaletteDialog.showModal();
  requestAnimationFrame(() => els.commandPaletteInput.focus());
}

function renderCommandPalette() {
  commandPaletteItems = buildCommandPaletteItems({
    spaces: state.spaces,
    spaceView,
    query: els.commandPaletteInput.value,
  });
  commandPaletteIndex = Math.max(0, Math.min(commandPaletteIndex, commandPaletteItems.length - 1));
  const nodes = commandPaletteItems.map((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-palette-item';
    button.classList.toggle('active', index === commandPaletteIndex);
    button.dataset.commandIndex = String(index);
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(index === commandPaletteIndex));
    const icon = document.createElement('span');
    icon.textContent = item.icon || '•';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const meta = document.createElement('small');
    meta.textContent = item.meta || '';
    button.append(icon, title, meta);
    return button;
  });
  if (nodes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No matching Spaces, tabs, or commands.';
    nodes.push(empty);
  }
  els.commandPaletteResults.replaceChildren(...nodes);
}

function handleCommandPaletteKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (commandPaletteItems.length === 0) return;
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    commandPaletteIndex = (commandPaletteIndex + offset + commandPaletteItems.length) % commandPaletteItems.length;
    renderCommandPalette();
    els.commandPaletteResults.querySelector(`[data-command-index="${commandPaletteIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (event.key === 'Enter' && event.target === els.commandPaletteInput) {
    event.preventDefault();
    const prepared = prepareSelectedCommandPaletteItemFromUserGesture();
    void runTask(() => runSelectedCommandPaletteItem(prepared));
  }
}

function prepareOrganizationRequestForAction(action) {
  if (action === 'tidy' || action === 'tidyNames') return prepareTidyNamesRequestFromUserGesture();
  if (action === 'auto-group' || action === 'autoGroup') return prepareAutoGroupRequestFromUserGesture();
  return null;
}

function prepareSelectedCommandPaletteItemFromUserGesture() {
  const item = commandPaletteItems[commandPaletteIndex] || null;
  return {
    item,
    organizationRequest: prepareOrganizationRequestForAction(item?.action),
  };
}

async function runSelectedCommandPaletteItem(prepared = {}) {
  const item = prepared.item || commandPaletteItems[commandPaletteIndex];
  if (!item) return;
  if (els.commandPaletteDialog.open) els.commandPaletteDialog.close();
  if (item.kind === 'space') {
    await activateSpace(item.spaceId);
    return;
  }
  if (item.kind === 'tab') {
    if (item.tab.dormant) await openDormantTab(item.tab, item.tab.dormantGroupKey);
    else await send('tabs:focus', { tabId: item.tab.id });
    return;
  }
  if (item.action === 'ask') await openAskPage();
  else if (item.action === 'tidy') await tidyTabNames(prepared.organizationRequest || {});
  else if (item.action === 'auto-group') await autoGroupTabs(prepared.organizationRequest || {});
  else if (item.action === 'settings') {
    if (!workbenchMode) await openWorkbench({ view: 'settings' });
    else {
      activeView = 'settings';
      render();
    }
  }
}

function isEditableTarget(target) {
  const node = target?.closest?.('input, textarea, select, [contenteditable="true"]');
  return Boolean(node);
}

async function runShortcutAction(action, organizationRequest = null) {
  if (action === 'openAsk') {
    await openAskPage();
    return;
  }
  if (action === 'tidyNames') {
    await tidyTabNames(organizationRequest || {});
    return;
  }
  if (action === 'autoGroup') {
    await autoGroupTabs(organizationRequest || {});
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
    activeView = activeView === 'space' ? 'ask' : 'space';
    render();
    return;
  }
  window.close();
  setTimeout(() => setStatus('Use the Chrome shortcut again to open Space.'), 120);
}

async function refreshTabs(options = {}) {
  await loadTabs({
    adopt: Boolean(options.adopt),
    adoptGroups: Boolean(options.adoptGroups ?? options.adopt),
    skipSnapshotCleanupForTabIds: options.skipSnapshotCleanupForTabIds,
  });
  if (await materializeLegacyVirtualGroups(state.activeSpaceId)) {
    await loadTabs({ adopt: false });
  }
  snapshotOpenSpace(state.activeSpaceId);
  await loadDormantSpaceView(state.activeSpaceId, { force: Boolean(options.reloadDormant) });
  render();
  await saveState();
}

async function refreshSharedState() {
  if (sharedRefreshRunning || activeTaskCount > 0) return;
  sharedRefreshRunning = true;
  try {
    await withSharedStateLock(async () => {
      await syncStateFromStorage();
      await refreshTabs({ adopt: true });
    });
  } catch (error) {
    console.error(error);
  } finally {
    sharedRefreshRunning = false;
  }
}

async function loadTabs({
  adopt = false,
  adoptGroups = false,
  skipSnapshotCleanupForTabIds = [],
} = {}) {
  const previousTabs = tabs;
  const response = await send('tabs:list');
  tabs = decorateTabs(response.tabs || [], state);
  groups = response.groups || [];
  const contentTabs = tabs.filter((tab) => !isEphemeralTab(tab));
  removeStaleActiveSpaceTabsFromSnapshot(previousTabs, contentTabs, {
    skipTabIds: skipSnapshotCleanupForTabIds,
  });
  cleanupEphemeralTabIds();
  restoreSnapshotOwnership(state, contentTabs, groups);
  if (adopt) adoptUnassignedEntities(state, contentTabs, groups, state.activeSpaceId, { adoptGroups });
  else cleanupMissingEntities(state, contentTabs, groups);
  syncCollapsedGroupsFromChrome(state, groups);
}

function removeStaleActiveSpaceTabsFromSnapshot(previousTabs = [], currentTabs = [], options = {}) {
  if (!previousTabs.length || !state.activeSpaceId) return;
  const skipTabIds = new Set((options.skipTabIds || []).map(Number).filter(Number.isFinite));
  const currentPool = currentTabs.map((tab) => ({
    tab,
    urlIdentity: snapshotUrlIdentity(tab.url),
    consumed: false,
  }));
  const previousPool = previousTabs
    .filter((tab) => {
      if (skipTabIds.has(Number(tab.id))) return false;
      return !isEphemeralTab(tab) && tabBelongsToSpace(tab, state.activeSpaceId);
    })
    .map((tab) => ({
      tab,
      urlIdentity: snapshotUrlIdentity(tab.url),
      matched: false,
    }))
    .filter((entry) => entry.urlIdentity);

  // Reserve surviving browser-tab identities before matching duplicate URLs.
  // Otherwise an earlier closed duplicate can consume the one live row and make
  // the surviving tab look stale in its original Tag.
  for (const previous of previousPool) {
    const sameTabMatch = currentPool.find((current) => (
      !current.consumed &&
      Number(current.tab.id) === Number(previous.tab.id) &&
      current.urlIdentity === previous.urlIdentity
    ));
    if (!sameTabMatch) continue;
    sameTabMatch.consumed = true;
    previous.matched = true;
  }
  for (const previous of previousPool) {
    if (previous.matched) continue;
    const exactUrlMatch = currentPool.find((current) => (
      !current.consumed && current.urlIdentity === previous.urlIdentity
    ));
    if (!exactUrlMatch) continue;
    exactUrlMatch.consumed = true;
    previous.matched = true;
  }

  const staleTabs = previousPool
    .filter((entry) => !entry.matched)
    .map((entry) => {
      const previousGroup = spaceView.find((group) => (group.tabs || []).some((tab) => (
        !tab.dormant &&
        Number(tab.id) === Number(entry.tab.id) &&
        snapshotUrlIdentity(tab.url) === entry.urlIdentity
      )));
      return {
        ...entry.tab,
        groupTitle: previousGroup?.title || '',
        groupColor: previousGroup?.color || '',
      };
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
  if (workbenchMode && activeView === 'space') activeView = 'ask';
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

  const isSpaceView = activeView === 'space';
  const isAskView = activeView === 'ask';
  const isSettingsView = activeView === 'settings';
  const showSources = workbenchMode || isSpaceView;
  const groupsCollapsed = showSources && isSpaceGroupsCollapsed();
  if (isAskView) ensureCurrentAskSession();
  els.activeSpaceName.textContent = activeSpace.name;
  els.syncStatus.textContent = activePanelAction
    ? panelActionStatus(activePanelAction)
    : isAskView
    ? 'Ask Space'
    : isSettingsView
    ? 'Settings'
    : '';
  els.groupsList.hidden = !showSources;
  els.askPageView.hidden = !isAskView;
  if (!showSources) hideGroupPreview();
  els.tidyNamesButton.hidden = !showSources;
  els.autoGroupButton.hidden = !showSources;
  els.collapseGroupsButton.hidden = !showSources;
  els.openWorkbenchButton.hidden = workbenchMode;
  els.settingsButton.classList.toggle('active', isSettingsView);
  if (workbenchMode) {
    if (isSettingsView && !els.settingsDialog.open) els.settingsDialog.show();
    if (!isSettingsView && els.settingsDialog.open) els.settingsDialog.close();
  }
  els.collapseGroupsButton.innerHTML = groupsCollapsed
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
  els.collapseGroupsButton.title = groupsCollapsed ? 'Expand groups' : 'Collapse groups';
  els.collapseGroupsButton.setAttribute('aria-label', els.collapseGroupsButton.title);
  els.collapseGroupsButton.classList.toggle('active', groupsCollapsed);
  els.groupsList.classList.toggle('groups-collapsed', groupsCollapsed);

  renderGroups();
  if (isAskView) {
    els.askScope.textContent = `${activeSpace.name} · sources stay local until you confirm an Ask`;
    renderAskDisclosure();
    renderAskMessages();
  }
  renderSpaces();
  renderOperationRecord();
  updateAIRequestUI();
  updateOrganizationActionDisclosures();
  updatePanelActionUI();
}

function updateOrganizationActionDisclosures() {
  const provider = providerById(state.ai.provider);
  const tidyDisclosure = `Tidy Names with ${provider.label}: sends eligible live tab titles, simplified URLs, and domains, then opens one preview before applying.`;
  els.tidyNamesButton.title = tidyDisclosure;
  els.tidyNamesButton.setAttribute('aria-label', tidyDisclosure);
  const disclosure = `Auto Group with ${provider.label}: sends eligible tab titles, simplified URLs, domains, current Tags, and live/saved status, then opens one preview before applying.`;
  els.autoGroupButton.title = disclosure;
  els.autoGroupButton.setAttribute('aria-label', disclosure);
}

function latestAppliedOperation() {
  return [...(state.operationHistory || [])]
    .reverse()
    .find((operation) => operation?.status !== 'undone') || null;
}

function renderOperationRecord() {
  if (operationRecordHideTimer) {
    clearTimeout(operationRecordHideTimer);
    operationRecordHideTimer = 0;
  }
  const operation = latestAppliedOperation();
  const now = Date.now();
  const visible = isOperationUndoVisible(operation, now, OPERATION_UNDO_VISIBLE_MS);
  els.operationRecord.hidden = !visible;
  if (!visible) return;
  els.operationRecordText.textContent = operation.summary || 'Workspace change applied';
  els.undoOrganizationButton.disabled = false;
  els.undoOrganizationButton.textContent = 'Undo';
  const remaining = Math.max(1, operation.createdAt + OPERATION_UNDO_VISIBLE_MS - now);
  operationRecordHideTimer = setTimeout(() => {
    operationRecordHideTimer = 0;
    els.operationRecord.hidden = true;
  }, remaining);
}

function recordOperation({ type, spaceId, summary, before, after }) {
  if (!Array.isArray(state.operationHistory)) state.operationHistory = [];
  const operation = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    type,
    spaceId,
    summary,
    before,
    ...(after === undefined ? {} : { after }),
    createdAt: Date.now(),
    status: 'applied',
  };
  state.operationHistory.push(operation);
  state.operationHistory = state.operationHistory.slice(-10);
  return operation;
}

function removeOperationRecord(operationId) {
  if (!operationId || !Array.isArray(state.operationHistory)) return;
  state.operationHistory = state.operationHistory.filter((operation) => operation?.id !== operationId);
}

function rollbackFailureError(originalError, failures = []) {
  const originalMessage = originalError?.message || String(originalError || 'Operation failed.');
  const rollbackMessage = failures
    .map(({ stage, error }) => `${stage}: ${error?.message || String(error)}`)
    .join('; ');
  const combined = new Error(`${originalMessage} Rollback was incomplete (${rollbackMessage}).`);
  combined.cause = originalError;
  combined.rollbackFailures = failures;
  return combined;
}

function captureLiveOrganization(spaceId = state.activeSpaceId) {
  const view = buildSpaceViewForSpace(spaceId);
  return {
    groups: view
      .filter((group) => group.key !== 'ungrouped')
      .map((group) => ({
        title: group.title || 'Tabs',
        color: group.color || 'blue',
        collapsed: Boolean(group.collapsed),
        tabIds: group.tabs.map((tab) => Number(tab.id)).filter(Number.isFinite),
      }))
      .filter((group) => group.tabIds.length > 0),
    ungroupedTabIds: (view.find((group) => group.key === 'ungrouped')?.tabs || [])
      .map((tab) => Number(tab.id))
      .filter(Number.isFinite),
  };
}

async function restoreLiveOrganization(layout = {}, spaceId = state.activeSpaceId) {
  await loadTabs({ adopt: false });
  const existingIds = new Set(tabs.map((tab) => Number(tab.id)));
  const targetIds = uniqueNumberIds([
    ...(layout.ungroupedTabIds || []),
    ...(layout.groups || []).flatMap((group) => group.tabIds || []),
  ]).filter((tabId) => existingIds.has(tabId));
  const groupedIds = tabs
    .filter((tab) => targetIds.includes(Number(tab.id)) && isGroupedTab(tab))
    .map((tab) => Number(tab.id));
  if (groupedIds.length > 0) await send('tabs:ungroup', { tabIds: groupedIds });
  clearLocalTabGrouping(targetIds);
  for (const tabId of uniqueNumberIds(layout.ungroupedTabIds).filter((tabId) => existingIds.has(tabId))) {
    state.tabSpaces[tabId] = spaceId;
  }
  await loadTabs({ adopt: false });

  for (const group of layout.groups || []) {
    const tabIds = uniqueNumberIds(group.tabIds).filter((tabId) => existingIds.has(tabId));
    if (tabIds.length === 0) continue;
    const restoredGroupId = await createChromeGroup(tabIds, {
      title: group.title,
      color: group.color,
      collapsed: Boolean(group.collapsed),
      spaceId,
    });
    if (restoredGroupId === null) {
      throw new Error(`Could not restore Chrome group "${group.title || 'Tabs'}".`);
    }
  }
  await loadTabs({ adopt: false });
}

function organizationForCurrentSpaceState(spaceId) {
  const liveGroups = buildSpaceViewForSpace(spaceId);
  const snapshot = mergeOpenSpaceSnapshot(liveGroups, state.spaceSnapshots?.[spaceId]) || {
    version: 1,
    updatedAt: Date.now(),
    groups: [],
  };
  return buildOrganizationCandidates({ liveGroups, snapshot });
}

async function assertOperationUndoIsFresh(operation) {
  if (operation?.type === 'restore-backup') {
    const expectedFingerprint = operation.after?.portableFingerprint;
    if (!expectedFingerprint) {
      throw new Error('This restore record does not contain the safety data required for Undo.');
    }
    if (fingerprintPortableWorkspaceContent(state) !== expectedFingerprint) {
      throw new Error('Portable Space data changed after this backup was restored. Undo was stopped to preserve the newer Spaces, Tags, saved pages, context, or Ask history.');
    }
    return;
  }
  if (!['tidy-names', 'auto-group'].includes(operation?.type)) return;
  if (!state.spaces.some((space) => space.id === operation.spaceId)) {
    throw new Error('This organization change belongs to a Space that no longer exists, so it cannot be safely undone.');
  }

  await loadTabs({ adopt: false });
  if (operation.type === 'tidy-names') {
    const expectedFingerprint = operation.after?.targetFingerprint;
    const targetIds = Object.keys(operation.after?.renamedTabs || {})
      .map(Number)
      .filter(Number.isSafeInteger);
    if (!expectedFingerprint || targetIds.length === 0) {
      throw new Error('This Tidy Names record does not contain the safety data required for Undo.');
    }
    const targetIdSet = new Set(targetIds);
    const currentTargets = tabs.filter((tab) => targetIdSet.has(Number(tab.id)));
    const currentFingerprint = fingerprintTidyNameTargets(currentTargets, state.renamedTabs);
    if (currentFingerprint !== expectedFingerprint) {
      throw new Error('These tabs changed after Tidy Names was applied. Undo was stopped to preserve the newer names or pages.');
    }
    return;
  }

  const expectedFingerprint = operation.after?.organizationFingerprint;
  if (!expectedFingerprint) {
    throw new Error('This Auto Group record does not contain the safety data required for Undo.');
  }
  if (organizationForCurrentSpaceState(operation.spaceId).fingerprint !== expectedFingerprint) {
    throw new Error('This Space changed after Auto Group was applied. Undo was stopped to preserve the newer organization.');
  }
}

async function undoLastOperation() {
  let operation;
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    operation = latestAppliedOperation();
    if (!operation) return;
    await assertOperationUndoIsFresh(operation);
    if (operation.type === 'tidy-names') {
      for (const [tabId, previousName] of Object.entries(operation.before?.renamedTabs || {})) {
        if (previousName === null || previousName === undefined || previousName === '') delete state.renamedTabs[tabId];
        else state.renamedTabs[tabId] = previousName;
      }
    } else if (operation.type === 'auto-group') {
      if (operation.before?.snapshot) state.spaceSnapshots[operation.spaceId] = structuredClone(operation.before.snapshot);
      else delete state.spaceSnapshots[operation.spaceId];
      dormantSpaceViewSpaceId = '';
      await restoreLiveOrganization(operation.before?.live, operation.spaceId);
    } else if (operation.type === 'restore-backup') {
      restoreSpaceBackup(state, operation.before?.backup);
      dormantSpaceViewSpaceId = '';
      lastRenderedGroupsSignature = '';
      lastRenderedAskSignature = '';
      lastRenderedSpacesSignature = '';
    } else {
      throw new Error(`Undo is not available for ${operation.type || 'this operation'}.`);
    }
    operation.status = 'undone';
    operation.undoneAt = Date.now();
    await saveState();
    await refreshTabs({ reloadDormant: true });
  });
  if (!operation) {
    setStatus('There is no organization change to undo.');
    return;
  }
  const message = `Undid: ${operation.summary}.`;
  setStatus(message);
  showStatusToast(message, 'success');
}

function currentAskSources() {
  return selectAskSpaceSources(spaceView, selectedTabIds);
}

function renderAskDisclosure() {
  const selection = currentAskSources();
  const provider = providerById(state.ai.provider);
  els.askProvider.textContent = [provider.label, state.ai.model].filter(Boolean).join(' · ');
  els.askSourceSummary.textContent = `${selection.count} live ${selection.count === 1 ? 'page' : 'pages'}`;
  if (selection.mode === 'selected') {
    const limited = selection.truncated
      ? ` ${selection.counts.limited} additional selected ${selection.counts.limited === 1 ? 'page is' : 'pages are'} excluded by the 12-page limit.`
      : '';
    els.askSourceHint.textContent = selection.count
      ? `${selection.count} selected ${selection.count === 1 ? 'source' : 'sources'} will be read after confirmation.${limited}`
      : 'The selected rows are saved or restricted. Select at least one live http(s) tab.';
  } else {
    const limited = selection.truncated ? ` Limited to ${selection.count} of ${selection.counts.requested} readable pages.` : '';
    els.askSourceHint.textContent = `No tabs selected, so Ask uses live pages in this Space.${limited}`;
  }
  const chips = selection.tabs.map((tab, index) => {
    const chip = document.createElement('span');
    chip.className = 'ask-source-chip';
    chip.title = tab.url;
    const number = document.createElement('small');
    number.textContent = `[${index + 1}]`;
    const title = document.createElement('b');
    title.textContent = tab.displayTitle || tab.title || tab.url;
    chip.append(number, title);
    return chip;
  });
  els.askSourceList.replaceChildren(...chips);
}

function mergeDormantSpaceView(liveView, dormantView) {
  const dormantEntries = (dormantView || []).flatMap((group) => (
    (group.tabs || []).map((tab) => ({ tab, group }))
  ));
  const liveMatchPool = liveView.flatMap((group) => (
    (group.tabs || []).map((tab) => ({
      tab,
      groupKey: groupTitleKey(group.title),
      urlIdentity: snapshotUrlIdentity(tab.url),
      navigationUrlKey: comparableSnapshotUrl(tab.url),
      consumed: false,
    }))
  ));
  const openDormantTabs = matchDormantTabsToLiveTabs(dormantEntries, liveMatchPool);
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
    const dormantGroup = {
      ...group,
      collapsed: Boolean(state.collapsedGroups[group.key] ?? group.collapsed),
      tabs: group.tabs.filter((tab) => !openDormantTabs.has(tab)),
    };
    if (dormantGroup.tabs.length === 0) {
      // A persisted copy of an open group becomes empty after its live tabs
      // are matched above. Rendering that snapshot shadow creates a duplicate
      // card that reappears after every refresh. Distinct historical Tags still
      // render when no same-named live group exists.
      if (!matchingLiveGroup && !isUngroupedSnapshotGroup(dormantGroup)) {
        dormantGroups.push(dormantGroup);
      }
      continue;
    }

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

function matchDormantTabsToLiveTabs(dormantEntries, liveMatchPool) {
  const matchedDormantTabs = new Set();
  for (const matchMode of ['exact', 'recently-opened', 'navigation-fallback']) {
    for (const sameGroupOnly of [true, false]) {
      for (const { tab, group } of dormantEntries) {
        if (matchedDormantTabs.has(tab)) continue;
        if (isDormantTabAlreadyOpen(tab, group, liveMatchPool, matchMode, { sameGroupOnly })) {
          matchedDormantTabs.add(tab);
        }
      }
    }
  }
  return matchedDormantTabs;
}

function isDormantTabAlreadyOpen(dormantTab, dormantGroup, liveMatchPool, matchMode, options = {}) {
  const dormantUrlIdentity = snapshotUrlIdentity(dormantTab?.url);
  const dormantNavigationUrlKey = comparableSnapshotUrl(dormantTab?.url);
  const dormantGroupKey = groupTitleKey(dormantGroup?.title || '');
  const opened = matchMode === 'recently-opened'
    ? recentlyOpenedDormantRecordForTab(dormantTab, dormantGroup)
    : null;
  const matches = (entry) => {
    if (entry.consumed) return false;
    if (matchMode === 'exact') {
      return Boolean(dormantUrlIdentity && entry.urlIdentity === dormantUrlIdentity);
    }
    if (matchMode === 'recently-opened') {
      return Boolean(opened && liveTabMatchesOpenedDormantRecord(entry.tab, opened));
    }
    return Boolean(
      dormantNavigationUrlKey &&
      entry.navigationUrlKey === dormantNavigationUrlKey
    );
  };
  const match = liveMatchPool.find((entry) => (
    (!options.sameGroupOnly || entry.groupKey === dormantGroupKey) && matches(entry)
  ));
  if (!match) return false;
  match.consumed = true;
  return true;
}

function snapshotUrlIdentity(url) {
  return String(url || '').trim();
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
        tabs: (group.tabs || []).map((tab, tabIndex) => {
          const title = tab.title || tab.url || 'Untitled';
          const panelTitle = cleanPanelName(tab.panelTitle);
          return {
            id: `${key}:${tabIndex}`,
            title,
            displayTitle: panelTitle || title,
            ...(panelTitle ? { panelTitle } : {}),
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
          };
        }),
      };
    });
}

function renderGroups() {
  const ungrouped = spaceView.find((group) => group.key === 'ungrouped') || null;
  const tabGroups = isSpaceGroupsCollapsed()
    ? []
    : spaceView.filter((group) => group.key !== 'ungrouped');
  const signature = groupsRenderSignature(tabGroups, ungrouped);
  if (signature === lastRenderedGroupsSignature) return;
  lastRenderedGroupsSignature = signature;
  hideGroupPreview();
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
  for (const context of renderedGroupDragContexts.values()) {
    context.fingerprint = folderGroupContextFingerprint(context, renderedGroupContexts);
  }
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

function folderGroupContextFingerprint(context, groupContexts = renderedGroupContexts) {
  return JSON.stringify((context?.groupKeys || []).map((key) => {
    const group = groupContexts.get(key);
    return group ? groupMutationFingerprint(group) : `missing:${key}`;
  }));
}

function uniqueKeys(keys) {
  return [...new Set(keys.filter(Boolean))];
}

function groupsRenderSignature(tabGroups, ungrouped) {
  return JSON.stringify({
    activeSpaceId: state.activeSpaceId,
    collapsed: isSpaceGroupsCollapsed(),
    selectedTabIds: [...selectedTabIds].map(Number).sort((a, b) => a - b),
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
        selected: !tab.dormant && selectedTabIds.has(tab.id),
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
  bindGroupPreview(header, groupPreviewGroupForFolder(folder, collapsed));

  const children = document.createElement('div');
  children.className = 'folder-children';
  if (!collapsed) children.replaceChildren(...folder.children.map(createFolderTreeNode));

  section.append(header, children);
  return section;
}

async function toggleFolder(folderKey, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      if (!renderedGroupDragContexts.has(folderKey)) {
        throw new Error('This folder changed in another Space Tabs view. Try the action again.');
      }
      return toggleFolder(folderKey, { stateLocked: true });
    });
  }
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
  bindGroupPreview(header, group);

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
  bindGroupPreview(header, group);

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

function groupPreviewGroupForFolder(folder, collapsed = false) {
  const tabs = tabsForFolderPreview(folder.children || []);
  return {
    key: folder.key,
    title: folder.title,
    displayTitle: folder.title,
    collapsed: Boolean(collapsed),
    color: 'grey',
    tabs,
  };
}

function tabsForFolderPreview(nodes = []) {
  const previewTabs = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      previewTabs.push(...tabsForFolderPreview(node.children || []));
      continue;
    }
    const group = node.group;
    for (const tab of group?.tabs || []) {
      previewTabs.push({ ...tab, previewGroupKey: group.key });
    }
  }
  return previewTabs;
}

function bindGroupPreview(anchor, group) {
  if (!group?.collapsed || !group?.tabs?.length) return;
  const show = (event) => {
    if (event?.pointerType === 'touch') return;
    scheduleShowGroupPreview(anchor, group);
  };
  anchor.addEventListener('mouseenter', show);
  anchor.addEventListener('pointerenter', show);
  anchor.addEventListener('mouseleave', scheduleHideGroupPreview);
  anchor.addEventListener('pointerleave', scheduleHideGroupPreview);
  anchor.addEventListener('focusin', () => scheduleShowGroupPreview(anchor, group));
  anchor.addEventListener('focusout', (event) => {
    if (!groupPreviewPopover?.contains(event.relatedTarget)) scheduleHideGroupPreview();
  });
}

function scheduleShowGroupPreview(anchor, group) {
  if (dragState) return;
  clearTimeout(groupPreviewCloseTimer);
  clearTimeout(groupPreviewOpenTimer);
  groupPreviewOpenTimer = setTimeout(() => showGroupPreview(anchor, group), GROUP_PREVIEW_OPEN_DELAY_MS);
}

function scheduleHideGroupPreview() {
  clearTimeout(groupPreviewOpenTimer);
  clearTimeout(groupPreviewCloseTimer);
  groupPreviewCloseTimer = setTimeout(hideGroupPreview, GROUP_PREVIEW_CLOSE_DELAY_MS);
}

function showGroupPreview(anchor, group) {
  if (!group?.tabs?.length || dragState) return;
  const sameGroup = groupPreviewGroup?.key === group.key;
  groupPreviewAnchor = anchor;
  groupPreviewGroup = group;
  groupPreviewQuery = sameGroup ? groupPreviewQuery : '';
  hideContextMenu();
  const popover = ensureGroupPreviewPopover();
  renderGroupPreviewContents();
  popover.hidden = false;
  positionGroupPreview();
}

function hideGroupPreview() {
  clearTimeout(groupPreviewOpenTimer);
  clearTimeout(groupPreviewCloseTimer);
  if (groupPreviewPopover) groupPreviewPopover.hidden = true;
  groupPreviewAnchor = null;
  groupPreviewGroup = null;
  groupPreviewQuery = '';
}

function ensureGroupPreviewPopover() {
  if (groupPreviewPopover) return groupPreviewPopover;
  const popover = document.createElement('div');
  popover.className = 'group-preview-popover';
  popover.hidden = true;
  popover.addEventListener('mouseenter', () => {
    clearTimeout(groupPreviewCloseTimer);
  });
  popover.addEventListener('mouseleave', scheduleHideGroupPreview);
  popover.addEventListener('mousedown', (event) => event.stopPropagation());
  popover.addEventListener('click', (event) => event.stopPropagation());
  document.body.append(popover);
  groupPreviewPopover = popover;
  return popover;
}

function renderGroupPreviewContents() {
  const popover = ensureGroupPreviewPopover();
  const search = document.createElement('label');
  search.className = 'group-preview-search';
  search.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
  `;

  const input = document.createElement('input');
  input.className = 'group-preview-search-input';
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = `Search ${groupPreviewGroup?.displayTitle || groupPreviewGroup?.title || 'tabs'}...`;
  input.value = groupPreviewQuery;

  const list = document.createElement('div');
  list.className = 'group-preview-list';

  input.addEventListener('input', () => {
    groupPreviewQuery = input.value;
    renderGroupPreviewList(list);
    positionGroupPreview();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideGroupPreview();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list.querySelector('.group-preview-item')?.focus();
      return;
    }
    if (event.key === 'Enter') {
      const first = list.querySelector('.group-preview-item');
      if (first) {
        event.preventDefault();
        first.click();
      }
    }
  });

  search.append(input);
  popover.replaceChildren(search, list);
  renderGroupPreviewList(list);
}

function renderGroupPreviewList(list) {
  const items = buildGroupPreviewItems(groupPreviewGroup, groupPreviewQuery, { limit: 12 });
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'group-preview-empty';
    empty.textContent = 'No matching tabs';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...items.map(createGroupPreviewItem));
}

function createGroupPreviewItem(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = [
    'group-preview-item',
    item.active ? 'active' : '',
    item.dormant ? 'dormant' : '',
  ].filter(Boolean).join(' ');

  const favicon = createFavicon({
    ...item,
    displayTitle: item.title,
    domain: item.subtitle,
  });
  const label = document.createElement('span');
  label.className = 'group-preview-label';
  label.innerHTML = `
    <span class="group-preview-title">${escapeHtml(item.title)}</span>
    <span class="group-preview-subtitle">${escapeHtml(item.subtitle || item.url || '')}</span>
  `;
  const stateLabel = document.createElement('span');
  stateLabel.className = 'group-preview-state';
  stateLabel.textContent = item.active ? 'Active' : item.dormant ? 'Saved' : '';

  button.append(favicon, label, stateLabel);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    runTask(() => openGroupPreviewTab(item));
  });
  return button;
}

async function openGroupPreviewTab(item) {
  const tab = (groupPreviewGroup?.tabs || [])
    .find((candidate) => String(candidate.id) === String(item.id));
  if (!tab) return;
  const groupKey = tab.previewGroupKey || groupPreviewGroup.key;
  hideGroupPreview();
  if (tab.dormant) await openDormantTab(tab, groupKey);
  else await focusTab(tab);
}

function positionGroupPreview() {
  const popover = groupPreviewPopover;
  if (!popover || popover.hidden || !groupPreviewAnchor?.isConnected) return;
  const anchorRect = groupPreviewAnchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 600;
  const panelHeight = popover.offsetHeight || 280;
  const placement = planGroupPreviewPlacement({
    anchorRect,
    viewportWidth,
    viewportHeight,
    panelHeight,
  });
  popover.dataset.placement = placement.placement;
  popover.style.width = `${placement.width}px`;
  popover.style.maxHeight = `${placement.maxHeight}px`;
  popover.style.left = `${placement.left}px`;
  popover.style.top = `${placement.top}px`;
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
    button.className = `space${space.id === state.activeSpaceId && (workbenchMode || activeView === 'space') ? ' active' : ''}`;
    button.type = 'button';
    button.title = space.name;
    button.setAttribute('aria-label', space.name);
    const mark = document.createElement('span');
    mark.className = 'space-mark';
    mark.textContent = space.icon || space.name.slice(0, 1).toUpperCase();
    const label = document.createElement('span');
    label.className = 'space-label';
    label.textContent = space.name;
    button.append(mark, label);
    button.addEventListener('click', () => runTask(() => activateSpace(space.id)));
    button.addEventListener('contextmenu', (event) => showSpaceContextMenu(event, space));
    return button;
  });

  const askButton = document.createElement('button');
  askButton.className = `space ask-space${activeView === 'ask' ? ' active' : ''}`;
  askButton.type = 'button';
  askButton.title = 'Ask Space';
  askButton.setAttribute('aria-label', 'Ask Space');
  askButton.innerHTML = `<svg class="brain-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v14"/><path d="M12 12h6"/><path d="M12 12H6"/></svg>`;
  askButton.querySelector('svg').classList.add('space-mark');
  askButton.append(spaceButtonLabel('Ask Space'));
  askButton.addEventListener('click', () => runTask(openAskPage));

  const setupButton = document.createElement('button');
  setupButton.className = 'space setup-space';
  setupButton.type = 'button';
  setupButton.title = 'Finish setup';
  setupButton.setAttribute('aria-label', 'Finish setup');
  setupButton.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4"></path><path d="M12 17v4"></path><path d="M3 12h4"></path><path d="M17 12h4"></path><circle cx="12" cy="12" r="4"></circle></svg>`;
  setupButton.querySelector('svg').classList.add('space-mark');
  setupButton.append(spaceButtonLabel('Finish setup'));
  setupButton.addEventListener('click', () => runTask(async () => {
    if (workbenchMode) openOnboarding();
    else await openWorkbench();
  }));

  const addButton = document.createElement('button');
  addButton.className = 'space add-space';
  addButton.type = 'button';
  addButton.title = 'Add Space';
  addButton.setAttribute('aria-label', 'Add Space');
  addButton.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
  addButton.querySelector('svg').classList.add('space-mark');
  addButton.append(spaceButtonLabel('New Space'));
  addButton.addEventListener('click', () => runTask(addSpace));

  const spacesGroup = document.createElement('div');
  spacesGroup.className = 'dock-group dock-spaces';
  spacesGroup.setAttribute('aria-label', 'Spaces');
  spacesGroup.replaceChildren(...spaceButtons, addButton);

  const toolsGroup = document.createElement('div');
  toolsGroup.className = 'dock-group dock-tools';
  toolsGroup.setAttribute('aria-label', 'Space tools');
  toolsGroup.replaceChildren(...(state.onboarding?.completed ? [] : [setupButton]), askButton);

  els.spacesList.replaceChildren(spacesGroup, toolsGroup);
}

function spacesRenderSignature() {
  return JSON.stringify([
    layoutMode,
    activeView,
    state.onboarding?.completed === true,
    state.activeSpaceId,
    (state.spaces || []).map((space) => [space.id, space.name, space.icon || '']),
  ]);
}

function spaceButtonLabel(text) {
  const label = document.createElement('span');
  label.className = 'space-label';
  label.textContent = text;
  return label;
}

async function openWorkbench(options = {}) {
  if (els.settingsDialog.open) els.settingsDialog.close();
  if (workbenchMode) return;

  const url = extensionRuntime
    ? new URL(chrome.runtime.getURL('sidepanel.html'))
    : new URL(window.location.href);
  url.searchParams.set('layout', 'workbench');
  if (options.view) url.searchParams.set('view', options.view);
  else url.searchParams.delete('view');

  if (extensionRuntime) {
    await send('tabs:openUnique', {
      url: url.toString(),
      matchUrl: `${chrome.runtime.getURL('sidepanel.html')}?layout=workbench`,
    });
  } else {
    window.open(url.toString(), 'space-workbench');
  }
}

async function maybeShowOnboarding() {
  const forcedPreview = new URLSearchParams(window.location.search).get('onboarding') === '1';
  if (!extensionRuntime && !forcedPreview) return;
  if (state.onboarding?.completed) return;
  if (extensionRuntime && !workbenchMode) {
    await openWorkbench();
    return;
  }
  openOnboarding();
}

function startArcFileSelectionFromUserGesture(target) {
  const input = target === 'onboarding' ? els.onboardingArcInput : els.arcImportInput;
  // File System Access API pickers reject Arc's file under macOS ~/Library as
  // a sensitive system location. A native file input can read the exact file
  // the user explicitly chooses, so Arc import must always use this path.
  input.value = '';
  input.click();
}

function clearOnboardingArcSelection({ preserveStatus = false } = {}) {
  onboardingArcSelectionGeneration += 1;
  pendingOnboardingArcPlan = null;
  pendingOnboardingArcText = '';
  els.onboardingArcInput.value = '';
  els.onboardingArcChooseButton.textContent = 'Choose Arc file';
  els.onboardingArcSpaces.replaceChildren();
  if (!preserveStatus) els.onboardingArcStatus.textContent = 'No Arc file selected.';
}

function openOnboarding(options = {}) {
  const resumeAI = options.restart !== true &&
    !state.onboarding?.completed && state.onboarding?.stage === 'ai';
  onboardingStep = resumeAI ? 2 : 0;
  onboardingPath = '';
  onboardingResult = resumeAI ? 'Your workspace is ready.' : '';
  clearOnboardingArcSelection();
  els.onboardingSpaceNameInput.value = currentSpace()?.id === 'default' ? 'Default' : 'New Space';
  renderOnboardingAISettings();
  renderOnboarding();
  if (!els.onboardingDialog.open) els.onboardingDialog.showModal();
}

function chooseOnboardingPath(path) {
  if (path !== 'fresh' && path !== 'arc') return;
  if (path === 'fresh') clearOnboardingArcSelection();
  onboardingPath = path;
  onboardingStep = 1;
  renderOnboarding();
  requestAnimationFrame(() => {
    if (path === 'fresh') els.onboardingSpaceNameInput.focus();
    else els.onboardingArcInput.focus();
  });
}

function goBackOnboarding() {
  if (onboardingStep <= 0) return;
  if (onboardingStep === 1 && onboardingPath === 'arc') clearOnboardingArcSelection();
  onboardingStep -= 1;
  if (onboardingStep === 0) onboardingPath = '';
  renderOnboarding();
}

function renderOnboarding() {
  const isChoose = onboardingStep === 0;
  const isSetup = onboardingStep === 1;
  const isFinish = onboardingStep === 2;
  els.onboardingChooseStep.hidden = !isChoose;
  els.onboardingFreshStep.hidden = !(isSetup && onboardingPath === 'fresh');
  els.onboardingArcStep.hidden = !(isSetup && onboardingPath === 'arc');
  els.onboardingFinishStep.hidden = !isFinish;
  els.onboardingFooter.hidden = isFinish;
  els.onboardingFooter.classList.toggle('single-action', isChoose);
  els.onboardingBackButton.hidden = isChoose;
  els.skipOnboardingButton.hidden = isFinish;
  els.onboardingStepLabel.textContent = `Step ${onboardingStep + 1} of 3`;
  els.onboardingFinishMessage.textContent = onboardingResult || 'Your first Space is ready.';
  els.onboardingUndoArcButton.hidden = !(isFinish && state.lastArcImport?.spaceIds?.length);

  const progress = [...els.onboardingProgress.querySelectorAll('span')];
  progress.forEach((item, index) => {
    item.classList.toggle('active', index === onboardingStep);
    item.classList.toggle('complete', index < onboardingStep);
  });
  for (const button of els.onboardingDialog.querySelectorAll('[data-onboarding-path]')) {
    button.classList.toggle('selected', button.dataset.onboardingPath === onboardingPath);
  }

  if (isChoose) {
    els.onboardingNextButton.textContent = 'Continue';
    els.onboardingNextButton.disabled = !onboardingPath;
  } else if (onboardingPath === 'fresh') {
    els.onboardingNextButton.textContent = 'Create Space';
    els.onboardingNextButton.disabled = !els.onboardingSpaceNameInput.value.trim();
  } else {
    els.onboardingNextButton.textContent = 'Import selected Spaces';
    els.onboardingNextButton.disabled = selectedOnboardingArcSpaceIds().length === 0;
  }
  if (isFinish) updateOnboardingAIActionState();
}

async function continueOnboarding() {
  if (onboardingStep === 0) {
    if (!onboardingPath) return;
    onboardingStep = 1;
    renderOnboarding();
    return;
  }
  if (onboardingStep !== 1) return;
  if (onboardingPath === 'fresh') await applyFreshOnboarding();
  else await applyArcOnboarding();
  onboardingStep = 2;
  renderOnboardingAISettings();
  renderOnboarding();
}

async function applyFreshOnboarding() {
  const name = els.onboardingSpaceNameInput.value.trim();
  if (!name) return;
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    await applyFreshOnboardingFromCurrentState(name);
  });
}

async function applyFreshOnboardingFromCurrentState(name) {
  let targetSpace = currentSpace();
  const canReuseDefault = state.spaces.length === 1 && targetSpace?.id === 'default';
  if (canReuseDefault) {
    targetSpace.name = name;
    targetSpace.icon = name.slice(0, 1).toUpperCase();
  } else {
    targetSpace = {
      id: uniqueSpaceId(name),
      name,
      icon: name.slice(0, 1).toUpperCase(),
      color: nextSpaceColor(),
    };
    state.spaces.push(targetSpace);
    await saveState();
    await switchSpace(targetSpace.id);
  }
  state.activeSpaceId = targetSpace.id;
  state.onboarding = { version: 2, completed: false, stage: 'ai' };
  activeView = workbenchMode ? 'ask' : 'space';
  lastRenderedSpacesSignature = '';
  await saveState();
  await refreshTabs({ adopt: true, reloadDormant: true });
  onboardingResult = `${name} is ready.`;
}

async function previewOnboardingArcFile(selectedFile = null) {
  const selectionGeneration = ++onboardingArcSelectionGeneration;
  pendingOnboardingArcPlan = null;
  pendingOnboardingArcText = '';
  els.onboardingArcSpaces.replaceChildren();
  const file = selectedFile || els.onboardingArcInput.files?.[0];
  if (!file) {
    els.onboardingArcStatus.textContent = 'No Arc file selected.';
    renderOnboarding();
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    els.onboardingArcInput.value = '';
    els.onboardingArcStatus.textContent = 'This Arc file is too large to import safely.';
    renderOnboarding();
    return;
  }

  els.onboardingArcStatus.textContent = `Reading ${file.name || 'StorableSidebar.json'}...`;
  renderOnboarding();

  try {
    const text = await file.text();
    if (
      selectionGeneration !== onboardingArcSelectionGeneration ||
      onboardingStep !== 1 || onboardingPath !== 'arc'
    ) return;
    const plan = createArcImportPlan(text, { existingSpaces: state.spaces });
    pendingOnboardingArcText = text;
    pendingOnboardingArcPlan = plan;
    els.onboardingArcChooseButton.textContent = 'Choose another Arc file';
    els.onboardingArcStatus.textContent = `${file.name || 'StorableSidebar.json'} · ${formatArcImportSummary(plan.summary, 'Preview')}${formatArcConflictSummary(plan)}`;
    renderOnboardingArcSpaces(plan);
  } catch (error) {
    if (selectionGeneration !== onboardingArcSelectionGeneration) return;
    clearOnboardingArcSelection();
    els.onboardingArcStatus.textContent = `Cannot read Arc file: ${error.message || String(error)}`;
    renderOnboarding();
    return;
  }
  renderOnboarding();
}

function renderOnboardingArcSpaces(plan) {
  const previewsBySpaceId = new Map((plan?.spacePreviews || []).map((preview) => [preview.spaceId, preview]));
  const rows = (plan?.spaces || []).map((space) => {
    const label = document.createElement('label');
    label.className = 'onboarding-space-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.arcSpaceId = space.id;
    const icon = document.createElement('span');
    icon.className = 'onboarding-space-icon';
    icon.textContent = space.icon || space.name.slice(0, 1).toUpperCase();
    const name = document.createElement('strong');
    name.textContent = space.name;
    const preview = previewsBySpaceId.get(space.id);
    const count = document.createElement('small');
    const conflictText = (preview?.conflicts || []).length
      ? ` · ${preview.conflicts.map((conflict) => `${conflict.original} → ${conflict.resolved}`).join(', ')}`
      : '';
    count.textContent = `${preview?.folders ?? 0} folders · ${preview?.tabs ?? snapshotTabCount(plan.spaceSnapshots?.[space.id])} tabs${conflictText}`;
    count.classList.toggle('conflict', Boolean(conflictText));
    label.append(checkbox, icon, name, count);
    return label;
  });
  els.onboardingArcSpaces.replaceChildren(...rows);
}

function selectedOnboardingArcSpaceIds() {
  return [...els.onboardingArcSpaces.querySelectorAll('input[data-arc-space-id]:checked')]
    .map((input) => input.dataset.arcSpaceId)
    .filter(Boolean);
}

function selectedOnboardingArcPlan() {
  return selectArcImportPlan(pendingOnboardingArcPlan, selectedOnboardingArcSpaceIds());
}

function arcPlanResolutionSignature(plan) {
  return JSON.stringify((plan?.spacePreviews || []).map((preview) => [
    preview.sourceSpaceId,
    preview.resolvedId,
    preview.resolvedName,
  ]));
}

async function applyArcOnboarding() {
  const previewPlan = selectedOnboardingArcPlan();
  if (previewPlan.spaces.length === 0) throw new Error('Select at least one Arc Space to import.');
  const selectedSourceIds = new Set((previewPlan.spacePreviews || []).map((preview) => preview.sourceSpaceId));
  let result;
  try {
    await withSharedStateLock(async () => {
      await syncStateFromStorage();
      const latestPlan = createArcImportPlan(pendingOnboardingArcText, { existingSpaces: state.spaces });
      const latestResolvedIds = (latestPlan.spacePreviews || [])
        .filter((preview) => selectedSourceIds.has(preview.sourceSpaceId))
        .map((preview) => preview.spaceId);
      const plan = selectArcImportPlan(latestPlan, latestResolvedIds);
      if (arcPlanResolutionSignature(previewPlan) !== arcPlanResolutionSignature(plan)) {
        throw new Error('Spaces changed after this preview. Choose the Arc file again to review the updated conflict names.');
      }
      const beforeState = structuredClone(state);
      try {
        result = appendArcImportPlan(state, plan);
        rememberArcImport(result.importedSpaceIds);
        state.onboarding = { version: 2, completed: false, stage: 'ai' };
        assertCurrentStateFitsStorage();
        lastRenderedSpacesSignature = '';
        await saveState();
        render();
        renderSettings();
      } catch (error) {
        restoreFailedWorkspaceMutation(beforeState);
        els.onboardingArcStatus.textContent = `Import stopped: ${error.message || String(error)}`;
        throw error;
      }
    });
    onboardingResult = `Imported ${result.importedSpaces} Arc Spaces and ${result.importedTabs} saved tabs. Your current Space stayed open.`;
  } catch (error) {
    els.onboardingArcStatus.textContent = `Import stopped: ${error.message || String(error)}`;
    els.onboardingArcChooseButton.textContent = 'Choose Arc file';
    throw error;
  } finally {
    // The imported snapshot is now in extension state. Do not retain the raw
    // Arc sidebar export (which can be large and sensitive) in memory or input.
    clearOnboardingArcSelection({ preserveStatus: true });
    renderOnboarding();
  }
}

async function finishOnboarding(openWorkbenchAfter) {
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    state.onboarding = { version: 2, completed: true, stage: 'done' };
    await saveState();
  });
  clearOnboardingArcSelection();
  els.onboardingApiKeyInput.value = '';
  if (els.onboardingDialog.open) els.onboardingDialog.close();
  render();
  if (openWorkbenchAfter) await openWorkbench();
}

async function saveOnboardingAIAndFinish() {
  let aiSettings;
  try {
    aiSettings = currentAISettingsFromControls(onboardingAIControls());
    if (providerRequiresApiKey(aiSettings) && !aiSettings.apiKey) {
      throw new Error('Add an API key, or choose Not now.');
    }
  } catch (error) {
    setAIControlsStatus(onboardingAIControls(), error.message || String(error));
    return;
  }

  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    state.ai = aiSettings;
    state.onboarding = { version: 2, completed: true, stage: 'done' };
    if (state.ai.apiKey) {
      await secretSet({ [SECRET_STORAGE_KEY]: { ai: { apiKey: state.ai.apiKey } } });
    } else {
      await secretRemove(SECRET_STORAGE_KEY);
    }
    await saveState();
  });
  clearOnboardingArcSelection();
  els.onboardingApiKeyInput.value = '';
  if (els.onboardingDialog.open) els.onboardingDialog.close();
  renderSettings();
  render();
  await openWorkbench();
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

  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    const space = {
      id: uniqueSpaceId(clean),
      name: clean,
      icon: clean.slice(0, 1).toUpperCase(),
      color: nextSpaceColor(),
    };
    state.spaces.push(space);
    await saveState();
    await activateSpace(space.id, { stateLocked: true });
  });
}

async function activateSpace(spaceId, options = {}) {
  if (!options.stateLocked) {
    return withSharedStateLock(async () => {
      await syncStateFromStorage();
      return activateSpace(spaceId, { stateLocked: true });
    });
  }
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
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    const current = state.spaces.find((item) => item.id === space.id);
    if (!current) return;
    current.name = clean;
    current.icon = clean.slice(0, 1).toUpperCase();
    await saveState();
    render();
  });
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

  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    const current = state.spaces.find((item) => item.id === space.id);
    if (!current || state.spaces.length <= 1) return;
    await deleteSpaceFromCurrentState(current);
  });
}

async function deleteSpaceFromCurrentState(space) {
  await loadTabs({ adopt: true });
  const deletingActiveSpace = state.activeSpaceId === space.id;
  const fallback = fallbackSpaceAfterDelete(state.spaces, space.id);
  const preserveBrowserFocus = workbenchMode;

  if (deletingActiveSpace && fallback) {
    await snapshotOpenSpace(space.id);
    activeView = 'space';
    state.activeSpaceId = fallback.id;
    await ensureSpaceOpenFromSnapshot(fallback.id, { active: !preserveBrowserFocus });
    if (!preserveBrowserFocus) await focusFirstTabInSpace(fallback.id, { force: true });
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
    await ensureSpaceOpenFromSnapshot(state.activeSpaceId, { active: !preserveBrowserFocus });
    if (!preserveBrowserFocus) await focusFirstTabInSpace(state.activeSpaceId, { force: true });
    await collapseGroupsInSpace(state.activeSpaceId);
    await discardInactiveTabsInSpace(state.activeSpaceId);
  }
  await closeTabsOutsideActiveSpace({ preserveBrowserFocus });
  await saveState();
  await refreshTabs();
  setStatus(`Deleted ${space.name}.`);
}

async function newTabInActiveSpace() {
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    const created = await send('tabs:create', { url: 'chrome://newtab', active: true });
    const tabId = created.tab?.id;
    if (tabId) state.tabSpaces[tabId] = state.activeSpaceId;
    await closeEphemeralTabs();
    await saveState();
    await refreshTabs();
  });
}

async function clearUngroupedTabs(group, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const current = spaceView.find((item) => item.key === 'ungrouped');
      if (!current) throw new Error('The ungrouped tabs changed in another Space Tabs view. Try again.');
      return clearUngroupedTabs(current, { stateLocked: true });
    });
  }
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

async function focusTab(tab, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => focusTab(currentTabForMutation(tab), { stateLocked: true }));
  }
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
  await withFreshSpaceStateMutation(async () => {
    const current = currentTabForMutation(tab);
    if (clean) state.renamedTabs[current.id] = clean;
    else delete state.renamedTabs[current.id];
    await saveState();
    await refreshTabs();
  });
}

async function duplicateTab(tab, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => duplicateTab(currentTabForMutation(tab), { stateLocked: true }));
  }
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

  await withFreshSpaceStateMutation(async () => {
    const current = currentGroupForMutation(group);
    if (current.dormant) {
      renameDormantSnapshotGroup(current, clean);
    } else if (current.id === 'ungrouped') {
      const tabIds = current.tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
      if (tabIds.length === 0) return;
      await createChromeGroup(tabIds, { title: clean, color: nextGroupColor() });
    } else if (isVirtualGroupKey(current.key)) {
      state.virtualGroups[current.key] = {
        ...(state.virtualGroups[current.key] || {}),
        id: current.key,
        title: clean,
        color: current.color || state.virtualGroups[current.key]?.color || 'blue',
        spaceId: state.activeSpaceId,
      };
    } else {
      await send('groups:update', { groupId: current.id, update: { title: clean } });
      bindChromeGroup(current.id, state.activeSpaceId);
    }

    await saveState();
    await refreshTabs();
  });
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

  await withFreshSpaceStateMutation(async () => {
    const currentContext = renderedGroupDragContexts.get(folderContext.key);
    if (
      !currentContext ||
      JSON.stringify(currentContext.path || []) !== JSON.stringify(sourcePath) ||
      currentContext.fingerprint !== folderContext.fingerprint
    ) {
      throw new Error('This folder changed in another Space Tabs view. Try the action again.');
    }
    const currentGroups = groupsForFolderContext(currentContext);
    const replacements = new Map();
    const visibleKeys = spaceView.map((group) => group.key);
    for (const group of currentGroups) {
      const title = renamedFolderGroupTitle(group, sourcePath, clean);
      const nextKey = await retitleGroupWithoutSaving(group, title);
      if (nextKey) replacements.set(group.key, nextKey);
    }
    replaceGroupOrderKeys(replacements, visibleKeys);

    await saveState();
    await refreshTabs();
    setStatus(`Renamed group "${currentName}" to "${clean}".`);
  });
}

async function groupSelectedTabs(tabIds, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => groupSelectedTabs(tabIds, { stateLocked: true }));
  }
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

async function closeTab(tab, groupKey = '', options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const current = currentTabForMutation(tab);
      return closeTab(current, groupForTab(current)?.key || '', { stateLocked: true });
    });
  }
  const sourceGroup = groupForTab(tab) || (
    groupKey ? spaceView.find((group) => group.key === groupKey) : null
  );
  await send('tabs:close', { tabId: tab.id });
  removeClosedTabFromSnapshot(tab, sourceGroup);
  removeTabFromSavedOrder(tab.id);
  delete state.tabSpaces[tab.id];
  delete state.renamedTabs[tab.id];
  delete state.tabGroups?.[tab.id];
  forgetEphemeralTab(tab.id);
  await saveState();
  await refreshTabs({
    reloadDormant: true,
    skipSnapshotCleanupForTabIds: [tab.id],
  });
}

async function removeDormantTab(tab, groupKey = '', options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const currentGroup = dormantSpaceView.find((group) => (
        group.key === groupKey || group.key === tab.dormantGroupKey
      ));
      const currentTab = currentGroup?.tabs?.find((item) => (
        String(item.url || '') === String(tab.url || '') &&
        String(item.title || item.displayTitle || '') === String(tab.title || tab.displayTitle || '')
      ));
      if (!currentGroup || !currentTab) {
        throw new Error('This saved tab changed in another Space Tabs view. Try the action again.');
      }
      return removeDormantTab(currentTab, currentGroup.key, { stateLocked: true });
    });
  }
  const dormantGroup = dormantSpaceView.find((group) => (
    group.key === groupKey || group.key === tab.dormantGroupKey
  ));
  removeOpenedDormantTabFromSnapshot(tab, dormantGroup);
  await saveState();
  await refreshTabs({ reloadDormant: true });
  setStatus('Removed saved tab.');
}

async function updateSavedTabUrl(tab, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => updateSavedTabUrl(currentTabForMutation(tab), { stateLocked: true }));
  }
  if (tab?.dormant) return;
  const sourceGroup = groupForTab(tab);
  if (!sourceGroup || sourceGroup.key === 'ungrouped') {
    setStatus('Move this tab into a group before saving its URL.');
    return;
  }

  const url = String(tab?.url || '').trim();
  if (!url || url === 'chrome://newtab') {
    setStatus('This tab does not have a saved URL target.');
    return;
  }

  const opened = recentlyOpenedDormantRecordForLiveTab(tab);
  const groupTitle = opened?.groupTitle || sourceGroup.title || sourceGroup.displayTitle || 'Group';
  const groupColor = opened?.groupColor || sourceGroup.color || 'blue';
  const snapshot = activeSpaceSnapshot() || {
    version: 1,
    updatedAt: Date.now(),
    groups: [],
  };
  const nextSnapshot = updateSnapshotTab(snapshot, {
    groupTitle,
    groupColor,
    url: opened?.url || url,
  }, {
    title: tab.displayTitle || tab.title || url,
    url,
  });

  if (!nextSnapshot || snapshotTabCount(nextSnapshot) === 0) return;
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') state.spaceSnapshots = {};
  state.spaceSnapshots[state.activeSpaceId] = {
    ...nextSnapshot,
    updatedAt: Date.now(),
  };
  dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
  forgetRecentlyOpenedDormantTab(tab.id);
  await saveState();
  await refreshTabs({ reloadDormant: true });
  setStatus('Updated saved URL.');
}

async function moveTabToSpace(tab, spaceId) {
  const moved = await moveTabsToSpace([tab?.id], spaceId);
  if (moved > 0) setStatus(`Moved tab to ${spaceName(spaceId)}.`);
}

async function moveSelectedTabsToSpace(tabIds, spaceId) {
  const moved = await moveTabsToSpace(tabIds, spaceId);
  if (moved > 0) setStatus(`Moved ${moved} selected tabs to ${spaceName(spaceId)}.`);
}

async function moveTabsToSpace(tabIds, spaceId, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => moveTabsToSpace(tabIds, spaceId, { stateLocked: true }));
  }
  if (!state.spaces.some((space) => space.id === spaceId)) return 0;
  const sourceSpaceId = state.activeSpaceId;
  const ids = uniqueNumberIds(tabIds);
  if (ids.length === 0) return 0;

  await loadTabs({ adopt: true });
  const sourceView = buildSpaceViewForSpace(sourceSpaceId);
  const movedTabs = ids
    .map((id) => tabs.find((tab) => Number(tab.id) === Number(id)))
    .filter((tab) => tab && !tab.pinned && !isEphemeralTab(tab) && tabBelongsToSpace(tab, sourceSpaceId));
  if (movedTabs.length === 0) return 0;

  const moves = movedTabs.map((tab) => ({
    tab,
    targetGroupKey: ensureMovedTabTargetGroup(tab, groupForTab(tab, sourceView), spaceId),
  }));
  const groupedTabIds = moves
    .filter(({ tab }) => isGroupedTab(tab))
    .map(({ tab }) => tab.id);
  if (groupedTabIds.length > 0) {
    await send('tabs:ungroup', { tabIds: groupedTabIds });
  }

  const targetOrder = ensureTabOrderForSpace(spaceId);
  for (const { tab, targetGroupKey } of moves) {
    state.tabSpaces[tab.id] = spaceId;
    state.tabGroups[tab.id] = targetGroupKey;
    removeTabFromSavedOrder(tab.id, sourceSpaceId);
    targetOrder[targetGroupKey] = uniqueKeys([...(targetOrder[targetGroupKey] || []), tab.id]);
  }

  removeTabsFromSpaceSnapshot(sourceSpaceId, movedTabs);
  selectedTabIds = new Set(movedTabs.map((tab) => tab.id));
  selectionAnchorTabId = movedTabs.at(-1)?.id ?? null;
  await finishMoveToSpace(spaceId, { stateLocked: true });
  return movedTabs.length;
}

function groupForTab(tab, view = spaceView) {
  const tabId = Number(tab?.id);
  if (!Number.isFinite(tabId)) return null;
  return view.find((group) => (
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

async function moveGroupToSpace(group, spaceId, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => moveGroupToSpace(
      currentGroupForMutation(group),
      spaceId,
      { stateLocked: true },
    ));
  }
  moveGroupsWithoutSaving([group], spaceId);
  await finishMoveToSpace(spaceId, { stateLocked: true });
  setStatus(`Moved group to ${spaceName(spaceId)}.`);
}

async function moveFolderGroupToSpace(folderContext, spaceId, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const currentContext = renderedGroupDragContexts.get(folderContext.key);
      if (
        !currentContext ||
        JSON.stringify(currentContext.path || []) !== JSON.stringify(folderContext.path || []) ||
        currentContext.fingerprint !== folderContext.fingerprint
      ) {
        throw new Error('This folder changed in another Space Tabs view. Try the action again.');
      }
      return moveFolderGroupToSpace(currentContext, spaceId, { stateLocked: true });
    });
  }
  const groups = groupsForFolderContext(folderContext);
  if (groups.length === 0) return;
  moveGroupsWithoutSaving(groups, spaceId);
  await finishMoveToSpace(spaceId, { stateLocked: true });
  setStatus(`Moved group to ${spaceName(spaceId)}.`);
}

async function finishMoveToSpace(spaceId, options = {}) {
  await saveState();
  await activateSpace(spaceId, { stateLocked: Boolean(options.stateLocked) });
}

async function deleteGroup(group, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => deleteGroup(currentGroupForMutation(group), { stateLocked: true }));
  }
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

async function deleteFolderGroup(folderContext, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const currentContext = renderedGroupDragContexts.get(folderContext.key);
      if (
        !currentContext ||
        JSON.stringify(currentContext.path || []) !== JSON.stringify(folderContext.path || []) ||
        currentContext.fingerprint !== folderContext.fingerprint
      ) {
        throw new Error('This folder changed in another Space Tabs view. Try the action again.');
      }
      return deleteFolderGroup(currentContext, { stateLocked: true });
    });
  }
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

async function openDormantTab(tab, groupKey, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const currentGroup = dormantSpaceView.find((group) => group.key === groupKey || group.key === tab.dormantGroupKey);
      const currentTab = currentGroup?.tabs?.find((item) => (
        String(item.url || '') === String(tab.url || '') &&
        String(item.title || item.displayTitle || '') === String(tab.title || tab.displayTitle || '')
      ));
      if (!currentGroup || !currentTab) {
        throw new Error('This saved tab changed in another Space Tabs view. Try the action again.');
      }
      return openDormantTab(currentTab, currentGroup.key, { stateLocked: true });
    });
  }
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

  preserveDormantPanelName(tab, tabId);
  removeOpenedDormantTabFromSnapshot(tab, dormantGroup);
  rememberOpenedDormantTab(tab, dormantGroup, tabId);
  await closeEphemeralTabs();
  await saveState();
  await refreshTabs();
}

function preserveDormantPanelName(tab, tabId) {
  const name = cleanPanelName(tab?.panelTitle || tab?.displayTitle || tab?.title);
  if (!name || !Number.isFinite(Number(tabId))) return;
  if (!state.renamedTabs || typeof state.renamedTabs !== 'object') state.renamedTabs = {};
  state.renamedTabs[tabId] = name;
}

async function switchSpace(spaceId) {
  const previousSpaceId = state.activeSpaceId;
  const preserveBrowserFocus = workbenchMode;
  await loadTabs({ adopt: false });
  await snapshotOpenSpace(previousSpaceId);

  activeView = 'space';

  const keepAliveTab = await ensureSwitchKeepAliveTab(spaceId, previousSpaceId, { preserveBrowserFocus });

  state.activeSpaceId = spaceId;
  await loadDormantSpaceView(spaceId, { force: true });
  if (!preserveBrowserFocus) {
    await focusFirstTabInSpace(spaceId, {
      force: true,
      allowEphemeral: true,
      ephemeralTabId: keepAliveTab?.id,
    });
  }
  await closeSpaceTabs(previousSpaceId, shouldAutoCloseTab);
  await closeEphemeralTabsExcept(keepAliveTab?.id);
  await closeTabsOutsideActiveSpace({ preserveBrowserFocus });
  await closeExtraFallbackTabs(keepAliveTab?.id);
  if (!preserveBrowserFocus) {
    await focusFirstTabInSpace(spaceId, {
      force: true,
      allowEphemeral: true,
      ephemeralTabId: keepAliveTab?.id,
    });
  }
  await collapseGroupsInSpace(spaceId);
  await discardInactiveTabsInSpace(spaceId);
  await saveState();
  await refreshTabs();
}

async function ensureSwitchKeepAliveTab(spaceId, previousSpaceId, options = {}) {
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
    if (!options.preserveBrowserFocus) await send('tabs:focus', { tabId: reusable.id });
    await loadTabs({ adopt: false });
    return tabs.find((tab) => Number(tab.id) === Number(reusable.id)) || reusable;
  }

  return ensureSpaceHasOpenTab(spaceId, { active: !options.preserveBrowserFocus });
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

async function closeTabsOutsideActiveSpace(options = {}) {
  await loadTabs({ adopt: false });
  await ensureActiveSpaceHasOpenTab({ active: !options.preserveBrowserFocus });

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
  if (!options.preserveBrowserFocus && activeSpaceTabs.length && !activeSpaceTabs.some((tab) => tab.active)) {
    await send('tabs:focus', { tabId: preferredFocusableTab(activeSpaceTabs).id });
  }

  await saveState();
}

async function ensureActiveSpaceHasOpenTab(options = {}) {
  if (!state.activeSpaceId) return;
  const activeSpaceTabs = tabs.filter((tab) => (
    isEphemeralTab(tab) || tabBelongsToSpace(tab, state.activeSpaceId)
  ));
  if (activeSpaceTabs.length > 0) return;
  await ensureSpaceHasOpenTab(state.activeSpaceId, { active: options.active !== false });
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
  const view = buildSpaceViewForSpace(spaceId);
  const snapshot = mergeOpenSpaceSnapshot(view, state.spaceSnapshots[spaceId]);
  const previousSnapshot = state.spaceSnapshots[spaceId];
  if (!snapshotHasPersistentContent(snapshot)) {
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
  if (!snapshotHasPersistentContent(snapshot)) {
    delete state.spaceSnapshots[spaceId];
    if (spaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
    return null;
  }
  state.spaceSnapshots[spaceId] = snapshot;
  return snapshot;
}

function removeTemporarySnapshotTabs(spaceId) {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') return;
  const storedSnapshot = sanitizeSpaceSnapshot(state.spaceSnapshots?.[spaceId]);
  const snapshot = storedSnapshot ? {
    ...storedSnapshot,
    groups: (storedSnapshot.groups || []).filter((group) => !isUngroupedSnapshotGroup(group)),
  } : null;
  if (!snapshotHasPersistentContent(snapshot)) delete state.spaceSnapshots[spaceId];
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
    if (nextGroup && snapshotGroupShouldPersist(snapshot, nextGroup)) groups.push(nextGroup);
    changed = true;
  }

  if (!changed) return;
  const nextSnapshot = {
    ...snapshot,
    updatedAt: Date.now(),
    groups,
  };
  if (!snapshotHasPersistentContent(nextSnapshot)) delete state.spaceSnapshots[state.activeSpaceId];
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
  if (!snapshotHasPersistentContent(snapshot)) delete state.spaceSnapshots[state.activeSpaceId];
  else state.spaceSnapshots[state.activeSpaceId] = snapshot;
  if (state.activeSpaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
}

function removeTabsFromSpaceSnapshot(spaceId, snapshotTabs) {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') return;
  const snapshot = removeSnapshotTabs(state.spaceSnapshots[spaceId], snapshotTabs);
  if (!snapshot) return;
  if (!snapshotHasPersistentContent(snapshot)) delete state.spaceSnapshots[spaceId];
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

async function toggleGroup(group, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => toggleGroup(currentGroupForMutation(group), { stateLocked: true }));
  }
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
  dragState = {
    type: 'group',
    key: context.key,
    groupKeys: context.groupKeys,
    sourceContext: context,
    sourceSpaceId: state.activeSpaceId,
    organizationFingerprint: organizationForCurrentSpaceState(state.activeSpaceId).fingerprint,
  };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', context.key);
}

function startFolderDrag(event, folder) {
  if (isInteractiveDragTarget(event.target)) return;
  const context = dragContextForTarget(folder);
  if (!context?.groupKeys?.length) return;
  dragState = {
    type: 'group',
    key: context.key,
    groupKeys: context.groupKeys,
    sourceContext: context,
    sourceSpaceId: state.activeSpaceId,
    organizationFingerprint: organizationForCurrentSpaceState(state.activeSpaceId).fingerprint,
  };
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
  const moveOptions = {
    sourceContext: dragState.sourceContext,
    sourceSpaceId: dragState.sourceSpaceId,
    expectedFingerprint: dragState.organizationFingerprint,
  };
  const intent = groupDropIntent(event);
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
  runTask(() => (
    intent === 'inside'
      ? moveGroupBlockIntoContext(sourceKeys, targetContext, moveOptions)
      : moveGroupBlockBesideContext(sourceKeys, targetContext, intent, moveOptions)
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

async function moveGroupBlockIntoContext(sourceKeys, targetContext, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      assertFreshOrganizationDrag(options);
      const currentTarget = dragContextForTarget(targetContext?.key);
      if (!currentTarget) throw new Error('The target group changed in another Space Tabs view. Try the drag again.');
      return moveGroupBlockIntoContext(sourceKeys, currentTarget, { ...options, stateLocked: true });
    });
  }
  const targetPath = targetContext?.path || [];
  if (!targetPath.length) return;

  const sourceContext = options.sourceContext;
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

async function moveGroupBlockBesideContext(sourceKeys, targetContext, placement = 'before', options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      assertFreshOrganizationDrag(options);
      const currentTarget = dragContextForTarget(targetContext?.key);
      if (!currentTarget) throw new Error('The target group changed in another Space Tabs view. Try the drag again.');
      return moveGroupBlockBesideContext(sourceKeys, currentTarget, placement, { ...options, stateLocked: true });
    });
  }
  const targetPath = targetPathForSiblingMove(targetContext);
  const sourceContext = options.sourceContext;
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
    groups: groups.filter((group) => snapshotGroupShouldPersist(snapshot, group)),
  };
  if (!snapshotHasPersistentContent(nextSnapshot)) delete state.spaceSnapshots[state.activeSpaceId];
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

function assertFreshOrganizationDrag(options = {}) {
  if (options.sourceSpaceId !== state.activeSpaceId) {
    throw new Error('The active Space changed while dragging. Try the drag again in the current Space.');
  }
  if (
    options.expectedFingerprint &&
    organizationForCurrentSpaceState(state.activeSpaceId).fingerprint !== options.expectedFingerprint
  ) {
    throw new Error('This Space changed in another Space Tabs view. Review it before dragging again.');
  }
}

function startTabDrag(event, tab, groupKey) {
  event.stopPropagation();
  dragState = {
    type: 'tab',
    tabId: tab.id,
    tabUrl: tab.url,
    groupKey,
    sourceSpaceId: state.activeSpaceId,
    organizationFingerprint: organizationForCurrentSpaceState(state.activeSpaceId).fingerprint,
  };
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
  const tabId = dragState.tabId;
  const moveOptions = {
    expectedUrl: dragState.tabUrl,
    sourceSpaceId: dragState.sourceSpaceId,
    expectedFingerprint: dragState.organizationFingerprint,
  };
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
  runTask(() => reorderTab(tabId, targetGroupKey, targetTab.id, moveOptions));
}

function dropTabAtEnd(event, targetGroup) {
  const targetRow = event.target.closest('.tab-row');
  if (dragState?.type !== 'tab' || (targetRow && !targetRow.classList.contains('dormant'))) return;
  const tabId = dragState.tabId;
  const moveOptions = {
    targetGroup,
    expectedUrl: dragState.tabUrl,
    sourceSpaceId: dragState.sourceSpaceId,
    expectedFingerprint: dragState.organizationFingerprint,
  };
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
  runTask(() => reorderTab(tabId, targetGroup.key, null, moveOptions));
}

async function reorderTab(tabId, targetGroupKey, beforeTabId, options = {}) {
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      assertFreshOrganizationDrag(options);
      const numericTabId = Number(tabId);
      const currentTab = tabs.find((item) => Number(item.id) === numericTabId);
      if (!currentTab || (options.expectedUrl && currentTab.url !== options.expectedUrl)) {
        throw new Error('This tab changed in another Space Tabs view. Try the drag again.');
      }
      const currentTarget = spaceView.find((group) => group.key === targetGroupKey) || options.targetGroup;
      if (!currentTarget) throw new Error('The target group changed in another Space Tabs view. Try the drag again.');
      return reorderTab(tabId, targetGroupKey, beforeTabId, {
        ...options,
        stateLocked: true,
        targetGroup: currentTarget,
      });
    });
  }
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
  const targets = (openTabs || []).map((tab) => {
    const group = groupForTab(tab);
    return {
      ...tab,
      groupTitle: group?.title || '',
      groupColor: group?.color || '',
    };
  }).sort((left, right) => (
    Number(snapshotHasExactTargetInGroup(snapshot, right)) -
    Number(snapshotHasExactTargetInGroup(snapshot, left))
  ));
  const nextSnapshot = removeSnapshotTabs(snapshot, targets);
  if (!nextSnapshot || sameSnapshotGroups(snapshot, nextSnapshot)) return;

  const updatedSnapshot = {
    ...nextSnapshot,
    updatedAt: Date.now(),
  };
  if (!snapshotHasPersistentContent(updatedSnapshot)) delete state.spaceSnapshots[state.activeSpaceId];
  else state.spaceSnapshots[state.activeSpaceId] = updatedSnapshot;
  dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
}

function snapshotHasExactTargetInGroup(snapshot, target) {
  const targetUrlIdentity = snapshotUrlIdentity(target?.url);
  if (!targetUrlIdentity || !target.groupTitle) return false;
  return (snapshot.groups || []).some((group) => (
    String(group.title || 'Ungrouped') === target.groupTitle &&
    String(group.color || 'grey') === (target.groupColor || 'grey') &&
    (group.tabs || []).some((tab) => snapshotUrlIdentity(tab.url) === targetUrlIdentity)
  ));
}

function removeClosedTabFromSnapshot(tab, sourceGroup) {
  const snapshot = sanitizeSpaceSnapshot(state.spaceSnapshots?.[state.activeSpaceId]);
  if (!snapshot) return;
  const target = snapshotRemovalTargetForClosedTab(tab, sourceGroup);
  if (target.urlIdentities.length === 0 && target.titleDomainPairs.length === 0) return;

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
  if (!snapshotHasPersistentContent(nextSnapshot)) delete state.spaceSnapshots[state.activeSpaceId];
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
  const recentlyOpenedUrlIdentities = uniqueKeys(
    recentlyOpenedMatches.map((item) => item.urlIdentity || snapshotUrlIdentity(item.url)),
  );
  const urlIdentities = uniqueKeys([
    snapshotUrlIdentity(tab?.url),
    ...recentlyOpenedUrlIdentities,
  ]);
  const navigationUrlKeys = uniqueKeys(recentlyOpenedUrlIdentities.map(comparableSnapshotUrl));
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
    urlIdentities,
    navigationUrlKeys,
    titleDomainPairs,
    groupKey: groupTitleKey(sourceGroup?.title || ''),
  };
}

function removeSnapshotTabsForTarget(snapshot, target, options = {}) {
  const match = findSnapshotTabRemovalMatch(snapshot, target, options);
  if (!match) return { changed: false, groups: snapshot.groups || [] };
  const groups = [];

  for (let groupIndex = 0; groupIndex < (snapshot.groups || []).length; groupIndex += 1) {
    const group = snapshot.groups[groupIndex];
    const tabs = (group.tabs || []).filter((_, tabIndex) => (
      groupIndex !== match.groupIndex || tabIndex !== match.tabIndex
    ));
    const nextGroup = { ...group, tabs };
    if (snapshotGroupShouldPersist(snapshot, nextGroup)) groups.push(nextGroup);
  }

  return { changed: true, groups };
}

function findSnapshotTabRemovalMatch(snapshot, target, options = {}) {
  const candidates = [];
  for (let groupIndex = 0; groupIndex < (snapshot.groups || []).length; groupIndex += 1) {
    const group = snapshot.groups[groupIndex];
    const groupMatches = !options.requireGroup ||
      !target.groupKey ||
      groupTitleKey(group.title) === target.groupKey;
    if (!groupMatches) continue;
    for (let tabIndex = 0; tabIndex < (group.tabs || []).length; tabIndex += 1) {
      candidates.push({
        groupIndex,
        tabIndex,
        tab: group.tabs[tabIndex],
      });
    }
  }

  for (const urlIdentity of target.urlIdentities || []) {
    const exactMatch = candidates.find((candidate) => (
      snapshotUrlIdentity(candidate.tab.url) === urlIdentity
    ));
    if (exactMatch) return exactMatch;
  }
  for (const navigationUrlKey of target.navigationUrlKeys || []) {
    const navigationMatch = candidates.find((candidate) => (
      comparableSnapshotUrl(candidate.tab.url) === navigationUrlKey
    ));
    if (navigationMatch) return navigationMatch;
  }
  if ((target.urlIdentities || []).length === 0) {
    return candidates.find((candidate) => (
      snapshotTabMatchesTitleDomain(candidate.tab, target.titleDomainPairs)
    )) || null;
  }
  return null;
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
  const urlIdentity = snapshotUrlIdentity(tab?.url);
  const groupKey = groupTitleKey(dormantGroup?.title || '');
  if (!urlIdentity || !groupKey) return;
  pruneRecentlyOpenedDormantTabs();
  recentlyOpenedDormantTabs.push({
    url: urlIdentity,
    urlIdentity,
    titleKey: tabTitleMatchKey(tab),
    domain: domainFromUrl(tab?.url),
    groupKey,
    groupTitle: dormantGroup?.title || '',
    groupColor: dormantGroup?.color || 'grey',
    tabId: Number.isFinite(Number(tabId)) ? Number(tabId) : null,
    openedAt: Date.now(),
  });
}

function recentlyOpenedDormantRecordForTab(tab, dormantGroup) {
  pruneRecentlyOpenedDormantTabs();
  const urlIdentity = snapshotUrlIdentity(tab?.url);
  const groupKey = groupTitleKey(dormantGroup?.title || '');
  return recentlyOpenedDormantTabs.find((opened) => (
    opened.groupKey === groupKey &&
    urlIdentity &&
    opened.urlIdentity === urlIdentity
  )) || null;
}

function liveTabMatchesOpenedDormantRecord(tab, opened) {
  if (Number.isFinite(Number(opened.tabId)) && Number(tab?.id) === Number(opened.tabId)) return true;
  const urlIdentity = snapshotUrlIdentity(tab?.url);
  return Boolean(urlIdentity && opened.urlIdentity === urlIdentity);
}

function recentlyOpenedDormantRecordForLiveTab(tab) {
  pruneRecentlyOpenedDormantTabs();
  return recentlyOpenedDormantTabs.find((opened) => liveTabMatchesOpenedDormantRecord(tab, opened)) || null;
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

function prepareOrganizationAIRequestFromUserGesture(candidateProbe) {
  const aiSettings = structuredClone(state.ai);
  let permissionRequest = Promise.resolve(true);
  let permissionRequested = false;
  if (
    candidateProbe() &&
    (!providerRequiresApiKey(aiSettings) || aiSettings.apiKey)
  ) {
    try {
      permissionRequest = requestAIHostPermissionFromUserGesture(aiSettings);
    } catch (error) {
      permissionRequest = Promise.reject(error);
    }
    permissionRequested = true;
  }
  permissionRequest.catch(() => null);
  return { aiSettings, permissionRequest, permissionRequested };
}

function hasCurrentTidyNamesAICandidates() {
  return spaceView.some((group) => (group.tabs || []).some((tab) => (
    !tab.dormant && !hasManualPanelName(tab.id) &&
    Number.isFinite(Number(tab.id)) && isPageShortcutCapableUrl(tab.url)
  )));
}

function prepareTidyNamesRequestFromUserGesture() {
  return prepareOrganizationAIRequestFromUserGesture(hasCurrentTidyNamesAICandidates);
}

function startTidyNamesFromUserGesture() {
  const request = prepareTidyNamesRequestFromUserGesture();
  void runTask(() => tidyTabNames(request));
}

async function tidyTabNames(options = {}) {
  const startedAt = performance.now();
  const aiSettings = options.aiSettings || structuredClone(state.ai);
  const permissionRequest = options.permissionRequest || Promise.resolve(true);
  const permissionRequested = options.permissionRequested === true;
  beginPanelAction('tidyNames');
  try {
    await refreshOrganizationActionState({ adopt: false });
    const sourceSpaceId = state.activeSpaceId;
    const visibleTabs = spaceView
      .flatMap((group) => group.tabs)
      .filter((tab) => (
        !tab.dormant && Number.isFinite(Number(tab.id)) && isPageShortcutCapableUrl(tab.url)
      ));
    if (visibleTabs.length === 0) {
      setStatus('No tabs in this Space to rename.');
      return;
    }

    const aiCandidates = visibleTabs.filter((tab) => !hasManualPanelName(tab.id));
    const useAI = aiCandidates.length > 0 && (!providerRequiresApiKey(aiSettings) || Boolean(aiSettings.apiKey));
    if (useAI) {
      const provider = providerById(aiSettings.provider);
      setStatus(`Generating Tidy Names preview with ${provider.label} for ${aiCandidates.length} ${aiCandidates.length === 1 ? 'tab' : 'tabs'}...`);
    }

    const localNames = planTidyTabNames(visibleTabs, {
      existingNames: state.renamedTabs,
      preserveExisting: true,
    });
    const aiNames = useAI
      ? await tidyTabNamesWithAI(aiCandidates, {
        permissionRequest: permissionRequested ? permissionRequest : null,
        settings: aiSettings,
      })
      : {};
    const plannedNames = { ...localNames, ...aiNames };
    const renameItems = visibleTabs
      .map((tab) => ({
        id: Number(tab.id),
        title: tab.displayTitle || tab.title || 'Untitled',
        result: plannedNames[tab.id] || tab.displayTitle || tab.title || 'Untitled',
        meta: tab.domain,
      }))
      .filter((item) => item.title !== item.result);
    const untouchedItems = visibleTabs
      .filter((tab) => !renameItems.some((item) => item.id === Number(tab.id)))
      .map((tab) => ({
        title: tab.displayTitle || tab.title || 'Untitled',
        result: 'Unchanged',
        meta: tab.domain,
      }));
    if (renameItems.length === 0) {
      setStatus('Tidy Names found no changes to apply.');
      return;
    }
    const previewTargetIds = new Set(renameItems.map((item) => item.id));
    const previewTargetFingerprint = fingerprintTidyNameTargets(
      visibleTabs.filter((tab) => previewTargetIds.has(Number(tab.id))),
      state.renamedTabs,
    );

    const confirmed = await showPlanPreview({
      title: 'Preview Tidy Names',
      message: `${renameItems.length} ${renameItems.length === 1 ? 'name' : 'names'} · ${formatPreviewDuration(performance.now() - startedAt)}`,
      confirmText: 'Apply tidy',
      sections: [
        { title: 'Rename in panel', items: renameItems },
        { title: 'Remain untouched', items: untouchedItems },
      ],
    });
    if (!confirmed) return;

    await withSharedStateLock(async () => {
      await syncStateFromStorage();
      if (state.activeSpaceId !== sourceSpaceId) {
        throw new Error('The active Space changed while Tidy Names was open. Run it again in the current Space.');
      }
      await loadTabs({ adopt: false });
      const targetIds = new Set(renameItems.map((item) => item.id));
      const currentTargets = tabs.filter((tab) => targetIds.has(Number(tab.id)));
      if (
        currentTargets.length !== renameItems.length ||
        fingerprintTidyNameTargets(currentTargets, state.renamedTabs) !== previewTargetFingerprint
      ) {
        throw new Error('Tabs changed while Tidy Names was open. Review a fresh preview before applying names.');
      }
      const beforeNames = Object.fromEntries(renameItems.map((item) => [
        item.id,
        Object.hasOwn(state.renamedTabs, item.id) ? state.renamedTabs[item.id] : null,
      ]));
      const afterNames = Object.fromEntries(renameItems.map((item) => [item.id, item.result]));
      let operationId = '';
      try {
        for (const item of renameItems) state.renamedTabs[item.id] = item.result;
        await saveState();
        await refreshTabs();

        const refreshedTargets = tabs.filter((tab) => targetIds.has(Number(tab.id)));
        if (refreshedTargets.length !== renameItems.length) {
          throw new Error('Tabs changed while Tidy Names was being applied. The rename was rolled back.');
        }
        const operation = recordOperation({
          type: 'tidy-names',
          spaceId: sourceSpaceId,
          summary: `Tidy Names renamed ${renameItems.length} ${renameItems.length === 1 ? 'tab' : 'tabs'}`,
          before: { renamedTabs: beforeNames },
          after: {
            renamedTabs: afterNames,
            targetFingerprint: fingerprintTidyNameTargets(refreshedTargets, state.renamedTabs),
          },
        });
        operationId = operation.id;
        await saveState();
        renderOperationRecord();
      } catch (error) {
        removeOperationRecord(operationId);
        for (const [tabId, previousName] of Object.entries(beforeNames)) {
          if (previousName === null || previousName === undefined || previousName === '') delete state.renamedTabs[tabId];
          else state.renamedTabs[tabId] = previousName;
        }
        const rollbackFailures = [];
        try {
          await saveState();
          await refreshTabs();
        } catch (rollbackError) {
          rollbackFailures.push({ stage: 'restoring Tidy Names state', error: rollbackError });
        }
        if (rollbackFailures.length > 0) throw rollbackFailureError(error, rollbackFailures);
        throw error;
      }
    });
    setStatus(`Renamed ${renameItems.length} ${renameItems.length === 1 ? 'tab' : 'tabs'} in the panel only.`);
  } finally {
    endPanelAction();
  }
}

async function tidyTabNamesWithAI(candidates, options = {}) {
  const settings = options.settings || structuredClone(state.ai);
  if ((providerRequiresApiKey(settings) && !settings.apiKey) || candidates.length === 0) return {};

  try {
    await (options.permissionRequest || ensureAIHostPermission(settings));
    const response = await send('ai:chat', {
      settings,
      purpose: 'tidy-names',
      itemCount: candidates.length,
      messages: createPrompt('tidy-names', {
        tabs: candidates.map(compactTabForAI),
        language: settings.language,
      }),
    });
    if (response.finishReason === 'length') {
      throw new Error('The provider reached the Tidy Names output limit before returning a complete list.');
    }
    return parseTidyNames(response.text, candidates);
  } catch (error) {
    setStatus(`${formatAIError(error)} Using local naming instead.`);
    return {};
  }
}

function hasManualPanelName(tabId) {
  return String(state.renamedTabs?.[tabId] || '').trim().length > 0;
}

function prepareAutoGroupRequestFromUserGesture() {
  return prepareOrganizationAIRequestFromUserGesture(hasCurrentAutoGroupAICandidates);
}

function hasCurrentAutoGroupAICandidates() {
  try {
    const sourceSpaceId = state.activeSpaceId;
    const organization = buildOrganizationCandidates({
      liveGroups: buildSpaceViewForSpace(sourceSpaceId),
      snapshot: state.spaceSnapshots?.[sourceSpaceId] || { version: 1, groups: [] },
    });
    return organization.candidates.some((tab) => (
      !tab.pinned && isPageShortcutCapableUrl(tab.url)
    ));
  } catch {
    // Requesting up front is safer than losing the click gesture when local state is malformed.
    return true;
  }
}

function startAutoGroupFromUserGesture() {
  const request = prepareAutoGroupRequestFromUserGesture();
  void runTask(() => autoGroupTabs(request));
}

async function autoGroupTabs(options = {}) {
  const startedAt = performance.now();
  const aiSettings = options.aiSettings || structuredClone(state.ai);
  const permissionRequest = options.permissionRequest || Promise.resolve(true);
  const permissionRequested = options.permissionRequested === true;
  beginPanelAction('autoGroup');
  try {
    await refreshOrganizationActionState({ adopt: true });
  const sourceSpaceId = state.activeSpaceId;
  snapshotOpenSpace(sourceSpaceId);
  const sourceSnapshot = structuredClone(state.spaceSnapshots?.[sourceSpaceId] || {
    version: 1,
    updatedAt: Date.now(),
    groups: [],
  });
  const organization = buildOrganizationCandidates({
    liveGroups: buildSpaceViewForSpace(sourceSpaceId),
    snapshot: sourceSnapshot,
  });
  const candidates = organization.candidates.filter((tab) => (
    !tab.pinned && isPageShortcutCapableUrl(tab.url)
  ));
  const duplicateGroupCount = countDuplicateActiveGroups();
  if (candidates.length === 0 && duplicateGroupCount === 0) {
    const message = 'No live or saved http(s) tabs are available to organize in this Space.';
    setStatus(message);
    showStatusToast(message, 'error');
    return;
  }
  if (extensionRuntime && candidates.length > 0 && providerRequiresApiKey(aiSettings) && !aiSettings.apiKey) {
    const message = 'Auto Group needs a configured AI provider. Add your API key in Settings.';
    setStatus(message);
    showStatusToast(message, 'error');
    return;
  }
  let plannedGroups = [];
    if (candidates.length > 0) {
      try {
        const provider = providerById(aiSettings.provider);
        setStatus(`Generating Auto Group preview with ${provider.label} for ${candidates.length} ${candidates.length === 1 ? 'tab' : 'tabs'}...`);
        if (permissionRequested) await permissionRequest;
        else await ensureAIHostPermission(aiSettings);
        const response = await send('ai:chat', {
          settings: aiSettings,
          purpose: 'auto-group',
          itemCount: candidates.length,
          messages: createPrompt('tidy-tabs', {
            tabs: candidates.map((candidate) => ({
              ...compactTabForAI(candidate),
              currentGroup: candidate.currentGroup?.title || 'Ungrouped',
              status: candidate.dormant ? 'saved' : 'live',
            })),
          }),
        });
        if (response.finishReason === 'length') {
          throw new Error('The provider reached the Auto Group output limit. No groups were changed; try again with fewer tabs.');
        }
        plannedGroups = sanitizeTidyGroups(parseTidyGroups(response.text), candidates);
        if (plannedGroups.length === 0) {
          throw new Error('AI returned no valid groups. Check the configured model and try again.');
        }
      } catch (error) {
        throw new Error(`${formatAIError(error)} Auto Group stopped without making changes.`);
      }
    }

    const plannedTitleByCandidateId = new Map(plannedGroups.flatMap((group) => (
      group.tabIds.map((candidateId) => [Number(candidateId), groupTitleKey(group.title)])
    )));
    const regroupedTabIds = new Set(candidates
      .filter((candidate) => {
        const plannedTitle = plannedTitleByCandidateId.get(Number(candidate.id));
        return plannedTitle && plannedTitle !== groupTitleKey(candidate.currentGroup?.title || 'Ungrouped');
      })
      .map((candidate) => Number(candidate.id)));
    const regroupedCount = regroupedTabIds.size;
    const tabsById = new Map(candidates.map((tab) => [Number(tab.id), tab]));
    const groupedCount = plannedGroups.reduce((sum, group) => sum + group.tabIds.length, 0);
    const previewSections = plannedGroups.map((group) => ({
      title: group.title,
      color: group.color,
      kind: 'group',
      items: group.tabIds.map((tabId) => {
        const tab = tabsById.get(Number(tabId));
        const regroup = regroupedTabIds.has(Number(tabId));
        return {
          title: tab?.displayTitle || tab?.title || 'Untitled',
          meta: domainFromUrl(tab?.url || ''),
          source: regroup ? tab?.currentGroup?.title || 'Current group' : '',
          badge: tab?.dormant ? 'Saved' : 'Live',
        };
      }),
    }));
    const untouchedCandidates = candidates.filter((candidate) => !plannedTitleByCandidateId.has(Number(candidate.id)));
    if (untouchedCandidates.length > 0) {
      previewSections.push({
        title: 'Remain untouched',
        color: 'grey',
        kind: 'notice',
        items: untouchedCandidates.map((candidate) => ({
          title: candidate.title || candidate.url || 'Untitled',
          meta: candidate.currentGroup?.title || 'Ungrouped',
          badge: candidate.dormant ? 'Saved' : 'Live',
        })),
      });
    }
    const candidateIds = new Set(candidates.map((candidate) => Number(candidate.id)));
    const notSentCandidates = organization.candidates.filter((candidate) => !candidateIds.has(Number(candidate.id)));
    const emptyHistoricalTags = (sourceSnapshot.groups || []).filter((group) => (
      !isUngroupedSnapshotGroup(group) && (group.tabs || []).length === 0
    ));
    if (notSentCandidates.length > 0 || emptyHistoricalTags.length > 0) {
      previewSections.push({
        title: 'Untouched',
        color: 'grey',
        kind: 'notice',
        items: [
          ...notSentCandidates.map((candidate) => ({
            title: candidate.title || candidate.url || 'Untitled',
            meta: candidate.pinned
              ? `${candidate.currentGroup?.title || 'Ungrouped'} · pinned`
              : `${candidate.currentGroup?.title || 'Ungrouped'} · restricted URL`,
            badge: candidate.dormant ? 'Saved' : 'Live',
          })),
          ...emptyHistoricalTags.map((group) => ({
            title: group.title || 'Historical Tag',
            meta: 'Empty historical Tag is preserved exactly.',
            badge: 'Saved Tag',
          })),
        ],
      });
    }
    if (duplicateGroupCount > 0) {
      previewSections.push({
        title: 'Merge duplicates',
        color: 'yellow',
        kind: 'notice',
        countLabel: `${duplicateGroupCount} ${duplicateGroupCount === 1 ? 'group' : 'groups'}`,
        items: [{
          title: `${duplicateGroupCount} duplicate ${duplicateGroupCount === 1 ? 'group' : 'groups'}`,
          meta: 'Groups with the same name will be combined.',
        }],
      });
    }
    const previewSummary = [];
    if (plannedGroups.length > 0) {
      previewSummary.push(`${groupedCount} ${groupedCount === 1 ? 'tab' : 'tabs'} → ${plannedGroups.length} ${plannedGroups.length === 1 ? 'group' : 'groups'}`);
    }
    if (regroupedCount > 0) previewSummary.push(`${regroupedCount} moving`);
    if (duplicateGroupCount > 0) {
      previewSummary.push(`${duplicateGroupCount} ${duplicateGroupCount === 1 ? 'merge' : 'merges'}`);
    }
    previewSummary.push(formatPreviewDuration(performance.now() - startedAt));
    const confirmed = await showPlanPreview({
      title: 'Auto Group Preview',
      message: previewSummary.join(' · '),
      confirmText: 'Apply groups',
      sections: previewSections,
      variant: 'groups',
    });
    if (!confirmed) return;

    let createdGroups = 0;
    let mergedGroups = 0;
    await withSharedStateLock(async () => {
      await syncStateFromStorage();
      if (state.activeSpaceId !== sourceSpaceId) {
        throw new Error('The active Space changed while Auto Group was open. Run it again in the current Space.');
      }
      await loadTabs({ adopt: true });
      snapshotOpenSpace(sourceSpaceId);
      const currentSnapshot = structuredClone(state.spaceSnapshots?.[sourceSpaceId] || {
        version: 1,
        updatedAt: Date.now(),
        groups: [],
      });
      const currentOrganization = buildOrganizationCandidates({
        liveGroups: buildSpaceViewForSpace(sourceSpaceId),
        snapshot: currentSnapshot,
      });
      if (currentOrganization.fingerprint !== organization.fingerprint) {
        throw new Error('Tabs changed while Auto Group was open. Review a fresh preview before applying groups.');
      }

      const beforeSnapshot = structuredClone(currentSnapshot);
      const beforeLive = captureLiveOrganization(sourceSpaceId);
      const candidateById = new Map(currentOrganization.candidates.map((candidate) => [Number(candidate.id), candidate]));
      const livePlannedGroups = plannedGroups
        .map((group) => ({
          ...group,
          tabIds: group.tabIds
            .map((candidateId) => Number(candidateById.get(Number(candidateId))?.source?.live?.tabId))
            .filter(Number.isFinite),
        }))
        .filter((group) => group.tabIds.length > 0);

      let operationId = '';
      try {
        state.spaceSnapshots[sourceSpaceId] = applyOrganizationPlanToSnapshot({
          snapshot: currentSnapshot,
          candidates: currentOrganization.candidates,
          plannedGroups,
        });
        dormantSpaceViewSpaceId = '';

        mergedGroups = await mergeDuplicateGroupsInActiveSpace();
        if (mergedGroups) await loadTabs({ adopt: false });
        const existingGroupsByTitle = activeChromeGroupsByTitle();
        for (const group of livePlannedGroups) {
          const titleKey = groupTitleKey(group.title);
          let groupId = existingGroupsByTitle.get(titleKey)?.id;
          if (Number.isFinite(Number(groupId))) {
            const nextGroupId = await addTabsToChromeGroup(groupId, group.tabIds, state.activeSpaceId);
            if (nextGroupId === null) {
              throw new Error(`Chrome could not apply the proposed group "${group.title}".`);
            }
            groupId = nextGroupId;
          } else {
            groupId = await createChromeGroup(group.tabIds, {
              title: group.title,
              color: group.color || nextGroupColor(),
            });
            if (groupId === null) {
              throw new Error(`Chrome could not create the proposed group "${group.title}".`);
            }
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
        await refreshTabs({ reloadDormant: true });
        assertLivePlannedGroupsApplied(livePlannedGroups, sourceSpaceId);

        const operation = recordOperation({
          type: 'auto-group',
          spaceId: sourceSpaceId,
          summary: `Auto Group organized ${groupedCount} ${groupedCount === 1 ? 'tab' : 'tabs'}`,
          before: { snapshot: beforeSnapshot, live: beforeLive },
          after: {
            organizationFingerprint: organizationForCurrentSpaceState(sourceSpaceId).fingerprint,
          },
        });
        operationId = operation.id;
        await saveState();
        renderOperationRecord();
      } catch (error) {
        removeOperationRecord(operationId);
        const rollbackFailures = [];
        state.spaceSnapshots[sourceSpaceId] = structuredClone(beforeSnapshot);
        try {
          await restoreLiveOrganization(beforeLive, sourceSpaceId);
        } catch (rollbackError) {
          rollbackFailures.push({ stage: 'restoring Chrome groups', error: rollbackError });
        }
        state.spaceSnapshots[sourceSpaceId] = structuredClone(beforeSnapshot);
        try {
          await saveState();
          await refreshTabs({ reloadDormant: true });
        } catch (rollbackError) {
          rollbackFailures.push({ stage: 'saving restored Space state', error: rollbackError });
        }
        if (rollbackFailures.length > 0) throw rollbackFailureError(error, rollbackFailures);
        throw error;
      }
    });
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
      if (tabIds.length) {
        const mergedGroupId = await addTabsToChromeGroup(keep.id, tabIds, state.activeSpaceId);
        if (mergedGroupId === null) {
          throw new Error(`Chrome could not merge duplicate group "${keep.title || 'Tabs'}".`);
        }
      }
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

function assertLivePlannedGroupsApplied(livePlannedGroups, spaceId) {
  const chromeGroupsById = new Map(groups.map((group) => [Number(group.id), group]));
  for (const group of livePlannedGroups || []) {
    const expectedTitle = groupTitleKey(group.title);
    for (const tabId of group.tabIds || []) {
      const currentTab = tabs.find((tab) => Number(tab.id) === Number(tabId));
      const currentGroup = chromeGroupsById.get(Number(currentTab?.groupId));
      if (
        !currentTab ||
        !currentGroup ||
        state.groupSpaces[currentGroup.id] !== spaceId ||
        groupTitleKey(currentGroup.title) !== expectedTitle
      ) {
        throw new Error(`Chrome did not finish applying the proposed group "${group.title}". The change was rolled back.`);
      }
    }
  }
}

async function toggleSpaceGroups() {
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    const next = !isSpaceGroupsCollapsed();
    state.collapsedSpaceGroups[state.activeSpaceId] = next;
    await saveState();
    render();
  });
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

function formatPreviewDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value < 1000) return `${Math.max(1, Math.round(value))} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function updatePanelActionUI() {
  const tidyBusy = activePanelAction === 'tidyNames';
  const groupBusy = activePanelAction === 'autoGroup';
  const busy = Boolean(activePanelAction);

  els.tidyNamesButton.disabled = busy;
  els.autoGroupButton.disabled = busy;
  els.collapseGroupsButton.disabled = busy;
  els.tidyNamesButton.innerHTML = tidyBusy ? '...' : TIDY_NAMES_ICON;
  els.autoGroupButton.innerHTML = groupBusy ? '...' : AUTO_GROUP_ICON;
  els.tidyNamesButton.classList.toggle('busy', tidyBusy);
  els.autoGroupButton.classList.toggle('busy', groupBusy);
}

function focusPanelForShortcuts() {
  const target = activeView === 'ask'
    ? els.askPagePrompt
    : els.groupsList;
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

async function openAskPage() {
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    activeView = 'ask';
    ensureCurrentAskSession();
    await saveState();
  });
  render();
  els.askPagePrompt.focus();
}

function startAskFromUserGesture() {
  if (activeAIRequestId) {
    void abortActiveAIRequest();
    return;
  }
  const prompt = els.askPagePrompt.value.trim();
  if (!prompt) return;
  const sourceSpaceId = state.activeSpaceId;
  const sourceSelection = currentAskSources();
  if (sourceSelection.count === 0) {
    const message = sourceSelection.mode === 'selected'
      ? 'The selected rows cannot be read. Select at least one live http(s) tab in this Space.'
      : 'Open at least one http(s) page in this Space before asking it.';
    reportAskStartError(message);
    return;
  }
  const aiSettings = structuredClone(state.ai);
  if (providerRequiresApiKey(aiSettings) && !aiSettings.apiKey) {
    reportAskStartError('AI API key is missing. Add it in Settings before reading page sources.');
    return;
  }
  let permissionRequest;
  try {
    permissionRequest = requestAskPermissionsFromUserGesture(sourceSelection.tabs, aiSettings);
  } catch (error) {
    reportAskStartError(formatAIError(error));
    return;
  }
  void runTask(() => askCustomPrompt({
    prompt,
    sourceSpaceId,
    sourceSelection,
    aiSettings,
    permissionRequest,
  }));
}

function requestAskPermissionsFromUserGesture(sourceTabs = [], aiSettings = state.ai) {
  if (!extensionRuntime) return Promise.resolve(true);
  const origins = [...new Set([
    ...(sourceTabs || [])
      .map((tab) => tab?.url)
      .filter((url) => /^https?:/.test(url || ''))
      .map((url) => getOriginPattern(url)),
    getOriginPattern(aiSettings.baseUrl),
  ])];
  if (origins.length < 2 && sourceTabs.length === 0) {
    throw new Error('Select at least one live http(s) page for Ask Space.');
  }
  return chrome.permissions.request({ origins }).then((granted) => {
    if (!granted) {
      throw new Error('Ask Space permission was not granted. No page content was read or sent.');
    }
    return true;
  });
}

function reportAskStartError(message) {
  setStatus(message);
  showStatusToast(message, 'error');
}

async function askCustomPrompt({
  prompt,
  sourceSpaceId,
  sourceSelection,
  aiSettings,
  permissionRequest,
} = {}) {
  activeView = 'ask';
  render();
  if (state.activeSpaceId !== sourceSpaceId) {
    throw new Error('The active Space changed before Ask started. Review the current sources and try again.');
  }
  const session = ensureCurrentAskSession();
  const history = recentAskHistory(session.messages);
  const sourceSpaceName = currentSpace().name;
  const requestId = beginAIRequest();
  let statusMessage = null;
  try {
    await permissionRequest;
    assertAIRequestActive(requestId);
    const extraction = await send('pages:extract', {
      tabIds: sourceSelection.tabIds,
      options: { maxCharsPerPage: 12000, maxTotalChars: 60000 },
    });
    assertAIRequestActive(requestId);
    const pages = extraction.pages || [];
    const failures = extraction.failures || [];
    if (pages.length + failures.length !== sourceSelection.tabIds.length) {
      throw new Error('Ask Space could not account for every confirmed source. No content was sent.');
    }
    if (pages.length === 0) {
      const detail = failures[0]?.error;
      throw new Error(detail || 'The selected pages could not be read. Reload them and try again.');
    }
    if (state.activeSpaceId !== sourceSpaceId) {
      throw new Error('The active Space changed while sources were being prepared. Review the current Space and try again.');
    }
    const provider = providerById(aiSettings.provider);
    const sourceTabById = new Map(sourceSelection.tabs.map((tab) => [Number(tab.id), tab]));
    const limitedSourceCount = Number(sourceSelection.counts?.limited) || 0;
    const otherUntouchedCount = Math.max(0, sourceSelection.untouchedCount - limitedSourceCount);
    const limitedSourceLabel = sourceSelection.mode === 'selected' ? 'selected' : 'readable';
    const confirmed = await showPlanPreview({
      title: 'Review Ask Space',
      message: `${provider.label} · ${aiSettings.model || 'configured model'} · ${formatCharacterCount(extraction.totalChars)} from ${pages.length} of ${sourceSelection.count} confirmed pages${limitedSourceCount ? ` · ${limitedSourceCount} additional ${limitedSourceLabel} ${limitedSourceCount === 1 ? 'page' : 'pages'} excluded by the 12-page limit` : ''}${history.length ? ` · stored text from ${history.length} recent conversation ${history.length === 1 ? 'message' : 'messages'} (generated Sources appendices excluded)` : ''}. Nothing is sent until you confirm.`,
      confirmText: 'Send to provider',
      sections: [
        {
          title: `${pages.length} source ${pages.length === 1 ? 'page' : 'pages'}`,
          items: pages.map((page, index) => ({
            title: `[${index + 1}] ${page.title || page.url || 'Untitled'}`,
            result: `${formatCharacterCount(page.charCount || String(page.text || '').length)}${page.truncated ? ' · truncated' : ''}`,
            meta: page.url,
          })),
        },
        ...(failures.length ? [{
          title: 'Confirmed sources not sent',
          items: failures.map((failure) => {
            const tab = sourceTabById.get(Number(failure.tabId));
            return {
              title: tab?.displayTitle || tab?.title || tab?.url || `Tab ${failure.tabId}`,
              result: failure.reason === 'content-limit' ? 'Content limit reached' : 'Could not read',
              meta: failure.error,
            };
          }),
        }] : []),
        {
          title: 'Question and conversation context',
          items: [
            { title: 'Your current question', result: 'Sent as written' },
            ...(history.length ? [{
              title: `${history.length} recent conversation ${history.length === 1 ? 'message' : 'messages'}`,
              result: 'Stored message text sent; generated Sources appendices excluded',
            }] : []),
          ],
        },
        ...(limitedSourceCount ? [{
          title: '12-page source limit',
          items: [{
            title: `${limitedSourceCount} additional ${limitedSourceLabel} ${limitedSourceCount === 1 ? 'page' : 'pages'}`,
            result: 'Not read or sent',
          }],
        }] : []),
        ...(otherUntouchedCount ? [{
          title: 'Other Space tabs not sent',
          items: [{
            title: `${otherUntouchedCount} other saved, restricted, or unselected tabs`,
            result: 'Untouched',
          }],
        }] : []),
      ],
    });
    if (!confirmed) return;
    assertAIRequestActive(requestId);
    statusMessage = await beginAskTurn(session.key, prompt, sourceSpaceId);
    activeAskStreams.set(requestId, { messageRef: statusMessage, pages, text: '' });
    assertAIRequestActive(requestId);
    const { text, finishReason } = await send('ai:chat', {
      settings: aiSettings,
      requestId,
      stream: true,
      purpose: 'ask-space',
      messages: createPrompt('ask-space', {
        question: prompt,
        spaceName: sourceSpaceName,
        pages,
        history,
        language: aiSettings.language,
      }),
    });
    assertAIRequestActive(requestId);
    const answerText = finishReason === 'length'
      ? `${text || 'No AI text returned.'}\n\n_The provider stopped at the Ask Space output limit; the answer may be incomplete._`
      : text || 'No AI text returned.';
    const answer = appendAskSourceLinks(answerText, pages);
    els.askPagePrompt.value = '';
    await persistAskMessage(statusMessage, answer);
  } catch (error) {
    const message = formatAIError(error);
    const stream = activeAskStreams.get(requestId);
    const partial = stream?.text || '';
    if (statusMessage) {
      const stopped = Boolean(stream?.aborted) || /request was stopped|ask stopped/i.test(message);
      const answer = partial
        ? appendAskSourceLinks(`${partial}\n\n_${stopped ? 'Request stopped before completion.' : `Request failed before completion: ${message}`}_`, stream?.pages || [])
        : message;
      await persistAskMessage(statusMessage, answer);
    }
    else {
      setStatus(message);
      showStatusToast(message, 'error');
    }
  } finally {
    activeAskStreams.delete(requestId);
    endAIRequest(requestId);
  }
}

function recentAskHistory(messages = []) {
  return (messages || []).slice(-8).map((message) => ({
    role: message.role,
    text: String(message.text || '')
      .split(/\n\n### Sources\n/i)[0]
      .trim(),
  })).filter((message) => message.text);
}

async function beginAskTurn(sessionKey, prompt, sourceSpaceId) {
  let assistantRef;
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    if (state.activeSpaceId !== sourceSpaceId) {
      throw new Error('The active Space changed before Ask was sent. Review the current sources and try again.');
    }
    const latestSession = ensureAskSessionByKey(sessionKey);
    appendAskSessionMessage(latestSession, 'user', prompt);
    const assistant = appendAskSessionMessage(latestSession, 'assistant', 'Thinking...');
    assistantRef = { sessionKey: latestSession.key, messageId: assistant.id };
    await saveState();
  });
  renderAskMessages();
  return assistantRef;
}

async function persistAskMessage(ref, text) {
  if (!ref) return;
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    const latestSession = ensureAskSessionByKey(ref.sessionKey);
    const updated = updateAskSessionMessage(latestSession, ref.messageId, text);
    if (!updated) appendAskSessionMessage(latestSession, 'assistant', text);
    await saveState();
  });
  if (ref.sessionKey === state.activeAskSessionKey && activeView === 'ask') renderAskMessages();
}

function assertAIRequestActive(requestId) {
  if (activeAIRequestId !== requestId) throw new Error('AI request was stopped.');
}

function formatCharacterCount(value) {
  const count = Math.max(0, Number(value) || 0);
  return count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K chars` : `${count} chars`;
}

function startTestAIFromUserGesture(controls = settingsAIControls()) {
  if (activeAIRequestId) {
    void abortActiveAIRequest();
    return;
  }
  let settings;
  let permissionRequest;
  try {
    settings = currentAISettingsFromControls(controls);
    if (providerRequiresApiKey(settings) && !settings.apiKey) {
      throw new Error('AI API key is missing. Add it in Settings.');
    }
    permissionRequest = requestAIHostPermissionFromUserGesture(settings);
  } catch (error) {
    setAIControlsStatus(controls, formatAIError(error));
    return;
  }
  void runTask(() => testAI({ settings, permissionRequest, controls }));
}

async function testAI({ settings = currentAISettingsFromForm(), permissionRequest, controls = settingsAIControls() } = {}) {
  setAIControlsStatus(controls, 'Testing AI configuration...');
  const requestId = beginAIRequest();
  try {
    if (providerRequiresApiKey(settings) && !settings.apiKey) {
      throw new Error('AI API key is missing. Add it in Settings.');
    }
    await (permissionRequest || ensureAIHostPermission(settings));
    const { text, finishReason } = await send('ai:chat', {
      settings,
      requestId,
      purpose: 'test-ai',
      messages: createPrompt('custom', { prompt: 'Reply with one short sentence: AI is connected.', language: 'en' }),
    });
    if (finishReason === 'length') throw new Error('AI connection test reached its output limit.');
    const message = text || 'AI request returned no text.';
    setAIControlsStatus(controls, message);
  } catch (error) {
    const message = formatAIError(error);
    setAIControlsStatus(controls, message);
  } finally {
    endAIRequest(requestId);
    updateOnboardingAIActionState();
  }
}

async function exportSpaceData() {
  let backup;
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    await loadTabs({ adopt: false });
    snapshotOpenSpace(state.activeSpaceId);
    await saveState();
    backup = createSpaceBackup(state);
  });
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `space-backup-${backup.exportedAt.slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const message = `Exported ${formatSpaceBackupSummary(backup)} API keys were excluded.`;
  setSpaceBackupStatus(message);
  setSettingsStatus(message);
}

async function previewSpaceBackupFile() {
  const file = els.spaceBackupInput.files?.[0];
  pendingSpaceBackup = null;
  els.restoreSpaceDataButton.disabled = true;
  if (!file) {
    setSpaceBackupStatus('No backup selected.');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setSpaceBackupStatus('This backup is too large to restore safely.');
    return;
  }

  try {
    pendingSpaceBackup = parseSpaceBackup(await file.text());
    els.restoreSpaceDataButton.disabled = false;
    setSpaceBackupStatus(`Ready to restore ${formatSpaceBackupSummary(pendingSpaceBackup)}`);
  } catch (error) {
    setSpaceBackupStatus(`Cannot read backup: ${error.message || String(error)}`);
  }
}

async function restoreSpaceData() {
  if (!pendingSpaceBackup) {
    setSpaceBackupStatus('Choose a Space backup first.');
    return;
  }
  const ok = await askConfirm({
    title: 'Restore Space Data',
    message: `Replace current Spaces with ${pendingSpaceBackup.spaces.length} Spaces from this backup?`,
    confirmText: 'Restore',
    danger: true,
  });
  if (!ok) return;

  let summary;
  try {
    await withSharedStateLock(async () => {
      await syncStateFromStorage();
      await loadTabs({ adopt: false });
      snapshotOpenSpace(state.activeSpaceId);
      const beforeState = structuredClone(state);
      const beforeBackup = createSpaceBackup(state);
      let persisted = false;
      try {
        summary = restoreSpaceBackup(state, pendingSpaceBackup);
        recordOperation({
          type: 'restore-backup',
          spaceId: state.activeSpaceId,
          summary: `Restored ${summary.spaces} Spaces and ${summary.savedTabs} saved tabs`,
          before: { backup: beforeBackup },
          after: { portableFingerprint: fingerprintPortableWorkspaceContent(state) },
        });
        assertCurrentStateFitsStorage();
        await saveState();
        persisted = true;
        await refreshTabs({ adopt: false, reloadDormant: true });
      } catch (error) {
        state = beforeState;
        const rollbackFailures = [];
        if (persisted) {
          try {
            await saveState();
          } catch (rollbackError) {
            rollbackFailures.push({ stage: 'restoring workspace state', error: rollbackError });
          }
        }
        restoreFailedWorkspaceMutation(beforeState);
        if (rollbackFailures.length > 0) throw rollbackFailureError(error, rollbackFailures);
        throw error;
      }
      activeView = 'space';
      dormantSpaceView = [];
      dormantSpaceViewSpaceId = '';
      lastRenderedGroupsSignature = '';
      lastRenderedAskSignature = '';
      lastRenderedSpacesSignature = '';
      pendingSpaceBackup = null;
      els.spaceBackupInput.value = '';
      els.restoreSpaceDataButton.disabled = true;
      els.settingsDialog.close();
      render();
    });
  } catch (error) {
    setSpaceBackupStatus(`Restore failed: ${error.message || String(error)}`);
    throw error;
  }
  setStatus(`Restored ${summary.spaces} Spaces and ${summary.savedTabs} saved tabs.`);
}

function formatSpaceBackupSummary(backup) {
  const savedTabs = Object.values(backup.spaceSnapshots || {}).reduce((total, snapshot) => (
    total + (snapshot?.groups || []).reduce((sum, group) => sum + (group.tabs || []).length, 0)
  ), 0);
  return `${backup.spaces.length} Spaces and ${savedTabs} saved tabs.`;
}

function clearSettingsArcSelection({ preserveStatus = false } = {}) {
  arcImportSelectionGeneration += 1;
  pendingArcImportText = '';
  pendingArcImportPlan = null;
  els.arcImportInput.value = '';
  els.importArcButton.disabled = true;
  if (!preserveStatus) setArcImportStatus('No Arc file selected.');
}

async function previewArcImportFile(selectedFile = null) {
  const selectionGeneration = ++arcImportSelectionGeneration;
  const file = selectedFile || els.arcImportInput.files?.[0];
  pendingArcImportText = '';
  pendingArcImportPlan = null;
  els.importArcButton.disabled = true;
  if (!file) {
    setArcImportStatus('No Arc file selected.');
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    els.arcImportInput.value = '';
    setArcImportStatus('This file is too large to import safely. Select Arc StorableSidebar.json.');
    return;
  }

  setArcImportStatus(`Reading ${file.name || 'StorableSidebar.json'}...`);

  try {
    const text = await file.text();
    if (selectionGeneration !== arcImportSelectionGeneration) return;
    const plan = createArcImportPlan(text, { existingSpaces: state.spaces });
    pendingArcImportText = text;
    pendingArcImportPlan = plan;
    els.importArcButton.disabled = plan.spaces.length === 0;
    setArcImportStatus(`${file.name || 'StorableSidebar.json'} · ${formatArcImportSummary(plan.summary, 'Ready to append')}${formatArcConflictSummary(plan)}`);
  } catch (error) {
    if (selectionGeneration !== arcImportSelectionGeneration) return;
    clearSettingsArcSelection();
    setArcImportStatus(`Cannot read Arc file: ${error.message || String(error)}`);
  }
}

async function importArcFile() {
  if (!pendingArcImportText || !pendingArcImportPlan) {
    setArcImportStatus('Choose an Arc sidebar file first.');
    return;
  }

  let previewInvalidated = false;
  try {
    const previewById = new Map((pendingArcImportPlan.spacePreviews || []).map((preview) => [preview.spaceId, preview]));
    const confirmed = await showPlanPreview({
      title: 'Review Arc Import',
      message: `${formatArcImportSummary(pendingArcImportPlan.summary, 'Import')}${formatArcConflictSummary(pendingArcImportPlan)}`,
      confirmText: 'Import Spaces',
      sections: [{
        title: 'Spaces to append',
        items: pendingArcImportPlan.spaces.map((space) => {
          const preview = previewById.get(space.id);
          return {
            title: space.name,
            result: `${preview?.folders || 0} folders · ${preview?.tabs || 0} tabs`,
            meta: (preview?.conflicts || []).map((conflict) => `${conflict.original} → ${conflict.resolved}`).join(', '),
          };
        }),
      }],
    });
    if (!confirmed) return;
    let result;
    await withSharedStateLock(async () => {
      await syncStateFromStorage();
      const latestPlan = createArcImportPlan(pendingArcImportText, { existingSpaces: state.spaces });
      if (arcPlanResolutionSignature(pendingArcImportPlan) !== arcPlanResolutionSignature(latestPlan)) {
        previewInvalidated = true;
        throw new Error('Spaces changed after this preview. Choose the Arc file again to review the updated conflict names.');
      }
      const beforeState = structuredClone(state);
      try {
        result = appendArcImportPlan(state, latestPlan);
        rememberArcImport(result.importedSpaceIds);
        assertCurrentStateFitsStorage();
        await saveState();
        render();
        renderSettings();
      } catch (error) {
        restoreFailedWorkspaceMutation(beforeState);
        throw error;
      }
    });
    clearSettingsArcSelection({ preserveStatus: true });
    const message = `Imported ${result.importedSpaces} Spaces and ${result.importedTabs} tabs. Current Space stayed active.`;
    setArcImportStatus(message);
    setSettingsStatus(message);
  } catch (error) {
    if (previewInvalidated) {
      clearSettingsArcSelection({ preserveStatus: true });
    }
    setArcImportStatus(`Import failed: ${error.message || String(error)}`);
  }
}

function rememberArcImport(spaceIds) {
  const ids = [...new Set((spaceIds || []).map(String).filter(Boolean))];
  state.lastArcImport = ids.length
    ? {
      spaceIds: ids,
      importedAt: Date.now(),
      afterFingerprints: fingerprintPortableSpacesContent(state, ids),
    }
    : null;
}

function assertArcImportUndoIsFresh(importRecord) {
  const spaceIds = [...new Set((importRecord?.spaceIds || []).map(String).filter(Boolean))];
  const afterFingerprints = importRecord?.afterFingerprints;
  if (
    spaceIds.length === 0 ||
    !afterFingerprints ||
    spaceIds.some((spaceId) => (
      !Object.hasOwn(afterFingerprints, spaceId) || !String(afterFingerprints[spaceId] || '')
    ))
  ) {
    throw new Error('This Arc import record does not contain the safety data required for Undo.');
  }

  const currentFingerprints = fingerprintPortableSpacesContent(state, spaceIds);
  const changedSpaceIds = spaceIds.filter((spaceId) => (
    currentFingerprints[spaceId] !== afterFingerprints[spaceId]
  ));
  if (changedSpaceIds.length > 0) {
    const changedNames = changedSpaceIds.map((spaceId) => (
      state.spaces.find((space) => space.id === spaceId)?.name || spaceId
    ));
    throw new Error(`Imported ${changedSpaceIds.length === 1 ? 'Space' : 'Spaces'} ${changedNames.join(', ')} changed after the Arc import. Undo was stopped to preserve the newer content.`);
  }
}

async function undoLastArcImport(options = {}) {
  const importedIds = new Set((state.lastArcImport?.spaceIds || []).map(String));
  const removableSpaces = state.spaces.filter((space) => importedIds.has(space.id));
  if (removableSpaces.length === 0) {
    setArcImportStatus('There is no Arc import to undo.');
    return;
  }

  const ok = options.confirm === false || await askConfirm({
    title: 'Undo Arc Import',
    message: `Remove ${removableSpaces.length} imported Spaces and their saved tabs? Open tabs will stay open and return to the active Space.`,
    confirmText: 'Undo Import',
    danger: true,
  });
  if (!ok) return;

  let removedCount = 0;
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    assertArcImportUndoIsFresh(state.lastArcImport);
    const latestImportedIds = new Set((state.lastArcImport?.spaceIds || []).map(String));
    const latestRemovableSpaces = state.spaces.filter((space) => latestImportedIds.has(space.id));
    if (latestRemovableSpaces.length === 0) {
      state.lastArcImport = null;
      await saveState();
      return;
    }
    const remainingSpaces = state.spaces.filter((space) => !latestImportedIds.has(space.id));
    if (remainingSpaces.length === 0) throw new Error('Keep at least one Space before undoing this import.');
    if (latestImportedIds.has(state.activeSpaceId)) state.activeSpaceId = remainingSpaces[0].id;
    for (const spaceId of latestImportedIds) removeSpaceReferences(state, spaceId);
    state.spaces = remainingSpaces;
    state.lastArcImport = null;
    activeView = workbenchMode ? 'ask' : 'space';
    dormantSpaceView = [];
    dormantSpaceViewSpaceId = '';
    lastRenderedGroupsSignature = '';
    lastRenderedSpacesSignature = '';
    removedCount = latestRemovableSpaces.length;
    await saveState();
    await refreshTabs({ adopt: true, reloadDormant: true });
  });
  renderSettings();
  const message = removedCount
    ? `Removed ${removedCount} imported Arc Spaces. Open tabs were kept.`
    : 'There is no Arc import to undo.';
  setArcImportStatus(message);
  setSettingsStatus(message);
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
    menuAction('Update Saved URL', () => updateSavedTabUrl(tab)),
    ...menuSection(moveToSpaceSubmenu((space) => (
      contextTabIds.length > 1
        ? moveSelectedTabsToSpace(contextTabIds, space.id)
        : moveTabToSpace(tab, space.id)
    ))),
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
  hideGroupPreview();
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

async function showPlanPreview({ title, message, confirmText, sections, variant = 'changes' }) {
  const result = await openActionDialog({
    title,
    message,
    confirmText,
    previewSections: sections,
    previewVariant: variant,
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
  previewSections = [],
  previewVariant = 'changes',
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
      els.actionDialog.classList.remove('plan-dialog', 'group-plan-dialog');
      resolve(result);
    };

    const onSubmit = (event) => {
      event.preventDefault();
      finish(withInput ? els.actionDialogInput.value.trim() : true);
    };
    const onCancel = () => finish(null);
    const onClose = () => {
      // Calling dialog.close() queues a close event. A proposal workflow can
      // open its second review dialog before that old event is delivered; in
      // that case the shared dialog is open again and the stale event must not
      // cancel the new review.
      if (els.actionDialog.open) return;
      finish(null);
    };

    els.actionDialogTitle.textContent = title;
    els.actionDialogMessage.textContent = message;
    els.actionDialogMessage.hidden = !message;
    els.actionDialogLabel.hidden = !withInput;
    els.actionDialogInput.value = value;
    els.actionDialogLabel.firstChild.textContent = label || 'Name';
    els.actionDialogConfirm.textContent = confirmText;
    els.actionDialogConfirm.classList.toggle('danger', danger);
    renderActionDialogPreview(previewSections, previewVariant);
    els.actionDialog.classList.toggle('plan-dialog', previewSections.some((section) => section?.items?.length));
    els.actionDialog.classList.toggle('group-plan-dialog', previewVariant === 'groups');

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

function renderActionDialogPreview(sections = [], variant = 'changes') {
  const populatedSections = sections.filter((section) => Array.isArray(section?.items) && section.items.length > 0);
  els.actionDialogPreview.hidden = populatedSections.length === 0;
  els.actionDialogPreview.classList.toggle('group-plan-preview', variant === 'groups');
  const nodes = populatedSections.map((section) => {
    const container = document.createElement('section');
    container.className = 'action-preview-section';
    if (section.tone) container.classList.add(section.tone);
    if (variant === 'groups') {
      container.classList.add('group-plan-section');
      if (section.kind === 'notice') container.classList.add('group-plan-notice');
    }

    const heading = document.createElement('h3');
    const title = document.createElement('span');
    title.textContent = section.title || 'Changes';
    const count = document.createElement('span');
    count.className = 'action-preview-count';
    count.textContent = section.countLabel || (variant === 'groups'
      ? `${section.items.length} ${section.items.length === 1 ? 'tab' : 'tabs'}`
      : String(section.items.length));
    if (variant === 'groups') {
      const label = document.createElement('span');
      label.className = 'group-plan-label';
      const swatch = document.createElement('span');
      swatch.className = 'group-plan-swatch';
      swatch.style.backgroundColor = groupColor(section.color);
      label.append(swatch, title);
      heading.append(label, count);
    } else {
      heading.append(title, count);
    }
    container.append(heading);

    for (const item of section.items) {
      const row = document.createElement('div');
      row.className = 'action-preview-item';

      const before = document.createElement('div');
      before.className = 'action-preview-before';
      const itemTitle = document.createElement('div');
      itemTitle.className = 'action-preview-title';
      itemTitle.textContent = item.title || 'Untitled';
      before.append(itemTitle);
      if (item.meta) {
        const meta = document.createElement('div');
        meta.className = 'action-preview-meta';
        meta.textContent = item.meta;
        meta.title = item.meta;
        before.append(meta);
      }
      if (item.badge) {
        const badge = document.createElement('span');
        badge.className = 'action-preview-badge';
        badge.textContent = item.badge;
        before.append(badge);
      }
      if (item.source) {
        const source = document.createElement('div');
        source.className = 'group-plan-source';
        source.textContent = `From ${item.source}`;
        before.append(source);
      }

      if (variant === 'groups') {
        row.append(before);
        container.append(row);
        continue;
      }

      const arrow = document.createElement('span');
      arrow.className = 'action-preview-arrow';
      arrow.textContent = '\u2192';

      const after = document.createElement('div');
      after.className = 'action-preview-after';
      const result = document.createElement('div');
      result.className = 'action-preview-result';
      result.textContent = item.result || 'No change';
      result.title = result.textContent;
      after.append(result);
      row.append(before, arrow, after);
      container.append(row);
    }
    return container;
  });
  els.actionDialogPreview.replaceChildren(...nodes);
}

function renderSettings() {
  const controls = settingsAIControls();
  renderProviderOptions(controls);
  renderAIProviderFields(normalizeAIProviderSettings(state.ai), controls);
  controls.languageInput.value = state.ai.language || 'zh-CN';
  controls.apiKeyInput.value = state.ai.apiKey;
  controls.apiKeyInput.placeholder = state.ai.apiKey
    ? 'API key configured'
    : providerRequiresApiKey(state.ai) ? 'Paste API key' : 'Not required for Ollama';
  const statusText = apiKeyStatusText();
  els.apiKeyStatus.textContent = statusText;
  els.apiKeyStatus.hidden = !statusText;
  els.clearApiKeyButton.hidden = !state.ai.apiKey || Boolean(localConfig.ai?.apiKey);
  els.clearApiKeyButton.disabled = Boolean(localConfig.ai?.apiKey);
  els.thinkingInput.value = state.ai.thinking;
  els.undoArcImportButton.disabled = !(state.lastArcImport?.spaceIds || [])
    .some((spaceId) => state.spaces.some((space) => space.id === spaceId));

  const theme = state.tempTheme || state.theme || 'purple';
  for (const option of els.themeOptions.querySelectorAll('.theme-option')) {
    option.classList.toggle('active', option.dataset.theme === theme);
  }

  renderShortcutSettings();
}

function settingsAIControls() {
  return {
    providerInput: els.providerInput,
    baseUrlInput: els.baseUrlInput,
    modelInput: els.modelInput,
    customModelLabel: els.customModelLabel,
    customModelInput: els.customModelInput,
    apiKeyInput: els.apiKeyInput,
    thinkingInput: els.thinkingInput,
    languageInput: els.languageInput,
    testButton: els.testAIButton,
    statusTarget: els.settingsStatus,
  };
}

function onboardingAIControls() {
  return {
    providerInput: els.onboardingProviderInput,
    baseUrlInput: els.onboardingBaseUrlInput,
    modelInput: els.onboardingModelInput,
    customModelLabel: els.onboardingCustomModelLabel,
    customModelInput: els.onboardingCustomModelInput,
    apiKeyInput: els.onboardingApiKeyInput,
    thinkingInput: els.onboardingThinkingInput,
    languageInput: null,
    testButton: els.onboardingTestAIButton,
    statusTarget: els.onboardingAIStatus,
  };
}

function renderOnboardingAISettings() {
  const controls = onboardingAIControls();
  const configured = Boolean(String(state.ai?.baseUrl || '').trim() && String(state.ai?.model || '').trim());
  renderProviderOptions(controls, { placeholder: true });
  controls.apiKeyInput.value = state.ai?.apiKey || '';
  controls.thinkingInput.value = state.ai?.thinking || 'disabled';
  if (configured) {
    renderAIProviderFields(normalizeAIProviderSettings(state.ai), controls);
    controls.apiKeyInput.value = state.ai?.apiKey || '';
    setAIControlsStatus(controls, 'Review the provider, test it, or continue without AI.');
  } else {
    controls.providerInput.value = '';
    controls.baseUrlInput.value = '';
    controls.baseUrlInput.disabled = true;
    controls.modelInput.replaceChildren();
    controls.modelInput.disabled = true;
    controls.apiKeyInput.disabled = true;
    controls.thinkingInput.disabled = true;
    controls.customModelLabel.hidden = true;
    controls.customModelInput.required = false;
    setAIControlsStatus(controls, 'Choose a provider or continue without AI.');
  }
  updateOnboardingAIActionState();
}

function renderProviderOptions(controls = settingsAIControls(), config = {}) {
  const providerOptions = AI_PROVIDER_CATALOG.map((provider) => {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    return option;
  });
  if (config.placeholder) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a provider';
    placeholder.disabled = true;
    providerOptions.unshift(placeholder);
  }
  controls.providerInput.replaceChildren(...providerOptions);
}

function renderAIProviderFields(settings, controls = settingsAIControls()) {
  const normalized = normalizeAIProviderSettings(settings);
  controls.providerInput.value = normalized.provider;
  const provider = providerById(normalized.provider);
  controls.baseUrlInput.disabled = false;
  controls.modelInput.disabled = false;
  controls.apiKeyInput.disabled = false;
  controls.thinkingInput.disabled = false;
  controls.baseUrlInput.value = normalized.provider === CUSTOM_AI_PROVIDER_ID ? normalized.baseUrl : provider.baseUrl;
  controls.baseUrlInput.readOnly = !provider.editableBaseUrl;
  controls.baseUrlInput.classList.toggle('readonly', controls.baseUrlInput.readOnly);
  controls.apiKeyInput.placeholder = provider.requiresApiKey === false ? 'Not required for Ollama' : 'Paste API key';
  renderModelOptions(provider, normalized.model, controls);
}

function renderModelOptions(provider, selectedModel = '', controls = settingsAIControls()) {
  const customOption = document.createElement('option');
  customOption.value = CUSTOM_MODEL_VALUE;
  customOption.textContent = 'Custom model...';
  const options = provider.models.map((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    return option;
  });
  options.push(customOption);
  controls.modelInput.replaceChildren(...options);

  const hasBuiltInModel = provider.models.some((model) => model.id === selectedModel);
  controls.modelInput.value = hasBuiltInModel ? selectedModel : CUSTOM_MODEL_VALUE;
  controls.customModelInput.value = hasBuiltInModel ? '' : selectedModel;
  updateCustomModelVisibility(controls);
}

function updateCustomModelVisibility(controls = settingsAIControls()) {
  const custom = controls.modelInput.value === CUSTOM_MODEL_VALUE;
  controls.customModelLabel.hidden = !custom;
  controls.customModelInput.required = custom;
}

function settingsFromProviderSelection(controls = settingsAIControls()) {
  const provider = providerById(controls.providerInput.value);
  const isCurrentCustom = state.ai.provider === CUSTOM_AI_PROVIDER_ID;
  return {
    ...state.ai,
    provider: provider.id,
    baseUrl: provider.editableBaseUrl && isCurrentCustom ? state.ai.baseUrl : provider.baseUrl,
    model: provider.editableBaseUrl && isCurrentCustom ? state.ai.model : provider.models[0]?.id || '',
  };
}

function apiKeyStatusText() {
  if (localConfig.ai?.apiKey) return '';
  if (state.ai.apiKey) return 'API key is configured for this Chrome session.';
  if (!providerRequiresApiKey(state.ai)) return 'Ollama does not require an API key.';
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
  let aiSettings;
  try {
    aiSettings = currentAISettingsFromForm();
  } catch (error) {
    setSettingsStatus(error.message || String(error));
    return;
  }
  const selectedTheme = state.tempTheme;

  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    state.ai = aiSettings;
    state.shortcuts = shortcuts;
    if (selectedTheme) state.theme = selectedTheme;
    delete state.tempTheme;
    if (state.ai.apiKey) await secretSet({ [SECRET_STORAGE_KEY]: { ai: { apiKey: state.ai.apiKey } } });
    else await secretRemove(SECRET_STORAGE_KEY);
    await saveState();
  });
  if (workbenchMode) {
    renderSettings();
    setSettingsStatus('Settings saved.');
  } else {
    els.settingsDialog.close();
  }
  render();
}

async function clearApiKey() {
  if (localConfig.ai?.apiKey) {
    setSettingsStatus('API key comes from config.local.js. Remove it there and reload the extension.');
    return;
  }
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    state.ai.apiKey = '';
    els.apiKeyInput.value = '';
    await secretRemove(SECRET_STORAGE_KEY);
    await saveState();
  });
  renderSettings();
  setSettingsStatus('API key cleared. AI requests are disabled until you add a key.');
}

function currentAISettingsFromForm() {
  return currentAISettingsFromControls(settingsAIControls());
}

function currentAISettingsFromControls(controls) {
  const provider = providerById(controls.providerInput.value);
  const settings = {
    ...normalizeAIProviderSettings({
      ...state.ai,
      provider: provider.id,
      baseUrl: provider.editableBaseUrl ? controls.baseUrlInput.value.trim().replace(/\/+$/, '') : provider.baseUrl,
      model: selectedModelFromControls(controls),
    }),
    language: controls.languageInput?.value || state.ai.language || 'zh-CN',
    apiKey: controls.apiKeyInput.value.trim(),
    thinking: controls.thinkingInput.value,
  };
  let url;
  try {
    url = new URL(settings.baseUrl);
  } catch {
    throw new Error('Enter a valid http(s) AI Base URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('AI Base URL must use http or https.');
  }
  if (!settings.model) throw new Error('Choose or enter an AI model.');
  return settings;
}

function selectedModelFromForm() {
  return selectedModelFromControls(settingsAIControls());
}

function selectedModelFromControls(controls) {
  if (controls.modelInput.value === CUSTOM_MODEL_VALUE) return controls.customModelInput.value.trim();
  return controls.modelInput.value;
}

function updateOnboardingAIActionState() {
  const controls = onboardingAIControls();
  let valid = false;
  if (controls.providerInput.value) {
    try {
      const settings = currentAISettingsFromControls(controls);
      valid = !providerRequiresApiKey(settings) || Boolean(settings.apiKey);
    } catch {
      valid = false;
    }
  }
  els.onboardingOpenWorkbenchButton.disabled = !valid;
  controls.testButton.disabled = !valid || Boolean(activeAIRequestId);
}

function setAIControlsStatus(controls, message) {
  controls.statusTarget.textContent = message;
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
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error('AI provider access was not granted. No request was sent.');
  return true;
}

function requestAIHostPermissionFromUserGesture(settings = state.ai) {
  if (!extensionRuntime) return Promise.resolve(true);
  const origin = getOriginPattern(settings.baseUrl);
  return chrome.permissions.request({ origins: [origin] }).then((granted) => {
    if (!granted) throw new Error('AI provider access was not granted. No request was sent.');
    return true;
  });
}

async function send(type, payload = {}) {
  if (!extensionRuntime) return previewSend(type, payload);
  const message = type === 'tabs:list' && Number.isFinite(panelWindowId) && payload.windowId === undefined
    ? { type, ...payload, windowId: panelWindowId }
    : { type, ...payload };
  const response = await chrome.runtime.sendMessage(message);
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
  const stream = activeAskStreams.get(requestId);
  if (stream) stream.aborted = true;
  activeAIRequestId = '';
  updateAIRequestUI();
  await send('ai:abort', { requestId }).catch(() => null);
  if (activeView === 'ask') setStatus('Ask stopped.');
}

function updateAIRequestUI() {
  const busy = Boolean(activeAIRequestId);
  els.askAIButton.textContent = busy ? 'Stop' : 'Ask Space';
  els.testAIButton.textContent = busy ? 'Stop request' : 'Test AI';
  els.onboardingTestAIButton.textContent = busy ? 'Stop request' : 'Test AI';
  updateOnboardingAIActionState();
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
  const ai = {
    ...state.ai,
    apiKey: '',
  };
  delete ai.maxTokens;
  return {
    ...state,
    ai,
  };
}

function assertCurrentStateFitsStorage() {
  return assertWorkspaceStorageBudget({ [STORAGE_KEY]: stateForStorage() });
}

function restoreFailedWorkspaceMutation(previousState) {
  state = previousState;
  dormantSpaceView = [];
  dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
  lastRenderedAskSignature = '';
  lastRenderedSpacesSignature = '';
  render();
  renderSettings();
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

function runTask(task) {
  activeTaskCount += 1;
  const execute = async () => {
    try {
      await task();
    } catch (error) {
      const message = formatAIError(error);
      setStatus(message);
      if (activeView === 'settings') setSettingsStatus(message);
      if (activeView === 'ask') {
        try {
          await addAskMessage('assistant', message);
        } catch (persistenceError) {
          console.error(persistenceError);
        }
      }
      console.error(error);
    } finally {
      activeTaskCount = Math.max(0, activeTaskCount - 1);
    }
  };
  const queuedTask = taskQueue.then(execute, execute);
  taskQueue = queuedTask.catch(() => undefined);
  return queuedTask;
}

async function withSharedStateLock(task) {
  if (!extensionRuntime || !navigator.locks?.request) return task();
  return navigator.locks.request(SHARED_STATE_LOCK_NAME, { mode: 'exclusive' }, task);
}

async function withFreshSpaceStateMutation(task) {
  return withSharedStateLock(async () => {
    await syncStateFromStorage();
    await loadTabs({ adopt: false });
    await loadDormantSpaceView(state.activeSpaceId, { force: true });
    render();
    return task();
  });
}

async function refreshOrganizationActionState({ adopt = false } = {}) {
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    await loadTabs({ adopt });
    await loadDormantSpaceView(state.activeSpaceId, { force: true });
    render();
  });
}

function currentTabForMutation(reference) {
  const tabId = Number(reference?.id);
  const current = tabs.find((tab) => Number(tab.id) === tabId);
  if (!current || String(current.url || '') !== String(reference?.url || '')) {
    throw new Error('This tab changed in another Space Tabs view. Try the action again.');
  }
  return current;
}

function currentGroupForMutation(reference) {
  const current = spaceView.find((group) => group.key === reference?.key);
  if (!current || groupMutationFingerprint(current) !== groupMutationFingerprint(reference)) {
    throw new Error('This group changed in another Space Tabs view. Try the action again.');
  }
  return current;
}

function groupMutationFingerprint(group = {}) {
  return JSON.stringify({
    key: String(group.key || ''),
    dormant: Boolean(group.dormant),
    title: groupTitleKey(group.title || group.displayTitle),
    color: String(group.color || ''),
    tabs: (group.tabs || []).map((tab) => ({
      id: String(tab?.id ?? ''),
      url: snapshotUrlIdentity(tab?.url),
      dormant: Boolean(tab?.dormant),
    })).sort((left, right) => (
      `${left.id}\n${left.url}`.localeCompare(`${right.id}\n${right.url}`)
    )),
  });
}

function currentSpace() {
  return state.spaces.find((space) => space.id === state.activeSpaceId) || state.spaces[0];
}

function ensureCurrentAskSession() {
  const space = currentSpace();
  const key = sessionKeyForSpace(space.id);
  const session = ensureAskSessionByKey(key, space);
  state.activeAskSessionKey = key;
  state.askSessions = pruneAskSessions(state.askSessions, {
    activeKey: key,
    openTabIds: tabs.map((item) => item.id),
    spaceIds: state.spaces.map((item) => item.id),
  });
  return session;
}

function ensureAskSessionByKey(key, space = currentSpace()) {
  const safeKey = String(key || '').startsWith('space:') ? key : sessionKeyForSpace(space.id);
  const keySpaceId = safeKey.slice('space:'.length);
  const sessionSpace = state.spaces.find((item) => item.id === keySpaceId) || space;
  if (!state.askSessions || typeof state.askSessions !== 'object') state.askSessions = {};
  if (!state.askSessions[safeKey]) state.askSessions[safeKey] = createSpaceAskSession(sessionSpace);
  const session = state.askSessions[safeKey];
  session.spaceId = sessionSpace.id;
  session.title = sessionSpace.name || 'Space';
  session.url = '';
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

function setSettingsStatus(text, tone = settingsStatusTone(text)) {
  els.settingsStatus.textContent = text;
  if (!workbenchMode) return;
  showStatusToast(text, tone);
}

function showStatusToast(text, tone = 'info') {
  clearTimeout(workbenchToastTimer);
  clearTimeout(workbenchToastHideTimer);
  els.workbenchToast.textContent = text;
  els.workbenchToast.dataset.tone = tone;
  els.workbenchToast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  els.workbenchToast.hidden = false;
  els.workbenchToast.classList.add('visible');
  const visibleFor = tone === 'error' ? 5200 : tone === 'progress' ? 8000 : 3800;
  workbenchToastTimer = setTimeout(() => {
    els.workbenchToast.classList.remove('visible');
    workbenchToastHideTimer = setTimeout(() => {
      if (!els.workbenchToast.classList.contains('visible')) els.workbenchToast.hidden = true;
    }, 200);
  }, visibleFor);
}

function settingsStatusTone(text) {
  const message = String(text || '');
  if (/saved|exported|imported|removed|cleared|connected/i.test(message)) return 'success';
  if (/testing|working|loading/i.test(message)) return 'progress';
  if (/failed|error|missing|invalid|cannot|conflict|rejected|must|enter|choose|too large|needs/i.test(message)) return 'error';
  return 'info';
}

function setArcImportStatus(text) {
  els.arcImportStatus.textContent = text;
}

function setSpaceBackupStatus(text) {
  els.spaceBackupStatus.textContent = text;
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

function formatArcConflictSummary(plan) {
  const count = Array.isArray(plan?.conflicts) ? plan.conflicts.length : 0;
  return count ? ` ${count} naming ${count === 1 ? 'conflict was' : 'conflicts were'} resolved and shown below.` : '';
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

async function addAskMessage(role, text, sessionKey = state.activeAskSessionKey) {
  if (!text) return;
  let messageRef;
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    const session = ensureAskSessionByKey(sessionKey);
    const message = appendAskSessionMessage(session, role, text);
    messageRef = { sessionKey: session.key, messageId: message.id };
    await saveState();
  });
  if (messageRef.sessionKey === state.activeAskSessionKey && activeView === 'ask') renderAskMessages();
  return messageRef;
}

async function updateAskMessage(ref, text, options = {}) {
  if (!ref) return;
  const session = ensureAskSessionByKey(ref.sessionKey);
  updateAskSessionMessage(session, ref.messageId, text);
  if (session.key === state.activeAskSessionKey && activeView === 'ask') renderAskMessages();
  if (options.persist !== false) await persistAskMessage(ref, text);
}

function setStatus(text) {
  els.syncStatus.textContent = text;
}

function cleanPanelName(value) {
  return String(value || '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
