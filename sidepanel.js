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
  providerSupportsThinking,
} from './src/shared/ai-providers.js';
import {
  aiAuthScope,
  assertSafeAIAuthTransport,
  createScopedAIAuth,
  persistScopedAIConfiguration,
  reconcileScopedAIKey,
  scopedAIKey,
} from './src/shared/ai-auth.js';
import {
  appendArcImportPlan,
  createArcImportPlan,
  selectArcImportPlan,
} from './src/shared/arc-import.js';
import {
  canPreserveUnconfiguredSettingsAI,
  captureAIAuthTarget,
  captureSettingsBaseline,
  mergeConcurrentSettings,
  normalizeArcImportToken,
  renameTargetReviewFingerprint,
  resolveOperationUndoTarget,
  reviewedRenameTargetIsCurrent,
  sameAIAuthTarget,
  sameArcImportRecord,
} from './src/shared/action-safety.js';
import { createCommandPaletteController } from './src/shared/command-palette-controller.js';
import {
  captureCommandPaletteTabSelection,
  commandPaletteFocusGuard,
  resolveCommandPaletteTabSelection,
} from './src/shared/command-palette-selection.js';
import {
  createDisclosureFocusGuard,
  createPanelFocusController,
} from './src/shared/panel-focus.js';
import {
  createFolderTree,
  folderTitleParts,
  movedGroupTitleForFolderDrop,
  renamedFolderGroupTitle,
} from './src/shared/folder-tree.js';
import {
  chromeGroupTitle,
  chromeGroupTitleKey,
  groupTitleKey,
  normalizeGroupTitle,
  resolveChromeGroupTitleMatch,
} from './src/shared/group-title.js';
import { createPanelKeyboardController } from './src/shared/panel-keyboard.js';
import { createPanelPortController } from './src/shared/panel-port.js';
import {
  createPanelCommandMessage,
  createPanelWindowBindingController,
  confirmPanelWindowBindingAfterInitialization,
  resolvePanelHostBinding,
  runPanelWindowRefreshTransaction,
} from './src/shared/panel-routing.js';
import {
  groupsRenderSignature,
  spacesRenderSignature,
} from './src/shared/panel-render-signatures.js';
import {
  dormantSnapshotGroupIndexFromKey as snapshotGroupIndexFromKey,
  dormantSnapshotGroupKey,
  findDormantSnapshotGroupIndex,
  projectDormantSnapshotGroupRemoval,
  projectDormantSnapshotGroupRename,
  projectOpenedDormantTabRemoval,
  projectSnapshotGroupOrder,
  projectSnapshotTabOrder,
  projectSnapshotTabsRemoval,
  remapSnapshotGroupIndexedState,
  resolveDormantGroupReference,
  resolveDormantTabReference,
  resolveOpenedDormantRecordForLiveTab,
  resolveSnapshotTabRemovalMatch,
} from './src/shared/dormant-snapshot.js';
import {
  normalizeTidyRuleSettings,
  tidyRuleEnabled,
  tidyRulePrompt,
  TIDY_RULES,
} from './src/shared/tidy-rules.js';
import {
  applyOrganizationPlanToSnapshot,
  buildOrganizationCandidates,
  organizationCandidateIdsOpenInOtherWindows,
  rebaseOrganizationPlan,
  resolveOrganizationPlanChanges,
} from './src/shared/organization-plan.js';
import {
  commitWindowBoundWrite,
  createRollbackAggregateError,
  createRollbackFailureError,
  fingerprintTidyNameTargets,
  isRollbackIntegrityFailure,
  isOperationUndoVisible,
  runAutoGroupUndoRollback,
  runDurableCommitBoundary,
  withoutOperationRecord,
} from './src/shared/operation-safety.js';
import { createPreviewCommandHandler, isExtensionRuntime } from './src/shared/preview-runtime.js';
import {
  findReservedShortcutConflict,
  findShortcutConflict,
  formatShortcut,
  mergeShortcuts,
  normalizeShortcut,
  RESERVED_SHORTCUTS,
  SHORTCUT_ACTIONS,
} from './src/shared/shortcuts.js';
import {
  activeSpaceForStorage,
  activeSpaceForWindow,
  BROWSER_SESSION_CARRYOVER_STORAGE_KEY,
  BROWSER_SESSION_STORAGE_KEY,
  createDefaultState,
  mergeStoredState,
  normalizeWindowSpaceState,
  pickBrowserSessionId,
  reassignDeletedSpaceWindows,
  rememberActiveSpaceForWindow,
  resetChromeSessionBindings,
  SECRET_STORAGE_KEY,
  SHARED_STATE_LOCK_NAME,
  STORAGE_KEY,
  WINDOW_STATE_KEY,
} from './src/shared/state.js';
import {
  persistStoragePair,
  persistStorageStep,
} from './src/shared/storage-transaction.js';
import {
  resolveFreshTabSelection,
  selectionForContextMenu,
  tabSelectionFromClick,
} from './src/shared/tab-selection.js';
import {
  captureChromeGroupMutationMemory,
  captureChromeGroupTitleRollback,
  captureTabGroupMembership,
  orderDuplicateChromeGroups,
  projectChromeGroupRollbackMemory,
  remapChromeGroupBindings,
  remapLogicalChromeGroupTitles,
  resolveChromeGroupIdReplacement,
  restoreTabGroupMembership,
  restoreTabPositions,
  runChromeGroupMutationTransaction,
} from './src/shared/chrome-group-transaction.js';
import {
  closeTabIdsSequentially,
  reviewedTabCloseCandidateMismatch,
  rollbackCreatedTabsOnCheckpointFailure,
  runDestructiveTabClose,
  runGuardedDestructiveTabClose,
  tabCloseGuardFor,
  tabMatchesDestructiveTarget,
} from './src/shared/tab-close-transaction.js';
import { planMixedTabDropOrder, tabOrderAfterDuplicate } from './src/shared/tab-move.js';
import { migratePanelTabIdReplacement } from './src/shared/tab-replacement.js';
import {
  bindLiveTabsToSnapshot,
  claimViewSnapshotLifecycleId,
  ensureSnapshotLifecycleIds,
  remapTabLifecycleGroupReferences,
  reduceTabLifecycleEvent,
  resolveViewSnapshotGroupId,
  sanitizeSnapshotWithLifecycleIds,
} from './src/shared/tab-lifecycle.js';
import {
  clearableUngroupedTabs,
  combineDuplicateTagMergePlans,
  comparableSnapshotUrl,
  dropTemporarySnapshotGroups,
  isRestorableSnapshotTab,
  isUngroupedSnapshotGroup,
  mergeDuplicateSnapshotTags,
  mergeOpenSpaceSnapshot,
  removeSnapshotTabs,
  retitleSnapshotGroup,
  sanitizeSpaceSnapshot,
  snapshotEmptyTagIsMergeCandidate,
  snapshotGroupShouldPersist,
  snapshotHasPersistentContent,
  snapshotTabCount,
  uniqueSnapshotGroupForTabId,
  updateSnapshotTab,
} from './src/shared/space-snapshot.js';
import { planSpaceSwitch } from './src/shared/space-switch.js';
import {
  collectSpaceDeletionRollbackFailures,
  createCommittedSpaceDeletionError,
  createSpaceDeletionRollbackJournal,
  planSpaceDeletionPlaceholderCleanup,
  planSpaceDeletionWindowKeepalives,
  projectSpaceDeletionPlaceholderMetadata,
  projectSpaceDeletionRollbackState,
  spaceDeletionCloseCandidateMismatch,
  spaceDeletionIntentFingerprint,
} from './src/shared/space-deletion.js';
import { mergeLiveAndDormantGroups } from './src/shared/space-view-merge.js';
import {
  adoptUnassignedEntities,
  captureLiveSpaceOwnership,
  cleanupMissingEntities,
  fallbackSpaceAfterDelete,
  markDormantTabsOpenInOtherWindows,
  planLifecycleCleanupDeferral,
  planSpaceTabDeletion,
  reassignPinnedTabsAfterSpaceDelete,
  reassignTabsFromRemovedSpaces,
  removeSpaceReferences,
  restoreSnapshotOwnership,
  restoreLiveSpaceOwnership,
  setLiveTabPanelTitle,
  spaceTabDeletionFingerprint,
  syncCollapsedGroupsFromChrome,
  tabBelongsToSpace as entityBelongsToSpace,
} from './src/shared/space-membership.js';
import {
  assertWorkspaceStorageBudget,
  captureSnapshotIdentityOverlay,
  createSpaceBackup,
  fingerprintPortableSpacesContent,
  fingerprintPortableWorkspaceContent,
  parseSpaceBackup,
  remapSnapshotGroupOrderKeys,
  restoreSnapshotIdentityOverlay,
  restoreSpaceBackup,
  transferSnapshotGroupsBetweenSpaces,
} from './src/shared/space-transfer.js';
import {
  assertCompleteAutoGroupPlan,
  buildGroupPreviewItems,
  buildSpaceView,
  compactTabForAI,
  decorateTabs,
  domainFromUrl,
  isChromeNewTabUrl,
  isForeignWindowTab,
  isPageShortcutCapableUrl,
  planGroupPreviewPlacement,
  planTidyTabNames,
  preferredFocusableTab,
  sanitizeTidyGroups,
  tabRowPresentation,
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
// Model ids returned by the provider's /models endpoint during this session.
let detectedModelIds = [];
const GROUP_PREVIEW_OPEN_DELAY_MS = 2000;
const GROUP_PREVIEW_CLOSE_DELAY_MS = 140;
const OPERATION_UNDO_VISIBLE_MS = 10_000;
const LIFECYCLE_CLEANUP_GRACE_MS = 500;
const TIDY_NAMES_ICON = `
  <span class="tidy-icon" aria-hidden="true">🧹</span>
`;

let state = createDefaultState(localConfig);
let settingsBaseline = null;
let tabs = [];
let groups = [];
let foreignLiveTabs = [];
let spaceView = [];
let dormantSpaceView = [];
let dormantSpaceViewSpaceId = '';
let snapshotLifecycleIdSequence = 0;
let lifecycleCleanupObservations = {};
// Space ids with an Auto Group plan currently applying. Their snapshots keep
// preserveGroups until the plan settles; see sanitizeStoredSpaceSnapshot.
const inFlightOrganizationPlanSpaceIds = new Set();
const syntheticPlaceholderTabIds = new Set();
let activeView = workbenchMode && pageParams.get('view') === 'settings'
  ? 'settings'
  : 'space';
let dragState = null;
let activeAIRequestId = '';
let activePanelAction = '';
let panelWindowId = null;
let panelWindowBindingController = null;
let panelWindowEventsBound = false;
let panelWindowRebindTask = Promise.resolve();
let fileSchemeAccessAllowed = false;
let windowSpaceState = { activeSpaceIds: {} };
let durableActiveSpaceId = '';
let selectedTabIds = new Set();
let selectionAnchorTabId = null;
let contextMenuReturnFocus = null;
let pendingArcImportText = '';
let pendingArcImportPlan = null;
let arcImportSelectionGeneration = 0;
let pendingSpaceBackup = null;
// Counts restore-review lifecycles (one increment at entry and one at exit of
// each restoreSpaceData run). Queued restore gestures compare this counter to
// detect that another review already started or finished since their enqueue,
// so a queued duplicate never re-opens a fresh confirmation after the first
// review resolves (including a stale rejection).
let restoreSpaceDataReviewTransitions = 0;
let renderedGroupContexts = new Map();
let renderedGroupDragContexts = new Map();
let lastGroupDragEndedAt = 0;
let lastRenderedGroupsSignature = '';
let lastRenderedSpacesSignature = '';
let recentlyOpenedDormantTabs = [];
const logicalChromeGroupTitles = new Map();
let groupPreviewPopover = null;
let groupPreviewAnchor = null;
let groupPreviewGroup = null;
let groupPreviewQuery = '';
let groupPreviewOpenTimer = 0;
let groupPreviewCloseTimer = 0;
let restoringGroupPreviewFocus = false;
let workbenchToastTimer = 0;
let workbenchToastHideTimer = 0;
let operationRecordHideTimer = 0;
let activeTaskCount = 0;
let taskQueue = Promise.resolve();
let tabReplacementQueue = Promise.resolve();
let sharedRefreshRunning = false;

const els = {
  activeSpaceName: document.querySelector('#activeSpaceName'),
  syncStatus: document.querySelector('#syncStatus'),
  settingsButton: document.querySelector('#settingsButton'),
  commandPaletteButton: document.querySelector('#commandPaletteButton'),
  openWorkbenchButton: document.querySelector('#openWorkbenchButton'),
  collapseGroupsButton: document.querySelector('#collapseGroupsButton'),
  tidyNamesButton: document.querySelector('#tidyNamesButton'),
  groupsList: document.querySelector('#groupsList'),
  testAIButton: document.querySelector('#testAIButton'),
  detectModelsButton: document.querySelector('#detectModelsButton'),
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
  settingsView: document.querySelector('#settingsView'),
  settingsNav: document.querySelector('#settingsNav'),
  settingsCloseButton: document.querySelector('#settingsCloseButton'),
  tidyRulesList: document.querySelector('#tidyRulesList'),
  tidyGroupPromptInput: document.querySelector('#tidyGroupPromptInput'),
  tidyRenamePromptInput: document.querySelector('#tidyRenamePromptInput'),
  resetTidyRulesButton: document.querySelector('#resetTidyRulesButton'),
  providerInput: document.querySelector('#providerInput'),
  baseUrlInput: document.querySelector('#baseUrlInput'),
  modelInput: document.querySelector('#modelInput'),
  modelOptions: document.querySelector('#modelOptions'),
  languageInput: document.querySelector('#languageInput'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  apiKeyStatus: document.querySelector('#apiKeyStatus'),
  clearApiKeyButton: document.querySelector('#clearApiKeyButton'),
  thinkingLabel: document.querySelector('#thinkingLabel'),
  thinkingInput: document.querySelector('#thinkingInput'),
  thinkingHint: document.querySelector('#thinkingHint'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  shortcutsList: document.querySelector('#shortcutsList'),
  themeOptions: document.querySelector('.theme-options'),
  commandPaletteDialog: document.querySelector('#commandPaletteDialog'),
  commandPaletteInput: document.querySelector('#commandPaletteInput'),
  commandPaletteResults: document.querySelector('#commandPaletteResults'),
};

const panelPortController = createPanelPortController({
  runtime: extensionRuntime ? chrome.runtime : null,
  documentTarget: document,
  windowTarget: window,
  enabled: extensionRuntime && !workbenchMode,
  getWindowId: () => panelWindowId,
  onClose: () => window.close(),
  onShortcut: (action) => void runTask((windowBinding) => (
    runShortcutAction(action, null, { windowBinding })
  )),
});

const panelFocusController = createPanelFocusController({
  windowTarget: window,
  documentTarget: document,
  getTarget: () => activeView === 'space'
    ? els.groupsList
    : null,
  requestBackgroundFocus: () => extensionRuntime && Number.isSafeInteger(panelWindowId)
    ? chrome.runtime.sendMessage({ type: 'panel:focus', windowId: panelWindowId })
    : null,
});
const disclosureFocusGuard = createDisclosureFocusGuard();

const commandPaletteController = createCommandPaletteController({
  dialog: els.commandPaletteDialog,
  input: els.commandPaletteInput,
  results: els.commandPaletteResults,
  document,
  getData: () => ({ spaces: state.spaces, spaceView: commandPaletteSpaceView() }),
  canOpen: () => !els.actionDialog.open,
  beforeOpen: () => {
    if (activeView === 'settings') {
      activeView = 'space';
      render();
    }
  },
  prepareSelection: prepareCommandPaletteSelectionFromUserGesture,
  onSelect: (prepared) => void runTask((windowBinding) => runSelectedCommandPaletteItem({
    ...prepared,
    windowBinding: prepared?.windowBinding || windowBinding,
  })),
  scheduleFocus: (callback) => requestAnimationFrame(callback),
});

const panelKeyboardController = createPanelKeyboardController({
  getShortcuts: () => mergeShortcuts(state.shortcuts),
  hasBlockingDialogOpen,
  isContextMenuOpen: () => !els.contextMenu.hidden,
  hideContextMenu,
  hideGroupPreview: hideGroupPreviewFromGlobalKeyboard,
  getActiveAIRequestId: () => activeAIRequestId,
  getActiveView: () => activeView,
  getSelection: () => window.getSelection?.(),
  openCommandPalette: commandPaletteController.open,
  abortActiveAIRequest: () => void abortActiveAIRequest(),
  dispatchShortcutAction: (action) => {
    const organizationRequest = prepareOrganizationRequestForAction(action);
    void runTask((windowBinding) => runShortcutAction(action, organizationRequest, {
      windowBinding,
    }));
  },
});


init();

async function init() {
  try {
    clearLegacyArcFileHandleStorage();
    const panelHostBinding = await currentPanelHostBinding();
    panelWindowId = panelHostBinding.windowId;
    panelWindowBindingController = createPanelWindowBindingController({
      ...panelHostBinding,
      onRebind: handlePanelWindowRebound,
    });
    bindPanelWindowEvents();
    if (extensionRuntime && !Number.isSafeInteger(panelWindowId)) {
      throw new Error('Space Tabs could not identify this Chrome window. Reopen the panel and try again.');
    }
    fileSchemeAccessAllowed = await currentFileSchemeAccess();
    panelPortController.connect();
    const initialWindowBinding = panelWindowBindingController.current();
    await withSharedStateLock(async () => {
      await runPanelWindowRefreshTransaction(
        panelWindowBindingController,
        initialWindowBinding,
        (binding) => loadState({ stateLocked: true, windowBinding: binding }),
        (binding) => refreshTabs({
          adopt: true,
          renderAfterSave: true,
          windowBinding: binding,
        }),
      );
    });
    // A host can cross windows before Chrome delivers our listeners, or while
    // the initial tabs/storage reads are pending. Re-read the authoritative tab
    // after initialization; the captured epoch prevents a late read from
    // reverting a newer attach event.
    await confirmPanelHostBindingAfterInit();
    bindEvents();
    document.documentElement.dataset.initialized = 'true';
    renderSettings();
    if (extensionRuntime) setInterval(() => void refreshSharedState(), 2500);
  } catch (error) {
    document.documentElement.dataset.initialized = 'failed';
    els.syncStatus.textContent = 'Failed to initialize';
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

async function currentPanelHostBinding() {
  // The standalone preview models one Chrome window whose tabs all use id 1.
  // Give the panel the same identity so transactional Space-switch guards are
  // exercised instead of rejecting the preview as a cross-window mismatch.
  if (!extensionRuntime) return resolvePanelHostBinding(null, { id: 1 });
  const [hostTab, currentWindow] = await Promise.all([
    chrome.tabs?.getCurrent
      ? chrome.tabs.getCurrent().catch(() => null)
      : Promise.resolve(null),
    chrome.windows?.getCurrent
      ? chrome.windows.getCurrent().catch(() => null)
      : Promise.resolve(null),
  ]);
  return resolvePanelHostBinding(hostTab, currentWindow);
}

async function confirmPanelHostBindingAfterInit() {
  if (!extensionRuntime || !panelWindowBindingController) return;
  await confirmPanelWindowBindingAfterInitialization(
    panelWindowBindingController,
    currentPanelHostBinding,
    () => panelWindowRebindTask,
  );
}

function capturePanelWindowBinding() {
  return Object.freeze(panelWindowBindingController?.current() || {
    hostTabId: null,
    windowId: panelWindowId,
    epoch: 0,
  });
}

function isCurrentPanelWindowBinding(binding) {
  if (!binding) return true;
  return panelWindowBindingController?.isCurrent(binding) === true;
}

function canUsePanelWindowBinding(binding, options = {}) {
  return options.allowStaleWindowBinding === true || isCurrentPanelWindowBinding(binding);
}

async function currentFileSchemeAccess() {
  if (!extensionRuntime || !chrome.extension?.isAllowedFileSchemeAccess) return false;
  try {
    return await chrome.extension.isAllowedFileSchemeAccess();
  } catch {
    return false;
  }
}

async function loadState(options = {}) {
  const load = async () => {
    const synchronized = await syncStateFromStorage({ windowBinding: options.windowBinding });
    if (synchronized === false) return false;
    return saveState({ windowBinding: options.windowBinding });
  };
  if (options.stateLocked) return load();
  return withSharedStateLock(load);
}

async function syncStateFromStorage(options = {}) {
  const tempTheme = state?.tempTheme;
  const cachedDormantSpaceId = dormantSpaceViewSpaceId;
  const cachedDormantSnapshot = cachedDormantSpaceId
    ? state.spaceSnapshots?.[cachedDormantSpaceId]
    : null;
  const defaults = createDefaultState(localConfig);
  const [stored, secrets, storedWindowState, browserSessionId] = await Promise.all([
    storageGet(),
    secretGet(),
    windowStateGet(),
    currentBrowserSessionId(),
  ]);
  if (!canUsePanelWindowBinding(options.windowBinding, options)) return false;
  const mergedState = mergeStoredState(stored[STORAGE_KEY], defaults);
  const nextState = resetChromeSessionBindings(mergedState, browserSessionId);
  if (nextState !== mergedState) {
    logicalChromeGroupTitles.clear();
    recentlyOpenedDormantTabs = [];
  }
  durableActiveSpaceId = activeSpaceForStorage(nextState.spaces, nextState.activeSpaceId);
  windowSpaceState = normalizeWindowSpaceState(storedWindowState[WINDOW_STATE_KEY], nextState.spaces);
  nextState.activeSpaceId = activeSpaceForWindow(
    windowSpaceState,
    options.windowBinding ? options.windowBinding.windowId : panelWindowId,
    nextState.spaces,
    nextState.activeSpaceId,
  );

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
    nextState.ai.apiKey = scopedAIKey(createScopedAIAuth(localConfig.ai), nextState.ai);
  } else {
    const reconciled = reconcileScopedAIKey(secrets[SECRET_STORAGE_KEY]?.ai, nextState.ai);
    nextState.ai.apiKey = reconciled?.apiKey || '';
    if (reconciled?.drifted) {
      // Endpoint migrations can rename a base URL while the stored key stays
      // valid for the same provider. Rewrite the stored scope so the key is
      // never stranded behind a scope mismatch (and later destroyed by a save).
      void secretSet({
        [SECRET_STORAGE_KEY]: {
          ai: { apiKey: reconciled.apiKey, ...aiAuthScope(nextState.ai) },
        },
      }).catch(() => undefined);
    }
  }

  if (tempTheme) nextState.tempTheme = tempTheme;
  state = nextState;
  applyTheme(state.tempTheme || state.theme);
  sanitizeStoredSpaceSnapshots();
  if (
    cachedDormantSpaceId &&
    !sameSnapshotGroups(cachedDormantSnapshot, state.spaceSnapshots?.[cachedDormantSpaceId])
  ) {
    // Background lifecycle events can update a snapshot while this page is
    // alive. Invalidate the derived dormant rows so the next refresh cannot
    // keep rendering a closed tab from the previous storage revision.
    dormantSpaceView = [];
    dormantSpaceViewSpaceId = '';
  }
  return state;
}

async function saveState({ persistWindowState = true, windowBinding = null } = {}) {
  // The panel writes the whole workspace key, so every save must be serialized
  // against background journal drains. Taking the lock here (re-entrantly)
  // protects all call sites instead of relying on each caller to remember it.
  return withSharedStateLock(async () => {
    if (!persistWindowState) {
      return commitWindowBoundWrite({
        isCurrent: () => isCurrentPanelWindowBinding(windowBinding),
        write: () => persistStorageStep({
          key: STORAGE_KEY,
          value: stateForStorage(),
          get: storageGet,
          set: storageSet,
          remove: storageRemove,
        }),
      });
    }
    if (!isCurrentPanelWindowBinding(windowBinding)) return false;
    const workspaceState = stateForStorage();
    const nextWindowSpaceState = rememberActiveSpaceForWindow(
      windowSpaceState,
      windowBinding ? windowBinding.windowId : panelWindowId,
      state.activeSpaceId,
      state.spaces,
    );
    await persistStoragePair({
      key: WINDOW_STATE_KEY,
      value: nextWindowSpaceState,
      get: windowStateGet,
      set: windowStateSet,
      remove: windowStateRemove,
    }, {
      key: STORAGE_KEY,
      value: workspaceState,
      get: storageGet,
      set: storageSet,
      remove: storageRemove,
    });
    // A resolved pair write is durable even if the Workbench moved while the
    // browser was replying. Only the pre-write guard above may report `false`;
    // callers can therefore distinguish a no-op from a committed stale view.
    if (isCurrentPanelWindowBinding(windowBinding)) {
      windowSpaceState = nextWindowSpaceState;
    }
    return true;
  });
}

function bindEvents() {
  bindPanelWindowEvents();
  if (extensionRuntime && chrome.tabs?.onUpdated) {
    chrome.tabs.onUpdated.addListener(handleChromeTabUpdated);
    chrome.tabs.onRemoved.addListener(handleChromeTabRemoved);
    chrome.tabs.onDetached?.addListener(handleChromeTabDetached);
    chrome.tabs.onReplaced?.addListener(handleChromeTabReplaced);
  }
  document.addEventListener('focusin', panelFocusController.handleFocusIn, { capture: true });
  document.addEventListener('pointerdown', panelFocusController.handleUserIntent, { capture: true });
  document.addEventListener('keydown', panelFocusController.handleUserIntent, { capture: true });
  document.addEventListener('focusin', disclosureFocusGuard.invalidate, { capture: true });
  document.addEventListener('pointerdown', disclosureFocusGuard.invalidate, { capture: true });
  document.addEventListener('keydown', disclosureFocusGuard.invalidate, { capture: true });
  document.addEventListener('visibilitychange', panelFocusController.handleVisibilityChange);
  window.addEventListener('blur', panelFocusController.handleWindowBlur);
  window.addEventListener('pagehide', panelFocusController.handleWindowBlur);
  els.settingsButton.addEventListener('click', () => runTask(async () => {
    if (activeView === 'settings') {
      exitSettingsView();
      return;
    }
    state.tempTheme = state.theme || 'purple';
    renderSettings();
    activeView = 'settings';
    render();
  }));
  els.openWorkbenchButton.addEventListener('click', () => runTask((windowBinding) => (
    openWorkbench({ windowBinding })
  )));
  els.commandPaletteButton.addEventListener('click', commandPaletteController.open);
  els.undoOrganizationButton.addEventListener('click', () => {
    const operationId = els.undoOrganizationButton.dataset.operationId || '';
    runTask((windowBinding) => undoLastOperation(operationId, { windowBinding }));
  });
  els.tidyNamesButton.addEventListener('click', startTidyNamesFromUserGesture);
  els.collapseGroupsButton.addEventListener('click', () => runTask((windowBinding) => (
    toggleSpaceGroups({ windowBinding })
  )));
  els.testAIButton.addEventListener('click', () => startTestAIFromUserGesture(settingsAIControls()));
  els.detectModelsButton.addEventListener('click', () => runTask((windowBinding) => detectProviderModels(settingsAIControls(), { windowBinding })));
  els.clearApiKeyButton.addEventListener('click', () => {
    const authTarget = structuredClone(settingsBaseline?.auth || null);
    runTask((windowBinding) => clearApiKey(authTarget, { windowBinding }));
  });
  els.providerInput.addEventListener('change', () => handleAIProviderChange(settingsAIControls()));
  els.baseUrlInput.addEventListener('input', () => clearAIKeyAfterEndpointEdit(settingsAIControls()));
  els.modelInput.addEventListener('change', () => {
    const controls = settingsAIControls();
    updateAIThinkingControl(controls);
  });
  els.arcImportInput.addEventListener('change', () => runTask((windowBinding) => (
    previewArcImportFile(null, { windowBinding })
  )));
  els.arcImportInput.addEventListener('cancel', (event) => event.stopPropagation());
  els.arcImportChooseButton.addEventListener('click', () => startArcFileSelectionFromUserGesture('settings'));
  els.importArcButton.addEventListener('click', () => runTask(async (windowBinding) => {
    if (!pendingArcImportText) {
      els.arcImportChooseButton.click();
      return;
    }
    await importArcFile({ windowBinding });
  }));
  els.undoArcImportButton.addEventListener('click', () => runTask((windowBinding) => (
    undoLastArcImport({ windowBinding })
  )));
  els.exportSpaceDataButton.addEventListener('click', () => runTask((windowBinding) => (
    exportSpaceData({ windowBinding })
  )));
  // Selecting a backup automatically opens its restore confirmation, so a
  // Restore Backup click can race that review through the serialized task
  // queue. Each enqueue records the review transition counter and a queued
  // call is dropped when another review started or finished since; otherwise
  // the queued duplicate would re-open a fresh confirmation dialog after the
  // first review resolved (including a stale rejection).
  const enqueueRestoreSpaceDataReview = () => {
    const seenTransitions = restoreSpaceDataReviewTransitions;
    return runTask(async (windowBinding) => {
      if (restoreSpaceDataReviewTransitions !== seenTransitions) return;
      await restoreSpaceData({ windowBinding });
    });
  };
  els.spaceBackupInput.addEventListener('change', () => runTask(async (windowBinding) => {
    await previewSpaceBackupFile({ windowBinding });
    if (pendingSpaceBackup) await restoreSpaceData({ windowBinding });
  }));
  els.restoreSpaceDataButton.addEventListener('click', () => {
    if (!pendingSpaceBackup) {
      runTask(async () => {
        els.spaceBackupInput.click();
      });
      return;
    }
    enqueueRestoreSpaceDataReview();
  });
  els.saveSettingsButton.addEventListener('click', (event) => {
    event.preventDefault();
    runTask((windowBinding) => saveSettings({ windowBinding }));
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

  els.settingsCloseButton.addEventListener('click', () => runTask(() => exitSettingsView()));

  els.settingsNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-panel]');
    if (!button) return;
    showSettingsPanel(button.dataset.settingsPanel);
  });

  els.commandPaletteInput.addEventListener('input', commandPaletteController.handleInput);
  els.commandPaletteResults.addEventListener('click', commandPaletteController.handleClick);
  els.commandPaletteDialog.addEventListener('keydown', commandPaletteController.handleKeydown);
  els.commandPaletteDialog.addEventListener('close', commandPaletteController.handleClose);

  window.addEventListener('contextmenu', handleGroupHeaderContextMenu, { capture: true });
  window.addEventListener('mousedown', handleGroupHeaderMouseDown, { capture: true });
  els.groupsList.addEventListener('scroll', () => positionGroupPreview(), { passive: true });
  window.addEventListener('resize', hideGroupPreview);
  document.addEventListener('click', () => {
    hideContextMenu();
    hideGroupPreview();
  });
  els.contextMenu.addEventListener('keydown', handleContextMenuKeydown);
  document.addEventListener('keydown', panelKeyboardController.handleKeydown, { capture: true });
}

function bindPanelWindowEvents() {
  if (panelWindowEventsBound || !extensionRuntime || !chrome.tabs) return;
  panelWindowEventsBound = true;
  chrome.tabs.onAttached?.addListener(handleChromeTabAttached);
  chrome.tabs.onMoved?.addListener(handleChromeHostTabMoved);
}

function exitSettingsView({ restoreTheme = true } = {}) {
  clearSettingsArcSelection();
  if (restoreTheme && state.tempTheme) {
    applyTheme(state.theme);
    delete state.tempTheme;
  }
  if (activeView === 'settings') {
    activeView = 'space';
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
    render();
  }
}

function hasBlockingDialogOpen() {
  return [...document.querySelectorAll('dialog[open]')]
    .some(Boolean);
}

function prepareOrganizationRequestForAction(action) {
  if (action === 'tidy' || action === 'tidyNames') return prepareTidyRequestFromUserGesture();
  return null;
}

function prepareCommandPaletteSelectionFromUserGesture(item) {
  return {
    item,
    windowBinding: capturePanelWindowBinding(),
    tabSelection: item?.kind === 'tab'
      ? captureCommandPaletteTabSelection(item, [...tabs, ...foreignLiveTabs])
      : null,
    organizationRequest: prepareOrganizationRequestForAction(item?.action),
  };
}

async function runSelectedCommandPaletteItem(prepared = {}) {
  const item = prepared.item;
  if (!item) return;
  const windowBinding = prepared.windowBinding;
  if (item.kind === 'space') {
    await activateSpace(item.spaceId, { windowBinding });
    return;
  }
  if (item.kind === 'tab') {
    await runSelectedCommandPaletteTab(
      prepared.tabSelection || captureCommandPaletteTabSelection(item, [...tabs, ...foreignLiveTabs]),
      windowBinding,
    );
    return;
  }
  if (item.action === 'tidy') {
    await runTidy({ ...(prepared.organizationRequest || {}), windowBinding });
  }
  else if (item.action === 'settings') {
    if (!isCurrentPanelWindowBinding(windowBinding)) {
      throw new Error('This panel moved to another Chrome window before Settings could open.');
    }
    state.tempTheme = state.theme || 'purple';
    renderSettings();
    activeView = 'settings';
    render();
  }
}

async function runSelectedCommandPaletteTab(reference, preparedWindowBinding = null) {
  const staleMessage = 'That Command Palette tab changed, closed, or moved to another Space. Open the palette and choose it again.';
  const windowBinding = preparedWindowBinding || capturePanelWindowBinding();
  await withSharedStateLock(async () => {
    if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) throw new Error(staleMessage);
    const loaded = await loadTabs({ adopt: false, windowBinding });
    if (loaded === false || !isCurrentPanelWindowBinding(windowBinding)) {
      throw new Error(staleMessage);
    }
    let resolved = resolveCommandPaletteTabSelection(reference, {
      spaces: state.spaces,
      spaceView: commandPaletteSpaceView(),
      liveTabs: [...tabs, ...foreignLiveTabs],
    });
    if (!resolved) {
      await loadDormantSpaceView(state.activeSpaceId, { force: true });
      render();
      throw new Error(staleMessage);
    }

    const previousSpaceId = state.activeSpaceId;
    const switched = resolved.spaceId !== previousSpaceId;
    if (switched) {
      const activated = await activateSpace(resolved.spaceId, {
        stateLocked: true,
        preferredTabId: resolved.mode === 'live' ? resolved.tab.id : null,
        preferredSnapshotTabId: reference.snapshotTabId,
        windowBinding,
      });
      if (activated === false || !isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error(staleMessage);
      }
      // switchSpace can be durably committed even when its final best-effort
      // refresh fails. Never resolve a saved row from the pre-switch cache:
      // that could classify an already materialized tab as dormant and open a
      // duplicate. A fresh authoritative read is required before any open.
      const reloaded = await loadTabs({ adopt: false, windowBinding });
      if (reloaded === false || !isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error(staleMessage);
      }
      await loadDormantSpaceView(resolved.spaceId, { force: true });
      // A dormant selection may have been materialized by the Space switch.
      // Resolve it again so the palette never opens a duplicate saved row.
      resolved = resolveCommandPaletteTabSelection(reference, {
        spaces: state.spaces,
        spaceView: commandPaletteSpaceView(),
        liveTabs: [...tabs, ...foreignLiveTabs],
      });
      if (!resolved) {
        await loadDormantSpaceView(state.activeSpaceId, { force: true });
        render();
        throw new Error(staleMessage);
      }
    } else if (resolved.mode === 'dormant') {
      await loadDormantSpaceView(resolved.spaceId, { force: true });
    }

    if (resolved.mode === 'dormant') {
      if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
      await openDormantTab(resolved.tab, resolved.groupKey, {
        stateLocked: true,
        windowBinding,
      });
      return;
    }

    if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
    const response = await send('tabs:focus', {
      tabId: resolved.tab.id,
      focusGuard: commandPaletteFocusGuard(resolved.tab),
      skipChanged: true,
    }, { windowBinding });
    if (!response.tab || response.skipped) {
      // The Space switch is already durable and its previous live tabs may
      // have closed. Never churn both Spaces by switching back after a later
      // palette-focus race; keep the committed target and show its fresh view.
      await loadDormantSpaceView(state.activeSpaceId, { force: true });
      render();
      throw new Error(staleMessage);
    }
    const refreshed = await refreshTabs({
      adopt: false,
      reloadDormant: true,
      windowBinding,
    });
    if (refreshed === false || !isCurrentPanelWindowBinding(windowBinding)) {
      throw new Error(staleMessage);
    }
    if (response.focusConfirmed === false) {
      const message = 'Selected the tab, but Chrome could not confirm that its window came to the front.';
      setStatus(message);
      if (workbenchMode) showStatusToast(message, 'info');
    }
  });
}

async function runShortcutAction(action, organizationRequest = null, options = {}) {
  const windowBinding = options.windowBinding;
  if (action === 'tidyNames') {
    await runTidy({ ...(organizationRequest || {}), windowBinding });
    return;
  }
  if (action === 'addSpace') {
    await addSpace({ windowBinding });
    return;
  }
  if (action === 'previousSpace') {
    await activateAdjacentSpace(-1, { windowBinding });
    return;
  }
  if (action === 'nextSpace') {
    await activateAdjacentSpace(1, { windowBinding });
  }
}

async function activateAdjacentSpace(direction, options = {}) {
  const index = state.spaces.findIndex((space) => space.id === state.activeSpaceId);
  if (index < 0 || state.spaces.length < 2) return;
  const nextIndex = (index + direction + state.spaces.length) % state.spaces.length;
  await activateSpace(state.spaces[nextIndex].id, options);
  focusPanelForShortcuts();
}

async function refreshTabs(options = {}) {
  const windowBinding = options.windowBinding || capturePanelWindowBinding();
  if (!isCurrentPanelWindowBinding(windowBinding)) return false;
  const renderAfterSave = options.renderAfterSave === true;
  const refreshed = await refreshTabsView({
    ...options,
    render: !renderAfterSave,
    windowBinding,
  });
  if (refreshed === false || !isCurrentPanelWindowBinding(windowBinding)) return false;
  const saved = await saveState({ windowBinding });
  if (saved === false || !isCurrentPanelWindowBinding(windowBinding)) return false;
  if (renderAfterSave) render();
  return true;
}

async function refreshTabsView(options = {}) {
  const windowBinding = options.windowBinding || capturePanelWindowBinding();
  if (!isCurrentPanelWindowBinding(windowBinding)) return false;
  const loaded = await loadTabs({
    adopt: Boolean(options.adopt),
    adoptGroups: Boolean(options.adoptGroups ?? options.adopt),
    skipSnapshotCleanupForTabIds: options.skipSnapshotCleanupForTabIds,
    windowBinding,
  });
  if (loaded === false || !isCurrentPanelWindowBinding(windowBinding)) return false;
  const materializedLegacyGroups = await materializeLegacyVirtualGroups(state.activeSpaceId, {
    windowBinding,
  });
  if (!isCurrentPanelWindowBinding(windowBinding)) return false;
  if (materializedLegacyGroups) {
    const reloaded = await loadTabs({ adopt: false, windowBinding });
    if (reloaded === false || !isCurrentPanelWindowBinding(windowBinding)) return false;
  }
  snapshotOpenSpace(state.activeSpaceId);
  refreshTabLifecycleIdentityDecorations();
  await loadDormantSpaceView(state.activeSpaceId, { force: Boolean(options.reloadDormant) });
  if (!isCurrentPanelWindowBinding(windowBinding)) return false;
  if (options.render !== false) render();
  return true;
}

async function refreshSharedState() {
  if (sharedRefreshRunning || activeTaskCount > 0) return;
  sharedRefreshRunning = true;
  try {
    const windowBinding = capturePanelWindowBinding();
    fileSchemeAccessAllowed = await currentFileSchemeAccess();
    await withSharedStateLock(async () => {
      await runPanelWindowRefreshTransaction(
        panelWindowBindingController,
        windowBinding,
        (binding) => syncStateFromStorage({ windowBinding: binding }),
        (binding) => refreshTabs({ adopt: true, windowBinding: binding }),
      );
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
  skipOwnershipRestoreGroupIds = [],
  windowBinding = null,
  allowStaleWindowBinding = false,
} = {}) {
  const previousTabs = tabs;
  const response = await send('tabs:list', {}, {
    windowBinding,
    allowStaleWindowBinding,
  });
  if (!canUsePanelWindowBinding(windowBinding, { allowStaleWindowBinding })) return false;
  const rawPanelTabs = response.tabs || [];
  const rawAllBrowserTabs = response.allTabs || rawPanelTabs;
  const panelTabIds = new Set(rawPanelTabs.map((tab) => Number(tab.id)));
  const identifiedPanelTabs = tabsWithLifecycleIdentity(rawPanelTabs);
  const identifiedAllBrowserTabs = tabsWithLifecycleIdentity(rawAllBrowserTabs);
  const allBrowserTabs = decorateTabs(identifiedAllBrowserTabs, state);
  tabs = decorateTabs(identifiedPanelTabs, state);
  groups = response.groups || [];
  const contentTabs = tabs.filter((tab) => !isEphemeralTab(tab));
  const allContentTabs = allBrowserTabs.filter((tab) => !isEphemeralTab(tab));
  const authoritativeCleanupOptions = {
    existingTabIds: response.existingTabIds,
    existingWindowIds: response.existingWindowIds,
    pendingLifecycleTabIds: response.pendingLifecycleTabIds,
    suppressedLifecycleTabIds: response.suppressedLifecycleTabIds,
    existingGroupIds: response.existingGroupIds,
  };
  const cleanupDeferral = planLifecycleCleanupDeferral(
    state,
    authoritativeCleanupOptions,
    lifecycleCleanupObservations,
    Date.now(),
    LIFECYCLE_CLEANUP_GRACE_MS,
  );
  lifecycleCleanupObservations = cleanupDeferral.observations;
  const effectivePendingLifecycleTabIds = [
    ...(Array.isArray(response.pendingLifecycleTabIds) ? response.pendingLifecycleTabIds : []),
    ...cleanupDeferral.deferredTabIds,
  ];
  const cleanupOptions = {
    ...authoritativeCleanupOptions,
    pendingLifecycleTabIds: effectivePendingLifecycleTabIds,
  };
  const snapshotCleanupSkipTabIds = [
    ...skipSnapshotCleanupForTabIds,
    ...effectivePendingLifecycleTabIds,
  ];
  removeStaleActiveSpaceTabsFromSnapshot(previousTabs, allContentTabs, {
    skipTabIds: snapshotCleanupSkipTabIds,
  });
  cleanupEphemeralTabIds(response.existingTabIds, effectivePendingLifecycleTabIds);
  const ownershipMetadata = restoreSnapshotOwnership(
    state,
    allContentTabs,
    response.allGroups || groups,
    { skipGroupIds: skipOwnershipRestoreGroupIds },
  );
  for (const [groupId, logicalTitle] of Object.entries(ownershipMetadata.groupTitles || {})) {
    logicalChromeGroupTitles.set(Number(groupId), logicalTitle);
  }
  tabs = decorateTabs(identifiedPanelTabs, state);
  foreignLiveTabs = decorateTabs(identifiedAllBrowserTabs, state)
    .filter((tab) => !isEphemeralTab(tab) && !panelTabIds.has(Number(tab.id)));
  if (adopt) {
    adoptUnassignedEntities(state, contentTabs, groups, state.activeSpaceId, {
      adoptGroups,
      ...cleanupOptions,
    });
  } else {
    cleanupMissingEntities(state, contentTabs, groups, cleanupOptions);
  }
  syncCollapsedGroupsFromChrome(state, groups);
  return true;
}

function tabsWithLifecycleIdentity(rawTabs = []) {
  return rawTabs.map((tab) => {
    const undecorated = { ...tab };
    delete undecorated.snapshotTabId;
    delete undecorated.snapshotGroupId;
    delete undecorated.spaceId;
    delete undecorated.trackingMode;
    delete undecorated.sessionId;
    const binding = currentLifecycleBinding(tab?.id);
    if (!binding) return undecorated;
    return {
      ...undecorated,
      snapshotTabId: binding.snapshotTabId,
      ...(lifecycleBindingMatchesPhysicalGroup(tab, binding)
        ? { snapshotGroupId: binding.snapshotGroupId }
        : {}),
      spaceId: binding.spaceId,
      trackingMode: binding.trackingMode,
      sessionId: binding.sessionId,
    };
  });
}

function refreshTabLifecycleIdentityDecorations() {
  tabs = tabsWithLifecycleIdentity(tabs);
  foreignLiveTabs = tabsWithLifecycleIdentity(foreignLiveTabs);
}

function currentLifecycleBinding(tabId) {
  const binding = state.tabLifecycle?.[tabId];
  if (!binding || (
    binding.sessionId &&
    state.browserSessionId &&
    binding.sessionId !== state.browserSessionId
  )) return null;
  return binding;
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
      if (currentLifecycleBinding(tab.id)) return false;
      if (state.tabLifecycle?.[tab.id]?.trackingMode === 'saved-target') return false;
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
      return snapshotRemovalTargetForLiveTab(entry.tab, previousGroup);
    });
  if (staleTabs.length === 0) return;
  removeTabsFromSpaceSnapshot(state.activeSpaceId, staleTabs);
}

async function materializeLegacyVirtualGroups(spaceId = state.activeSpaceId, options = {}) {
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

    const existing = await chromeGroupForTitle(group.title, spaceId, {
      windowBinding: options.windowBinding,
    });
    const groupId = existing
      ? await addTabsToChromeGroup(existing.id, tabIds, spaceId, {
        windowBinding: options.windowBinding,
      })
      : await createChromeGroup(tabIds, {
        title: group.title,
        color: group.color,
        collapsed: Boolean(group.collapsed ?? state.collapsedGroups[groupKey]),
        spaceId,
        sourceKey: groupKey,
        windowBinding: options.windowBinding,
      });
    if (groupId === null) continue;

    if (existing) bindChromeGroup(groupId, spaceId, { sourceKey: groupKey });
    changed = true;
    // Chrome has already committed this legacy migration. Checkpoint the
    // completed batch immediately and without touching a window mapping, so a
    // Workbench move before the outer refresh cannot leave upgraded users with
    // a physical group that durable metadata still describes as virtual.
    cleanupUnusedVirtualGroups();
    await saveState({ persistWindowState: false });
  }

  cleanupUnusedVirtualGroups();
  return changed;
}

async function loadDormantSpaceView(spaceId, options = {}) {
  if (!options.force && dormantSpaceViewSpaceId === spaceId) return;
  const snapshot = sanitizeStoredSpaceSnapshot(spaceId);
  dormantSpaceView = dormantGroupsFromSnapshot(snapshot, spaceId);
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
  }).map((group) => projectLifecycleAwareLiveGroup(group, state.activeSpaceId));
  const crossWindowAwareDormantView = markDormantTabsOpenInOtherWindows(
    dormantSpaceView,
    foreignLiveTabs,
    state,
    state.activeSpaceId,
  );
  spaceView = mergeDormantSpaceView(liveSpaceView, crossWindowAwareDormantView);
  syncSelectedTabsToVisibleSpace();

  const isSpaceView = activeView === 'space';
  const isSettingsView = activeView === 'settings';
  const showSources = (workbenchMode || isSpaceView) && !isSettingsView;
  const groupsCollapsed = showSources && isSpaceGroupsCollapsed();
  els.activeSpaceName.textContent = activeSpace.name;
  els.syncStatus.textContent = activePanelAction
    ? panelActionStatus(activePanelAction)
    : '';
  els.groupsList.hidden = !showSources;
  if (!showSources) hideGroupPreview();
  els.tidyNamesButton.hidden = !showSources;
  els.collapseGroupsButton.hidden = !showSources;
  els.openWorkbenchButton.hidden = workbenchMode;
  els.settingsButton.classList.toggle('active', isSettingsView);
  els.settingsView.hidden = !isSettingsView;
  els.collapseGroupsButton.innerHTML = groupsCollapsed
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
  els.collapseGroupsButton.title = groupsCollapsed ? 'Expand groups' : 'Collapse groups';
  els.collapseGroupsButton.setAttribute('aria-label', els.collapseGroupsButton.title);
  els.collapseGroupsButton.classList.toggle('active', groupsCollapsed);
  els.groupsList.classList.toggle('groups-collapsed', groupsCollapsed);

  renderGroups();
  renderSpaces();
  renderOperationRecord();
  updateAIRequestUI();
  updateOrganizationActionDisclosures();
  updatePanelActionUI();
}

function updateOrganizationActionDisclosures() {
  const provider = providerById(state.ai.provider);
  const hasAI = hasUsableAISettings(state.ai);
  const disclosure = hasAI
    ? `Tidy with ${provider.label}: merges duplicate Tags, regroups tabs by topic, and renames tabs per your Tidy rules. Sends only the disclosed tab titles, simplified URLs, and domains, then opens one preview before applying. Script rules and local naming still run when AI is unavailable. Undo is available afterward.`
    : 'Tidy merges duplicate Tags locally and renames tabs with local rules without sending tab metadata. Topic grouping needs a configured AI provider. One preview opens before anything applies, and Undo is available afterward.';
  els.tidyNamesButton.title = disclosure;
  els.tidyNamesButton.setAttribute('aria-label', disclosure);
}

function hasUsableAISettings(settings = {}) {
  return Boolean(
    String(settings.baseUrl || '').trim() &&
    String(settings.model || '').trim() &&
    (!providerRequiresApiKey(settings) || String(settings.apiKey || '').trim())
  );
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
  delete els.undoOrganizationButton.dataset.operationId;
  if (!visible) return;
  els.operationRecordText.textContent = operation.summary || 'Workspace change applied';
  els.undoOrganizationButton.dataset.operationId = operation.id;
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

function captureChromeGroupMutationRollback() {
  return {
    ...captureChromeGroupMutationMemory({
      state,
      logicalTitles: logicalChromeGroupTitles,
      selectedTabIds,
      selectionAnchorTabId,
      dormantSpaceView,
      dormantSpaceViewSpaceId,
    }),
    membership: null,
    titles: [],
    recentlyOpenedDormantTabs: structuredClone(recentlyOpenedDormantTabs),
  };
}

function rememberChromeGroupTitleRollback(rollback, group) {
  rollback.titles = captureChromeGroupTitleRollback(rollback.titles, group);
}

function restoreChromeGroupMutationMemory(rollback, groupIdReplacements = new Map()) {
  const restored = projectChromeGroupRollbackMemory(rollback, groupIdReplacements);
  state = restored.state;
  logicalChromeGroupTitles.clear();
  for (const [groupId, title] of restored.logicalTitles) {
    logicalChromeGroupTitles.set(groupId, title);
  }
  selectedTabIds = restored.selectedTabIds;
  selectionAnchorTabId = restored.selectionAnchorTabId;
  dormantSpaceView = restored.dormantSpaceView;
  dormantSpaceViewSpaceId = restored.dormantSpaceViewSpaceId;
  recentlyOpenedDormantTabs = structuredClone(rollback.recentlyOpenedDormantTabs || []);
  lastRenderedGroupsSignature = '';
}

async function restoreChromeGroupMutationAfterFailure(rollback, options = {}) {
  restoreChromeGroupMutationMemory(rollback);
  const failures = [];
  const replacements = new Map();
  const messageOptions = {
    windowBinding: options.windowBinding,
    allowStaleWindowBinding: Boolean(options.windowBinding),
  };

  if (rollback.membership) {
    try {
      await restoreTabGroupMembership(rollback.membership, {
        listTabs: async () => (await send('tabs:listAll', {}, messageOptions)).tabs || [],
        ungroupTabs: (tabIds) => send('tabs:ungroup', { tabIds }, messageOptions),
        moveTab: (tabId, position) => send('tabs:move', { tabId, ...position }, messageOptions),
        addTabsToGroup: (groupId, tabIds) => addTabsToChromeGroup(
          groupId,
          tabIds,
          rollback.state.activeSpaceId,
          messageOptions,
        ),
        createGroup: (tabIds, group) => createChromeGroup(tabIds, {
          ...group,
          spaceId: rollback.state.activeSpaceId,
          ...messageOptions,
        }),
      }, replacements);
    } catch (error) {
      failures.push({ stage: 'restoring tab group membership', error });
    }
  }

  for (const group of rollback.membership?.groups || []) {
    try {
      const restoredGroupId = resolveChromeGroupIdReplacement(group.groupId, replacements);
      if (restoredGroupId === null) throw new Error('The saved Chrome group id is invalid.');
      const logicalTitle = group.title === '' ? '' : normalizeGroupTitle(group.title, 'Group');
      const result = await send('groups:update', {
        groupId: restoredGroupId,
        update: {
          title: logicalTitle === '' ? '' : chromeGroupTitle(logicalTitle, 'Group'),
          color: group.color || 'blue',
          collapsed: Boolean(group.collapsed),
        },
      }, messageOptions);
      if (!result.group) throw new Error(`Chrome group ${restoredGroupId} no longer exists.`);
    } catch (error) {
      failures.push({ stage: `restoring Chrome group ${group.groupId} metadata`, error });
    }
  }

  for (const title of rollback.titles || []) {
    try {
      const restoredGroupId = resolveChromeGroupIdReplacement(title.groupId, replacements);
      if (restoredGroupId === null) throw new Error('The saved Chrome group id is invalid.');
      const result = await send('groups:update', {
        groupId: restoredGroupId,
        update: { title: title.title },
      }, messageOptions);
      if (!result.group) throw new Error(`Chrome group ${restoredGroupId} no longer exists.`);
    } catch (error) {
      failures.push({ stage: `restoring Chrome group ${title.groupId} title`, error });
    }
  }

  try {
    restoreChromeGroupMutationMemory(rollback, replacements);
  } catch (error) {
    failures.push({ stage: 'remapping restored Chrome group state', error });
    restoreChromeGroupMutationMemory(rollback);
  }
  if (replacements.size > 0 || options.persistRestoredState === true) {
    try {
      const saved = await saveState({ persistWindowState: false });
      if (saved !== true) throw new Error('The restored Chrome group state could not be committed.');
    } catch (error) {
      failures.push({ stage: 'saving restored Chrome group bindings', error });
    }
  }

  try {
    await loadTabs({
      adopt: false,
      windowBinding: options.windowBinding,
      allowStaleWindowBinding: Boolean(options.windowBinding),
    });
    if (isCurrentPanelWindowBinding(options.windowBinding)) render();
  } catch (error) {
    failures.push({ stage: 'refreshing the restored group view', error });
  }

  if (failures.length > 0) {
    throw createRollbackAggregateError('Chrome grouping', failures);
  }
}

async function restoreAutoGroupUndoAfterFailure(rollback, options = {}) {
  const rollbackWindowOptions = {
    windowBinding: options.windowBinding,
    // Undo may have already changed real Chrome groups in A before its
    // Workbench host moves to B. Compensation must finish against A; only the
    // later UI refresh is skipped when that binding is no longer current.
    allowStaleWindowBinding: Boolean(options.windowBinding),
  };
  return runAutoGroupUndoRollback(rollback, {
    restoreMemory: restoreChromeGroupMutationMemory,
    restoreLiveOrganization: (layout, spaceId) => restoreLiveOrganization(
      layout,
      spaceId,
      rollbackWindowOptions,
    ),
    saveState: () => saveState({ persistWindowState: false }),
    refreshTabs: (refreshOptions = {}) => (
      isCurrentPanelWindowBinding(options.windowBinding)
        ? refreshTabs({ ...refreshOptions, windowBinding: options.windowBinding })
        : false
    ),
    loadTabs: (loadOptions = {}) => loadTabs({
      ...loadOptions,
      ...rollbackWindowOptions,
    }),
    render: () => {
      if (isCurrentPanelWindowBinding(options.windowBinding)) render();
    },
  });
}

function captureLiveOrganization(spaceId = state.activeSpaceId) {
  const view = buildSpaceViewForSpace(spaceId);
  const tabIds = uniqueNumberIds(view.flatMap((group) => (
    (group.tabs || []).map((tab) => tab.id)
  )));
  return {
    groups: view
      .filter((group) => group.key !== 'ungrouped')
      .map((group) => ({
        title: Object.hasOwn(group, 'title') ? String(group.title ?? '') : 'Tabs',
        color: group.color || 'blue',
        collapsed: Boolean(group.collapsed),
        tabIds: group.tabs.map((tab) => Number(tab.id)).filter(Number.isFinite),
      }))
      .filter((group) => group.tabIds.length > 0),
    ungroupedTabIds: (view.find((group) => group.key === 'ungrouped')?.tabs || [])
      .map((tab) => Number(tab.id))
      .filter(Number.isFinite),
    tabs: captureTabGroupMembership(tabs, groups, tabIds).tabs,
  };
}

async function restoreLiveOrganization(layout = {}, spaceId = state.activeSpaceId, options = {}) {
  const messageOptions = {
    windowBinding: options.windowBinding,
    allowStaleWindowBinding: options.allowStaleWindowBinding === true,
  };
  await loadTabs({ adopt: false, ...messageOptions });
  const existingIds = new Set(tabs.map((tab) => Number(tab.id)));
  const targetIds = uniqueNumberIds([
    ...(layout.ungroupedTabIds || []),
    ...(layout.groups || []).flatMap((group) => group.tabIds || []),
  ]);
  if (targetIds.some((tabId) => !existingIds.has(tabId))) {
    throw new Error('A tab closed or was replaced before its Chrome groups could be restored.');
  }
  const groupedIds = tabs
    .filter((tab) => targetIds.includes(Number(tab.id)) && isGroupedTab(tab))
    .map((tab) => Number(tab.id));
  if (groupedIds.length > 0) {
    const ungrouped = await send('tabs:ungroup', { tabIds: groupedIds }, messageOptions);
    if (ungrouped.missing) {
      throw new Error('A tab closed or was replaced while its Chrome groups were being restored.');
    }
  }
  await loadTabs({ adopt: false, ...messageOptions });
  const refreshedIds = new Set(tabs.map((tab) => Number(tab.id)));
  if (targetIds.some((tabId) => !refreshedIds.has(tabId))) {
    throw new Error('A tab closed or was replaced while its Chrome groups were being restored.');
  }
  clearLocalTabGrouping(targetIds);
  for (const tabId of uniqueNumberIds(layout.ungroupedTabIds)) {
    state.tabSpaces[tabId] = spaceId;
  }

  await restoreTabPositions(
    layout.tabs,
    tabs,
    (tabId, position) => send('tabs:move', { tabId, ...position }, messageOptions),
  );
  await loadTabs({ adopt: false, ...messageOptions });

  for (const group of layout.groups || []) {
    const tabIds = uniqueNumberIds(group.tabIds);
    if (tabIds.length === 0) continue;
    const restoredGroupId = await createChromeGroup(tabIds, {
      title: group.title,
      color: group.color,
      collapsed: Boolean(group.collapsed),
      spaceId,
      ...messageOptions,
    });
    if (restoredGroupId === null) {
      throw new Error(`Could not restore Chrome group "${group.title || 'Tabs'}".`);
    }
    rememberRestoredGroupTabOrder(restoredGroupId, tabIds, spaceId);
  }
  await loadTabs({ adopt: false, ...messageOptions });
}

function rememberRestoredGroupTabOrder(groupId, tabIds, spaceId = state.activeSpaceId) {
  const numericGroupId = Number(groupId);
  const orderedIds = uniqueNumberIds(tabIds);
  if (!Number.isSafeInteger(numericGroupId) || numericGroupId < 0 || orderedIds.length === 0) return;
  for (const tabId of orderedIds) removeTabFromSavedOrder(tabId, spaceId);
  ensureTabOrderForSpace(spaceId)[`group:${numericGroupId}`] = orderedIds;
}

function organizationForCurrentSpaceState(spaceId, options = {}) {
  // Snapshot binding can mint lifecycle ids after the last Chrome read. Build
  // freshness fingerprints from the current authoritative binding instead of
  // whichever decoration happened to be present on the in-memory tab object.
  const liveGroups = buildSpaceViewForSpace(spaceId, {
    sourceTabs: tabsWithLifecycleIdentity(tabs),
  });
  const snapshot = mergeOpenSpaceSnapshot(liveGroups, state.spaceSnapshots?.[spaceId]) || {
    version: 1,
    updatedAt: Date.now(),
    groups: [],
  };
  return buildOrganizationCandidates({
    liveGroups,
    snapshot,
    tabIdAliases: options.tabIdAliases,
  });
}

async function assertOperationUndoIsFresh(operation, options = {}) {
  if (operation?.type === 'restore-backup') {
    const expectedFingerprint = operation.after?.portableFingerprint;
    if (!expectedFingerprint || !operation.before?.liveOwnership) {
      throw new Error('This restore record does not contain the safety data required for Undo.');
    }
    if (fingerprintPortableWorkspaceContent(state) !== expectedFingerprint) {
      throw new Error('Portable Space data changed after this backup was restored. Undo was stopped to preserve the newer Spaces, Tags, saved pages, or context.');
    }
    return;
  }
  if (!['tidy-names', 'auto-group'].includes(operation?.type)) return;
  if (!state.spaces.some((space) => space.id === operation.spaceId)) {
    throw new Error('This organization change belongs to a Space that no longer exists, so it cannot be safely undone.');
  }

  await loadTabs({ adopt: false, windowBinding: options.windowBinding });
  if (operation.type === 'tidy-names') {
    const expectedFingerprint = operation.after?.targetFingerprint;
    const expectedOrganizationFingerprint = operation.after?.organizationFingerprint;
    const targetIds = Object.keys(operation.after?.renamedTabs || {})
      .map(Number)
      .filter(Number.isSafeInteger);
    if (!expectedFingerprint && !expectedOrganizationFingerprint) {
      throw new Error('This Tidy Names record does not contain the safety data required for Undo.');
    }
    if (expectedFingerprint) {
      const targetIdSet = new Set(targetIds);
      const currentTargets = tabs.filter((tab) => targetIdSet.has(Number(tab.id)));
      const currentFingerprint = fingerprintTidyNameTargets(currentTargets, state.renamedTabs, {
        tabIdAliases: operation.after?.tabIdAliases,
      });
      if (currentFingerprint !== expectedFingerprint) {
        throw new Error('These tabs changed after Tidy Names was applied. Undo was stopped to preserve the newer names or pages.');
      }
    }
    if (expectedOrganizationFingerprint) {
      const currentOrganization = organizationForCurrentSpaceState(operation.spaceId, {
        tabIdAliases: operation.after?.tabIdAliases,
      });
      if (currentOrganization.fingerprint !== expectedOrganizationFingerprint) {
        const expectedParts = operation.after?.organizationFingerprintParts || {};
        const changedParts = [
          ...(expectedParts.live && expectedParts.live !== currentOrganization.fingerprintParts?.live
            ? ['open tabs or Chrome Tags']
            : []),
          ...(expectedParts.snapshot && expectedParts.snapshot !== currentOrganization.fingerprintParts?.snapshot
            ? ['saved Tags or pages']
            : []),
        ];
        const changed = changedParts.length > 0
          ? changedParts.join(' and ')
          : 'organization';
        throw new Error(`This Space's ${changed} changed after Tidy Names merged Tags. Undo was stopped to preserve the newer organization.`);
      }
    }
    return;
  }

  const expectedFingerprint = operation.after?.organizationFingerprint;
  if (!expectedFingerprint) {
    throw new Error('This Auto Group record does not contain the safety data required for Undo.');
  }
  if (organizationForCurrentSpaceState(operation.spaceId, {
    tabIdAliases: operation.after?.tabIdAliases,
  }).fingerprint !== expectedFingerprint) {
    throw new Error('This Space changed after Auto Group was applied. Undo was stopped to preserve the newer organization.');
  }
}

async function undoLastOperation(expectedOperationId = '', options = {}) {
  const windowBinding = options.windowBinding;
  let operation;
  let undoTarget;
  let postCommitWarning = '';
  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) return;
    undoTarget = resolveOperationUndoTarget(state.operationHistory, expectedOperationId);
    if (undoTarget.status !== 'ready') return;
    operation = undoTarget.operation;
    await assertOperationUndoIsFresh(operation, { windowBinding });
    if (operation.type === 'tidy-names') {
      if (operation.before?.tagMerge === true) {
        const rollback = captureChromeGroupMutationRollback();
        rollback.live = captureLiveOrganization(operation.spaceId);
        rollback.spaceId = operation.spaceId;
        await runChromeGroupMutationTransaction({
          apply: async () => {
            if (operation.before?.snapshot) {
              state.spaceSnapshots[operation.spaceId] = structuredClone(operation.before.snapshot);
            } else {
              delete state.spaceSnapshots[operation.spaceId];
            }
            dormantSpaceViewSpaceId = '';
            for (const [tabId, previousName] of Object.entries(operation.before?.renamedTabs || {})) {
              setLiveTabPanelTitle(state, tabId, previousName);
            }
            await restoreLiveOrganization(operation.before?.live, operation.spaceId, {
              windowBinding,
            });
            restoreMergedSnapshotGroupReferences(
              operation.before?.snapshotGroupReferences,
            );
            operation.status = 'undone';
            operation.undoneAt = Date.now();
          },
          checkpoint: async () => {
            const saved = await saveState({ persistWindowState: false, windowBinding });
            if (saved !== true) {
              throw new Error('This panel moved before Tidy Names Undo could save its checkpoint.');
            }
          },
          rollback: () => restoreAutoGroupUndoAfterFailure(rollback, { windowBinding }),
        });
        if (!isCurrentPanelWindowBinding(windowBinding)) {
          postCommitWarning =
            'Tidy Names Undo was saved, but this panel moved before its view could refresh.';
        } else {
          try {
            const refreshed = await refreshTabs({ reloadDormant: true, windowBinding });
            if (refreshed === false) {
              postCommitWarning =
                'Tidy Names Undo was saved, but this view could not refresh. Reopen Space Tabs to see the saved result.';
            }
          } catch (error) {
            console.error(error);
            postCommitWarning =
              'Tidy Names Undo was saved, but this view could not refresh. Reopen Space Tabs to see the saved result.';
          }
        }
        return;
      }
      const beforeUndo = captureWorkspaceMemoryCheckpoint();
      const transaction = await runDurableCommitBoundary({
        mutate: async () => {
          for (const [tabId, previousName] of Object.entries(operation.before?.renamedTabs || {})) {
            setLiveTabPanelTitle(state, tabId, previousName);
          }
          operation.status = 'undone';
          operation.undoneAt = Date.now();
          return captureWorkspaceMemoryCheckpoint();
        },
        commit: () => saveState({ persistWindowState: false, windowBinding }),
        rollbackBeforeCommit: () => restoreWorkspaceMemoryCheckpoint(beforeUndo, { renderView: true }),
        afterCommit: () => refreshTabs({ reloadDormant: true, windowBinding }),
        restoreCommittedMemory: (committed) => (
          restoreWorkspaceMemoryCheckpoint(committed, { renderView: true })
        ),
      });
      if (transaction.postCommitError) {
        postCommitWarning = 'Tidy Names Undo was saved, but this view could not refresh. Reopen Space Tabs to see the saved result.';
        if (transaction.recoveryError) console.error(transaction.recoveryError);
      }
      return;
    } else if (operation.type === 'auto-group') {
      const rollback = captureChromeGroupMutationRollback();
      rollback.live = captureLiveOrganization(operation.spaceId);
      rollback.spaceId = operation.spaceId;
      await runChromeGroupMutationTransaction({
        apply: async () => {
          if (operation.before?.snapshot) {
            state.spaceSnapshots[operation.spaceId] = structuredClone(operation.before.snapshot);
          } else {
            delete state.spaceSnapshots[operation.spaceId];
          }
          dormantSpaceViewSpaceId = '';
          await restoreLiveOrganization(operation.before?.live, operation.spaceId, {
            windowBinding,
          });
          restoreMergedSnapshotGroupReferences(
            operation.before?.snapshotGroupReferences,
          );
          operation.status = 'undone';
          operation.undoneAt = Date.now();
        },
        checkpoint: async () => {
          const saved = await saveState({ persistWindowState: false, windowBinding });
          if (saved !== true) {
            throw new Error('This panel moved before Auto Group Undo could save its checkpoint.');
          }
        },
        rollback: () => restoreAutoGroupUndoAfterFailure(rollback, { windowBinding }),
      });
      if (!isCurrentPanelWindowBinding(windowBinding)) {
        postCommitWarning =
          'Auto Group Undo was saved, but this panel moved before its view could refresh.';
      } else {
        try {
          const refreshed = await refreshTabs({ reloadDormant: true, windowBinding });
          if (refreshed === false) {
            postCommitWarning =
              'Auto Group Undo was saved, but this view could not refresh. Reopen Space Tabs to see the saved result.';
          }
        } catch (error) {
          console.error(error);
          postCommitWarning =
            'Auto Group Undo was saved, but this view could not refresh. Reopen Space Tabs to see the saved result.';
        }
      }
      return;
    } else if (operation.type === 'restore-backup') {
      const beforeUndoState = structuredClone(state);
      const beforeUndoDurableActiveSpaceId = durableActiveSpaceId;
      const beforeUndoWindowSpaceState = structuredClone(windowSpaceState);
      let persisted = false;
      try {
        const response = await send('tabs:listAll', {}, { windowBinding });
        restoreSpaceBackup(state, operation.before?.backup);
        state.spaceSnapshots = restoreSnapshotIdentityOverlay(
          state.spaceSnapshots,
          operation.before?.snapshotIdentities,
        );
        state.lastArcImport = structuredClone(operation.before?.lastArcImport || null);
        durableActiveSpaceId = activeSpaceForStorage(
          state.spaces,
          operation.before?.durableActiveSpaceId,
          state.activeSpaceId,
        );
        windowSpaceState = normalizeWindowSpaceState(operation.before?.windowSpaceState, state.spaces);
        state.activeSpaceId = activeSpaceForWindow(
          windowSpaceState,
          windowBinding?.windowId ?? panelWindowId,
          state.spaces,
          durableActiveSpaceId,
        );
        restoreLiveSpaceOwnership(
          state,
          response.tabs || [],
          response.groups || [],
          operation.before.liveOwnership,
          (windowId) => activeSpaceForWindow(
            windowSpaceState,
            windowId,
            state.spaces,
            durableActiveSpaceId,
          ),
        );
        dormantSpaceViewSpaceId = '';
        lastRenderedGroupsSignature = '';
        lastRenderedSpacesSignature = '';
        operation.status = 'undone';
        operation.undoneAt = Date.now();
        await saveState({ windowBinding });
        persisted = true;
        await refreshTabs({ adopt: false, reloadDormant: true, windowBinding });
      } catch (error) {
        state = beforeUndoState;
        durableActiveSpaceId = beforeUndoDurableActiveSpaceId;
        windowSpaceState = beforeUndoWindowSpaceState;
        const rollbackFailures = [];
        if (persisted) {
          try {
            if (isCurrentPanelWindowBinding(windowBinding)) {
              await saveState({ windowBinding });
            } else {
              await persistStoragePair({
                key: WINDOW_STATE_KEY,
                value: beforeUndoWindowSpaceState,
                get: windowStateGet,
                set: windowStateSet,
                remove: windowStateRemove,
              }, {
                key: STORAGE_KEY,
                value: stateForStorage(),
                get: storageGet,
                set: storageSet,
                remove: storageRemove,
              });
            }
          } catch (rollbackError) {
            rollbackFailures.push({ stage: 'restoring the post-restore workspace', error: rollbackError });
          }
        }
        restoreFailedWorkspaceMutation(beforeUndoState);
        if (rollbackFailures.length > 0) throw createRollbackFailureError(error, rollbackFailures);
        throw error;
      }
      return;
    } else {
      throw new Error(`Undo is not available for ${operation.type || 'this operation'}.`);
    }
    operation.status = 'undone';
    operation.undoneAt = Date.now();
    await saveState({ persistWindowState: false, windowBinding });
    await refreshTabs({
      adopt: operation.type === 'restore-backup',
      reloadDormant: true,
      windowBinding,
    });
  });
  if (undoTarget?.status !== 'ready') {
    renderOperationRecord();
    const message = operationUndoTargetMessage(undoTarget?.status);
    setStatus(message);
    showStatusToast(message, 'error');
    return;
  }
  if (postCommitWarning) {
    setStatus(postCommitWarning);
    showStatusToast(postCommitWarning, 'info');
    return;
  }
  const message = `Undid: ${operation.summary}.`;
  setStatus(message);
  showStatusToast(message, 'success');
}

function operationUndoTargetMessage(status) {
  if (status === 'undone') return 'That change was already undone. Nothing was changed.';
  if (status === 'ambiguous') {
    return 'That Undo record is no longer safe to identify. Nothing was changed.';
  }
  if (status === 'unavailable') return 'That change can no longer be undone. Nothing was changed.';
  return 'That Undo record is no longer available. Nothing was changed.';
}

function handleChromeTabUpdated(tabId, changeInfo, tab) {
  if (!changeInfo.url && !changeInfo.title && !changeInfo.status) return;
  const tabIndex = tabs.findIndex((candidate) => Number(candidate.id) === Number(tabId));
  if (tabIndex >= 0) tabs[tabIndex] = { ...tabs[tabIndex], ...tab };
}

function handleChromeTabRemoved(tabId, removeInfo = {}) {
  if (Number.isFinite(panelWindowId) && Number.isFinite(Number(removeInfo.windowId)) &&
      Number(removeInfo.windowId) !== Number(panelWindowId)) return;
  tabs = tabs.filter((tab) => Number(tab.id) !== Number(tabId));
}

function handleChromeTabDetached(tabId, detachInfo = {}) {
  if (Number.isFinite(panelWindowId) &&
      Number(detachInfo.oldWindowId) !== Number(panelWindowId)) return;
  tabs = tabs.filter((tab) => Number(tab.id) !== Number(tabId));
}

function handleChromeTabAttached(tabId, attachInfo = {}) {
  panelWindowBindingController?.handleAttached(tabId, attachInfo);
}

function handleChromeHostTabMoved(tabId, moveInfo = {}) {
  panelWindowBindingController?.handleMoved(tabId, moveInfo);
}

function handlePanelWindowRebound(transition) {
  // Update synchronously so a command issued after Chrome's attach event can
  // never inherit the Workbench's previous window while the UI refresh waits
  // for an earlier task to finish.
  panelWindowId = transition.windowId;
  panelWindowRebindTask = runTask(() => reconcilePanelWindowRebind(transition));
}

async function reconcilePanelWindowRebind(transition) {
  if (!isCurrentPanelWindowRebind(transition)) return;
  await withSharedStateLock(async () => {
    await runPanelWindowRefreshTransaction(
      panelWindowBindingController,
      transition,
      (binding) => syncStateFromStorage({ windowBinding: binding }),
      (binding) => refreshTabs({
        adopt: true,
        reloadDormant: true,
        renderAfterSave: true,
        windowBinding: binding,
      }),
    );
  });
}

function isCurrentPanelWindowRebind(transition) {
  return isCurrentPanelWindowBinding(transition) && panelWindowId === transition?.windowId;
}

function handleChromeTabReplaced(addedTabId, removedTabId) {
  const immediateTab = { id: Number(addedTabId) };
  state = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'replaced',
      removedTabId: Number(removedTabId),
      addedTabId: Number(addedTabId),
      tab: immediateTab,
      sessionId: state.browserSessionId,
    },
    now: Date.now(),
  });
  applyPanelTabIdReplacement(addedTabId, removedTabId, immediateTab);
  const reconcile = () => reconcileChromeTabReplacement(addedTabId, removedTabId);
  tabReplacementQueue = tabReplacementQueue.then(reconcile, reconcile).catch((error) => {
    // The background lifecycle journal independently retries this replacement.
    // Keep the panel responsive and let the next shared refresh converge if a
    // transient storage or tabs.get failure prevents this eager checkpoint.
    console.error('Space Tabs could not checkpoint a Chrome tab replacement:', error);
  });
}

async function reconcileChromeTabReplacement(addedTabId, removedTabId) {
  const added = Number(addedTabId);
  const removed = Number(removedTabId);
  if (!Number.isSafeInteger(added) || !Number.isSafeInteger(removed) || added === removed) return;
  const windowBinding = capturePanelWindowBinding();
  const replacementTab = await chrome.tabs.get(added).catch(() => ({ id: added }));
  if (!isCurrentPanelWindowBinding(windowBinding)) return;
  applyPanelTabIdReplacement(added, removed, replacementTab);
  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) return;
    state = reduceTabLifecycleEvent({
      state,
      event: {
        type: 'replaced',
        removedTabId: removed,
        addedTabId: added,
        tab: replacementTab,
        sessionId: state.browserSessionId,
      },
      now: Date.now(),
    });
    applyPanelTabIdReplacement(added, removed, replacementTab);
    // A replacement is global lifecycle metadata. Never let a host-window move
    // turn this eager checkpoint into a write to another window's Space map;
    // the background journal remains the authoritative retry if this epoch is
    // stale before the write begins.
    await saveState({ persistWindowState: false, windowBinding });
  });
  if (!isCurrentPanelWindowBinding(windowBinding)) return;
}

function applyPanelTabIdReplacement(addedTabId, removedTabId, replacementTab = {}) {
  const migrated = migratePanelTabIdReplacement({
    tabs,
    foreignLiveTabs,
    selectedTabIds,
    selectionAnchorTabId,
    recentlyOpenedDormantTabs,
    syntheticPlaceholderTabIds,
    dragState,
  }, { addedTabId, removedTabId, replacementTab });
  if (!migrated.replacementApplied) return;

  tabs = migrated.tabs;
  foreignLiveTabs = migrated.foreignLiveTabs;
  selectedTabIds = new Set(migrated.selectedTabIds);
  selectionAnchorTabId = migrated.selectionAnchorTabId;
  recentlyOpenedDormantTabs = migrated.recentlyOpenedDormantTabs;
  syntheticPlaceholderTabIds.clear();
  for (const tabId of migrated.syntheticPlaceholderTabIds) {
    syntheticPlaceholderTabIds.add(tabId);
  }

  if (migrated.dragInvalidated) {
    clearDragState();
    setStatus('The dragged tab changed in Chrome. Try the drag again.');
  }
  lastRenderedGroupsSignature = '';
  if (migrated.visibleTabsChanged) render();
}

function mergeDormantSpaceView(liveView, dormantView) {
  pruneRecentlyOpenedDormantTabs();
  return mergeLiveAndDormantGroups({
    liveGroups: liveView,
    dormantGroups: dormantView,
    collapsedGroups: state.collapsedGroups,
    recentlyOpenedTabs: recentlyOpenedDormantTabs,
  });
}

function commandPaletteSpaceView() {
  pruneRecentlyOpenedDormantTabs();
  return (state.spaces || []).flatMap((space) => {
    const spaceId = String(space?.id || '');
    if (!spaceId) return [];
    const liveView = buildSpaceViewForSpace(spaceId);
    const dormantView = markDormantTabsOpenInOtherWindows(
      dormantGroupsFromSnapshot(state.spaceSnapshots?.[spaceId], spaceId),
      foreignLiveTabs,
      state,
      spaceId,
    );
    return mergeLiveAndDormantGroups({
      liveGroups: liveView,
      dormantGroups: dormantView,
      collapsedGroups: state.collapsedGroups,
      recentlyOpenedTabs: recentlyOpenedDormantTabs,
    }).map((group) => ({
      ...group,
      spaceId,
      tabs: (group.tabs || []).map((tab) => ({ ...tab, spaceId })),
    }));
  });
}

function snapshotUrlIdentity(url) {
  return String(url || '').trim();
}

function dormantGroupsFromSnapshot(snapshot = {}, spaceId = state.activeSpaceId) {
  // Emptied saved Tags are filtered AFTER mapping: the row key embeds the
  // snapshot array index, and filtering first would shift the indexes so
  // mutations would resolve to the wrong Tag.
  return (snapshot?.groups || [])
    .map((group, groupIndex) => {
      const title = Object.hasOwn(group, 'title') ? String(group.title ?? '') : 'Ungrouped';
      const key = snapshotGroupKey(groupIndex, group, spaceId);
      return {
        id: key,
        key,
        spaceId,
        snapshotGroupId: group.snapshotGroupId,
        title,
        color: group.color || (title === 'Ungrouped' ? 'grey' : 'blue'),
        collapsed: Boolean(state.collapsedGroups[key] ?? true),
        dormant: true,
        tabs: (group.tabs || []).map((tab, tabIndex) => {
          const title = tab.title || tab.url || 'Untitled';
          const panelTitle = cleanPanelName(tab.panelTitle);
          return {
            id: `${key}:${tabIndex}`,
            snapshotTabId: tab.snapshotTabId,
            snapshotGroupId: group.snapshotGroupId,
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
            spaceId,
          };
        }),
      };
    })
    // An emptied saved Tag is unremovable noise unless its title still
    // collides with another Tag, which makes it a candidate the user can
    // merge with the local Tidy. Keep those visible; drop the rest.
    .filter((entry) => (
      entry.tabs.length > 0 ||
      snapshotEmptyTagIsMergeCandidate(snapshot, { title: entry.title })
    ));
}

function renderGroups() {
  const ungrouped = spaceView.find((group) => group.key === 'ungrouped') || null;
  const tabGroups = isSpaceGroupsCollapsed()
    ? []
    : spaceView.filter((group) => group.key !== 'ungrouped');
  const tree = createFolderTree(tabGroups, { activeSpaceId: state.activeSpaceId });
  const signature = groupsRenderSignature({
    activeSpaceId: state.activeSpaceId,
    fileSchemeAccessAllowed,
    spaceGroupsCollapsed: isSpaceGroupsCollapsed(),
    collapsedGroups: state.collapsedGroups,
    selectedTabIds,
    groups: [...tabGroups, ungrouped],
    folderTree: tree,
  });
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
  const canDragFolder = Boolean(
    dragContext?.groupKeys?.length && !folderContextHasForeignLiveTabs(dragContext)
  );
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
  header.addEventListener('keydown', (event) => {
    if (!isContextMenuKey(event)) return;
    showFolderContextMenu(event, dragContext);
  });
  bindGroupPreview(header, groupPreviewGroupForFolder(folder, collapsed));

  const children = document.createElement('div');
  children.className = 'folder-children';
  if (!collapsed) children.replaceChildren(...folder.children.map(createFolderTreeNode));

  section.append(header, children);
  return section;
}

async function toggleFolder(folderKey, options = {}) {
  const windowBinding = options.windowBinding;
  // Folding a folder is pure disclosure state — no Chrome mutation, so no
  // drag-context guard is needed; a click during a re-render must still work.
  if (!options.stateLocked) {
    try {
      return await withFreshSpaceStateMutation(() => toggleFolder(folderKey, {
        stateLocked: true,
        focusRestoreToken: options.focusRestoreToken,
        windowBinding,
      }), { windowBinding });
    } catch (error) {
      restoreDisclosureFocus('folder', folderKey, options.focusRestoreToken);
      throw error;
    }
  }
  const rollback = captureChromeGroupMutationRollback();
  try {
    state.collapsedGroups[folderKey] = !state.collapsedGroups[folderKey];
    await saveState({ persistWindowState: false, windowBinding });
  } catch (error) {
    restoreChromeGroupMutationMemory(rollback);
    render();
    restoreDisclosureFocus('folder', folderKey, options.focusRestoreToken);
    throw error;
  }
  lastRenderedGroupsSignature = '';
  render();
  restoreDisclosureFocus('folder', folderKey, options.focusRestoreToken);
}

function createGroupCard(group) {
  const hasForeignLiveTabs = groupHasForeignLiveTabs(group);
  const canDragGroup = Boolean(group.key && group.key !== 'ungrouped' && !hasForeignLiveTabs);
  const card = document.createElement('section');
  card.className = `group-card${group.collapsed ? ' collapsed' : ''}`;
  card.dataset.groupKey = group.key;
  // Chrome-style color band: the Tag's color tints the whole card.
  card.style.setProperty('--group-color', groupColor(group.color));
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
  const toggle = createGroupToggle(group, group.displayTitle || group.title);
  const chevron = document.createElement('span');
  chevron.className = 'group-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
  const actions = document.createElement('div');
  actions.className = 'group-actions';
  const renameButton = actionButton('✎', 'Rename group', (windowBinding) => renameGroup(group, { windowBinding }));
  const deleteButton = actionButton('×', 'Delete group', (windowBinding) => deleteGroup(group, { windowBinding }));
  actions.append(renameButton, deleteButton);
  header.append(toggle, actions, chevron);
  header.addEventListener('click', (event) => {
    if (event.target.closest('.group-actions')) return;
    handleGroupHeaderClick(event, group);
  });
  bindGroupPreview(header, group);

  const list = document.createElement('div');
  list.className = 'tab-list';
  configureTabListAccessibility(list, `${group.displayTitle || group.title || 'Group'} tabs`);
  list.dataset.groupKey = group.key;
  if (!group.dormant && !hasForeignLiveTabs) {
    list.addEventListener('dragover', (event) => acceptTabDrop(event));
    list.addEventListener('drop', (event) => dropTabAtEnd(event, group));
  }
  if (!group.collapsed) list.replaceChildren(...group.tabs.map((tab) => createTabRow(tab, group.key)));

  card.append(header, list);
  return card;
}

function createFolderTabs(group) {
  const hasForeignLiveTabs = groupHasForeignLiveTabs(group);
  const canDragGroup = Boolean(group.key && group.key !== 'ungrouped' && !hasForeignLiveTabs);
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
  const toggle = createGroupToggle(group, group.displayTitle || 'Tabs');
  const chevron = document.createElement('span');
  chevron.className = 'group-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
  const actions = document.createElement('div');
  actions.className = 'group-actions';
  const renameButton = actionButton('✎', 'Rename group', (windowBinding) => renameGroup(group, { windowBinding }));
  const deleteButton = actionButton('×', 'Delete group', (windowBinding) => deleteGroup(group, { windowBinding }));
  actions.append(renameButton, deleteButton);
  header.append(toggle, actions, chevron);
  header.addEventListener('click', (event) => {
    if (event.target.closest('.group-actions')) return;
    handleGroupHeaderClick(event, group);
  });
  bindGroupPreview(header, group);

  const list = document.createElement('div');
  list.className = 'tab-list folder-direct-list';
  configureTabListAccessibility(list, `${group.displayTitle || group.title || 'Group'} tabs`);
  list.dataset.groupKey = group.key;
  if (!group.dormant && !hasForeignLiveTabs) {
    list.addEventListener('dragover', (event) => acceptTabDrop(event));
    list.addEventListener('drop', (event) => dropTabAtEnd(event, group));
  }
  if (!group.collapsed) list.replaceChildren(...group.tabs.map((tab) => createTabRow(tab, group.key)));
  section.append(header, list);
  return section;
}

function createGroupToggle(group, title) {
  const toggle = document.createElement('button');
  toggle.className = 'group-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', group.collapsed ? 'false' : 'true');
  toggle.innerHTML = `
    ${groupFolderIcon(group.color, group.collapsed)}
    <h2>${escapeHtml(title || 'Group')}</h2>
  `;
  toggle.addEventListener('keydown', (event) => {
    if (!isContextMenuKey(event)) return;
    showGroupContextMenu(event, group);
  });
  return toggle;
}

function groupHasForeignLiveTabs(group) {
  return (group?.tabs || []).some((tab) => isForeignWindowTab(tab));
}

function folderContextHasForeignLiveTabs(folderContext) {
  return (folderContext?.groupKeys || []).some((key) => (
    groupHasForeignLiveTabs(renderedGroupContexts.get(key))
  ));
}

function assertGroupActionsAreLocal(groups = []) {
  if (groups.some((group) => groupHasForeignLiveTabs(group))) {
    throw new Error('This group is open in another window. Open Space Tabs in that window to rename, move, or delete it.');
  }
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
  const trigger = anchor.matches('button') ? anchor : anchor.querySelector('.group-toggle');
  if (!trigger) return;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'groupPreviewPopover');
  trigger.setAttribute('aria-keyshortcuts', 'ArrowDown ArrowRight');
  trigger.dataset.previewOpen = 'false';
  const show = (event) => {
    if (event?.pointerType === 'touch') return;
    scheduleShowGroupPreview(trigger, group);
  };
  anchor.addEventListener('mouseenter', show);
  anchor.addEventListener('pointerenter', show);
  anchor.addEventListener('mouseleave', scheduleHideGroupPreview);
  anchor.addEventListener('pointerleave', scheduleHideGroupPreview);
  trigger.addEventListener('focusin', () => {
    if (!restoringGroupPreviewFocus) scheduleShowGroupPreview(trigger, group);
  });
  trigger.addEventListener('focusout', (event) => {
    if (!groupPreviewPopover?.contains(event.relatedTarget)) scheduleHideGroupPreview();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      showGroupPreview(trigger, group);
      groupPreviewPopover?.querySelector('.group-preview-search-input')?.focus();
      return;
    }
    if (
      event.key === 'Escape' &&
      groupPreviewAnchor === trigger &&
      groupPreviewPopover?.hidden === false
    ) {
      event.preventDefault();
      event.stopPropagation();
      closeGroupPreviewAndRestoreFocus();
    }
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
  clearTimeout(groupPreviewOpenTimer);
  clearTimeout(groupPreviewCloseTimer);
  if (groupPreviewAnchor && groupPreviewAnchor !== anchor) {
    groupPreviewAnchor.dataset.previewOpen = 'false';
  }
  const sameGroup = groupPreviewGroup?.key === group.key;
  groupPreviewAnchor = anchor;
  groupPreviewAnchor.dataset.previewOpen = 'true';
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
  if (groupPreviewAnchor) groupPreviewAnchor.dataset.previewOpen = 'false';
  groupPreviewAnchor = null;
  groupPreviewGroup = null;
  groupPreviewQuery = '';
}

function hideGroupPreviewFromGlobalKeyboard() {
  if (groupPreviewPopover?.contains(document.activeElement)) return;
  hideGroupPreview();
}

function closeGroupPreviewAndRestoreFocus() {
  const returnFocus = groupPreviewAnchor;
  hideGroupPreview();
  if (!returnFocus?.isConnected) return;
  restoringGroupPreviewFocus = true;
  try {
    returnFocus.focus({ preventScroll: true });
  } finally {
    restoringGroupPreviewFocus = false;
  }
}

function ensureGroupPreviewPopover() {
  if (groupPreviewPopover) return groupPreviewPopover;
  const popover = document.createElement('div');
  popover.id = 'groupPreviewPopover';
  popover.className = 'group-preview-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
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
  const groupTitle = groupPreviewGroup?.displayTitle || groupPreviewGroup?.title || 'tabs';
  popover.setAttribute('aria-label', `Preview tabs in ${groupTitle}`);
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
  input.placeholder = `Search ${groupTitle}...`;
  input.setAttribute('aria-label', `Search tabs in ${groupTitle}`);
  input.value = groupPreviewQuery;

  const list = document.createElement('div');
  list.className = 'group-preview-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', `${groupTitle} tabs`);

  input.addEventListener('input', () => {
    groupPreviewQuery = input.value;
    renderGroupPreviewList(list);
    positionGroupPreview();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeGroupPreviewAndRestoreFocus();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list.querySelector('.group-preview-item')?.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      [...list.querySelectorAll('.group-preview-item')].at(-1)?.focus();
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
    empty.setAttribute('role', 'status');
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
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', item.active ? 'true' : 'false');

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
    const windowBinding = capturePanelWindowBinding();
    runTask(() => openGroupPreviewTab(item, { windowBinding }));
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeGroupPreviewAndRestoreFocus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const list = button.closest('.group-preview-list');
    const items = [...(list?.querySelectorAll('.group-preview-item') || [])];
    const currentIndex = items.indexOf(button);
    if (currentIndex < 0 || items.length === 0) return;
    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    items[nextIndex].focus({ preventScroll: true });
  });
  return button;
}

async function openGroupPreviewTab(item, options = {}) {
  const tab = (groupPreviewGroup?.tabs || [])
    .find((candidate) => String(candidate.id) === String(item.id));
  if (!tab) return;
  const groupKey = tab.previewGroupKey || groupPreviewGroup.key;
  hideGroupPreview();
  if (isForeignWindowTab(tab)) await focusForeignWindowTab(tab, options);
  else if (tab.dormant) await openDormantTab(tab, groupKey, {
    windowBinding: options.windowBinding,
  });
  else await focusTab(tab, options);
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
  const foreignCount = group.tabs.filter((tab) => isForeignWindowTab(tab)).length;
  const clearableCount = clearableUngroupedTabs(group.tabs, {
    fileSchemeAccess: fileSchemeAccessAllowed,
  }).length;
  clearButton.disabled = clearableCount === 0;
  clearButton.title = clearableCount > 0
    ? `Close ${clearableCount} temporary ${clearableCount === 1 ? 'tab' : 'tabs'}${
      foreignCount > 0 ? '; tabs open in other windows are unchanged' : ''
    }`
    : foreignCount > 0
      ? 'Open this Space in the other window to clear those tabs'
      : group.tabs.length > 0 ? 'Pinned or non-restorable tabs are kept' : 'No temporary tabs to clear';
  clearButton.addEventListener('click', () => runTask((windowBinding) => (
    clearUngroupedTabs(group, { windowBinding })
  )));
  divider.append(line, clearButton);

  const newTabButton = document.createElement('button');
  newTabButton.className = 'new-tab-row';
  newTabButton.type = 'button';
  newTabButton.innerHTML = '<span>+</span><strong>New Tab</strong>';
  newTabButton.addEventListener('click', () => {
    const windowBinding = capturePanelWindowBinding();
    runTask(() => newTabInActiveSpace({ windowBinding }));
  });

  const list = document.createElement('div');
  list.className = 'tab-list ungrouped-list';
  configureTabListAccessibility(list, 'Ungrouped tabs');
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
  const accessibleTitle = tab.displayTitle || tab.title || tab.url || 'Untitled';
  const presentation = tabRowPresentation(tab);
  const selected = !tab.dormant && !presentation.foreign && selectedTabIds.has(tab.id);
  row.className = [
    'tab-row',
    tab.active ? 'active' : '',
    tab.dormant ? 'dormant' : '',
    selected ? 'selected' : '',
  ].filter(Boolean).join(' ');
  row.draggable = !tab.dormant && !tab.pinned && !presentation.foreign;
  row.dataset.tabId = String(tab.id);
  row.dataset.groupKey = groupKey;
  row.dataset.snapshotTabId = String(tab.snapshotTabId || '');
  row.dataset.snapshotGroupId = String(tab.snapshotGroupId || '');
  if (presentation.foreignWindowTabId !== null) {
    row.dataset.foreignWindowTabId = String(presentation.foreignWindowTabId);
    if (presentation.foreignWindowId !== null) {
      row.dataset.foreignWindowId = String(presentation.foreignWindowId);
    }
  }
  row.setAttribute('role', 'listitem');

  const favicon = createFavicon(tab);

  const label = document.createElement('div');
  label.className = 'tab-label';
  label.innerHTML = `
    <div class="tab-title">${escapeHtml(tab.displayTitle || tab.title || tab.url || 'Untitled')}</div>
    <div class="tab-domain">${escapeHtml(presentation.secondaryLabel)}</div>
  `;

  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'tab-main-button';
  primary.setAttribute(
    'aria-label',
    `${accessibleTitle}${presentation.ariaStateLabel ? `, ${presentation.ariaStateLabel}` : ''}`,
  );
  if (!tab.dormant && !presentation.foreign) {
    primary.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
  primary.append(favicon, label);
  primary.addEventListener('click', (event) => handleTabClick(event, tab));
  primary.addEventListener('keydown', (event) => handleTabPrimaryKeydown(event, tab, groupKey, primary));

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (presentation.foreign) {
    actions.append(
      actionButton('↗', 'Show in other window', (windowBinding) => (
        focusForeignWindowTab(tab, { windowBinding })
      )),
    );
  } else if (tab.dormant) {
    actions.append(
      actionButton('↗', 'Open', (windowBinding) => openDormantTab(tab, groupKey, { windowBinding })),
      actionButton('×', 'Remove saved tab', (windowBinding) => (
        removeDormantTab(tab, groupKey, { windowBinding })
      )),
    );
  } else {
    const renameButton = actionButton('✎', tab.pinned
      ? 'Pinned tabs use their Chrome page title and cannot be renamed in the panel'
      : 'Rename in panel', (windowBinding) => renameTab(tab, { windowBinding }));
    renameButton.disabled = Boolean(tab.pinned);
    const closeButton = actionButton('×', tab.pinned
      ? 'Unpin this tab in Chrome before closing it from Space Tabs'
      : 'Close', (windowBinding) => closeTab(tab, groupKey, { windowBinding }));
    closeButton.disabled = Boolean(tab.pinned);
    actions.append(
      renameButton,
      closeButton,
    );
  }

  row.append(primary, actions);
  if (!tab.dormant && !presentation.foreign) {
    row.addEventListener('contextmenu', (event) => showTabContextMenu(event, tab));
  }
  if (!tab.dormant && !tab.pinned && !presentation.foreign) {
    row.addEventListener('dragstart', (event) => startTabDrag(event, tab, groupKey));
    row.addEventListener('dragend', clearDragState);
  }
  if ((!tab.dormant && !tab.pinned && !presentation.foreign) || tab.dormant) {
    row.addEventListener('dragover', (event) => acceptTabDrop(event));
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (event) => dropTabBefore(event, tab, groupKey));
  }
  return row;
}

function configureTabListAccessibility(list, label) {
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', label);
}

function handleTabPrimaryKeydown(event, tab, groupKey, primary) {
  if (event.target !== primary) return;
  if (isContextMenuKey(event) && !tab.dormant && !isForeignWindowTab(tab)) {
    showTabContextMenu(event, tab);
    return;
  }
  const activate = () => {
    if (isForeignWindowTab(tab)) runTask((windowBinding) => (
      focusForeignWindowTab(tab, { windowBinding })
    ));
    else {
      const windowBinding = capturePanelWindowBinding();
      runTask((taskWindowBinding) => tab.dormant
        ? openDormantTab(tab, groupKey, { windowBinding })
        : focusTab(tab, { windowBinding: taskWindowBinding }));
    }
  };
  if (event.key !== ' ' && event.key !== 'Spacebar') return;
  event.preventDefault();
  if (tab.dormant || isForeignWindowTab(tab)) {
    activate();
    return;
  }
  updateTabSelection(tab.id, {
    additive: !event.shiftKey,
    range: event.shiftKey,
  });
  render();
  focusRenderedTabPrimary(tab.id);
}

function focusRenderedTabPrimary(tabId) {
  const matchingRow = [...els.groupsList.querySelectorAll('.tab-row')]
    .find((row) => row.dataset.tabId === String(tabId));
  matchingRow?.querySelector('.tab-main-button')?.focus({ preventScroll: true });
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
  const signature = spacesRenderSignature({
    layoutMode,
    workbenchMode,
    activeView,
    onboardingCompleted: state.onboarding?.completed === true,
    activeSpaceId: state.activeSpaceId,
    spaces: state.spaces,
  });
  if (signature === lastRenderedSpacesSignature) return;
  lastRenderedSpacesSignature = signature;

  const spaceButtons = state.spaces.map((space) => {
    const button = document.createElement('button');
    button.className = `space${space.id === state.activeSpaceId && (workbenchMode || activeView === 'space') ? ' active' : ''}`;
    button.type = 'button';
    button.dataset.spaceId = space.id;
    button.title = space.name;
    button.setAttribute('aria-label', space.name);
    const mark = document.createElement('span');
    mark.className = 'space-mark';
    mark.textContent = space.icon || space.name.slice(0, 1).toUpperCase();
    const label = document.createElement('span');
    label.className = 'space-label';
    label.textContent = space.name;
    button.append(mark, label);
    button.addEventListener('click', () => runTask((windowBinding) => (
      activateSpace(space.id, { windowBinding })
    )));
    button.addEventListener('contextmenu', (event) => showSpaceContextMenu(event, space));
    button.addEventListener('keydown', (event) => {
      if (isContextMenuKey(event)) showSpaceContextMenu(event, space);
    });
    return button;
  });

  const addButton = document.createElement('button');
  addButton.className = 'space add-space';
  addButton.type = 'button';
  addButton.title = 'Add Space';
  addButton.setAttribute('aria-label', 'Add Space');
  addButton.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
  addButton.querySelector('svg').classList.add('space-mark');
  addButton.append(spaceButtonLabel('New Space'));
  addButton.addEventListener('click', () => runTask((windowBinding) => (
    addSpace({ windowBinding })
  )));

  const spacesGroup = document.createElement('div');
  spacesGroup.className = 'dock-group dock-spaces';
  spacesGroup.setAttribute('aria-label', 'Spaces');
  spacesGroup.replaceChildren(...spaceButtons, addButton);

  els.spacesList.replaceChildren(spacesGroup);
}

function spaceButtonLabel(text) {
  const label = document.createElement('span');
  label.className = 'space-label';
  label.textContent = text;
  return label;
}

async function openWorkbench(options = {}) {
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
      }, { windowBinding: options.windowBinding });
  } else {
    window.open(url.toString(), 'space-workbench');
  }
}

function startArcFileSelectionFromUserGesture() {
  const input = els.arcImportInput;
  // File System Access API pickers reject Arc's file under macOS ~/Library as
  // a sensitive system location. A native file input can read the exact file
  // the user explicitly chooses, so Arc import must always use this path.
  input.value = '';
  input.click();
}

function arcPlanResolutionSignature(plan) {
  return JSON.stringify((plan?.spacePreviews || []).map((preview) => [
    preview.sourceSpaceId,
    preview.resolvedId,
    preview.resolvedName,
  ]));
}

async function addSpace(options = {}) {
  let draft = 'New Space';
  let windowBinding = options.windowBinding;
  while (true) {
    const name = await askText({
      title: 'New Space',
      label: 'Space name',
      value: draft,
      confirmText: 'Create',
    });
    if (name === null) return false;
    draft = name;
    const clean = name.trim();
    if (!clean) {
      const message = 'Enter a name for the new Space.';
      setStatus(message);
      if (workbenchMode) showStatusToast(message, 'error');
      continue;
    }

    // A naming dialog can remain open while its Workbench tab moves between
    // Chrome windows. The Create confirmation is the gesture that chooses the
    // destination window, not the earlier click that opened the dialog.
    windowBinding = capturePanelWindowBinding();
    try {
      await withSharedStateLock(async () => {
        const synchronized = await syncStateFromStorage({ windowBinding });
        if (synchronized === false) {
          throw new Error('This Workbench moved to another Chrome window before the Space could be created.');
        }
        // Capture only after synchronizing. A failed attempt must preserve any
        // newer Spaces saved by another panel while this dialog was open.
        const beforeCreate = captureWorkspaceMemoryCheckpoint();
        try {
          const space = {
            id: uniqueSpaceId(clean),
            name: clean,
            icon: clean.slice(0, 1).toUpperCase(),
            color: nextSpaceColor(),
          };
          state.spaces.push(space);
          // switchSpace performs the sole durable pair write. The new Space,
          // durable active Space, and this window's mapping therefore commit or
          // roll back together, including an apply-then-reject storage failure.
          const activated = await activateSpace(space.id, {
            rollbackCheckpoint: beforeCreate,
            stateLocked: true,
            windowBinding,
          });
          if (activated !== true) {
            throw new Error('This Workbench moved to another Chrome window before the Space could be created.');
          }
        } catch (error) {
          restoreWorkspaceMemoryCheckpoint(beforeCreate, {
            renderView: isCurrentPanelWindowBinding(windowBinding),
          });
          throw error;
        }
      });
      return true;
    } catch (error) {
      const retryIsUnsafe = isRollbackIntegrityFailure(error);
      const detail = formatAIError(error);
      const message = retryIsUnsafe
        ? `${detail} The workspace could not be verified after rollback. Reload Space Tabs before trying Add Space again.`
        : detail;
      setStatus(message);
      if (workbenchMode) showStatusToast(message, 'error');
      console.error(error);
      if (retryIsUnsafe) return false;
      // Looping immediately reopens the shared dialog with the same draft. Its
      // normal open path restores input focus, so a one-shot failure can be
      // retried with one more Create confirmation and no duplicate Space.
    }
  }
}

async function activateSpace(spaceId, options = {}) {
  const windowBinding = options.windowBinding || capturePanelWindowBinding();
  if (!isCurrentPanelWindowBinding(windowBinding)) return false;
  if (!options.stateLocked) {
    return withSharedStateLock(async () => {
      const synchronized = await syncStateFromStorage({ windowBinding });
      if (synchronized === false) return false;
      return activateSpace(spaceId, { ...options, stateLocked: true, windowBinding });
    });
  }
  if (!state.spaces.some((space) => space.id === spaceId)) return false;
  if (spaceId === state.activeSpaceId) {
    // Clicking the current Space is a view change, not a browser-navigation
    // command. Keep the user's active tab, form state, and scroll position.
    activeView = 'space';
    render();
    return true;
  }
  return switchSpace(spaceId, { ...options, windowBinding });
}

async function renameSpace(space, options = {}) {
  const windowBinding = options.windowBinding;
  const reviewedTargetFingerprint = renameTargetReviewFingerprint('space', space);
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
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) return;
    const current = state.spaces.find((item) => item.id === space.id);
    if (!current || !reviewedRenameTargetIsCurrent(
      reviewedTargetFingerprint,
      'space',
      current,
    )) {
      throw new Error('This Space changed while the Rename Space dialog was open. Nothing was changed. Review its current name and try again.');
    }
    // Capture only after synchronizing and passing the reviewed-target guard.
    // A failed write must restore that newest state, not the older object that
    // originally opened the dialog, and rollback must never write stale data.
    const beforeRename = captureWorkspaceMemoryCheckpoint();
    const transaction = await runDurableCommitBoundary({
      mutate: () => {
        current.name = clean;
        current.icon = clean.slice(0, 1).toUpperCase();
        return captureWorkspaceMemoryCheckpoint();
      },
      commit: async () => {
        const saved = await saveState({ persistWindowState: false, windowBinding });
        if (saved !== true) {
          throw new Error('This panel moved to another Chrome window before the Space rename could be saved.');
        }
      },
      rollbackBeforeCommit: () => (
        restoreWorkspaceMemoryCheckpoint(beforeRename, { renderView: true })
      ),
      afterCommit: () => render(),
      restoreCommittedMemory: (committed) => (
        restoreWorkspaceMemoryCheckpoint(committed, { renderView: true })
      ),
    });
    if (transaction.postCommitError) {
      const message = 'The Space rename was saved, but this view could not refresh. Reopen Space Tabs to see the saved name.';
      setStatus(message);
      if (workbenchMode) showStatusToast(message, 'error');
      console.error(transaction.recoveryError || transaction.postCommitError);
    }
  });
}

async function deleteSpace(space, options = {}) {
  const windowBinding = options.windowBinding;
  if (state.spaces.length <= 1) {
    setStatus('Keep at least one Space.');
    return;
  }
  let expectedPlan = null;
  let fallbackName = 'the remaining Space';
  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) return;
    expectedPlan = await liveSpaceDeletionPlan(space.id, { windowBinding });
    fallbackName = fallbackSpaceAfterDelete(state.spaces, space.id)?.name || fallbackName;
  });
  if (!expectedPlan) return;
  const pinnedDisclosure = expectedPlan.preservedPinnedTabs.length > 0
    ? ` ${expectedPlan.preservedPinnedTabs.length} pinned ${expectedPlan.preservedPinnedTabs.length === 1 ? 'tab stays' : 'tabs stay'} open and ${expectedPlan.preservedPinnedTabs.length === 1 ? 'moves' : 'move'} to "${fallbackName}".`
    : '';
  const ok = await askConfirm({
    title: 'Delete Space',
    message: `Delete "${space.name}", close ${expectedPlan.closingTabs.length} open ${expectedPlan.closingTabs.length === 1 ? 'tab' : 'tabs'} across all windows, and remove every saved tab in it?${pinnedDisclosure} This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;

  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) return;
    const current = state.spaces.find((item) => item.id === space.id);
    if (!current || state.spaces.length <= 1) return;
    const latestPlan = await liveSpaceDeletionPlan(space.id, { windowBinding });
    if (latestPlan.fingerprint !== expectedPlan.fingerprint) {
      throw new Error('This Space, its contents, or the fallback Space changed while the delete confirmation was open. Review the updated deletion and try again.');
    }
    await deleteSpaceFromCurrentState(current, {
      expectedFingerprint: latestPlan.fingerprint,
      windowBinding,
    });
  });
}

async function deleteSpaceFromCurrentState(space, options = {}) {
  const windowBinding = options.windowBinding;
  // The confirmation count is based only on tabs already owned by this Space.
  // Adopting a newly-created, unassigned tab here would close it without ever
  // showing it in the destructive confirmation.
  const loaded = await loadTabs({ adopt: false, windowBinding });
  if (loaded === false) return false;
  const deletingActiveSpace = state.activeSpaceId === space.id;
  const fallback = fallbackSpaceAfterDelete(state.spaces, space.id);

  const transitionRollback = createSpaceDeletionRollbackJournal({
    beforeState: state,
    deletingSpaceId: space.id,
    durableActiveSpaceId,
    windowSpaceState,
    activeView,
    deletingActiveSpace,
  });
  if (deletingActiveSpace && fallback) {
    try {
      snapshotOpenSpace(space.id);
      activeView = 'space';
      state.activeSpaceId = fallback.id;
      durableActiveSpaceId = fallback.id;
      // Selecting the fallback follows the same non-destructive contract as a
      // routine Space switch. Saved fallback pages stay dormant until the user
      // opens them; deletion only closes tabs that were explicitly reviewed.
      const saved = await saveState({ windowBinding });
      if (saved === false) throw new Error('This panel moved to another Chrome window before deletion began.');
      transitionRollback.checkpointState = structuredClone(state);
    } catch (error) {
      await rollbackSpaceDeletionTransition(transitionRollback, error, { windowBinding });
      throw error;
    }
  }

  let deletionCommitted = false;
  try {
    await closeSpaceTabsAcrossWindows(space.id, fallback?.id, {
      expectedFingerprint: options.expectedFingerprint,
      rollbackJournal: transitionRollback,
      windowBinding,
      commit: async () => {
        state.spaces = state.spaces.filter((item) => item.id !== space.id);
        removeSpaceReferences(state, space.id);
        activeView = 'space';
        if (state.activeSpaceId === space.id && fallback) {
          state.activeSpaceId = fallback.id;
          durableActiveSpaceId = fallback.id;
        }
        // Deletion is global: every window that was viewing the removed Space
        // follows it to the reviewed fallback, while unrelated per-window
        // choices remain independent. Commit both stores together so neither
        // a stale window mapping nor a half-deleted workspace can survive.
        const nextWindowSpaceState = reassignDeletedSpaceWindows(
          windowSpaceState,
          space.id,
          fallback?.id,
          state.spaces,
        );
        await persistStoragePair({
          key: WINDOW_STATE_KEY,
          value: nextWindowSpaceState,
          get: windowStateGet,
          set: windowStateSet,
          remove: windowStateRemove,
        }, {
          key: STORAGE_KEY,
          value: stateForStorage(),
          get: storageGet,
          set: storageSet,
          remove: storageRemove,
        });
        windowSpaceState = nextWindowSpaceState;
        deletionCommitted = true;
      },
    });
  } catch (error) {
    if (deletionCommitted) {
      await renderCommittedSpaceDeletionState();
      throw createCommittedSpaceDeletionError(space.name, error);
    }
    await rollbackSpaceDeletionTransition(transitionRollback, error, { windowBinding });
    throw error;
  }

  try {
    const reloaded = await loadTabs({ adopt: false, windowBinding });
    if (reloaded === false) return true;
    await loadDormantSpaceView(state.activeSpaceId, { force: true });
    render();
    renderSettings();
  } catch (error) {
    await renderCommittedSpaceDeletionState();
    throw createCommittedSpaceDeletionError(space.name, error);
  }
  const message = `Deleted ${space.name}.`;
  setStatus(message);
  showStatusToast(message, 'success');
}

async function renderCommittedSpaceDeletionState() {
  try {
    dormantSpaceView = [];
    dormantSpaceViewSpaceId = '';
    lastRenderedGroupsSignature = '';
    lastRenderedSpacesSignature = '';
    await loadDormantSpaceView(state.activeSpaceId, { force: true });
    render();
    renderSettings();
  } catch {
    // The committed-error message remains truthful even if this best-effort
    // local render is the failing post-commit step.
  }
}

async function newTabInActiveSpace(options = {}) {
  const windowBinding = options.windowBinding || capturePanelWindowBinding();
  const staleMessage = 'This panel moved to another Chrome window before the new tab could open.';
  if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false || !isCurrentPanelWindowBinding(windowBinding)) {
      throw new Error(staleMessage);
    }
    const checkpoint = captureWorkspaceMemoryCheckpoint();
    const createdTabIds = [];
    let storageMayBeDirty = false;
    try {
      await withCreatedTabCheckpointRollback(createdTabIds, async () => {
        if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
        const created = await send('tabs:create', { url: 'chrome://newtab', active: true }, {
          windowBinding,
        });
        const tabId = Number(created.tab?.id);
        // Register the physical side effect before checking the epoch. Chrome
        // may have created the tab in A while its response was pending and the
        // Workbench moved to B; rollback must still know exactly what to close.
        if (Number.isSafeInteger(tabId)) createdTabIds.push(tabId);
        if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
        if (!Number.isSafeInteger(tabId)) {
          throw new Error('Chrome did not return the new tab it created.');
        }
        state.tabSpaces[tabId] = state.activeSpaceId;
        // Set this before awaiting: persistStoragePair can partially write and
        // then fail while compensating its own first write.
        storageMayBeDirty = true;
        // A false return means the exact A storage pair committed before the
        // host epoch changed. That is a successful durable commit, not a reason
        // to close the wanted tab or restore the pre-gesture checkpoint.
        await saveState({ windowBinding });
      }, { windowBinding });
    } catch (error) {
      await rollbackWindowBoundCreatedTabMutation(checkpoint, {
        error,
        stateMayHaveBeenPersisted: storageMayBeDirty,
        windowBinding,
      });
      throw error;
    }

    try {
      await closeEphemeralTabs({
        windowBinding,
        allowStaleWindowBinding: true,
      });
      if (!isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error(
          'The new tab opened and was saved in the previous window. Temporary-tab cleanup finished, but this Workbench moved before it could refresh.',
        );
      }
      await refreshTabs({ windowBinding });
    } catch (error) {
      if (/opened and was saved/.test(String(error?.message || ''))) throw error;
      throw new Error(
        `The new tab opened and was saved, but temporary-tab cleanup or the panel refresh could not finish: ${error?.message || String(error)}`,
        { cause: error },
      );
    }
  });
}

async function clearUngroupedTabs(group, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const current = spaceView.find((item) => item.key === 'ungrouped');
      if (!current) throw new Error('The ungrouped tabs changed in another Space Tabs view. Try again.');
      return clearUngroupedTabs(current, { stateLocked: true, windowBinding });
    }, { windowBinding });
  }
  const clearable = clearableUngroupedTabs(group.tabs, {
    fileSchemeAccess: fileSchemeAccessAllowed,
  });
  const closable = clearable.filter((tab) => !tab.dormant);
  const dormantClosable = clearable.filter((tab) => tab.dormant);
  if (closable.length === 0 && dormantClosable.length === 0) return;

  const closingIds = new Set(closable.map((tab) => tab.id));
  const remainingSpaceTabs = tabs.filter((tab) => (
    tabBelongsToSpace(tab, state.activeSpaceId) && !closingIds.has(tab.id)
  ));

  let checkpointState;
  const checkpointCreatedTabIds = [];
  const checkpointCreatedTabs = [];
  const reviewedTargets = new Map();
  const targetSpaceId = state.activeSpaceId;
  const result = await runGuardedDestructiveTabClose({
    tabIds: closable.map((tab) => tab.id),
    checkpoint: async () => {
      const beforeCheckpointState = structuredClone(state);
      let storageMayBeDirty = false;
      try {
        await withCreatedTabCheckpointRollback(checkpointCreatedTabIds, async () => {
          if (!isCurrentPanelWindowBinding(windowBinding)) {
            throw new Error('This panel moved to another Chrome window before tabs could be cleared.');
          }
          if (remainingSpaceTabs.length === 0) {
            const created = await send('tabs:create', {
              url: 'chrome://newtab',
              active: false,
            }, { windowBinding });
            const tabId = Number(created.tab?.id);
            if (Number.isSafeInteger(tabId)) {
              checkpointCreatedTabIds.push(tabId);
              checkpointCreatedTabs.push({ ...created.tab });
              state.tabSpaces[tabId] = state.activeSpaceId;
            }
          }
          snapshotOpenSpace(state.activeSpaceId);
          for (const tab of closable) {
            const target = captureReviewedTabCloseTarget(tab, targetSpaceId, 'ungrouped');
            reviewedTargets.set(Number(target.tab.id), target);
          }
          storageMayBeDirty = true;
          const saved = await saveState({ persistWindowState: false, windowBinding });
          if (saved === false || !isCurrentPanelWindowBinding(windowBinding)) {
            throw new Error('This panel moved to another Chrome window before tabs could be cleared.');
          }
          checkpointState = structuredClone(state);
        }, { windowBinding });
      } catch (error) {
        state = beforeCheckpointState;
        if (storageMayBeDirty) await saveState({ persistWindowState: false });
        throw error;
      }
    },
    inspectTab: (tabId, transaction) => {
      if (!isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error(transaction.closedTabIds.length === 0
          ? 'This panel moved to another Chrome window before tabs could be cleared.'
          : 'This panel moved while tabs were being cleared. Already closed tabs were saved; no additional tabs were closed.');
      }
      return liveReviewedTabCloseMismatch(reviewedTargets.get(Number(tabId)), { windowBinding });
    },
    closeTab: (tabId) => guardedReviewedTabClose(
      reviewedTargets.get(Number(tabId)),
      { windowBinding },
    ),
    commit: async ({ closedTabIds }) => {
      const allowStaleWindowBinding = !isCurrentPanelWindowBinding(windowBinding);
      await syncStateFromStorage({ windowBinding, allowStaleWindowBinding });
      await loadTabs({
        adopt: false,
        skipSnapshotCleanupForTabIds: closedTabIds,
        windowBinding,
        allowStaleWindowBinding,
      });
      await closeUnneededDestructiveKeepalives({
        createdTabs: checkpointCreatedTabs,
        targetSpaceId,
        closedTabIds,
        windowBinding,
        allowStaleWindowBinding,
      });
      if (checkpointCreatedTabs.length > 0) {
        await loadTabs({
          adopt: false,
          skipSnapshotCleanupForTabIds: closedTabIds,
          windowBinding,
          allowStaleWindowBinding,
        });
      }
      snapshotOpenSpace(targetSpaceId);
      for (const tabId of closedTabIds) {
        forgetClosedTabMetadata(closable.find((tab) => Number(tab.id) === Number(tabId)));
      }
      const closedIds = new Set(closedTabIds.map(Number));
      removeTabsFromSpaceSnapshot(targetSpaceId, [
        ...dormantClosable,
        ...closable.filter((tab) => closedIds.has(Number(tab.id))),
      ]);
      await saveState({ persistWindowState: false });
    },
    reconcile: async ({ closedTabIds }) => {
      state = structuredClone(checkpointState);
      for (const tabId of closedTabIds) {
        forgetClosedTabMetadata(closable.find((tab) => Number(tab.id) === Number(tabId)));
      }
      await saveState({ persistWindowState: false });
      if (isCurrentPanelWindowBinding(windowBinding)) {
        await refreshTabs({
          reloadDormant: true,
          skipSnapshotCleanupForTabIds: closedTabIds,
          windowBinding,
        });
      }
    },
  });
  await refreshTabs({
    reloadDormant: dormantClosable.length > 0,
    windowBinding,
  });
  const clearedCount = result.closedTabIds.length + dormantClosable.length;
  const skippedCount = result.skippedTabs.length;
  const message = destructiveClearStatus(clearedCount, skippedCount);
  setStatus(message);
  if (skippedCount > 0) showStatusToast(message, 'info');
}

function captureReviewedTabCloseTarget(tab, targetSpaceId, targetGroupKey) {
  const tabId = Number(tab?.id);
  const binding = Number.isSafeInteger(tabId) ? state.tabLifecycle?.[tabId] : null;
  return {
    tab: {
      ...tab,
      ...(binding?.snapshotTabId ? { snapshotTabId: binding.snapshotTabId } : {}),
      ...(binding?.sessionId ? { sessionId: binding.sessionId } : {}),
    },
    targetSpaceId: String(targetSpaceId || ''),
    targetGroupKey: String(targetGroupKey || ''),
  };
}

async function liveReviewedTabCloseMismatch(target, options = {}) {
  if (!target?.tab) return 'missing-or-replaced';
  const [inventory, stored] = await Promise.all([
    send('tabs:listAll', {}, {
      windowBinding: options.windowBinding,
      allowStaleWindowBinding: options.allowStaleWindowBinding === true,
    }),
    storageGet(),
  ]);
  const currentState = mergeStoredState(
    stored[STORAGE_KEY],
    createDefaultState(localConfig),
  );
  return reviewedTabCloseCandidateMismatch({
    expectedTab: target.tab,
    currentTabs: inventory.tabs || [],
    state: currentState,
    targetSpaceId: target.targetSpaceId,
    targetGroupKey: target.targetGroupKey,
  });
}

function guardedReviewedTabClose(target, options = {}) {
  if (!target?.tab) return Promise.resolve({ skipped: true, reason: 'missing-or-replaced' });
  return send('tabs:close', {
    tabId: target.tab.id,
    closeGuard: tabCloseGuardFor(target.tab),
    skipChanged: true,
    ...(Number.isSafeInteger(Number(options.requiredActiveSurvivorTabId))
      ? { requiredActiveSurvivorTabId: Number(options.requiredActiveSurvivorTabId) }
      : {}),
    ...(Array.isArray(options.requiredTargetTabGuards)
      ? { requiredTargetTabGuards: options.requiredTargetTabGuards }
      : {}),
  }, {
    windowBinding: options.windowBinding,
    allowStaleWindowBinding: options.allowStaleWindowBinding,
  });
}

async function closeUnneededDestructiveKeepalives({
  createdTabs = [],
  targetSpaceId = '',
  closedTabIds = [],
  windowBinding = null,
  allowStaleWindowBinding = false,
} = {}) {
  if (createdTabs.length === 0) return [];
  const createdIds = new Set(createdTabs.map((tab) => Number(tab?.id)).filter(Number.isSafeInteger));
  const hasNaturalSurvivor = tabs.some((tab) => (
    !createdIds.has(Number(tab.id)) &&
    !isEphemeralTab(tab) &&
    tabBelongsToSpace(tab, targetSpaceId)
  ));
  if (!hasNaturalSurvivor) return [];

  const removedIds = [];
  for (const expectedTab of createdTabs) {
    const tabId = Number(expectedTab?.id);
    if (!Number.isSafeInteger(tabId)) continue;
    const current = tabs.find((tab) => Number(tab.id) === tabId);
    if (!current) {
      forgetClosedTabMetadata(expectedTab);
      removedIds.push(tabId);
      continue;
    }
    const response = await send('tabs:close', {
      tabId,
      preserveSnapshot: false,
      closeGuard: tabCloseGuardFor(expectedTab),
      skipChanged: true,
    }, { windowBinding, allowStaleWindowBinding });
    if (response.skipped) continue;
    forgetClosedTabMetadata(expectedTab);
    removedIds.push(tabId);
  }
  if (removedIds.length > 0) {
    await loadTabs({
      adopt: false,
      skipSnapshotCleanupForTabIds: [...closedTabIds, ...removedIds],
      windowBinding,
      allowStaleWindowBinding,
    });
  }
  return removedIds;
}

function destructiveClearStatus(clearedCount, skippedCount) {
  const cleared = `Cleared ${formatCount(clearedCount, 'temporary tab')}.`;
  if (skippedCount <= 0) return cleared;
  return `${cleared} Skipped ${formatCount(skippedCount, 'tab')} that changed after review.`;
}

function destructiveGroupDeletionStatus(title, result = {}) {
  const cleanTitle = String(title || 'Group');
  const deletedCount = Number(result.deletedTabCount) || 0;
  const skippedCount = Number(result.skippedTabCount) || 0;
  const remainingGroups = Number(result.remainingTargetGroups) || 0;
  const unresolvedSavedGroups = Number(result.unresolvedSavedGroupCount) || 0;
  const skipped = skippedCount > 0
    ? ` Skipped ${formatCount(skippedCount, 'tab')} that changed after review.`
    : '';
  const unresolved = unresolvedSavedGroups > 0
    ? ` ${formatCount(unresolvedSavedGroups, 'saved group')} could not be removed from saved state; reopen the Space and delete again.`
    : '';
  if (remainingGroups > 0) {
    return `Deleted ${formatCount(deletedCount, 'tab')} from "${cleanTitle}", but the group remains.${skipped}${unresolved}`;
  }
  return `Deleted group "${cleanTitle}" and ${formatCount(deletedCount, 'tab')}.${skipped}${unresolved}`;
}

function handleTabClick(event, tab) {
  if (isForeignWindowTab(tab)) {
    event.preventDefault();
    runTask((windowBinding) => focusForeignWindowTab(tab, { windowBinding }));
    return;
  }
  if (tab.dormant) {
    event.preventDefault();
    const windowBinding = capturePanelWindowBinding();
    runTask(() => openDormantTab(tab, tab.dormantGroupKey, { windowBinding }));
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
  runTask((windowBinding) => focusTab(tab, { windowBinding }));
}

async function focusForeignWindowTab(tab, options = {}) {
  const windowBinding = options.windowBinding;
  const tabId = Number(tab?.foreignWindowTabId);
  if (!Number.isFinite(tabId)) return;
  const response = await send('tabs:focus', { tabId }, { windowBinding });
  if (!response.tab) {
    await withSharedStateLock(async () => {
      const synchronized = await syncStateFromStorage({ windowBinding });
      if (synchronized !== false) {
        await refreshTabs({ adopt: false, reloadDormant: true, windowBinding });
      }
    });
    throw new Error('That tab is no longer open. The Space view was refreshed.');
  }
  if (response.focusConfirmed === false) {
    const message = 'Selected the tab in its other window, but Chrome could not confirm that the window came to the front.';
    setStatus(message);
    if (workbenchMode) showStatusToast(message, 'info');
    return;
  }
  setStatus('Focused the tab in its other window.');
}

async function focusTab(tab, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => focusTab(currentTabForMutation(tab), {
      stateLocked: true,
      windowBinding,
    }), { windowBinding });
  }
  await send('tabs:focus', { tabId: tab.id }, { windowBinding });
  await refreshTabs({ windowBinding });
}

async function renameTab(tab, options = {}) {
  const windowBinding = options.windowBinding;
  if (tab?.pinned) {
    setStatus('Pinned tabs use their Chrome page title and cannot be renamed in the panel.');
    return;
  }
  const reviewedTargetFingerprint = renameTargetReviewFingerprint('tab', tab, {
    renamedTabs: state.renamedTabs,
  });
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
    if (current.pinned) {
      setStatus('This tab was pinned, so its panel name was not changed.');
      return;
    }
    if (!reviewedRenameTargetIsCurrent(
      reviewedTargetFingerprint,
      'tab',
      current,
      { renamedTabs: state.renamedTabs },
    )) {
      throw new Error('This tab\'s panel name changed while the Rename Tab dialog was open. Nothing was changed. Review its current name and try again.');
    }
    const beforeRename = captureWorkspaceMemoryCheckpoint();
    const transaction = await runDurableCommitBoundary({
      mutate: () => {
        setLiveTabPanelTitle(state, current.id, clean);
        return captureWorkspaceMemoryCheckpoint();
      },
      commit: async () => {
        const saved = await saveState({ persistWindowState: false, windowBinding });
        if (saved !== true) {
          throw new Error('This panel moved to another Chrome window before the Tab rename could be saved.');
        }
      },
      rollbackBeforeCommit: () => (
        restoreWorkspaceMemoryCheckpoint(beforeRename, { renderView: true })
      ),
      afterCommit: async () => {
        const refreshed = await refreshTabs({ windowBinding });
        if (refreshed !== true) {
          throw new Error('This panel moved to another Chrome window after the Tab rename was saved.');
        }
      },
      restoreCommittedMemory: (committed) => (
        restoreWorkspaceMemoryCheckpoint(committed, { renderView: true })
      ),
    });
    if (transaction.postCommitError) {
      const message = 'The Tab rename was saved, but this view could not refresh. Reopen Space Tabs to see the saved name.';
      setStatus(message);
      if (workbenchMode) showStatusToast(message, 'error');
      console.error(transaction.recoveryError || transaction.postCommitError);
    }
  }, { windowBinding });
}

async function duplicateTab(tab, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => duplicateTab(currentTabForMutation(tab), {
      stateLocked: true,
      windowBinding,
    }), { windowBinding });
  }
  const sourceGroup = groupForTab(tab);
  const beforeCheckpointState = structuredClone(state);
  const activeTabIdBeforeDuplicate = await currentActiveBrowserTabId({ windowBinding });
  const createdTabIds = [];
  let duplicated;
  let sourceMissing = false;
  try {
    await withCreatedTabCheckpointRollback(createdTabIds, async () => {
      const result = await send('tabs:duplicate', { tabId: tab.id }, { windowBinding });
      sourceMissing = result.missing === true;
      duplicated = result.tab;
      if (!duplicated?.id) return;
      createdTabIds.push(Number(duplicated.id));

      if (isGroupedTab(tab)) {
        if (Number(duplicated.groupId) !== Number(tab.groupId)) {
          const restoredGroupId = await addTabsToChromeGroup(
            tab.groupId,
            [duplicated.id],
            state.activeSpaceId,
            { windowBinding },
          );
          if (restoredGroupId === null) {
            throw new Error('Chrome could not keep the duplicated tab in its original group.');
          }
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
      await saveState({ persistWindowState: false });
    }, { windowBinding });
  } catch (error) {
    state = beforeCheckpointState;
    if (duplicated?.id && Number.isSafeInteger(activeTabIdBeforeDuplicate)) {
      // chrome.tabs.duplicate activates the new tab. If its checkpoint fails,
      // closing the compensated tab otherwise leaves the user on a neighbour
      // instead of the page they were viewing before the attempted action.
      await send('tabs:focus', { tabId: activeTabIdBeforeDuplicate }, {
        windowBinding,
        allowStaleWindowBinding: true,
      }).catch(() => null);
    }
    throw error;
  }
  if (!duplicated?.id) {
    if (sourceMissing) {
      await refreshTabs({ reloadDormant: true, windowBinding });
      throw new Error('That tab is no longer open. The Space view was refreshed.');
    }
    setStatus('Could not duplicate tab.');
    return;
  }

  try {
    if (!isCurrentPanelWindowBinding(windowBinding)) return;
    await refreshTabs({ windowBinding });
  } catch (error) {
    const detail = error?.message || String(error);
    const message = `Duplicated tab, but the panel could not refresh yet: ${detail}`;
    setStatus(message);
    showStatusToast(message, 'error');
    return;
  }
  const message = 'Duplicated tab.';
  setStatus(message);
  showStatusToast(message, 'success');
}

async function currentActiveBrowserTabId(options = {}) {
  const targetWindowId = options.windowBinding?.windowId ?? panelWindowId;
  if (extensionRuntime && chrome.tabs?.query && Number.isFinite(targetWindowId)) {
    const activeTabs = await chrome.tabs.query({
      active: true,
      windowId: targetWindowId,
    });
    return Number(activeTabs[0]?.id);
  }
  return Number(tabs.find((item) => item.active)?.id);
}

async function renameGroup(group, options = {}) {
  const windowBinding = options.windowBinding;
  const nextName = await askText({
    title: 'Rename Group',
    label: 'Group title',
    value: Object.hasOwn(group, 'title') ? String(group.title ?? '') : 'Group',
    confirmText: 'Save',
  });
  if (nextName === null) return;
  const clean = nextName.trim();

  await withFreshSpaceStateMutation(async () => {
    const rollback = captureChromeGroupMutationRollback();
    await runChromeGroupMutationTransaction({
      apply: async () => {
        const current = currentGroupForMutation(group);
        assertGroupActionsAreLocal([current]);
        if (current.dormant) {
          renameDormantSnapshotGroup(current, clean);
        } else if (current.id === 'ungrouped') {
          const tabIds = current.tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
          if (tabIds.length === 0) return;
          rollback.membership = captureTabGroupMembership(tabs, [current], tabIds);
          const groupId = await createChromeGroup(tabIds, {
            title: clean,
            color: nextGroupColor(),
            windowBinding,
          });
          if (groupId === null) throw new Error('Chrome could not create the renamed group.');
        } else if (isVirtualGroupKey(current.key)) {
          retitleActiveSpaceSnapshotGroup(current, clean);
          state.virtualGroups[current.key] = {
            ...(state.virtualGroups[current.key] || {}),
            id: current.key,
            title: clean,
            color: current.color || state.virtualGroups[current.key]?.color || 'blue',
            spaceId: state.activeSpaceId,
          };
        } else {
          rememberChromeGroupTitleRollback(rollback, current);
          const result = await send('groups:update', {
            groupId: current.id,
            update: { title: clean },
          }, { windowBinding });
          if (!result.group) throw new Error('This Chrome group no longer exists.');
          logicalChromeGroupTitles.set(
            Number(current.id),
            clean === '' ? '' : normalizeGroupTitle(clean, 'Group'),
          );
          retitleActiveSpaceSnapshotGroup(current, clean);
          bindChromeGroup(current.id, state.activeSpaceId);
        }
      },
      checkpoint: () => saveState({ persistWindowState: false }),
      rollback: () => restoreChromeGroupMutationAfterFailure(rollback, { windowBinding }),
    });
    await refreshTabs({ windowBinding });
  }, { windowBinding });
}

async function renameFolderGroup(folderContext, options = {}) {
  const windowBinding = options.windowBinding;
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
    assertGroupActionsAreLocal(currentGroups);
    const rollback = captureChromeGroupMutationRollback();
    await runChromeGroupMutationTransaction({
      apply: async () => {
        const replacements = new Map();
        const visibleKeys = spaceView.map((group) => group.key);
        for (const group of currentGroups) {
          rememberChromeGroupTitleRollback(rollback, group);
          const title = renamedFolderGroupTitle(group, sourcePath, clean);
          const nextKey = await retitleGroupWithoutSaving(group, title, { windowBinding });
          if (nextKey) replacements.set(group.key, nextKey);
        }
        replaceGroupOrderKeys(replacements, visibleKeys);
      },
      checkpoint: () => saveState({ persistWindowState: false }),
      rollback: () => restoreChromeGroupMutationAfterFailure(rollback, { windowBinding }),
    });
    await refreshTabs({ windowBinding });
    setStatus(`Renamed group "${currentName}" to "${clean}".`);
  }, { windowBinding });
}

async function groupSelectedTabs(tabIds, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => groupSelectedTabs(tabIds, {
      stateLocked: true,
      windowBinding,
    }), { windowBinding });
  }
  const requestedIds = uniqueNumberIds(tabIds);
  if (requestedIds.length === 0) {
    setStatus('Select a tab to group.');
    return;
  }

  const loaded = await loadTabs({ adopt: true, windowBinding });
  if (loaded === false) return false;
  const selection = resolveFreshTabSelection({
    requestedTabIds: requestedIds,
    tabs,
    isEligible: (tab) => tabBelongsToSpace(tab, state.activeSpaceId) && !tab.pinned,
  });
  if (selection.status !== 'ready') {
    throw new Error(
      'The selected tabs changed before they could be grouped. Review the current selection and try again; nothing was grouped.',
    );
  }
  const selectedTabs = selection.selectedTabs;

  const rollback = captureChromeGroupMutationRollback();
  rollback.membership = captureTabGroupMembership(
    tabs,
    buildSpaceViewForSpace(state.activeSpaceId),
    selectedTabs.map((tab) => tab.id),
  );
  await runChromeGroupMutationTransaction({
    apply: async () => {
      const groupId = await createChromeGroup(selectedTabs.map((tab) => tab.id), {
        title: selectedGroupTitle(selectedTabs),
        color: nextGroupColor(),
        windowBinding,
      });
      if (groupId === null) throw new Error('Chrome could not group the selected tabs.');
      rememberCreatedGroupTabOrder(groupId, selectedTabs);
      selectedTabIds = new Set(selectedTabs.map((tab) => tab.id));
      selectionAnchorTabId = selectedTabs.at(-1)?.id ?? null;
      return groupId;
    },
    checkpoint: () => saveState({ persistWindowState: false }),
    rollback: () => restoreChromeGroupMutationAfterFailure(rollback, { windowBinding }),
  });
  await refreshTabs({ windowBinding });
  setStatus(`Grouped ${selectedTabs.length === 1 ? '1 tab' : `${selectedTabs.length} selected tabs`}.`);
}

async function closeTab(tab, groupKey = '', options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const current = currentTabForMutation(tab);
      return closeTab(current, groupForTab(current)?.key || '', {
        stateLocked: true,
        windowBinding,
      });
    }, { windowBinding });
  }
  if (tab?.pinned) {
    setStatus('Unpin this tab in Chrome before closing it from Space Tabs.');
    return;
  }
  const sourceGroup = groupForTab(tab) || (
    groupKey ? spaceView.find((group) => group.key === groupKey) : null
  );
  const beforeCloseState = structuredClone(state);
  await runDestructiveTabClose({
    tabIds: [tab.id],
    checkpoint: async () => {
      if (!isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error('This panel moved to another Chrome window before the tab could close.');
      }
      try {
        removeClosedTabFromSnapshot(tab, sourceGroup);
        removeTabFromSavedOrder(tab.id);
        delete state.tabSpaces[tab.id];
        delete state.renamedTabs[tab.id];
        delete state.tabGroups?.[tab.id];
        delete state.tabLifecycle?.[tab.id];
        forgetEphemeralTab(tab.id);
        await saveState({ persistWindowState: false });
      } catch (error) {
        state = beforeCloseState;
        throw error;
      }
    },
    closeTab: (tabId) => send('tabs:close', { tabId }, { windowBinding }),
    commit: async () => {},
    reconcile: async ({ closedTabIds }) => {
      if (closedTabIds.includes(Number(tab.id))) return;
      state = beforeCloseState;
      await saveState({ persistWindowState: false });
      if (isCurrentPanelWindowBinding(windowBinding)) {
        await refreshTabs({ reloadDormant: true, windowBinding });
      }
    },
  });
  await refreshTabs({
    reloadDormant: true,
    skipSnapshotCleanupForTabIds: [tab.id],
    windowBinding,
  });
}

async function removeDormantTab(tab, groupKey = '', options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const currentGroup = dormantGroupForTabReference(tab, groupKey);
      const currentTab = dormantTabForMutation(currentGroup, tab);
      if (!currentGroup || !currentTab) {
        throw new Error('This saved tab changed in another Space Tabs view. Try the action again.');
      }
      return removeDormantTab(currentTab, currentGroup.key, {
        stateLocked: true,
        windowBinding,
      });
    }, { windowBinding });
  }
  const dormantGroup = dormantGroupForTabReference(tab, groupKey);
  const checkpoint = captureWorkspaceMemoryCheckpoint();
  try {
    removeOpenedDormantTabFromSnapshot(tab, dormantGroup);
    await persistDormantSnapshotMutation({
      windowBinding,
      staleMessage: 'This panel moved to another Chrome window before the saved tab could be removed.',
    });
  } catch (error) {
    restoreWorkspaceMemoryCheckpoint(checkpoint);
    throw error;
  }
  await refreshTabs({ reloadDormant: true, windowBinding });
  setStatus('Removed saved tab.');
}

async function updateSavedTabUrl(tab, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => updateSavedTabUrl(currentTabForMutation(tab), {
      stateLocked: true,
      windowBinding,
    }), { windowBinding });
  }
  if (tab?.dormant) return;
  const sourceGroup = groupForTab(tab);
  if (!sourceGroup) throw new Error('This tab changed before its saved URL could be updated. Try again.');

  const url = String(tab?.url || '').trim();
  if (!isRestorableSnapshotTab({ url })) {
    throw new Error('Only http, https, or file pages can replace a saved URL. The original saved page was kept.');
  }

  const lifecycleBinding = state.tabLifecycle?.[tab.id];
  const opened = recentlyOpenedDormantRecordForLiveTab({
    ...tab,
    snapshotTabId: tab.snapshotTabId || lifecycleBinding?.snapshotTabId,
    snapshotGroupId: tab.snapshotGroupId || lifecycleBinding?.snapshotGroupId,
  }, sourceGroup);
  const groupTitle = opened?.groupTitle || sourceGroup.title || sourceGroup.displayTitle || 'Group';
  const snapshot = activeSpaceSnapshot() || {
    version: 1,
    updatedAt: Date.now(),
    groups: [],
  };
  const savedRowMatch = resolveSnapshotTabRemovalMatch(snapshot, {
    snapshotTabId: tab.snapshotTabId || lifecycleBinding?.snapshotTabId,
    urlIdentities: [opened?.url || url],
    groupKey: chromeGroupTitleKey(groupTitle),
  }, { requireGroup: true });
  if (!savedRowMatch) {
    throw new Error(
      'The saved tab could not be identified uniquely. The original saved page was kept.',
    );
  }
  const savedRow = savedRowMatch.tab;
  const savedGroup = savedRowMatch.group;
  const nextSnapshot = updateSnapshotTab(snapshot, {
    groupTitle: savedGroup.title,
    groupColor: savedGroup.color,
    snapshotTabId: savedRow.snapshotTabId,
    url: savedRow.url,
  }, {
    title: tab.title || url,
    url,
    snapshotTabId: savedRow.snapshotTabId,
    panelTitle: cleanPanelName(tab.panelTitle || lifecycleBinding?.panelTitle),
  }, { requireExisting: true });

  if (!nextSnapshot || snapshotTabCount(nextSnapshot) === 0) return;
  const checkpoint = captureWorkspaceMemoryCheckpoint();
  try {
    if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') state.spaceSnapshots = {};
    state.spaceSnapshots[state.activeSpaceId] = {
      ...nextSnapshot,
      updatedAt: Date.now(),
    };
    if (lifecycleBinding) {
      state.tabLifecycle[tab.id] = {
        ...lifecycleBinding,
        snapshotTabId: savedRow.snapshotTabId || lifecycleBinding.snapshotTabId,
        url,
        title: tab.title || url,
        panelTitle: cleanPanelName(tab.panelTitle || lifecycleBinding.panelTitle),
        trackingMode: 'live',
      };
    }
    dormantSpaceViewSpaceId = '';
    lastRenderedGroupsSignature = '';
    await saveState({ persistWindowState: false, windowBinding });
  } catch (error) {
    restoreWorkspaceMemoryCheckpoint(checkpoint);
    throw error;
  }
  forgetRecentlyOpenedDormantTab(tab.id);
  await refreshTabs({ reloadDormant: true, windowBinding });
  setStatus('Updated saved URL.');
  if (workbenchMode) showStatusToast('Updated saved URL.', 'success');
}

async function moveTabToSpace(tab, spaceId, options = {}) {
  const moved = await moveTabsToSpace([tab?.id], spaceId, options);
  if (moved > 0) reportMoveSuccess(`Moved tab to ${spaceName(spaceId)}.`);
}

async function moveSelectedTabsToSpace(tabIds, spaceId, options = {}) {
  const moved = await moveTabsToSpace(tabIds, spaceId, options);
  if (moved > 0) reportMoveSuccess(`Moved ${moved} selected tabs to ${spaceName(spaceId)}.`);
}

function reportMoveSuccess(message) {
  setStatus(message);
  showStatusToast(message, 'success');
}

async function moveTabsToSpace(tabIds, spaceId, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => moveTabsToSpace(tabIds, spaceId, {
      stateLocked: true,
      windowBinding,
    }), { windowBinding });
  }
  if (!state.spaces.some((space) => space.id === spaceId)) {
    throw new Error('The destination Space no longer exists. Choose another Space and try again.');
  }
  const sourceSpaceId = state.activeSpaceId;
  if (!sourceSpaceId || sourceSpaceId === spaceId) return 0;
  const ids = uniqueNumberIds(tabIds);
  if (ids.length === 0) return 0;

  const loaded = await loadTabs({ adopt: true, windowBinding });
  if (loaded === false) return 0;
  const sourceView = buildSpaceViewForSpace(sourceSpaceId);
  const selection = resolveFreshTabSelection({
    requestedTabIds: ids,
    tabs,
    isEligible: (tab) => (
      !tab.pinned &&
      !isEphemeralTab(tab) &&
      tabBelongsToSpace(tab, sourceSpaceId)
    ),
  });
  if (selection.status !== 'ready') {
    throw new Error(
      'The selected tabs changed before they could be moved. Review the current selection and try again; nothing was moved.',
    );
  }
  const movedTabs = [...selection.selectedTabs]
    .sort((left, right) => Number(left.index) - Number(right.index));

  const rollback = captureChromeGroupMutationRollback();
  rollback.membership = captureTabGroupMembership(
    tabs,
    sourceView,
    movedTabs.map((tab) => tab.id),
  );
  await runChromeGroupMutationTransaction({
    apply: async () => {
      // Make every restorable live tab's durable row explicit inside the
      // rollback boundary and before the first browser mutation. The move
      // checkpoint must remain complete if opening the destination fails or
      // the side panel is destroyed afterward.
      snapshotOpenSpace(sourceSpaceId);
      const moves = movedTabs.map((tab) => ({
        tab,
        targetGroupKey: ensureMovedTabTargetGroup(tab, groupForTab(tab, sourceView), spaceId),
      })).map((move) => ({
        ...move,
        targetGroup: ensureMovedTabTargetSnapshotGroup(move.targetGroupKey, spaceId),
      }));
      assertMovedTabsReadyForCheckpoint(moves, sourceSpaceId);
      const groupedTabIds = moves
        .filter(({ tab }) => isGroupedTab(tab))
        .map(({ tab }) => tab.id);
      if (groupedTabIds.length > 0) {
        const ungrouped = await send('tabs:ungroup', { tabIds: groupedTabIds }, { windowBinding });
        if (ungrouped.missing) {
          throw new Error('A selected tab closed before it could be moved. No Space change was saved.');
        }
      }
      await assertTabsStillMatchSpaceMove(movedTabs, { windowBinding });

      for (const { tab, targetGroupKey, targetGroup } of moves) {
        const existingBinding = state.tabLifecycle?.[tab.id];
        if (existingBinding && !isRestorableSnapshotTab(tab) && existingBinding.provisional !== true &&
          snapshotTabIdentityCount(sourceSpaceId, existingBinding.snapshotTabId) === 0) {
          state.tabLifecycle[tab.id] = { ...existingBinding, provisional: true };
        }
        if (state.tabLifecycle?.[tab.id]) {
          state = reduceTabLifecycleEvent({
            state,
            event: {
              type: 'updated',
              tabId: tab.id,
              changeInfo: {
                groupId: -1,
                url: tab.url,
                title: tab.title || tab.url,
              },
              targetGroup,
            },
            now: Date.now(),
          });
        }
        state.tabSpaces[tab.id] = spaceId;
        state.tabGroups[tab.id] = targetGroupKey;
        removeTabFromSavedOrder(tab.id, sourceSpaceId);
        const targetOrder = ensureTabOrderForSpace(spaceId);
        targetOrder[targetGroupKey] = uniqueKeys([...(targetOrder[targetGroupKey] || []), tab.id]);
      }

      assertMovedTabsCheckpointComplete(moves, sourceSpaceId, spaceId);
      selectedTabIds = new Set(movedTabs.map((tab) => tab.id));
      selectionAnchorTabId = movedTabs.at(-1)?.id ?? null;
    },
    checkpoint: () => saveState({ persistWindowState: false }),
    rollback: () => restoreChromeGroupMutationAfterFailure(rollback, { windowBinding }),
  });
  try {
    await finishMoveToSpace(spaceId, {
      stateLocked: true,
      windowBinding,
    });
  } catch (error) {
    throw committedMoveActivationError(movedTabs.length === 1 ? 'Tab' : 'Tabs', spaceId, error);
  }
  return movedTabs.length;
}

async function assertTabsStillMatchSpaceMove(expectedTabs, options = {}) {
  const response = await send('tabs:listAll', {}, { windowBinding: options.windowBinding });
  const currentById = new Map((response.tabs || []).map((tab) => [Number(tab.id), tab]));
  for (const expected of expectedTabs) {
    const current = currentById.get(Number(expected.id));
    const currentUrl = String(current?.pendingUrl || current?.url || '');
    const expectedUrl = String(expected?.pendingUrl || expected?.url || '');
    if (
      !current ||
      currentUrl !== expectedUrl ||
      Number(current.windowId) !== Number(expected.windowId) ||
      current.pinned ||
      isGroupedTab(current)
    ) {
      throw new Error('A selected tab closed, changed, or moved in Chrome. No Space change was saved.');
    }
  }
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

function ensureMovedTabTargetSnapshotGroup(targetGroupKey, spaceId) {
  const virtualGroup = state.virtualGroups?.[targetGroupKey];
  if (!virtualGroup || virtualGroup.spaceId !== spaceId) {
    throw new Error('The destination Tag changed before the tab could be moved. Try again.');
  }
  let snapshotGroupId = validSnapshotLifecycleId(virtualGroup.snapshotGroupId);
  if (!snapshotGroupId) {
    const targetSnapshot = sanitizeSpaceSnapshot(state.spaceSnapshots?.[spaceId], {
      preserveDuplicateUrls: true,
    });
    const matchingGroups = (targetSnapshot?.groups || []).filter((group) => (
      group.title === virtualGroup.title &&
      (group.color || 'grey') === (virtualGroup.color || 'grey') &&
      validSnapshotLifecycleId(group.snapshotGroupId)
    ));
    snapshotGroupId = matchingGroups.length === 1
      ? validSnapshotLifecycleId(matchingGroups[0].snapshotGroupId)
      : createSnapshotLifecycleId('group');
    state.virtualGroups[targetGroupKey] = { ...virtualGroup, snapshotGroupId };
  }
  return {
    spaceId,
    snapshotGroupId,
    title: virtualGroup.title || 'Tabs',
    color: virtualGroup.color || 'blue',
    collapsed: Boolean(virtualGroup.collapsed),
  };
}

function validSnapshotLifecycleId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)
    ? id
    : '';
}

function assertMovedTabsReadyForCheckpoint(moves, sourceSpaceId) {
  for (const { tab } of moves) {
    if (!isRestorableSnapshotTab(tab)) continue;
    const binding = state.tabLifecycle?.[tab.id];
    if (
      !binding ||
      binding.spaceId !== sourceSpaceId ||
      !validSnapshotLifecycleId(binding.snapshotTabId) ||
      snapshotTabIdentityCount(sourceSpaceId, binding.snapshotTabId) !== 1
    ) {
      throw new Error('The saved tab changed before it could be moved. Refresh the Space and try again.');
    }
  }
}

function assertMovedTabsCheckpointComplete(moves, sourceSpaceId, targetSpaceId) {
  for (const { tab, targetGroupKey, targetGroup } of moves) {
    if (
      state.tabSpaces?.[tab.id] !== targetSpaceId ||
      state.tabGroups?.[tab.id] !== targetGroupKey
    ) {
      throw new Error('The tab move could not be saved completely.');
    }
    const binding = state.tabLifecycle?.[tab.id];
    if (!isRestorableSnapshotTab(tab)) {
      if (binding && (
        binding.spaceId !== targetSpaceId ||
        binding.snapshotGroupId !== targetGroup.snapshotGroupId ||
        snapshotTabIdentityCount('', binding.snapshotTabId) !== 0
      )) {
        throw new Error('The internal-page tab move could not be saved completely.');
      }
      continue;
    }
    if (
      !binding ||
      binding.spaceId !== targetSpaceId ||
      binding.snapshotGroupId !== targetGroup.snapshotGroupId ||
      binding.provisional === true ||
      snapshotTabIdentityCount(sourceSpaceId, binding.snapshotTabId) !== 0 ||
      snapshotTabIdentityCount(targetSpaceId, binding.snapshotTabId) !== 1 ||
      snapshotTabIdentityCount('', binding.snapshotTabId) !== 1
    ) {
      throw new Error('The tab snapshot move could not be saved completely.');
    }
  }
}

function snapshotTabIdentityCount(spaceId, snapshotTabId) {
  const id = validSnapshotLifecycleId(snapshotTabId);
  if (!id) return 0;
  const snapshots = spaceId
    ? [state.spaceSnapshots?.[spaceId]]
    : Object.values(state.spaceSnapshots || {});
  return snapshots.reduce((total, snapshot) => (
    total + (snapshot?.groups || []).reduce((groupTotal, group) => (
      groupTotal + (group.tabs || []).filter((tab) => tab.snapshotTabId === id).length
    ), 0)
  ), 0);
}

function committedMoveActivationError(subject, spaceId, cause) {
  const error = new Error(
    `${subject} moved to ${spaceName(spaceId)}, but that Space could not be opened. ` +
    'The move is saved; open the destination again.',
    { cause },
  );
  error.moveCommitted = true;
  return error;
}

async function moveGroupToSpace(group, spaceId, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => moveGroupToSpace(
      currentGroupForMutation(group),
      spaceId,
      { stateLocked: true, windowBinding },
    ), { windowBinding });
  }
  assertGroupActionsAreLocal([group]);
  await checkpointMovedGroupsToSpace([group], spaceId, { windowBinding });
  reportMoveSuccess(`Moved group to ${spaceName(spaceId)}.`);
}

async function moveFolderGroupToSpace(folderContext, spaceId, options = {}) {
  const windowBinding = options.windowBinding;
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
      return moveFolderGroupToSpace(currentContext, spaceId, {
        stateLocked: true,
        windowBinding,
      });
    }, { windowBinding });
  }
  const groups = groupsForFolderContext(folderContext);
  if (groups.length === 0) return;
  assertGroupActionsAreLocal(groups);
  await checkpointMovedGroupsToSpace(groups, spaceId, { windowBinding });
  reportMoveSuccess(`Moved group to ${spaceName(spaceId)}.`);
}

async function checkpointMovedGroupsToSpace(groups, spaceId, options = {}) {
  if (!state.spaces.some((space) => space.id === spaceId)) {
    throw new Error('The destination Space no longer exists. Choose another Space and try again.');
  }
  const rollback = captureChromeGroupMutationRollback();
  await runChromeGroupMutationTransaction({
    apply: () => moveGroupsWithoutSaving(groups, spaceId),
    checkpoint: () => saveState({ persistWindowState: false }),
    rollback: () => restoreChromeGroupMutationAfterFailure(rollback, {
      windowBinding: options.windowBinding,
    }),
  });
  try {
    const activated = await activateSpace(spaceId, {
      stateLocked: true,
      windowBinding: options.windowBinding,
    });
    if (activated !== true) {
      throw new Error('The destination Space was not opened after the saved move.');
    }
  } catch (error) {
    throw committedMoveActivationError(groups.length === 1 ? 'Group' : 'Groups', spaceId, error);
  }
}

async function finishMoveToSpace(spaceId, options = {}) {
  const activated = await activateSpace(spaceId, {
    stateLocked: Boolean(options.stateLocked),
    windowBinding: options.windowBinding,
  });
  if (activated !== true) {
    throw new Error('The destination Space was not opened after the saved move.');
  }
}

async function closeGroupToSaved(group, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    if (!group || group.id === 'ungrouped' || group.dormant) return;
    assertGroupActionsAreLocal([group]);
    return withFreshSpaceStateMutation(() => closeGroupToSaved(currentGroupForMutation(group), {
      stateLocked: true,
      windowBinding,
    }), { windowBinding });
  }
  if (!group || group.id === 'ungrouped' || group.dormant) return;
  assertGroupActionsAreLocal([group]);
  const liveTabs = (group.tabs || []).filter((tab) => !tab.dormant);
  if (liveTabs.length === 0) return;
  if (liveTabs.some((tab) => tab.pinned || !isRestorableSnapshotTab(tab))) {
    throw new Error('This group contains a pinned or unsavable tab. Keep it open or remove that tab first.');
  }

  const targetSpaceId = state.activeSpaceId;
  const checkpointCreatedTabIds = [];
  const checkpointCreatedTabs = [];
  const reviewedTargets = new Map();
  let checkpointState = null;
  const result = await runGuardedDestructiveTabClose({
    tabIds: liveTabs.map((tab) => Number(tab.id)),
    checkpoint: async () => {
      const beforeCheckpointState = structuredClone(state);
      let storageMayBeDirty = false;
      try {
        await withCreatedTabCheckpointRollback(checkpointCreatedTabIds, async () => {
          if (!isCurrentPanelWindowBinding(windowBinding)) {
            throw new Error('This panel moved before the group could be closed.');
          }
          await ensureActiveSpaceHasOpenTabAfterClosing(
            liveTabs.map((tab) => Number(tab.id)),
            checkpointCreatedTabIds,
            checkpointCreatedTabs,
            { windowBinding },
          );
          snapshotOpenSpace(targetSpaceId);
          const mapTabsToSavedGroups = () => {
            const snapshotGroups = state.spaceSnapshots?.[targetSpaceId]?.groups || [];
            return liveTabs.map((tab) => {
              const snapshotTabId = state.tabLifecycle?.[tab.id]?.snapshotTabId;
              return uniqueSnapshotGroupForTabId(snapshotGroups, snapshotTabId);
            });
          };
          let savedGroups = mapTabsToSavedGroups();
          if (
            !savedGroups[0] || isUngroupedSnapshotGroup(savedGroups[0]) ||
            savedGroups.some((savedGroup) => savedGroup !== savedGroups[0])
          ) {
            // A mixed Tag can hold rows saved under duplicate same-name Tags
            // (an older activation joined them into one chrome group). Fold
            // the saved duplicates into one identity — the same merge a Tidy
            // dedupe performs — and retry before refusing to close.
            convergeDuplicateSavedTags();
            savedGroups = mapTabsToSavedGroups();
          }
          if (
            !savedGroups[0] || isUngroupedSnapshotGroup(savedGroups[0]) ||
            savedGroups.some((savedGroup) => savedGroup !== savedGroups[0])
          ) {
            throw new Error('This group could not be saved as one Tag. No tabs were closed.');
          }
          for (const tab of liveTabs) {
            reviewedTargets.set(Number(tab.id), captureReviewedTabCloseTarget(
              tab, targetSpaceId, group.key,
            ));
          }
          storageMayBeDirty = true;
          const saved = await saveState({ persistWindowState: false, windowBinding });
          if (saved !== true || !isCurrentPanelWindowBinding(windowBinding)) {
            throw new Error('This panel moved before the saved group could be checkpointed.');
          }
          checkpointState = structuredClone(state);
        }, { windowBinding });
      } catch (error) {
        state = beforeCheckpointState;
        if (storageMayBeDirty) await saveState({ persistWindowState: false });
        throw error;
      }
    },
    inspectTab: (tabId, transaction) => {
      if (!isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error(transaction.closedTabIds.length === 0
          ? 'This panel moved before the group could be closed.'
          : 'This panel moved while the group was closing. Already closed pages remain saved.');
      }
      return liveReviewedTabCloseMismatch(reviewedTargets.get(Number(tabId)), { windowBinding });
    },
    closeTab: (tabId) => guardedReviewedTabClose(
      reviewedTargets.get(Number(tabId)),
      { windowBinding },
    ),
    commit: async ({ closedTabIds }) => {
      const allowStaleWindowBinding = !isCurrentPanelWindowBinding(windowBinding);
      await syncStateFromStorage({ windowBinding, allowStaleWindowBinding });
      await loadTabs({
        adopt: false,
        skipSnapshotCleanupForTabIds: closedTabIds,
        windowBinding,
        allowStaleWindowBinding,
      });
      await closeUnneededDestructiveKeepalives({
        createdTabs: checkpointCreatedTabs,
        targetSpaceId,
        closedTabIds,
        windowBinding,
        allowStaleWindowBinding,
      });
      for (const tabId of closedTabIds) {
        forgetClosedTabMetadata(reviewedTargets.get(Number(tabId))?.tab);
      }
      await saveState({ persistWindowState: false });
    },
    reconcile: async ({ closedTabIds }) => {
      state = structuredClone(checkpointState);
      for (const tabId of closedTabIds) {
        forgetClosedTabMetadata(reviewedTargets.get(Number(tabId))?.tab);
      }
      await saveState({ persistWindowState: false });
      if (isCurrentPanelWindowBinding(windowBinding)) {
        await refreshTabs({
          reloadDormant: true,
          skipSnapshotCleanupForTabIds: closedTabIds,
          windowBinding,
        });
      }
    },
  });
  await refreshTabs({ reloadDormant: true, windowBinding });
  const closed = result.closedTabIds.length;
  const skipped = result.skippedTabs.length;
  setStatus(`Closed ${formatCount(closed, 'tab')} in "${group.displayTitle || group.title}"; the Tag remains saved.` +
    (skipped > 0 ? ` Skipped ${formatCount(skipped, 'changed tab')}.` : ''));
  // The card is now a folded dormant Tag under a new key; keep keyboard focus
  // on its header so collapse-bound close remains reachable from the keyboard.
  [...document.querySelectorAll('.group-card .group-toggle')]
    .find((item) => item.querySelector('h2')?.textContent === (group.displayTitle || group.title))
    ?.focus();
}

async function openDormantGroup(group, options = {}) {
  if (!group?.dormant) return;
  const windowBinding = options.windowBinding;
  const savedTabs = (group.tabs || []).filter((tab) => tab.dormant);
  let opened = 0;
  for (const tab of savedTabs) {
    await openDormantTab(tab, group.key, { windowBinding });
    opened += 1;
  }
  setStatus(`Opened ${formatCount(opened, 'tab')} in "${group.displayTitle || group.title}".`);
  // The restored Tag is an expanded live card; keep keyboard focus on its
  // header so collapse-bound close stays reachable.
  [...document.querySelectorAll('.group-card .group-toggle')]
    .find((item) => item.querySelector('h2')?.textContent === (group.displayTitle || group.title))
    ?.focus();
}

async function deleteGroup(group, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    if (!group || group.id === 'ungrouped') return;
    assertGroupActionsAreLocal([group]);
    const confirmed = await confirmGroupDeletion(
      [group],
      group.displayTitle || group.title || 'Group',
    );
    if (!confirmed) return;
    return withFreshSpaceStateMutation(() => deleteGroup(currentGroupForMutation(group), {
      stateLocked: true,
      windowBinding,
    }), { windowBinding });
  }
  if (!group || group.id === 'ungrouped') return;
  assertGroupActionsAreLocal([group]);
  if (group.dormant) {
    const checkpoint = captureWorkspaceMemoryCheckpoint();
    try {
      const removed = deleteDormantSnapshotGroup(group);
      if (!removed) {
        throw new Error(`Saved group "${group.displayTitle || group.title}" is no longer in this Space's saved state. Refresh and try again.`);
      }
      await persistDormantSnapshotMutation({
        windowBinding,
        staleMessage: 'This panel moved to another Chrome window before the saved group could be deleted.',
      });
    } catch (error) {
      restoreWorkspaceMemoryCheckpoint(checkpoint);
      throw error;
    }
    await refreshTabs({ windowBinding });
    const message = `Deleted saved group "${group.displayTitle || group.title}".`;
    setStatus(message);
    showStatusToast(message, 'success');
    return;
  }
  const deletion = await deleteGroupsAndTabs([group], { windowBinding });
  await refreshTabs({ reloadDormant: true, windowBinding });
  const message = destructiveGroupDeletionStatus(
    group.displayTitle || group.title,
    deletion,
  );
  setStatus(message);
  showStatusToast(message, deletion.skippedTabCount > 0 ? 'info' : 'success');
}

async function deleteFolderGroup(folderContext, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    const groups = groupsForFolderContext(folderContext);
    if (groups.length === 0) return;
    assertGroupActionsAreLocal(groups);
    const confirmed = await confirmGroupDeletion(
      groups,
      folderContext.path?.at(-1) || 'Group',
    );
    if (!confirmed) return;
    return withFreshSpaceStateMutation(() => {
      const currentContext = renderedGroupDragContexts.get(folderContext.key);
      if (
        !currentContext ||
        JSON.stringify(currentContext.path || []) !== JSON.stringify(folderContext.path || []) ||
        currentContext.fingerprint !== folderContext.fingerprint
      ) {
        throw new Error('This folder changed in another Space Tabs view. Try the action again.');
      }
      return deleteFolderGroup(currentContext, { stateLocked: true, windowBinding });
    }, { windowBinding });
  }
  const groups = groupsForFolderContext(folderContext);
  if (groups.length === 0) return;
  assertGroupActionsAreLocal(groups);
  const deletion = await deleteGroupsAndTabs(groups, { windowBinding });
  await refreshTabs({ reloadDormant: true, windowBinding });
  const message = destructiveGroupDeletionStatus(
    folderContext.path?.at(-1) || 'Group',
    deletion,
  );
  setStatus(message);
  showStatusToast(message, deletion.skippedTabCount > 0 ? 'info' : 'success');
}

async function confirmGroupDeletion(groups, title) {
  const tabCount = groupDeletionTabCount(groups);
  const count = formatCount(tabCount, 'tab');
  return askConfirm({
    title: 'Delete Group',
    message: `Delete "${String(title || 'Group')}" and its ${count}? ` +
      'Open tabs will be closed and saved tabs will be removed. This cannot be undone.',
    confirmText: tabCount > 0 ? `Delete ${count}` : 'Delete group',
    danger: true,
  });
}

function groupDeletionTabCount(groups = []) {
  const liveTabIds = new Set();
  let dormantTabs = 0;
  for (const group of groups) {
    for (const tab of group?.tabs || []) {
      if (tab?.dormant) {
        dormantTabs += 1;
        continue;
      }
      const tabId = Number(tab?.id);
      if (Number.isFinite(tabId)) liveTabIds.add(tabId);
    }
  }
  return liveTabIds.size + dormantTabs;
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

async function retitleGroupWithoutSaving(group, title, options = {}) {
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
  return retitleGroupForNestedMove(group, title, options);
}

function moveGroupsWithoutSaving(groups, spaceId) {
  if (!spaceId || spaceId === state.activeSpaceId) return;
  const sourceSpaceId = state.activeSpaceId;
  const liveGroups = groups.filter((group) => !group.dormant);
  const sourceSnapshotBefore = state.spaceSnapshots?.[sourceSpaceId] || null;
  const targetSnapshotBefore = state.spaceSnapshots?.[spaceId] || null;
  const snapshotTransfer = transferSnapshotGroupsBetweenSpaces({
    sourceSnapshot: sourceSnapshotBefore,
    targetSnapshot: targetSnapshotBefore,
    snapshotGroupIds: groups.flatMap((group) => [
      group.snapshotGroupId,
      ...(group.tabs || []).map((tab) => tab.snapshotGroupId),
    ]),
    snapshotTabIds: groups.flatMap((group) => (
      (group.tabs || []).map((tab) => tab.snapshotTabId)
    )),
    now: Date.now(),
  });
  if (snapshotTransfer.movedGroups.length > 0) {
    if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') state.spaceSnapshots = {};
    if (snapshotTransfer.sourceSnapshot) {
      state.spaceSnapshots[sourceSpaceId] = snapshotTransfer.sourceSnapshot;
    } else {
      delete state.spaceSnapshots[sourceSpaceId];
    }
    if (snapshotTransfer.targetSnapshot) state.spaceSnapshots[spaceId] = snapshotTransfer.targetSnapshot;
    else delete state.spaceSnapshots[spaceId];
    if (!state.groupOrder || typeof state.groupOrder !== 'object') state.groupOrder = {};
    state.groupOrder[sourceSpaceId] = remapSnapshotGroupOrderKeys({
      order: state.groupOrder[sourceSpaceId],
      beforeSnapshot: sourceSnapshotBefore,
      afterSnapshot: snapshotTransfer.sourceSnapshot,
      spaceId: sourceSpaceId,
    });
    state.groupOrder[spaceId] = remapSnapshotGroupOrderKeys({
      order: state.groupOrder[spaceId],
      beforeSnapshot: targetSnapshotBefore,
      afterSnapshot: snapshotTransfer.targetSnapshot,
      spaceId,
    });
    dormantSpaceViewSpaceId = '';
    lastRenderedGroupsSignature = '';
  }
  const removedKeys = new Set();
  for (const group of liveGroups) {
    removedKeys.add(group.key);
    for (const tab of group.tabs || []) {
      const tabId = Number(tab?.id);
      const binding = Number.isSafeInteger(tabId) ? state.tabLifecycle?.[tabId] : null;
      if (binding && typeof binding === 'object') {
        state.tabLifecycle[tabId] = { ...binding, spaceId };
      }
    }
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
  state.groupOrder[sourceSpaceId] = (state.groupOrder[sourceSpaceId] || [])
    .filter((key) => !removedKeys.has(key));
}

async function deleteGroupsAndTabs(groups, options = {}) {
  const windowBinding = options.windowBinding;
  const dormantTabCount = groups.reduce((count, group) => (
    count + (group?.tabs || []).filter((tab) => tab.dormant).length
  ), 0);
  const liveTabIds = uniqueKeys(groups
    .flatMap((group) => group?.tabs || [])
    .filter((tab) => !tab.dormant)
    .map((tab) => Number(tab.id))
    .filter(Number.isFinite));

  let checkpointState;
  const checkpointCreatedTabIds = [];
  const checkpointCreatedTabs = [];
  const reviewedTargets = new Map();
  const targetSpaceId = state.activeSpaceId;
  let remainingTargetGroups = 0;
  let unresolvedSavedGroupCount = 0;
  const result = await runGuardedDestructiveTabClose({
    tabIds: liveTabIds,
    checkpoint: async () => {
      const beforeCheckpointState = structuredClone(state);
      let storageMayBeDirty = false;
      try {
        await withCreatedTabCheckpointRollback(checkpointCreatedTabIds, async () => {
          if (!isCurrentPanelWindowBinding(windowBinding)) {
            throw new Error('This panel moved to another Chrome window before the group could be deleted.');
          }
          if (liveTabIds.length > 0) {
            await ensureActiveSpaceHasOpenTabAfterClosing(
              liveTabIds,
              checkpointCreatedTabIds,
              checkpointCreatedTabs,
              { windowBinding },
            );
          }
          snapshotOpenSpace(state.activeSpaceId);
          for (const group of groups) {
            for (const tab of group?.tabs || []) {
              if (tab?.dormant) continue;
              const target = captureReviewedTabCloseTarget(tab, targetSpaceId, group.key);
              reviewedTargets.set(Number(target.tab.id), target);
            }
          }
          storageMayBeDirty = true;
          const saved = await saveState({ persistWindowState: false, windowBinding });
          if (saved === false || !isCurrentPanelWindowBinding(windowBinding)) {
            throw new Error('This panel moved to another Chrome window before the group could be deleted.');
          }
          checkpointState = structuredClone(state);
        }, { windowBinding });
      } catch (error) {
        state = beforeCheckpointState;
        if (storageMayBeDirty) await saveState({ persistWindowState: false });
        throw error;
      }
    },
    inspectTab: (tabId, transaction) => {
      if (!isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error(transaction.closedTabIds.length === 0
          ? 'This panel moved to another Chrome window before the group could be deleted.'
          : 'This panel moved while the group was being deleted. Already closed tabs were saved; no additional tabs were closed.');
      }
      return liveReviewedTabCloseMismatch(reviewedTargets.get(Number(tabId)), { windowBinding });
    },
    closeTab: (tabId) => guardedReviewedTabClose(
      reviewedTargets.get(Number(tabId)),
      { windowBinding },
    ),
    commit: async ({ closedTabIds }) => {
      const allowStaleWindowBinding = !isCurrentPanelWindowBinding(windowBinding);
      // Ownership restore must not re-bind the groups this transaction is
      // deleting, or the cleanup below would see them as owned elsewhere.
      const deletedGroupIds = groups
        .filter((group) => group && group.id !== 'ungrouped' && !isVirtualGroupKey(group.key))
        .map((group) => Number(group.id))
        .filter(Number.isSafeInteger);
      await syncStateFromStorage({ windowBinding, allowStaleWindowBinding });
      await loadTabs({
        adopt: false,
        skipSnapshotCleanupForTabIds: closedTabIds,
        skipOwnershipRestoreGroupIds: deletedGroupIds,
        windowBinding,
        allowStaleWindowBinding,
      });
      await closeUnneededDestructiveKeepalives({
        createdTabs: checkpointCreatedTabs,
        targetSpaceId,
        closedTabIds,
        windowBinding,
        allowStaleWindowBinding,
      });
      if (checkpointCreatedTabs.length > 0) {
        await loadTabs({
          adopt: false,
          skipSnapshotCleanupForTabIds: closedTabIds,
          skipOwnershipRestoreGroupIds: deletedGroupIds,
          windowBinding,
          allowStaleWindowBinding,
        });
      }
      snapshotOpenSpace(targetSpaceId);

      const closedIds = new Set(closedTabIds.map(Number));
      const survivingGroupKeys = new Set(groups
        .filter((group) => tabs.some((tab) => tabMatchesDestructiveTarget(
          tab,
          state,
          targetSpaceId,
          group.key,
        )))
        .map((group) => group.key));
      const removedGroups = groups.filter((group) => !survivingGroupKeys.has(group.key));
      const unresolvedSavedGroups = [
        ...deleteDormantSnapshotGroups(removedGroups.filter((group) => group.dormant)),
        ...removedGroups.filter((item) => !item.dormant && !deleteDormantSnapshotGroup(item)),
      ];
      unresolvedSavedGroupCount = unresolvedSavedGroups.length;
      for (const group of groups.filter((item) => survivingGroupKeys.has(item.key))) {
        removeTabsFromSpaceSnapshot(targetSpaceId, (group.tabs || []).filter((tab) => (
          tab.dormant || closedIds.has(Number(tab.id))
        )));
      }

      const removedKeys = new Set();
      for (const group of removedGroups.filter((item) => !item.dormant)) {
        if (!group || group.id === 'ungrouped') continue;
        removedKeys.add(group.key);
        const stillOwnedByTarget = isVirtualGroupKey(group.key)
          ? state.virtualGroups?.[group.key]?.spaceId === targetSpaceId
          : state.groupSpaces?.[group.id] === targetSpaceId;
        if (stillOwnedByTarget) {
          if (isVirtualGroupKey(group.key)) delete state.virtualGroups?.[group.key];
          else delete state.groupSpaces[group.id];
          delete state.collapsedGroups[group.key];
        }
        delete state.tabOrder[targetSpaceId]?.[group.key];
      }
      for (const tabId of closedTabIds) {
        removeTabFromSavedOrder(tabId);
        delete state.tabSpaces[tabId];
        delete state.renamedTabs[tabId];
        delete state.tabGroups?.[tabId];
        delete state.tabLifecycle?.[tabId];
        forgetEphemeralTab(tabId);
      }
      state.groupOrder[targetSpaceId] = (state.groupOrder[targetSpaceId] || [])
        .filter((key) => !removedKeys.has(key));
      await saveState({ persistWindowState: false });
      remainingTargetGroups = survivingGroupKeys.size;
    },
    reconcile: async ({ closedTabIds }) => {
      state = structuredClone(checkpointState);
      for (const tabId of closedTabIds) {
        const target = reviewedTargets.get(Number(tabId));
        forgetClosedTabMetadata(target?.tab);
      }
      await saveState({ persistWindowState: false });
      if (isCurrentPanelWindowBinding(windowBinding)) {
        await refreshTabs({
          reloadDormant: true,
          skipSnapshotCleanupForTabIds: closedTabIds,
          windowBinding,
        });
      }
    },
  });
  return {
    deletedTabCount: result.closedTabIds.length + dormantTabCount,
    skippedTabCount: result.skippedTabs.length,
    remainingTargetGroups,
    unresolvedSavedGroupCount,
  };
}

async function ensureActiveSpaceHasOpenTabAfterClosing(
  tabIds = [],
  createdTabIds = [],
  createdTabs = [],
  options = {},
) {
  const closingIds = new Set(tabIds.map(Number).filter(Number.isFinite));
  if (closingIds.size === 0 || !state.activeSpaceId) return;
  const loaded = await loadTabs({ adopt: false, windowBinding: options.windowBinding });
  if (loaded === false) return;
  const remainingTabs = tabs.filter((tab) => (
    !closingIds.has(Number(tab.id)) &&
    !isEphemeralTab(tab) &&
    tabBelongsToSpace(tab, state.activeSpaceId)
  ));
  if (remainingTabs.length > 0) return;

  const created = await send('tabs:create', {
    url: 'chrome://newtab',
    active: true,
  }, { windowBinding: options.windowBinding });
  const tabId = Number(created.tab?.id);
  if (Number.isSafeInteger(tabId)) {
    createdTabIds.push(tabId);
    createdTabs.push({ ...created.tab });
    state.tabSpaces[tabId] = state.activeSpaceId;
  }
  await loadTabs({ adopt: false, windowBinding: options.windowBinding });
}

function deleteDormantSnapshotGroups(groups) {
  if (!groups.length) return [];
  const snapshot = activeSpaceSnapshot();
  if (!snapshot) return [...groups];
  const records = snapshotGroupRecords(snapshot);
  const snapshotGroupIds = new Set(groups
    .map((group) => String(group?.snapshotGroupId || ''))
    .filter(Boolean));
  const indexes = new Set(groups.map((group) => snapshotGroupIndexFromKey(group.key)).filter((index) => index >= 0));
  if (snapshotGroupIds.size === 0 && indexes.size === 0) return [...groups];
  const matchedIds = new Set();
  const matchedIndexes = new Set();
  replaceActiveSpaceSnapshotGroups(records
    .filter((record) => {
      const matched = record.group.snapshotGroupId
        ? snapshotGroupIds.has(String(record.group.snapshotGroupId))
        : indexes.has(record.index);
      if (matched) {
        if (record.group.snapshotGroupId) matchedIds.add(String(record.group.snapshotGroupId));
        else matchedIndexes.add(record.index);
      }
      return !matched;
    })
    .map((record) => record.group));
  return groups.filter((group) => {
    const snapshotGroupId = String(group?.snapshotGroupId || '');
    if (snapshotGroupId) return !matchedIds.has(snapshotGroupId);
    return !matchedIndexes.has(snapshotGroupIndexFromKey(group.key));
  });
}

function replaceGroupOrderKeys(replacements, fallbackOrder = []) {
  if (!replacements?.size) return;
  const order = fallbackOrder.length ? fallbackOrder : state.groupOrder[state.activeSpaceId] || [];
  state.groupOrder[state.activeSpaceId] = uniqueKeys(order.map((key) => replacements.get(key) || key));
}

async function openDormantTab(tab, groupKey, options = {}) {
  const windowBinding = options.windowBinding || capturePanelWindowBinding();
  const staleMessage = 'This panel moved to another Chrome window before the saved tab could open.';
  if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      const currentGroup = dormantGroupForTabReference(tab, groupKey);
      const currentTab = dormantTabForMutation(currentGroup, tab);
      if (!currentGroup || !currentTab) {
        throw new Error('This saved tab changed in another Space Tabs view. Try the action again.');
      }
      return openDormantTab(currentTab, currentGroup.key, {
        stateLocked: true,
        windowBinding,
      });
    }, { windowBinding });
  }
  const url = tab?.url || '';
  if (!url) return;
  if (String(url).trim().toLowerCase().startsWith('file:')) {
    fileSchemeAccessAllowed = await currentFileSchemeAccess();
    if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
    if (!fileSchemeAccessAllowed) {
      throw new Error('Enable “Allow access to file URLs” for Space Tabs in chrome://extensions before opening this saved file.');
    }
  }
  const checkpoint = captureWorkspaceMemoryCheckpoint();
  const createdTabIds = [];
  let tabId = null;
  let storageMayBeDirty = false;
  try {
    await withCreatedTabCheckpointRollback(createdTabIds, async () => {
      if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
      const created = await send('tabs:create', { url, active: true }, {
        windowBinding,
      });
      tabId = Number(created.tab?.id);
      // The tab exists before the awaited response is resumed. Always journal
      // it first so a host-window move during that await is compensatable.
      if (Number.isSafeInteger(tabId)) createdTabIds.push(tabId);
      if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
      if (!Number.isSafeInteger(tabId)) {
        throw new Error('Chrome did not return the saved tab it opened.');
      }

      const dormantGroup = dormantGroupForTabReference(tab, groupKey);
      let chromeGroupId = -1;
      let dormantTarget = null;
      if (!dormantGroup || isUngroupedSnapshotGroup(dormantGroup)) {
        state.tabSpaces[tabId] = state.activeSpaceId;
      } else {
        dormantTarget = await resolveDormantChromeGroupTarget(dormantGroup, tab, { windowBinding });
        if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
        if (dormantTarget) {
          chromeGroupId = await addTabsToChromeGroup(
            dormantTarget.group.id,
            [tabId],
            state.activeSpaceId,
            { windowBinding },
          );
        } else {
          chromeGroupId = await createChromeGroup([tabId], {
            title: dormantGroup.title,
            color: dormantGroup.color,
            collapsed: false,
            windowBinding,
          });
        }
        if (!isCurrentPanelWindowBinding(windowBinding)) throw new Error(staleMessage);
        if (!Number.isFinite(chromeGroupId)) {
          chromeGroupId = -1;
          state.tabSpaces[tabId] = state.activeSpaceId;
        }
      }

      preserveDormantPanelName(tab, tabId);
      if (!state.tabLifecycle || typeof state.tabLifecycle !== 'object') state.tabLifecycle = {};
      state.tabLifecycle[tabId] = {
        tabId,
        snapshotTabId: tab.snapshotTabId,
        snapshotGroupId: dormantTarget?.snapshotGroupId ||
          tab.snapshotGroupId || dormantGroup?.snapshotGroupId,
        spaceId: state.activeSpaceId,
        url: String(created.tab?.url || url),
        // A freshly created tab reports its pending URL as the Chrome title.
        // Seed the binding with the saved page title so the panel can bridge
        // the loading window instead of flashing the URL on every open.
        title: String(tab.title || created.tab?.title || url),
        panelTitle: cleanPanelName(tab.panelTitle),
        windowId: Number.isFinite(Number(created.tab?.windowId))
          ? Number(created.tab.windowId)
          : windowBinding.windowId,
        groupId: chromeGroupId,
        trackingMode: 'saved-target',
        sessionId: state.browserSessionId,
      };
      rememberOpenedDormantTab(tab, dormantGroup, tabId);
      storageMayBeDirty = true;
      await saveState({ windowBinding });
    }, { windowBinding });
  } catch (error) {
    forgetRecentlyOpenedDormantTab(tabId);
    await rollbackWindowBoundCreatedTabMutation(checkpoint, {
      error,
      stateMayHaveBeenPersisted: storageMayBeDirty,
      windowBinding,
    });
    throw error;
  }

  try {
    // The saved-target binding is durable before the placeholder is removed,
    // so lifecycle events cannot temporarily reclassify the new live tab.
    await closeEphemeralTabs({
      windowBinding,
      allowStaleWindowBinding: true,
    });
    if (!isCurrentPanelWindowBinding(windowBinding)) {
      throw new Error(
        'The saved tab opened and was saved in the previous window. Temporary-tab cleanup finished, but this Workbench moved before it could refresh.',
      );
    }
    await refreshTabs({ windowBinding });
  } catch (error) {
    if (/opened and was saved/.test(String(error?.message || ''))) throw error;
    throw new Error(
      `The saved tab opened and was saved, but temporary-tab cleanup or the panel refresh could not finish: ${error?.message || String(error)}`,
      { cause: error },
    );
  }
}

function preserveDormantPanelName(tab, tabId) {
  const name = cleanPanelName(tab?.panelTitle);
  if (!name || !Number.isFinite(Number(tabId))) return;
  if (!state.renamedTabs || typeof state.renamedTabs !== 'object') state.renamedTabs = {};
  state.renamedTabs[tabId] = name;
}

async function switchSpace(spaceId, options = {}) {
  const windowBinding = options.windowBinding || capturePanelWindowBinding();
  if (!isCurrentPanelWindowBinding(windowBinding)) return false;
  const previousSpaceId = state.activeSpaceId;
  const nextSpaceName = state.spaces.find((space) => space.id === spaceId)?.name || 'Space';
  // Add Space and fresh onboarding insert their target into memory before
  // entering this transaction. Their caller-supplied checkpoint is the only
  // state that can safely compensate an apply-then-reject storage write;
  // taking a new checkpoint here would preserve an uncommitted ghost Space.
  const checkpoint = options.rollbackCheckpoint || captureWorkspaceMemoryCheckpoint();
  const createdTabIds = [];
  let storageMayBeDirty = false;
  let switchPlan = null;
  let materializedTarget = null;
  let activatedTarget = null;
  let activeSurvivorTabId = null;
  let activeSurvivorGuard = null;
  let originalFocusTabId = null;
  let reviewedCloseTargets = new Map();
  try {
    await withCreatedTabCheckpointRollback(createdTabIds, async () => {
      const loaded = await loadTabs({ adopt: false, windowBinding });
      if (loaded === false || !isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error('This panel moved to another Chrome window before the Space could switch.');
      }
      fileSchemeAccessAllowed = await currentFileSchemeAccess();
      if (!isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error('This panel moved to another Chrome window before the Space could switch.');
      }

      originalFocusTabId = spaceSwitchOriginalFocusTabId(windowBinding);
      snapshotOpenSpace(previousSpaceId);
      const sourceSnapshot = sanitizeStoredSpaceSnapshot(previousSpaceId);
      const targetSnapshot = sanitizeStoredSpaceSnapshot(spaceId);
      const sourceCleanupTabs = uniqueSpaceSwitchTabs([
        ...tabs.filter(isEphemeralTab),
        ...(!snapshotHasPersistentContent(sourceSnapshot)
          ? tabs.filter((tab) => (
            !tab.pinned &&
            !isGroupedTab(tab) &&
            isChromeNewTabUrl(tab.url) &&
            tabBelongsToSpace(tab, previousSpaceId)
          ))
          : []),
      ]);
      switchPlan = planSpaceSwitch({
        tabs,
        state,
        sourceSpaceId: previousSpaceId,
        sourceSnapshot,
        targetSpaceId: spaceId,
        targetSnapshot,
        foreignLiveTabs,
        fileSchemeAccess: fileSchemeAccessAllowed,
      });
      reviewedCloseTargets = captureSpaceSwitchCloseTargets(
        switchPlan.sourceClosableTabs,
        sourceCleanupTabs,
        previousSpaceId,
      );
      // Hard safety boundary: one temporary destination New Tab is prepared
      // and made active before the durable active-Space pair is written.
      // Saved target Tags remain dormant and source tabs are not eligible for
      // closing until the keepalive is active.
      materializedTarget = await materializeSpaceSwitchTarget(switchPlan, {
        createdTabIds,
        sourceSpaceId: previousSpaceId,
        windowBinding,
      });
      activatedTarget = await activateSpaceSwitchTarget(materializedTarget.tabs, {
        preferredTabId: options.preferredTabId,
        preferredSnapshotTabId: options.preferredSnapshotTabId,
        windowBinding,
      });
      activeSurvivorTabId = Number(activatedTarget.tab.id);
      activeSurvivorGuard = spaceSwitchFocusGuard(activatedTarget.tab);
      await verifyMaterializedSpaceSwitchTarget(materializedTarget, {
        activeTabId: activeSurvivorTabId,
        windowBinding,
      });

      activeView = 'space';
      state.activeSpaceId = spaceId;
      durableActiveSpaceId = spaceId;
      await loadDormantSpaceView(spaceId, { force: true });
      storageMayBeDirty = true;
      const saved = await saveState({ windowBinding });
      if (saved !== true) {
        throw new Error('This panel moved to another Chrome window before the Space could switch.');
      }
    }, { windowBinding });
  } catch (error) {
    const rollbackFailures = [];
    try {
      await rollbackWindowBoundCreatedTabMutation(checkpoint, {
        error,
        stateMayHaveBeenPersisted: storageMayBeDirty,
        windowBinding,
      });
    } catch (rollbackError) {
      rollbackFailures.push({ stage: 'restoring the workspace state', error: rollbackError });
    }
    if (Number.isSafeInteger(originalFocusTabId)) {
      try {
        await focusSpaceSwitchSurvivor({
          tabId: originalFocusTabId,
          windowBinding,
          allowStaleWindowBinding: true,
        });
      } catch (focusError) {
        rollbackFailures.push({ stage: 'reactivating the original Space tab', error: focusError });
      }
    }
    if (rollbackFailures.length > 0) {
      throw createRollbackFailureError(error, rollbackFailures);
    }
    throw error;
  }

  // The durable target commit is the point of no return. Every destructive
  // source close is guarded by the still-active target Space survivor in
  // the original window. A post-commit failure is reported as partial cleanup;
  // it must never roll the user back into a Space whose live tabs may be gone.
  const closeOutcome = await closeSpaceSwitchSourceTabs({
    activeSurvivorGuard,
    activeSurvivorTabId,
    materializedTarget,
    reviewedCloseTargets,
    switchPlan,
    windowBinding,
  });
  const postCommitWarnings = [];
  if (closeOutcome.error) {
    console.error(closeOutcome.error);
    postCommitWarnings.push('Chrome stopped the old Space cleanup safely before every tab could close.');
  }
  if (closeOutcome.skippedTabs.length > 0) {
    postCommitWarnings.push(
      `${closeOutcome.skippedTabs.length} old Space ${closeOutcome.skippedTabs.length === 1 ? 'tab was' : 'tabs were'} changed and left open.`,
    );
  }
  try {
    activatedTarget = await activateSpaceSwitchTarget(materializedTarget.tabs, {
      preferredTabId: activatedTarget.tab.id,
      windowBinding,
      allowStaleWindowBinding: true,
    });
  } catch (error) {
    console.error(error);
    postCommitWarnings.push(`Chrome could not keep ${nextSpaceName}'s target tab active.`);
  }
  try {
    await loadTabs({
      adopt: false,
      skipSnapshotCleanupForTabIds: closeOutcome.closedTabIds,
      windowBinding,
      allowStaleWindowBinding: true,
    });
    await loadDormantSpaceView(spaceId, { force: true });
    if (isCurrentPanelWindowBinding(windowBinding)) render();
    else postCommitWarnings.push('This panel moved before its switched view could refresh.');
  } catch (error) {
    console.error(error);
    postCommitWarnings.push('The switched tab list could not refresh yet.');
  }
  if (postCommitWarnings.length > 0) {
    const message = `Switched to ${nextSpaceName}, but ${postCommitWarnings.join(' ')}`;
    setStatus(message);
    showStatusToast(message, 'error');
  }
  return true;
}

function spaceSwitchOriginalFocusTabId(windowBinding) {
  const activeTabId = Number(tabs.find((tab) => tab.active)?.id);
  if (Number.isSafeInteger(activeTabId)) return activeTabId;
  const hostTabId = Number(windowBinding?.hostTabId);
  return Number.isSafeInteger(hostTabId) ? hostTabId : null;
}

function spaceSwitchFocusGuard(tab = {}) {
  const tabId = Number(tab.id);
  if (!Number.isSafeInteger(tabId)) return null;
  return {
    tabId,
    windowId: tab.windowId,
    groupId: tab.groupId,
  };
}

function captureSpaceSwitchCloseTargets(sourceTabs, sourceCleanupTabs, sourceSpaceId) {
  const targets = new Map();
  for (const tab of sourceTabs || []) {
    const groupKey = isGroupedTab(tab)
      ? `group:${Number(tab.groupId)}`
      : String(state.tabGroups?.[tab.id] || 'ungrouped');
    const target = captureReviewedTabCloseTarget(tab, sourceSpaceId, groupKey);
    targets.set(Number(tab.id), target);
  }
  for (const tab of sourceCleanupTabs || []) {
    if (targets.has(Number(tab.id))) continue;
    targets.set(Number(tab.id), captureReviewedTabCloseTarget(tab, '', ''));
  }
  return targets;
}

async function materializeSpaceSwitchTarget(plan, options = {}) {
  const targetTabs = [];
  const requiredGroupAssignments = [];
  let retainedFallbackTabId = null;
  const reusable = tabs.find((tab) => (
    !tab.pinned &&
    !isGroupedTab(tab) &&
    isChromeNewTabUrl(tab.url) &&
    (isEphemeralTab(tab) || tabBelongsToSpace(tab, options.sourceSpaceId))
  ));
  let fallback = reusable ? { ...reusable } : null;
  if (!fallback) {
    const created = await send('tabs:create', {
      url: 'chrome://newtab',
      active: false,
    }, { windowBinding: options.windowBinding });
    const tabId = Number(created.tab?.id);
    if (Number.isSafeInteger(tabId)) options.createdTabIds.push(tabId);
    if (!isCurrentPanelWindowBinding(options.windowBinding)) {
      throw new Error('This panel moved before the target Space fallback could open.');
    }
    if (!Number.isSafeInteger(tabId)) {
      throw new Error('Chrome did not return the target Space fallback tab.');
    }
    fallback = {
      ...created.tab,
      id: tabId,
      groupId: -1,
      windowId: Number.isSafeInteger(Number(created.tab?.windowId))
        ? Number(created.tab.windowId)
        : options.windowBinding.windowId,
    };
  }
  retainedFallbackTabId = Number(fallback.id);
  delete state.tabGroups?.[retainedFallbackTabId];
  delete state.tabLifecycle?.[retainedFallbackTabId];
  delete state.renamedTabs?.[retainedFallbackTabId];
  delete state.tabSpaces[retainedFallbackTabId];
  removeTabFromSavedOrder(retainedFallbackTabId, options.sourceSpaceId);
  rememberEphemeralTab(retainedFallbackTabId);
  targetTabs.push(fallback);
  return { requiredGroupAssignments, retainedFallbackTabId, tabs: targetTabs };
}

function uniqueSpaceSwitchTabs(candidateTabs) {
  const seen = new Set();
  return (candidateTabs || []).filter((tab) => {
    const tabId = Number(tab?.id);
    if (!Number.isSafeInteger(tabId) || seen.has(tabId)) return false;
    seen.add(tabId);
    return true;
  });
}

async function verifyMaterializedSpaceSwitchTarget(materializedTarget, options = {}) {
  const listed = await send('tabs:listAll', {}, {
    windowBinding: options.windowBinding,
    allowStaleWindowBinding: options.allowStaleWindowBinding === true,
  });
  const allTabs = listed.allChromeTabs || listed.tabs || [];
  const currentById = new Map(allTabs.map((tab) => [Number(tab.id), tab]));
  for (const target of materializedTarget?.tabs || []) {
    const current = currentById.get(Number(target.id));
    if (!current || Number(current.windowId) !== Number(options.windowBinding?.windowId)) {
      throw new Error('The target Space keepalive closed or moved before source cleanup.');
    }
  }
  for (const assignment of materializedTarget?.requiredGroupAssignments || []) {
    for (const tabId of assignment.tabIds || []) {
      if (Number(currentById.get(Number(tabId))?.groupId) !== Number(assignment.groupId)) {
        throw new Error('The target Space keepalive changed before source cleanup.');
      }
    }
  }
  if (Number.isSafeInteger(Number(options.activeTabId))) {
    const active = currentById.get(Number(options.activeTabId));
    if (!active?.active) {
      throw new Error('The target Space keepalive was not active before source cleanup.');
    }
  }
  return allTabs;
}

async function activateSpaceSwitchTarget(targetTabs, options = {}) {
  const localTargets = (targetTabs || []).filter((tab) => Number.isSafeInteger(Number(tab?.id)));
  const preferredTabId = Number(options.preferredTabId);
  const preferredSnapshotTabId = String(options.preferredSnapshotTabId || '');
  const target = localTargets.find((tab) => Number(tab.id) === preferredTabId) ||
    localTargets.find((tab) => (
      preferredSnapshotTabId &&
      String(state.tabLifecycle?.[tab.id]?.snapshotTabId || tab.snapshotTabId || '') === preferredSnapshotTabId
    )) ||
    preferredFocusableTab(localTargets.filter(isGroupedTab)) ||
    preferredFocusableTab(localTargets);
  if (!target) throw new Error('The target Space has no local tab that Chrome can activate safely.');
  return focusSpaceSwitchSurvivor({
    tabId: Number(target.id),
    guard: spaceSwitchFocusGuard(target),
    windowBinding: options.windowBinding,
    allowStaleWindowBinding: options.allowStaleWindowBinding,
  });
}

async function focusSpaceSwitchSurvivor(options = {}) {
  const response = await send('tabs:focus', {
    tabId: options.tabId,
    ...(options.guard ? { focusGuard: options.guard, skipChanged: true } : {}),
  }, {
    windowBinding: options.windowBinding,
    allowStaleWindowBinding: options.allowStaleWindowBinding === true,
  });
  if (!response.tab || response.skipped) {
    throw new Error('The tab required to keep Chrome open changed before it could be activated.');
  }
  if (Number(response.tab.id) !== Number(options.tabId) || response.tab.active === false) {
    throw new Error('Chrome did not activate the tab required to keep the window open.');
  }
  return response;
}

async function closeSpaceSwitchSourceTabs(options = {}) {
  const retainedFallbackTabId = Number(options.materializedTarget?.retainedFallbackTabId);
  const requiredTargetTabGuards = spaceSwitchTargetTabGuards(
    options.materializedTarget,
    options.windowBinding,
  );
  const candidateIds = [...options.reviewedCloseTargets.keys()]
    .filter((tabId) => Number(tabId) !== retainedFallbackTabId);
  if (candidateIds.length === 0) {
    return { closedTabIds: [], skippedTabs: [], error: null };
  }
  let lastOutcome = { closedTabIds: [], skippedTabs: [] };
  const persistOutcome = async (outcome = {}) => {
    lastOutcome = {
      closedTabIds: [...(outcome.closedTabIds || [])],
      skippedTabs: [...(outcome.skippedTabs || [])],
    };
    for (const tabId of lastOutcome.closedTabIds) {
      forgetRecentlyOpenedDormantTab(tabId);
      forgetClosedTabMetadata(options.reviewedCloseTargets.get(Number(tabId))?.tab);
      removeTabFromSavedOrder(tabId, options.switchPlan?.sourceSpaceId);
    }
    await loadTabs({
      adopt: false,
      skipSnapshotCleanupForTabIds: lastOutcome.closedTabIds,
      windowBinding: options.windowBinding,
      allowStaleWindowBinding: true,
    });
    const saved = await saveState({ persistWindowState: false });
    if (saved !== true) throw new Error('The old Space cleanup could not be saved.');
  };

  try {
    return await runGuardedDestructiveTabClose({
      tabIds: candidateIds,
      checkpoint: async () => {},
      inspectTab: async (tabId) => {
        await verifyMaterializedSpaceSwitchTarget(options.materializedTarget, {
          windowBinding: options.windowBinding,
          allowStaleWindowBinding: true,
        });
        await focusSpaceSwitchSurvivor({
          tabId: options.activeSurvivorTabId,
          guard: options.activeSurvivorGuard,
          windowBinding: options.windowBinding,
          allowStaleWindowBinding: true,
        });
        return liveReviewedTabCloseMismatch(
          options.reviewedCloseTargets.get(Number(tabId)),
          { windowBinding: options.windowBinding, allowStaleWindowBinding: true },
        );
      },
      closeTab: (tabId) => guardedReviewedTabClose(
        options.reviewedCloseTargets.get(Number(tabId)),
        {
          windowBinding: options.windowBinding,
          allowStaleWindowBinding: true,
          requiredActiveSurvivorTabId: options.activeSurvivorTabId,
          requiredTargetTabGuards,
        },
      ),
      commit: persistOutcome,
      reconcile: persistOutcome,
    });
  } catch (error) {
    return { ...lastOutcome, error };
  }
}

function spaceSwitchTargetTabGuards(materializedTarget, windowBinding) {
  const requiredGroups = new Map();
  for (const assignment of materializedTarget?.requiredGroupAssignments || []) {
    for (const tabId of assignment.tabIds || []) {
      requiredGroups.set(Number(tabId), Number(assignment.groupId));
    }
  }
  return uniqueSpaceSwitchTabs(materializedTarget?.tabs).map((tab) => ({
    tabId: Number(tab.id),
    windowId: Number(windowBinding?.windowId),
    groupId: requiredGroups.has(Number(tab.id))
      ? requiredGroups.get(Number(tab.id))
      : Number(tab.groupId),
  }));
}

async function closeTabsAndForgetMetadata(tabsToClose = [], options = {}) {
  const tabsById = new Map(tabsToClose.map((tab) => [Number(tab.id), tab]));
  return closeTabIdsSequentially([...tabsById.keys()], async (tabId) => {
    await send('tabs:close', { tabId }, {
      windowBinding: options.windowBinding,
      allowStaleWindowBinding: options.allowStaleWindowBinding,
    });
    forgetClosedTabMetadata(tabsById.get(tabId));
  });
}

function forgetClosedTabMetadata(tab) {
  const tabId = Number(tab?.id);
  if (!Number.isFinite(tabId)) return;
  delete state.tabSpaces[tabId];
  delete state.renamedTabs[tabId];
  delete state.tabGroups?.[tabId];
  delete state.tabLifecycle?.[tabId];
  forgetEphemeralTab(tabId);
}

async function throwAfterPartialTabClose(result, options = {}) {
  if (!result?.error) return;
  try {
    await refreshTabs({
      reloadDormant: Boolean(options.reloadDormant),
      skipSnapshotCleanupForTabIds: result.closedTabIds,
      windowBinding: options.windowBinding,
    });
  } catch {
    // Keep the original Chrome close failure; the durable pre-close snapshot
    // remains the recovery source if this immediate refresh also fails.
  }
  throw result.error;
}

async function liveSpaceDeletionInventory(spaceId, options = {}) {
  const response = await send('tabs:listAll', {}, { windowBinding: options.windowBinding });
  const allBrowserTabs = decorateTabs(tabsWithLifecycleIdentity(response.tabs || []), state);
  const allChromeTabs = decorateTabs(tabsWithLifecycleIdentity(
    response.allChromeTabs || response.tabs || [],
  ), state);
  const allTabs = allBrowserTabs.filter((tab) => !isEphemeralTab(tab));
  const plan = planSpaceTabDeletion(allTabs, state, spaceId);
  plan.closingTabs.sort((left, right) => Number(left.id) - Number(right.id));
  plan.preservedPinnedTabs.sort((left, right) => Number(left.id) - Number(right.id));
  return {
    response,
    allChromeTabs,
    allBrowserTabs,
    allTabs,
    plan: {
      ...plan,
      fingerprint: spaceDeletionIntentFingerprint({
        state,
        deletingSpaceId: spaceId,
        plan,
      }),
    },
  };
}

async function liveSpaceDeletionPlan(spaceId, options = {}) {
  return (await liveSpaceDeletionInventory(spaceId, options)).plan;
}

function assertFreshSpaceDeletionPlan(plan, expectedFingerprint) {
  if (!expectedFingerprint || plan.fingerprint === expectedFingerprint) return;
  throw new Error('This Space, its contents, or the fallback Space changed after confirmation. No tabs were closed; review the updated deletion and try again.');
}

async function closeSpaceTabsAcrossWindows(spaceId, fallbackSpaceId, options = {}) {
  const windowBinding = options.windowBinding;
  if (!isCurrentPanelWindowBinding(windowBinding)) {
    throw new Error('This panel moved to another Chrome window before deletion began.');
  }
  const initialInventory = await liveSpaceDeletionInventory(spaceId, { windowBinding });
  assertFreshSpaceDeletionPlan(initialInventory.plan, options.expectedFingerprint);
  let transactionClosingTabs = [];
  let preservedPinnedTabs = initialInventory.plan.preservedPinnedTabs;
  let closingTabsById = new Map();
  let checkpointState;
  let checkpointDurableActiveSpaceId = durableActiveSpaceId;
  const checkpointCreatedTabIds = [];

  await runDestructiveTabClose({
    tabIds: () => transactionClosingTabs.map((tab) => tab.id),
    checkpoint: async () => {
      const beforeCheckpointState = structuredClone(state);
      const beforeCheckpointDurableActiveSpaceId = durableActiveSpaceId;
      try {
        await withCreatedTabCheckpointRollback(checkpointCreatedTabIds, async () => {
          let checkpointInventory;
          for (let pass = 0; pass < 2; pass += 1) {
            checkpointInventory = await liveSpaceDeletionInventory(spaceId, { windowBinding });
            assertFreshSpaceDeletionPlan(checkpointInventory.plan, options.expectedFingerprint);
            const passClosingTabs = spaceDeletionTransactionTabs(checkpointInventory);
            const keepaliveWindowIds = planSpaceDeletionWindowKeepalives(
              checkpointInventory.allChromeTabs,
              passClosingTabs.map((tab) => tab.id),
            );
            if (keepaliveWindowIds.length === 0) break;
            if (!fallbackSpaceId) {
              throw new Error('Chrome windows changed during deletion. No tabs were closed; try again.');
            }
            for (const windowId of keepaliveWindowIds) {
              const created = await send('tabs:create', {
                url: 'chrome://newtab',
                active: false,
                windowId,
              }, { windowBinding });
              const tabId = Number(created.tab?.id);
              if (Number.isSafeInteger(tabId)) {
                checkpointCreatedTabIds.push(tabId);
                options.rollbackJournal?.createdTabIds?.push(tabId);
                if (hasDormantContent(fallbackSpaceId)) rememberEphemeralTab(tabId);
                else state.tabSpaces[tabId] = fallbackSpaceId;
              }
            }
          }

          checkpointInventory = await liveSpaceDeletionInventory(spaceId, { windowBinding });
          assertFreshSpaceDeletionPlan(checkpointInventory.plan, options.expectedFingerprint);
          transactionClosingTabs = spaceDeletionTransactionTabs(checkpointInventory);
          const unsafeWindowIds = planSpaceDeletionWindowKeepalives(
            checkpointInventory.allChromeTabs,
            transactionClosingTabs.map((tab) => tab.id),
          );
          if (unsafeWindowIds.length > 0) {
            throw new Error('Tabs changed windows during deletion. No tabs were closed; try again.');
          }
          preservedPinnedTabs = checkpointInventory.plan.preservedPinnedTabs;
          snapshotOpenSpace(spaceId, {
            sourceTabs: checkpointInventory.allTabs,
            sourceGroups: checkpointInventory.response.groups || [],
          });
          // Freeze the reviewed physical placement and durable row identity
          // only after snapshotOpenSpace has bound every eligible live tab.
          transactionClosingTabs = tabsWithLifecycleIdentity(transactionClosingTabs)
            .map((tab) => ({ ...tab }));
          preservedPinnedTabs = tabsWithLifecycleIdentity(preservedPinnedTabs)
            .map((tab) => ({ ...tab }));
          closingTabsById = new Map(
            transactionClosingTabs.map((tab) => [Number(tab.id), tab]),
          );
          const saved = await saveState({ windowBinding });
          if (saved === false || !isCurrentPanelWindowBinding(windowBinding)) {
            throw new Error('This panel moved to another Chrome window before deletion began.');
          }
          checkpointState = structuredClone(state);
          checkpointDurableActiveSpaceId = durableActiveSpaceId;
          if (options.rollbackJournal) {
            options.rollbackJournal.checkpointState = structuredClone(checkpointState);
          }
        }, { windowBinding });
      } catch (error) {
        state = beforeCheckpointState;
        durableActiveSpaceId = beforeCheckpointDurableActiveSpaceId;
        throw error;
      }
    },
    beforeClose: async (tabId, { closedTabIds }) => {
      if (!isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error(closedTabIds.length === 0
          ? 'This panel moved to another Chrome window before deletion began.'
          : 'This panel moved to another Chrome window during deletion. Already closed tabs were saved; no additional tabs were closed.');
      }
      const currentInventory = await liveSpaceDeletionInventory(spaceId, {
        windowBinding,
      });
      const alreadyClosed = new Set(closedTabIds.map(Number));
      const expectedRemainingTabs = transactionClosingTabs
        .filter((tab) => !alreadyClosed.has(Number(tab.id)));
      const expectedRemainingFingerprint = spaceTabDeletionFingerprint({
        closingTabs: expectedRemainingTabs,
        preservedPinnedTabs,
      });
      if (spaceTabDeletionFingerprint(currentInventory.plan) !== expectedRemainingFingerprint) {
        throw new Error('Tabs in this Space changed during deletion. No additional tabs were closed; review the updated Space and try again.');
      }
      for (const expectedTab of expectedRemainingTabs) {
        const mismatch = spaceDeletionCloseCandidateMismatch({
          expectedTab,
          currentTabs: currentInventory.allBrowserTabs,
          state,
          deletingSpaceId: spaceId,
        });
        if (mismatch) {
          throw new Error('A tab changed during deletion. No additional tabs were closed; review the updated Space and try again.');
        }
      }
    },
    closeTab: (tabId) => {
      const expectedTab = closingTabsById.get(Number(tabId));
      return send('tabs:close', {
        tabId,
        closeGuard: {
          tabId,
          requireUnpinned: true,
          windowId: expectedTab?.windowId,
          groupId: expectedTab?.groupId,
          url: String(expectedTab?.pendingUrl || expectedTab?.url || ''),
        },
      }, { windowBinding });
    },
    commit: async (closedTabIds) => {
      for (const tabId of closedTabIds) {
        forgetClosedTabMetadata(closingTabsById.get(Number(tabId)));
      }
      reassignPinnedTabsAfterSpaceDelete(
        state,
        preservedPinnedTabs,
        spaceId,
        fallbackSpaceId,
      );
      await options.commit?.({ closedTabIds, preservedPinnedTabs });
    },
    reconcile: async ({ closedTabIds }) => {
      if (options.rollbackJournal) {
        options.rollbackJournal.closedTabIds = uniqueKeys([
          ...(options.rollbackJournal.closedTabIds || []),
          ...closedTabIds,
        ].map(Number).filter(Number.isSafeInteger));
      }
      state = structuredClone(checkpointState);
      durableActiveSpaceId = checkpointDurableActiveSpaceId;
      for (const tabId of closedTabIds) {
        forgetClosedTabMetadata(closingTabsById.get(Number(tabId)));
      }
      // A close is irreversible. Persist its exact metadata outcome even when
      // the UI epoch is stale, while deliberately leaving every window mapping
      // untouched.
      await saveState({ persistWindowState: false });
      if (isCurrentPanelWindowBinding(windowBinding)) {
        await refreshTabs({
          reloadDormant: true,
          skipSnapshotCleanupForTabIds: closedTabIds,
          windowBinding,
        });
      }
    },
  });
  await loadTabs({ adopt: false, windowBinding });
}

function spaceDeletionTransactionTabs(inventory) {
  // The destructive set must exactly match the reviewed confirmation count.
  // Ephemeral new-tab placeholders are live browser tabs too; silently closing
  // them after promising to close zero tabs violates the user's review.
  return inventory.plan.closingTabs;
}

async function rollbackSpaceDeletionTransition(transition, originalError, options = {}) {
  const rollback = projectSpaceDeletionRollbackState({
    beforeState: transition.beforeState,
    checkpointState: transition.checkpointState,
    deletingSpaceId: transition.deletingSpaceId,
    createdTabIds: transition.createdTabIds,
    closedTabIds: transition.closedTabIds,
  });
  const restoreSpaceId = rollback.restoreActiveSpaceId;
  const placeholderSpaceId = rollback.placeholderSpaceId;
  const retainAsEphemeral = rollback.retainAsEphemeral;
  state = rollback.state;
  durableActiveSpaceId = transition.durableActiveSpaceId;
  windowSpaceState = transition.windowSpaceState;
  activeView = transition.activeView;
  syncSpaceDeletionPlaceholderMemory({
    retainedTabIds: transition.createdTabIds,
    retainAsEphemeral,
  });
  restoreFailedWorkspaceMutation(state, { windowBinding: options.windowBinding });
  if (isCurrentPanelWindowBinding(options.windowBinding)) {
    try {
      // The recovered snapshot is already in memory, so restore its saved rows
      // before slower persistence and Chrome placeholder cleanup begin.
      await loadDormantSpaceView(restoreSpaceId, { force: true });
      render();
      renderSettings();
    } catch {
      // The full refresh below retries this local projection and reports a failure
      // only if the restored view still cannot be rendered.
    }
  }
  const rollbackFailures = await collectSpaceDeletionRollbackFailures({
    saveRecovery: () => persistStoragePair({
      key: WINDOW_STATE_KEY,
      value: transition.windowSpaceState,
      get: windowStateGet,
      set: windowStateSet,
      remove: windowStateRemove,
    }, {
      key: STORAGE_KEY,
      value: stateForStorage(),
      get: storageGet,
      set: storageSet,
      remove: storageRemove,
    }),
    cleanup: () => cleanupAbortedSpaceDeletionPlaceholders(transition, {
      placeholderSpaceId,
      retainAsEphemeral,
      windowBinding: options.windowBinding,
    }),
    saveCleanup: () => saveState({ persistWindowState: false }),
    refresh: async () => {
      if (!isCurrentPanelWindowBinding(options.windowBinding)) return;
      await loadTabs({
        adopt: false,
        skipSnapshotCleanupForTabIds: transition.closedTabIds,
        windowBinding: options.windowBinding,
      });
      await loadDormantSpaceView(restoreSpaceId, { force: true });
      render();
      renderSettings();
    },
  });

  if (rollbackFailures.length > 0) {
    throw createRollbackAggregateError(
      transition.deletingActiveSpace ? 'Active Space deletion' : 'Inactive Space deletion',
      rollbackFailures,
      { cause: originalError },
    );
  }
}

async function cleanupAbortedSpaceDeletionPlaceholders(transition, options = {}) {
  const messageOptions = {
    windowBinding: options.windowBinding,
    // Placeholders were created in the reviewed source window. Once deletion
    // aborts, their explicit ids must be reconciled there even if the
    // Workbench host has moved elsewhere.
    allowStaleWindowBinding: Boolean(options.windowBinding),
  };
  const pendingIds = new Set((transition.createdTabIds || [])
    .map(Number)
    .filter((tabId) => Number.isSafeInteger(tabId) && tabId >= 0));
  const removedTabIds = [];
  const retainedTabIds = [];
  const liveRetainedTabIds = [];
  const failures = [];

  while (pendingIds.size > 0) {
    let response;
    try {
      response = await send('tabs:listAll', {}, messageOptions);
    } catch (error) {
      retainedTabIds.push(...pendingIds);
      failures.push({
        stage: 'checking live tabs before cleaning up aborted deletion placeholders',
        error,
      });
      break;
    }

    const plan = planSpaceDeletionPlaceholderCleanup(
      response?.allChromeTabs || response?.tabs || [],
      [...pendingIds],
    );
    for (const tabId of plan.missingTabIds) {
      pendingIds.delete(tabId);
      removedTabIds.push(tabId);
    }
    for (const tabId of plan.retainTabIds) {
      pendingIds.delete(tabId);
      retainedTabIds.push(tabId);
    }
    liveRetainedTabIds.push(...plan.retainLiveTabIds);

    const tabId = plan.closeTabIds.find((candidateId) => pendingIds.has(candidateId));
    if (!Number.isSafeInteger(tabId)) {
      retainedTabIds.push(...pendingIds);
      pendingIds.clear();
      break;
    }
    pendingIds.delete(tabId);
    try {
      await send('tabs:close', { tabId, preserveSnapshot: false }, messageOptions);
      removedTabIds.push(tabId);
    } catch (error) {
      retainedTabIds.push(tabId);
      failures.push({ stage: `closing aborted deletion placeholder tab ${tabId}`, error });
    }
  }

  state = projectSpaceDeletionPlaceholderMetadata(state, {
    removedTabIds,
    retainedTabIds,
    liveRetainedTabIds,
    restoreSpaceId: options.placeholderSpaceId,
    retainAsEphemeral: options.retainAsEphemeral,
  });
  syncSpaceDeletionPlaceholderMemory({
    removedTabIds,
    retainedTabIds,
    liveRetainedTabIds,
    retainAsEphemeral: options.retainAsEphemeral,
  });
  return failures;
}

function syncSpaceDeletionPlaceholderMemory({
  removedTabIds = [],
  retainedTabIds = [],
  liveRetainedTabIds = [],
  retainAsEphemeral = false,
} = {}) {
  const liveRetainedIds = new Set(liveRetainedTabIds.map(Number).filter(Number.isSafeInteger));
  for (const tabId of removedTabIds) forgetEphemeralTab(tabId);
  for (const tabId of retainedTabIds) {
    if (retainAsEphemeral && !liveRetainedIds.has(Number(tabId))) rememberEphemeralTab(tabId);
    else forgetEphemeralTab(tabId);
  }
}

async function withCreatedTabCheckpointRollback(createdTabIds, checkpoint, options = {}) {
  const pendingCreatedTabIds = new Set(
    createdTabIds.map(Number).filter(Number.isSafeInteger),
  );
  return rollbackCreatedTabsOnCheckpointFailure(
    createdTabIds,
    checkpoint,
    (tabId) => {
      for (const createdTabId of createdTabIds) {
        const numericTabId = Number(createdTabId);
        if (Number.isSafeInteger(numericTabId)) pendingCreatedTabIds.add(numericTabId);
      }
      return closeCreatedTabWithoutEmptyingWindow(tabId, pendingCreatedTabIds, options);
    },
  );
}

async function closeCreatedTabWithoutEmptyingWindow(tabId, pendingCreatedTabIds, options = {}) {
  const messageOptions = {
    windowBinding: options.windowBinding,
    // The tab already exists in the captured window. A later host move must
    // neither redirect nor suppress this compensating close.
    allowStaleWindowBinding: true,
  };
  const listed = await send('tabs:listAll', {}, messageOptions);
  const allTabs = listed.allChromeTabs || listed.tabs || [];
  const closingTab = allTabs.find((tab) => Number(tab.id) === Number(tabId));
  if (!closingTab) {
    pendingCreatedTabIds.delete(Number(tabId));
    forgetClosedTabMetadata({ id: tabId });
    return;
  }
  const sameWindowSurvivors = allTabs.filter((tab) => (
    Number(tab.windowId) === Number(closingTab.windowId) &&
    Number(tab.id) !== Number(tabId)
  ));
  const survivor = sameWindowSurvivors.find((tab) => (
    !pendingCreatedTabIds.has(Number(tab.id)) && tab.active
  )) || sameWindowSurvivors.find((tab) => !pendingCreatedTabIds.has(Number(tab.id))) ||
    sameWindowSurvivors.find((tab) => tab.active) || sameWindowSurvivors[0];
  if (!survivor) {
    // External activity can remove the original source after a checkpoint
    // fails. Keeping one newly-created page is safer than closing Chrome's
    // final tab and potentially exiting the browser on macOS.
    return;
  }
  const focused = await focusSpaceSwitchSurvivor({
    tabId: Number(survivor.id),
    guard: spaceSwitchFocusGuard(survivor),
    ...messageOptions,
  });
  const response = await send('tabs:close', {
    tabId,
    preserveSnapshot: false,
    requiredActiveSurvivorTabId: Number(focused.tab.id),
  }, messageOptions);
  if (response.skipped) {
    throw new Error('Chrome could not safely clean up a newly-created tab after the checkpoint failed.');
  }
  pendingCreatedTabIds.delete(Number(tabId));
  forgetClosedTabMetadata({ id: tabId });
}

async function closeEphemeralTabs(options = {}) {
  const windowBinding = options.windowBinding || null;
  const allowStaleWindowBinding = options.allowStaleWindowBinding === true;
  const loaded = await loadTabs({
    adopt: false,
    windowBinding,
    allowStaleWindowBinding,
  });
  if (loaded === false || !canUsePanelWindowBinding(windowBinding, { allowStaleWindowBinding })) {
    throw new Error('This panel moved to another Chrome window before temporary tabs could be closed.');
  }
  const ephemeralTabs = tabs.filter((tab) => isEphemeralTab(tab));
  const result = await closeTabsAndForgetMetadata(ephemeralTabs, {
    windowBinding,
    allowStaleWindowBinding,
  });
  if (result.closedTabIds.length > 0) {
    // Physical closes are already committed. Persist cleanup without touching
    // any window-to-Space mapping, even when the host epoch changed while the
    // background response was pending.
    await saveState({ persistWindowState: false });
  }
  await throwAfterPartialTabClose(result, {
    windowBinding,
    ...(allowStaleWindowBinding ? { reloadDormant: false } : {}),
  });
  if (ephemeralTabs.length) {
    const reloaded = await loadTabs({
      adopt: false,
      windowBinding,
      allowStaleWindowBinding,
    });
    if (reloaded === false || !canUsePanelWindowBinding(windowBinding, { allowStaleWindowBinding })) {
      throw new Error('This panel moved to another Chrome window before temporary tabs could be closed.');
    }
  }
}

function snapshotOpenSpace(spaceId, options = {}) {
  if (!spaceId) return;
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') state.spaceSnapshots = {};
  const view = buildSpaceViewForSpace(spaceId, options);
  const storedSnapshot = ensureSnapshotLifecycleIds(
    state.spaceSnapshots[spaceId],
    createSnapshotLifecycleId,
  );
  const provisionalBindings = bindLiveTabsToSnapshot(
    view,
    storedSnapshot ? { ...storedSnapshot, spaceId, sessionId: state.browserSessionId } : null,
    state.tabLifecycle,
  );
  const identifiedView = viewWithSnapshotLifecycleIdentity(view, provisionalBindings);
  const snapshotRefreshView = identifiedView.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => (
      (provisionalBindings[tab.id] || state.tabLifecycle?.[tab.id])?.trackingMode !== 'saved-target'
    )),
  }));
  const snapshot = ensureSnapshotLifecycleIds(
    mergeOpenSpaceSnapshot(snapshotRefreshView, storedSnapshot),
    createSnapshotLifecycleId,
  );
  const previousSnapshot = state.spaceSnapshots[spaceId];
  if (!snapshotHasPersistentContent(snapshot)) {
    delete state.spaceSnapshots[spaceId];
    if (spaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
    return;
  }
  state.spaceSnapshots[spaceId] = snapshot;
  state.tabLifecycle = {
    ...(state.tabLifecycle || {}),
    ...bindLiveTabsToSnapshot(
      identifiedView,
      { ...snapshot, spaceId, sessionId: state.browserSessionId },
      { ...(state.tabLifecycle || {}), ...provisionalBindings },
    ),
  };
  if (!sameSnapshotGroups(previousSnapshot, snapshot) && spaceId === dormantSpaceViewSpaceId) {
    dormantSpaceViewSpaceId = '';
  }
}

function viewWithSnapshotLifecycleIdentity(view = [], bindings = {}) {
  const claimedSnapshotGroupIds = new Set();
  const claimedSnapshotTabIds = new Set();
  return view.map((group) => {
    const boundGroupIds = new Set((group.tabs || [])
      .map((tab) => {
        const binding = bindings[tab.id] || state.tabLifecycle?.[tab.id];
        if (binding) {
          return lifecycleBindingMatchesPhysicalGroup(tab, binding)
            ? binding.snapshotGroupId
            : '';
        }
        return tab.snapshotGroupId;
      })
      .filter(Boolean));
    const snapshotGroupId = resolveViewSnapshotGroupId(
      group.snapshotGroupId,
      boundGroupIds,
      () => createSnapshotLifecycleId('group'),
      claimedSnapshotGroupIds,
    );
    return {
      ...group,
      snapshotGroupId,
      tabs: (group.tabs || []).map((tab) => {
        const binding = bindings[tab.id] || state.tabLifecycle?.[tab.id] || {};
        const bindingGroupId = lifecycleBindingMatchesPhysicalGroup(tab, binding)
          ? binding.snapshotGroupId
          : '';
        return {
          ...tab,
          snapshotTabId: claimViewSnapshotLifecycleId(
            binding.snapshotTabId || tab.snapshotTabId,
            claimedSnapshotTabIds,
            () => createSnapshotLifecycleId('tab'),
          ),
          snapshotGroupId: bindingGroupId || (!binding.snapshotTabId ? tab.snapshotGroupId : '') || snapshotGroupId,
          trackingMode: binding.trackingMode || tab.trackingMode || 'live',
          sessionId: binding.sessionId || tab.sessionId || state.browserSessionId,
        };
      }),
    };
  });
}

function lifecycleBindingMatchesPhysicalGroup(tab, binding) {
  const tabGroupId = Number(tab?.groupId);
  const bindingGroupId = Number(binding?.groupId);
  return Number.isSafeInteger(tabGroupId) &&
    Number.isSafeInteger(bindingGroupId) &&
    tabGroupId === bindingGroupId;
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
  const storedSnapshot = state.spaceSnapshots[spaceId];
  // preserveGroups only scaffolds an in-flight Auto Group plan. Left sticky it
  // keeps emptied Tags alive forever, so drop the flag (and let the sanitize
  // pass purge the emptied rows) unless the plan is running right now.
  if (storedSnapshot?.preserveGroups && !inFlightOrganizationPlanSpaceIds.has(spaceId)) {
    delete storedSnapshot.preserveGroups;
  }
  const snapshot = dropTemporarySnapshotGroups(
    sanitizeSnapshotWithLifecycleIds(
      storedSnapshot,
      createSnapshotLifecycleId,
    ),
  );
  if (!snapshotHasPersistentContent(snapshot)) {
    delete state.spaceSnapshots[spaceId];
    if (spaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
    return null;
  }
  state.spaceSnapshots[spaceId] = snapshot;
  return snapshot;
}

function createSnapshotLifecycleId(kind = 'item') {
  snapshotLifecycleIdSequence += 1;
  const randomId = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${snapshotLifecycleIdSequence}-${Math.random().toString(36).slice(2)}`;
  return `${kind}:${randomId}`;
}

function renameDormantSnapshotGroup(group, title) {
  const spaceId = state.activeSpaceId;
  const snapshot = state.spaceSnapshots?.[spaceId];
  commitDormantSnapshotProjection(
    spaceId,
    snapshot,
    projectDormantSnapshotGroupRename(snapshot, group, title, Date.now()),
  );
}

function deleteDormantSnapshotGroup(group) {
  const spaceId = state.activeSpaceId;
  const snapshot = state.spaceSnapshots?.[spaceId];
  if (findDormantSnapshotGroupIndex(snapshot, group) < 0) return false;
  commitDormantSnapshotProjection(
    spaceId,
    snapshot,
    projectDormantSnapshotGroupRemoval(snapshot, group, Date.now()),
  );
  return true;
}

function removeOpenedDormantTabFromSnapshot(tab, dormantGroup) {
  const spaceId = state.activeSpaceId;
  const snapshot = state.spaceSnapshots?.[spaceId];
  commitDormantSnapshotProjection(
    spaceId,
    snapshot,
    projectOpenedDormantTabRemoval(snapshot, tab, dormantGroup, Date.now()),
  );
}

function dormantGroupForTabReference(tab, groupKey = '') {
  return resolveDormantGroupReference(dormantSpaceView, tab, groupKey);
}

function dormantTabForMutation(group, reference) {
  return resolveDormantTabReference(group, reference);
}

function removeTabsFromSpaceSnapshot(spaceId, snapshotTabs) {
  const snapshot = state.spaceSnapshots?.[spaceId];
  commitDormantSnapshotProjection(
    spaceId,
    snapshot,
    projectSnapshotTabsRemoval(snapshot, snapshotTabs, Date.now()),
  );
}

function commitDormantSnapshotProjection(spaceId, previousSnapshot, nextSnapshot) {
  if (nextSnapshot === previousSnapshot) return;
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') {
    state.spaceSnapshots = {};
  }
  if (nextSnapshot) state.spaceSnapshots[spaceId] = nextSnapshot;
  else delete state.spaceSnapshots[spaceId];
  if (spaceId === dormantSpaceViewSpaceId) dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
}

async function persistDormantSnapshotMutation({ windowBinding, staleMessage } = {}) {
  const committed = await commitWindowBoundWrite({
    isCurrent: () => isCurrentPanelWindowBinding(windowBinding),
    write: () => persistStorageStep({
      key: STORAGE_KEY,
      value: stateForStorage(),
      get: storageGet,
      set: storageSet,
      remove: storageRemove,
    }),
  });
  if (!committed) {
    throw new Error(staleMessage || 'This panel moved to another Chrome window before the saved change could be stored.');
  }
}

function snapshotGroupKey(index, group = {}, spaceId = state.activeSpaceId) {
  return dormantSnapshotGroupKey(index, group, spaceId);
}

function sameSnapshotGroups(left, right) {
  return JSON.stringify(left?.groups || []) === JSON.stringify(right?.groups || []);
}

function hasDormantContent(spaceId) {
  return snapshotTabCount(dropTemporarySnapshotGroups(state.spaceSnapshots?.[spaceId])) > 0;
}

async function focusFirstTabInSpace(spaceId, options = {}) {
  if (options.reload !== false) await loadTabs({ adopt: false });
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
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    try {
      return await withFreshSpaceStateMutation(() => toggleGroup(currentGroupForMutation(group), {
        stateLocked: true,
        focusRestoreToken: options.focusRestoreToken,
        windowBinding,
      }), { windowBinding });
    } catch (error) {
      restoreDisclosureFocus(
        'group',
        currentDisclosureGroupKey(group),
        options.focusRestoreToken,
      );
      throw error;
    }
  }
  const rollback = captureChromeGroupMutationRollback();
  const previousCollapsed = Boolean(group.collapsed);
  const nextCollapsed = !group.collapsed;
  const groupId = groupIdFromKey(group.key);
  let chromeMutationMayHaveApplied = false;
  let chromeGroupMissing = false;
  try {
    state.collapsedGroups[group.key] = nextCollapsed;
    if (isVirtualGroupKey(group.key) && state.virtualGroups?.[group.key]) {
      state.virtualGroups[group.key].collapsed = nextCollapsed;
    } else if (!group.dormant && groupId !== null) {
      chromeMutationMayHaveApplied = true;
      const result = await send('groups:update', {
        groupId,
        update: { collapsed: nextCollapsed },
      }, { windowBinding });
      if (!result.group) {
        chromeMutationMayHaveApplied = false;
        chromeGroupMissing = true;
        throw new Error('This Chrome group no longer exists.');
      }
      if (Boolean(result.group.collapsed) !== nextCollapsed) {
        throw new Error('Chrome did not apply the requested group collapse state.');
      }
    }
    await saveState({ persistWindowState: false });
  } catch (error) {
    restoreChromeGroupMutationMemory(rollback);
    if (chromeGroupMissing) {
      let missingError;
      try {
        await refreshMissingChromeGroupView({ windowBinding });
        try {
          await saveState({ persistWindowState: false });
          missingError = new Error('This Chrome group no longer exists. The Space view was refreshed.');
        } catch (checkpointError) {
          missingError = new Error(
            `This Chrome group no longer exists. The Space view was refreshed, but its recovery could not be saved: ${checkpointError?.message || String(checkpointError)}`,
            { cause: checkpointError },
          );
        }
      } catch (refreshError) {
        missingError = new Error(
          `This Chrome group no longer exists, and the Space view could not refresh: ${refreshError?.message || String(refreshError)}`,
          { cause: refreshError },
        );
      }
      restoreDisclosureFocus('group', group.key, options.focusRestoreToken);
      throw missingError;
    }
    const rollbackFailures = [];
    let rollbackGroupMissing = false;
    if (chromeMutationMayHaveApplied && groupId !== null) {
      try {
        const result = await send('groups:update', {
          groupId,
          update: { collapsed: previousCollapsed },
        }, {
          windowBinding,
          allowStaleWindowBinding: true,
        });
        if (!result.group) {
          rollbackGroupMissing = true;
          throw new Error('The Chrome group disappeared before its collapse state could be restored.');
        }
        if (result.group && Boolean(result.group.collapsed) !== previousCollapsed) {
          throw new Error('Chrome kept the incorrect group collapse state.');
        }
      } catch (rollbackError) {
        rollbackFailures.push({ stage: 'restoring the Chrome group collapse state', error: rollbackError });
      }
    }
    if (rollbackGroupMissing) {
      let viewRefreshed = false;
      try {
        await refreshMissingChromeGroupView({ windowBinding });
        viewRefreshed = true;
      } catch (refreshError) {
        rollbackFailures.push({ stage: 'refreshing the Space view after the Chrome group disappeared', error: refreshError });
      }
      if (viewRefreshed) {
        try {
          await saveState({ persistWindowState: false });
        } catch (checkpointError) {
          rollbackFailures.push({ stage: 'saving the refreshed Space view after the Chrome group disappeared', error: checkpointError });
        }
      }
    } else {
      render();
    }
    restoreDisclosureFocus('group', group.key, options.focusRestoreToken);
    if (rollbackFailures.length > 0) throw createRollbackFailureError(error, rollbackFailures);
    throw error;
  }

  const action = nextCollapsed ? 'collapsed' : 'expanded';
  try {
    await refreshTabsView({ windowBinding });
  } catch (error) {
    lastRenderedGroupsSignature = '';
    render();
    restoreDisclosureFocus('group', group.key, options.focusRestoreToken);
    const message = `Group was ${action}, but the panel could not refresh yet: ${error?.message || String(error)}`;
    setStatus(message);
    showStatusToast(message, 'error');
    return;
  }
  try {
    await saveState({ persistWindowState: false });
  } catch (error) {
    restoreDisclosureFocus('group', group.key, options.focusRestoreToken);
    const message = `Group was ${action} and the panel refreshed, but the latest Space snapshot could not be saved: ${error?.message || String(error)}`;
    setStatus(message);
    showStatusToast(message, 'error');
    return;
  }
  restoreDisclosureFocus('group', group.key, options.focusRestoreToken);
}

async function refreshMissingChromeGroupView(options = {}) {
  lastRenderedGroupsSignature = '';
  await refreshTabsView({
    adopt: false,
    reloadDormant: true,
    windowBinding: options.windowBinding,
  });
}

function handleFolderHeaderClick(event, folder) {
  if (shouldSuppressHeaderClickAfterDrag(event)) return;
  const focusRestoreToken = disclosureFocusGuard.capture(
    document.activeElement === event.currentTarget,
  );
  runTask((windowBinding) => toggleFolder(folder.key, {
    focusRestoreToken,
    windowBinding,
  }));
}

function handleGroupHeaderClick(event, group) {
  if (shouldSuppressHeaderClickAfterDrag(event)) return;
  // Collapse-on-live saves and closes the group's tabs (closeGroupToSaved);
  // expand-on-dormant restores them (openDormantGroup). A folded live group
  // and an expanded dormant group toggle the plain disclosure state.
  const currentlyExpanded = !group.collapsed;
  if (group.dormant && !currentlyExpanded) {
    // Rows already live in another window must not be materialized locally:
    // expanding only discloses them (they render as Show-in-other-window).
    const rowsOpenInOtherWindows = (group.tabs || []).some((tab) => (
      tab.dormant && Number.isFinite(Number(tab.foreignWindowTabId))
    ));
    if (rowsOpenInOtherWindows) {
      runTask((windowBinding) => toggleGroup(group, { windowBinding }));
      return;
    }
    runTask((windowBinding) => openDormantGroup(group, { windowBinding }));
    return;
  }
  if (!group.dormant && currentlyExpanded) {
    runTask((windowBinding) => closeGroupToSaved(group, { windowBinding }));
    return;
  }
  const focusRestoreToken = disclosureFocusGuard.capture(
    document.activeElement === event.currentTarget,
  );
  runTask((windowBinding) => toggleGroup(group, {
    focusRestoreToken,
    windowBinding,
  }));
}

function currentDisclosureGroupKey(reference = {}) {
  const snapshotGroupId = String(reference.snapshotGroupId || '');
  if (!snapshotGroupId) return reference.key;
  const matches = spaceView.filter((group) => (
    String(group.snapshotGroupId || '') === snapshotGroupId
  ));
  return matches.length === 1 ? matches[0].key : reference.key;
}

function restoreDisclosureFocus(kind, key, focusRestoreToken) {
  if (!focusRestoreToken || !key) return false;
  const selector = kind === 'folder'
    ? `.folder-header[data-folder-key="${CSS.escape(key)}"]`
    : [
      `.group-card[data-group-key="${CSS.escape(key)}"] .group-toggle`,
      `.folder-direct-group[data-group-key="${CSS.escape(key)}"] .group-toggle`,
    ].join(', ');
  const target = document.querySelector(selector);
  if (!target) return false;
  return disclosureFocusGuard.restore(focusRestoreToken, () => {
    target.focus({ preventScroll: true });
  });
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
  runTask((windowBinding) => (
    intent === 'inside'
      ? moveGroupBlockIntoContext(sourceKeys, targetContext, { ...moveOptions, windowBinding })
      : moveGroupBlockBesideContext(sourceKeys, targetContext, intent, { ...moveOptions, windowBinding })
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
  return Boolean(element?.closest?.('.tab-row, button:not(.folder-header):not(.group-toggle), .group-actions'));
}

async function moveGroupBlockIntoContext(sourceKeys, targetContext, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      assertFreshOrganizationDrag(options);
      const currentTarget = dragContextForTarget(targetContext?.key);
      if (!currentTarget) throw new Error('The target group changed in another Space Tabs view. Try the drag again.');
      return moveGroupBlockIntoContext(sourceKeys, currentTarget, { ...options, stateLocked: true });
    }, { windowBinding });
  }
  const targetPath = targetContext?.path || [];
  if (!targetPath.length) return;

  const sourceContext = options.sourceContext;
  const visibleKeys = spaceView.map((group) => group.key);
  const sourceBlock = sourceKeys.filter((key) => visibleKeys.includes(key));
  if (sourceBlock.length === 0) return;

  const rollback = captureChromeGroupMutationRollback();
  let changed = false;
  await runChromeGroupMutationTransaction({
    apply: async () => {
      const nextKeys = [];
      const dormantMoves = [];
      const referenceOverrides = new Map();
      for (const sourceKey of sourceBlock) {
        const group = spaceView.find((item) => item.key === sourceKey);
        if (!group) continue;
        const nextTitle = groupTitleForNestedMove(group, sourceContext, targetPath);
        if (!nextTitle) continue;
        let nextKey;
        if (group.dormant) {
          dormantMoves.push({ key: group.key, title: nextTitle });
          nextKey = group.key;
        } else {
          rememberChromeGroupTitleRollback(rollback, group);
          nextKey = await retitleGroupForNestedMove(group, nextTitle, { windowBinding });
        }
        nextKeys.push(nextKey);
        referenceOverrides.set(nextKey, group);
      }
      if (nextKeys.length === 0) return;

      state.groupOrder[state.activeSpaceId] = groupOrderAfterNestedMove(
        visibleKeys,
        sourceKeys,
        targetContext,
        nextKeys,
      );
      if (dormantMoves.length) {
        moveDormantSnapshotGroupsToOrder(
          dormantMoves,
          state.groupOrder[state.activeSpaceId],
          referenceOverrides,
        );
      } else {
        reorderDormantSnapshotGroups(
          state.groupOrder[state.activeSpaceId],
          referenceOverrides,
        );
      }
      changed = true;
    },
    checkpoint: () => changed ? saveState({ persistWindowState: false }) : undefined,
    rollback: () => restoreChromeGroupMutationAfterFailure(rollback, { windowBinding }),
  });
  if (!changed) return;
  await refreshTabs({ windowBinding });
}

async function moveGroupBlockBesideContext(sourceKeys, targetContext, placement = 'before', options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      assertFreshOrganizationDrag(options);
      const currentTarget = dragContextForTarget(targetContext?.key);
      if (!currentTarget) throw new Error('The target group changed in another Space Tabs view. Try the drag again.');
      return moveGroupBlockBesideContext(sourceKeys, currentTarget, placement, { ...options, stateLocked: true });
    }, { windowBinding });
  }
  const targetPath = targetPathForSiblingMove(targetContext);
  const sourceContext = options.sourceContext;
  const visibleKeys = spaceView.map((group) => group.key);
  const sourceBlock = sourceKeys.filter((key) => visibleKeys.includes(key));
  if (sourceBlock.length === 0) return;

  const rollback = captureChromeGroupMutationRollback();
  let changed = false;
  await runChromeGroupMutationTransaction({
    apply: async () => {
      const nextKeys = [];
      const dormantMoves = [];
      const referenceOverrides = new Map();
      for (const sourceKey of sourceBlock) {
        const group = spaceView.find((item) => item.key === sourceKey);
        if (!group) continue;
        const nextTitle = groupTitleForNestedMove(group, sourceContext, targetPath);
        if (!nextTitle) continue;
        let nextKey;
        if (group.dormant) {
          dormantMoves.push({ key: group.key, title: nextTitle });
          nextKey = group.key;
        } else {
          rememberChromeGroupTitleRollback(rollback, group);
          nextKey = await retitleGroupForNestedMove(group, nextTitle, { windowBinding });
        }
        nextKeys.push(nextKey);
        referenceOverrides.set(nextKey, group);
      }
      if (nextKeys.length === 0) return;

      state.groupOrder[state.activeSpaceId] = groupOrderAfterSiblingMove(
        visibleKeys,
        sourceKeys,
        targetContext,
        nextKeys,
        placement,
      );
      if (dormantMoves.length) {
        moveDormantSnapshotGroupsToOrder(
          dormantMoves,
          state.groupOrder[state.activeSpaceId],
          referenceOverrides,
        );
      } else {
        reorderDormantSnapshotGroups(
          state.groupOrder[state.activeSpaceId],
          referenceOverrides,
        );
      }
      changed = true;
    },
    checkpoint: () => changed ? saveState({ persistWindowState: false }) : undefined,
    rollback: () => restoreChromeGroupMutationAfterFailure(rollback, { windowBinding }),
  });
  if (!changed) return;
  await refreshTabs({ windowBinding });
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

async function retitleGroupForNestedMove(group, title, options = {}) {
  if (isVirtualGroupKey(group.key)) {
    const logicalTitle = normalizeGroupTitle(title, 'Group');
    retitleActiveSpaceSnapshotGroup(group, logicalTitle);
    state.virtualGroups[group.key] = {
      ...(state.virtualGroups[group.key] || {}),
      id: group.key,
      title: logicalTitle,
      color: group.color || state.virtualGroups[group.key]?.color || 'blue',
      spaceId: state.activeSpaceId,
      collapsed: Boolean(state.collapsedGroups[group.key] ?? group.collapsed),
    };
    return group.key;
  }

  const groupId = groupIdFromKey(group.key);
  if (groupId !== null) {
    const result = await send('groups:update', {
      groupId,
      update: { title },
    }, { windowBinding: options.windowBinding });
    if (!result.group) throw new Error(`Chrome group ${groupId} no longer exists.`);
    logicalChromeGroupTitles.set(groupId, normalizeGroupTitle(title, 'Group'));
    retitleActiveSpaceSnapshotGroup(group, normalizeGroupTitle(title, 'Group'));
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

function retitleActiveSpaceSnapshotGroup(group, title) {
  const snapshot = activeSpaceSnapshot();
  if (!snapshot) return;
  const nextSnapshot = retitleSnapshotGroup(snapshot, group, title);
  const replacements = new Map();
  for (let index = 0; index < (snapshot.groups || []).length; index += 1) {
    const previousGroup = snapshot.groups[index];
    const nextGroup = nextSnapshot?.groups?.[index];
    if (!nextGroup || previousGroup.title === nextGroup.title) continue;
    replacements.set(
      snapshotGroupKey(index, previousGroup),
      snapshotGroupKey(index, nextGroup),
    );
  }
  if (nextSnapshot) state.spaceSnapshots[state.activeSpaceId] = nextSnapshot;
  replaceGroupOrderKeys(replacements);
  dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
}

function reorderDormantSnapshotGroups(orderedKeys, referenceOverrides = new Map()) {
  const snapshot = activeSpaceSnapshot();
  if (!snapshot) return;
  const visibleGroupsByKey = new Map(spaceView.map((group) => [group.key, group]));
  const references = (orderedKeys || [])
    .map((key) => referenceOverrides.get(key) || visibleGroupsByKey.get(key))
    .filter(Boolean);
  const nextSnapshot = projectSnapshotGroupOrder(snapshot, references, Date.now());
  if (nextSnapshot === snapshot) return;
  replaceActiveSpaceSnapshotGroups(nextSnapshot.groups);
}

function moveDormantSnapshotGroupsToOrder(
  moves,
  orderedKeys,
  referenceOverrides = new Map(),
) {
  for (const move of moves) {
    const group = spaceView.find((item) => item.key === move.key);
    if (group) renameDormantSnapshotGroup(group, move.title);
  }
  reorderDormantSnapshotGroups(orderedKeys, referenceOverrides);
}

function activeSpaceSnapshot() {
  if (!state.spaceSnapshots || typeof state.spaceSnapshots !== 'object') return null;
  return sanitizeSpaceSnapshot(state.spaceSnapshots[state.activeSpaceId]);
}

function snapshotGroupRecords(snapshot, spaceId = state.activeSpaceId) {
  return (snapshot?.groups || []).map((group, index) => ({
    index,
    key: snapshotGroupKey(index, group, spaceId),
    group: {
      ...group,
      tabs: [...(group.tabs || [])],
    },
  }));
}

function replaceActiveSpaceSnapshotGroups(groups, snapshotUpdates = null) {
  const snapshot = activeSpaceSnapshot();
  if (!snapshot) return;
  const baseSnapshot = snapshotUpdates && typeof snapshotUpdates === 'object'
    ? { ...snapshot, ...snapshotUpdates }
    : snapshot;
  const nextSnapshot = {
    ...baseSnapshot,
    updatedAt: Date.now(),
    groups: groups.filter((group) => snapshotGroupShouldPersist(baseSnapshot, group)),
  };
  const persistedSnapshot = snapshotHasPersistentContent(nextSnapshot) ? nextSnapshot : null;
  const remapped = remapSnapshotGroupIndexedState({
    beforeSnapshot: snapshot,
    afterSnapshot: persistedSnapshot,
    spaceId: state.activeSpaceId,
    groupOrder: state.groupOrder?.[state.activeSpaceId],
    collapsedGroups: state.collapsedGroups,
    tabOrder: state.tabOrder?.[state.activeSpaceId],
  });
  if (!state.groupOrder || typeof state.groupOrder !== 'object') state.groupOrder = {};
  if (!state.tabOrder || typeof state.tabOrder !== 'object') state.tabOrder = {};
  state.groupOrder[state.activeSpaceId] = remapped.groupOrder;
  state.collapsedGroups = remapped.collapsedGroups;
  state.tabOrder[state.activeSpaceId] = remapped.tabOrder;
  if (!persistedSnapshot) delete state.spaceSnapshots[state.activeSpaceId];
  else state.spaceSnapshots[state.activeSpaceId] = persistedSnapshot;
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
  const currentOrganization = organizationForCurrentSpaceState(state.activeSpaceId);
  if (
    options.expectedFingerprint &&
    currentOrganization.fingerprint !== options.expectedFingerprint
  ) {
    throw new Error('This Space changed in another Space Tabs view. Review it before dragging again.');
  }
}

function startTabDrag(event, tab, groupKey) {
  event.stopPropagation();
  if (tab?.pinned) {
    event.preventDefault();
    setStatus('Unpin this tab in Chrome before moving or grouping it.');
    return;
  }
  const organization = organizationForCurrentSpaceState(state.activeSpaceId);
  dragState = {
    type: 'tab',
    tabId: tab.id,
    tabUrl: tab.url,
    groupKey,
    sourceSpaceId: state.activeSpaceId,
    organizationFingerprint: organization.fingerprint,
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
  runTask((windowBinding) => reorderTab(tabId, targetGroupKey, targetTab, {
    ...moveOptions,
    windowBinding,
  }));
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
  runTask((windowBinding) => reorderTab(tabId, targetGroup.key, null, {
    ...moveOptions,
    windowBinding,
  }));
}

async function reorderTab(tabId, targetGroupKey, beforeTab, options = {}) {
  const windowBinding = options.windowBinding;
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
      return reorderTab(tabId, targetGroupKey, beforeTab, {
        ...options,
        stateLocked: true,
        targetGroup: currentTarget,
      });
    }, { windowBinding });
  }
  const numericTabId = Number(tabId);
  const tab = tabs.find((item) => item.id === numericTabId);
  const sourceGroup = spaceView.find((group) => liveTabsForOrdering(group).some((item) => item.id === numericTabId));
  const targetGroup = options.targetGroup || spaceView.find((group) => group.key === targetGroupKey);
  if (!tab || !sourceGroup || !targetGroup) return;
  if (
    beforeTab !== null &&
    beforeTab !== undefined &&
    !beforeTab?.dormant &&
    Number(beforeTab?.id ?? beforeTab) === numericTabId
  ) return;
  if (tab.pinned) {
    throw new Error('This tab was pinned while dragging. Unpin it in Chrome before moving or grouping it.');
  }

  const targetNeedsBatchMaterialization = targetGroupKey !== 'ungrouped' &&
    groupIdFromKey(targetGroup.key) === null;
  const affectedTabIds = uniqueNumberIds([
    tab.id,
    ...(targetNeedsBatchMaterialization
      ? liveTabsForOrdering(targetGroup).map((item) => item.id)
      : []),
  ]);
  const rollback = captureChromeGroupMutationRollback();
  rollback.membership = captureTabGroupMembership(tabs, spaceView, affectedTabIds);

  await runChromeGroupMutationTransaction({
    apply: async () => {
      let targetOrderKey = targetGroupKey;
      if (targetGroupKey === 'ungrouped') {
        if (isGroupedTab(tab)) {
          const ungrouped = await send('tabs:ungroup', { tabIds: [tab.id] }, { windowBinding });
          if (ungrouped.missing) {
            throw new Error('The dragged tab is no longer open. No order change was saved.');
          }
        }
        state.tabSpaces[tab.id] = state.activeSpaceId;
        delete state.tabGroups?.[tab.id];
      } else {
        const groupId = await ensureTabDropChromeGroup(targetGroup, tab.id, { windowBinding });
        if (groupId === null) throw new Error('Chrome could not create the target group.');
        if (!targetNeedsBatchMaterialization) {
          if (Number(tab.groupId) !== Number(groupId)) {
            const addedGroupId = await addTabsToChromeGroup(
              groupId,
              [tab.id],
              state.activeSpaceId,
              { windowBinding },
            );
            if (addedGroupId === null) throw new Error('Chrome could not move the tab into the target group.');
          } else {
            bindChromeGroup(groupId, state.activeSpaceId);
            clearLocalTabGrouping([tab.id]);
          }
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

      const dropPlan = planMixedTabDropOrder({
        tab,
        targetTabs: targetGroup.tabs,
        beforeTab,
      });
      if (dropPlan.status === 'invalid') {
        throw new Error('The tab drag target is invalid. Try the drag again.');
      }
      if (dropPlan.status === 'stale') {
        throw new Error('The target tab changed in another Space Tabs view. Try the drag again.');
      }
      spaceTabOrder[targetOrderKey] = dropPlan.order;

      if (targetGroup.tabs.some((item) => item.dormant)) {
        const snapshot = activeSpaceSnapshot();
        const nextSnapshot = projectSnapshotTabOrder(
          snapshot,
          targetGroup,
          dropPlan.visibleTabs,
          Date.now(),
        );
        if (!nextSnapshot) {
          throw new Error('The saved tab order changed in another Space Tabs view. Try the drag again.');
        }
        state.spaceSnapshots[state.activeSpaceId] = nextSnapshot;
        dormantSpaceViewSpaceId = '';
        lastRenderedGroupsSignature = '';
      }

      if (Number.isSafeInteger(dropPlan.anchorTabId)) {
        const expectedGroupId = groupIdFromKey(targetOrderKey) ?? -1;
        const moved = await send('tabs:moveRelative', {
          tabId: tab.id,
          anchorTabId: dropPlan.anchorTabId,
          edge: dropPlan.edge,
          expectedGroupId,
        }, { windowBinding });
        if (moved.missing) throw new Error('The source or target tab is no longer open. Try the drag again.');
      }
    },
    checkpoint: () => saveState({ persistWindowState: false }),
    rollback: () => restoreChromeGroupMutationAfterFailure(rollback, { windowBinding }),
  });
  await refreshTabs({ reloadDormant: true, windowBinding });
}

async function ensureTabDropChromeGroup(targetGroup, tabId, options = {}) {
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
    title: Object.hasOwn(targetGroup, 'title')
      ? String(targetGroup.title ?? '')
      : targetGroup.displayTitle || 'Group',
    color: targetGroup.color || nextGroupColor(),
    collapsed: Boolean(targetGroup.collapsed),
    sourceKey: targetGroup.key,
    windowBinding: options.windowBinding,
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
    return snapshotRemovalTargetForLiveTab(tab, group);
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

function snapshotRemovalTargetForLiveTab(tab, group) {
  const target = { ...tab };
  if (!group) return target;
  target.groupTitle = Object.hasOwn(group, 'title')
    ? String(group.title ?? '')
    : 'Ungrouped';
  target.groupColor = String(group.color || (
    target.groupTitle === 'Ungrouped' ? 'grey' : 'blue'
  ));
  return target;
}

function snapshotHasExactTargetInGroup(snapshot, target) {
  const targetUrlIdentity = snapshotUrlIdentity(target?.url);
  if (!targetUrlIdentity || !Object.hasOwn(target || {}, 'groupTitle')) return false;
  const targetGroupTitle = String(target.groupTitle ?? '');
  const targetGroupColor = String(target.groupColor || (
    targetGroupTitle === 'Ungrouped' ? 'grey' : 'blue'
  ));
  return (snapshot.groups || []).some((group) => {
    const groupTitle = Object.hasOwn(group, 'title')
      ? String(group.title ?? '')
      : 'Ungrouped';
    const groupColor = String(group.color || (
      groupTitle === 'Ungrouped' ? 'grey' : 'blue'
    ));
    return (
      groupTitle === targetGroupTitle &&
      groupColor === targetGroupColor &&
      (group.tabs || []).some((tab) => snapshotUrlIdentity(tab.url) === targetUrlIdentity)
    );
  });
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
  const recentlyOpenedSnapshotTabIds = uniqueKeys(
    recentlyOpenedMatches.map((item) => String(item.snapshotTabId || '').trim()),
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
    snapshotTabId: String(
      tab?.snapshotTabId ||
      state.tabLifecycle?.[tabId]?.snapshotTabId ||
      (recentlyOpenedSnapshotTabIds.length === 1 ? recentlyOpenedSnapshotTabIds[0] : ''),
    ),
    urlIdentities,
    navigationUrlKeys,
    titleDomainPairs,
    groupKey: chromeGroupTitleKey(sourceGroup?.title || ''),
  };
}

function removeSnapshotTabsForTarget(snapshot, target, options = {}) {
  const match = resolveSnapshotTabRemovalMatch(snapshot, target, options);
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
  const groupKey = chromeGroupTitleKey(dormantGroup?.title || '');
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
    snapshotGroupId: String(dormantGroup?.snapshotGroupId || tab?.snapshotGroupId || ''),
    snapshotTabId: String(tab?.snapshotTabId || ''),
    tabId: Number.isFinite(Number(tabId)) ? Number(tabId) : null,
    openedAt: Date.now(),
  });
}

function recentlyOpenedDormantRecordForLiveTab(tab, groupReference) {
  pruneRecentlyOpenedDormantTabs();
  return resolveOpenedDormantRecordForLiveTab(tab, recentlyOpenedDormantTabs, {
    groupReference,
    liveTabs: tabs,
  });
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
    hasUsableAISettings(aiSettings)
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
    !tab.dormant && !tab.pinned && !hasManualPanelName(tab.id) &&
    Number.isFinite(Number(tab.id)) && isPageShortcutCapableUrl(tab.url)
  )));
}

function hasCurrentTidyRunCandidates() {
  // Duplicate Tags and saved-row merges can act even without live tabs, and
  // grouping/naming candidates cover the AI paths, so ask both questions.
  if (hasCurrentTidyNamesAICandidates()) return true;
  try {
    const sourceSpaceId = state.activeSpaceId;
    const snapshot = state.spaceSnapshots?.[sourceSpaceId] || { version: 1, groups: [] };
    const organization = buildOrganizationCandidates({
      liveGroups: buildSpaceViewForSpace(sourceSpaceId),
      snapshot,
    });
    const foreignCandidateIds = foreignOpenOrganizationCandidateIds(organization, sourceSpaceId);
    return organization.candidates.some((tab) => (
      !foreignCandidateIds.has(Number(tab.id)) &&
      !tab.pinned &&
      isPageShortcutCapableUrl(tab.url)
    )) || fingerprintTidyDuplicateTags(snapshot) !== '';
  } catch {
    // Requesting up front is safer than losing the click gesture when local state is malformed.
    return true;
  }
}

function prepareTidyRequestFromUserGesture() {
  return prepareOrganizationAIRequestFromUserGesture(hasCurrentTidyRunCandidates);
}

function startTidyNamesFromUserGesture() {
  const request = prepareTidyRequestFromUserGesture();
  void runTask((windowBinding) => runTidy({ ...request, windowBinding }));
}

async function runTidy(options = {}) {
  const windowBinding = options.windowBinding;
  const startedAt = performance.now();
  const aiSettings = options.aiSettings || structuredClone(state.ai);
  const permissionRequest = options.permissionRequest || Promise.resolve(true);
  const permissionRequested = options.permissionRequested === true;
  const rules = normalizeTidyRuleSettings(state.tidyRules);
  const groupTopicEnabled = tidyRuleEnabled(rules, 'group-by-topic');
  const groupDomainEnabled = tidyRuleEnabled(rules, 'group-by-domain');
  const renameEnabled = tidyRuleEnabled(rules, 'rename-tabs');
  const dedupeUrlsEnabled = tidyRuleEnabled(rules, 'dedupe-urls');
  const groupRuleText = tidyRulePrompt(rules, 'group-by-topic');
  const renameRuleText = tidyRulePrompt(rules, 'rename-tabs');
  beginPanelAction('tidyNames');
  try {
    const refreshed = await refreshOrganizationActionState({ adopt: true, windowBinding });
    if (refreshed === false) return;
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
    const foreignCandidateIds = foreignOpenOrganizationCandidateIds(organization, sourceSpaceId);
    const candidates = organization.candidates.filter((tab) => (
      !foreignCandidateIds.has(Number(tab.id)) &&
      !tab.pinned &&
      isPageShortcutCapableUrl(tab.url)
    ));
    const duplicateSnapshotPlan = mergeDuplicateSnapshotTags(sourceSnapshot, sourceSnapshot.updatedAt);
    const duplicateLiveBuckets = duplicateActiveGroupBuckets();
    const duplicateLiveGroupCount = duplicateLiveBuckets
      .reduce((sum, bucket) => sum + bucket.length - 1, 0);
    const duplicateTagSummary = combineDuplicateTagMergePlans(
      duplicateSnapshotPlan.merges,
      duplicateLiveBuckets.map((bucket) => ({
        title: bucket[0]?.title,
        mergedCount: bucket.length - 1,
      })),
    );
    const duplicateGroupCount = duplicateTagSummary.mergedCount;
    const duplicateGroupFingerprint = fingerprintTidyDuplicateTags(sourceSnapshot);
    const visibleTabs = spaceView
      .flatMap((group) => group.tabs)
      .filter((tab) => (
        !tab.dormant && Number.isFinite(Number(tab.id)) && isPageShortcutCapableUrl(tab.url)
      ));

    const renameableTabs = visibleTabs.filter((tab) => !tab.pinned);
    const aiCandidates = renameableTabs.filter((tab) => !hasManualPanelName(tab.id));
    const useRenameAI = renameEnabled && aiCandidates.length > 0 && hasUsableAISettings(aiSettings);
    const localNames = planTidyTabNames(renameableTabs, {
      existingNames: state.renamedTabs,
      preserveExisting: true,
    });
    let namingResult = { names: {}, sourceLabel: 'Local naming' };
    if (useRenameAI) {
      const provider = providerById(aiSettings.provider);
      setStatus(`Tidying ${aiCandidates.length} ${aiCandidates.length === 1 ? 'tab' : 'tabs'} with ${provider.label}...`);
      namingResult = await tidyTabNamesWithAI(aiCandidates, {
        permissionRequest: permissionRequested ? permissionRequest : null,
        settings: aiSettings,
        windowBinding,
        rules: renameRuleText,
      });
      if (!isCurrentPanelWindowBinding(windowBinding)) {
        throw new Error(
          'This panel moved to another Chrome window before Tidy could apply. ' +
          'Nothing was changed; run Tidy again in the current window.',
        );
      }
    }
    const plannedNames = { ...localNames, ...namingResult.names };
    const renameItems = renameEnabled
      ? renameableTabs
        .map((tab) => ({
          id: Number(tab.id),
          title: tab.displayTitle || tab.title || 'Untitled',
          result: plannedNames[tab.id] || tab.displayTitle || tab.title || 'Untitled',
          meta: tab.domain,
        }))
        .filter((item) => item.title !== item.result)
      : [];

    let plannedGroups = [];
    let skippedTopicNotice = '';
    if (groupTopicEnabled && candidates.length > 0) {
      if (!hasUsableAISettings(aiSettings)) {
        skippedTopicNotice =
          'Topic grouping needs a configured AI provider. Add your API key in Settings to group by topic.';
      } else {
        try {
          const provider = providerById(aiSettings.provider);
          setStatus(`Generating Tidy grouping preview with ${provider.label} for ${candidates.length} ${candidates.length === 1 ? 'tab' : 'tabs'}...`);
          if (permissionRequested) await permissionRequest;
          else await ensureAIHostPermission(aiSettings);
          const response = await send('ai:chat', {
            settings: aiSettings,
            purpose: 'auto-group',
            itemCount: candidates.length,
            messages: createPrompt('tidy-tabs', {
              rules: groupRuleText,
              tabs: candidates.map((candidate) => ({
                ...compactTabForAI(candidate),
                currentGroup: candidate.currentGroup?.title || 'Ungrouped',
                status: candidate.dormant ? 'saved' : 'live',
              })),
            }),
          }, { windowBinding });
          if (!isCurrentPanelWindowBinding(windowBinding)) {
            throw new Error(
              'This panel moved to another Chrome window before Tidy could create a preview.',
            );
          }
          if (response.finishReason === 'length') {
            throw new Error('The provider reached the Tidy output limit. No groups were changed; try again with fewer tabs.');
          }
          plannedGroups = sanitizeTidyGroups(parseTidyGroups(response.text), candidates);
          if (plannedGroups.length === 0) {
            throw new Error('AI returned no valid groups. Check the configured model and try again.');
          }
          assertCompleteAutoGroupPlan(plannedGroups, candidates);
        } catch (error) {
          throw new Error(`${formatAIError(error)} Tidy stopped without making changes.`);
        }
      }
    }

    const resolvedPlan = resolveOrganizationPlanChanges({
      plannedGroups,
      candidates,
      existingGroups: organizationTargetGroups(sourceSpaceId, sourceSnapshot),
    });
    // The preview renders a per-tab diff: tabs the resolution marked unchanged
    // already sit in their target Tag and must read as "already there", not as
    // moves. The domain rule may re-resolve the plan below, so both stay
    // mutable and refresh with the final plan.
    let previewGroups = resolvedPlan.previewGroups;
    plannedGroups = resolvedPlan.plannedGroups;
    let unchangedPlannedIds = new Set(resolvedPlan.unchangedCandidateIds);

    // The local domain rule only buckets tabs the topic plan left untouched.
    const topicPlannedIds = new Set(plannedGroups.flatMap((group) => group.tabIds.map(Number)));
    if (groupDomainEnabled) {
      const domainCandidates = candidates.filter((candidate) => !topicPlannedIds.has(Number(candidate.id)));
      const domainPlan = planTidyGroups(domainCandidates);
      const combined = [...plannedGroups];
      for (const domainGroup of domainPlan) {
        const existing = combined.find((group) => (
          groupTitleKey(group.title) === groupTitleKey(domainGroup.title)
        ));
        if (existing) {
          for (const tabId of domainGroup.tabIds) {
            if (!existing.tabIds.map(Number).includes(Number(tabId))) existing.tabIds.push(tabId);
          }
        } else {
          combined.push(domainGroup);
        }
      }
      if (combined.length > plannedGroups.length || combined.some((group, index) => group !== plannedGroups[index])) {
        const domainResolved = resolveOrganizationPlanChanges({
          plannedGroups: combined,
          candidates,
          existingGroups: organizationTargetGroups(sourceSpaceId, sourceSnapshot),
        });
        plannedGroups = domainResolved.plannedGroups;
        previewGroups = domainResolved.previewGroups;
        unchangedPlannedIds = new Set(domainResolved.unchangedCandidateIds);
      }
    }

    const urlCloseIds = dedupeUrlsEnabled ? planDuplicateUrlClosures(visibleTabs) : [];

    if (
      plannedGroups.length === 0 &&
      renameItems.length === 0 &&
      urlCloseIds.length === 0 &&
      duplicateGroupCount === 0
    ) {
      const message = skippedTopicNotice ||
        (foreignCandidateIds.size > 0 && candidates.length === 0
          ? 'Tabs open in another window are left unchanged. Open Space Tabs in that window to organize them.'
          : 'Tidy found no changes to apply. These tabs are already organized.');
      setStatus(message);
      showStatusToast(message, skippedTopicNotice ? 'info' : 'success');
      return;
    }

    const regroupedTabIds = new Set(plannedGroups.flatMap((group) => group.tabIds.map(Number)));
    const regroupedCount = regroupedTabIds.size;
    const tabsById = new Map(candidates.map((tab) => [Number(tab.id), tab]));
    const groupedCount = plannedGroups.reduce((sum, group) => sum + group.tabIds.length, 0);
    const previewGroupedCount = previewGroups.reduce((sum, group) => sum + group.tabIds.length, 0);
    const previewSections = [];
    if (urlCloseIds.length > 0) {
      const closeById = new Map(visibleTabs.map((tab) => [Number(tab.id), tab]));
      previewSections.push({
        title: 'Close duplicate tabs',
        color: 'red',
        kind: 'notice',
        countLabel: `${urlCloseIds.length} ${urlCloseIds.length === 1 ? 'tab' : 'tabs'}`,
        items: urlCloseIds.map((tabId) => {
          const tab = closeById.get(Number(tabId));
          return {
            title: tab?.displayTitle || tab?.title || 'Untitled',
            meta: 'Same URL is already open; this copy closes',
            badge: 'Duplicate',
          };
        }),
      });
    }
    previewSections.push(...previewGroups.map((group) => ({
      title: group.title,
      color: group.color,
      kind: 'group',
      items: group.tabIds.map((tabId) => {
        const tab = tabsById.get(Number(tabId));
        const fromTitle = tab?.currentGroup?.title || 'Ungrouped';
        if (unchangedPlannedIds.has(Number(tabId))) {
          return {
            title: tab?.displayTitle || tab?.title || 'Untitled',
            meta: domainFromUrl(tab?.url || ''),
            badge: tab?.dormant ? 'Saved' : 'Live',
            unchanged: true,
            source: fromTitle,
          };
        }
        return {
          title: tab?.displayTitle || tab?.title || 'Untitled',
          meta: domainFromUrl(tab?.url || ''),
          badge: tab?.dormant ? 'Saved' : 'Live',
          diff: { from: fromTitle, to: group.title },
        };
      }),
    })));
    const candidateIds = new Set(candidates.map((candidate) => Number(candidate.id)));
    const notSentCandidates = organization.candidates.filter((candidate) => !candidateIds.has(Number(candidate.id)));
    const plannedTargetTitleKeys = new Set(plannedGroups.map((group) => groupTitleKey(group.title)));
    const mergedDuplicateTitleKeys = new Set(
      duplicateTagSummary.merges.map((merge) => groupTitleKey(merge.title)),
    );
    const emptySnapshotTags = (sourceSnapshot.groups || []).filter((group) => (
      !isUngroupedSnapshotGroup(group) && (group.tabs || []).length === 0
    ));
    const emptyHistoricalTags = emptySnapshotTags.filter((group) => (
      !plannedTargetTitleKeys.has(groupTitleKey(group.title)) &&
      !mergedDuplicateTitleKeys.has(groupTitleKey(group.title))
    ));
    if (notSentCandidates.length > 0 || emptyHistoricalTags.length > 0) {
      previewSections.push({
        title: 'Untouched',
        color: 'grey',
        kind: 'notice',
        items: [
          ...notSentCandidates.map((candidate) => ({
            title: candidate.title || candidate.url || 'Untitled',
            meta: foreignCandidateIds.has(Number(candidate.id))
              ? `${candidate.currentGroup?.title || 'Ungrouped'} · open in another window and unchanged`
              : candidate.pinned
              ? `${candidate.currentGroup?.title || 'Ungrouped'} · pinned`
              : `${candidate.currentGroup?.title || 'Ungrouped'} · restricted URL`,
            badge: foreignCandidateIds.has(Number(candidate.id))
              ? 'Other window'
              : candidate.dormant ? 'Saved' : 'Live',
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
        countLabel: `${duplicateGroupCount} ${duplicateGroupCount === 1 ? 'Tag' : 'Tags'}`,
        items: duplicateTagSummary.merges.map((merge) => ({
          title: merge.title || 'Tag',
          meta: merge.snapshotMergedCount > 0
            ? `${merge.mergedCount + 1} Tags · ${merge.appendedRowCount} ${merge.appendedRowCount === 1 ? 'saved row' : 'saved rows'} appended`
            : `${merge.liveMergedCount + 1} live Tags will be combined`,
        })),
      });
    }
    if (renameItems.length > 0) {
      previewSections.push({
        title: 'Rename tabs',
        color: 'cyan',
        kind: 'notice',
        countLabel: `${renameItems.length} ${renameItems.length === 1 ? 'tab' : 'tabs'}`,
        items: renameItems.map((item) => ({
          title: item.title,
          meta: item.meta || 'no domain',
          rename: { from: item.title, to: item.result },
        })),
      });
    }
    const previewSummary = [];
    if (plannedGroups.length > 0) {
      previewSummary.push(`${previewGroupedCount} ${previewGroupedCount === 1 ? 'tab' : 'tabs'} → ${previewGroups.length} ${previewGroups.length === 1 ? 'group' : 'groups'}`);
    }
    if (regroupedCount > 0) previewSummary.push(`${regroupedCount} moving`);
    if (duplicateGroupCount > 0) {
      previewSummary.push(`${duplicateGroupCount} ${duplicateGroupCount === 1 ? 'merge' : 'merges'}`);
    }
    if (renameItems.length > 0) {
      previewSummary.push(`${renameItems.length} ${renameItems.length === 1 ? 'rename' : 'renames'}`);
    }
    if (urlCloseIds.length > 0) {
      previewSummary.push(`${urlCloseIds.length} duplicate ${urlCloseIds.length === 1 ? 'tab' : 'tabs'} closing`);
    }
    previewSummary.push(formatPreviewDuration(performance.now() - startedAt));
    const confirmed = await showPlanPreview({
      title: 'Tidy Preview',
      message: previewSummary.join(' · '),
      confirmText: 'Apply tidy',
      sections: previewSections,
      variant: 'groups',
    });
    if (!confirmed) return;

    let createdGroups = 0;
    let mergedGroups = 0;
    let postCommitWarning = '';
    if (plannedGroups.length > 0 || duplicateGroupCount > 0) {
      await applyTidyGroupingPhase({
        sourceSpaceId,
        sourceSnapshot,
        organization,
        foreignCandidateIds,
        duplicateSnapshotPlan,
        duplicateLiveGroupCount,
        duplicateGroupCount,
        duplicateGroupFingerprint,
        previewGroups,
        plannedGroups,
        aiSettings,
        windowBinding,
        onProgress: (created, merged) => {
          createdGroups = created;
          mergedGroups = merged;
        },
        onWarning: (message) => {
          postCommitWarning = message;
        },
      });
    }
    if (renameItems.length > 0) {
      await applyTidyNamingPhase({
        sourceSpaceId,
        renameItems,
        namingResult,
        windowBinding,
        onWarning: (message) => {
          postCommitWarning = postCommitWarning || message;
        },
      });
    }

    if (urlCloseIds.length > 0) {
      // Close each duplicate by id through the reviewed single-tab close so
      // snapshot rows, saved order, and lifecycle metadata stay consistent.
      const closeById = new Map(tabs.map((tab) => [Number(tab.id), tab]));
      for (const tabId of urlCloseIds) {
        const tab = closeById.get(Number(tabId));
        if (!tab) continue;
        const hostGroup = spaceView.find((group) => (group.tabs || []).some((candidate) => (
          Number(candidate.id) === Number(tabId)
        )));
        await closeTab(tab, hostGroup?.key || '', { windowBinding });
      }
    }

    const statusParts = [];
    if (groupedCount > 0) statusParts.push(`grouped ${groupedCount} tabs`);
    if (createdGroups) statusParts.push(`created ${createdGroups}`);
    if (duplicateGroupCount > 0) {
      statusParts.push(`merged ${duplicateGroupCount} duplicate ${duplicateGroupCount === 1 ? 'Tag' : 'Tags'}`);
    }
    if (renameItems.length > 0) {
      statusParts.push(`renamed ${renameItems.length} ${renameItems.length === 1 ? 'tab' : 'tabs'} in the panel`);
    }
    if (urlCloseIds.length > 0) {
      statusParts.push(`closed ${urlCloseIds.length} duplicate ${urlCloseIds.length === 1 ? 'tab' : 'tabs'}`);
    }
    setStatus(`Tidy updated ${currentSpace().name}: ${statusParts.join(', ') || 'nothing changed'}.`);
    if (postCommitWarning) {
      showStatusToast(postCommitWarning, 'info');
    } else if (skippedTopicNotice) {
      showStatusToast(skippedTopicNotice, 'info');
    }
  } finally {
    endPanelAction();
  }
}

async function applyTidyGroupingPhase(plan = {}, options = {}) {
  const sourceSpaceId = plan.sourceSpaceId;
  const windowBinding = options.windowBinding;
  let committed = false;
  let createdGroups = 0;
  let mergedGroups = 0;
  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) {
      throw new Error(
        'This panel moved before Tidy could apply the reviewed changes. ' +
        'Nothing was changed; review a fresh preview in the current window.',
      );
    }
    if (state.activeSpaceId !== sourceSpaceId) {
      throw new Error('The active Space changed while Tidy was open. Run it again in the current Space.');
    }
    const rollback = captureChromeGroupMutationRollback();
    const loaded = await loadTabs({ adopt: true, windowBinding });
    if (loaded === false) {
      throw new Error(
        'This panel moved before Tidy could apply the reviewed changes. ' +
        'Nothing was changed; review a fresh preview in the current window.',
      );
    }
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
    if (fingerprintTidyDuplicateTags(currentSnapshot) !== plan.duplicateGroupFingerprint) {
      throw new Error('Duplicate Tags changed while the preview was open. Review a fresh preview before applying.');
    }
    const currentDuplicateSnapshotPlan = mergeDuplicateSnapshotTags(currentSnapshot);
    if (
      currentDuplicateSnapshotPlan.mergedCount !== plan.duplicateSnapshotPlan.mergedCount ||
      countDuplicateActiveGroups() !== plan.duplicateLiveGroupCount
    ) {
      throw new Error('Duplicate Tags changed while the preview was open. Review a fresh preview before applying.');
    }
    const rebasedPreviewGroups = rebaseOrganizationPlan({
      previewCandidates: plan.organization.candidates,
      currentCandidates: currentOrganization.candidates,
      plannedGroups: plan.previewGroups,
    });
    const currentResolvedPlan = resolveOrganizationPlanChanges({
      plannedGroups: rebasedPreviewGroups,
      candidates: currentOrganization.candidates,
      existingGroups: organizationTargetGroups(sourceSpaceId, currentSnapshot),
    });
    if (JSON.stringify(currentResolvedPlan.previewGroups) !== JSON.stringify(rebasedPreviewGroups)) {
      throw new Error('A Tidy target changed while the preview was open. Review a fresh preview before applying.');
    }
    const rebasedPlannedGroups = currentResolvedPlan.plannedGroups;
    const groupedCount = rebasedPlannedGroups.reduce((sum, group) => sum + group.tabIds.length, 0);
    const currentForeignCandidateIds = foreignOpenOrganizationCandidateIds(
      currentOrganization,
      sourceSpaceId,
    );
    if (rebasedPreviewGroups.some((group) => (
      group.tabIds.some((candidateId) => currentForeignCandidateIds.has(Number(candidateId)))
    ))) {
      throw new Error(
        'A Tidy target is now open in another window. ' +
        'Open Space Tabs there or review a fresh preview before applying.',
      );
    }
    const currentEligibleCandidateIds = new Set(currentOrganization.candidates
      .filter((candidate) => (
        !currentForeignCandidateIds.has(Number(candidate.id)) &&
        !candidate.pinned &&
        isPageShortcutCapableUrl(candidate.url)
      ))
      .map((candidate) => Number(candidate.id)));
    const rebasedCandidateIds = rebasedPreviewGroups
      .flatMap((group) => group.tabIds.map(Number));
    const rebasedCandidateIdSet = new Set(rebasedCandidateIds);
    // A reviewed plan that groups tabs must still cover exactly the eligible
    // set. Merge-only or rename-only plans legitimately group nothing, so the
    // duplicate-Tag fingerprints above remain their freshness guard.
    if (
      rebasedPreviewGroups.length > 0 &&
      (rebasedCandidateIds.length !== currentEligibleCandidateIds.size ||
      rebasedCandidateIdSet.size !== rebasedCandidateIds.length ||
      rebasedCandidateIds.some((candidateId) => !currentEligibleCandidateIds.has(candidateId)) ||
      [...currentEligibleCandidateIds].some((candidateId) => !rebasedCandidateIdSet.has(candidateId)))
    ) {
      throw new Error(
        'The eligible tabs changed while the preview was open. ' +
        'Review a fresh preview before applying.',
      );
    }

    const beforeSnapshot = structuredClone(currentSnapshot);
    const beforeLive = captureLiveOrganization(sourceSpaceId);
    const canonicalLiveGroupIds = canonicalLiveChromeGroupIdsByTitle(currentSnapshot);
    const organizedSnapshot = applyOrganizationPlanToSnapshot({
      snapshot: currentSnapshot,
      candidates: currentOrganization.candidates,
      plannedGroups: rebasedPlannedGroups,
    });
    const identifiedOrganizedSnapshot = ensureSnapshotLifecycleIds(
      organizedSnapshot,
      createSnapshotLifecycleId,
    );
    const appliedDuplicateSnapshotPlan = mergeDuplicateSnapshotTags(
      identifiedOrganizedSnapshot,
    );
    const beforeSnapshotGroupReferences = captureMergedSnapshotGroupReferences(
      appliedDuplicateSnapshotPlan.snapshotGroupIdReplacements,
    );
    rollback.membership = captureTabGroupMembership(
      tabs,
      groups,
      beforeLive.tabs.map((tab) => tab.tabId),
    );
    const candidateById = new Map(currentOrganization.candidates.map((candidate) => [Number(candidate.id), candidate]));
    const livePlannedGroups = rebasedPlannedGroups
      .map((group) => ({
        ...group,
        tabIds: group.tabIds
          .map((candidateId) => Number(candidateById.get(Number(candidateId))?.source?.live?.tabId))
          .filter(Number.isFinite),
      }))
      .filter((group) => group.tabIds.length > 0);

    const runPlanInFlight = async (transaction) => {
      inFlightOrganizationPlanSpaceIds.add(sourceSpaceId);
      try {
        return await transaction();
      } finally {
        inFlightOrganizationPlanSpaceIds.delete(sourceSpaceId);
      }
    };
    await runPlanInFlight(() => runChromeGroupMutationTransaction({
      apply: async () => {
        replaceActiveSpaceSnapshotGroups(
          appliedDuplicateSnapshotPlan.snapshot.groups,
          appliedDuplicateSnapshotPlan.snapshot,
        );
        dormantSpaceViewSpaceId = '';

        mergedGroups = await mergeDuplicateGroupsInActiveSpace({
          windowBinding,
          canonicalGroupIdsByTitle: canonicalLiveGroupIds,
        });
        remapMergedSnapshotGroupReferences(
          appliedDuplicateSnapshotPlan.snapshotGroupIdReplacements,
        );
        if (mergedGroups) {
          const reloaded = await loadTabs({ adopt: false, windowBinding });
          if (reloaded === false) {
            throw new Error('This panel moved before duplicate groups could finish merging.');
          }
        }
        const existingGroupsByTitle = activeChromeGroupsByTitle();
        for (const group of livePlannedGroups) {
          const titleKey = groupTitleKey(group.title);
          let groupId = existingGroupsByTitle.get(titleKey)?.id;
          if (Number.isFinite(Number(groupId))) {
            const nextGroupId = await addTabsToChromeGroup(
              groupId,
              group.tabIds,
              state.activeSpaceId,
              { windowBinding },
            );
            if (nextGroupId === null) {
              throw new Error(`Chrome could not apply the proposed group "${group.title}".`);
            }
            groupId = nextGroupId;
          } else {
            groupId = await createChromeGroup(group.tabIds, {
              title: group.title,
              color: group.color || nextGroupColor(),
              collapsed: Boolean(group.collapsed),
              windowBinding,
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

        mergedGroups += await mergeDuplicateGroupsInActiveSpace({ windowBinding });
        const loadedAfterGrouping = await loadTabs({ adopt: false, windowBinding });
        if (loadedAfterGrouping === false) {
          throw new Error('This panel moved before Tidy could verify the Chrome groups.');
        }
        checkpointAutoGroupLifecycleBindings(
          rebasedPlannedGroups,
          candidateById,
          sourceSpaceId,
        );
        const refreshed = await refreshTabsView({
          reloadDormant: true,
          render: false,
          windowBinding,
        });
        if (refreshed === false) {
          throw new Error('This panel moved before Tidy could verify the saved Space view.');
        }
        if (
          mergeDuplicateSnapshotTags(state.spaceSnapshots?.[sourceSpaceId]).mergedCount > 0 ||
          countDuplicateActiveGroups() > 0
        ) {
          throw new Error('Tidy could not finish merging duplicate Tags. The change was rolled back.');
        }
        assertLivePlannedGroupsApplied(livePlannedGroups, sourceSpaceId);

        const operationSummary = groupedCount > 0
          ? `Tidy organized ${groupedCount} ${groupedCount === 1 ? 'tab' : 'tabs'}` +
            (plan.duplicateGroupCount > 0
              ? ` and merged ${plan.duplicateGroupCount} duplicate ${plan.duplicateGroupCount === 1 ? 'Tag' : 'Tags'}`
              : '')
          : `Tidy merged ${plan.duplicateGroupCount} duplicate ${plan.duplicateGroupCount === 1 ? 'Tag' : 'Tags'}`;
        recordOperation({
          type: 'auto-group',
          spaceId: sourceSpaceId,
          summary: operationSummary,
          before: {
            snapshot: beforeSnapshot,
            live: beforeLive,
            snapshotGroupReferences: beforeSnapshotGroupReferences,
          },
          after: {
            organizationFingerprint: organizationForCurrentSpaceState(sourceSpaceId).fingerprint,
          },
        });
      },
      checkpoint: async () => {
        const saved = await saveState({ persistWindowState: false, windowBinding });
        if (saved !== true) {
          throw new Error('This panel moved before Tidy could save its workspace checkpoint.');
        }
      },
      rollback: () => restoreChromeGroupMutationAfterFailure(rollback, {
        windowBinding,
        persistRestoredState: true,
      }),
    }));
    const settledSnapshot = state.spaceSnapshots?.[sourceSpaceId];
    if (settledSnapshot?.preserveGroups) delete settledSnapshot.preserveGroups;
    committed = true;
    if (!isCurrentPanelWindowBinding(windowBinding)) {
      options.onWarning('Tidy was saved, but this panel moved before its view could refresh.');
    } else {
      try {
        render();
      } catch (error) {
        console.error(error);
        options.onWarning('Tidy was saved, but this view could not refresh. Reopen Space Tabs to see the saved groups.');
      }
    }
    if (options.onProgress) options.onProgress(createdGroups, mergedGroups);
    if (!committed) {
      throw new Error('Tidy stopped before its reviewed changes could be committed. Nothing was changed.');
    }
  });
}

async function applyTidyNamingPhase(plan = {}, options = {}) {
  const windowBinding = options.windowBinding;
  let committed = false;
  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) {
      throw new Error(
        'This panel moved before Tidy could apply the planned renames. ' +
        'Nothing was changed; run Tidy again in the current window.',
      );
    }
    if (state.activeSpaceId !== plan.sourceSpaceId) {
      throw new Error('The active Space changed while Tidy was running. Run it again in the current Space.');
    }
    const rollback = captureChromeGroupMutationRollback();
    const loaded = await loadTabs({ adopt: false, windowBinding });
    if (loaded === false) {
      throw new Error(
        'This panel moved before Tidy could apply the planned renames. ' +
        'Nothing was changed; run Tidy again in the current window.',
      );
    }
    snapshotOpenSpace(plan.sourceSpaceId);
    const renameItems = plan.renameItems;
    const targetIds = new Set(renameItems.map((item) => item.id));
    const currentTargets = tabs.filter((tab) => targetIds.has(Number(tab.id)));
    if (currentTargets.length !== renameItems.length) {
      throw new Error('Tabs changed while Tidy was running. Run it again before applying names.');
    }
    const beforeNames = Object.fromEntries(renameItems.map((item) => [
      item.id,
      Object.hasOwn(state.renamedTabs, item.id) ? state.renamedTabs[item.id] : null,
    ]));
    const afterNames = Object.fromEntries(renameItems.map((item) => [item.id, item.result]));
    await runChromeGroupMutationTransaction({
      apply: async () => {
        for (const item of renameItems) setLiveTabPanelTitle(state, item.id, item.result);
        const refreshed = await refreshTabsView({
          reloadDormant: true,
          render: false,
          windowBinding,
        });
        if (refreshed === false) {
          throw new Error('This panel moved before Tidy could verify the renamed tabs.');
        }
        const refreshedTargets = tabs.filter((tab) => targetIds.has(Number(tab.id)));
        if (refreshedTargets.length !== renameItems.length) {
          throw new Error('Tabs changed while Tidy was applying names. The change was rolled back.');
        }
        recordOperation({
          type: 'tidy-names',
          spaceId: plan.sourceSpaceId,
          summary: `Tidy renamed ${renameItems.length} ${renameItems.length === 1 ? 'tab' : 'tabs'}`,
          before: { renamedTabs: beforeNames },
          after: {
            renamedTabs: afterNames,
            targetFingerprint: fingerprintTidyNameTargets(
              refreshedTargets,
              state.renamedTabs,
            ),
          },
        });
      },
      checkpoint: async () => {
        const saved = await saveState({ persistWindowState: false, windowBinding });
        if (saved !== true) {
          throw new Error('This panel moved before Tidy could save the renamed tabs.');
        }
      },
      rollback: () => restoreChromeGroupMutationAfterFailure(rollback, {
        windowBinding,
        persistRestoredState: true,
      }),
    });
    committed = true;
    if (!isCurrentPanelWindowBinding(windowBinding)) {
      options.onWarning('Tidy was saved, but this panel moved before its view could refresh.');
    } else {
      render();
    }
  });
  if (!committed) {
    throw new Error('Tidy stopped before its planned renames could be committed. Nothing was changed.');
  }
}

async function tidyTabNamesWithAI(candidates, options = {}) {
  const settings = options.settings || structuredClone(state.ai);
  if (!hasUsableAISettings(settings) || candidates.length === 0) {
    return { names: {}, sourceLabel: 'Local naming' };
  }

  try {
    await (options.permissionRequest || ensureAIHostPermission(settings));
    const response = await send('ai:chat', {
      settings,
      purpose: 'tidy-names',
      itemCount: candidates.length,
      messages: createPrompt('tidy-names', {
        tabs: candidates.map(compactTabForAI),
        language: settings.language,
        ...(options.rules ? { rules: options.rules } : {}),
      }),
    }, { windowBinding: options.windowBinding });
    if (response.finishReason === 'length') {
      throw new Error('The provider reached the Tidy Names output limit before returning a complete list.');
    }
    const names = parseTidyNames(response.text, candidates);
    if (Object.keys(names).length === 0) {
      throw new Error('AI returned no usable names.');
    }
    return {
      names,
      sourceLabel: `AI: ${providerById(settings.provider).label}`,
    };
  } catch (error) {
    const reason = formatAIError(error);
    setStatus(`${reason} Using local naming instead.`);
    return {
      names: {},
      sourceLabel: `Local fallback (AI unavailable: ${reason})`,
    };
  }
}

function hasManualPanelName(tabId) {
  return String(state.renamedTabs?.[tabId] || '').trim().length > 0;
}

function foreignOpenOrganizationCandidateIds(organization, spaceId) {
  const otherWindowTabs = foreignLiveTabs.filter((tab) => (
    entityBelongsToSpace(tab, state, spaceId)
  ));
  return organizationCandidateIdsOpenInOtherWindows(
    organization?.candidates,
    otherWindowTabs,
  );
}

function activeChromeGroupsByTitle() {
  const byTitle = new Map();
  const snapshotGroups = state.spaceSnapshots?.[state.activeSpaceId]?.groups || [];
  const visibleGroups = buildSpaceViewForSpace(state.activeSpaceId);
  const visibleGroupById = new Map(visibleGroups
    .map((group) => [Number(group.id), group])
    .filter(([groupId]) => Number.isSafeInteger(groupId) && groupId >= 0));
  for (const group of groups) {
    if (state.groupSpaces[group.id] !== state.activeSpaceId) continue;
    const logicalTitle = logicalDuplicateChromeGroupTitle(
      group,
      snapshotGroups,
      visibleGroupById.get(Number(group.id)),
    );
    const titleKey = groupTitleKey(logicalTitle);
    if (!titleKey || byTitle.has(titleKey)) continue;
    byTitle.set(titleKey, {
      ...group,
      title: logicalTitle,
      displayTitle: logicalTitle,
    });
  }
  return byTitle;
}

function organizationTargetGroups(spaceId, snapshot) {
  const snapshotGroups = snapshot?.groups || [];
  const duplicateBuckets = spaceId === state.activeSpaceId
    ? duplicateActiveGroupBuckets()
    : [];
  const duplicateGroupIds = new Set(duplicateBuckets
    .flatMap((bucket) => bucket.map((group) => Number(group.id))));
  const duplicateTargets = duplicateBuckets.map((bucket) => {
    const canonicalLiveGroup = bucket[0];
    const canonicalSnapshotTag = snapshotGroups.find((group) => (
      !isUngroupedSnapshotGroup(group) &&
      groupTitleKey(group?.title) === groupTitleKey(canonicalLiveGroup?.title)
    ));
    if (!canonicalSnapshotTag) return canonicalLiveGroup;
    return {
      ...canonicalLiveGroup,
      title: Object.hasOwn(canonicalSnapshotTag, 'title')
        ? String(canonicalSnapshotTag.title ?? '')
        : canonicalLiveGroup.title,
      color: canonicalSnapshotTag.color || canonicalLiveGroup.color || 'blue',
      collapsed: Boolean(canonicalSnapshotTag.collapsed),
    };
  });
  const liveGroups = groups
    .filter((group) => state.groupSpaces[group.id] === spaceId)
    .filter((group) => !duplicateGroupIds.has(Number(group.id)))
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((group) => ({ ...group, ...logicalChromeGroupTitleOverride(group) }));
  return [...duplicateTargets, ...liveGroups, ...snapshotGroups];
}

function countDuplicateActiveGroups() {
  return duplicateActiveGroupBuckets().reduce((sum, bucket) => sum + bucket.length - 1, 0);
}

function duplicateActiveGroupBuckets() {
  const buckets = new Map();
  const snapshotGroups = state.spaceSnapshots?.[state.activeSpaceId]?.groups || [];
  const visibleGroups = buildSpaceViewForSpace(state.activeSpaceId);
  const visibleGroupById = new Map(visibleGroups
    .map((group) => [Number(group.id), group])
    .filter(([groupId]) => Number.isSafeInteger(groupId) && groupId >= 0));
  for (const group of groups) {
    if (state.groupSpaces[group.id] !== state.activeSpaceId) continue;
    const logicalTitle = logicalDuplicateChromeGroupTitle(
      group,
      snapshotGroups,
      visibleGroupById.get(Number(group.id)),
    );
    const titleKey = groupTitleKey(logicalTitle);
    if (!titleKey) continue;
    if (!buckets.has(titleKey)) buckets.set(titleKey, []);
    buckets.get(titleKey).push({
      ...group,
      title: logicalTitle,
      displayTitle: logicalTitle,
      key: `group:${group.id}`,
    });
  }
  const visibleGroupKeys = visibleGroups.map((group) => group.key);
  const durableGroupOrder = state.groupOrder?.[state.activeSpaceId] || [];
  return [...buckets.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([titleKey, bucket]) => {
      const canonicalSnapshotGroup = snapshotGroups.find((group) => (
        !isUngroupedSnapshotGroup(group) && groupTitleKey(group?.title) === titleKey
      ));
      const canonicalSnapshotGroupId = String(
        canonicalSnapshotGroup?.snapshotGroupId || '',
      ).trim();
      const canonicalSnapshotTabIds = new Set((canonicalSnapshotGroup?.tabs || [])
        .map((tab) => String(tab?.snapshotTabId || '').trim())
        .filter(Boolean));
      const canonicalGroupIds = tabs
        .filter((tab) => canonicalSnapshotTabIds.has(String(
          state.tabLifecycle?.[tab.id]?.snapshotTabId || tab.snapshotTabId || '',
        ).trim()))
        .map((tab) => Number(tab.groupId))
        .filter((groupId) => Number.isSafeInteger(groupId) && groupId >= 0);
      return orderDuplicateChromeGroups(bucket, {
        canonicalSnapshotGroupId,
        canonicalGroupIds,
        tabLifecycle: state.tabLifecycle,
        visibleGroupKeys,
        groupOrder: durableGroupOrder,
      });
    });
}

function logicalDuplicateChromeGroupTitle(group, snapshotGroups = [], visibleGroup = null) {
  const physicalTitle = String(group?.title ?? '');
  const visibleTitle = String(visibleGroup?.title ?? '');
  if (groupTitleKey(visibleTitle)) {
    const visibleMatch = resolveChromeGroupTitleMatch(
      [group],
      visibleTitle,
      [visibleTitle],
    );
    if (Number(visibleMatch?.group?.id) === Number(group?.id)) return visibleTitle;
  }

  const boundSnapshotGroupIds = new Set(tabs
    .filter((tab) => Number(tab.groupId) === Number(group?.id))
    .map((tab) => String(
      state.tabLifecycle?.[tab.id]?.snapshotGroupId || tab.snapshotGroupId || '',
    ).trim())
    .filter(Boolean));
  if (boundSnapshotGroupIds.size === 1) {
    const [snapshotGroupId] = boundSnapshotGroupIds;
    const boundSnapshotGroup = snapshotGroups.find((snapshotGroup) => (
      String(snapshotGroup?.snapshotGroupId || '').trim() === snapshotGroupId
    ));
    if (boundSnapshotGroup && Object.hasOwn(boundSnapshotGroup, 'title')) {
      return String(boundSnapshotGroup.title ?? '');
    }
  }

  const logicalTitles = snapshotGroups
    .filter((snapshotGroup) => !isUngroupedSnapshotGroup(snapshotGroup))
    .map((snapshotGroup) => String(snapshotGroup?.title ?? ''));
  const physicalMatches = new Map();
  for (const logicalTitle of logicalTitles) {
    const match = resolveChromeGroupTitleMatch([group], logicalTitle, logicalTitles);
    if (Number(match?.group?.id) === Number(group?.id)) {
      physicalMatches.set(groupTitleKey(logicalTitle), logicalTitle);
    }
  }
  if (physicalMatches.size === 1) return physicalMatches.values().next().value;
  return physicalTitle;
}

function fingerprintDuplicateActiveGroups() {
  const buckets = duplicateActiveGroupBuckets().map((bucket) => ({
    title: groupTitleKey(bucket[0]?.title),
    groups: bucket.map((group) => ({
      id: Number(group.id),
      title: String(group.title ?? ''),
      color: String(group.color || ''),
      collapsed: Boolean(group.collapsed),
      tabIds: orderedLiveTabIdsForChromeGroup(group.id),
    })),
  }));
  buckets.sort((left, right) => left.title.localeCompare(right.title));
  return JSON.stringify(buckets);
}

function fingerprintTidyDuplicateTags(snapshot) {
  const duplicateSnapshotPlan = mergeDuplicateSnapshotTags(snapshot, snapshot?.updatedAt);
  const liveGroups = JSON.parse(fingerprintDuplicateActiveGroups());
  const duplicateTitleKeys = new Set([
    ...duplicateSnapshotPlan.merges.map((merge) => groupTitleKey(merge.title)),
    ...liveGroups.map((bucket) => groupTitleKey(bucket.title)),
  ]);
  const duplicatePhysicalTitleKeys = new Set(liveGroups
    .map((bucket) => chromeGroupTitleKey(bucket.title)));
  return JSON.stringify({
    snapshotGroups: (snapshot?.groups || [])
      .filter((group) => (
        duplicateTitleKeys.has(groupTitleKey(group?.title)) ||
        duplicatePhysicalTitleKeys.has(chromeGroupTitleKey(group?.title))
      )),
    liveGroups,
  });
}

function remapMergedSnapshotGroupReferences(snapshotGroupIds) {
  if (!snapshotGroupIds || Object.keys(snapshotGroupIds).length === 0) return;
  state.tabLifecycle = remapTabLifecycleGroupReferences(state.tabLifecycle, {
    snapshotGroupIds,
  });
  for (const virtualGroup of Object.values(state.virtualGroups || {})) {
    const snapshotGroupId = String(virtualGroup?.snapshotGroupId || '').trim();
    if (Object.hasOwn(snapshotGroupIds, snapshotGroupId)) {
      virtualGroup.snapshotGroupId = snapshotGroupIds[snapshotGroupId];
    }
  }
  recentlyOpenedDormantTabs = recentlyOpenedDormantTabs.map((record) => {
    const snapshotGroupId = String(record?.snapshotGroupId || '').trim();
    return Object.hasOwn(snapshotGroupIds, snapshotGroupId)
      ? { ...record, snapshotGroupId: snapshotGroupIds[snapshotGroupId] }
      : record;
  });
}

function captureMergedSnapshotGroupReferences(snapshotGroupIds) {
  const replacements = snapshotGroupIds && typeof snapshotGroupIds === 'object'
    ? snapshotGroupIds
    : {};
  const capturedLifecycle = {};
  for (const [tabId, binding] of Object.entries(state.tabLifecycle || {})) {
    const snapshotGroupId = String(binding?.snapshotGroupId || '').trim();
    if (!Object.hasOwn(replacements, snapshotGroupId)) continue;
    capturedLifecycle[tabId] = {
      snapshotGroupId,
      mergedSnapshotGroupId: replacements[snapshotGroupId],
      snapshotTabId: String(binding?.snapshotTabId || '').trim(),
    };
  }
  const capturedVirtualGroups = {};
  for (const [virtualGroupId, virtualGroup] of Object.entries(state.virtualGroups || {})) {
    const snapshotGroupId = String(virtualGroup?.snapshotGroupId || '').trim();
    if (!Object.hasOwn(replacements, snapshotGroupId)) continue;
    capturedVirtualGroups[virtualGroupId] = {
      snapshotGroupId,
      mergedSnapshotGroupId: replacements[snapshotGroupId],
    };
  }
  const capturedRecentlyOpened = recentlyOpenedDormantTabs
    .filter((record) => Object.hasOwn(
      replacements,
      String(record?.snapshotGroupId || '').trim(),
    ))
    .map((record) => ({
      tabId: Number(record?.tabId),
      snapshotTabId: String(record?.snapshotTabId || '').trim(),
      url: String(record?.url || ''),
      snapshotGroupId: String(record?.snapshotGroupId || '').trim(),
      mergedSnapshotGroupId: replacements[String(record?.snapshotGroupId || '').trim()],
    }));
  return {
    tabLifecycle: capturedLifecycle,
    virtualGroups: capturedVirtualGroups,
    recentlyOpenedDormantTabs: capturedRecentlyOpened,
  };
}

function restoreMergedSnapshotGroupReferences(captured = {}) {
  for (const [tabId, reference] of Object.entries(captured.tabLifecycle || {})) {
    const binding = state.tabLifecycle?.[tabId];
    if (
      !binding ||
      String(binding.snapshotGroupId || '').trim() !==
        String(reference?.mergedSnapshotGroupId || '').trim() ||
      (
        reference?.snapshotTabId &&
        String(binding.snapshotTabId || '').trim() !== String(reference.snapshotTabId)
      )
    ) continue;
    binding.snapshotGroupId = reference.snapshotGroupId;
  }
  for (const [virtualGroupId, reference] of Object.entries(captured.virtualGroups || {})) {
    const virtualGroup = state.virtualGroups?.[virtualGroupId];
    if (
      virtualGroup &&
      String(virtualGroup.snapshotGroupId || '').trim() ===
        String(reference?.mergedSnapshotGroupId || '').trim()
    ) {
      virtualGroup.snapshotGroupId = reference.snapshotGroupId;
    }
  }
  recentlyOpenedDormantTabs = recentlyOpenedDormantTabs.map((record) => {
    const reference = (captured.recentlyOpenedDormantTabs || []).find((candidate) => (
      (
        Number.isSafeInteger(Number(candidate?.tabId)) &&
        Number(candidate.tabId) === Number(record?.tabId)
      ) ||
      (
        candidate?.snapshotTabId &&
        candidate.snapshotTabId === String(record?.snapshotTabId || '').trim()
      )
    ));
    return reference &&
      String(record?.snapshotGroupId || '').trim() ===
        String(reference.mergedSnapshotGroupId || '').trim()
      ? { ...record, snapshotGroupId: reference.snapshotGroupId }
      : record;
  });
}

async function mergeDuplicateGroupsInActiveSpace(options = {}) {
  let merged = 0;
  for (const bucket of duplicateActiveGroupBuckets()) {
    const reviewedCanonicalGroupId = Number(
      options.canonicalGroupIdsByTitle?.get(groupTitleKey(bucket[0]?.title)),
    );
    const reviewedKeep = Number.isSafeInteger(reviewedCanonicalGroupId)
      ? bucket.find((group) => Number(group.id) === reviewedCanonicalGroupId)
      : null;
    const keep = reviewedKeep || bucket[0];
    const duplicates = bucket.filter((group) => Number(group.id) !== Number(keep.id));
    const canonicalSnapshotTag = (state.spaceSnapshots?.[state.activeSpaceId]?.groups || [])
      .find((group) => (
        !isUngroupedSnapshotGroup(group) &&
        groupTitleKey(group?.title) === groupTitleKey(keep?.title)
      ));
    let mergedTabOrder = orderedLiveTabIdsForChromeGroup(keep.id);
    for (const duplicate of duplicates) {
      const tabIds = orderedLiveTabIdsForChromeGroup(duplicate.id);
      mergedTabOrder = uniqueKeys([...mergedTabOrder, ...tabIds]);
      if (tabIds.length) {
        const mergedGroupId = await addTabsToChromeGroup(
          keep.id,
          tabIds,
          state.activeSpaceId,
          { windowBinding: options.windowBinding },
        );
        if (mergedGroupId === null) {
          throw new Error(`Chrome could not merge duplicate group "${keep.title || 'Tabs'}".`);
        }
      }
      state.tabLifecycle = remapTabLifecycleGroupReferences(state.tabLifecycle, {
        chromeGroupIds: { [duplicate.id]: keep.id },
      });
      delete state.groupSpaces[duplicate.id];
      delete state.collapsedGroups[duplicate.key];
      delete state.tabOrder[state.activeSpaceId]?.[duplicate.key];
      state.groupOrder[state.activeSpaceId] = (state.groupOrder[state.activeSpaceId] || [])
        .filter((key) => key !== duplicate.key);
      merged += 1;
    }
    if (canonicalSnapshotTag) {
      const logicalTitle = Object.hasOwn(canonicalSnapshotTag, 'title')
        ? String(canonicalSnapshotTag.title ?? '')
        : String(keep.title || 'Tabs');
      const normalizedLogicalTitle = logicalTitle === ''
        ? ''
        : normalizeGroupTitle(logicalTitle, 'Tabs');
      const physicalTitle = normalizedLogicalTitle === ''
        ? ''
        : chromeGroupTitle(normalizedLogicalTitle, 'Tabs');
      const canonicalColor = canonicalSnapshotTag.color || keep.color || 'blue';
      const canonicalCollapsed = Boolean(canonicalSnapshotTag.collapsed);
      if (
        String(keep.title ?? '') !== physicalTitle ||
        String(keep.color || '') !== canonicalColor ||
        Boolean(keep.collapsed) !== canonicalCollapsed
      ) {
        const result = await send('groups:update', {
          groupId: keep.id,
          update: {
            title: physicalTitle,
            color: canonicalColor,
            collapsed: canonicalCollapsed,
          },
        }, { windowBinding: options.windowBinding });
        if (!result.group) {
          throw new Error(`Chrome could not preserve the first duplicate Tag "${logicalTitle || 'Tabs'}".`);
        }
        Object.assign(keep, result.group);
      }
      logicalChromeGroupTitles.set(Number(keep.id), normalizedLogicalTitle);
      state.collapsedGroups[keep.key] = canonicalCollapsed;
    }
    if (mergedTabOrder.length > 0) {
      ensureTabOrderForSpace(state.activeSpaceId)[keep.key] = mergedTabOrder;
    }
    addGroupOrderKey(state.activeSpaceId, keep.key);
  }
  return merged;
}

function canonicalLiveChromeGroupIdsByTitle(snapshot = null) {
  const canonicalByTitle = new Map();
  const liveTabById = new Map(tabs.map((tab) => [Number(tab.id), tab]));
  for (const snapshotGroup of snapshot?.groups || []) {
    if (isUngroupedSnapshotGroup(snapshotGroup)) continue;
    const titleKey = groupTitleKey(snapshotGroup?.title);
    if (!titleKey || canonicalByTitle.has(titleKey)) continue;
    const snapshotGroupId = String(snapshotGroup?.snapshotGroupId || '').trim();
    const snapshotTabIds = new Set((snapshotGroup?.tabs || [])
      .map((tab) => String(tab?.snapshotTabId || '').trim())
      .filter(Boolean));
    const matchingGroupIds = new Set(Object.values(state.tabLifecycle || {})
      .filter((binding) => (
        String(binding?.snapshotGroupId || '').trim() === snapshotGroupId &&
        snapshotTabIds.has(String(binding?.snapshotTabId || '').trim())
      ))
      .map((binding) => {
        const liveTab = liveTabById.get(Number(binding?.tabId));
        return liveTab && Number(liveTab.groupId) === Number(binding?.groupId)
          ? Number(binding.groupId)
          : null;
      })
      .filter((groupId) => Number.isSafeInteger(groupId) && groupId >= 0));
    if (matchingGroupIds.size === 1) {
      canonicalByTitle.set(titleKey, matchingGroupIds.values().next().value);
    }
  }
  return canonicalByTitle;
}

function orderedLiveTabIdsForChromeGroup(groupId) {
  const numericGroupId = Number(groupId);
  const visibleGroup = buildSpaceViewForSpace(state.activeSpaceId)
    .find((group) => Number(group.id) === numericGroupId);
  const visibleIds = liveTabsForOrdering(visibleGroup).map((tab) => Number(tab.id));
  if (visibleIds.length > 0) return visibleIds;
  return tabs
    .filter((tab) => Number(tab.groupId) === numericGroupId)
    .sort((left, right) => Number(left.index) - Number(right.index))
    .map((tab) => Number(tab.id))
    .filter(Number.isFinite);
}

function assertLivePlannedGroupsApplied(livePlannedGroups, spaceId) {
  const chromeGroupsById = new Map(groups.map((group) => [Number(group.id), group]));
  for (const group of livePlannedGroups || []) {
    const expectedTitle = chromeGroupTitleKey(group.title);
    for (const tabId of group.tabIds || []) {
      const currentTab = tabs.find((tab) => Number(tab.id) === Number(tabId));
      const currentGroup = chromeGroupsById.get(Number(currentTab?.groupId));
      if (
        !currentTab ||
        !currentGroup ||
        state.groupSpaces[currentGroup.id] !== spaceId ||
        chromeGroupTitleKey(currentGroup.title) !== expectedTitle
      ) {
        throw new Error(`Chrome did not finish applying the proposed group "${group.title}". The change was rolled back.`);
      }
    }
  }
}

function checkpointAutoGroupLifecycleBindings(plannedGroups, candidateById, spaceId) {
  const snapshotGroups = state.spaceSnapshots?.[spaceId]?.groups || [];
  for (const plannedGroup of plannedGroups || []) {
    for (const candidateId of plannedGroup.tabIds || []) {
      const candidate = candidateById.get(Number(candidateId));
      const liveTabId = Number(candidate?.source?.live?.tabId);
      if (!Number.isSafeInteger(liveTabId)) continue;
      const currentTab = tabs.find((tab) => Number(tab.id) === liveTabId);
      const binding = state.tabLifecycle?.[liveTabId];
      const snapshotTabId = validSnapshotLifecycleId(
        candidate?.source?.snapshot?.snapshotTabId || binding?.snapshotTabId,
      );
      const matchingSnapshotGroup = uniqueSnapshotGroupForTabId(
        snapshotGroups,
        snapshotTabId,
      );
      const targetSnapshotGroupId = matchingSnapshotGroup
        ? validSnapshotLifecycleId(matchingSnapshotGroup.snapshotGroupId)
        : '';
      if (
        !currentTab || !isGroupedTab(currentTab) || !binding ||
        !snapshotTabId || !targetSnapshotGroupId
      ) {
        const stableMatchCount = snapshotGroups.filter((group) => (
          (group?.tabs || []).some((tab) => (
            validSnapshotLifecycleId(tab?.snapshotTabId) === snapshotTabId
          ))
        )).length;
        throw new Error(
          `The stable saved row for "${plannedGroup.title || 'Tabs'}" could not be checkpointed ` +
          `(row ${snapshotTabId || 'missing'}, matches ${stableMatchCount}, ` +
          `live ${Boolean(currentTab)}, grouped ${Boolean(currentTab && isGroupedTab(currentTab))}, ` +
          `binding ${Boolean(binding)}, target ${targetSnapshotGroupId || 'missing'}). ` +
          'The Auto Group change was rolled back.',
        );
      }
      state.tabLifecycle[liveTabId] = {
        ...binding,
        tabId: liveTabId,
        spaceId,
        groupId: currentTab.groupId,
        snapshotTabId,
        snapshotGroupId: targetSnapshotGroupId,
        windowId: currentTab.windowId,
        index: currentTab.index,
        title: currentTab.title || binding.title,
        url: currentTab.url || binding.url,
        provisional: false,
      };
    }
  }
}

async function toggleSpaceGroups(options = {}) {
  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding: options.windowBinding });
    if (synchronized === false) return;
    const next = !isSpaceGroupsCollapsed();
    state.collapsedSpaceGroups[state.activeSpaceId] = next;
    await saveState({
      persistWindowState: false,
      windowBinding: options.windowBinding,
    });
    render();
  });
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
  if (action === 'tidyNames') return 'Tidying tabs...';
  return 'Working...';
}

function formatPreviewDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value < 1000) return `${Math.max(1, Math.round(value))} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function updatePanelActionUI() {
  const tidyBusy = activePanelAction === 'tidyNames';
  const busy = Boolean(activePanelAction);

  els.tidyNamesButton.disabled = busy;
  els.collapseGroupsButton.disabled = busy;
  els.tidyNamesButton.innerHTML = tidyBusy ? '...' : TIDY_NAMES_ICON;
  els.tidyNamesButton.classList.toggle('busy', tidyBusy);
}

function focusPanelForShortcuts() {
  const target = els.groupsList;
  if (!target || target.hidden) return;
  if (target === els.groupsList) target.tabIndex = -1;
  panelFocusController.request();
}

async function detectProviderModels(controls = settingsAIControls(), options = {}) {
  const settings = currentAISettingsFromControls(controls);
  if (!String(settings.baseUrl || '').trim()) {
    setAIControlsStatus(controls, 'Enter a Base URL before detecting models.');
    return;
  }
  setStatus('Detecting models from the provider...');
  try {
    await ensureAIHostPermission(settings);
    const { models } = await send('ai:listModels', { settings }, {
      windowBinding: options.windowBinding,
    });
    detectedModelIds = Array.isArray(models) ? models : [];
    renderSettingsAISection();
    const current = currentAISettingsFromControls(controls).model;
    if (!current && detectedModelIds.length > 0) {
      controls.modelInput.value = detectedModelIds[0];
    }
    setAIControlsStatus(controls, `Detected ${formatCount(detectedModelIds.length, 'model')} from ${providerById(state.ai.provider).label}. Pick one from the suggestions or keep yours.`);
  } catch (error) {
    detectedModelIds = [];
    renderModelOptions(providerById(state.ai.provider), '', controls);
    setAIControlsStatus(controls, `${formatAIError(error)} Enter the model manually.`);
  }
}

function startTestAIFromUserGesture(controls = settingsAIControls()) {
  void runTask(() => testAI({ controls }));
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
  }
}

async function exportSpaceData(options = {}) {
  const windowBinding = options.windowBinding;
  let backup;
  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) return;
    const loaded = await loadTabs({ adopt: false, windowBinding });
    if (loaded === false) return;
    snapshotOpenSpace(state.activeSpaceId);
    await saveState({ persistWindowState: false, windowBinding });
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

async function previewSpaceBackupFile(options = {}) {
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
    const parsed = parseSpaceBackup(await file.text());
    if (!isCurrentPanelWindowBinding(options.windowBinding)) return;
    pendingSpaceBackup = parsed;
    els.restoreSpaceDataButton.disabled = false;
    setSpaceBackupStatus(`Ready to restore ${formatSpaceBackupSummary(pendingSpaceBackup)}`);
  } catch (error) {
    setSpaceBackupStatus(`Cannot read backup: ${error.message || String(error)}`);
  }
}

async function restoreSpaceData(options = {}) {
  const windowBinding = options.windowBinding;
  restoreSpaceDataReviewTransitions += 1;
  try {
    await runRestoreSpaceData(windowBinding);
  } finally {
    restoreSpaceDataReviewTransitions += 1;
  }
}

async function runRestoreSpaceData(windowBinding) {
  if (!pendingSpaceBackup) {
    setSpaceBackupStatus('Choose a Space backup first.');
    return;
  }

  const selectedBackup = pendingSpaceBackup;
  let confirmedBackup = null;
  let reviewedPortableFingerprint = '';
  let selectionChanged = false;
  try {
    await withSharedStateLock(async () => {
      if (pendingSpaceBackup !== selectedBackup) {
        selectionChanged = true;
        return;
      }
      const synchronized = await syncStateFromStorage({ windowBinding });
      if (synchronized === false) return;
      // Confirmation reviews only durable user data. Live-tab refresh and
      // snapshot mutation begin after the reviewed fingerprint is rechecked.
      confirmedBackup = structuredClone(selectedBackup);
      reviewedPortableFingerprint = fingerprintPortableWorkspaceContent(state);
    });
  } catch (error) {
    setSpaceBackupStatus(`Restore preflight failed: ${error.message || String(error)}`);
    throw error;
  }
  if (selectionChanged || !confirmedBackup || !reviewedPortableFingerprint) {
    const message = 'The selected backup changed before confirmation. Review it and try again.';
    setSpaceBackupStatus(message);
    setSettingsStatus(message);
    return;
  }

  const ok = await askConfirm({
    title: 'Restore Space Data',
    message: `Replace current Spaces with ${confirmedBackup.spaces.length} Spaces from this backup? Current browser tabs will stay open and join the restored active Space.`,
    confirmText: 'Restore',
    danger: true,
  });
  if (!ok) return;

  let summary;
  let committed = false;
  let preconditionChanged = false;
  let postCommitWarning = '';
  try {
    await withSharedStateLock(async () => {
      const synchronized = await syncStateFromStorage({ windowBinding });
      if (synchronized === false) return;
      if (
        pendingSpaceBackup !== selectedBackup ||
        fingerprintPortableWorkspaceContent(state) !== reviewedPortableFingerprint
      ) {
        preconditionChanged = true;
        return;
      }

      const beforeAttempt = captureWorkspaceMemoryCheckpoint();
      let beforeRestore;
      let beforeDurableActiveSpaceId;
      let beforeWindowSpaceState;
      let beforeBackup;
      let beforeSnapshotIdentities;
      let beforeLiveOwnership;
      try {
        const loaded = await loadTabs({ adopt: false, windowBinding });
        if (loaded === false) throw new Error('This panel moved to another Chrome window before restore began.');
        snapshotOpenSpace(state.activeSpaceId);
        beforeRestore = captureWorkspaceMemoryCheckpoint();
        beforeDurableActiveSpaceId = durableActiveSpaceId;
        beforeWindowSpaceState = structuredClone(windowSpaceState);
        beforeBackup = createSpaceBackup(state);
        beforeSnapshotIdentities = captureSnapshotIdentityOverlay(state.spaceSnapshots);
        const beforeLiveResponse = await send('tabs:listAll', {}, { windowBinding });
        if (!isCurrentPanelWindowBinding(windowBinding)) {
          throw new Error('This panel moved to another Chrome window before restore began.');
        }
        beforeLiveOwnership = captureLiveSpaceOwnership(
          state,
          beforeLiveResponse.tabs || [],
          beforeLiveResponse.groups || [],
        );
      } catch (error) {
        restoreWorkspaceMemoryCheckpoint(beforeAttempt, { renderView: true });
        throw error;
      }
      const transaction = await runDurableCommitBoundary({
        mutate: async () => {
          summary = restoreSpaceBackup(state, confirmedBackup);
          await adoptAllOpenTabsIntoRestoredActiveSpace({ windowBinding });
          const operation = recordOperation({
            type: 'restore-backup',
            spaceId: state.activeSpaceId,
            summary: `Restored ${formatRestoredSpaceDataSummary(summary)}`,
            before: {
              backup: beforeBackup,
              snapshotIdentities: beforeSnapshotIdentities,
              liveOwnership: beforeLiveOwnership,
              durableActiveSpaceId: beforeDurableActiveSpaceId,
              windowSpaceState: beforeWindowSpaceState,
              lastArcImport: structuredClone(beforeRestore.state.lastArcImport || null),
            },
            after: { portableFingerprint: fingerprintPortableWorkspaceContent(state) },
          });
          assertCurrentStateFitsStorage();
          return {
            operation,
            committedMemory: captureWorkspaceMemoryCheckpoint(),
          };
        },
        commit: async () => {
          const saved = await saveState({ windowBinding });
          if (saved !== true) {
            throw new Error('This panel moved to another Chrome window before the backup restore could be saved.');
          }
          return true;
        },
        rollbackBeforeCommit: () => (
          restoreWorkspaceMemoryCheckpoint(beforeAttempt, { renderView: true })
        ),
        afterCommit: async (value) => {
          const refreshed = await refreshTabsView({
            adopt: true,
            reloadDormant: true,
            render: false,
            windowBinding,
          });
          if (refreshed !== true) {
            throw new Error('This panel moved to another Chrome window after the backup restore was saved.');
          }
          value.operation.after.portableFingerprint = fingerprintPortableWorkspaceContent(state);
          const saved = await saveState({ windowBinding });
          if (saved !== true) {
            throw new Error('This panel moved before the refreshed backup restore could be saved.');
          }
          value.committedMemory = captureWorkspaceMemoryCheckpoint();
        },
        restoreCommittedMemory: (value) => (
          restoreWorkspaceMemoryCheckpoint(value.committedMemory)
        ),
      });
      committed = transaction.committed;
      if (transaction.postCommitError) {
        postCommitWarning = 'The backup restore was saved, but this view could not finish refreshing. Reopen Space Tabs to see the restored data.';
        if (transaction.recoveryError) console.error(transaction.recoveryError);
      }
    });
  } catch (error) {
    if (committed) {
      postCommitWarning ||= 'The backup restore was saved, but this view could not finish refreshing. Reopen Space Tabs to see the restored data.';
      console.error(error);
    } else {
      setSpaceBackupStatus(`Restore failed: ${error.message || String(error)}`);
      throw error;
    }
  }

  if (preconditionChanged) {
    const message = 'Space data changed while confirmation was open. Nothing was restored; review the selected backup and confirm again.';
    setSpaceBackupStatus(message);
    setSettingsStatus(message);
    return;
  }
  if (!committed) {
    const message = 'Restore stopped before it could save. Nothing was changed; the selected backup is still ready to retry.';
    setSpaceBackupStatus(message);
    setSettingsStatus(message, 'error');
    return;
  }

  try {
    activeView = 'space';
    dormantSpaceView = [];
    dormantSpaceViewSpaceId = '';
    lastRenderedGroupsSignature = '';
      lastRenderedSpacesSignature = '';
    pendingSpaceBackup = null;
    els.spaceBackupInput.value = '';
    els.restoreSpaceDataButton.disabled = true;
    exitSettingsView();
    render();
  } catch (error) {
    postCommitWarning ||= 'The backup restore was saved, but this view could not finish refreshing. Reopen Space Tabs to see the restored data.';
    console.error(error);
  }

  if (postCommitWarning) {
    try {
      setSpaceBackupStatus(postCommitWarning);
      setSettingsStatus(postCommitWarning, 'info');
      setStatus(postCommitWarning);
    } catch (error) {
      console.error(error);
    }
    return;
  }
  setStatus(`Restored ${formatRestoredSpaceDataSummary(summary)}. Current browser tabs stayed open in the active Space.`);
}

async function adoptAllOpenTabsIntoRestoredActiveSpace(options = {}) {
  const response = await send('tabs:listAll', {}, { windowBinding: options.windowBinding });
  if (!isCurrentPanelWindowBinding(options.windowBinding)) {
    throw new Error('This panel moved to another Chrome window before open tabs could join the restored Space.');
  }
  const openTabs = decorateTabs(response.tabs || [], state).filter((tab) => !isEphemeralTab(tab));
  const openGroups = response.groups || [];
  adoptUnassignedEntities(state, openTabs, openGroups, state.activeSpaceId, {
    adoptGroups: true,
    existingTabIds: openTabs.map((tab) => Number(tab.id)).filter(Number.isFinite),
    existingGroupIds: openGroups.map((group) => Number(group.id)).filter(Number.isFinite),
  });
  snapshotOpenSpace(state.activeSpaceId, {
    sourceTabs: openTabs,
    sourceGroups: openGroups,
  });
  durableActiveSpaceId = state.activeSpaceId;
  const windowIds = new Set(openTabs.map((tab) => Number(tab.windowId)).filter(Number.isFinite));
  const targetWindowId = options.windowBinding?.windowId ?? panelWindowId;
  if (Number.isFinite(targetWindowId)) windowIds.add(Number(targetWindowId));
  windowSpaceState = {
    activeSpaceIds: Object.fromEntries([...windowIds].map((windowId) => [String(windowId), state.activeSpaceId])),
  };
}

function formatSpaceBackupSummary(backup) {
  const savedTabs = Object.values(backup.spaceSnapshots || {}).reduce((total, snapshot) => (
    total + (snapshot?.groups || []).reduce((sum, group) => sum + (group.tabs || []).length, 0)
  ), 0);
  return `${formatCount(backup.spaces.length, 'Space')} and ` +
    `${formatCount(savedTabs, 'saved tab')}.`;
}

function formatRestoredSpaceDataSummary(summary = {}) {
  return `${formatCount(summary.spaces, 'Space')} and ` +
    `${formatCount(summary.savedTabs, 'saved tab')}`;
}

function formatCount(value, singular) {
  const count = Number(value || 0);
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function clearSettingsArcSelection({ preserveStatus = false } = {}) {
  arcImportSelectionGeneration += 1;
  pendingArcImportText = '';
  pendingArcImportPlan = null;
  els.arcImportInput.value = '';
  els.importArcButton.disabled = true;
  if (!preserveStatus) setArcImportStatus('No Arc file selected.');
}

async function previewArcImportFile(selectedFile = null, options = {}) {
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
    if (
      !isCurrentPanelWindowBinding(options.windowBinding) ||
      selectionGeneration !== arcImportSelectionGeneration
    ) return;
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

async function importArcFile(options = {}) {
  const windowBinding = options.windowBinding;
  if (!pendingArcImportText || !pendingArcImportPlan) {
    setArcImportStatus('Choose an Arc sidebar file first.');
    return;
  }

  let previewInvalidated = false;
  let committed = false;
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
    let postCommitWarning = '';
    await withSharedStateLock(async () => {
      const synchronized = await syncStateFromStorage({ windowBinding });
      if (synchronized === false) return;
      const latestPlan = createArcImportPlan(pendingArcImportText, { existingSpaces: state.spaces });
      if (arcPlanResolutionSignature(pendingArcImportPlan) !== arcPlanResolutionSignature(latestPlan)) {
        previewInvalidated = true;
        throw new Error('Spaces changed after this preview. Choose the Arc file again to review the updated conflict names.');
      }
      const beforeImport = captureWorkspaceMemoryCheckpoint();
      const transaction = await runDurableCommitBoundary({
        mutate: async () => {
          result = appendArcImportPlan(state, latestPlan);
          rememberArcImport(result.importedSpaceIds);
          assertCurrentStateFitsStorage();
          return {
            result,
            committedMemory: captureWorkspaceMemoryCheckpoint(),
          };
        },
        commit: async () => {
          if (!isCurrentPanelWindowBinding(windowBinding)) {
            throw new Error('This panel moved to another Chrome window before the import could be saved.');
          }
          await saveState({ persistWindowState: false });
        },
        rollbackBeforeCommit: () => (
          restoreWorkspaceMemoryCheckpoint(beforeImport, { renderView: true })
        ),
        afterCommit: async () => {
          render();
          renderSettings();
        },
        restoreCommittedMemory: ({ committedMemory }) => (
          restoreWorkspaceMemoryCheckpoint(committedMemory)
        ),
      });
      committed = transaction.committed;
      result = transaction.value.result;
      if (transaction.postCommitError) {
        postCommitWarning = `Imported ${result.importedSpaces} Spaces and ${result.importedTabs} tabs. The import was saved, but this view could not refresh; reopen Space Tabs to see it.`;
        if (transaction.recoveryError) console.error(transaction.recoveryError);
      }
    });
    try {
      clearSettingsArcSelection({ preserveStatus: true });
    } catch (error) {
      postCommitWarning ||= `Imported ${result.importedSpaces} Spaces and ${result.importedTabs} tabs. The import was saved, but this view could not refresh; reopen Space Tabs to see it.`;
      console.error(error);
    }
    if (postCommitWarning) {
      setArcImportStatus(postCommitWarning);
      setSettingsStatus(postCommitWarning);
      return;
    }
    const message = `Imported ${result.importedSpaces} Spaces and ${result.importedTabs} tabs. Current Space stayed active.`;
    setArcImportStatus(message);
    setSettingsStatus(message);
  } catch (error) {
    if (committed) {
      const message = 'The Arc import was saved, but this view could not refresh. Reopen Space Tabs to see the imported Spaces.';
      try {
        setArcImportStatus(message);
        setSettingsStatus(message);
      } catch (statusError) {
        console.error(statusError);
      }
      console.error(error);
      return;
    }
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
      token: createArcImportToken(),
      spaceIds: ids,
      importedAt: Date.now(),
      afterFingerprints: fingerprintPortableSpacesContent(state, ids),
    }
    : null;
}

function createArcImportToken() {
  const generated = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return normalizeArcImportToken(generated);
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
  const windowBinding = options.windowBinding;
  const confirmedImportRecord = structuredClone(state.lastArcImport);
  const importedIds = new Set((confirmedImportRecord?.spaceIds || []).map(String));
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
  let importRecordChanged = false;
  await withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) return;
    if (!sameArcImportRecord(confirmedImportRecord, state.lastArcImport)) {
      importRecordChanged = true;
      return;
    }
    assertArcImportUndoIsFresh(state.lastArcImport);
    const beforeState = structuredClone(state);
    const beforeDurableActiveSpaceId = durableActiveSpaceId;
    const beforeWindowSpaceState = structuredClone(windowSpaceState);
    let persisted = false;
    try {
      const latestImportedIds = new Set((state.lastArcImport?.spaceIds || []).map(String));
      const latestRemovableSpaces = state.spaces.filter((space) => latestImportedIds.has(space.id));
      if (latestRemovableSpaces.length === 0) {
        state.lastArcImport = null;
        await saveState({ persistWindowState: false, windowBinding });
        return;
      }
      const remainingSpaces = state.spaces.filter((space) => !latestImportedIds.has(space.id));
      if (remainingSpaces.length === 0) throw new Error('Keep at least one Space before undoing this import.');
      if (latestImportedIds.has(state.activeSpaceId)) state.activeSpaceId = remainingSpaces[0].id;

      const response = await send('tabs:listAll', {}, { windowBinding });
      const openTabs = decorateTabs(tabsWithLifecycleIdentity(response.tabs || []), state)
        .filter((tab) => !isEphemeralTab(tab));
      const reassigned = reassignTabsFromRemovedSpaces(
        state,
        openTabs,
        latestImportedIds,
        (tab) => activeSpaceForWindow(
          windowSpaceState,
          tab.windowId,
          remainingSpaces,
          state.activeSpaceId,
        ),
      );
      for (const spaceId of latestImportedIds) removeSpaceReferences(state, spaceId);
      state.spaces = remainingSpaces;
      durableActiveSpaceId = activeSpaceForStorage(
        remainingSpaces,
        durableActiveSpaceId,
        state.activeSpaceId,
      );
      windowSpaceState = normalizeWindowSpaceState(windowSpaceState, remainingSpaces);
      for (const targetSpaceId of reassigned.spaceIds) {
        snapshotOpenSpace(targetSpaceId, {
          sourceTabs: openTabs,
          sourceGroups: response.groups || [],
        });
      }
      state.lastArcImport = null;
      activeView = 'space';
      dormantSpaceView = [];
      dormantSpaceViewSpaceId = '';
      lastRenderedGroupsSignature = '';
      lastRenderedSpacesSignature = '';
      await saveState({ windowBinding });
      persisted = true;
      await refreshTabs({ adopt: false, reloadDormant: true, windowBinding });
      removedCount = latestRemovableSpaces.length;
    } catch (error) {
      state = beforeState;
      durableActiveSpaceId = beforeDurableActiveSpaceId;
      windowSpaceState = beforeWindowSpaceState;
      const rollbackFailures = [];
      if (persisted) {
        try {
          if (isCurrentPanelWindowBinding(windowBinding)) {
            await saveState({ windowBinding });
          } else {
            await persistStoragePair({
              key: WINDOW_STATE_KEY,
              value: beforeWindowSpaceState,
              get: windowStateGet,
              set: windowStateSet,
              remove: windowStateRemove,
            }, {
              key: STORAGE_KEY,
              value: stateForStorage(),
              get: storageGet,
              set: storageSet,
              remove: storageRemove,
            });
          }
        } catch (rollbackError) {
          rollbackFailures.push({ stage: 'restoring Arc import state', error: rollbackError });
        }
      }
      restoreFailedWorkspaceMutation(beforeState);
      if (rollbackFailures.length > 0) throw createRollbackFailureError(error, rollbackFailures);
      throw error;
    }
  });
  if (importRecordChanged) {
    renderSettings();
    const message = 'The latest Arc import changed while confirmation was open. Nothing was removed; review it and confirm again.';
    setArcImportStatus(message);
    setSettingsStatus(message);
    return;
  }
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
  const requestedContextTabIds = tab.pinned ? [tab.id] : selectionForContextMenu({
    selectedTabIds: [...selectedTabIds],
    clickedTabId: tab.id,
  });
  const contextTabIds = requestedContextTabIds.filter((tabId) => (
    !tabs.find((item) => Number(item.id) === Number(tabId))?.pinned
  ));
  const excludedPinnedCount = requestedContextTabIds.length - contextTabIds.length;
  selectedTabIds = new Set(contextTabIds);
  selectionAnchorTabId = tab.id;
  render();

  if (tab.pinned) {
    showContextMenu(event, [
      menuNotice('Pinned tabs stay open and use their Chrome page title. Unpin this tab in Chrome to group, move, rename, update, or close it.'),
      menuSeparator(),
      menuAction('Duplicate', (windowBinding) => duplicateTab(tab, { windowBinding })),
    ]);
    return;
  }

  const items = [
    ...(excludedPinnedCount > 0 ? [
      menuNotice(`${formatCount(excludedPinnedCount, 'pinned tab')} left out. Unpin in Chrome to group or move it.`),
      menuSeparator(),
    ] : []),
    menuAction(contextTabIds.length === 1 ? 'Group tab' : `Group ${contextTabIds.length} selected tabs`, (windowBinding) => (
      groupSelectedTabs(contextTabIds, { windowBinding })
    )),
    menuSeparator(),
    menuAction('Rename', (windowBinding) => renameTab(tab, { windowBinding })),
    menuAction('Duplicate', (windowBinding) => duplicateTab(tab, { windowBinding })),
    menuAction('Update Saved URL', (windowBinding) => updateSavedTabUrl(tab, { windowBinding })),
    ...menuSection(moveToSpaceSubmenu((space, windowBinding) => (
      contextTabIds.length > 1
        ? moveSelectedTabsToSpace(contextTabIds, space.id, { windowBinding })
        : moveTabToSpace(tab, space.id, { windowBinding })
    ))),
  ];

  showContextMenu(event, items);
}

function showGroupContextMenu(event, group) {
  event.preventDefault();
  event.stopPropagation();
  if (groupHasForeignLiveTabs(group)) {
    showContextMenu(event, [menuNotice('Open this Space in the other window to edit this group.')]);
    return;
  }
  showContextMenu(event, [
    menuAction('Rename', (windowBinding) => renameGroup(group, { windowBinding })),
    ...(group.dormant
      ? [menuAction('Open Group', (windowBinding) => openDormantGroup(group, { windowBinding }))]
      : [menuAction('Close Group', (windowBinding) => closeGroupToSaved(group, { windowBinding }))]),
    menuAction('Delete Group', (windowBinding) => deleteGroup(group, { windowBinding })),
    ...menuSection(moveToSpaceSubmenu((space, windowBinding) => (
      moveGroupToSpace(group, space.id, { windowBinding })
    ))),
  ]);
}

function showFolderContextMenu(event, folderContext) {
  event.preventDefault();
  event.stopPropagation();
  if (folderContextHasForeignLiveTabs(folderContext)) {
    showContextMenu(event, [menuNotice('Open this Space in the other window to edit this folder group.')]);
    return;
  }
  showContextMenu(event, [
    menuAction('Rename', (windowBinding) => renameFolderGroup(folderContext, { windowBinding })),
    menuAction('Delete Group', (windowBinding) => deleteFolderGroup(folderContext, { windowBinding })),
    ...menuSection(moveToSpaceSubmenu((space, windowBinding) => (
      moveFolderGroupToSpace(folderContext, space.id, { windowBinding })
    ))),
  ]);
}

function showSpaceContextMenu(event, space) {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu(event, [
    menuAction('Rename Space', (windowBinding) => renameSpace(space, { windowBinding })),
    menuAction('Delete Space', (windowBinding) => deleteSpace(space, { windowBinding })),
  ]);
}

function showContextMenu(event, items) {
  hideGroupPreview();
  contextMenuReturnFocus = contextMenuReturnFocusResolver(event);
  els.contextMenu.replaceChildren(...items.filter(Boolean));
  els.contextMenu.hidden = false;
  els.contextMenu.style.left = '0px';
  els.contextMenu.style.top = '0px';
  const rect = els.contextMenu.getBoundingClientRect();
  const submenuReserve = els.contextMenu.querySelector('.context-submenu') ? 202 : 0;
  const anchorRect = event.target instanceof Element
    ? event.target.getBoundingClientRect()
    : { left: 8, bottom: 8 };
  const requestedX = Number.isFinite(Number(event.clientX))
    ? Number(event.clientX)
    : Number(anchorRect.left) || 8;
  const requestedY = Number.isFinite(Number(event.clientY))
    ? Number(event.clientY)
    : Number(anchorRect.bottom) || 8;
  const x = Math.min(requestedX, window.innerWidth - rect.width - submenuReserve - 8);
  const y = Math.min(requestedY, window.innerHeight - rect.height - 8);
  els.contextMenu.style.left = `${Math.max(8, x)}px`;
  els.contextMenu.style.top = `${Math.max(8, y)}px`;
  const firstItem = menuItemsIn(els.contextMenu)[0];
  (firstItem || els.contextMenu).focus({ preventScroll: true });
}

function isContextMenuKey(event) {
  return event?.key === 'ContextMenu' || (event?.key === 'F10' && event.shiftKey);
}

function hideContextMenu(options = {}) {
  if (els.contextMenu.hidden) return;
  els.contextMenu.hidden = true;
  for (const submenu of els.contextMenu.querySelectorAll('.context-submenu.open')) {
    submenu.classList.remove('open');
    submenu.querySelector(':scope > .context-submenu-trigger')?.setAttribute('aria-expanded', 'false');
  }
  if (options.restoreFocus) {
    const target = contextMenuReturnFocus?.();
    if (target instanceof HTMLElement && target.isConnected && !target.hidden) {
      target.focus({ preventScroll: true });
    }
  }
  contextMenuReturnFocus = null;
}

function contextMenuReturnFocusResolver(event) {
  const eventTarget = event?.target instanceof Element ? event.target : null;
  const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : eventTarget?.closest?.('button, [tabindex]');
  const tabId = eventTarget?.closest?.('[data-tab-id]')?.dataset.tabId;
  if (tabId !== undefined) {
    return () => [...els.groupsList.querySelectorAll('.tab-row')]
      .find((row) => row.dataset.tabId === tabId)
      ?.querySelector('.tab-main-button');
  }
  const spaceId = eventTarget?.closest?.('[data-space-id]')?.dataset.spaceId;
  if (spaceId !== undefined) {
    return () => [...els.spacesList.querySelectorAll('[data-space-id]')]
      .find((button) => button.dataset.spaceId === spaceId);
  }
  return () => focused;
}

function menuItemsIn(menu) {
  return [...(menu?.children || [])].flatMap((child) => {
    if (child.matches?.('[role="menuitem"]:not(:disabled)')) return [child];
    const submenuTrigger = child.matches?.('.context-submenu')
      ? child.querySelector(':scope > .context-submenu-trigger:not(:disabled)')
      : null;
    return submenuTrigger ? [submenuTrigger] : [];
  });
}

function handleContextMenuKeydown(event) {
  const item = event.target?.closest?.('[role="menuitem"]');
  const menu = item?.closest?.('[role="menu"]') || els.contextMenu;
  const items = menuItemsIn(menu);
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    hideContextMenu({ restoreFocus: true });
    return;
  }
  if (!item || items.length === 0) return;
  const index = Math.max(0, items.indexOf(item));
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
      ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[nextIndex].focus({ preventScroll: true });
    return;
  }
  if (event.key === 'ArrowRight' && item.classList.contains('context-submenu-trigger')) {
    event.preventDefault();
    event.stopPropagation();
    const wrapper = item.closest('.context-submenu');
    setContextSubmenuOpen(wrapper, true);
    menuItemsIn(wrapper.querySelector('.context-submenu-panel'))[0]?.focus({ preventScroll: true });
    return;
  }
  if (event.key === 'ArrowLeft') {
    const wrapper = item.closest('.context-submenu');
    if (!wrapper || !item.closest('.context-submenu-panel')) return;
    event.preventDefault();
    event.stopPropagation();
    setContextSubmenuOpen(wrapper, false);
    wrapper.querySelector(':scope > .context-submenu-trigger')?.focus({ preventScroll: true });
  }
}

function menuAction(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  button.tabIndex = -1;
  button.textContent = label;
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    hideContextMenu({ restoreFocus: true });
    await runTask(handler);
  });
  return button;
}

function menuNotice(label) {
  const item = document.createElement('div');
  item.className = 'context-notice';
  item.setAttribute('role', 'note');
  item.textContent = label;
  return item;
}

function moveToSpaceSubmenu(actionForSpace) {
  const spaces = state.spaces.filter((space) => space.id !== state.activeSpaceId);
  if (spaces.length === 0) return null;
  return menuSubmenu(
    'Move to',
    spaces.map((space) => menuAction(space.name, (windowBinding) => (
      actionForSpace(space, windowBinding)
    ))),
  );
}

function menuSubmenu(label, items) {
  const wrapper = document.createElement('div');
  wrapper.className = 'context-submenu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'context-submenu-trigger';
  trigger.setAttribute('role', 'menuitem');
  trigger.tabIndex = -1;
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = `<span>${escapeHtml(label)}</span><span class="context-submenu-arrow" aria-hidden="true">›</span>`;

  const panel = document.createElement('div');
  panel.className = 'context-submenu-panel';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', label);
  panel.replaceChildren(...items.filter(Boolean));

  wrapper.addEventListener('mouseenter', () => setContextSubmenuOpen(wrapper, true));
  wrapper.addEventListener('mouseleave', () => setContextSubmenuOpen(wrapper, false));
  wrapper.addEventListener('focusout', (event) => {
    if (!wrapper.contains(event.relatedTarget)) setContextSubmenuOpen(wrapper, false);
  });
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setContextSubmenuOpen(wrapper, true);
    menuItemsIn(panel)[0]?.focus({ preventScroll: true });
  });

  wrapper.append(trigger, panel);
  return wrapper;
}

function setContextSubmenuOpen(wrapper, open) {
  if (!wrapper) return;
  wrapper.classList.toggle('open', open);
  wrapper.querySelector(':scope > .context-submenu-trigger')
    ?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function menuSection(item) {
  return item ? [menuSeparator(), item] : [];
}

function menuSeparator() {
  const item = document.createElement('div');
  item.className = 'context-separator';
  item.setAttribute('role', 'separator');
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
      // Diff lines make the proposal readable as before → after: movers show
      // the source and target Tag, renames show the arrow to the new panel
      // name, and tabs that already sit in their target Tag render dimmed
      // instead of pretending to move.
      if (item.rename) {
        const renameDiff = document.createElement('div');
        renameDiff.className = 'action-preview-diff action-preview-diff-rename';
        const renameArrow = document.createElement('span');
        renameArrow.className = 'action-preview-arrow';
        renameArrow.textContent = '\u2192';
        const renameTo = document.createElement('span');
        renameTo.className = 'action-preview-diff-to';
        renameTo.textContent = item.rename.to || '';
        renameDiff.append(renameArrow, renameTo);
        before.append(renameDiff);
      } else if (item.diff) {
        const diff = document.createElement('div');
        diff.className = 'action-preview-diff';
        const from = document.createElement('span');
        from.className = 'action-preview-diff-from';
        from.textContent = item.diff.from || 'Ungrouped';
        const arrow = document.createElement('span');
        arrow.className = 'action-preview-arrow';
        arrow.textContent = '\u2192';
        const to = document.createElement('span');
        to.className = 'action-preview-diff-to';
        to.textContent = item.diff.to || '';
        diff.append(from, arrow, to);
        before.append(diff);
      } else if (item.unchanged) {
        row.classList.add('is-unchanged');
        const stays = document.createElement('div');
        stays.className = 'action-preview-stays';
        stays.textContent = `Already in ${item.source || 'this Tag'}`;
        before.append(stays);
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
  renderSettingsAISection();
  renderTidyRulesSettings();
  els.undoArcImportButton.disabled = !(state.lastArcImport?.spaceIds || [])
    .some((spaceId) => state.spaces.some((space) => space.id === spaceId));

  const theme = state.tempTheme || state.theme || 'purple';
  for (const option of els.themeOptions.querySelectorAll('.theme-option')) {
    option.classList.toggle('active', option.dataset.theme === theme);
  }

  renderShortcutSettings();
  settingsBaseline = captureSettingsBaseline({
    ai: state.ai,
    theme: state.theme,
    shortcuts: state.shortcuts,
    tidyRules: state.tidyRules,
  });
}

let activeSettingsPanel = 'ai';

function showSettingsPanel(panelId) {
  if (!els.settingsView.querySelector(`[data-settings-panel-body="${panelId}"]`)) return;
  activeSettingsPanel = panelId;
  for (const button of els.settingsNav.querySelectorAll('[data-settings-panel]')) {
    button.classList.toggle('active', button.dataset.settingsPanel === panelId);
  }
  for (const body of els.settingsView.querySelectorAll('[data-settings-panel-body]')) {
    body.hidden = body.dataset.settingsPanelBody !== panelId;
  }
}

function renderTidyRulesSettings() {
  const rules = normalizeTidyRuleSettings(state.tidyRules);
  els.tidyRulesList.replaceChildren(...TIDY_RULES.map((rule) => {
    const row = document.createElement('label');
    row.className = 'tidy-rule-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.tidyRule = rule.id;
    checkbox.checked = tidyRuleEnabled(rules, rule.id);
    checkbox.disabled = rule.locked === true;
    const text = document.createElement('span');
    text.className = 'tidy-rule-label';
    text.textContent = rule.locked ? `${rule.label} (always on)` : rule.label;
    text.title = rule.description || rule.label;
    row.append(checkbox, text);
    return row;
  }));
  els.tidyGroupPromptInput.value = tidyRulePrompt(rules, 'group-by-topic');
  els.tidyRenamePromptInput.value = tidyRulePrompt(rules, 'rename-tabs');
}

function collectTidyRuleSettingsFromControls() {
  const enabled = {};
  const texts = {};
  for (const checkbox of els.tidyRulesList.querySelectorAll('input[data-tidy-rule]')) {
    enabled[checkbox.dataset.tidyRule] = checkbox.checked;
  }
  const groupPrompt = els.tidyGroupPromptInput.value.trim();
  const renamePrompt = els.tidyRenamePromptInput.value.trim();
  if (groupPrompt) texts['group-by-topic'] = groupPrompt;
  if (renamePrompt) texts['rename-tabs'] = renamePrompt;
  return normalizeTidyRuleSettings({ enabled, texts });
}

function renderSettingsAISection() {
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
}

function refreshSettingsAIBaseline() {
  const latest = captureSettingsBaseline({
    ai: state.ai,
    theme: state.theme,
    shortcuts: state.shortcuts,
  });
  settingsBaseline = {
    ...(settingsBaseline || latest),
    aiScope: latest.aiScope,
    language: latest.language,
    auth: latest.auth,
  };
}

function settingsAIControls() {
  return {
    providerInput: els.providerInput,
    baseUrlInput: els.baseUrlInput,
    modelInput: els.modelInput,
    modelOptions: els.modelOptions,
    apiKeyInput: els.apiKeyInput,
    thinkingLabel: els.thinkingLabel,
    thinkingInput: els.thinkingInput,
    thinkingHint: els.thinkingHint,
    languageInput: els.languageInput,
    testButton: els.testAIButton,
    statusTarget: els.settingsStatus,
  };
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
    placeholder.textContent = 'No provider';
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
  controls.baseUrlInput.value = normalized.provider === CUSTOM_AI_PROVIDER_ID ? normalized.baseUrl : provider.baseUrl;
  controls.baseUrlInput.readOnly = !provider.editableBaseUrl;
  controls.baseUrlInput.classList.toggle('readonly', controls.baseUrlInput.readOnly);
  controls.apiKeyInput.placeholder = provider.requiresApiKey === false ? 'Not required for Ollama' : 'Paste API key';
  renderModelOptions(provider, normalized.model, controls);
  controls.thinkingInput.value = normalized.thinking === 'enabled' ? 'enabled' : 'disabled';
  updateAIThinkingControl(controls, normalized);
}

function renderModelOptions(provider, selectedModel = '', controls = settingsAIControls()) {
  const entries = [
    ...provider.models.map((model) => ({ id: model.id, label: model.label })),
    ...detectedModelIds.map((modelId) => ({ id: modelId, label: modelId })),
  ];
  const seen = new Set();
  controls.modelOptions.replaceChildren(...entries
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .map((entry) => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label;
      return option;
    }));
  controls.modelInput.value = String(selectedModel || '');
}

function updateAIThinkingControl(controls = settingsAIControls(), settings = null) {
  const provider = providerById(controls.providerInput.value);
  const candidate = settings || {
    provider: provider.id,
    baseUrl: provider.editableBaseUrl ? controls.baseUrlInput.value : provider.baseUrl,
    model: selectedModelFromControls(controls),
  };
  const supported = providerSupportsThinking(candidate);
  controls.thinkingInput.disabled = !supported;
  controls.thinkingHint.hidden = supported;
  controls.thinkingHint.textContent = supported
    ? ''
    : 'This provider/model does not support Space Tabs’ Thinking control.';
  controls.thinkingLabel.classList.toggle('thinking-unsupported', !supported);
  if (!supported) controls.thinkingInput.value = 'disabled';
  return supported;
}

function settingsFromProviderSelection(controls = settingsAIControls()) {
  const provider = providerById(controls.providerInput.value);
  const isCurrentCustom = state.ai.provider === CUSTOM_AI_PROVIDER_ID;
  return {
    ...state.ai,
    provider: provider.id,
    baseUrl: provider.editableBaseUrl && isCurrentCustom ? state.ai.baseUrl : provider.baseUrl,
    model: provider.editableBaseUrl && isCurrentCustom ? state.ai.model : provider.models[0]?.id || '',
    apiKey: '',
  };
}

function handleAIProviderChange(controls = settingsAIControls()) {
  controls.apiKeyInput.value = '';
  renderAIProviderFields(settingsFromProviderSelection(controls), controls);
  setAIControlsStatus(controls, 'Provider changed. Enter the API key for this provider before testing or saving.');
}

function clearAIKeyAfterEndpointEdit(controls = settingsAIControls()) {
  if (!controls.apiKeyInput.value) return;
  controls.apiKeyInput.value = '';
  setAIControlsStatus(controls, 'Base URL changed. Enter the API key for this endpoint again.');
}

function apiKeyStatusText() {
  if (localConfig.ai?.apiKey) return '';
  if (state.ai.apiKey) return 'API key is stored locally in this browser profile.';
  if (!providerRequiresApiKey(state.ai)) return 'Ollama does not require an API key.';
  return 'No API key configured.';
}

function renderShortcutSettings() {
  const shortcuts = mergeShortcuts(state.shortcuts);
  const rows = SHORTCUT_ACTIONS
    .filter((action) => action.id !== 'togglePanel')
    .map((action) => {
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
  const aiSettings = currentAISettingsDraftFromForm();
  const selectedTheme = state.tempTheme || settingsBaseline?.theme || state.theme;
  const baseline = structuredClone(settingsBaseline);
  const tidyRules = collectTidyRuleSettingsFromControls();
  const draft = {
    ai: aiSettings,
    theme: selectedTheme,
    shortcuts,
  };
  let mergeFailure = '';

  try {
    await withSharedStateLock(async () => {
      await syncStateFromStorage();
      const merged = mergeConcurrentSettings({
        baseline,
        draft,
        latest: {
          ai: state.ai,
          theme: state.theme,
          shortcuts: state.shortcuts,
        },
      });
      if (merged.conflicts.length > 0) {
        mergeFailure = settingsMergeConflictMessage(merged.conflicts);
        return;
      }
      const mergedShortcutConflict = shortcutConflict(merged.settings.shortcuts);
      if (mergedShortcutConflict) {
        mergeFailure = `${mergedShortcutConflict.label} now conflicts with ${mergedShortcutConflict.otherLabel} after Settings changed in another Space Tabs view. Review the latest Settings and try again.`;
        return;
      }
      const mergedAI = canPreserveUnconfiguredSettingsAI(
        merged.settings.ai,
        merged.userChanged,
      )
        ? normalizeAIProviderSettings(merged.settings.ai)
        : validateAISettings(merged.settings.ai);
      state.ai = mergedAI;
      state.shortcuts = merged.settings.shortcuts;
      state.theme = merged.settings.theme;
      state.tidyRules = tidyRules;
      delete state.tempTheme;
      await persistCurrentAIConfiguration();
    });
  } catch (error) {
    // The durable rollback reloads the last saved state. Keep the theme choice
    // as an explicit draft, just like the still-populated form controls, so a
    // retry submits exactly what the user reviewed instead of the old theme.
    state.tempTheme = selectedTheme;
    applyTheme(selectedTheme);
    throw error;
  }
  if (mergeFailure) {
    delete state.tempTheme;
    applyTheme(state.theme);
    renderSettings();
    setSettingsStatus(mergeFailure);
    return;
  }
  renderSettings();
  setSettingsStatus('Settings saved.');
  render();
}

function settingsMergeConflictMessage(conflicts) {
  const fields = conflicts.map((key) => {
    if (key === 'baseline') return 'Settings baseline';
    if (key === 'ai') return 'AI provider settings';
    if (key === 'language') return 'AI response language';
    if (key === 'theme') return 'theme';
    if (key.startsWith('shortcut:')) {
      const actionId = key.slice('shortcut:'.length);
      return `${SHORTCUT_ACTIONS.find((action) => action.id === actionId)?.label || actionId} shortcut`;
    }
    return key;
  });
  return `${formatList(fields)} changed in another Space Tabs view while you were editing the same ${fields.length === 1 ? 'field' : 'fields'}. Nothing was saved; review the latest Settings and try again.`;
}

function formatList(values) {
  if (values.length < 2) return values[0] || 'Settings';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

async function clearApiKey(expectedAuthTarget = null) {
  if (localConfig.ai?.apiKey) {
    setSettingsStatus('API key comes from config.local.js. Remove it there and reload the extension.');
    return;
  }
  let targetChanged = false;
  await withSharedStateLock(async () => {
    await syncStateFromStorage();
    if (!sameAIAuthTarget(expectedAuthTarget, state.ai)) {
      targetChanged = true;
      return;
    }
    state.ai.apiKey = '';
    await persistCurrentAIConfiguration();
  });
  renderSettingsAISection();
  refreshSettingsAIBaseline();
  if (targetChanged) {
    setSettingsStatus('The AI provider, endpoint, or API key changed in another Space Tabs view. Nothing was cleared; review the latest Settings and try again.');
    return;
  }
  setSettingsStatus('API key cleared. AI requests are disabled until you add a key.');
}

function currentAISettingsFromForm() {
  return currentAISettingsFromControls(settingsAIControls());
}

function currentAISettingsDraftFromForm() {
  return currentAISettingsDraftFromControls(settingsAIControls());
}

function currentAISettingsFromControls(controls) {
  return validateAISettings(currentAISettingsDraftFromControls(controls));
}

function currentAISettingsDraftFromControls(controls) {
  const provider = providerById(controls.providerInput.value);
  return normalizeAIProviderSettings({
    ...state.ai,
    provider: provider.id,
    baseUrl: provider.editableBaseUrl ? controls.baseUrlInput.value.trim().replace(/\/+$/, '') : provider.baseUrl,
    model: selectedModelFromControls(controls),
    language: controls.languageInput?.value || state.ai.language || 'zh-CN',
    apiKey: controls.apiKeyInput.value.trim(),
    thinking: controls.thinkingInput.value,
  });
}

function validateAISettings(candidate = {}) {
  const normalized = normalizeAIProviderSettings(candidate);
  const settings = {
    ...normalized,
    language: String(normalized.language || 'zh-CN'),
    apiKey: providerRequiresApiKey(normalized) ? String(normalized.apiKey || '').trim() : '',
    thinking: providerSupportsThinking(normalized) && normalized.thinking === 'enabled'
      ? 'enabled'
      : 'disabled',
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
  assertSafeAIAuthTransport(settings);
  return settings;
}

async function persistCurrentAIConfiguration() {
  try {
    return await persistScopedAIConfiguration(state.ai, {
      readSettings: storageGet,
      readAuth: secretGet,
      persistSettings: () => storageSet({ [STORAGE_KEY]: stateForStorage() }),
      persistAuth: (auth) => secretSet({ [SECRET_STORAGE_KEY]: { ai: auth } }),
      clearAuth: () => secretRemove(SECRET_STORAGE_KEY),
      restoreSettings: (snapshot) => restoreStoredKey(
        snapshot,
        STORAGE_KEY,
        storageSet,
        storageRemove,
      ),
      restoreAuth: (snapshot) => restoreStoredKey(
        snapshot,
        SECRET_STORAGE_KEY,
        secretSet,
        secretRemove,
      ),
    });
  } catch (error) {
    try {
      await syncStateFromStorage();
    } catch (syncError) {
      throw new AggregateError(
        [error, syncError],
        `${error?.message || String(error)} The saved AI configuration could not be reloaded.`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function restoreStoredKey(snapshot, key, set, remove) {
  if (Object.hasOwn(snapshot || {}, key)) return set({ [key]: snapshot[key] });
  return remove(key);
}

function selectedModelFromControls(controls) {
  return controls.modelInput.value.trim();
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
  const panelShortcuts = { ...shortcuts };
  delete panelShortcuts.togglePanel;
  for (const action of SHORTCUT_ACTIONS.filter((item) => item.id !== 'togglePanel')) {
    const reservedId = findReservedShortcutConflict(panelShortcuts[action.id]);
    if (reservedId) {
      return {
        label: action.label,
        otherLabel: RESERVED_SHORTCUTS.find((item) => item.id === reservedId)?.label || reservedId,
      };
    }
    const otherId = findShortcutConflict(panelShortcuts, action.id, panelShortcuts[action.id]);
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

async function send(type, payload = {}, options = {}) {
  if (!extensionRuntime) return previewSend(type, payload);
  if (
    options.windowBinding &&
    !canUsePanelWindowBinding(options.windowBinding, options)
  ) {
    throw new Error('This panel moved to another Chrome window before the action could finish.');
  }
  const targetWindowId = options.windowBinding
    ? options.windowBinding.windowId
    : panelWindowId;
  const message = createPanelCommandMessage(type, payload, targetWindowId);
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
  activeAIRequestId = '';
  updateAIRequestUI();
  await send('ai:abort', { requestId }).catch(() => null);
}

function updateAIRequestUI() {
  const busy = Boolean(activeAIRequestId);
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

async function storageRemove(key) {
  if (extensionRuntime) return chrome.storage.local.remove(key);
  localStorage.removeItem(key);
}

// The scoped AI key lives in chrome.storage.local so it survives browser
// restarts and extension reloads. Key name is unchanged; only the storage
// area moved. Values written by older versions to the volatile session area
// are migrated on first read and removed there.
async function secretGet() {
  if (extensionRuntime && chrome.storage.local) {
    const storedLocal = await chrome.storage.local.get(SECRET_STORAGE_KEY);
    if (Object.hasOwn(storedLocal, SECRET_STORAGE_KEY)) return storedLocal;
    const legacy = chrome.storage.session
      ? await chrome.storage.session.get(SECRET_STORAGE_KEY)
      : {};
    if (Object.hasOwn(legacy, SECRET_STORAGE_KEY)) {
      await chrome.storage.local.set({ [SECRET_STORAGE_KEY]: legacy[SECRET_STORAGE_KEY] });
      await chrome.storage.session.remove(SECRET_STORAGE_KEY).catch(() => undefined);
      return { [SECRET_STORAGE_KEY]: legacy[SECRET_STORAGE_KEY] };
    }
    return storedLocal;
  }
  try {
    return JSON.parse(localStorage.getItem(SECRET_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

async function secretSet(value) {
  if (extensionRuntime && chrome.storage.local) return chrome.storage.local.set(value);
  localStorage.setItem(SECRET_STORAGE_KEY, JSON.stringify(value));
}

async function secretRemove(key) {
  if (extensionRuntime && chrome.storage.local) {
    await chrome.storage.local.remove(key);
    if (chrome.storage.session) {
      await chrome.storage.session.remove(key).catch(() => undefined);
    }
    return;
  }
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

async function currentBrowserSessionId() {
  const readValue = async () => {
    if (extensionRuntime && chrome.storage.session) {
      const [storedSession, storedLocal] = await Promise.all([
        chrome.storage.session.get(BROWSER_SESSION_STORAGE_KEY),
        chrome.storage.local.get(BROWSER_SESSION_CARRYOVER_STORAGE_KEY),
      ]);
      return {
        sessionValue: storedSession?.[BROWSER_SESSION_STORAGE_KEY],
        carryoverValue: storedLocal?.[BROWSER_SESSION_CARRYOVER_STORAGE_KEY],
      };
    }
    try {
      const storedSession = JSON.parse(sessionStorage.getItem(BROWSER_SESSION_STORAGE_KEY) || '{}');
      const storedLocal = JSON.parse(localStorage.getItem(BROWSER_SESSION_CARRYOVER_STORAGE_KEY) || '{}');
      return {
        sessionValue: storedSession?.[BROWSER_SESSION_STORAGE_KEY],
        carryoverValue: storedLocal?.[BROWSER_SESSION_CARRYOVER_STORAGE_KEY],
      };
    } catch {
      return { sessionValue: '', carryoverValue: '' };
    }
  };
  const { sessionValue, carryoverValue } = await readValue();
  const picked = pickBrowserSessionId({
    sessionValue,
    carryoverValue,
    randomId: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  if (picked.source === 'session') return picked.sessionId;

  const writes = [];
  if (extensionRuntime && chrome.storage.session) {
    writes.push(chrome.storage.session.set({ [BROWSER_SESSION_STORAGE_KEY]: picked.sessionId }));
    if (picked.source === 'new') {
      writes.push(chrome.storage.local.set({
        [BROWSER_SESSION_CARRYOVER_STORAGE_KEY]: picked.sessionId,
      }));
    }
  } else {
    sessionStorage.setItem(BROWSER_SESSION_STORAGE_KEY, JSON.stringify({
      [BROWSER_SESSION_STORAGE_KEY]: picked.sessionId,
    }));
    if (picked.source === 'new') {
      localStorage.setItem(BROWSER_SESSION_CARRYOVER_STORAGE_KEY, JSON.stringify({
        [BROWSER_SESSION_CARRYOVER_STORAGE_KEY]: picked.sessionId,
      }));
    }
  }
  await Promise.all(writes);
  return picked.sessionId;
}

async function windowStateGet() {
  if (extensionRuntime && chrome.storage.session) return chrome.storage.session.get(WINDOW_STATE_KEY);
  try {
    return JSON.parse(sessionStorage.getItem(WINDOW_STATE_KEY) || '{}');
  } catch {
    return {};
  }
}

async function windowStateSet(value) {
  if (extensionRuntime && chrome.storage.session) return chrome.storage.session.set(value);
  sessionStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(value));
}

async function windowStateRemove(key) {
  if (extensionRuntime && chrome.storage.session) return chrome.storage.session.remove(key);
  sessionStorage.removeItem(key);
}

function stateForStorage() {
  const ai = {
    ...state.ai,
    apiKey: '',
  };
  delete ai.maxTokens;
  const activeSpaceId = activeSpaceForStorage(
    state.spaces,
    durableActiveSpaceId,
    state.activeSpaceId,
  );
  return {
    ...state,
    activeSpaceId,
    ai,
  };
}

function assertCurrentStateFitsStorage() {
  return assertWorkspaceStorageBudget({ [STORAGE_KEY]: stateForStorage() });
}

function captureWorkspaceMemoryCheckpoint() {
  return {
    state: structuredClone(state),
    durableActiveSpaceId,
    windowSpaceState: structuredClone(windowSpaceState),
    activeView,
    dormantSpaceView: structuredClone(dormantSpaceView),
    dormantSpaceViewSpaceId,
    logicalChromeGroupTitles: [...logicalChromeGroupTitles],
  };
}

function restoreWorkspaceMemoryCheckpoint(checkpoint, { renderView = false } = {}) {
  state = structuredClone(checkpoint.state);
  durableActiveSpaceId = checkpoint.durableActiveSpaceId;
  windowSpaceState = structuredClone(checkpoint.windowSpaceState);
  activeView = checkpoint.activeView;
  dormantSpaceView = structuredClone(checkpoint.dormantSpaceView);
  dormantSpaceViewSpaceId = checkpoint.dormantSpaceViewSpaceId;
  logicalChromeGroupTitles.clear();
  for (const [groupId, title] of checkpoint.logicalChromeGroupTitles) {
    logicalChromeGroupTitles.set(groupId, title);
  }
  lastRenderedGroupsSignature = '';
  lastRenderedSpacesSignature = '';
  if (renderView) {
    render();
    renderSettings();
  }
}

async function rollbackWindowBoundCreatedTabMutation(checkpoint, options = {}) {
  restoreWorkspaceMemoryCheckpoint(checkpoint);
  if (options.stateMayHaveBeenPersisted) {
    try {
      // saveState would use the Workbench's new window after an epoch change.
      // Restore the exact pre-gesture pair instead, so compensation cannot
      // overwrite the destination window's independent active-Space mapping.
      await persistStoragePair({
        key: WINDOW_STATE_KEY,
        value: checkpoint.windowSpaceState,
        get: windowStateGet,
        set: windowStateSet,
        remove: windowStateRemove,
      }, {
        key: STORAGE_KEY,
        value: stateForStorage(),
        get: storageGet,
        set: storageSet,
        remove: storageRemove,
      });
    } catch (rollbackError) {
      throw createRollbackFailureError(options.error, [{
        stage: 'restoring the workspace after the Workbench moved windows',
        error: rollbackError,
      }]);
    }
  }
  if (isCurrentPanelWindowBinding(options.windowBinding)) {
    render();
    renderSettings();
  }
}

function restoreFailedWorkspaceMutation(previousState, options = {}) {
  state = previousState;
  dormantSpaceView = [];
  dormantSpaceViewSpaceId = '';
  lastRenderedGroupsSignature = '';
  lastRenderedSpacesSignature = '';
  if (!isCurrentPanelWindowBinding(options.windowBinding)) return;
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
    const windowBinding = capturePanelWindowBinding();
    runTask(() => handler(windowBinding));
  });
  return button;
}

function runTask(task) {
  // Capture the Workbench host window synchronously with the user gesture.
  // A queued task must never inherit whichever window the host happens to be
  // attached to when an earlier task finally releases the queue.
  const windowBinding = capturePanelWindowBinding();
  activeTaskCount += 1;
  const execute = async () => {
    try {
      await task(windowBinding);
    } catch (error) {
      const message = formatAIError(error);
      setStatus(message);
      if (activeView === 'settings') setSettingsStatus(message);
      else if (workbenchMode) showStatusToast(message, 'error');
      console.error(error);
    } finally {
      activeTaskCount = Math.max(0, activeTaskCount - 1);
    }
  };
  const queuedTask = taskQueue.then(execute, execute);
  taskQueue = queuedTask.catch(() => undefined);
  return queuedTask;
}

// Re-entrancy depth for this panel context. Web Locks are not re-entrant, and
// saveState now takes the shared lock itself, so nested callers (loadState,
// withFreshSpaceStateMutation) must reuse the held lock instead of deadlocking.
let sharedStateLockDepth = 0;

async function withSharedStateLock(task) {
  if (!extensionRuntime || !navigator.locks?.request) return task();
  if (sharedStateLockDepth > 0) return task();
  sharedStateLockDepth += 1;
  try {
    return await navigator.locks.request(SHARED_STATE_LOCK_NAME, { mode: 'exclusive' }, task);
  } finally {
    sharedStateLockDepth -= 1;
  }
}

async function withFreshSpaceStateMutation(task, options = {}) {
  const windowBinding = options.windowBinding || capturePanelWindowBinding();
  if (!isCurrentPanelWindowBinding(windowBinding)) return false;
  return withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false || !isCurrentPanelWindowBinding(windowBinding)) return false;
    const loaded = await loadTabs({ adopt: false, windowBinding });
    if (loaded === false || !isCurrentPanelWindowBinding(windowBinding)) return false;
    await loadDormantSpaceView(state.activeSpaceId, { force: true });
    if (!isCurrentPanelWindowBinding(windowBinding)) return false;
    render();
    return task(windowBinding);
  });
}

async function refreshOrganizationActionState({ adopt = false, windowBinding = null } = {}) {
  return withSharedStateLock(async () => {
    const synchronized = await syncStateFromStorage({ windowBinding });
    if (synchronized === false) return false;
    const loaded = await loadTabs({ adopt, windowBinding });
    if (loaded === false) return false;
    await loadDormantSpaceView(state.activeSpaceId, { force: true });
    if (!isCurrentPanelWindowBinding(windowBinding)) return false;
    render();
    return true;
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
  const snapshotGroupId = String(reference?.snapshotGroupId || '');
  const candidates = snapshotGroupId
    ? spaceView.filter((group) => String(group.snapshotGroupId || '') === snapshotGroupId)
    : spaceView.filter((group) => group.key === reference?.key);
  const current = candidates.length === 1 ? candidates[0] : null;
  if (!current || groupMutationFingerprint(current) !== groupMutationFingerprint(reference)) {
    throw new Error('This group changed in another Space Tabs view. Try the action again.');
  }
  return current;
}

function groupMutationFingerprint(group = {}) {
  const snapshotGroupId = String(group.snapshotGroupId || '');
  return JSON.stringify({
    // Snapshot identities survive Chrome group materialization and snapshot
    // reindexing. Fall back to render keys only for legacy groups that do not
    // have that durable identity yet.
    key: snapshotGroupId ? '' : String(group.key || ''),
    snapshotGroupId,
    dormant: Boolean(group.dormant),
    title: groupTitleKey(group.title || group.displayTitle),
    color: String(group.color || ''),
    tabs: (group.tabs || []).map((tab) => {
      const snapshotTabId = String(tab?.snapshotTabId || '');
      return {
        // Dormant DOM ids contain snapshot indexes and can change when an
        // unrelated Tag is reordered. Their stable row id is authoritative.
        id: tab?.dormant && snapshotTabId ? '' : String(tab?.id ?? ''),
        snapshotTabId,
        url: snapshotUrlIdentity(tab?.url),
        dormant: Boolean(tab?.dormant),
      };
    }).sort((left, right) => (
      `${left.id}\n${left.url}`.localeCompare(`${right.id}\n${right.url}`)
    )),
  });
}

function currentSpace() {
  return state.spaces.find((space) => space.id === state.activeSpaceId) || state.spaces[0];
}

function buildSpaceViewForSpace(spaceId, options = {}) {
  const sourceTabs = Array.isArray(options.sourceTabs) ? options.sourceTabs : tabs;
  const sourceGroups = Array.isArray(options.sourceGroups) ? options.sourceGroups : groups;
  return buildSpaceView({
    activeSpaceId: spaceId,
    tabs: sourceTabs,
    groups: sourceGroups,
    groupSpaces: state.groupSpaces,
    tabSpaces: state.tabSpaces,
    virtualGroups: state.virtualGroups,
    tabGroups: state.tabGroups,
    groupOrder: state.groupOrder,
    tabOrder: state.tabOrder,
    collapsedGroups: state.collapsedGroups,
    includeUngrouped: true,
  })
    .map((group) => projectLifecycleAwareLiveGroup(group, spaceId, {
      attachSpaceId: true,
      filterEphemeral: true,
    }))
    .filter((group) => group.tabs.length > 0 || group.key === 'ungrouped');
}

function projectLifecycleAwareLiveGroup(group = {}, spaceId = '', options = {}) {
  const identityTabs = (group.tabs || []).filter((tab) => !isEphemeralTab(tab));
  const visibleTabs = options.filterEphemeral ? identityTabs : (group.tabs || []);
  const lifecycleGroupIds = new Set(identityTabs
    .map((tab) => String(tab.snapshotGroupId || '').trim())
    .filter(Boolean));
  return {
    ...group,
    ...logicalChromeGroupTitleOverride(group),
    ...snapshotLogicalChromeGroupTitleOverride(group, identityTabs, spaceId),
    ...(options.attachSpaceId ? { spaceId } : {}),
    ...(lifecycleGroupIds.size === 1
      ? { snapshotGroupId: lifecycleGroupIds.values().next().value }
      : {}),
    tabs: options.attachSpaceId
      ? visibleTabs.map((tab) => ({ ...tab, spaceId }))
      : visibleTabs,
  };
}

function snapshotLogicalChromeGroupTitleOverride(group = {}, contentTabs = [], spaceId = '') {
  if (!Number.isSafeInteger(Number(group.id)) || Number(group.id) < 0) return {};
  const snapshotGroupIds = new Set((contentTabs || [])
    .map((tab) => String(tab?.snapshotGroupId || '').trim())
    .filter(Boolean));
  if (snapshotGroupIds.size !== 1) return {};
  const snapshotGroupId = snapshotGroupIds.values().next().value;
  const snapshotGroup = (state.spaceSnapshots?.[spaceId]?.groups || []).find((candidate) => (
    String(candidate?.snapshotGroupId || '').trim() === snapshotGroupId
  ));
  if (!snapshotGroup || !Object.hasOwn(snapshotGroup, 'title')) return {};
  const logicalTitle = String(snapshotGroup.title ?? '');
  if (logicalTitle === '') {
    if (String(group.title ?? '') !== '') return {};
  } else {
    const match = resolveChromeGroupTitleMatch(
      [group],
      logicalTitle,
      logicalGroupTitlesForSpace(spaceId),
    );
    if (Number(match?.group?.id) !== Number(group.id)) return {};
  }
  logicalChromeGroupTitles.set(Number(group.id), logicalTitle);
  return { title: logicalTitle, displayTitle: logicalTitle };
}

function logicalChromeGroupTitleOverride(group = {}) {
  const groupId = Number(group.id);
  if (!Number.isFinite(groupId) || !logicalChromeGroupTitles.has(groupId)) return {};
  const logicalTitle = String(logicalChromeGroupTitles.get(groupId) ?? '');
  if (logicalTitle === '') {
    if (String(group.title ?? '') !== '') return {};
  } else {
    const match = resolveChromeGroupTitleMatch([group], logicalTitle, [logicalTitle]);
    if (Number(match?.group?.id) !== groupId) return {};
  }
  return { title: logicalTitle, displayTitle: logicalTitle };
}

function isEphemeralTab(tab) {
  return ephemeralTabIdSet().has(Number(tab.id)) && isChromeNewTabUrl(tab.url);
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

function cleanupEphemeralTabIds(existingTabIds, pendingLifecycleTabIds = []) {
  if (!Array.isArray(state.ephemeralTabIds)) state.ephemeralTabIds = [];
  const liveTabIds = new Set(
    (Array.isArray(existingTabIds) ? existingTabIds : tabs.map((tab) => tab.id))
      .map(Number)
      .filter(Number.isFinite),
  );
  for (const tabId of Array.isArray(pendingLifecycleTabIds) ? pendingLifecycleTabIds : []) {
    if (Number.isFinite(Number(tabId))) liveTabIds.add(Number(tabId));
  }
  for (const tab of tabs) {
    if (Number.isFinite(Number(tab.id))) liveTabIds.add(Number(tab.id));
  }
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
  order[groupKey] = tabOrderAfterDuplicate(fallbackIds, sourceId, duplicateId);
}

function rememberCreatedGroupTabOrder(groupId, selectedTabs, spaceId = state.activeSpaceId) {
  const numericGroupId = Number(groupId);
  if (!Number.isSafeInteger(numericGroupId) || numericGroupId < 0) return;
  const orderedIds = [...(selectedTabs || [])]
    .filter((tab) => Number.isSafeInteger(Number(tab?.id)))
    .sort((left, right) => Number(left.index) - Number(right.index))
    .map((tab) => Number(tab.id));
  if (orderedIds.length === 0) return;
  for (const tabId of orderedIds) removeTabFromSavedOrder(tabId, spaceId);
  ensureTabOrderForSpace(spaceId)[`group:${numericGroupId}`] = uniqueKeys(orderedIds);
}

function tabOrderKeyForTab(tab) {
  if (isGroupedTab(tab)) return `group:${tab.groupId}`;
  return state.tabGroups?.[tab?.id] || 'ungrouped';
}

async function createChromeGroup(tabIds, options = {}) {
  const ids = uniqueNumberIds(tabIds);
  if (ids.length === 0) return null;
  const requestedTitle = Object.hasOwn(options, 'title')
    ? String(options.title ?? '').trim()
    : 'Tabs';
  const logicalTitle = requestedTitle === '' ? '' : normalizeGroupTitle(requestedTitle, 'Tabs');
  const physicalTitle = logicalTitle === '' ? '' : chromeGroupTitle(logicalTitle, 'Tabs');
  const color = options.color || nextGroupColor();
  const result = await send('tabs:group', {
    tabIds: ids,
    title: physicalTitle,
    color,
    collapsed: Boolean(options.collapsed),
  }, {
    windowBinding: options.windowBinding,
    allowStaleWindowBinding: options.allowStaleWindowBinding,
  });
  const groupId = Number(result.groupId);
  if (result.groupId === null || !Number.isSafeInteger(groupId) || groupId < 0) return null;
  logicalChromeGroupTitles.set(groupId, logicalTitle);
  if (!groups.some((group) => Number(group.id) === groupId)) {
    groups.push({
      id: groupId,
      title: physicalTitle,
      color,
      collapsed: Boolean(options.collapsed),
    });
  }
  bindChromeGroup(groupId, options.spaceId || state.activeSpaceId, {
    sourceKey: options.sourceKey,
    collapsed: Boolean(options.collapsed),
  });
  clearLocalTabGrouping(ids);
  return groupId;
}

async function addTabsToChromeGroup(
  groupId,
  tabIds,
  spaceId = state.activeSpaceId,
  options = {},
) {
  const ids = uniqueNumberIds(tabIds);
  const numericGroupId = Number(groupId);
  if (!Number.isFinite(numericGroupId) || ids.length === 0) return null;
  const result = await send('tabs:groupExisting', { groupId: numericGroupId, tabIds: ids }, {
    windowBinding: options.windowBinding,
    allowStaleWindowBinding: options.allowStaleWindowBinding,
  });
  const nextGroupId = Number(result.groupId);
  if (result.groupId === null || !Number.isSafeInteger(nextGroupId) || nextGroupId < 0) return null;
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

async function chromeGroupForTitle(title, spaceId = state.activeSpaceId, options = {}) {
  const candidates = groups.filter((group) => state.groupSpaces[group.id] === spaceId);
  const match = resolveChromeGroupTitleMatch(candidates, title, logicalGroupTitlesForSpace(spaceId));
  if (!match) return null;
  if (match.needsRename) {
    const result = await send('groups:update', {
      groupId: match.group.id,
      update: { title: match.expectedTitle },
    }, { windowBinding: options.windowBinding });
    if (!result.group) return null;
    Object.assign(match.group, result.group);
  }
  logicalChromeGroupTitles.set(Number(match.group.id), normalizeGroupTitle(title));
  return match.group;
}

function chromeGroupForSnapshotIdentity(
  snapshotGroup,
  spaceId = state.activeSpaceId,
  sourceTabs = tabs,
) {
  const snapshotGroupId = validSnapshotLifecycleId(snapshotGroup?.snapshotGroupId);
  if (!snapshotGroupId) return null;
  const candidates = new Map();
  for (const tab of sourceTabs) {
    const binding = state.tabLifecycle?.[tab.id];
    const tabSnapshotGroupId = validSnapshotLifecycleId(
      binding?.snapshotGroupId || tab.snapshotGroupId,
    );
    if (
      !isGroupedTab(tab) ||
      (binding?.spaceId || tab.spaceId) !== spaceId
    ) continue;
    const groupId = Number(tab.groupId);
    if (!candidates.has(groupId)) {
      candidates.set(groupId, { matching: 0, snapshotGroupIds: new Set() });
    }
    const candidate = candidates.get(groupId);
    if (tabSnapshotGroupId) candidate.snapshotGroupIds.add(tabSnapshotGroupId);
    if (tabSnapshotGroupId === snapshotGroupId) candidate.matching += 1;
  }
  const groupId = [...candidates.entries()]
    .filter(([, candidate]) => (
      candidate.matching > 0 &&
      candidate.snapshotGroupIds.size === 1 &&
      candidate.snapshotGroupIds.has(snapshotGroupId)
    ))
    .sort((left, right) => right[1].matching - left[1].matching || left[0] - right[0])[0]?.[0];
  if (!Number.isSafeInteger(groupId)) return null;
  const group = groups.find((candidate) => Number(candidate.id) === groupId);
  if (!group) return null;
  bindChromeGroup(groupId, spaceId);
  const logicalTitle = Object.hasOwn(snapshotGroup, 'title')
    ? String(snapshotGroup.title ?? '')
    : Object.hasOwn(group, 'title')
      ? String(group.title ?? '')
      : 'Tabs';
  logicalChromeGroupTitles.set(
    groupId,
    logicalTitle === '' ? '' : normalizeGroupTitle(logicalTitle),
  );
  return group;
}

// Opening a saved row under a same-titled live Tag used to join the chrome
// group while keeping the saved row's second identity. A group carrying two
// snapshot identities can never match a saved Tag again — the view split off
// an extra empty pill per duplicate and collapse refused to save the Tag — so
// a title match first folds duplicate saved Tags into one saved identity and
// re-points the reused group's rows at it before the new row joins.
async function resolveDormantChromeGroupTarget(dormantGroup, tab, options = {}) {
  const identityMatch = chromeGroupForSnapshotIdentity(dormantGroup, state.activeSpaceId);
  if (identityMatch) {
    return {
      group: identityMatch,
      snapshotGroupId: String(dormantGroup.snapshotGroupId || tab?.snapshotGroupId || '').trim(),
    };
  }
  const titledMatch = await chromeGroupForTitle(
    dormantGroup.title,
    state.activeSpaceId,
    { windowBinding: options.windowBinding },
  );
  if (!titledMatch) return null;
  const mergedPlan = convergeDuplicateSavedTags();
  const rowSnapshotGroupId = String(
    dormantGroup.snapshotGroupId || tab?.snapshotGroupId || '',
  ).trim();
  const snapshotGroupId = String(
    mergedPlan.snapshotGroupIdReplacements[rowSnapshotGroupId] ||
    canonicalSameTitleSavedGroupId(dormantGroup.title) ||
    rowSnapshotGroupId,
  ).trim();
  const liveSavedGroupId = coherentSavedGroupIdForChromeGroup(titledMatch.id);
  if (liveSavedGroupId && snapshotGroupId && liveSavedGroupId !== snapshotGroupId) {
    // The reused group's rows were saved under an identity the duplicate merge
    // could not collapse (no stored copy of its own). Point them at the
    // surviving saved Tag so the chrome group keeps exactly one identity.
    remapMergedSnapshotGroupReferences({ [liveSavedGroupId]: snapshotGroupId });
  }
  return { group: titledMatch, snapshotGroupId };
}

function convergeDuplicateSavedTags() {
  const mergedPlan = mergeDuplicateSnapshotTags(
    state.spaceSnapshots?.[state.activeSpaceId] || null,
  );
  if (mergedPlan.mergedCount > 0) {
    replaceActiveSpaceSnapshotGroups(mergedPlan.snapshot.groups, mergedPlan.snapshot);
    remapMergedSnapshotGroupReferences(mergedPlan.snapshotGroupIdReplacements);
  }
  return mergedPlan;
}

function canonicalSameTitleSavedGroupId(title) {
  const titleKey = groupTitleKey(title);
  if (!titleKey) return '';
  const matches = (state.spaceSnapshots?.[state.activeSpaceId]?.groups || []).filter((group) => (
    !isUngroupedSnapshotGroup(group) &&
    groupTitleKey(group.title) === titleKey &&
    String(group.snapshotGroupId || '').trim()
  ));
  return matches.length === 1 ? String(matches[0].snapshotGroupId) : '';
}

function coherentSavedGroupIdForChromeGroup(chromeGroupId) {
  const savedIds = new Set();
  for (const liveTab of tabs) {
    if (Number(liveTab.groupId) !== Number(chromeGroupId)) continue;
    const binding = currentLifecycleBinding(liveTab.id);
    const savedId = String(binding?.snapshotGroupId || liveTab.snapshotGroupId || '').trim();
    if (savedId) savedIds.add(savedId);
  }
  return savedIds.size === 1 ? [...savedIds][0] : '';
}

function logicalGroupTitlesForSpace(spaceId = state.activeSpaceId) {
  return [
    ...(state.spaceSnapshots?.[spaceId]?.groups || []).map((group) => group?.title),
    ...Object.values(state.virtualGroups || {})
      .filter((group) => group?.spaceId === spaceId)
      .map((group) => group?.title),
    ...(spaceId === dormantSpaceViewSpaceId ? dormantSpaceView : []).map((group) => group?.title),
  ].filter(Boolean);
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
    title: normalizeGroupTitle(title),
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
  if (/fail(?:ed|ure)?|error|missing|invalid|cannot|conflict|rejected|must|enter|choose|too large|needs/i.test(message)) return 'error';
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
