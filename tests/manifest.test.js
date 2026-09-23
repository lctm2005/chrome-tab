import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { removeSnapshotTabs } from '../src/shared/space-snapshot.js';

const parsedSourceCache = new Map();

function parsedSource(source) {
  if (!parsedSourceCache.has(source)) {
    parsedSourceCache.set(source, parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    }));
  }
  return parsedSourceCache.get(source);
}

function functionSource(source, name) {
  const node = parsedSource(source).body.find((candidate) => (
    candidate.type === 'FunctionDeclaration' && candidate.id?.name === name
  ));
  assert.ok(node, `missing function ${name}`);
  return source.slice(node.start, node.end);
}

test('declares the Chrome MV3 side panel extension surface', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Space Tabs: Arc-like Spaces & BYOK AI');
  assert.equal(manifest.short_name, 'Space Tabs');
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.name.includes('Arc Sidecar'), false);
  assert.equal(manifest.action.default_title.includes('Arc Sidecar'), false);
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.incognito, 'not_allowed');
  assert.equal(manifest.commands._execute_action.suggested_key.mac, 'Alt+S');
  assert.equal(manifest.commands._execute_action.description, 'Toggle Space Tabs panel');
  assert.equal(manifest.content_scripts, undefined);
  for (const permission of ['sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting', 'favicon', 'alarms']) {
    assert.ok(manifest.permissions.includes(permission), `missing ${permission}`);
  }
  assert.equal(manifest.permissions.includes('activeTab'), false);
  assert.equal(manifest.permissions.includes('bookmarks'), false);
  assert.equal(manifest.permissions.includes('downloads'), false);
  assert.deepEqual(manifest.host_permissions || [], ['file:///*']);
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  assert.ok(manifest.optional_host_permissions.includes('http://*/*'));
  for (const size of ['16', '32', '48', '128']) {
    assert.equal(manifest.icons[size], `icons/icon${size}.png`);
    assert.equal(manifest.action.default_icon[size], `icons/icon${size}.png`);
    await access(new URL(`../icons/icon${size}.png`, import.meta.url));
  }
});

test('public privacy disclosure covers every required local-file host permission', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const privacyPage = await readFile(new URL('../website/app/privacy/page.tsx', import.meta.url), 'utf8');

  assert.ok(manifest.host_permissions.includes('file:///*'));
  assert.match(privacyPage, /file:\/\/\/\*/);
  assert.match(privacyPage, /Allow access to file URLs/);
  assert.match(privacyPage, /does not read (?:local )?file contents|does not read the file/);
});

test('settings expose provider and model selectors without prefilled free text model fallback', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(html, /<select id="providerInput"/);
  assert.match(html, /<select id="modelInput"/);
  assert.match(html, /id="customModelInput"/);
  assert.match(source, /AI_PROVIDER_CATALOG/);
  assert.match(source, /selectedModelFromControls\(/);
  assert.doesNotMatch(source, /model:\s*els\.modelInput\.value\.trim\(\)\s*\|\|\s*'glm-5\.1'/);
});

test('sidepanel exposes single-page Ask Page and portable backup controls without Context or Summary UI', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  for (const id of ['askScope', 'askProvider', 'askSourceSummary', 'askSourceList', 'exportSpaceDataButton', 'spaceBackupInput', 'restoreSpaceDataButton']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /class="ask-scope" id="askScope" hidden/);
  assert.match(html, /class="ask-disclosure" id="askDisclosure"[^>]* hidden/);
  assert.match(source, /askButton\.className = `space ask-page/);
  assert.match(html, />Ask Page</);
  assert.match(html, /Ask Page sends the current page and recent conversation context directly to your configured provider\./);
  assert.match(source, /createPrompt\('ask-page'/);
  assert.match(source, /purpose: 'ask-page'/);
  assert.match(source, /sessionKeyForTab\(sourceTab\)/);
  assert.match(source, /normalizeSessionUrl\(page\.url\) !== normalizeSessionUrl\(sourceTab\.url\)/);
  assert.match(source, /appendAskSourceLink\(answerText, page\)/);
  assert.match(source, /chrome\.tabs\.onActivated\.addListener\(handleChromeTabActivated\)/);
  assert.match(source, /lastActivatedAskPageTab/);
  assert.match(source, /selectEligibleTabSource\(tabs, lastActivatedAskPageTab, isEligibleAskPageTab\)/);
  assert.match(source, /function cacheAskPageTab[\s\S]*const authoritative = options\.authoritative === true[\s\S]*active: Boolean\(tab\.active\)[\s\S]*mergeTabActivationCache\(tabs, observed, \{ authoritative \}\)[\s\S]*tabs = merged\.tabs[\s\S]*return merged\.tab/);
  assert.match(source, /function observeAskPageTab[\s\S]*const previousSource = currentAskPageTab\(\)[\s\S]*cacheAskPageTab\(tab, observedAt\)[\s\S]*const nextSource = currentAskPageTab\(\)[\s\S]*refreshAskPageTargetUI\(\)/);
  assert.match(source, /function rememberAskPageTab[\s\S]*cacheAskPageTab\(tab, fallbackLastAccessed, \{ authoritative: true \}\)[\s\S]*lastActivatedAskPageTab = remembered/);
  assert.match(source, /startAskFromUserGesture/);
  assert.match(source, /requestAskPermissionsFromUserGesture/);
  assert.match(source, /chrome\.permissions\.request\(\{ origins \}\)/);
  assert.match(source, /send\('pages:extract', \{[\s\S]*tabIds: \[sourceTab\.id\]/);
  const askCustomPrompt = source.slice(
    source.indexOf('async function askCustomPrompt'),
    source.indexOf('async function beginAskTurn'),
  );
  assert.match(askCustomPrompt, /const sessionKey = sessionKeyForTab\(sourceTab\);\s*const session = projectAskSessionForTab\(state\.askSessions, sourceTab\)/);
  assert.match(askCustomPrompt, /const preparedSessionRevision = askSessionRevision\(session\)/);
  assert.doesNotMatch(askCustomPrompt, /ensureAskSessionByKey\(|setActiveAskSessionKey\(/);
  assert.doesNotMatch(askCustomPrompt, /showPlanPreview|Review Ask Page|Send to provider/);
  assert.match(askCustomPrompt, /assertPreparedAskPageStillCurrent\(page, sourceTab\)[\s\S]*beginAskTurn\([\s\S]*sessionKey,[\s\S]*prompt,[\s\S]*sourceTab,[\s\S]*session,[\s\S]*preparedSessionRevision,[\s\S]*requestId/);
  assert.ok(
    askCustomPrompt.indexOf('statusMessage = await beginAskTurn') < askCustomPrompt.indexOf("send('ai:chat'"),
    'the durable Ask begin contract completes before provider dispatch',
  );
  assert.match(source, /materializeAskSessionForTurn,[\s\S]{0,320}from '.\/src\/shared\/ask-session\.js'/);
  assert.match(source, /async function beginAskTurn[\s\S]*if \(extensionRuntime\) \{[\s\S]*await send\('ask:begin', \{[\s\S]*projectedSession,[\s\S]*preparedSessionRevision,[\s\S]*requestId,[\s\S]*setActiveAskSessionKey\(started\.sessionKey\)[\s\S]*withSharedStateLock\(\(\) => syncAskSessionsFromStorage\(\)\)[\s\S]*return \{[\s\S]*messageId: started\.messageId/);
  assert.match(source, /async function beginAskTurn[\s\S]*syncStateFromStorage\(\)[\s\S]*materializeAskSessionForTurn\([\s\S]*state\.askSessions,[\s\S]*sourceTab,[\s\S]*projectedSession,[\s\S]*askSessionRevision\(latestSession\) !== preparedSessionRevision[\s\S]*Nothing was sent; try again[\s\S]*setActiveAskSessionKey\(latestSession\.key\)[\s\S]*markAskStreamPending\(assistant, requestId\)[\s\S]*pruneCurrentAskSessions\(latestSession\.key\)[\s\S]*saveState\(\{ persistWindowState: false \}\)/);
  assert.match(background, /case 'ask:begin':[\s\S]*beginAskStreamTurn\(message\.askTurn\)/);
  assert.match(background, /async function beginAskStreamTurn[\s\S]*withLifecycleStateLock[\s\S]*askSessionRevision\(latestSession\)[\s\S]*markAskStreamPending\(assistant, requestId\)[\s\S]*storage\.local\.set[\s\S]*scheduleAskStreamRecoveryAlarm\(binding\.requestId\)/);
  assert.match(source, /async function assertPreparedAskPageStillCurrent[\s\S]*send\('tabs:listAll'\)[\s\S]*normalizeSessionUrl\(current\.pendingUrl \|\| current\.url\)[\s\S]*normalizeSessionUrl\(page\.url\)[\s\S]*Nothing was sent/);
  assert.doesNotMatch(source, /title: 'Review Ask Page'/);
  assert.match(source, /Switch to an http or https page before using Ask Page\./);
  const recentHistorySource = source.slice(
    source.indexOf('function recentAskHistory'),
    source.indexOf('async function beginAskTurn'),
  );
  assert.match(recentHistorySource, /text: askHistoryMessageText\(message\)/);
  assert.match(recentHistorySource, /filter\(\(message\) => message\.text\.trim\(\)\)/);
  assert.doesNotMatch(recentHistorySource, /\.split\(/);
  assert.match(source, /updateAskMessage\(stream\.messageRef, stream\.text \|\| 'Thinking\.\.\.', \{ persist: false \}\)/);
  assert.match(source, /async function persistAskMessage[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage[\s\S]*saveState\(\{ persistWindowState: false \}\)/);
  const beginAskTurnSource = source.slice(
    source.indexOf('async function beginAskTurn'),
    source.indexOf('async function persistAskMessage'),
  );
  const persistAskMessageSource = source.slice(
    source.indexOf('async function persistAskMessage'),
    source.indexOf('async function refreshPersistedAskMessage'),
  );
  const refreshPersistedAskMessageSource = source.slice(
    source.indexOf('async function refreshPersistedAskMessage'),
    source.indexOf('async function syncAskSessionsFromStorage'),
  );
  const syncAskSessionsSource = source.slice(
    source.indexOf('async function syncAskSessionsFromStorage'),
    source.indexOf('function replayAskMessageTabReplacements'),
  );
  const addAskMessageSource = source.slice(
    source.indexOf('async function addAskMessage'),
    source.indexOf('async function updateAskMessage'),
  );
  for (const askWriter of [beginAskTurnSource, persistAskMessageSource, addAskMessageSource]) {
    assert.doesNotMatch(askWriter, /saveState\(\)/, 'Ask-only writes must never persist a window Space mapping');
    assert.match(askWriter, /saveState\(\{ persistWindowState: false \}\)/);
  }
  assert.match(refreshPersistedAskMessageSource, /syncAskSessionsFromStorage\(\)/);
  assert.doesNotMatch(refreshPersistedAskMessageSource, /syncStateFromStorage|saveState|windowState/);
  assert.match(syncAskSessionsSource, /storageGet\(\)[\s\S]*state\.askSessions = workspace\.askSessions/);
  assert.doesNotMatch(syncAskSessionsSource, /windowState|panelWindowId|saveState|state\s*=\s*workspace/);
  assert.match(background, /case 'pages:extract'/);
  assert.doesNotMatch(background, /case 'page:(?:extract|outline)'/);
  assert.match(background, /reason: 'content-limit'/);
  assert.match(background, /if \(event\.done\)[\s\S]*reader\.cancel/);
  assert.match(background, /beginAskStreamPersistence\(binding\)/);
  assert.match(background, /checkpointAskStream\(sessions, binding, latestText, now\)/);
  assert.match(background, /finalizeAskStream\(sessions, binding, outcome\)/);
  assert.match(background, /handleAskStreamRecoveryAlarm/);
  assert.match(source, /createSpaceBackup\(state\)/);
  assert.match(source, /restoreSpaceBackup\(state, confirmedBackup\)/);
  assert.doesNotMatch(source, /createPrompt\('ask-space'|purpose: 'ask-space'|selectAskSpaceSources|appendAskSourceLinks|12-page limit/);
  assert.doesNotMatch(html, /Ask Space/);
  assert.doesNotMatch(html, /id="contextView"|id="spaceContextInput"|id="summarizePageButton"/);
  assert.doesNotMatch(source, /currentSpaceContextForAI|summarizeCurrentPage/);
});

test('sidepanel exposes focused onboarding and full-page Workbench Settings', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');

  for (const id of [
    'openWorkbenchButton',
    'onboardingDialog',
    'onboardingArcInput',
    'onboardingArcChooseButton',
    'arcImportChooseButton',
    'undoArcImportButton',
    'onboardingProviderInput',
    'onboardingBaseUrlInput',
    'onboardingModelInput',
    'onboardingCustomModelInput',
    'onboardingApiKeyInput',
    'onboardingThinkingLabel',
    'onboardingThinkingInput',
    'onboardingThinkingHint',
    'onboardingTestAIButton',
    'onboardingOpenWorkbenchButton',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ['onboardingSkipAIButton', 'onboardingExportButton', 'onboardingUndoArcButton']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`));
    assert.doesNotMatch(source, new RegExp(`\\b${id}\\b`));
  }
  assert.doesNotMatch(html, /id="(?:maxTokensInput|onboardingMaxTokensInput)"|Max output/i);
  assert.match(source, /const workbenchMode = layoutMode === 'workbench'/);
  assert.match(html, /id="onboardingOpenWorkbenchButton">Save</);
  assert.match(source, /function updateAIThinkingControl[\s\S]*providerSupportsThinking\(candidate\)[\s\S]*thinkingInput\.disabled = !supported[\s\S]*does not support Space Tabs’ Thinking control/);
  assert.match(html, /<option value="" selected>No provider<\/option>/);
  assert.match(html, /id="onboardingLanguageInput"[\s\S]*value="zh-CN"[\s\S]*value="en"[\s\S]*value="auto"/);
  assert.match(source, /function onboardingAIControls\(\)[\s\S]*languageInput: els\.onboardingLanguageInput/);
  assert.match(source, /renderOnboardingAISettings[\s\S]*controls\.languageInput\.value = state\.ai\?\.language \|\| 'zh-CN'/);
  assert.match(source, /async function saveOnboardingAIAndFinish\(options = \{\}\)[\s\S]*if \(!onboardingAIControls\(\)\.providerInput\.value\) \{[\s\S]*await finishOnboarding\(true, \{ \.\.\.options, clearAI: true \}\)/);
  assert.doesNotMatch(html, /Stay in side panel|id="onboardingStayButton"/);
  assert.match(source, /maybeShowOnboarding\(\)/);
  assert.match(source, /rememberArcImport\(/);
  assert.match(source, /url\.searchParams\.set\('layout', 'workbench'\)/);
  assert.match(source, /send\('tabs:openUnique'/);
  assert.match(source, /state\.onboarding\?\.completed === true/);
  assert.match(source, /addEventListener\('keydown', panelKeyboardController\.handleKeydown, \{ capture: true \}\)/);
  assert.match(html, /id="workbenchToast"/);
  assert.match(styles, /html\[data-layout="workbench"\] #settingsDialog/);
  assert.match(styles, /\.workbench-toast[\s\S]*top: 18px;[\s\S]*left: 50%;/);
  assert.match(styles, /\.workbench-toast\[data-tone="success"\]/);
  assert.match(html, /class="arc-import-settings"/);
  assert.match(html, /data-onboarding-path="arc"/);
  assert.doesNotMatch(html, /data-onboarding-path="arc" hidden/);
  assert.doesNotMatch(html, /Arc import is not available/i);
  assert.match(html, /id="onboardingArcInput" type="file"/);
  assert.match(html, /id="arcImportInput" type="file"/);
  assert.match(source, /function startArcFileSelectionFromUserGesture\(target\)[\s\S]*input\.value = '';[\s\S]*input\.click\(\)/);
  assert.doesNotMatch(source, /showOpenFilePicker|rememberArcFileHandle|loadRememberedArcFileHandle|rememberedArcFileHandle/);
  assert.doesNotMatch(source, /indexedDB(?:\?\.|\.)open(?:\?\.)?\(/);
  assert.match(source, /clearLegacyArcFileHandleStorage[\s\S]*deleteDatabase\?\.\('space-tabs-local-files'\)/);
  assert.doesNotMatch(html, /arcImportUseButton|authorized Arc file|Authorize Arc file/i);
  assert.match(source, /onboardingArcInput\.addEventListener\('cancel', \(event\) => event\.stopPropagation\(\)\)/);
  assert.match(source, /arcImportInput\.addEventListener\('cancel', \(event\) => event\.stopPropagation\(\)\)/);
  assert.match(source, /if \(event\.target !== event\.currentTarget\) return/);
  assert.match(source, /async function previewOnboardingArcFile[\s\S]*selectionGeneration !== onboardingArcSelectionGeneration[\s\S]*onboardingStep !== 1 \|\| onboardingPath !== 'arc'/);
  assert.match(source, /async function previewArcImportFile[\s\S]*selectionGeneration !== arcImportSelectionGeneration/);
  assert.match(source, /function clearOnboardingArcSelection[\s\S]*pendingOnboardingArcText = '';[\s\S]*onboardingArcInput\.value = '';[\s\S]*onboardingArcSpaces\.replaceChildren\(\)/);
  assert.match(source, /function chooseOnboardingPath\(path\)[\s\S]*path === 'fresh'[\s\S]*clearOnboardingArcSelection\(\)/);
  assert.match(source, /function goBackOnboarding\(\)[\s\S]*onboardingPath === 'arc'[\s\S]*clearOnboardingArcSelection\(\)/);
  assert.match(source, /async function applyArcOnboarding[\s\S]*finally \{[\s\S]*clearOnboardingArcSelection\(\{ preserveStatus: true \}\)/);
  assert.match(source, /async function finishOnboarding[\s\S]*clearOnboardingArcSelection\(\);[\s\S]*onboardingApiKeyInput\.value = '';/);
  assert.match(source, /async function finishOnboarding[\s\S]*captureWorkspaceMemoryCheckpoint\(\)[\s\S]*persistStorageStep\([\s\S]*restoreWorkspaceMemoryCheckpoint\(checkpoint\)/);
  assert.match(source, /async function applyFreshOnboardingFromCurrentState[\s\S]*committedCheckpoint = captureWorkspaceMemoryCheckpoint\(\)[\s\S]*restoreWorkspaceMemoryCheckpoint\(committedCheckpoint, \{ renderView: true \}\)[\s\S]*was created and saved, but its tabs could not refresh[\s\S]*return true/);
  assert.match(source, /function arcPlanResolutionSignature[\s\S]*preview\.sourceSpaceId,[\s\S]*preview\.resolvedId,[\s\S]*preview\.resolvedName/);
  assert.match(source, /async function importArcFile[\s\S]*arcPlanResolutionSignature\(pendingArcImportPlan\) !== arcPlanResolutionSignature\(latestPlan\)[\s\S]*previewInvalidated = true/);
  assert.match(source, /state\.onboarding = \{ version: 2, completed: false, stage: 'ai' \}/);
  assert.match(source, /state\.onboarding = \{ version: 2, completed: true, stage: 'done' \}/);
  assert.match(source, /saveOnboardingAIAndFinish[\s\S]*persistCurrentAIConfiguration\(\)/);
  assert.match(source, /function stateForStorage\(\)[\s\S]*apiKey: ''/);
  assert.match(source, /scopedAIKey\(secrets\[SECRET_STORAGE_KEY\]\?\.ai, nextState\.ai\)/);
  assert.match(source, /function persistCurrentAIConfiguration\(\)[\s\S]*persistScopedAIConfiguration[\s\S]*readSettings: storageGet[\s\S]*readAuth: secretGet[\s\S]*persistSettings: \(\) => storageSet\(\{ \[STORAGE_KEY\]: stateForStorage\(\) \}\)[\s\S]*persistAuth:[\s\S]*clearAuth:[\s\S]*restoreSettings:[\s\S]*restoreAuth:/);
  assert.match(source, /providerInput\.addEventListener\('change', \(\) => handleAIProviderChange/);
  assert.match(source, /baseUrlInput\.addEventListener\('input', \(\) => clearAIKeyAfterEndpointEdit/);
  assert.match(source, /function handleAIProviderChange[\s\S]*apiKeyInput\.value = ''/);
  assert.match(source, /function clearAIKeyAfterEndpointEdit[\s\S]*apiKeyInput\.value = ''/);
  assert.doesNotMatch(html, /Cross-Space Search/i);
  assert.doesNotMatch(source, /workspace-search/);
});

test('sidepanel keeps the compact setup, Settings, and group-hover surfaces', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');
  const choosePathSource = functionSource(source, 'chooseOnboardingPath');

  assert.match(
    html,
    /data-onboarding-path="fresh">[\s\S]*?<strong>Create new space<\/strong>[\s\S]*?data-onboarding-path="arc">[\s\S]*?<strong>Move from Arc<\/strong>/,
  );
  assert.doesNotMatch(
    html,
    /Skip setup|Start with one thing|Create a focused Space\.|Preview and choose the Spaces to import\./,
  );
  assert.match(
    html,
    /<footer class="onboarding-footer" id="onboardingFooter">[\s\S]*?id="onboardingBackButton"[\s\S]*?id="skipOnboardingButton">Skip<\/button>[\s\S]*?id="onboardingNextButton">Continue<\/button>[\s\S]*?<\/footer>/,
  );
  assert.match(source, /onboardingFooter\.classList\.toggle\('no-back', isChoose\)/);
  assert.match(styles, /\.onboarding-footer\.no-back\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(
    html,
    /id="onboardingProgress"[\s\S]*?<small>Space<\/small>[\s\S]*?<small>AI<\/small>[\s\S]*?<\/div>/,
  );
  assert.doesNotMatch(html, /<small>Choose<\/small>|AI &amp; ready|Keep Chrome\.<br>Bring your Arc workflow/);
  assert.match(html, /id="onboardingStepLabel">Step 1 of 2<\/span>/);
  assert.match(styles, /\.onboarding-progress\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(choosePathSource, /onboardingPath = path;[\s\S]*renderOnboarding\(\)/);
  assert.doesNotMatch(choosePathSource, /onboardingStep\s*=|startArcFileSelectionFromUserGesture|\.focus\(/);
  assert.match(source, /const visibleStep = isFinish \? 1 : 0;[\s\S]*`Step \$\{visibleStep \+ 1\} of 2`/);

  assert.doesNotMatch(html, /Panel Shortcuts|Toggle panel is a Chrome global shortcut/);
  assert.match(html, /<section class="shortcut-settings">\s*<div id="shortcutsList" class="shortcuts-list"><\/div>/);
  assert.doesNotMatch(source, /isSettingsView\s*\?\s*'Settings'/);

  assert.match(
    styles,
    /\.group-card:has\(> \.group-header:hover\)[\s\S]*?\.folder-direct-group:has\(> \.group-header:focus-within\)\s*\{\s*background: var\(--surface-hover\);/,
  );
  assert.match(
    styles,
    /\.group-card:has\(> \.group-header:hover\) > \.group-header[\s\S]*?\.folder-direct-group:has\(> \.group-header:focus-within\) > \.group-header\s*\{\s*background: transparent;/,
  );
});

test('Workbench setup preserves its surface while Space switching keeps target Tags dormant', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const switchSource = functionSource(source, 'switchSpace');
  const materializeSource = functionSource(source, 'materializeSpaceSwitchTarget');
  const closeSource = functionSource(source, 'closeSpaceSwitchSourceTabs');

  assert.match(source, /runOnboardingButton[\s\S]*activeView = workbenchMode \? 'ask' : 'space';[\s\S]*openOnboarding\(\{ restart: true \}\)/);
  assert.match(source, /async function activateSpace\(spaceId, options = \{\}\)[\s\S]*return switchSpace\(spaceId, \{ \.\.\.options, windowBinding \}\)/);
  assert.match(source, /if \(spaceId === state\.activeSpaceId\) \{[\s\S]*activeView = 'space';[\s\S]*render\(\);[\s\S]*return true;[\s\S]*\}\s*return switchSpace/);
  assert.match(switchSource, /options\.rollbackCheckpoint \|\| captureWorkspaceMemoryCheckpoint\(\)[\s\S]*withCreatedTabCheckpointRollback\(createdTabIds[\s\S]*snapshotOpenSpace\(previousSpaceId\)[\s\S]*planSpaceSwitch\(/);
  assert.match(switchSource, /const sourceCleanupTabs = uniqueSpaceSwitchTabs\([\s\S]*tabs\.filter\(isEphemeralTab\)[\s\S]*!snapshotHasPersistentContent\(sourceSnapshot\)[\s\S]*isChromeNewTabUrl\(tab\.url\)[\s\S]*tabBelongsToSpace\(tab, previousSpaceId\)[\s\S]*captureSpaceSwitchCloseTargets\([\s\S]*sourceCleanupTabs/);
  assert.match(switchSource, /state\.activeSpaceId = spaceId[\s\S]*durableActiveSpaceId = spaceId[\s\S]*loadDormantSpaceView\(spaceId, \{ force: true \}\)[\s\S]*saveState\(\{ windowBinding \}\)/);

  const materializeIndex = switchSource.indexOf('materializedTarget = await materializeSpaceSwitchTarget');
  const activateIndex = switchSource.indexOf('activatedTarget = await activateSpaceSwitchTarget');
  const saveIndex = switchSource.indexOf('const saved = await saveState({ windowBinding })');
  const closeIndex = switchSource.indexOf('const closeOutcome = await closeSpaceSwitchSourceTabs');
  assert.ok(materializeIndex >= 0 && materializeIndex < activateIndex);
  assert.ok(activateIndex < saveIndex && saveIndex < closeIndex,
    'the New Tab keepalive must be active and committed before source cleanup');
  assert.match(closeSource, /verifyMaterializedSpaceSwitchTarget\([\s\S]*focusSpaceSwitchSurvivor\([\s\S]*guardedReviewedTabClose\(/);
  assert.match(switchSource, /const closeOutcome = await closeSpaceSwitchSourceTabs[\s\S]*activatedTarget = await activateSpaceSwitchTarget/);
  assert.match(switchSource, /rollbackWindowBoundCreatedTabMutation\(checkpoint,[\s\S]*stateMayHaveBeenPersisted: storageMayBeDirty[\s\S]*reactivating the original Space tab/);
  assert.doesNotMatch(switchSource, /restoreSpaceSwitchTargetMembership|targetMembershipRollback/);
  assert.doesNotMatch(switchSource.slice(closeIndex), /rollbackWindowBoundCreatedTabMutation|restoreWorkspaceMemoryCheckpoint/);

  assert.match(materializeSource, /isChromeNewTabUrl\(tab\.url\)[\s\S]*url: 'chrome:\/\/newtab'[\s\S]*rememberEphemeralTab\(retainedFallbackTabId\)/);
  assert.match(materializeSource, /delete state\.tabGroups\?\.\[retainedFallbackTabId\][\s\S]*delete state\.tabLifecycle\?\.\[retainedFallbackTabId\][\s\S]*delete state\.renamedTabs\?\.\[retainedFallbackTabId\][\s\S]*delete state\.tabSpaces\[retainedFallbackTabId\]/);
  assert.doesNotMatch(materializeSource, /snapshotTab\.url|createChromeGroup|addTabsToChromeGroup|restoreGroups|targetSnapshot/);
  assert.match(switchSource, /verifyMaterializedSpaceSwitchTarget\(materializedTarget,[\s\S]*activeTabId: activeSurvivorTabId[\s\S]*saveState/);
  assert.match(closeSource, /spaceSwitchTargetTabGuards\([\s\S]*verifyMaterializedSpaceSwitchTarget\([\s\S]*focusSpaceSwitchSurvivor\([\s\S]*guardedReviewedTabClose\([\s\S]*requiredActiveSurvivorTabId[\s\S]*requiredTargetTabGuards/);
});

test('new Space transactions roll back to pre-insert storage without undoing a committed switch', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const onboardingSource = functionSource(source, 'applyFreshOnboardingFromCurrentState');
  const switchSource = functionSource(source, 'switchSpace');

  const checkpointIndex = onboardingSource.indexOf('const checkpoint = captureWorkspaceMemoryCheckpoint()');
  const insertIndex = onboardingSource.indexOf('state.spaces.push(targetSpace)');
  const switchIndex = onboardingSource.indexOf('const switched = await switchSpace(targetSpace.id');
  assert.ok(
    checkpointIndex >= 0 && checkpointIndex < insertIndex && insertIndex < switchIndex,
    'fresh onboarding must checkpoint the durable workspace before inserting its new Space',
  );
  assert.match(onboardingSource, /const switched = await switchSpace\(targetSpace\.id, \{[\s\S]*rollbackCheckpoint: checkpoint,[\s\S]*windowBinding: options\.windowBinding[\s\S]*if \(switched !== true\)/,
    'fresh onboarding must give Space switching the pre-insert checkpoint');
  assert.doesNotMatch(onboardingSource, /switched !== true \|\| !isCurrentPanelWindowBinding/,
    'a host-window change after switchSpace reports success must not roll back its committed Space');
  assert.match(onboardingSource, /if \(canReuseDefault\) \{[\s\S]*saved !== true \|\| !isCurrentPanelWindowBinding/,
    'the direct-save onboarding path must retain its pre-commit window guard');

  assert.match(switchSource, /const checkpoint = options\.rollbackCheckpoint \|\| captureWorkspaceMemoryCheckpoint\(\)/,
    'switchSpace must prefer a caller checkpoint that predates a newly inserted target');
  assert.match(switchSource, /rollbackWindowBoundCreatedTabMutation\(checkpoint,[\s\S]*stateMayHaveBeenPersisted: storageMayBeDirty/,
    'apply-then-reject failures must compensate storage from that selected checkpoint');
});

test('stored Space snapshots discard legacy temporary Ungrouped rows before first render', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const sanitizerSource = source.slice(
    source.indexOf('function sanitizeStoredSpaceSnapshot(spaceId)'),
    source.indexOf('function createSnapshotLifecycleId'),
  );

  assert.match(
    sanitizerSource,
    /dropTemporarySnapshotGroups\(\s*sanitizeSnapshotWithLifecycleIds\(/,
  );
  assert.match(sanitizerSource, /snapshotHasPersistentContent\(snapshot\)/);
  assert.match(source, /async function loadDormantSpaceView[\s\S]*sanitizeStoredSpaceSnapshot\(spaceId\)/);
});

test('settings Save click prevents dialog submit before async work starts', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /saveSettingsButton\.addEventListener\('click',\s*\(event\)\s*=>\s*\{\s*event\.preventDefault\(\);[\s\S]*?runTask\(\(windowBinding\)\s*=>\s*saveSettings\(\{ windowBinding \}\)\)/,
  );
});

test('sidepanel uses Chrome favicon URLs instead of remote tab favicon URLs', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /chrome\.runtime\.getURL\('\/_favicon\/'\)/);
  assert.match(source, /pageUrl/);
  assert.doesNotMatch(source, /img\.src\s*=\s*tab\.favIconUrl/);
});

test('dormant tab rows can remove the saved snapshot entry', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const removeDormantSource = functionSource(source, 'removeDormantTab');
  const projectionSource = await readFile(
    new URL('../src/shared/dormant-snapshot.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /actionButton\('×', 'Remove saved tab', \(windowBinding\) => \([\s\S]{0,120}removeDormantTab\(tab, groupKey, \{ windowBinding \}\)/);
  assert.match(source, /from '\.\/src\/shared\/dormant-snapshot\.js'/);
  assert.match(source, /function removeOpenedDormantTabFromSnapshot[\s\S]*projectOpenedDormantTabRemoval\(snapshot, tab, dormantGroup, Date\.now\(\)\)/);
  assert.match(source, /function dormantGroupForTabReference[\s\S]*resolveDormantGroupReference\(dormantSpaceView, tab, groupKey\)/);
  assert.match(source, /function dormantTabForMutation[\s\S]*resolveDormantTabReference\(group, reference\)/);
  assert.match(source, /function commitDormantSnapshotProjection[\s\S]*state\.spaceSnapshots\[spaceId\] = nextSnapshot/);
  assert.doesNotMatch(source, /function updateDormantSnapshotGroup|removeTemporarySnapshotTabs/);
  assert.match(projectionSource, /if \(snapshotGroupId\) \{[\s\S]*return uniqueCandidate/);
  assert.match(projectionSource, /return uniqueCandidate\(candidates\.filter/);
  assert.match(projectionSource, /projectDormantSnapshotGroupRename/);
  assert.match(projectionSource, /projectDormantSnapshotGroupRemoval/);
  assert.match(projectionSource, /projectSnapshotTabsRemoval/);
  assert.match(source, /function currentGroupForMutation[\s\S]*candidates\.length === 1/);
  assert.match(source, /function groupMutationFingerprint[\s\S]*snapshotGroupId,[\s\S]*snapshotTabId,/);
  assert.match(source, /key: snapshotGroupId \? '' : String\(group\.key \|\| ''\)/);
  assert.match(source, /id: tab\?\.dormant && snapshotTabId \? '' : String\(tab\?\.id \?\? ''\)/);
  assert.match(removeDormantSource, /const checkpoint = captureWorkspaceMemoryCheckpoint\(\)/);
  assert.ok(
    removeDormantSource.indexOf('const checkpoint = captureWorkspaceMemoryCheckpoint()') <
      removeDormantSource.indexOf('removeOpenedDormantTabFromSnapshot'),
  );
  assert.match(removeDormantSource, /catch \(error\) \{[\s\S]*restoreWorkspaceMemoryCheckpoint\(checkpoint\)[\s\S]*throw error/);
});

test('opening a dormant tab preserves its panel-only name on the new live tab', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /preserveDormantPanelName\(tab,\s*tabId\)/);
  assert.match(source, /state\.renamedTabs\[tabId\]\s*=\s*name/);
});

test('sidepanel prunes saved snapshot entries for closed or navigated live tabs', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const dormantSnapshotSource = await readFile(
    new URL('../src/shared/dormant-snapshot.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /const snapshotCleanupSkipTabIds = \[[\s\S]*skipSnapshotCleanupForTabIds[\s\S]*effectivePendingLifecycleTabIds/);
  assert.match(source, /removeStaleActiveSpaceTabsFromSnapshot\(previousTabs, allContentTabs, \{\s*skipTabIds: snapshotCleanupSkipTabIds/);
  assert.match(source, /function removeStaleActiveSpaceTabsFromSnapshot[\s\S]*if \(currentLifecycleBinding\(tab\.id\)\) return false/);
  assert.match(source, /Reserve surviving browser-tab identities before matching duplicate URLs/);
  assert.match(source, /Number\(current\.tab\.id\) === Number\(previous\.tab\.id\)/);
  assert.match(source, /current\.urlIdentity === previous\.urlIdentity/);
  assert.match(source, /snapshotRemovalTargetForLiveTab\(entry\.tab, previousGroup\)/);
  assert.match(source, /function removeDormantSnapshotTabsForOpenTabs[\s\S]*removeSnapshotTabs\(snapshot, targets\)/);
  assert.match(source, /resolveOpenedDormantRecordForLiveTab,[\s\S]*resolveSnapshotTabRemovalMatch,[\s\S]*from '\.\/src\/shared\/dormant-snapshot\.js'/);
  assert.match(source, /function removeSnapshotTabsForTarget[\s\S]*resolveSnapshotTabRemovalMatch\(snapshot, target, options\)/);
  assert.doesNotMatch(source, /function findSnapshotTabRemovalMatch|function liveTabMatchesOpenedDormantRecord/);
  assert.match(dormantSnapshotSource, /function resolveSnapshotTabRemovalMatch[\s\S]*if \(snapshotTabId\)[\s\S]*return uniqueCandidate/);
  assert.match(dormantSnapshotSource, /if \(exactMatches\.length > 0\) return uniqueCandidate\(exactMatches\)/);
  assert.match(dormantSnapshotSource, /if \(navigationMatches\.length > 0\) return uniqueCandidate\(navigationMatches\)/);
  assert.match(dormantSnapshotSource, /function resolveOpenedDormantRecordForLiveTab[\s\S]*if \(legacyMatches\.length !== 1\) return null[\s\S]*if \(sameUrlLiveTabs\.length !== 1\) return null/);
  assert.match(source, /const navigationUrlKeys = uniqueKeys\(recentlyOpenedUrlIdentities\.map\(comparableSnapshotUrl\)\)/);
  assert.match(source, /snapshotTabId: String\(tab\?\.snapshotTabId \|\| ''\)/);
  assert.match(source, /skipSnapshotCleanupForTabIds: \[tab\.id\]/);
  const deleteGroupSource = functionSource(source, 'deleteGroup');
  assert.match(deleteGroupSource, /if \(group\.dormant\) \{[\s\S]*const checkpoint = captureWorkspaceMemoryCheckpoint\(\)[\s\S]*deleteDormantSnapshotGroup\(group\)[\s\S]*catch \(error\) \{[\s\S]*restoreWorkspaceMemoryCheckpoint\(checkpoint\)[\s\S]*throw error/);

  const closeSource = source.slice(
    source.indexOf('async function closeTab('),
    source.indexOf('async function removeDormantTab('),
  );
  assert.match(closeSource, /runDestructiveTabClose\(\{[\s\S]*checkpoint: async \(\) => \{[\s\S]*removeClosedTabFromSnapshot[\s\S]*await saveState\(\{ persistWindowState: false \}\)[\s\S]*closeTab: \(tabId\) => send\('tabs:close', \{ tabId \}, \{ windowBinding \}\)/);
  assert.ok(closeSource.indexOf('removeClosedTabFromSnapshot') < closeSource.indexOf("send('tabs:close'"));
  assert.match(source, /function snapshotUrlIdentity\(url\)[\s\S]*String\(url \|\| ''\)\.trim\(\)/);
});

test('sidepanel treats an explicit empty Chrome group title as exact snapshot data', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const targetFactoryStart = source.indexOf('function snapshotRemovalTargetForLiveTab(');
  const exactMatcherStart = source.indexOf('function snapshotHasExactTargetInGroup(');
  const exactMatcherEnd = source.indexOf('\n\nfunction removeClosedTabFromSnapshot(', exactMatcherStart);
  assert.ok(targetFactoryStart >= 0 && exactMatcherStart > targetFactoryStart && exactMatcherEnd > exactMatcherStart);

  const targetFactorySource = source.slice(targetFactoryStart, exactMatcherStart).trim();
  const exactMatcherSource = source.slice(exactMatcherStart, exactMatcherEnd).trim();
  const snapshotRemovalTargetForLiveTab = Function(`return (${targetFactorySource});`)();
  const snapshotHasExactTargetInGroup = Function(
    'snapshotUrlIdentity',
    `return (${exactMatcherSource});`,
  )((url) => String(url || '').trim());

  const sharedUrl = 'https://example.com/same';
  const snapshot = {
    version: 1,
    groups: [
      {
        title: 'Named',
        color: 'green',
        tabs: [{ title: 'Named copy', url: sharedUrl }],
      },
      {
        title: '',
        color: 'blue',
        tabs: [{ title: 'Untitled copy', url: sharedUrl }],
      },
    ],
  };
  const tab = { id: 17, title: 'Open copy', url: sharedUrl };
  const missingGroupTarget = snapshotRemovalTargetForLiveTab(tab, null);
  const emptyTitleTarget = snapshotRemovalTargetForLiveTab(tab, { title: '', color: 'blue' });

  assert.equal(Object.hasOwn(missingGroupTarget, 'groupTitle'), false);
  assert.equal(Object.hasOwn(emptyTitleTarget, 'groupTitle'), true);
  assert.equal(emptyTitleTarget.groupTitle, '');
  assert.equal(snapshotHasExactTargetInGroup(snapshot, missingGroupTarget), false);
  assert.equal(snapshotHasExactTargetInGroup(snapshot, emptyTitleTarget), true);
  assert.equal(snapshotHasExactTargetInGroup(snapshot, {
    ...emptyTitleTarget,
    groupTitle: 'Ungrouped',
    groupColor: 'grey',
  }), false);

  const prioritized = [missingGroupTarget, emptyTitleTarget].sort((left, right) => (
    Number(snapshotHasExactTargetInGroup(snapshot, right)) -
    Number(snapshotHasExactTargetInGroup(snapshot, left))
  ));
  assert.equal(prioritized[0], emptyTitleTarget);
  assert.deepEqual(removeSnapshotTabs(snapshot, [prioritized[0]]).groups, [snapshot.groups[0]]);

  const pruneSource = source.slice(
    source.indexOf('function removeStaleActiveSpaceTabsFromSnapshot('),
    source.indexOf('async function materializeLegacyVirtualGroups('),
  );
  const openTabPruneSource = source.slice(
    source.indexOf('function removeDormantSnapshotTabsForOpenTabs('),
    source.indexOf('function removeClosedTabFromSnapshot('),
  );
  const tabDropSource = source.slice(
    source.indexOf('async function ensureTabDropChromeGroup('),
    source.indexOf('function groupForFolderTabDrop('),
  );
  const logicalTitleSource = source.slice(
    source.indexOf('function logicalChromeGroupTitleOverride('),
    source.indexOf('function isEphemeralTab('),
  );
  assert.match(pruneSource, /snapshotRemovalTargetForLiveTab\(entry\.tab, previousGroup\)/);
  assert.match(openTabPruneSource, /snapshotRemovalTargetForLiveTab\(tab, group\)/);
  assert.match(openTabPruneSource, /Object\.hasOwn\(target \|\| \{\}, 'groupTitle'\)/);
  assert.doesNotMatch(openTabPruneSource, /!target\.groupTitle|group\.title \|\| 'Ungrouped'/);
  assert.match(tabDropSource, /title: Object\.hasOwn\(targetGroup, 'title'\)[\s\S]*String\(targetGroup\.title \?\? ''\)/);
  assert.match(logicalTitleSource, /logicalChromeGroupTitles\.has\(groupId\)/);
});

test('window-scoped commands follow the side panel or moved Workbench host window', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  assert.match(sidepanel, /createPanelCommandMessage,[\s\S]*createPanelWindowBindingController,[\s\S]*resolvePanelHostBinding,[\s\S]*from '\.\/src\/shared\/panel-routing\.js'/);
  assert.match(sidepanel, /async function currentPanelHostBinding\(\)[\s\S]*chrome\.tabs\?\.getCurrent[\s\S]*chrome\.windows\?\.getCurrent[\s\S]*resolvePanelHostBinding\(hostTab, currentWindow\)/);
  assert.match(sidepanel, /const panelHostBinding = await currentPanelHostBinding\(\);[\s\S]*panelWindowId = panelHostBinding\.windowId;[\s\S]*createPanelWindowBindingController\(\{[\s\S]*onRebind: handlePanelWindowRebound/);
  assert.match(sidepanel, /if \(extensionRuntime && !Number\.isSafeInteger\(panelWindowId\)\)[\s\S]*could not identify this Chrome window/);
  assert.match(sidepanel, /chrome\.tabs\.onAttached\?\.addListener\(handleChromeTabAttached\)/);
  assert.match(sidepanel, /chrome\.tabs\.onMoved\?\.addListener\(handleChromeHostTabMoved\)/);
  assert.match(sidepanel, /function handleChromeTabAttached\(tabId, attachInfo = \{\}\)[\s\S]*panelWindowBindingController\?\.handleAttached\(tabId, attachInfo\)/);
  assert.match(sidepanel, /function handleChromeHostTabMoved\(tabId, moveInfo = \{\}\)[\s\S]*panelWindowBindingController\?\.handleMoved\(tabId, moveInfo\)/);
  assert.match(sidepanel, /function handlePanelWindowRebound\(transition\)[\s\S]*panelWindowId = transition\.windowId;[\s\S]*reconcilePanelWindowRebind\(transition\)/);
  assert.match(sidepanel, /async function reconcilePanelWindowRebind\(transition\)[\s\S]*runPanelWindowRefreshTransaction\([\s\S]*syncStateFromStorage\(\{ windowBinding: binding \}\)[\s\S]*refreshTabs\(\{[\s\S]*windowBinding: binding/);
  assert.match(sidepanel, /async function confirmPanelHostBindingAfterInit\(\)[\s\S]*confirmPanelWindowBindingAfterInitialization\([\s\S]*currentPanelHostBinding,[\s\S]*\(\) => panelWindowRebindTask/);
  const initSource = sidepanel.match(/async function init\(\)[\s\S]*?(?=\nfunction clearLegacyArcFileHandleStorage)/)[0];
  assert.ok(initSource.indexOf('bindPanelWindowEvents();') < initSource.indexOf('withSharedStateLock'),
    'Workbench attach listeners must be live before initialization starts asynchronous state work');
  assert.ok(initSource.indexOf('confirmPanelHostBindingAfterInit()') > initSource.indexOf('withSharedStateLock'),
    'initialization must finish by confirming the real host window');
  assert.match(sidepanel, /async function send\(type, payload = \{\}, options = \{\}\)[\s\S]*options\.windowBinding[\s\S]*createPanelCommandMessage\(type, payload, targetWindowId\)/);
  assert.match(background, /async function createTab\(url = 'chrome:\/\/newtab', active = true, windowId\)[\s\S]*createProperties\.windowId = targetWindowId/);
  assert.match(background, /case 'tabs:list':\s*return listTabs\(message\.windowId\)/);
  assert.match(background, /message\.preferredTabId[\s\S]*sender\.tab\?\.id/);
  assert.match(background, /async function openUniqueTab\(url, matchUrl = url, preferredTabId, windowId\)[\s\S]*chrome\.tabs\.query\(targetWindowId === null \? \{\} : \{ windowId: targetWindowId \}\)/);
  assert.match(background, /chrome\.tabs\.query\(query\)/);
  assert.match(background, /const tabs = queriedTabs\.filter/);
  assert.match(background, /tabs:\s*tabs\.sort/);
  assert.match(background, /groups:\s*groups\.filter/);
  assert.match(background, /chrome\.tabs\.query\(\{\}\)/);
  assert.match(background, /chrome\.tabGroups\.query\(\{\}\)/);
  assert.match(background, /existingTabIds:\s*existingTabs\.map/);
  assert.match(background, /existingGroupIds:\s*existingGroups\.map/);
  assert.match(sidepanel, /const authoritativeCleanupOptions = \{[\s\S]*existingTabIds:\s*response\.existingTabIds[\s\S]*existingGroupIds:\s*response\.existingGroupIds/);
  assert.match(sidepanel, /const authoritativeCleanupOptions = \{[\s\S]*existingWindowIds:\s*response\.existingWindowIds/);
  assert.match(sidepanel, /const authoritativeCleanupOptions = \{[\s\S]*pendingLifecycleTabIds:\s*response\.pendingLifecycleTabIds/);
  assert.match(sidepanel, /const authoritativeCleanupOptions = \{[\s\S]*suppressedLifecycleTabIds:\s*response\.suppressedLifecycleTabIds/);
  assert.match(sidepanel, /planLifecycleCleanupDeferral\([\s\S]*authoritativeCleanupOptions,[\s\S]*lifecycleCleanupObservations,[\s\S]*LIFECYCLE_CLEANUP_GRACE_MS/);
  assert.match(sidepanel, /lifecycleCleanupObservations = cleanupDeferral\.observations/);
  assert.match(sidepanel, /const effectivePendingLifecycleTabIds = \[[\s\S]*response\.pendingLifecycleTabIds[\s\S]*cleanupDeferral\.deferredTabIds/);
  assert.match(sidepanel, /const cleanupOptions = \{[\s\S]*\.\.\.authoritativeCleanupOptions,[\s\S]*pendingLifecycleTabIds:\s*effectivePendingLifecycleTabIds/);
  assert.match(sidepanel, /adoptUnassignedEntities\([\s\S]*\.\.\.cleanupOptions/);
  assert.match(sidepanel, /cleanupMissingEntities\(state, contentTabs, groups, cleanupOptions\)/);
  assert.match(sidepanel, /snapshotCleanupSkipTabIds = \[[\s\S]*effectivePendingLifecycleTabIds/);
  assert.match(sidepanel, /cleanupEphemeralTabIds\(response\.existingTabIds, effectivePendingLifecycleTabIds\)/);
  assert.match(sidepanel, /function cleanupEphemeralTabIds\(existingTabIds, pendingLifecycleTabIds = \[\]\)[\s\S]*Array\.isArray\(pendingLifecycleTabIds\)/);
  assert.match(background, /ownExtensionPrefix = chrome\.runtime\.getURL\(''\)/);
  assert.match(background, /tabUrl\(tab\)\.startsWith\(ownExtensionPrefix\)/);
  assert.match(background, /tab\.pendingUrl \|\| tab\.url/);
});

test('active Space and side-panel messages are isolated by Chrome window', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  assert.match(sidepanel, /windowSpaceState = normalizeWindowSpaceState\(storedWindowState\[WINDOW_STATE_KEY\], nextState\.spaces\)/);
  assert.match(sidepanel, /nextState\.activeSpaceId = activeSpaceForWindow\([\s\S]*options\.windowBinding \? options\.windowBinding\.windowId : panelWindowId/);
  assert.match(sidepanel, /const nextWindowSpaceState = rememberActiveSpaceForWindow\([\s\S]*windowBinding \? windowBinding\.windowId : panelWindowId,[\s\S]*state\.activeSpaceId/);
  assert.match(sidepanel, /persistStoragePair\([\s\S]*WINDOW_STATE_KEY[\s\S]*STORAGE_KEY[\s\S]*windowSpaceState = nextWindowSpaceState/);
  assert.match(sidepanel, /durableActiveSpaceId = activeSpaceForStorage\(nextState\.spaces, nextState\.activeSpaceId\)/);
  assert.match(sidepanel, /function stateForStorage\(\)[\s\S]*activeSpaceForStorage\([\s\S]*durableActiveSpaceId,[\s\S]*state\.activeSpaceId/);
  assert.match(sidepanel, /async function switchSpace\(spaceId, options = \{\}\)[\s\S]*durableActiveSpaceId = spaceId/);
  assert.match(sidepanel, /chrome\.storage\.session\.get\(WINDOW_STATE_KEY\)/);
  assert.match(sidepanel, /createPanelPortController\(\{[\s\S]*getWindowId: \(\) => panelWindowId/);
  assert.match(background, /sidePanelPorts\.set\(port, \{[\s\S]*windowId: normalizePanelWindowId/);
  assert.match(background, /getVisibleSidePanelPorts\(windowId\)[\s\S]*shouldRouteToPanel\(record, windowId\)/);
});

test('in-flight Workbench tab creation is bound to the user gesture epoch and fully compensated', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const newTabSource = sidepanel.slice(
    sidepanel.indexOf('async function newTabInActiveSpace('),
    sidepanel.indexOf('async function clearUngroupedTabs('),
  );
  const ephemeralCleanupSource = functionSource(sidepanel, 'closeEphemeralTabs');
  const dormantSource = sidepanel.slice(
    sidepanel.indexOf('async function openDormantTab('),
    sidepanel.indexOf('function preserveDormantPanelName('),
  );

  assert.match(sidepanel, /newTabButton\.addEventListener\('click', \(\) => \{\s*const windowBinding = capturePanelWindowBinding\(\);\s*runTask\(\(\) => newTabInActiveSpace\(\{ windowBinding \}\)\)/);
  assert.match(sidepanel, /actionButton\('↗', 'Open', \(windowBinding\) => openDormantTab\(tab, groupKey, \{ windowBinding \}\)\)/);
  for (const [label, source] of [['new tab', newTabSource], ['saved tab', dormantSource]]) {
    const createIndex = source.indexOf("send('tabs:create'");
    const journalIndex = source.indexOf('createdTabIds.push(tabId)', createIndex);
    const staleIndex = source.indexOf('!isCurrentPanelWindowBinding(windowBinding)', journalIndex);
    assert.ok(createIndex >= 0 && journalIndex > createIndex && staleIndex > journalIndex,
      `${label} must journal the created Chrome id before rejecting a stale response`);
    assert.match(source, /saveState\(\{ windowBinding \}\)/);
    assert.match(source, /closeEphemeralTabs\(\{[\s\S]*windowBinding,[\s\S]*allowStaleWindowBinding: true,[\s\S]*\}\)/);
    assert.match(source, /refreshTabs\(\{ windowBinding \}\)/);
    assert.match(source, /rollbackWindowBoundCreatedTabMutation\(checkpoint/);
  }
  assert.match(sidepanel, /async function rollbackWindowBoundCreatedTabMutation[\s\S]*persistStoragePair\(\{[\s\S]*WINDOW_STATE_KEY[\s\S]*checkpoint\.windowSpaceState[\s\S]*STORAGE_KEY[\s\S]*stateForStorage\(\)/);
  assert.match(ephemeralCleanupSource, /loadTabs\(\{[\s\S]*adopt: false,[\s\S]*windowBinding,[\s\S]*allowStaleWindowBinding,[\s\S]*\}\)/);
  assert.match(ephemeralCleanupSource, /closeTabsAndForgetMetadata\(ephemeralTabs, \{[\s\S]*windowBinding,[\s\S]*allowStaleWindowBinding,[\s\S]*\}\)/);
  assert.match(ephemeralCleanupSource, /result\.closedTabIds\.length > 0[\s\S]*saveState\(\{ persistWindowState: false \}\)/);
});

test('Ask session selection and pruning are safe across Chrome windows', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(sidepanel, /let activeAskSessionKey = ''/);
  assert.match(sidepanel, /state = nextState;[\s\S]*state\.activeAskSessionKey = activeAskSessionKey/);
  assert.match(sidepanel, /function stateForStorage\(\)[\s\S]*activeAskSessionKey,[\s\S]*ai,/);
  assert.match(sidepanel, /function ensureCurrentAskSession\(\)[\s\S]*pruneCurrentAskSessions\(key\)/);
  assert.match(sidepanel, /function pruneCurrentAskSessions[\s\S]*inFlightKeys:\s*\[\.\.\.activeAskStreams\.values\(\)\]/);
  assert.match(sidepanel, /function currentAskSessionForRender\(\)[\s\S]*return projectAskSessionForTab\(state\.askSessions, tab\)/);
  assert.doesNotMatch(sidepanel.slice(
    sidepanel.indexOf('function currentAskSessionForRender()'),
    sidepanel.indexOf('function setActiveAskSessionKey'),
  ), /adoptPortableAskSession|ensureAskSessionByKey/);
  assert.match(sidepanel, /function renderAskMessages\(\) \{\s*const session = currentAskSessionForRender\(\)/);
  const passiveRefresh = sidepanel.slice(
    sidepanel.indexOf('function refreshAskPageTargetUI()'),
    sidepanel.indexOf('function readableAskPageTab()'),
  );
  assert.doesNotMatch(passiveRefresh, /ensureCurrentAskSession\(\)/);
  assert.match(sidepanel, /const openTabs = \[\.\.\.tabs, \.\.\.foreignLiveTabs\]/);
  assert.match(sidepanel, /openTabIds:\s*openTabs\.map\(\(item\) => item\.id\)/);
  assert.match(sidepanel, /openSessionKeys:\s*openTabs\.map\(\(item\) => sessionKeyForTab\(item\)\)/);
  assert.match(sidepanel, /askSessionTabFromKey,[\s\S]{0,260}from '\.\/src\/shared\/ask-session\.js'/);
  assert.match(sidepanel, /askSessionTabFromKey\(safeKey, tabs\)/);
  assert.match(sidepanel, /currentAskPageTab\(\) \|\| askSessionTabFromKey\(sessionKey, tabs\)/);
  assert.doesNotMatch(sidepanel, /function askSessionTabFromKey\(/);
  assert.match(sidepanel, /if \(ref\.sessionKey === activeAskSessionKey && activeView === 'ask'\) renderAskMessages\(\)/);
  assert.doesNotMatch(sidepanel, /ref\.sessionKey === state\.activeAskSessionKey/);
  assert.match(sidepanel, /chrome\.tabs\.onDetached\?\.addListener\(handleChromeTabDetached\)/);
  assert.match(sidepanel, /function currentAskPageTab\(\)[\s\S]*selectEligibleTabSource\(tabs, lastActivatedAskPageTab, isEligibleAskPageTab\)/);
  assert.match(sidepanel, /createEligibleTabActivationController\(\{[\s\S]*getTab:[\s\S]*isEligible: isEligibleAskPageTab,[\s\S]*onObserve:[^\n]*observeAskPageTab[\s\S]*onActivate:/);
  assert.doesNotMatch(sidepanel, /createEligibleTabActivationController\(\{[\s\S]{0,300}getCachedTab:/);
  assert.match(sidepanel, /async function handleChromeTabActivated[\s\S]*askPageActivationController\.handle\(activeInfo\)/);
  assert.match(sidepanel, /function handleChromeTabRemoved[\s\S]*const wasCurrentSource[\s\S]*askPageActivationController\.invalidate\(tabId\)[\s\S]*tabs = tabs\.filter[\s\S]*if \(wasRememberedSource\) lastActivatedAskPageTab = null;[\s\S]*if \(wasCurrentSource \|\| wasRememberedSource\) refreshAskPageTargetUI\(\)/);
  assert.match(sidepanel, /function handleChromeTabUpdated[\s\S]*const wasCurrentSource[\s\S]*const isEligible = isEligibleAskPageTab\(tab\)[\s\S]*if \(changeInfo\.url \|\| !isEligible\) askPageActivationController\.invalidate\(tabId\)[\s\S]*if \(isEligible && tab\.active\)[\s\S]*askPageActivationController\.commitFresh\(tab,[\s\S]*if \(wasCurrentSource\) refreshAskPageTargetUI\(\)[\s\S]*lastActivatedAskPageTab = null/);
  assert.match(sidepanel, /function handleChromeTabDetached[\s\S]*detachInfo\.oldWindowId[\s\S]*askPageActivationController\.invalidate\(tabId\)[\s\S]*tabs = tabs\.filter[\s\S]*lastActivatedAskPageTab = null[\s\S]*refreshAskPageTargetUI\(\)/);
  assert.match(sidepanel, /function handleChromeTabReplaced[\s\S]*askPageActivationController\.invalidate\(removedTabId\)/);
});

test('a new Chrome session drops recycled entity ids and restores portable snapshot metadata', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(sidepanel, /BROWSER_SESSION_STORAGE_KEY,[\s\S]*from '\.\/src\/shared\/state\.js'/);
  assert.match(sidepanel, /chrome\.storage\.session\.get\(BROWSER_SESSION_STORAGE_KEY\)/);
  assert.match(sidepanel, /const nextState = resetChromeSessionBindings\(mergedState, browserSessionId\)/);
  assert.match(sidepanel, /restoreSnapshotOwnership\([\s\S]*allContentTabs,[\s\S]*response\.allGroups \|\| groups/);
  assert.match(sidepanel, /ownershipMetadata\.groupTitles[\s\S]*logicalChromeGroupTitles\.set\(Number\(groupId\), logicalTitle\)/);
  assert.match(sidepanel, /tabs = decorateTabs\(identifiedPanelTabs, state\)[\s\S]*foreignLiveTabs = decorateTabs\(identifiedAllBrowserTabs, state\)/);
});

test('tabs open in the same Space in another window stay live without being duplicated', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');
  const membership = await readFile(new URL('../src/shared/space-membership.js', import.meta.url), 'utf8');

  assert.match(background, /allTabs:\s*allTabs[\s\S]*\.map\(serializeTab\)/);
  assert.match(background, /allGroups:\s*existingGroups\.map\(serializeGroup\)/);
  assert.match(sidepanel, /removeStaleActiveSpaceTabsFromSnapshot\(previousTabs, allContentTabs/);
  assert.match(sidepanel, /restoreSnapshotOwnership\([\s\S]*state,[\s\S]*allContentTabs,[\s\S]*response\.allGroups \|\| groups/);
  assert.match(membership, /function markDormantTabsOpenInOtherWindows[\s\S]*foreignWindowTabId = match\.tab\.id/);
  assert.match(sidepanel, /if \(isForeignWindowTab\(tab\)\) \{[\s\S]{0,140}runTask\(\(windowBinding\) => focusForeignWindowTab\(tab, \{ windowBinding \}\)\)/);
  assert.match(sidepanel, /async function focusForeignWindowTab[\s\S]*send\('tabs:focus', \{ tabId \}, \{ windowBinding \}\)/);
  assert.match(background, /async function focusTab[\s\S]*chrome\.tabs\.update[\s\S]*chrome\.windows\.update[\s\S]*confirmWindowFocus/);
  assert.match(background, /async function confirmWindowFocus[\s\S]*updatedWindow\?\.focused === true[\s\S]*chrome\.windows\.get[\s\S]*return false/);
  assert.match(sidepanel, /response\.focusConfirmed === false[\s\S]*could not confirm that the window came to the front/);
});

test('deleting a Space previews and closes its tabs across every Chrome window', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');
  const deletionProjection = await readFile(
    new URL('../src/shared/space-deletion.js', import.meta.url),
    'utf8',
  );
  const deletionSource = sidepanel.slice(
    sidepanel.indexOf('async function deleteSpaceFromCurrentState'),
    sidepanel.indexOf('async function renderCommittedSpaceDeletionState'),
  );
  const closeAcrossWindowsSource = functionSource(sidepanel, 'closeSpaceTabsAcrossWindows');
  const placeholderCleanupSource = functionSource(
    sidepanel,
    'cleanupAbortedSpaceDeletionPlaceholders',
  );
  const postCommitCleanupSource = deletionSource.slice(deletionSource.lastIndexOf('  try {'));

  assert.match(background, /case 'tabs:listAll':\s*return listAllTabs\(\)/);
  assert.match(await readFile(new URL('../scripts/e2e-extension-smoke.mjs', import.meta.url), 'utf8'), /async function waitForLifecycleJournalToSettle[\s\S]*tabs:list[\s\S]*pendingLifecycleTabIds[\s\S]*pendingKeys\.length === 0 && pendingLifecycleTabIds\.length === 0/);
  assert.match(background, /async function listAllTabs\(\)[\s\S]*chrome\.tabs\.query\(\{\}\)[\s\S]*allChromeTabs:\s*queriedTabs[\s\S]*windowId/);
  assert.match(sidepanel, /expectedPlan = await liveSpaceDeletionPlan\(space\.id, \{ windowBinding \}\)/);
  assert.match(sidepanel, /close \$\{expectedPlan\.closingTabs\.length\} open[\s\S]*across all windows/);
  assert.match(sidepanel, /pinnedDisclosure[\s\S]*pinned[\s\S]*stay[^`]*open[\s\S]*move/);
  assert.match(sidepanel, /latestPlan\.fingerprint !== expectedPlan\.fingerprint[\s\S]*This Space, its contents, or the fallback Space changed while the delete confirmation was open/);
  assert.match(sidepanel, /deleteSpaceFromCurrentState\(current, \{[\s\S]*expectedFingerprint: latestPlan\.fingerprint/);
  assert.match(sidepanel, /async function deleteSpaceFromCurrentState\(space, options = \{\}\)[\s\S]*loadTabs\(\{ adopt: false, windowBinding \}\)/);
  assert.doesNotMatch(sidepanel, /async function deleteSpaceFromCurrentState\(space, options = \{\}\)[\s\S]{0,160}loadTabs\(\{ adopt: true \}\)/);
  assert.match(sidepanel, /async function liveSpaceDeletionInventory[\s\S]*tabs:listAll[\s\S]*response\.allChromeTabs \|\| response\.tabs[\s\S]*allBrowserTabs[\s\S]*planSpaceTabDeletion\(allTabs, state, spaceId\)/);
  assert.match(sidepanel, /fingerprint: spaceDeletionIntentFingerprint\(\{[\s\S]*deletingSpaceId: spaceId,[\s\S]*plan/);
  assert.match(deletionProjection, /export function spaceDeletionIntentFingerprint[\s\S]*savedOnlySnapshot[\s\S]*context:[\s\S]*askSession:/);
  assert.match(sidepanel, /planSpaceDeletionWindowKeepalives\(\s*checkpointInventory\.allChromeTabs/);
  assert.match(closeAcrossWindowsSource, /tabIds: \(\) => transactionClosingTabs\.map[\s\S]*checkpointInventory = await liveSpaceDeletionInventory\(spaceId, \{ windowBinding \}\)[\s\S]*assertFreshSpaceDeletionPlan\(checkpointInventory\.plan[\s\S]*planSpaceDeletionWindowKeepalives\([\s\S]*sourceTabs: checkpointInventory\.allTabs[\s\S]*sourceGroups: checkpointInventory\.response\.groups/);
  assert.match(sidepanel, /beforeClose: async \(tabId, \{ closedTabIds \}\)[\s\S]*expectedRemainingTabs[\s\S]*for \(const expectedTab of expectedRemainingTabs\)[\s\S]*spaceDeletionCloseCandidateMismatch/);
  assert.match(sidepanel, /closeTab: \(tabId\) => \{[\s\S]*send\('tabs:close', \{[\s\S]*closeGuard:[\s\S]*requireUnpinned: true[\s\S]*url:/);
  assert.match(background, /async function closeTab[\s\S]*assertCurrentTabMatchesCloseGuard[\s\S]*removeTabsPanelManaged\(\[id\], \{[\s\S]*closeGuard: options\.closeGuard/);
  assert.match(background, /async function removeTabsPanelManaged[\s\S]*storage\.session\.set[\s\S]*assertCurrentTabMatchesCloseGuard\(tabId, options\.closeGuard\)[\s\S]*chrome\.tabs\.remove/);
  assert.match(deletionProjection, /function spaceDeletionCloseCandidateMismatch[\s\S]*snapshotTabId[\s\S]*liveTabBelongsToSpace/);
  assert.match(sidepanel, /const transitionRollback = createSpaceDeletionRollbackJournal\(\{[\s\S]*beforeState: state,[\s\S]*deletingSpaceId: space\.id,[\s\S]*durableActiveSpaceId,[\s\S]*windowSpaceState,[\s\S]*activeView,[\s\S]*deletingActiveSpace/);
  const activeDeletionTransition = sidepanel.slice(
    sidepanel.indexOf('if (deletingActiveSpace && fallback)'),
    sidepanel.indexOf('let deletionCommitted = false'),
  );
  assert.match(activeDeletionTransition, /snapshotOpenSpace\(space\.id\)[\s\S]*state\.activeSpaceId = fallback\.id[\s\S]*durableActiveSpaceId = fallback\.id[\s\S]*await saveState\(\{ windowBinding \}\)[\s\S]*transitionRollback\.checkpointState = structuredClone\(state\)/);
  assert.doesNotMatch(activeDeletionTransition, /tabs:create|ensureSpaceOpenFromSnapshot|withCreatedTabCheckpointRollback/);
  assert.match(sidepanel, /closeSpaceTabsAcrossWindows\(space\.id, fallback\?\.id, \{[\s\S]*rollbackJournal: transitionRollback/);
  assert.match(sidepanel, /options\.rollbackJournal\.checkpointState = structuredClone\(checkpointState\)/);
  assert.match(sidepanel, /options\.rollbackJournal\.closedTabIds = uniqueKeys\([\s\S]*\.\.\.closedTabIds/);
  assert.match(sidepanel, /async function rollbackSpaceDeletionTransition[\s\S]*projectSpaceDeletionRollbackState\(\{[\s\S]*checkpointState: transition\.checkpointState,[\s\S]*createdTabIds: transition\.createdTabIds,[\s\S]*closedTabIds: transition\.closedTabIds[\s\S]*restoreSpaceId = rollback\.restoreActiveSpaceId[\s\S]*placeholderSpaceId = rollback\.placeholderSpaceId[\s\S]*loadDormantSpaceView\(restoreSpaceId, \{ force: true \}\)[\s\S]*collectSpaceDeletionRollbackFailures\(\{[\s\S]*saveRecovery: \(\) => persistStoragePair\([\s\S]*cleanup: \(\) => cleanupAbortedSpaceDeletionPlaceholders[\s\S]*placeholderSpaceId[\s\S]*saveCleanup: \(\) => saveState\(\{ persistWindowState: false \}\)[\s\S]*refresh: async/);
  assert.match(placeholderCleanupSource, /allowStaleWindowBinding: Boolean\(options\.windowBinding\)/);
  assert.match(placeholderCleanupSource, /send\('tabs:listAll', \{\}, messageOptions\)[\s\S]*planSpaceDeletionPlaceholderCleanup\(\s*response\?\.allChromeTabs \|\| response\?\.tabs[\s\S]*send\('tabs:close', \{ tabId, preserveSnapshot: false \}, messageOptions\)/);
  assert.match(sidepanel, /async function cleanupAbortedSpaceDeletionPlaceholders[\s\S]*liveRetainedTabIds\.push\(\.\.\.plan\.retainLiveTabIds\)[\s\S]*projectSpaceDeletionPlaceholderMetadata\(state, \{[\s\S]*liveRetainedTabIds[\s\S]*syncSpaceDeletionPlaceholderMemory\(\{[\s\S]*liveRetainedTabIds/);
  assert.match(sidepanel, /loadTabs\(\{[\s\S]*skipSnapshotCleanupForTabIds: transition\.closedTabIds[\s\S]*loadDormantSpaceView\(restoreSpaceId, \{ force: true \}\)/);
  assert.match(sidepanel, /createRollbackAggregateError\([\s\S]*transition\.deletingActiveSpace \? 'Active Space deletion' : 'Inactive Space deletion',[\s\S]*\{ cause: originalError \}/);
  assert.match(sidepanel, /if \(deletionCommitted\)[\s\S]*createCommittedSpaceDeletionError\(space\.name, error\)[\s\S]*await rollbackSpaceDeletionTransition\(transitionRollback, error, \{ windowBinding \}\)/);
  assert.match(postCommitCleanupSource, /loadTabs\(\{ adopt: false, windowBinding \}\)[\s\S]*loadDormantSpaceView\(state\.activeSpaceId, \{ force: true \}\)[\s\S]*render\(\)[\s\S]*renderSettings\(\)/);
  assert.doesNotMatch(postCommitCleanupSource, /ensureSpaceOpenFromSnapshot|focusFirstTabInSpace|collapseGroupsInSpace|discardInactiveTabsInSpace|closeTabsOutsideActiveSpace|closeSpaceTabs|closeEphemeralTabs|closeExtraFallbackTabs|tabs:create|tabs:close|groups:update|tabs:discard/);
  assert.doesNotMatch(sidepanel, /let transitionRollback = null/);
  assert.match(deletionProjection, /export function createSpaceDeletionRollbackJournal/);
  assert.match(deletionProjection, /export function projectSpaceDeletionRecoveryState/);
  assert.match(deletionProjection, /export function projectSpaceDeletionRollbackState/);
  assert.match(deletionProjection, /export function projectSpaceDeletionRollbackState[\s\S]*closedTabIds = \[\][\s\S]*projectSpaceDeletionPlaceholderMetadata\(recovered[\s\S]*for \(const tabId of uniqueTabIds\(closedTabIds\)\) removeTabMetadata\(projected, tabId\)/);
  assert.match(deletionProjection, /export function planSpaceDeletionPlaceholderCleanup/);
  assert.match(deletionProjection, /export function projectSpaceDeletionPlaceholderMetadata/);
  assert.match(deletionProjection, /export async function collectSpaceDeletionRollbackFailures/);
  assert.match(sidepanel, /function spaceDeletionTransactionTabs\(inventory\)[\s\S]*destructive set must exactly match the reviewed confirmation count[\s\S]*return inventory\.plan\.closingTabs/);
  assert.doesNotMatch(sidepanel, /function spaceDeletionTransactionTabs[\s\S]{0,900}deletingEphemeralTabs/);
  assert.match(sidepanel, /if \(hasDormantContent\(fallbackSpaceId\)\) rememberEphemeralTab\(tabId\);[\s\S]*else state\.tabSpaces\[tabId\] = fallbackSpaceId/);
  assert.match(sidepanel, /reassignPinnedTabsAfterSpaceDelete\([\s\S]*preservedPinnedTabs[\s\S]*fallbackSpaceId/);
  assert.match(sidepanel, /let deletionCommitted = false[\s\S]*reassignDeletedSpaceWindows\([\s\S]*windowSpaceState,[\s\S]*space\.id,[\s\S]*fallback\?\.id,[\s\S]*state\.spaces[\s\S]*persistStoragePair\(\{[\s\S]*WINDOW_STATE_KEY[\s\S]*nextWindowSpaceState[\s\S]*STORAGE_KEY[\s\S]*stateForStorage\(\)[\s\S]*windowSpaceState = nextWindowSpaceState[\s\S]*deletionCommitted = true[\s\S]*if \(deletionCommitted\)[\s\S]*createCommittedSpaceDeletionError\(space\.name, error\)/);
  assert.match(deletionProjection, /export function createCommittedSpaceDeletionError[\s\S]*The deletion is saved[\s\S]*error\.spaceDeletionCommitted = true/);
  assert.match(deletionProjection, /export function planSpaceDeletionWindowKeepalives/);
});

test('side panel reconnects its Port after a Manifest V3 worker restart without rebinding DOM listeners', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const controller = await readFile(new URL('../src/shared/panel-port.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ createPanelPortController \} from '\.\/src\/shared\/panel-port\.js'/);
  assert.match(source, /const panelPortController = createPanelPortController\(\{[\s\S]*enabled: extensionRuntime && !workbenchMode/);
  assert.match(source, /panelPortController\.connect\(\)/);
  assert.match(controller, /nextPort\.onDisconnect\.addListener\(\(\) => \{[\s\S]*if \(port !== nextPort\) return;[\s\S]*scheduleReconnect\(\)/);
  assert.match(controller, /function bindVisibilityEvents\(\)[\s\S]*if \(visibilityEventsBound \|\| !enabled\) return/);
  assert.match(controller, /documentTarget\?\.visibilityState === 'hidden'/);
  assert.match(controller, /panelPortReconnectDelay\(reconnectAttempt, options\)/);
  assert.doesNotMatch(controller, /persistCurrentSpaceSnapshot/);
});

test('shortcut focus retries stop as soon as the panel succeeds or the user moves elsewhere', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const controller = await readFile(
    new URL('../src/shared/panel-focus.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{[\s\S]*createDisclosureFocusGuard,[\s\S]*createPanelFocusController,[\s\S]*\} from '\.\/src\/shared\/panel-focus\.js'/);
  assert.match(source, /const panelFocusController = createPanelFocusController\(\{[\s\S]*getTarget: \(\) => activeView === 'ask'[\s\S]*requestBackgroundFocus:[\s\S]*Number\.isSafeInteger\(panelWindowId\)[\s\S]*type: 'panel:focus', windowId: panelWindowId/);
  assert.match(source, /const disclosureFocusGuard = createDisclosureFocusGuard\(\)/);
  assert.match(source, /addEventListener\('focusin', panelFocusController\.handleFocusIn, \{ capture: true \}\)/);
  assert.match(source, /addEventListener\('pointerdown', panelFocusController\.handleUserIntent, \{ capture: true \}\)/);
  assert.match(source, /addEventListener\('keydown', panelFocusController\.handleUserIntent, \{ capture: true \}\)/);
  assert.match(source, /addEventListener\('focusin', disclosureFocusGuard\.invalidate, \{ capture: true \}\)/);
  assert.match(source, /addEventListener\('pointerdown', disclosureFocusGuard\.invalidate, \{ capture: true \}\)/);
  assert.match(source, /addEventListener\('keydown', disclosureFocusGuard\.invalidate, \{ capture: true \}\)/);
  assert.match(source, /addEventListener\('visibilitychange', panelFocusController\.handleVisibilityChange\)/);
  assert.match(source, /function focusPanelForShortcuts\(\)[\s\S]*panelFocusController\.request\(\)/);
  assert.match(source, /async function activateAdjacentSpace\([\s\S]*focusPanelForShortcuts\(\)/);
  const toggleSpaceGroupsSource = source.match(
    /async function toggleSpaceGroups\(options = \{\}\)[\s\S]*?(?=\nfunction isSpaceGroupsCollapsed)/,
  )?.[0];
  assert.ok(toggleSpaceGroupsSource);
  assert.doesNotMatch(toggleSpaceGroupsSource, /focusPanelForShortcuts\(\)/);
  assert.equal((source.match(/focusPanelForShortcuts\(\);/g) || []).length, 1);
  assert.doesNotMatch(source, /for \(const delay of \[0, 80, 240, 600, 1200, 1800\]\)/);
  assert.match(controller, /handleUserIntent[\s\S]*cancel\('user-intent'\)/);
  assert.match(controller, /documentOwnsTargetFocus\(documentTarget, target\)[\s\S]*cancel\('focused'\)/);
  assert.match(controller, /function restore\(token, focus\)[\s\S]*token\.generation !== generation[\s\S]*generation \+= 1[\s\S]*focus\(\)/);
});

test('Ask streaming cannot overwrite the final cited answer with a late partial event', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  assert.match(background, /return chrome\.runtime\.sendMessage\(\{ type: 'ai:stream', requestId, text \}\)\.catch/);
  assert.match(background, /if \(event\.text\)[\s\S]*await onStream\(text\)/);
  assert.match(sidepanel, /if \(!stream \|\| stream\.finished\) return/);
  assert.match(sidepanel, /completedStream[\s\S]*completedStream\.finished = true[\s\S]*appendAskSourceLink\(answerText, page\)/);
  assert.match(sidepanel, /const stream = activeAskStreams\.get\(requestId\);[\s\S]*if \(stream\) stream\.finished = true;[\s\S]*appendAskSourceLink/);
});

test('sidepanel refresh adopts orphan groups without overwriting newer Workbench state', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /adoptGroups:\s*Boolean\(options\.adoptGroups\s*\?\?\s*options\.adopt\)/);
  assert.match(source, /setInterval\(\(\) => void refreshSharedState\(\), 2500\)/);
  assert.match(source, /async function refreshSharedState\(\)[\s\S]*capturePanelWindowBinding\(\)[\s\S]*withSharedStateLock[\s\S]*runPanelWindowRefreshTransaction\([\s\S]*syncStateFromStorage\(\{ windowBinding: binding \}\)[\s\S]*refreshTabs\(\{ adopt: true, windowBinding: binding \}\)/);
  assert.match(source, /async function syncStateFromStorage\(options = \{\}\)[\s\S]*cachedDormantSnapshot[\s\S]*!sameSnapshotGroups\(cachedDormantSnapshot, state\.spaceSnapshots\?\.\[cachedDormantSpaceId\]\)[\s\S]*dormantSpaceViewSpaceId = ''/);
  assert.match(source, /navigator\.locks\.request\(SHARED_STATE_LOCK_NAME/);
  assert.match(source, /async function withFreshSpaceStateMutation\(task, options = \{\}\)[\s\S]*capturePanelWindowBinding\(\)[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage\(\{ windowBinding \}\)[\s\S]*loadTabs\(\{ adopt: false, windowBinding \}\)[\s\S]*loadDormantSpaceView/);
  assert.match(source, /async function focusTab\(tab, options = \{\}\)[\s\S]*withFreshSpaceStateMutation/);
  const addSpaceSource = functionSource(source, 'addSpace');
  const addSpaceDialog = addSpaceSource.indexOf('await askText');
  const confirmationBinding = addSpaceSource.indexOf('windowBinding = capturePanelWindowBinding()');
  const synchronizedAdd = addSpaceSource.indexOf('await syncStateFromStorage({ windowBinding })');
  const addCheckpoint = addSpaceSource.indexOf('const beforeCreate = captureWorkspaceMemoryCheckpoint()');
  const addMutation = addSpaceSource.indexOf('state.spaces.push(space)');
  assert.ok(
    addSpaceDialog >= 0 && addSpaceDialog < confirmationBinding &&
      confirmationBinding < synchronizedAdd && synchronizedAdd < addCheckpoint &&
      addCheckpoint < addMutation,
    'Add Space must bind the confirmation window and checkpoint the newest shared state before mutating',
  );
  assert.match(addSpaceSource, /if \(synchronized === false\) \{[\s\S]*throw new Error/);
  assert.match(addSpaceSource, /state\.spaces\.push\(space\)[\s\S]*activated = await activateSpace\(space\.id, \{[\s\S]*rollbackCheckpoint: beforeCreate,[\s\S]*stateLocked: true,[\s\S]*windowBinding/,
    'Add Space must compensate storage with the checkpoint captured before its new Space existed');
  assert.equal((addSpaceSource.match(/activateSpace\(space\.id/g) || []).length, 1);
  assert.doesNotMatch(addSpaceSource, /saveState\(\{\s*persistWindowState:\s*false/,
    'Add Space must not durably create an orphan before its active-Space pair commit');
  assert.match(addSpaceSource, /catch \(error\) \{[\s\S]*restoreWorkspaceMemoryCheckpoint\(beforeCreate, \{[\s\S]*renderView: isCurrentPanelWindowBinding\(windowBinding\)[\s\S]*throw error/);
  assert.match(addSpaceSource, /let draft = 'New Space';[\s\S]*while \(true\)[\s\S]*value: draft[\s\S]*draft = name[\s\S]*formatAIError\(error\)/,
    'a failed Add Space attempt must reopen the focused naming dialog with its retained draft');
  assert.match(addSpaceSource, /retryIsUnsafe = isRollbackIntegrityFailure\(error\)[\s\S]*Reload Space Tabs before trying Add Space again[\s\S]*if \(retryIsUnsafe\) return false;[\s\S]*Looping immediately reopens/,
    'Add Space must fail closed instead of retrying when compensation itself failed');
  assert.match(source, /let taskQueue = Promise\.resolve\(\)/);
  assert.match(source, /function runTask\(task\)[\s\S]*activeTaskCount \+= 1[\s\S]*taskQueue\.then\(execute, execute\)[\s\S]*taskQueue = queuedTask\.catch/);
  assert.doesNotMatch(source, /function runTask\(task\)[\s\S]*syncStateFromStorage\(\)[\s\S]*function withSharedStateLock/);
  assert.match(source, /async function init\(\)[\s\S]*withSharedStateLock\(async \(\) => \{[\s\S]*runPanelWindowRefreshTransaction\([\s\S]*loadState\(\{ stateLocked: true, windowBinding: binding \}\)[\s\S]*refreshTabs\(\{[\s\S]*renderAfterSave: true,[\s\S]*windowBinding: binding/);
  assert.match(source, /async function refreshTabs\(options = \{\}\)[\s\S]*capturePanelWindowBinding\(\)[\s\S]*refreshTabsView\(\{[\s\S]*windowBinding,[\s\S]*saveState\(\{ windowBinding \}\)[\s\S]*if \(renderAfterSave\) render\(\)/);
  assert.match(source, /async function refreshTabsView\(options = \{\}\)[\s\S]*if \(options\.render !== false\) render\(\)/);
  assert.match(source, /async function refreshTabsView\(options = \{\}\)[\s\S]*snapshotOpenSpace\(state\.activeSpaceId\);[\s\S]*refreshTabLifecycleIdentityDecorations\(\);[\s\S]*loadDormantSpaceView/);
  assert.match(source, /function refreshTabLifecycleIdentityDecorations\(\)[\s\S]*tabs = tabsWithLifecycleIdentity\(tabs\);[\s\S]*foreignLiveTabs = tabsWithLifecycleIdentity\(foreignLiveTabs\)/);
  assert.match(source, /function organizationForCurrentSpaceState\(spaceId, options = \{\}\)[\s\S]*sourceTabs: tabsWithLifecycleIdentity\(tabs\)/);
  assert.match(source, /function tabsWithLifecycleIdentity\(rawTabs = \[\]\)[\s\S]*delete undecorated\.snapshotGroupId[\s\S]*lifecycleBindingMatchesPhysicalGroup/);
  assert.match(source, /async function addAskMessage[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage[\s\S]*await saveState/);
  assert.match(source, /async function updateAskMessage[\s\S]*await persistAskMessage\(ref, text\)/);
  assert.match(source, /function startAskFromUserGesture\(\)[\s\S]*if \(activeAIRequestId\) \{[\s\S]*void abortActiveAIRequest\(\)/);
  assert.match(source, /async function tidyTabNames\(options = \{\}\)[\s\S]*sourceSpaceId[\s\S]*withSharedStateLock[\s\S]*active Space changed while Tidy Names was open/);
  assert.match(source, /async function autoGroupTabs\(options = \{\}\)[\s\S]*sourceSpaceId[\s\S]*withSharedStateLock[\s\S]*rebaseOrganizationPlan\(\{[\s\S]*previewCandidates: organization\.candidates[\s\S]*currentCandidates: currentOrganization\.candidates[\s\S]*plannedGroups/);
  assert.match(source, /async function importArcFile\(options = \{\}\)[\s\S]*withSharedStateLock[\s\S]*createArcImportPlan\(pendingArcImportText, \{ existingSpaces: state\.spaces \}\)/);
});

test('folder drag before or after reparents groups beside the target', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /moveGroupBlockBesideContext\(sourceKeys, targetContext, intent, \{ \.\.\.moveOptions, windowBinding \}\)/);
  assert.match(source, /targetPathForSiblingMove\(targetContext\)/);
  assert.match(source, /movedGroupTitleForFolderDrop\(/);
  assert.match(source, /function reorderDormantSnapshotGroups[\s\S]*projectSnapshotGroupOrder\(snapshot, references, Date\.now\(\)\)/);
  assert.match(source, /function replaceActiveSpaceSnapshotGroups[\s\S]*remapSnapshotGroupIndexedState\(\{[\s\S]*groupOrder:[\s\S]*collapsedGroups:[\s\S]*tabOrder:/);
});

test('single tab context menu can create a tab group', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /menuAction\(contextTabIds\.length === 1 \? 'Group tab' : `Group \$\{contextTabIds\.length\} selected tabs`/);
  assert.match(source, /groupSelectedTabs\(contextTabIds, \{ windowBinding \}\)/);
  assert.match(source, /if \(requestedIds\.length === 0\)/);
  assert.match(source, /resolveFreshTabSelection\([\s\S]*selection\.status !== 'ready'/);
  assert.doesNotMatch(source, /Select at least two tabs/);
});

test('single tab context menu can update the saved URL for a persistent tab', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const updateSource = functionSource(source, 'updateSavedTabUrl');

  assert.match(source, /menuAction\('Update Saved URL', \(windowBinding\) => updateSavedTabUrl\(tab, \{ windowBinding \}\)\)/);
  assert.match(source, /function updateSavedTabUrl\(tab, options = \{\}\)/);
  assert.match(source, /async function updateSavedTabUrl[\s\S]*isRestorableSnapshotTab\(\{ url \}\)[\s\S]*original saved page was kept/);
  assert.doesNotMatch(source, /Move this tab into a group before saving its URL/);
  assert.match(source, /async function updateSavedTabUrl[\s\S]*setStatus\('Updated saved URL\.'\)[\s\S]*showStatusToast\('Updated saved URL\.', 'success'\)/);
  assert.match(source, /updateSnapshotTab\(/);
  assert.match(updateSource, /resolveSnapshotTabRemovalMatch\(snapshot,[\s\S]*requireGroup: true/);
  assert.match(updateSource, /saved tab could not be identified uniquely[\s\S]*original saved page was kept/);
  assert.match(updateSource, /updateSnapshotTab\(snapshot,[\s\S]*\{ requireExisting: true \}\)/);
  assert.match(updateSource, /const checkpoint = captureWorkspaceMemoryCheckpoint\(\)[\s\S]*catch \(error\) \{[\s\S]*restoreWorkspaceMemoryCheckpoint\(checkpoint\)[\s\S]*throw error/);
  assert.ok(
    updateSource.indexOf('await saveState({ persistWindowState: false, windowBinding })') <
      updateSource.indexOf('forgetRecentlyOpenedDormantTab(tab.id)'),
  );
});

test('tidy names uses AI when configured without overwriting manual names', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /parseTidyNames/);
  assert.match(source, /createPrompt\('tidy-names'/);
  assert.match(source, /const aiSettings = structuredClone\(state\.ai\)/);
  assert.match(source, /existingNames:\s*state\.renamedTabs/);
  assert.match(source, /preserveExisting:\s*true/);
  assert.match(source, /hasCurrentTidyNamesAICandidates[\s\S]*!tab\.pinned/);
  assert.match(source, /const renameableTabs = visibleTabs\.filter\(\(tab\) => \([\s\S]*!tab\.pinned && !duplicateCloseIds\.has\(Number\(tab\.id\)\)/);
  assert.match(source, /const aiCandidates = renameableTabs\.filter/);
  assert.match(source, /planTidyTabNames\(renameableTabs/);
  assert.match(source, /currentTargets\.some\(\(tab\) => tab\.pinned\)/);
});

test('Tidy Names renders the original broom initially and after busy state', async () => {
  const [html, source, css] = await Promise.all([
    readFile(new URL('../sidepanel.html', import.meta.url), 'utf8'),
    readFile(new URL('../sidepanel.js', import.meta.url), 'utf8'),
    readFile(new URL('../sidepanel.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /<button class="icon-button compact" id="tidyNamesButton" title="Tidy names" aria-label="Tidy Names">\s*<span class="tidy-icon" aria-hidden="true">🧹<\/span>\s*<\/button>/);
  assert.match(source, /const TIDY_NAMES_ICON = `[^`]*<span class="tidy-icon" aria-hidden="true">🧹<\/span>[^`]*`;/);
  assert.match(source, /els\.tidyNamesButton\.innerHTML = tidyBusy \? '\.\.\.' : TIDY_NAMES_ICON/);
  assert.match(css, /\.tidy-icon\s*\{[^}]*font-size:\s*15px;[^}]*line-height:\s*1;/);
});

test('Tidy Names and Auto Group preview changes before applying them', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /title: 'Preview Tidy Names'/);
  assert.match(source, /title: 'Rename in panel'/);
  assert.match(source, /type: 'tidy-names'/);
  assert.doesNotMatch(source, /duplicateTabIds/);
  assert.match(source, /buildOrganizationCandidates/);
  assert.match(source, /isPageShortcutCapableUrl\(tab\.url\)/);
  assert.match(source, /candidate\.currentGroup\?\.title/);
  assert.match(source, /title: 'Auto Group Preview'/);
  assert.match(source, /title: 'Untouched'/);
  assert.match(source, /const plannedTargetTitleKeys = new Set\(plannedGroups\.map/);
  assert.match(source, /title: 'Merge duplicates'/);
  assert.match(source, /const mergedDuplicateTitleKeys = new Set/);
  assert.doesNotMatch(source, /title: 'Merge empty duplicates'/);
  assert.match(source, /variant: 'groups'/);
  assert.match(source, /AI returned no valid groups/);
  assert.match(source, /applyOrganizationPlanToSnapshot/);
  assert.match(source, /type: 'auto-group'/);
  assert.match(source, /No live or saved http\(s\) tabs are available to organize/);
  assert.match(source, /extensionRuntime && candidates\.length > 0 && !hasUsableAISettings\(aiSettings\)/);
  assert.match(source, /async function autoGroupTabs\(options = \{\}\)[\s\S]*beginPanelAction\('autoGroup'\);\s*try \{\s*const refreshed = await refreshOrganizationActionState\(\{[\s\S]*adopt: true,[\s\S]*windowBinding,[\s\S]*\}\)/);
  assert.match(source, /async function refreshOrganizationActionState[\s\S]*syncStateFromStorage\(\{ windowBinding \}\)[\s\S]*loadTabs\(\{ adopt, windowBinding \}\)[\s\S]*await loadDormantSpaceView\(state\.activeSpaceId, \{ force: true \}\)/);
  assert.match(source, /showStatusToast\(message, 'error'\)/);
  assert.doesNotMatch(source, /Auto Group needs[\s\S]{0,200}openWorkbench/);
  assert.doesNotMatch(source, /plannedGroups\.length === 0\) plannedGroups = planTidyGroups/);
  const autoSource = source.slice(
    source.indexOf('async function autoGroupTabs(options = {})'),
    source.indexOf('function foreignOpenOrganizationCandidateIds'),
  );
  assert.match(autoSource, /assertCompleteAutoGroupPlan\(plannedGroups, candidates\)/);
  assert.match(autoSource, /resolvedPlan\.previewGroups/);
  assert.doesNotMatch(autoSource, /title: 'Remain untouched'/);
});

test('Auto Group delegates cross-window candidate safety and revalidates it after confirmation', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const shared = await readFile(
    new URL('../src/shared/organization-plan.js', import.meta.url),
    'utf8',
  );
  const autoSource = source.slice(
    source.indexOf('async function autoGroupTabs(options = {})'),
    source.indexOf('function activeChromeGroupsByTitle'),
  );
  const foreignSource = functionSource(source, 'foreignOpenOrganizationCandidateIds');

  assert.match(source, /organizationCandidateIdsOpenInOtherWindows,[\s\S]*from '\.\/src\/shared\/organization-plan\.js'/);
  assert.match(shared, /export function organizationCandidateIdsOpenInOtherWindows/);
  assert.match(shared, /candidate\.localLive[\s\S]*organizationForeignIdentitiesConflict/);
  assert.match(shared, /candidate\.snapshotTabId === foreign\.snapshotTabId/);
  assert.match(foreignSource, /foreignLiveTabs\.filter[\s\S]*entityBelongsToSpace\(tab, state, spaceId\)[\s\S]*organizationCandidateIdsOpenInOtherWindows/);
  assert.ok(
    autoSource.indexOf('const foreignCandidateIds = foreignOpenOrganizationCandidateIds') <
      autoSource.indexOf("send('ai:chat'"),
  );
  assert.match(autoSource, /const rebasedPreviewGroups = rebaseOrganizationPlan\(\{[\s\S]*plannedGroups: previewGroups/);
  assert.match(autoSource, /resolveOrganizationPlanChanges\(\{[\s\S]*plannedGroups: rebasedPreviewGroups/);
  assert.match(autoSource, /currentResolvedPlan\.previewGroups\)[\s\S]*JSON\.stringify\(rebasedPreviewGroups\)/);
  assert.match(autoSource, /const rebasedPlannedGroups = currentResolvedPlan\.plannedGroups/);
  assert.match(autoSource, /rebasedPreviewGroups\.some\([\s\S]*currentForeignCandidateIds\.has\(Number\(candidateId\)\)/);
  assert.match(autoSource, /An Auto Group target is now open in another window[\s\S]*review a fresh preview/);
});

test('Auto Group identifies newly organized saved Tags before lifecycle checkpointing', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const autoSource = source.slice(
    source.indexOf('async function autoGroupTabs(options = {})'),
    source.indexOf('function activeChromeGroupsByTitle'),
  );
  assert.match(
    autoSource,
    /ensureSnapshotLifecycleIds\(\s*organizedSnapshot,\s*createSnapshotLifecycleId,?\s*\)[\s\S]*mergeDuplicateSnapshotTags\([\s\S]*checkpointAutoGroupLifecycleBindings/,
  );
  assert.ok(
    autoSource.indexOf('mergedGroups = await mergeDuplicateGroupsInActiveSpace') <
      autoSource.indexOf('remapMergedSnapshotGroupReferences(\n            appliedDuplicateSnapshotPlan'),
    'Auto Group must choose the canonical physical Tag before remapping duplicate saved identities',
  );
  assert.match(
    functionSource(source, 'activeChromeGroupsByTitle'),
    /buildSpaceViewForSpace\(state\.activeSpaceId\)[\s\S]*logicalDuplicateChromeGroupTitle\([\s\S]*groupTitleKey\(logicalTitle\)/,
  );
  assert.match(
    functionSource(source, 'logicalDuplicateChromeGroupTitle'),
    /resolveChromeGroupTitleMatch\([\s\S]*state\.tabLifecycle\?\.\[tab\.id\]\?\.snapshotGroupId \|\| tab\.snapshotGroupId/,
  );
  assert.match(
    functionSource(source, 'canonicalLiveChromeGroupIdsByTitle'),
    /snapshotTabIds[\s\S]*state\.tabLifecycle[\s\S]*Number\(liveTab\.groupId\) === Number\(binding\?\.groupId\)/,
  );
  assert.match(
    functionSource(source, 'mergeDuplicateGroupsInActiveSpace'),
    /canonicalGroupIdsByTitle[\s\S]*reviewedKeep \|\| bucket\[0\]/,
  );
});

test('Tidy Names and Auto Group generate first and open only their final previews', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const tidySource = source.slice(
    source.indexOf('async function tidyTabNames(options = {})'),
    source.indexOf('async function tidyTabNamesWithAI'),
  );
  const autoSource = source.slice(
    source.indexOf('async function autoGroupTabs(options = {})'),
    source.indexOf('function activeChromeGroupsByTitle'),
  );
  assert.doesNotMatch(source, /confirmAIProposalGeneration|confirmText: 'Generate preview'|Generate \$\{action\} preview\?/);
  assert.match(source, /function startTidyNamesFromUserGesture\(\)[\s\S]*prepareTidyNamesRequestFromUserGesture\(\)[\s\S]*runTask\(\(windowBinding\) => tidyTabNames\(\{ \.\.\.request, windowBinding \}\)\)/);
  assert.match(tidySource, /tidyTabNamesWithAI\(aiCandidates, \{[\s\S]*permissionRequest: permissionRequested \? permissionRequest : null,[\s\S]*settings: aiSettings/);
  assert.match(tidySource, /tidyTabNamesWithAI\([\s\S]*showPlanPreview\(\{/);
  assert.match(tidySource, /title: 'Preview Tidy Names'/);
  assert.match(tidySource, /previewSummary\.push\(formatPreviewDuration[\s\S]*message: previewSummary\.join\(' · '\)/);
  assert.match(source, /async function tidyTabNamesWithAI[\s\S]*options\.permissionRequest \|\| ensureAIHostPermission\(settings\)[\s\S]*send\('ai:chat', \{\s*settings,/);
  assert.match(tidySource, /showPlanPreview\(\{[\s\S]*namingResult\.sourceLabel/);
  assert.match(source, /sourceLabel: `Local fallback \(AI unavailable: \$\{reason\}\)`/);
  assert.match(source, /function prepareAutoGroupRequestFromUserGesture\(\)[\s\S]*prepareOrganizationAIRequestFromUserGesture\(hasCurrentAutoGroupAICandidates\)/);
  assert.match(source, /function prepareOrganizationAIRequestFromUserGesture\(candidateProbe\)[\s\S]*requestAIHostPermissionFromUserGesture\(aiSettings\)/);
  assert.match(source, /permissionRequest\.catch\(\(\) => null\)/);
  assert.match(autoSource, /if \(permissionRequested\) await permissionRequest;\s*else await ensureAIHostPermission\(aiSettings\)/);
  assert.match(autoSource, /purpose: 'auto-group'/);
  assert.match(autoSource, /itemCount: candidates\.length/);
  assert.match(autoSource, /title: 'Auto Group Preview'/);
  assert.match(autoSource, /message: previewSummary\.join\(' · '\)/);
  assert.doesNotMatch(autoSource, /sent \$\{candidates\.length\}|simplified URLs|live\/saved status/);
  assert.match(source, /function updateOrganizationActionDisclosures\(\)[\s\S]*simplified URLs, domains, current Tags, and live\/saved status[\s\S]*aria-label/);
  assert.match(source, /Tidy Names uses local naming and merges duplicate Tags locally: no tab metadata is sent/);
  assert.match(source, /If the provider is unavailable, it falls back to local naming/);
  assert.match(source, /Auto Group needs a configured AI provider to regroup tabs, so no tab metadata is sent/);
  assert.match(source, /only duplicate Tags to clean up, they can still be merged locally after one preview/);
  assert.match(source, /function hasUsableAISettings[\s\S]*baseUrl[\s\S]*model[\s\S]*providerRequiresApiKey/);
  assert.ok(autoSource.indexOf("send('ai:chat'") < autoSource.indexOf("title: 'Auto Group Preview'"));
});

test('organization previews have one bounded scroll area and fixed actions', async () => {
  const styles = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');

  assert.match(styles, /#actionDialog\s*\{[\s\S]*?overflow: hidden;/);
  assert.match(styles, /#actionDialog \.action-form\s*\{[\s\S]*?max-height:[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.action-preview\s*\{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-y: auto;/);
  assert.match(styles, /\.action-preview\.group-plan-preview\s*\{[\s\S]*?max-height: none;/);
  assert.match(styles, /\.action-buttons\s*\{[\s\S]*?flex: 0 0 auto;/);
});

test('sidepanel delegates stable-identity Space view merging to the shared module', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const sharedSource = await readFile(
    new URL('../src/shared/space-view-merge.js', import.meta.url),
    'utf8',
  );
  const mergeSource = source.slice(
    source.indexOf('function mergeDormantSpaceView(liveView, dormantView)'),
    source.indexOf('function snapshotUrlIdentity(url)'),
  );

  assert.match(source, /import \{ mergeLiveAndDormantGroups \} from '\.\/src\/shared\/space-view-merge\.js'/);
  assert.match(mergeSource, /pruneRecentlyOpenedDormantTabs\(\)/);
  assert.match(mergeSource, /mergeLiveAndDormantGroups\(\{[\s\S]*liveGroups: liveView,[\s\S]*dormantGroups: dormantView,[\s\S]*collapsedGroups: state\.collapsedGroups,[\s\S]*recentlyOpenedTabs: recentlyOpenedDormantTabs/);
  assert.match(sharedSource, /const liveStableIndexes = indexesByStableIdentity\(liveEntries\)/);
  assert.match(sharedSource, /if \(liveIdentity && dormantIdentity\) continue/);
  assert.match(sharedSource, /function groupMetadataKey[\s\S]*chromeGroupTitleKey\(group\.title\)[\s\S]*normalizeColor\(group\.color\)/);
  assert.doesNotMatch(mergeSource, /liveGroupsByTitle|groupTitleKeyCounts/);
});

test('long logical group titles keep distinct Chrome identities across create and restore paths', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  assert.match(background, /const groupTitle = String\(title \?\? ''\)/);
  assert.match(background, /title: groupTitle === '' \? '' : chromeGroupTitle\(groupTitle\)/);
  assert.match(background, /safeUpdate\.title = title === '' \? '' : chromeGroupTitle\(title, 'Group'\)/);
  assert.match(source, /const requestedTitle = Object\.hasOwn\(options, 'title'\)[\s\S]*const logicalTitle = requestedTitle === '' \? '' : normalizeGroupTitle\(requestedTitle, 'Tabs'\)[\s\S]*const physicalTitle = logicalTitle === '' \? '' : chromeGroupTitle\(logicalTitle, 'Tabs'\)/);
  assert.match(source, /title: physicalTitle/);
  assert.match(source, /const existing = await chromeGroupForTitle\(group\.title, spaceId, \{[\s\S]*windowBinding: options\.windowBinding,[\s\S]*\}\)/);
  assert.match(source, /const existing = chromeGroupForSnapshotIdentity\(dormantGroup, state\.activeSpaceId\) \|\|\s*await chromeGroupForTitle\(dormantGroup\.title, state\.activeSpaceId, \{ windowBinding \}\)/);
  assert.match(source, /function chromeGroupForSnapshotIdentity[\s\S]*binding\?\.snapshotGroupId \|\| tab\.snapshotGroupId[\s\S]*bindChromeGroup\(groupId, spaceId\)[\s\S]*logicalChromeGroupTitles\.set/);
  assert.match(source, /resolveChromeGroupTitleMatch\(candidates, title, logicalGroupTitlesForSpace\(spaceId\)\)/);
  assert.match(source, /logicalChromeGroupTitles\.set\(groupId, logicalTitle\)/);
  assert.match(source, /groups\.push\(\{[\s\S]*title: physicalTitle/);
  assert.match(source, /\.\.\.logicalChromeGroupTitleOverride\(group\)/);
  assert.match(source, /\.\.\.snapshotLogicalChromeGroupTitleOverride\(group, identityTabs, spaceId\)/);
  assert.match(source, /function snapshotLogicalChromeGroupTitleOverride[\s\S]*snapshotGroupId[\s\S]*resolveChromeGroupTitleMatch\([\s\S]*logicalGroupTitlesForSpace\(spaceId\)[\s\S]*Number\(match\?\.group\?\.id\) !== Number\(group\.id\)[\s\S]*displayTitle: logicalTitle/);
  assert.match(source, /function captureLiveOrganization[\s\S]*Object\.hasOwn\(group, 'title'\) \? String\(group\.title \?\? ''\) : 'Tabs'[\s\S]*captureTabGroupMembership\(tabs, groups, tabIds\)\.tabs/);
  assert.match(source, /function dormantGroupsFromSnapshot[\s\S]*Object\.hasOwn\(group, 'title'\) \? String\(group\.title \?\? ''\) : 'Ungrouped'/);
  assert.match(source, /async function renameGroup[\s\S]*value: Object\.hasOwn\(group, 'title'\)[\s\S]*const clean = nextName\.trim\(\);[\s\S]*update: \{ title: clean \}[\s\S]*if \(!result\.group\)/);
});

test('organization Undo banner expires after ten seconds without deleting history', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const renderSource = source.slice(
    source.indexOf('function renderOperationRecord()'),
    source.indexOf('function recordOperation('),
  );

  assert.match(source, /const OPERATION_UNDO_VISIBLE_MS = 10_000;/);
  assert.match(renderSource, /isOperationUndoVisible\(operation, now, OPERATION_UNDO_VISIBLE_MS\)/);
  assert.match(renderSource, /setTimeout\(\(\) => \{[\s\S]*els\.operationRecord\.hidden = true;[\s\S]*\}, remaining\)/);
  assert.doesNotMatch(renderSource, /operationHistory\s*=|removeOperationRecord/);
});

test('organization commits validate freshness and record Undo only after the applied state refreshes', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const tidySource = source.slice(
    source.indexOf('async function tidyTabNames(options = {})'),
    source.indexOf('async function tidyTabNamesWithAI'),
  );
  const autoSource = source.slice(
    source.indexOf('async function autoGroupTabs(options = {})'),
    source.indexOf('function activeChromeGroupsByTitle'),
  );
  const undoSource = source.slice(
    source.indexOf('async function undoLastOperation'),
    source.indexOf('function operationUndoTargetMessage'),
  );
  const undoArcSource = functionSource(source, 'undoLastArcImport');

  assert.match(source, /fingerprintTidyNameTargets\(currentTargets, state\.renamedTabs, \{[\s\S]*tabIdAliases: operation\.after\?\.tabIdAliases/);
  assert.match(source, /organizationForCurrentSpaceState\(operation\.spaceId, \{[\s\S]*tabIdAliases: operation\.after\?\.tabIdAliases/);
  assert.match(tidySource, /setLiveTabPanelTitle\(state, item\.id, item\.result\)/);
  assert.ok(
    tidySource.indexOf('const refreshed = await refreshTabsView({') <
      tidySource.indexOf('recordOperation({'),
    'Tidy must verify the merged live/snapshot view before recording Undo',
  );
  assert.match(tidySource, /renameItems\.length === 0 && duplicateTagCount === 0/);
  assert.match(tidySource, /title: 'Merge duplicate Tags'/);
  assert.match(tidySource, /fingerprintTidyDuplicateTags\(currentSnapshot\) !== duplicateTagFingerprint/);
  assert.match(tidySource, /replaceActiveSpaceSnapshotGroups\(currentDuplicateTagPlan\.snapshot\.groups\)[\s\S]*mergeDuplicateGroupsInActiveSpace[\s\S]*remapMergedSnapshotGroupReferences[\s\S]*setLiveTabPanelTitle\(state, item\.id, item\.result\)/);
  assert.match(tidySource, /let committed = false[\s\S]*committed = true[\s\S]*if \(!committed\)/);
  assert.match(tidySource, /This panel moved before Tidy Names could apply the reviewed changes/);
  assert.match(tidySource, /runChromeGroupMutationTransaction\(\{[\s\S]*saveState\(\{ persistWindowState: false, windowBinding \}\)[\s\S]*restoreChromeGroupMutationAfterFailure/);
  assert.match(tidySource, /Tidy Names was saved, but this view could not refresh[\s\S]*showStatusToast\(postCommitWarning, 'info'\)/);
  const rollbackCapture = autoSource.indexOf('const rollback = captureChromeGroupMutationRollback();');
  const authoritativeLoad = autoSource.indexOf('const loaded = await loadTabs({ adopt: true, windowBinding });');
  const snapshotRefresh = autoSource.indexOf('snapshotOpenSpace(sourceSpaceId);', authoritativeLoad);
  const membershipCapture = autoSource.indexOf('rollback.membership = captureTabGroupMembership(');
  const transaction = autoSource.indexOf('await runChromeGroupMutationTransaction({');
  const refreshedView = autoSource.indexOf('const refreshed = await refreshTabsView({');
  const operationRecord = autoSource.indexOf('recordOperation({');
  const checkpoint = autoSource.indexOf('checkpoint: async () => {');
  const workspaceSave = autoSource.indexOf('saveState({ persistWindowState: false, windowBinding })');
  assert.ok(
    rollbackCapture >= 0 && rollbackCapture < authoritativeLoad && authoritativeLoad < snapshotRefresh &&
    snapshotRefresh < membershipCapture && membershipCapture < transaction &&
    transaction < refreshedView && refreshedView < operationRecord && operationRecord < checkpoint &&
    checkpoint < workspaceSave,
    'Auto Group must capture durable memory before refresh side effects, then verify, record Undo, and commit once',
  );
  assert.match(autoSource, /const beforeLive = captureLiveOrganization\(sourceSpaceId\);[\s\S]*rollback\.membership = captureTabGroupMembership\([\s\S]*beforeLive\.tabs\.map\(\(tab\) => tab\.tabId\)[\s\S]*runChromeGroupMutationTransaction\(\{/);
  assert.equal(autoSource.match(/saveState\(/g)?.length, 1, 'Auto Group has one durable workspace checkpoint');
  assert.match(autoSource, /checkpoint: async \(\) => \{[\s\S]*saved = await saveState\(\{ persistWindowState: false, windowBinding \}\)[\s\S]*saved !== true/);
  assert.match(autoSource, /rollback: \(\) => restoreChromeGroupMutationAfterFailure\(rollback, \{[\s\S]*windowBinding,[\s\S]*persistRestoredState: true/);
  assert.match(autoSource, /const identifiedOrganizedSnapshot = ensureSnapshotLifecycleIds\([\s\S]*const appliedDuplicateSnapshotPlan = mergeDuplicateSnapshotTags\([\s\S]*identifiedOrganizedSnapshot/);
  assert.match(autoSource, /replaceActiveSpaceSnapshotGroups\([\s\S]*appliedDuplicateSnapshotPlan\.snapshot\.groups,[\s\S]*appliedDuplicateSnapshotPlan\.snapshot,[\s\S]*remapMergedSnapshotGroupReferences/);
  assert.match(autoSource, /mergeDuplicateSnapshotTags\(state\.spaceSnapshots\?\.\[sourceSpaceId\]\)\.mergedCount > 0/);
  assert.match(autoSource, /let committed = false[\s\S]*committed = true[\s\S]*if \(!committed\)/);
  assert.match(autoSource, /Auto Group was saved, but this panel moved before its view could refresh/);
  assert.match(autoSource, /Auto Group was saved, but this view could not refresh/);
  assert.match(autoSource, /assertLivePlannedGroupsApplied\(livePlannedGroups, sourceSpaceId\)/);
  assert.match(autoSource, /Chrome could not (?:apply|create) the proposed group/);
  assert.doesNotMatch(autoSource, /withoutOperationRecord|createRollbackFailureError/);
  assert.match(source, /import \{[\s\S]{0,240}createRollbackAggregateError,[\s\S]{0,240}createRollbackFailureError,[\s\S]{0,240}withoutOperationRecord,[\s\S]{0,240}\} from '\.\/src\/shared\/operation-safety\.js'/);
  assert.match(source, /await assertOperationUndoIsFresh\(operation, \{ windowBinding \}\)/);
  assert.match(source, /operation\.type === 'tidy-names'[\s\S]*setLiveTabPanelTitle\(state, tabId, previousName\)/);
  assert.match(undoSource, /operation\.type === 'tidy-names'[\s\S]*runDurableCommitBoundary\(\{[\s\S]*commit: \(\) => saveState\(\{ persistWindowState: false, windowBinding \}\)[\s\S]*rollbackBeforeCommit:[\s\S]*restoreWorkspaceMemoryCheckpoint\(beforeUndo, \{ renderView: true \}\)[\s\S]*afterCommit: \(\) => refreshTabs\(\{ reloadDormant: true, windowBinding \}\)[\s\S]*restoreCommittedMemory/);
  assert.match(undoSource, /Tidy Names Undo was saved, but this view could not refresh/);
  assert.match(undoSource, /operation\.type === 'auto-group'[\s\S]*saved = await saveState\(\{ persistWindowState: false, windowBinding \}\)[\s\S]*saved !== true[\s\S]*Auto Group Undo could save its checkpoint/);
  assert.match(undoSource, /Auto Group Undo was saved, but this panel moved before its view could refresh[\s\S]*Auto Group Undo was saved, but this view could not refresh/);
  assert.match(source, /Auto Group with \$\{provider\.label\}:[^`]+merges duplicate Tags locally/);
  assert.match(source, /If this Space has only duplicate Tags to clean up, they can still be merged locally after one preview/);
  assert.match(source, /type: 'restore-backup'[\s\S]*after: \{ portableFingerprint: fingerprintPortableWorkspaceContent\(state\) \}/);
  assert.match(source, /snapshotIdentities: beforeSnapshotIdentities/);
  assert.match(source, /restoreSnapshotIdentityOverlay\([\s\S]*operation\.before\?\.snapshotIdentities/);
  assert.match(source, /operation\?\.type === 'restore-backup'[\s\S]*fingerprintPortableWorkspaceContent\(state\) !== expectedFingerprint/);
  assert.match(source, /afterFingerprints: fingerprintPortableSpacesContent\(state, ids\)/);
  assert.match(source, /assertArcImportUndoIsFresh\(state\.lastArcImport\)/);
  assert.match(undoArcSource, /send\('tabs:listAll', \{\}, \{ windowBinding \}\)[\s\S]*reassignTabsFromRemovedSpaces\([\s\S]*activeSpaceForWindow\([\s\S]*tab\.windowId[\s\S]*remainingSpaces[\s\S]*for \(const targetSpaceId of reassigned\.spaceIds\)[\s\S]*snapshotOpenSpace\(targetSpaceId, \{[\s\S]*sourceTabs: openTabs,[\s\S]*sourceGroups: response\.groups \|\| \[\][\s\S]*refreshTabs\(\{ adopt: false, reloadDormant: true, windowBinding \}\)/);
  assert.match(undoArcSource, /beforeWindowSpaceState[\s\S]*persisted = false[\s\S]*restoring Arc import state/);
  assert.match(source, /snapshotHasPersistentContent\(snapshot\)/);
  assert.match(source, /function currentGroupForMutation[\s\S]*groupMutationFingerprint\(current\) !== groupMutationFingerprint\(reference\)/);
  assert.match(source, /function groupMutationFingerprint[\s\S]*url: snapshotUrlIdentity\(tab\?\.url\)/);
  assert.match(source, /currentContext\.fingerprint !== folderContext\.fingerprint/);
});

test('destructive Settings and Undo actions bind the reviewed record and merge concurrent edits', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const stateSource = await readFile(new URL('../src/shared/state.js', import.meta.url), 'utf8');

  assert.match(source, /from '\.\/src\/shared\/action-safety\.js'/);
  assert.match(source, /undoOrganizationButton\.dataset\.operationId = operation\.id/);
  assert.match(source, /runTask\(\(windowBinding\) => undoLastOperation\(operationId, \{ windowBinding \}\)\)/);
  assert.match(source, /resolveOperationUndoTarget\(state\.operationHistory, expectedOperationId\)/);
  assert.doesNotMatch(
    source.slice(source.indexOf('async function undoLastOperation'), source.indexOf('function currentAskPageTab')),
    /latestAppliedOperation\(/,
  );
  assert.match(source, /token: createArcImportToken\(\)/);
  assert.match(source, /sameArcImportRecord\(confirmedImportRecord, state\.lastArcImport\)/);
  assert.match(stateSource, /normalizeArcImportToken\(value\.token\)/);
  assert.match(source, /settingsBaseline = captureSettingsBaseline\(/);
  assert.match(source, /mergeConcurrentSettings\(\{[\s\S]*baseline,[\s\S]*draft,[\s\S]*latest:/);
  assert.match(source, /const aiSettings = currentAISettingsDraftFromForm\(\)/);
  assert.match(source, /const mergedShortcutConflict = shortcutConflict\(merged\.settings\.shortcuts\)/);
  assert.match(source, /const mergedAI = canPreserveUnconfiguredSettingsAI\([\s\S]*merged\.settings\.ai,[\s\S]*merged\.userChanged,[\s\S]*\)[\s\S]*\? normalizeAIProviderSettings\(merged\.settings\.ai\)[\s\S]*: validateAISettings\(merged\.settings\.ai\)/);
  assert.match(source, /function currentAISettingsFromControls\(controls\) \{[\s\S]*validateAISettings\(currentAISettingsDraftFromControls\(controls\)\)/);
  assert.match(source, /sameAIAuthTarget\(expectedAuthTarget, state\.ai\)/);
});

test('Arc import and backup restore separate pre-commit rollback from post-commit UI warnings', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const restoreSource = functionSource(source, 'restoreSpaceData');
  const restorePreflightSource = restoreSource.slice(
    restoreSource.indexOf('const selectedBackup = pendingSpaceBackup'),
    restoreSource.indexOf('const ok = await askConfirm'),
  );
  const arcSource = [
    functionSource(source, 'applyArcOnboarding'),
    functionSource(source, 'importArcFile'),
  ].join('\n');

  assert.match(source, /function assertCurrentStateFitsStorage[\s\S]*assertWorkspaceStorageBudget/);
  assert.match(source, /function captureWorkspaceMemoryCheckpoint[\s\S]*function restoreWorkspaceMemoryCheckpoint/);
  assert.match(source, /runDurableCommitBoundary/);
  assert.match(restoreSource, /const selectedBackup = pendingSpaceBackup/);
  assert.match(restorePreflightSource, /await syncStateFromStorage\(\{ windowBinding \}\);[\s\S]*confirmedBackup = structuredClone\(selectedBackup\);[\s\S]*reviewedPortableFingerprint = fingerprintPortableWorkspaceContent\(state\)/);
  assert.doesNotMatch(restorePreflightSource, /loadTabs\(|snapshotOpenSpace\(|saveState\(/);
  assert.match(restoreSource, /await syncStateFromStorage\(\{ windowBinding \}\);[\s\S]*pendingSpaceBackup !== selectedBackup \|\|[\s\S]*fingerprintPortableWorkspaceContent\(state\) !== reviewedPortableFingerprint[\s\S]*preconditionChanged = true[\s\S]*await loadTabs\(\{ adopt: false, windowBinding \}\);[\s\S]*snapshotOpenSpace\(state\.activeSpaceId\);[\s\S]*beforeRestore = captureWorkspaceMemoryCheckpoint\(\)/);
  assert.match(restoreSource, /assertCurrentStateFitsStorage\(\);[\s\S]*commit: async \(\) => \{[\s\S]*saved = await saveState\(\{ windowBinding \}\)[\s\S]*saved !== true/);
  assert.match(restoreSource, /beforeAttempt = captureWorkspaceMemoryCheckpoint\(\)[\s\S]*await loadTabs\(\{ adopt: false, windowBinding \}\)[\s\S]*catch \(error\)[\s\S]*restoreWorkspaceMemoryCheckpoint\(beforeAttempt, \{ renderView: true \}\)[\s\S]*runDurableCommitBoundary\(\{[\s\S]*commit: async \(\)[\s\S]*saved !== true[\s\S]*rollbackBeforeCommit:[\s\S]*restoreWorkspaceMemoryCheckpoint\(beforeAttempt, \{ renderView: true \}\)[\s\S]*afterCommit:[\s\S]*refreshTabsView\(\{[\s\S]*adopt: true,[\s\S]*reloadDormant: true,[\s\S]*render: false,[\s\S]*refreshed !== true[\s\S]*value\.operation\.after\.portableFingerprint[\s\S]*saved = await saveState\(\{ windowBinding \}\)[\s\S]*saved !== true[\s\S]*value\.committedMemory = captureWorkspaceMemoryCheckpoint\(\)[\s\S]*restoreCommittedMemory/);
  const noCommitGuard = restoreSource.indexOf('if (!committed)');
  const selectionCleanup = restoreSource.indexOf('pendingSpaceBackup = null');
  assert.ok(noCommitGuard >= 0 && noCommitGuard < selectionCleanup,
    'a restore that did not commit must retain the reviewed file and Settings surface');
  assert.match(restoreSource, /selected backup is still ready to retry/);
  assert.match(restoreSource, /Space data changed while confirmation was open\. Nothing was restored; review the selected backup and confirm again\./);
  assert.match(restoreSource, /backup restore was saved, but this view could not finish refreshing/i);
  assert.doesNotMatch(restoreSource, /restoreFailedWorkspaceMutation/);
  assert.equal((arcSource.match(/assertCurrentStateFitsStorage\(\);/g) || []).length, 2);
  assert.equal((arcSource.match(/runDurableCommitBoundary\(\{/g) || []).length, 2);
  assert.equal((arcSource.match(/restoreWorkspaceMemoryCheckpoint\(beforeImport, \{ renderView: true \}\)/g) || []).length, 2);
  assert.ok((arcSource.match(/The import was saved, but this view could not refresh/g) || []).length >= 2);
  assert.doesNotMatch(arcSource, /restoreFailedWorkspaceMutation/);
});

test('backup restore discloses and immediately adopts currently open browser tabs', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const restoreSource = functionSource(source, 'restoreSpaceData');
  const adoptOpenTabsSource = functionSource(source, 'adoptAllOpenTabsIntoRestoredActiveSpace');

  assert.match(restoreSource, /Current browser tabs will stay open and join the restored active Space\./);
  assert.match(restoreSource, /refreshTabsView\(\{[\s\S]*adopt: true,[\s\S]*reloadDormant: true,[\s\S]*render: false,[\s\S]*windowBinding/);
  assert.match(restoreSource, /value\.operation\.after\.portableFingerprint = fingerprintPortableWorkspaceContent\(state\);[\s\S]*saved = await saveState\(\{ windowBinding \}\)[\s\S]*saved !== true/);
  assert.match(restoreSource, /Current browser tabs stayed open in the active Space\./);
  assert.match(restoreSource, /adoptAllOpenTabsIntoRestoredActiveSpace\(\{ windowBinding \}\)/);
  assert.match(adoptOpenTabsSource, /send\('tabs:listAll', \{\}, \{ windowBinding: options\.windowBinding \}\)[\s\S]*isCurrentPanelWindowBinding\(options\.windowBinding\)[\s\S]*adoptUnassignedEntities\([\s\S]*adoptGroups: true[\s\S]*snapshotOpenSpace\(state\.activeSpaceId, \{[\s\S]*sourceTabs: openTabs,[\s\S]*sourceGroups: openGroups/);
  assert.match(source, /adopt: operation\.type === 'restore-backup'/);
  assert.match(source, /sanitizeSnapshotWithLifecycleIds\(\s*state\.spaceSnapshots\[spaceId\],\s*createSnapshotLifecycleId/);
});

test('non-Ask task failures never become persisted Ask conversation messages', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const runTaskSource = source.slice(
    source.indexOf('function runTask(task)'),
    source.indexOf('async function withSharedStateLock'),
  );
  const askSource = source.slice(
    source.indexOf('async function askCustomPrompt'),
    source.indexOf('function recentAskHistory'),
  );

  assert.doesNotMatch(runTaskSource, /addAskMessage/);
  assert.match(runTaskSource, /setStatus\(message\)/);
  assert.match(runTaskSource, /else if \(workbenchMode\) showStatusToast\(message, 'error'\)/);
  assert.match(askSource, /if \(statusMessage\)[\s\S]*persistAskMessage\(statusMessage, answer\)/);
  assert.match(askSource, /else \{[\s\S]*setStatus\(message\)[\s\S]*showStatusToast\(message, 'error'\)/);
});

test('Settings keeps Chrome global shortcut handling out of the compact shortcut surface', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const keyboardSource = await readFile(
    new URL('../src/shared/panel-keyboard.js', import.meta.url),
    'utf8',
  );
  const renderShortcutSource = source.slice(
    source.indexOf('function renderShortcutSettings()'),
    source.indexOf('async function saveSettings()'),
  );

  assert.doesNotMatch(html, /Toggle panel is a Chrome global shortcut \(default Alt\+S\)/);
  assert.doesNotMatch(html, /chrome:\/\/extensions\/shortcuts/);
  assert.match(renderShortcutSource, /filter\(\(action\) => action\.id !== 'togglePanel'\)/);
  assert.match(source, /function shortcutConflict\(shortcuts\)[\s\S]*delete panelShortcuts\.togglePanel/);
  assert.match(source, /findReservedShortcutConflict\(panelShortcuts\[action\.id\]\)/);
  assert.match(source, /function hasBlockingDialogOpen\(\)[\s\S]*dialog !== els\.settingsDialog/);
  assert.match(source, /import \{ createPanelKeyboardController \} from '\.\/src\/shared\/panel-keyboard\.js'/);
  assert.match(source, /const panelKeyboardController = createPanelKeyboardController\(\{[\s\S]*getShortcuts: \(\) => mergeShortcuts\(state\.shortcuts\)[\s\S]*hasBlockingDialogOpen,[\s\S]*dispatchShortcutAction: \(action\) => \{[\s\S]*prepareOrganizationRequestForAction\(action\)[\s\S]*runTask\(\(windowBinding\) => runShortcutAction\(action, organizationRequest, \{[\s\S]*windowBinding,[\s\S]*\}\)\)/);
  assert.match(source, /addEventListener\('keydown', panelKeyboardController\.handleKeydown, \{ capture: true \}\)/);
  assert.match(keyboardSource, /export function createPanelKeyboardController[\s\S]*if \(event\.key === 'Escape'\)[\s\S]*hasBlockingDialogOpen\(\)[\s\S]*shortcutMatchesEvent\(commandPaletteShortcut, event\)/);
  assert.match(keyboardSource, /shouldPreserveNativeCopy\(event, options\.getSelection\(\)\)[\s\S]*exclude: \['togglePanel', 'askSubmit', 'askAbort'\]/);
  assert.match(keyboardSource, /export function captureShortcutInput[\s\S]*event\.key === 'Tab'[\s\S]*event\.key === 'Backspace' \|\| event\.key === 'Delete'[\s\S]*shortcutFromEvent\(event\)/);
  assert.doesNotMatch(keyboardSource, /shortcuts\.togglePanel/);
  assert.doesNotMatch(keyboardSource, /runTask|runShortcutAction|prepareOrganizationRequestForAction/);
});

test('group deletion requires an explicit destructive confirmation with the affected tab count', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const deletionSource = source.slice(
    source.indexOf('async function deleteGroup('),
    source.indexOf('function groupsForFolderContext('),
  );

  assert.equal((deletionSource.match(/await confirmGroupDeletion\(/g) || []).length, 2);
  assert.match(deletionSource, /title: 'Delete Group'/);
  assert.match(deletionSource, /Open tabs will be closed and saved tabs will be removed\. This cannot be undone\./);
  assert.match(deletionSource, /confirmText: tabCount > 0 \? `Delete \$\{count\}` : 'Delete group'/);
  assert.match(deletionSource, /danger: true/);
  assert.equal((deletionSource.match(/showStatusToast\(message, 'success'\)/g) || []).length, 1);
  assert.equal((deletionSource.match(/deletion\.skippedTabCount > 0 \? 'info' : 'success'/g) || []).length, 2);
  assert.doesNotMatch(deletionSource, /\btags\b/);

  const closeSource = source.slice(
    source.indexOf('async function deleteGroupsAndTabs('),
    source.indexOf('async function ensureActiveSpaceHasOpenTabAfterClosing('),
  );
  assert.match(closeSource, /runGuardedDestructiveTabClose\(/);
  assert.match(closeSource, /inspectTab: \(tabId, transaction\) => \{[\s\S]*isCurrentPanelWindowBinding\(windowBinding\)[\s\S]*return liveReviewedTabCloseMismatch\([\s\S]*\{ windowBinding \}\)/);
  assert.match(closeSource, /closeTab: \(tabId\) => guardedReviewedTabClose\([\s\S]*\{ windowBinding \}[\s\S]*\)/);
  assert.match(closeSource, /commit: async \(\{ closedTabIds \}\) => \{[\s\S]*syncStateFromStorage\(\{ windowBinding, allowStaleWindowBinding \}\)/);
  assert.match(closeSource, /for \(const tabId of closedTabIds\)[\s\S]*delete state\.tabLifecycle\?\.\[tabId\]/);
  assert.match(closeSource, /survivingGroupKeys[\s\S]*tabMatchesDestructiveTarget/);
  assert.doesNotMatch(closeSource, /for \(const tabId of liveTabIds\)[\s\S]*delete state\.tabLifecycle/);
});

test('Ungrouped Clear is disabled when every remaining tab is pinned', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const clearSource = source.slice(
    source.indexOf('async function clearUngroupedTabs('),
    source.indexOf('function captureReviewedTabCloseTarget('),
  );

  assert.match(source, /function createUngroupedSection\(group\)[\s\S]*clearableCount = clearableUngroupedTabs\(group\.tabs,[\s\S]*fileSchemeAccess: fileSchemeAccessAllowed/);
  assert.match(source, /clearButton\.disabled = clearableCount === 0/);
  assert.match(source, /Pinned or non-restorable tabs are kept/);
  assert.match(source, /async function clearUngroupedTabs[\s\S]*runGuardedDestructiveTabClose\([\s\S]*snapshotOpenSpace\(state\.activeSpaceId\)[\s\S]*removeTabsFromSpaceSnapshot\(targetSpaceId, \[/);
  assert.match(source, /async function clearUngroupedTabs[\s\S]*inspectTab: \(tabId, transaction\) => \{[\s\S]*return liveReviewedTabCloseMismatch\([\s\S]*\{ windowBinding \}\)[\s\S]*closeTab: \(tabId\) => guardedReviewedTabClose\([\s\S]*\{ windowBinding \}/);
  assert.match(source, /async function clearUngroupedTabs[\s\S]*commit: async \(\{ closedTabIds \}\) => \{[\s\S]*syncStateFromStorage\(\{ windowBinding, allowStaleWindowBinding \}\)[\s\S]*removeTabsFromSpaceSnapshot\(targetSpaceId, \[/);
  assert.match(source, /function guardedReviewedTabClose[\s\S]*closeGuard: tabCloseGuardFor\(target\.tab\)[\s\S]*skipChanged: true/);
  assert.match(clearSource, /const closedIds = new Set\(closedTabIds\.map\(Number\)\)/);
  assert.match(clearSource, /closable\.filter\(\(tab\) => closedIds\.has\(Number\(tab\.id\)\)\)/);
  assert.doesNotMatch(clearSource, /removeTabsFromSpaceSnapshot\([^\n]*clearable/);
});

test('fallback tabs created for destructive checkpoints are compensated when persistence fails', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const transactionSource = await readFile(new URL('../src/shared/tab-close-transaction.js', import.meta.url), 'utf8');

  assert.match(transactionSource, /function rollbackCreatedTabsOnCheckpointFailure[\s\S]*await checkpoint\(\)[\s\S]*closeCreatedTab\(tabId\)[\s\S]*AggregateError/);
  assert.match(source, /function withCreatedTabCheckpointRollback[\s\S]*rollbackCreatedTabsOnCheckpointFailure\([\s\S]*closeCreatedTabWithoutEmptyingWindow/);
  assert.match(source, /async function closeCreatedTabWithoutEmptyingWindow[\s\S]*tabs:listAll[\s\S]*if \(!survivor\)[\s\S]*return;[\s\S]*focusSpaceSwitchSurvivor[\s\S]*requiredActiveSurvivorTabId/,
    'created-tab compensation must retain the final tab or atomically require an active same-window survivor');
  assert.match(source, /async function clearUngroupedTabs[\s\S]*withCreatedTabCheckpointRollback\(checkpointCreatedTabIds[\s\S]*tabs:create[\s\S]*await saveState\(\{ persistWindowState: false, windowBinding \}\)/);
  assert.match(source, /async function deleteGroupsAndTabs[\s\S]*withCreatedTabCheckpointRollback\(checkpointCreatedTabIds[\s\S]*ensureActiveSpaceHasOpenTabAfterClosing\([\s\S]*liveTabIds,[\s\S]*checkpointCreatedTabIds,[\s\S]*checkpointCreatedTabs,[\s\S]*await saveState\(\{ persistWindowState: false, windowBinding \}\)/);
  assert.match(source, /async function closeSpaceTabsAcrossWindows[\s\S]*withCreatedTabCheckpointRollback\(checkpointCreatedTabIds[\s\S]*windowId[\s\S]*checkpointCreatedTabIds\.push\(tabId\)[\s\S]*await saveState\(\{ windowBinding \}\)/);
});

test('Move to context actions render as a right-side submenu', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');

  assert.match(source, /moveToSpaceSubmenu\(\(space, windowBinding\) => \(/);
  assert.match(source, /moveSelectedTabsToSpace\(contextTabIds, space\.id, \{ windowBinding \}\)/);
  assert.match(source, /moveTabToSpace\(tab, space\.id, \{ windowBinding \}\)/);
  assert.match(source, /moveToSpaceSubmenu\(\(space, windowBinding\) => \([\s\S]{0,100}moveGroupToSpace\(group, space\.id, \{ windowBinding \}\)/);
  assert.match(source, /moveToSpaceSubmenu\(\(space, windowBinding\) => \([\s\S]{0,100}moveFolderGroupToSpace\(folderContext, space\.id, \{ windowBinding \}\)/);
  assert.match(source, /function menuSubmenu\(label, items\)/);
  assert.doesNotMatch(source, /menuLabel\('Move to'\)/);
  assert.doesNotMatch(source, /submenu-left/);
  assert.match(styles, /\.context-submenu-panel/);
  assert.match(styles, /left: calc\(100% \+ 6px\)/);
  assert.doesNotMatch(styles, /submenu-left/);
});

test('custom context menus expose menu semantics and a complete keyboard focus model', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');
  const submenuSource = functionSource(source, 'menuSubmenu');
  assert.match(html, /id="contextMenu" role="menu"[^>]*tabindex="-1"/);
  assert.match(source, /button\.setAttribute\('role', 'menuitem'\)/);
  assert.match(source, /function handleContextMenuKeydown\(event\)/);
  assert.match(source, /const menu = item\?\.closest\?\.\('\[role="menu"\]'\) \|\| els\.contextMenu/);
  assert.match(source, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
  assert.match(source, /event\.key === 'ArrowRight'/);
  assert.match(source, /event\.key === 'ArrowLeft'/);
  assert.match(source, /hideContextMenu\(\{ restoreFocus: true \}\)/);
  assert.match(source, /const firstItem = menuItemsIn\(els\.contextMenu\)\[0\]/);
  assert.match(source, /function isContextMenuKey\(event\)[\s\S]*event\?\.key === 'ContextMenu'[\s\S]*event\?\.key === 'F10' && event\.shiftKey/);
  assert.match(source, /function handleTabPrimaryKeydown[\s\S]*isContextMenuKey\(event\)[\s\S]*showTabContextMenu\(event, tab\)/);
  assert.doesNotMatch(
    submenuSource,
    /addEventListener\('focusin',[\s\S]*setContextSubmenuOpen/,
    'returning focus to a submenu trigger must not reopen the submenu after ArrowLeft',
  );
  assert.match(submenuSource, /addEventListener\('mouseenter',[\s\S]*setContextSubmenuOpen\(wrapper, true\)/);
  assert.match(submenuSource, /trigger\.addEventListener\('click',[\s\S]*setContextSubmenuOpen\(wrapper, true\)/);
  assert.match(styles, /\.context-submenu\.open > \.context-submenu-panel\s*\{\s*display: block/);
  assert.doesNotMatch(
    styles,
    /\.context-submenu:(?:focus-within|hover) > \.context-submenu-panel/,
    'the visible submenu must agree with aria-expanded instead of reopening from focus alone',
  );
});

test('every dialog exposes a stable accessible name', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  assert.match(html, /<dialog id="actionDialog" aria-labelledby="actionDialogTitle">/);
  assert.match(html, /<dialog id="onboardingDialog"[^>]*aria-label="Set up Space Tabs"/);
  assert.match(html, /<dialog id="settingsDialog" aria-labelledby="settingsDialogTitle">[\s\S]*id="settingsDialogTitle"/);
  assert.match(html, /<dialog id="commandPaletteDialog"[^>]*aria-labelledby="commandPaletteTitle"[\s\S]*id="commandPaletteTitle"/);
});

test('main Space rendering keeps lifecycle Tag identity and logical titles', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const renderSource = functionSource(sidepanel, 'render');
  const projectionSource = functionSource(sidepanel, 'projectLifecycleAwareLiveGroup');

  assert.match(
    renderSource,
    /buildSpaceView\(\{[\s\S]*\.map\(\(group\) => projectLifecycleAwareLiveGroup\(group, state\.activeSpaceId\)\)/,
  );
  assert.match(projectionSource, /snapshotGroupId/);
  assert.match(projectionSource, /snapshotLogicalChromeGroupTitleOverride/);
});

test('sidepanel delegates the complete Command Palette UI lifecycle to its shared controller', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const controller = await readFile(
    new URL('../src/shared/command-palette-controller.js', import.meta.url),
    'utf8',
  );
  const selection = await readFile(
    new URL('../src/shared/command-palette-selection.js', import.meta.url),
    'utf8',
  );

  assert.match(sidepanel, /import \{ createCommandPaletteController \} from '.\/src\/shared\/command-palette-controller\.js'/);
  assert.match(sidepanel, /const commandPaletteController = createCommandPaletteController\(\{/);
  assert.match(sidepanel, /getData: \(\) => \(\{ spaces: state\.spaces, spaceView: commandPaletteSpaceView\(\) \}\)/);
  assert.match(sidepanel, /function commandPaletteSpaceView\(\)[\s\S]*state\.spaces[\s\S]*buildSpaceViewForSpace\(spaceId\)[\s\S]*dormantGroupsFromSnapshot\(state\.spaceSnapshots\?\.\[spaceId\], spaceId\)[\s\S]*mergeLiveAndDormantGroups/);
  assert.match(sidepanel, /prepareSelection: prepareCommandPaletteSelectionFromUserGesture/);
  assert.match(sidepanel, /onSelect: \(prepared\) => void runTask\(\(windowBinding\) => runSelectedCommandPaletteItem\(\{[\s\S]*\.\.\.prepared,[\s\S]*windowBinding: prepared\?\.windowBinding \|\| windowBinding,[\s\S]*\}\)\)/);
  assert.match(sidepanel, /tabSelection: item\?\.kind === 'tab'[\s\S]*captureCommandPaletteTabSelection\(item, \[\.\.\.tabs, \.\.\.foreignLiveTabs\]\)/);
  const paletteTabSource = functionSource(sidepanel, 'runSelectedCommandPaletteTab');
  assert.match(paletteTabSource, /preparedWindowBinding \|\| capturePanelWindowBinding\(\)[\s\S]*withSharedStateLock[\s\S]*loadTabs\(\{ adopt: false, windowBinding \}\)[\s\S]*resolveCommandPaletteTabSelection/);
  assert.match(paletteTabSource, /preferredTabId: resolved\.mode === 'live' \? resolved\.tab\.id : null[\s\S]*preferredSnapshotTabId: reference\.snapshotTabId/);
  assert.match(paletteTabSource, /const activated = await activateSpace[\s\S]*const reloaded = await loadTabs\(\{ adopt: false, windowBinding \}\)[\s\S]*if \(reloaded === false[\s\S]*resolveCommandPaletteTabSelection/,
    'a committed switch must obtain authoritative live tabs before it can open a saved palette row');
  assert.ok((paletteTabSource.match(/resolveCommandPaletteTabSelection/g) || []).length >= 2,
    'a dormant palette selection must be re-resolved after bulk Space materialization');
  assert.match(paletteTabSource, /focusGuard: commandPaletteFocusGuard\(resolved\.tab\)/);
  assert.doesNotMatch(paletteTabSource, /activateSpace\(previousSpaceId/,
    'a committed switch must not churn back after a later palette focus race');
  assert.match(selection, /same durable identity and URL/);
  assert.match(selection, /foreignWindowTabId/);
  assert.match(sidepanel, /commandPaletteInput\.addEventListener\('input', commandPaletteController\.handleInput\)/);
  assert.match(sidepanel, /commandPaletteResults\.addEventListener\('click', commandPaletteController\.handleClick\)/);
  assert.match(sidepanel, /commandPaletteDialog\.addEventListener\('keydown', commandPaletteController\.handleKeydown\)/);
  assert.match(sidepanel, /commandPaletteDialog\.addEventListener\('close', commandPaletteController\.handleClose\)/);
  assert.doesNotMatch(sidepanel, /let commandPalette(?:Items|Index)|function (?:open|render)CommandPalette/);
  assert.match(controller, /import \{ buildCommandPaletteItems \} from '.\/command-palette\.js'/);
  assert.match(controller, /export function createCommandPaletteController/);
});

test('shared render signatures cover panel dependencies without invalidating every storage poll', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const signatures = await readFile(
    new URL('../src/shared/panel-render-signatures.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{[\s\S]{0,180}askMessagesRenderSignature,[\s\S]{0,180}groupsRenderSignature,[\s\S]{0,180}spacesRenderSignature,[\s\S]{0,180}\} from '\.\/src\/shared\/panel-render-signatures\.js'/);
  assert.match(source, /const tree = createFolderTree\(tabGroups, \{ activeSpaceId: state\.activeSpaceId \}\);[\s\S]{0,800}groupsRenderSignature\(\{[\s\S]{0,800}collapsedGroups: state\.collapsedGroups,[\s\S]{0,800}selectedTabIds,[\s\S]{0,800}folderTree: tree/);
  assert.match(source, /spacesRenderSignature\(\{[\s\S]{0,500}workbenchMode,[\s\S]{0,500}onboardingCompleted:[\s\S]{0,500}spaces: state\.spaces/);
  assert.match(source, /askMessagesRenderSignature\(session\)/);
  assert.doesNotMatch(source, /function (?:groupsRenderSignature|spacesRenderSignature|askMessagesSignature)\(/);
  const syncState = source.match(/async function syncStateFromStorage\(options = \{\}\)[\s\S]*?\n}\n\nasync function saveState/)[0];
  assert.doesNotMatch(syncState, /lastRendered(?:Groups|Ask|Spaces)Signature\s*=\s*''/);
  assert.match(signatures, /import \{ tabRowPresentation \} from '\.\/tab-utils\.js'/);
  assert.match(signatures, /visibleCollapsedKeys[\s\S]*addVisibleFolderKeys\(folderTree[\s\S]*collapsedGroups\[key\]/);
  assert.match(signatures, /const presentation = tabRowPresentation\(tab\)[\s\S]*selected: !tab\.dormant && !presentation\.foreign/);
  assert.match(source, /row\.dataset\.snapshotTabId = String\(tab\.snapshotTabId \|\| ''\)/);
  assert.match(source, /row\.dataset\.snapshotGroupId = String\(tab\.snapshotGroupId \|\| ''\)/);
});

test('moving tabs to another Space activates the target Space', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const moveTabsSource = functionSource(source, 'moveTabsToSpace');
  const moveGroupsSource = functionSource(source, 'checkpointMovedGroupsToSpace');
  const finishMoveSource = functionSource(source, 'finishMoveToSpace');

  assert.match(moveTabsSource, /runChromeGroupMutationTransaction\([\s\S]*snapshotOpenSpace\(sourceSpaceId\)[\s\S]*tabs:ungroup[\s\S]*reduceTabLifecycleEvent\([\s\S]*targetGroup[\s\S]*assertMovedTabsCheckpointComplete\([\s\S]*checkpoint: \(\) => saveState\(\{ persistWindowState: false \}\)/);
  assert.match(moveTabsSource, /const ungrouped = await send\('tabs:ungroup'[\s\S]*if \(ungrouped\.missing\)[\s\S]*No Space change was saved/);
  assert.match(moveTabsSource, /resolveFreshTabSelection\(\{[\s\S]*requestedTabIds: ids,[\s\S]*isEligible:[\s\S]*selection\.status !== 'ready'[\s\S]*nothing was moved/);
  assert.match(moveTabsSource, /await assertTabsStillMatchSpaceMove\(movedTabs, \{ windowBinding \}\)[\s\S]*checkpoint: \(\) => saveState\(\{ persistWindowState: false \}\)/);
  assert.match(source, /async function assertTabsStillMatchSpaceMove[\s\S]*tabs:listAll[\s\S]*currentUrl !== expectedUrl[\s\S]*current\.pinned[\s\S]*isGroupedTab\(current\)/);
  assert.match(source, /changeInfo:\s*\{[\s\S]*groupId: -1,[\s\S]*url: tab\.url,[\s\S]*title: tab\.title/);
  assert.match(source, /function assertMovedTabsCheckpointComplete[\s\S]*snapshotTabIdentityCount\(sourceSpaceId[\s\S]*snapshotTabIdentityCount\(targetSpaceId[\s\S]*snapshotTabIdentityCount\('', binding\.snapshotTabId\)/);
  assert.match(moveTabsSource, /restoreChromeGroupMutationAfterFailure\(rollback, \{ windowBinding \}\)[\s\S]*finishMoveToSpace\(spaceId, \{[\s\S]*stateLocked: true,[\s\S]*windowBinding,[\s\S]*\}\)[\s\S]*committedMoveActivationError/);
  assert.match(finishMoveSource, /const activated = await activateSpace\([\s\S]*activated !== true[\s\S]*destination Space was not opened/);
  assert.match(source, /function reportMoveSuccess\(message\)[\s\S]*setStatus\(message\)[\s\S]*showStatusToast\(message, 'success'\)/);
  assert.match(source, /async function moveSelectedTabsToSpace\(tabIds, spaceId, options = \{\}\)[\s\S]*moveTabsToSpace\(tabIds, spaceId, options\)[\s\S]*reportMoveSuccess\(`Moved \$\{moved\} selected tabs to \$\{spaceName\(spaceId\)\}\.`\)/);
  assert.match(source, /async function moveGroupToSpace\(group, spaceId, options = \{\}\)[\s\S]*checkpointMovedGroupsToSpace\(\[group\], spaceId, \{ windowBinding \}\)[\s\S]*reportMoveSuccess\(`Moved group/);
  assert.match(source, /async function moveFolderGroupToSpace\(folderContext, spaceId, options = \{\}\)[\s\S]*checkpointMovedGroupsToSpace\(groups, spaceId, \{ windowBinding \}\)[\s\S]*reportMoveSuccess\(`Moved group/);
  assert.match(moveGroupsSource, /state\.spaces\.some\(\(space\) => space\.id === spaceId\)[\s\S]*destination Space no longer exists[\s\S]*captureChromeGroupMutationRollback\(\)[\s\S]*runChromeGroupMutationTransaction\([\s\S]*apply: \(\) => moveGroupsWithoutSaving[\s\S]*checkpoint: \(\) => saveState\(\{ persistWindowState: false \}\)[\s\S]*rollback: \(\) => restoreChromeGroupMutationAfterFailure\(rollback, \{[\s\S]*windowBinding: options\.windowBinding,[\s\S]*\}\)[\s\S]*await activateSpace[\s\S]*committedMoveActivationError/);
  assert.match(moveGroupsSource, /const activated = await activateSpace\([\s\S]*activated !== true[\s\S]*destination Space was not opened/);
  assert.match(source, /function moveGroupsWithoutSaving[\s\S]*transferSnapshotGroupsBetweenSpaces\([\s\S]*snapshotGroupIds:[\s\S]*snapshotTabIds:/);
  assert.match(source, /function moveGroupsWithoutSaving[\s\S]*remapSnapshotGroupOrderKeys\([\s\S]*beforeSnapshot: sourceSnapshotBefore[\s\S]*remapSnapshotGroupOrderKeys\([\s\S]*beforeSnapshot: targetSnapshotBefore/);
  assert.match(source, /function moveGroupsWithoutSaving[\s\S]*state\.tabLifecycle\[tabId\] = \{ \.\.\.binding, spaceId \}/);
});

test('tab replacement preserves durable identity without retaining obsolete automatic-discard code', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const replacementHelper = await readFile(
    new URL('../src/shared/tab-replacement.js', import.meta.url),
    'utf8',
  );
  const persistAskSource = functionSource(source, 'persistAskMessage');

  assert.doesNotMatch(source, /function (?:discardInactiveTabsInSpace|discardRestoredTabs|canAutoCloseTab)\b/);
  assert.match(source, /chrome\.tabs\.onReplaced\?\.addListener\(handleChromeTabReplaced\)/);
  assert.match(source, /function handleChromeTabReplaced[\s\S]*state = reduceTabLifecycleEvent\([\s\S]*type: 'replaced'[\s\S]*applyPanelTabIdReplacement\(addedTabId, removedTabId, immediateTab\)/);
  assert.match(source, /async function reconcileChromeTabReplacement[\s\S]*capturePanelWindowBinding\(\)[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage\(\{ windowBinding \}\)[\s\S]*type: 'replaced'[\s\S]*restoreInFlightAskMessages\(\)[\s\S]*await saveState\(\{ persistWindowState: false, windowBinding \}\)/);
  assert.match(source, /function restoreInFlightAskMessages[\s\S]*activeAskStreams\.values\(\)[\s\S]*if \(stream\?\.finished\) continue;[\s\S]*updateAskSessionMessage\(session, ref\.messageId, stream\.text \|\| 'Thinking\.\.\.'\)/);
  assert.match(persistAskSource, /syncStateFromStorage\(\)[\s\S]*replayAskMessageTabReplacements\(ref\)[\s\S]*updateAskSessionMessage\(latestSession, ref\.messageId, text\)[\s\S]*saveState\(\{ persistWindowState: false \}\)/);
  assert.match(source, /function replayAskMessageTabReplacements[\s\S]*replayAskSessionTabReplacements\([\s\S]*ref\?\.tabReplacements[\s\S]*state\.activeAskSessionKey = activeAskSessionKey/);
  assert.match(source, /import \{ migratePanelTabIdReplacement \} from '\.\/src\/shared\/tab-replacement\.js'/);
  assert.match(source, /function applyPanelTabIdReplacement[\s\S]*migratePanelTabIdReplacement\([\s\S]*state\.askSessions = migrated\.askSessions[\s\S]*activeAskStreams\.clear\(\)[\s\S]*if \(migrated\.dragInvalidated\)[\s\S]*clearDragState\(\)[\s\S]*setStatus\(/);
  assert.match(source, /function applyPanelTabIdReplacement[\s\S]*tabs = migrated\.tabs[\s\S]*foreignLiveTabs = migrated\.foreignLiveTabs[\s\S]*if \(migrated\.visibleTabsChanged\) render\(\)/);
  assert.match(replacementHelper, /export function migratePanelTabIdReplacement[\s\S]*replaceSelectionTabId[\s\S]*rebindAskSessionsForTabReplacement/);
  assert.match(replacementHelper, /dragInvalidated:[\s\S]*migrateActiveAskStreams/);
});

test('Chrome group mutations and Auto Group Undo rollback browser side effects before reporting failure', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const helper = await readFile(new URL('../src/shared/chrome-group-transaction.js', import.meta.url), 'utf8');
  const autoGroupRollbackSource = functionSource(source, 'restoreAutoGroupUndoAfterFailure');
  const captureLiveSource = functionSource(source, 'captureLiveOrganization');
  const autoGroupSource = functionSource(source, 'autoGroupTabs');

  assert.match(source, /from '\.\/src\/shared\/chrome-group-transaction\.js'/);
  assert.match(source, /captureChromeGroupMutationMemory,[\s\S]*captureChromeGroupTitleRollback,[\s\S]*captureTabGroupMembership,[\s\S]*projectChromeGroupRollbackMemory,[\s\S]*resolveChromeGroupIdReplacement/);
  assert.match(source, /function captureChromeGroupMutationRollback[\s\S]*captureChromeGroupMutationMemory\(\{/);
  assert.match(source, /function rememberChromeGroupTitleRollback[\s\S]*captureChromeGroupTitleRollback\(rollback\.titles, group\)/);
  assert.match(source, /function restoreChromeGroupMutationMemory\(rollback, groupIdReplacements = new Map\(\)\)[\s\S]*projectChromeGroupRollbackMemory\(rollback, groupIdReplacements\)/);
  assert.match(source, /function restoreChromeGroupMutationAfterFailure[\s\S]*restoreTabGroupMembership\(rollback\.membership,[\s\S]*replacements\)[\s\S]*resolveChromeGroupIdReplacement\(title\.groupId, replacements\)[\s\S]*groupId: restoredGroupId[\s\S]*restoreChromeGroupMutationMemory\(rollback, replacements\)[\s\S]*persistRestoredState === true[\s\S]*saveState\(\{ persistWindowState: false \}\)/);
  assert.match(helper, /export function projectChromeGroupRollbackMemory\(snapshot, groupIdReplacements = new Map\(\)\)[\s\S]*remapChromeGroupBindings\(state, groupIdReplacements\)[\s\S]*remapLogicalChromeGroupTitles\([\s\S]*groupIdReplacements/);
  assert.match(captureLiveSource, /buildSpaceViewForSpace\(spaceId\)[\s\S]*view\.flatMap[\s\S]*captureTabGroupMembership\(tabs, groups, tabIds\)\.tabs/);
  assert.doesNotMatch(captureLiveSource, /candidates|pinned/);
  assert.match(source, /function buildSpaceViewForSpace[\s\S]*includeUngrouped: true/);
  assert.match(autoGroupSource, /const beforeLive = captureLiveOrganization\(sourceSpaceId\)[\s\S]*rollback\.membership = captureTabGroupMembership\([\s\S]*beforeLive\.tabs\.map\(\(tab\) => tab\.tabId\)/);
  assert.doesNotMatch(autoGroupSource, /captureTabGroupMembership\(\s*tabs,\s*groups,\s*(?:candidateById|organization\.candidates)/);
  assert.doesNotMatch(source, /logicalChromeGroupTitles\.get\(nextGroupId\) \|\|/);
  assert.match(source, /async function renameGroup\([\s\S]*runChromeGroupMutationTransaction\([\s\S]*restoreChromeGroupMutationAfterFailure/);
  assert.match(source, /async function groupSelectedTabs\([\s\S]*captureTabGroupMembership\([\s\S]*runChromeGroupMutationTransaction/);
  assert.match(source, /async function groupSelectedTabs\([\s\S]*resolveFreshTabSelection\([\s\S]*selection\.status !== 'ready'[\s\S]*nothing was grouped/);
  assert.match(source, /async function groupSelectedTabs\([\s\S]*rememberCreatedGroupTabOrder\(groupId, selectedTabs\)[\s\S]*checkpoint: \(\) => saveState\(\{ persistWindowState: false \}\)/);
  assert.match(source, /function rememberCreatedGroupTabOrder[\s\S]*removeTabFromSavedOrder\(tabId, spaceId\)[\s\S]*\[`group:\$\{numericGroupId\}`\] = uniqueKeys\(orderedIds\)/);
  assert.match(source, /async function moveTabsToSpace\([\s\S]*captureTabGroupMembership\([\s\S]*runChromeGroupMutationTransaction/);
  assert.match(source, /async function renameFolderGroup\([\s\S]*runChromeGroupMutationTransaction[\s\S]*rememberChromeGroupTitleRollback/);
  assert.match(source, /async function moveGroupBlockIntoContext\([\s\S]*runChromeGroupMutationTransaction[\s\S]*rememberChromeGroupTitleRollback/);
  assert.match(source, /async function moveGroupBlockBesideContext\([\s\S]*runChromeGroupMutationTransaction[\s\S]*rememberChromeGroupTitleRollback/);
  assert.match(source, /async function reorderTab\([\s\S]*targetNeedsBatchMaterialization[\s\S]*captureTabGroupMembership[\s\S]*runChromeGroupMutationTransaction[\s\S]*checkpoint: \(\) => saveState\(\{ persistWindowState: false \}\)/);
  assert.match(source, /planMixedTabDropOrder\(\{[\s\S]*targetTabs: targetGroup\.tabs,[\s\S]*beforeTab,[\s\S]*dropPlan\.status === 'stale'[\s\S]*projectSnapshotTabOrder\([\s\S]*dropPlan\.visibleTabs[\s\S]*anchorTabId: dropPlan\.anchorTabId,[\s\S]*edge: dropPlan\.edge/);
  assert.match(source, /if \(\(!tab\.dormant[\s\S]*\|\| tab\.dormant\) \{[\s\S]*dropTabBefore\(event, tab, groupKey\)/);
  assert.match(source, /import \{ planMixedTabDropOrder, tabOrderAfterDuplicate \} from '\.\/src\/shared\/tab-move\.js'/);
  assert.match(source, /projectSnapshotTabOrder,[\s\S]*projectSnapshotTabsRemoval/);
  assert.doesNotMatch(source, /planTabDropOrder/);
  assert.match(source, /async function undoLastOperation\([\s\S]*rollback\.live = captureLiveOrganization[\s\S]*restoreAutoGroupUndoAfterFailure/);
  assert.match(autoGroupRollbackSource, /const rollbackWindowOptions = \{[\s\S]*windowBinding: options\.windowBinding,[\s\S]*allowStaleWindowBinding: Boolean\(options\.windowBinding\)[\s\S]*\}/);
  assert.match(autoGroupRollbackSource, /runAutoGroupUndoRollback\(rollback, \{[\s\S]*restoreMemory: restoreChromeGroupMutationMemory,[\s\S]*restoreLiveOrganization: \(layout, spaceId\)[\s\S]*rollbackWindowOptions[\s\S]*saveState: \(\) => saveState\(\{ persistWindowState: false \}\)[\s\S]*refreshTabs: \(refreshOptions = \{\}\)[\s\S]*isCurrentPanelWindowBinding\(options\.windowBinding\)[\s\S]*loadTabs: \(loadOptions = \{\}\)[\s\S]*\.\.\.rollbackWindowOptions[\s\S]*render:/);
  assert.match(source, /async function restoreLiveOrganization[\s\S]*targetIds\.some\(\(tabId\) => !existingIds\.has\(tabId\)\)[\s\S]*if \(ungrouped\.missing\)[\s\S]*targetIds\.some\(\(tabId\) => !refreshedIds\.has\(tabId\)\)[\s\S]*restoreTabPositions\([\s\S]*rememberRestoredGroupTabOrder/);
  assert.match(source, /async function createChromeGroup[\s\S]*result\.groupId === null[\s\S]*async function addTabsToChromeGroup[\s\S]*result\.groupId === null/);
  assert.match(helper, /function restoreTabGroupMembership[\s\S]*addTabsToGroup[\s\S]*createGroup[\s\S]*operations\.moveTab[\s\S]*groupIdReplacements/);
  assert.match(helper, /export function captureChromeGroupTitleRollback[\s\S]*chromeGroupIdFromKey[\s\S]*chromeGroupId\(group\?\.id\)/);
  assert.match(helper, /export function resolveChromeGroupIdReplacement[\s\S]*replacement cycle/);
  assert.match(helper, /export function remapLogicalChromeGroupTitles[\s\S]*both map to/);
});

test('open Space snapshots are merged from the full live view including ungrouped tabs', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /function snapshotOpenSpace\(spaceId, options = \{\}\)[\s\S]*const view = buildSpaceViewForSpace\(spaceId, options\);[\s\S]*mergeOpenSpaceSnapshot\(snapshotRefreshView, storedSnapshot\)/);
});

test('durable tab lifecycle identity is wired through sidepanel snapshots and background events', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  assert.match(sidepanel, /from '\.\/src\/shared\/tab-lifecycle\.js'/);
  assert.match(sidepanel, /ensureSnapshotLifecycleIds\(/);
  assert.match(sidepanel, /bindLiveTabsToSnapshot\(/);
  assert.match(sidepanel, /resolveViewSnapshotGroupId\([\s\S]*group\.snapshotGroupId,[\s\S]*boundGroupIds/);
  assert.match(sidepanel, /function tabsWithLifecycleIdentity[\s\S]*lifecycleBindingMatchesPhysicalGroup\(tab, binding\)[\s\S]*snapshotGroupId: binding\.snapshotGroupId/);
  assert.match(sidepanel, /function viewWithSnapshotLifecycleIdentity[\s\S]*claimedSnapshotGroupIds[\s\S]*claimedSnapshotTabIds[\s\S]*claimViewSnapshotLifecycleId/);
  assert.match(sidepanel, /trackingMode: 'saved-target'/);
  assert.match(sidepanel, /trackingMode !== 'saved-target'/);
  assert.match(background, /from '\.\/src\/shared\/tab-lifecycle\.js'/);
  for (const eventName of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onDetached', 'onAttached', 'onReplaced']) {
    assert.match(background, new RegExp(`chrome\\.tabs\\.${eventName}\\?\\.addListener`));
  }
  for (const eventName of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved']) {
    assert.match(background, new RegExp(`chrome\\.tabGroups\\.${eventName}\\?\\.addListener`));
  }
  assert.match(background, /chrome\.runtime\.onStartup\?\.addListener\(\(\) => \{[\s\S]*scheduleLifecycleDrain\(\);[\s\S]*recoverAskStreamsAtWorkerStart\(\)/);
  assert.match(background, /reduceTabLifecycleEvent\(/);
  assert.match(background, /async function captureUpdatedLifecycleEvent[\s\S]*return captureReservedLifecycleEvent\(reserved, \(\) => withLifecycleStateLock\(async \(\) => \{[\s\S]*chrome\.storage\.session\.get\(WINDOW_STATE_KEY\)[\s\S]*chrome\.storage\.local\.get\(STORAGE_KEY\)[\s\S]*persistLifecycleJournalEntry\(/);
});

test('panel-managed tab removal is suppressed before Chrome closes the tab', async () => {
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');
  const removalSource = background.slice(
    background.indexOf('for (const tabId of ids)', background.indexOf('async function removeTabsPanelManaged')),
    background.indexOf('function lifecycleSuppressionKey'),
  );

  const suppressionWrite = removalSource.indexOf('await chrome.storage.session.set');
  const chromeRemoval = removalSource.indexOf('await chrome.tabs.remove');
  assert.ok(suppressionWrite >= 0);
  assert.ok(chromeRemoval > suppressionWrite);
  assert.match(removalSource, /await chrome\.storage\.session\.remove\(suppressionKey\)/);
});

test('Space and Tab renames compare reviewed targets and roll memory back on persistence failure', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const renameSpaceSource = functionSource(source, 'renameSpace');
  const renameTabSource = functionSource(source, 'renameTab');

  assert.match(source, /renameTargetReviewFingerprint,[\s\S]*reviewedRenameTargetIsCurrent,[\s\S]*from '\.\/src\/shared\/action-safety\.js'/);

  const spaceReview = renameSpaceSource.indexOf("renameTargetReviewFingerprint('space', space)");
  const spaceDialog = renameSpaceSource.indexOf('await askText');
  const spaceSync = renameSpaceSource.indexOf('await syncStateFromStorage');
  const spaceGuard = renameSpaceSource.indexOf('reviewedRenameTargetIsCurrent');
  const spaceCheckpoint = renameSpaceSource.indexOf('const beforeRename = captureWorkspaceMemoryCheckpoint()');
  const spaceBoundary = renameSpaceSource.indexOf('runDurableCommitBoundary({');
  const spaceWrite = renameSpaceSource.indexOf('current.name = clean');
  assert.ok(
    spaceReview >= 0 && spaceReview < spaceDialog &&
    spaceDialog < spaceSync && spaceSync < spaceGuard &&
    spaceGuard < spaceCheckpoint && spaceCheckpoint < spaceBoundary && spaceBoundary < spaceWrite,
    'a Space rename must bind the rendered name before the dialog and reject stale state before writing',
  );
  assert.match(renameSpaceSource, /if \(!current \|\| !reviewedRenameTargetIsCurrent[\s\S]*Nothing was changed/);
  assert.match(renameSpaceSource, /runDurableCommitBoundary\(\{[\s\S]*commit: async \(\) => \{[\s\S]*saved = await saveState\(\{ persistWindowState: false, windowBinding \}\)[\s\S]*saved !== true[\s\S]*rollbackBeforeCommit: \(\) => \([\s\S]*restoreWorkspaceMemoryCheckpoint\(beforeRename, \{ renderView: true \}\)[\s\S]*restoreCommittedMemory/);
  const spaceRollback = renameSpaceSource.match(
    /rollbackBeforeCommit: \(\) => \([\s\S]*?\),\s*afterCommit:/,
  )?.[0];
  assert.ok(spaceRollback);
  assert.doesNotMatch(spaceRollback, /saveState|storageSet|persistStoragePair/);

  const tabReview = renameTabSource.indexOf("renameTargetReviewFingerprint('tab', tab");
  const tabDialog = renameTabSource.indexOf('await askText');
  const tabRefresh = renameTabSource.indexOf('currentTabForMutation(tab)');
  const tabGuard = renameTabSource.indexOf('reviewedRenameTargetIsCurrent');
  const tabCheckpoint = renameTabSource.indexOf('const beforeRename = captureWorkspaceMemoryCheckpoint()');
  const tabBoundary = renameTabSource.indexOf('runDurableCommitBoundary({');
  const tabWrite = renameTabSource.indexOf('setLiveTabPanelTitle');
  assert.ok(
    tabReview >= 0 && tabReview < tabDialog &&
    tabDialog < tabRefresh && tabRefresh < tabGuard &&
    tabGuard < tabCheckpoint && tabCheckpoint < tabBoundary && tabBoundary < tabWrite,
    'a Tab rename must bind the rendered panel title before the dialog and reject stale state before writing',
  );
  assert.match(renameTabSource, /reviewedRenameTargetIsCurrent\([\s\S]*renamedTabs: state\.renamedTabs[\s\S]*Nothing was changed/);
  assert.match(renameTabSource, /runDurableCommitBoundary\(\{[\s\S]*commit: async \(\) => \{[\s\S]*saved = await saveState\(\{ persistWindowState: false, windowBinding \}\)[\s\S]*saved !== true[\s\S]*rollbackBeforeCommit: \(\) => \([\s\S]*restoreWorkspaceMemoryCheckpoint\(beforeRename, \{ renderView: true \}\)[\s\S]*afterCommit: async \(\) => \{[\s\S]*refreshed = await refreshTabs\(\{ windowBinding \}\)[\s\S]*refreshed !== true[\s\S]*after the Tab rename was saved[\s\S]*restoreCommittedMemory/);
  const tabRollback = renameTabSource.match(
    /rollbackBeforeCommit: \(\) => \([\s\S]*?\),\s*afterCommit:/,
  )?.[0];
  assert.ok(tabRollback);
  assert.doesNotMatch(tabRollback, /saveState|storageSet|persistStoragePair/);
});

test('window-bound saves report durable success once either storage transaction resolves', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const operationSafety = await readFile(
    new URL('../src/shared/operation-safety.js', import.meta.url),
    'utf8',
  );
  const saveSource = functionSource(source, 'saveState');

  assert.match(source, /commitWindowBoundWrite,[\s\S]*from '\.\/src\/shared\/operation-safety\.js'/);
  assert.match(saveSource, /if \(!persistWindowState\)[\s\S]*commitWindowBoundWrite\(\{[\s\S]*isCurrent: \(\) => isCurrentPanelWindowBinding\(windowBinding\)[\s\S]*write: \(\) => persistStorageStep\(\{[\s\S]*key: STORAGE_KEY,[\s\S]*value: stateForStorage\(\),[\s\S]*get: storageGet,[\s\S]*set: storageSet,[\s\S]*remove: storageRemove/);
  assert.doesNotMatch(saveSource, /storageSet\(\{ \[STORAGE_KEY\][\s\S]*return isCurrentPanelWindowBinding\(windowBinding\)/);
  assert.match(saveSource, /if \(!isCurrentPanelWindowBinding\(windowBinding\)\) return false;[\s\S]*await persistStoragePair\([\s\S]*if \(isCurrentPanelWindowBinding\(windowBinding\)\) \{[\s\S]*windowSpaceState = nextWindowSpaceState;[\s\S]*return true/);
  assert.doesNotMatch(saveSource, /await persistStoragePair\([\s\S]*if \(!isCurrentPanelWindowBinding\(windowBinding\)\) return false/);
  assert.match(operationSafety, /function commitWindowBoundWrite[\s\S]*if \(!isCurrent\(\)\) return false;[\s\S]*await write\(\);[\s\S]*return true/);
});

test('group hover preview only binds for collapsed tag groups', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /bindGroupPreview\(header,\s*groupPreviewGroupForFolder\(folder,\s*collapsed\)\)/);
  assert.match(source, /if \(!group\?\.collapsed \|\| !group\?\.tabs\?\.length\) return;/);
});

test('group hover preview waits two seconds before opening', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const bindSource = functionSource(source, 'bindGroupPreview');

  assert.match(source, /const GROUP_PREVIEW_OPEN_DELAY_MS = 2000;/);
  assert.match(source, /setTimeout\(\(\) => showGroupPreview\(anchor, group\), GROUP_PREVIEW_OPEN_DELAY_MS\)/);
  assert.match(bindSource, /trigger\.addEventListener\('focusin',[\s\S]*scheduleShowGroupPreview\(trigger, group\)/);
});

test('collapsed group preview has a truthful keyboard and accessibility contract', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const bindSource = functionSource(source, 'bindGroupPreview');
  const renderSource = functionSource(source, 'renderGroupPreviewContents');
  const itemSource = functionSource(source, 'createGroupPreviewItem');

  assert.match(bindSource, /aria-haspopup', 'dialog'/);
  assert.match(bindSource, /aria-controls', 'groupPreviewPopover'/);
  assert.match(bindSource, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowRight'[\s\S]*showGroupPreview\(trigger, group\)[\s\S]*group-preview-search-input/);
  assert.doesNotMatch(bindSource, /setAttribute\('aria-expanded'/);
  assert.match(source, /function closeGroupPreviewAndRestoreFocus[\s\S]*hideGroupPreview\(\)[\s\S]*returnFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.match(renderSource, /aria-label', `Search tabs in \$\{groupTitle\}`/);
  assert.match(renderSource, /role', 'listbox'/);
  assert.match(itemSource, /role', 'option'/);
  assert.match(itemSource, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
});

test('every Tag group exposes a real keyboard-operable disclosure button', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');
  const toggleGroupSource = source.match(
    /async function toggleGroup\(group, options = \{\}\)[\s\S]*?(?=\nasync function refreshMissingChromeGroupView)/,
  )?.[0];
  const toggleFolderSource = source.match(
    /async function toggleFolder\(folderKey, options = \{\}\)[\s\S]*?(?=\nfunction createGroupCard)/,
  )?.[0];
  assert.ok(toggleGroupSource);
  assert.ok(toggleFolderSource);

  assert.match(source, /function createGroupToggle\(group, title\)[\s\S]*document\.createElement\('button'\)[\s\S]*type = 'button'[\s\S]*aria-expanded/);
  assert.match(source, /createGroupCard\(group\)[\s\S]*createGroupToggle\(group, group\.displayTitle \|\| group\.title\)/);
  assert.match(source, /createFolderTabs\(group\)[\s\S]*createGroupToggle\(group, group\.displayTitle \|\| 'Tabs'\)/);
  assert.match(toggleGroupSource, /captureChromeGroupMutationRollback\(\)[\s\S]*groups:update[\s\S]*await saveState\(\{ persistWindowState: false \}\)[\s\S]*restoreChromeGroupMutationMemory\(rollback\)[\s\S]*restoring the Chrome group collapse state/);
  assert.match(source, /async function toggleGroup\([\s\S]*Group was \$\{action\}, but the panel could not refresh yet/);
  assert.match(toggleGroupSource, /await refreshTabsView\(\{ windowBinding \}\)[\s\S]*Group was \$\{action\}, but the panel could not refresh yet[\s\S]*await saveState\(\{ persistWindowState: false \}\)[\s\S]*panel refreshed, but the latest Space snapshot could not be saved/);
  assert.equal((toggleGroupSource.match(/if \(!result\.group\)/g) || []).length, 2);
  assert.match(toggleGroupSource, /chromeGroupMissing = true[\s\S]*refreshMissingChromeGroupView\(\{ windowBinding \}\)[\s\S]*The Space view was refreshed/);
  assert.match(toggleGroupSource, /rollbackGroupMissing = true[\s\S]*rollbackFailures\.push[\s\S]*if \(rollbackGroupMissing\)[\s\S]*refreshMissingChromeGroupView\(\{ windowBinding \}\)/);
  assert.match(functionSource(source, 'refreshMissingChromeGroupView'), /refreshTabsView\(\{[\s\S]*adopt: false,[\s\S]*reloadDormant: true,[\s\S]*windowBinding: options\.windowBinding,[\s\S]*\}\)/);
  assert.match(source, /async function toggleFolder\([\s\S]*captureChromeGroupMutationRollback\(\)[\s\S]*restoreChromeGroupMutationMemory\(rollback\)[\s\S]*restoreDisclosureFocus\('folder'/);
  assert.match(toggleFolderSource, /catch \(error\)[\s\S]*restoreDisclosureFocus\('folder', folderKey, options\.focusRestoreToken\)/);
  assert.match(toggleGroupSource, /catch \(error\)[\s\S]*currentDisclosureGroupKey\(group\)[\s\S]*options\.focusRestoreToken/);
  assert.match(source, /function handleFolderHeaderClick[\s\S]*disclosureFocusGuard\.capture[\s\S]*focusRestoreToken/);
  assert.match(source, /function handleGroupHeaderClick[\s\S]*disclosureFocusGuard\.capture[\s\S]*focusRestoreToken/);
  assert.match(source, /function restoreDisclosureFocus[\s\S]*folder-header[\s\S]*group-toggle[\s\S]*preventScroll: true/);
  assert.match(source, /function restoreDisclosureFocus[\s\S]*folder-direct-group[\s\S]*group-toggle/);
  assert.match(styles, /\.group-toggle:focus-visible/);
});

test('tab rows expose valid multi-select semantics and keyboard behavior', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const tabUtils = await readFile(new URL('../src/shared/tab-utils.js', import.meta.url), 'utf8');

  assert.match(source, /function configureTabListAccessibility[\s\S]*role', 'list'/);
  assert.match(source, /function createTabRow[\s\S]*role', 'listitem'[\s\S]*className = 'tab-main-button'[\s\S]*aria-pressed/);
  assert.match(source, /import \{[\s\S]{0,1800}isForeignWindowTab,[\s\S]{0,1800}tabRowPresentation,[\s\S]{0,1800}\} from '\.\/src\/shared\/tab-utils\.js'/);
  assert.match(source, /function createTabRow[\s\S]*const presentation = tabRowPresentation\(tab\)[\s\S]*escapeHtml\(presentation\.secondaryLabel\)[\s\S]*presentation\.ariaStateLabel[\s\S]*if \(!tab\.dormant && !presentation\.foreign\)/);
  assert.match(source, /const selected = !tab\.dormant && !presentation\.foreign && selectedTabIds\.has\(tab\.id\)/);
  assert.match(source, /row\.draggable = !tab\.dormant && !tab\.pinned && !presentation\.foreign/);
  assert.match(source, /if \(!tab\.dormant && !presentation\.foreign\) \{[\s\S]*showTabContextMenu/);
  assert.match(source, /function handleTabPrimaryKeydown[\s\S]*isContextMenuKey\(event\) && !tab\.dormant && !isForeignWindowTab\(tab\)[\s\S]*showTabContextMenu/);
  assert.match(source, /if \(!tab\.dormant && !tab\.pinned && !presentation\.foreign\) \{[\s\S]*startTabDrag/);
  assert.match(source, /if \(presentation\.foreignWindowTabId !== null\) \{[\s\S]*row\.dataset\.foreignWindowTabId = String\(presentation\.foreignWindowTabId\)[\s\S]*if \(presentation\.foreignWindowId !== null\) \{[\s\S]*row\.dataset\.foreignWindowId = String\(presentation\.foreignWindowId\)/);
  assert.equal((source.match(/row\.dataset\.foreignWindowTabId\s*=/g) || []).length, 1);
  assert.equal((source.match(/row\.dataset\.foreignWindowId\s*=/g) || []).length, 1);
  assert.doesNotMatch(source, /function isForeignWindowTab\(/);
  assert.match(tabUtils, /export function isForeignWindowTab\(tab = \{\}\)[\s\S]*isNonNegativeInteger\(tab\?\.foreignWindowTabId\)/);
  assert.match(tabUtils, /export function tabRowPresentation\(tab = \{\}\)[\s\S]*open in another window[\s\S]*saved tab[\s\S]*Open in another window/);
  assert.match(source, /function handleTabPrimaryKeydown[\s\S]*event\.target !== primary[\s\S]*event\.key !== ' '[\s\S]*event\.key !== 'Spacebar'[\s\S]*updateTabSelection\([\s\S]*additive: !event\.shiftKey[\s\S]*range: event\.shiftKey/);
  assert.match(source, /focusRenderedTabPrimary\(tab\.id\)/);
  assert.match(source, /renameButton\.disabled = Boolean\(tab\.pinned\)[\s\S]*closeButton\.disabled = Boolean\(tab\.pinned\)/);
  assert.match(source, /async function renameTab\(tab, options = \{\}\)[\s\S]*if \(tab\?\.pinned\)/);
  assert.match(source, /async function closeTab\(tab,[\s\S]*if \(tab\?\.pinned\)/);
  assert.match(source, /function showTabContextMenu[\s\S]*if \(tab\.pinned\)[\s\S]*Pinned tabs stay open[\s\S]*menuAction\('Duplicate'[\s\S]*return/);
  assert.match(source, /async function duplicateTab[\s\S]*sourceMissing = result\.missing === true[\s\S]*refreshTabs\(\{ reloadDormant: true, windowBinding \}\)[\s\S]*That tab is no longer open\. The Space view was refreshed\./);
  assert.match(source, /async function duplicateTab[\s\S]*restoredGroupId = await addTabsToChromeGroup[\s\S]*if \(restoredGroupId === null\)[\s\S]*could not keep the duplicated tab in its original group/);
  assert.match(source, /async function duplicateTab[\s\S]*activeTabIdBeforeDuplicate = await currentActiveBrowserTabId\(\{ windowBinding \}\)[\s\S]*catch \(error\)[\s\S]*duplicated\?\.id[\s\S]*send\('tabs:focus', \{ tabId: activeTabIdBeforeDuplicate \}, \{[\s\S]*windowBinding,[\s\S]*allowStaleWindowBinding: true,[\s\S]*\}\)\.catch/);
  assert.match(source, /async function currentActiveBrowserTabId\(options = \{\}\)[\s\S]*targetWindowId = options\.windowBinding\?\.windowId \?\? panelWindowId[\s\S]*chrome\.tabs\.query\(\{[\s\S]*active: true,[\s\S]*windowId: targetWindowId/);
  assert.match(source, /async function duplicateTab[\s\S]*await refreshTabs\(\{ windowBinding \}\);[\s\S]*Duplicated tab, but the panel could not refresh yet[\s\S]*showStatusToast\(message, 'error'\)[\s\S]*const message = 'Duplicated tab\.'[\s\S]*setStatus\(message\)[\s\S]*showStatusToast\(message, 'success'\)/);
  assert.match(source, /row\.draggable = !tab\.dormant && !tab\.pinned/);
  assert.match(source, /function startTabDrag[\s\S]*if \(tab\?\.pinned\)[\s\S]*Unpin this tab in Chrome/);
  assert.match(source, /async function reorderTab[\s\S]*if \(tab\.pinned\)[\s\S]*pinned while dragging/);
  assert.match(source, /async function reorderTab[\s\S]*const ungrouped = await send\('tabs:ungroup'[\s\S]*if \(ungrouped\.missing\)[\s\S]*No order change was saved/);
  assert.match(source, /requestedContextTabIds[\s\S]*excludedPinnedCount[\s\S]*pinned tab[^`]*left out/);
});
