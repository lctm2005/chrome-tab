import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

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
  assert.equal(manifest.commands._execute_action.suggested_key.mac, 'Alt+S');
  assert.equal(manifest.commands._execute_action.description, 'Toggle Space');
  assert.equal(manifest.content_scripts, undefined);
  for (const permission of ['sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting', 'favicon']) {
    assert.ok(manifest.permissions.includes(permission), `missing ${permission}`);
  }
  assert.equal(manifest.permissions.includes('activeTab'), false);
  assert.equal(manifest.permissions.includes('bookmarks'), false);
  assert.equal(manifest.permissions.includes('downloads'), false);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  assert.ok(manifest.optional_host_permissions.includes('http://*/*'));
  for (const size of ['16', '32', '48', '128']) {
    assert.equal(manifest.icons[size], `icons/icon${size}.png`);
    assert.equal(manifest.action.default_icon[size], `icons/icon${size}.png`);
    await access(new URL(`../icons/icon${size}.png`, import.meta.url));
  }
});

test('settings expose provider and model selectors without prefilled free text model fallback', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(html, /<select id="providerInput"/);
  assert.match(html, /<select id="modelInput"/);
  assert.match(html, /id="customModelInput"/);
  assert.match(source, /AI_PROVIDER_CATALOG/);
  assert.match(source, /selectedModelFromForm\(/);
  assert.doesNotMatch(source, /model:\s*els\.modelInput\.value\.trim\(\)\s*\|\|\s*'glm-5\.1'/);
});

test('sidepanel exposes Ask Space and portable backup controls without Context or Summary UI', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  for (const id of ['askScope', 'askProvider', 'askSourceSummary', 'askSourceList', 'exportSpaceDataButton', 'spaceBackupInput', 'restoreSpaceDataButton']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(source, /createPrompt\('ask-space'/);
  assert.match(source, /startAskFromUserGesture/);
  assert.match(source, /requestAskPermissionsFromUserGesture/);
  assert.match(source, /chrome\.permissions\.request\(\{ origins \}\)/);
  assert.match(source, /send\('pages:extract'/);
  assert.match(source, /title: 'Confirmed sources not sent'/);
  assert.match(source, /additional selected[\s\S]*excluded by the 12-page limit/);
  assert.match(source, /stored text from \$\{history\.length\} recent conversation/);
  assert.match(source, /generated Sources appendices excluded/);
  const recentHistorySource = source.slice(
    source.indexOf('function recentAskHistory'),
    source.indexOf('async function beginAskTurn'),
  );
  assert.match(recentHistorySource, /split\(\/\\n\\n### Sources\\n\/i\)\[0\]/);
  assert.doesNotMatch(recentHistorySource, /replace\(\/\\\[\\d\+\\\]\//);
  assert.match(source, /updateAskMessage\(stream\.messageRef, stream\.text \|\| 'Thinking\.\.\.', \{ persist: false \}\)/);
  assert.match(source, /async function persistAskMessage[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage/);
  assert.match(background, /case 'pages:extract'/);
  assert.doesNotMatch(background, /case 'page:(?:extract|outline)'/);
  assert.match(background, /reason: 'content-limit'/);
  assert.match(background, /if \(event\.done\)[\s\S]*reader\.cancel/);
  assert.match(source, /createSpaceBackup\(state\)/);
  assert.match(source, /restoreSpaceBackup\(state, pendingSpaceBackup\)/);
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
    'onboardingThinkingInput',
    'onboardingTestAIButton',
    'onboardingSkipAIButton',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="(?:maxTokensInput|onboardingMaxTokensInput)"|Max output/i);
  assert.match(source, /const workbenchMode = layoutMode === 'workbench'/);
  assert.match(html, /id="onboardingOpenWorkbenchButton" disabled>Save AI &amp; start</);
  assert.doesNotMatch(html, /Stay in side panel|id="onboardingStayButton"/);
  assert.match(source, /maybeShowOnboarding\(\)/);
  assert.match(source, /rememberArcImport\(/);
  assert.match(source, /url\.searchParams\.set\('layout', 'workbench'\)/);
  assert.match(source, /send\('tabs:openUnique'/);
  assert.match(source, /state\.onboarding\?\.completed === true/);
  assert.match(source, /addEventListener\('keydown', handleDocumentKeydown, \{ capture: true \}\)/);
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
  assert.match(source, /function arcPlanResolutionSignature[\s\S]*preview\.sourceSpaceId,[\s\S]*preview\.resolvedId,[\s\S]*preview\.resolvedName/);
  assert.match(source, /async function importArcFile[\s\S]*arcPlanResolutionSignature\(pendingArcImportPlan\) !== arcPlanResolutionSignature\(latestPlan\)[\s\S]*previewInvalidated = true/);
  assert.match(source, /state\.onboarding = \{ version: 2, completed: false, stage: 'ai' \}/);
  assert.match(source, /state\.onboarding = \{ version: 2, completed: true, stage: 'done' \}/);
  assert.match(source, /saveOnboardingAIAndFinish[\s\S]*secretSet\(\{ \[SECRET_STORAGE_KEY\]: \{ ai: \{ apiKey: state\.ai\.apiKey \} \} \}\)/);
  assert.match(source, /function stateForStorage\(\)[\s\S]*apiKey: ''/);
  assert.doesNotMatch(html, /Cross-Space Search/i);
  assert.doesNotMatch(source, /workspace-search/);
});

test('Workbench setup and Space switching preserve the Workbench surface', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /runOnboardingButton[\s\S]*activeView = workbenchMode \? 'ask' : 'space';[\s\S]*openOnboarding\(\{ restart: true \}\)/);
  assert.match(source, /async function switchSpace\(spaceId\)[\s\S]*preserveBrowserFocus = workbenchMode/);
  assert.match(source, /ensureSwitchKeepAliveTab\(spaceId, previousSpaceId, \{ preserveBrowserFocus \}\)/);
  assert.match(source, /if \(!preserveBrowserFocus\) \{[\s\S]*focusFirstTabInSpace/);
  assert.match(source, /closeTabsOutsideActiveSpace\(\{ preserveBrowserFocus \}\)/);
});

test('settings Save click prevents dialog submit before async work starts', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /saveSettingsButton\.addEventListener\('click',\s*\(event\)\s*=>\s*\{\s*event\.preventDefault\(\);[\s\S]*?runTask\(\(\)\s*=>\s*saveSettings\(\)\)/,
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

  assert.match(source, /actionButton\('×', 'Remove saved tab', \(\) => removeDormantTab\(tab, groupKey\)\)/);
});

test('opening a dormant tab preserves its panel-only name on the new live tab', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /preserveDormantPanelName\(tab,\s*tabId\)/);
  assert.match(source, /state\.renamedTabs\[tabId\]\s*=\s*name/);
});

test('sidepanel prunes saved snapshot entries for closed or navigated live tabs', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /removeStaleActiveSpaceTabsFromSnapshot\(previousTabs, contentTabs, \{\s*skipTabIds: skipSnapshotCleanupForTabIds/);
  assert.match(source, /Reserve surviving browser-tab identities before matching duplicate URLs/);
  assert.match(source, /Number\(current\.tab\.id\) === Number\(previous\.tab\.id\)/);
  assert.match(source, /current\.urlIdentity === previous\.urlIdentity/);
  assert.match(source, /groupTitle: previousGroup\?\.title/);
  assert.match(source, /function matchDormantTabsToLiveTabs[\s\S]*\['exact', 'recently-opened', 'navigation-fallback'\]/);
  assert.match(source, /if \(entry\.consumed\) return false/);
  assert.match(source, /function removeDormantSnapshotTabsForOpenTabs[\s\S]*removeSnapshotTabs\(snapshot, targets\)/);
  assert.match(source, /const navigationUrlKeys = uniqueKeys\(recentlyOpenedUrlIdentities\.map\(comparableSnapshotUrl\)\)/);
  assert.match(source, /skipSnapshotCleanupForTabIds: \[tab\.id\]/);
  const closeSource = source.slice(
    source.indexOf('async function closeTab('),
    source.indexOf('async function removeDormantTab('),
  );
  assert.ok(closeSource.indexOf("await send('tabs:close'") < closeSource.indexOf('removeClosedTabFromSnapshot'));
  assert.match(source, /function snapshotUrlIdentity\(url\)[\s\S]*String\(url \|\| ''\)\.trim\(\)/);
});

test('tabs list requests are scoped to the side panel window when possible', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  assert.match(sidepanel, /panelWindowId\s*=\s*await currentPanelWindowId\(\)/);
  assert.match(sidepanel, /type === 'tabs:list'[\s\S]*windowId: panelWindowId/);
  assert.match(background, /case 'tabs:list':\s*return listTabs\(message\.windowId\)/);
  assert.match(background, /message\.preferredTabId[\s\S]*sender\.tab\?\.id/);
  assert.match(background, /chrome\.tabs\.query\(query\)/);
  assert.match(background, /ownExtensionPrefix = chrome\.runtime\.getURL\(''\)/);
  assert.match(background, /tabUrl\(tab\)\.startsWith\(ownExtensionPrefix\)/);
  assert.match(background, /tab\.pendingUrl \|\| tab\.url/);
});

test('sidepanel refresh adopts orphan groups without overwriting newer Workbench state', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /adoptGroups:\s*Boolean\(options\.adoptGroups\s*\?\?\s*options\.adopt\)/);
  assert.match(source, /setInterval\(\(\) => void refreshSharedState\(\), 2500\)/);
  assert.match(source, /async function refreshSharedState\(\)[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage\(\)[\s\S]*refreshTabs\(\{ adopt: true \}\)/);
  assert.match(source, /navigator\.locks\.request\(SHARED_STATE_LOCK_NAME/);
  assert.match(source, /async function withFreshSpaceStateMutation\(task\)[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage\(\)[\s\S]*loadTabs\(\{ adopt: false \}\)[\s\S]*loadDormantSpaceView/);
  assert.match(source, /async function focusTab\(tab, options = \{\}\)[\s\S]*withFreshSpaceStateMutation/);
  assert.match(source, /async function addSpace\(\)[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage\(\)[\s\S]*state\.spaces\.push\(space\)[\s\S]*await saveState\(\)[\s\S]*activateSpace\(space\.id, \{ stateLocked: true \}\)/);
  assert.match(source, /let taskQueue = Promise\.resolve\(\)/);
  assert.match(source, /function runTask\(task\)[\s\S]*activeTaskCount \+= 1[\s\S]*taskQueue\.then\(execute, execute\)[\s\S]*taskQueue = queuedTask\.catch/);
  assert.doesNotMatch(source, /function runTask\(task\)[\s\S]*syncStateFromStorage\(\)[\s\S]*function withSharedStateLock/);
  assert.match(source, /async function init\(\)[\s\S]*withSharedStateLock\(async \(\) => \{[\s\S]*loadState\(\{ stateLocked: true \}\)[\s\S]*refreshTabs\(\{ adopt: true \}\)/);
  assert.match(source, /async function addAskMessage[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage[\s\S]*await saveState/);
  assert.match(source, /async function updateAskMessage[\s\S]*await persistAskMessage\(ref, text\)/);
  assert.match(source, /function startAskFromUserGesture\(\)[\s\S]*if \(activeAIRequestId\) \{[\s\S]*void abortActiveAIRequest\(\)/);
  assert.match(source, /async function tidyTabNames\(options = \{\}\)[\s\S]*sourceSpaceId[\s\S]*withSharedStateLock[\s\S]*active Space changed while Tidy Names was open/);
  assert.match(source, /async function autoGroupTabs\(options = \{\}\)[\s\S]*sourceSpaceId[\s\S]*withSharedStateLock[\s\S]*Tabs changed while Auto Group was open/);
  assert.match(source, /async function importArcFile\(\)[\s\S]*withSharedStateLock[\s\S]*createArcImportPlan\(pendingArcImportText, \{ existingSpaces: state\.spaces \}\)/);
});

test('folder drag before or after reparents groups beside the target', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /moveGroupBlockBesideContext\(sourceKeys, targetContext, intent, moveOptions\)/);
  assert.match(source, /targetPathForSiblingMove\(targetContext\)/);
  assert.match(source, /movedGroupTitleForFolderDrop\(/);
});

test('single tab context menu can create a tab group', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /menuAction\(contextTabIds\.length === 1 \? 'Group tab' : `Group \$\{contextTabIds\.length\} selected tabs`/);
  assert.match(source, /groupSelectedTabs\(contextTabIds\)/);
  assert.match(source, /if \(ids\.length === 0\)/);
  assert.match(source, /if \(selectedTabs\.length === 0\)/);
  assert.doesNotMatch(source, /Select at least two tabs/);
});

test('single tab context menu can update the saved URL for a persistent tab', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /menuAction\('Update Saved URL', \(\) => updateSavedTabUrl\(tab\)\)/);
  assert.match(source, /function updateSavedTabUrl\(tab, options = \{\}\)/);
  assert.match(source, /updateSnapshotTab\(/);
});

test('tidy names uses AI when configured without overwriting manual names', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /parseTidyNames/);
  assert.match(source, /createPrompt\('tidy-names'/);
  assert.match(source, /const aiSettings = structuredClone\(state\.ai\)/);
  assert.match(source, /existingNames:\s*state\.renamedTabs/);
  assert.match(source, /preserveExisting:\s*true/);
});

test('Tidy Names and Auto Group preview changes before applying them', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /const TIDY_NAMES_ICON = `[\s\S]*m12 3-1\.912 5\.813[\s\S]*`;/);
  assert.doesNotMatch(source, /🧹|tidy-icon/);
  assert.match(source, /title: 'Preview Tidy Names'/);
  assert.match(source, /title: 'Rename in panel'/);
  assert.match(source, /type: 'tidy-names'/);
  assert.doesNotMatch(source, /duplicateTabIds/);
  assert.match(source, /buildOrganizationCandidates/);
  assert.match(source, /isPageShortcutCapableUrl\(tab\.url\)/);
  assert.match(source, /candidate\.currentGroup\?\.title/);
  assert.match(source, /title: 'Auto Group Preview'/);
  assert.match(source, /title: 'Remain untouched'/);
  assert.match(source, /title: 'Untouched'/);
  assert.match(source, /variant: 'groups'/);
  assert.match(source, /AI returned no valid groups/);
  assert.match(source, /applyOrganizationPlanToSnapshot/);
  assert.match(source, /type: 'auto-group'/);
  assert.match(source, /No live or saved http\(s\) tabs are available to organize/);
  assert.match(source, /extensionRuntime && candidates\.length > 0 && providerRequiresApiKey/);
  assert.match(source, /async function autoGroupTabs\(options = \{\}\)[\s\S]*beginPanelAction\('autoGroup'\);\s*try \{\s*await refreshOrganizationActionState\(\{ adopt: true \}\)/);
  assert.match(source, /async function refreshOrganizationActionState[\s\S]*await syncStateFromStorage\(\);[\s\S]*await loadDormantSpaceView\(state\.activeSpaceId, \{ force: true \}\)/);
  assert.match(source, /showStatusToast\(message, 'error'\)/);
  assert.doesNotMatch(source, /Auto Group needs[\s\S]{0,200}openWorkbench/);
  assert.doesNotMatch(source, /plannedGroups\.length === 0\) plannedGroups = planTidyGroups/);
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
  assert.match(source, /function startTidyNamesFromUserGesture\(\)[\s\S]*prepareTidyNamesRequestFromUserGesture\(\)[\s\S]*tidyTabNames\(request\)/);
  assert.match(tidySource, /tidyTabNamesWithAI\(aiCandidates, \{[\s\S]*permissionRequest: permissionRequested \? permissionRequest : null,[\s\S]*settings: aiSettings/);
  assert.match(tidySource, /tidyTabNamesWithAI\([\s\S]*showPlanPreview\(\{/);
  assert.match(tidySource, /title: 'Preview Tidy Names'/);
  assert.match(tidySource, /message: `\$\{renameItems\.length\} [\s\S]*formatPreviewDuration/);
  assert.match(source, /async function tidyTabNamesWithAI[\s\S]*options\.permissionRequest \|\| ensureAIHostPermission\(settings\)[\s\S]*send\('ai:chat', \{\s*settings,/);
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

test('merged Space view hides only empty snapshot shadows of live groups', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const mergeSource = source.slice(
    source.indexOf('function mergeDormantSpaceView(liveView, dormantView)'),
    source.indexOf('function matchDormantTabsToLiveTabs'),
  );

  assert.match(mergeSource, /const liveGroupsByTitle = new Map\(\)/);
  assert.match(mergeSource, /const matchingLiveGroup = liveGroupsByTitle\.get\(groupTitleKey\(group\.title\)\)/);
  assert.match(mergeSource, /if \(dormantGroup\.tabs\.length === 0\)[\s\S]*if \(!matchingLiveGroup && !isUngroupedSnapshotGroup\(dormantGroup\)\)[\s\S]*dormantGroups\.push\(dormantGroup\)/);
  assert.match(mergeSource, /if \(matchingLiveGroup\) \{\s*matchingLiveGroup\.tabs\.push\(\.\.\.dormantGroup\.tabs\)/);
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

  assert.match(tidySource, /fingerprintTidyNameTargets\(currentTargets, state\.renamedTabs\)/);
  assert.ok(tidySource.indexOf('await refreshTabs();') < tidySource.indexOf('const operation = recordOperation({'));
  assert.ok(autoSource.indexOf('await refreshTabs({ reloadDormant: true });') < autoSource.indexOf('const operation = recordOperation({'));
  assert.match(autoSource, /assertLivePlannedGroupsApplied\(livePlannedGroups, sourceSpaceId\)/);
  assert.match(autoSource, /Chrome could not (?:apply|create) the proposed group/);
  assert.match(autoSource, /removeOperationRecord\(operationId\)/);
  assert.match(autoSource, /rollbackFailureError\(error, rollbackFailures\)/);
  assert.match(source, /await assertOperationUndoIsFresh\(operation\)/);
  assert.match(source, /type: 'restore-backup'[\s\S]*after: \{ portableFingerprint: fingerprintPortableWorkspaceContent\(state\) \}/);
  assert.match(source, /operation\?\.type === 'restore-backup'[\s\S]*fingerprintPortableWorkspaceContent\(state\) !== expectedFingerprint/);
  assert.match(source, /afterFingerprints: fingerprintPortableSpacesContent\(state, ids\)/);
  assert.match(source, /assertArcImportUndoIsFresh\(state\.lastArcImport\)/);
  assert.match(source, /snapshotHasPersistentContent\(snapshot\)/);
  assert.match(source, /function currentGroupForMutation[\s\S]*groupMutationFingerprint\(current\) !== groupMutationFingerprint\(reference\)/);
  assert.match(source, /function groupMutationFingerprint[\s\S]*url: snapshotUrlIdentity\(tab\?\.url\)/);
  assert.match(source, /currentContext\.fingerprint !== folderContext\.fingerprint/);
});

test('Arc import and backup restore preflight Chrome storage and restore memory on failure', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const restoreSource = source.slice(
    source.indexOf('async function restoreSpaceData()'),
    source.indexOf('function formatSpaceBackupSummary'),
  );
  const arcSource = source.slice(
    source.indexOf('async function applyArcOnboarding()'),
    source.indexOf('async function finishOnboarding'),
  ) + source.slice(
    source.indexOf('async function importArcFile()'),
    source.indexOf('function rememberArcImport'),
  );

  assert.match(source, /function assertCurrentStateFitsStorage[\s\S]*assertWorkspaceStorageBudget/);
  assert.match(restoreSource, /const beforeState = structuredClone\(state\)/);
  assert.ok(restoreSource.indexOf('assertCurrentStateFitsStorage();') < restoreSource.indexOf('await saveState();'));
  assert.match(restoreSource, /catch \(error\)[\s\S]*restoreFailedWorkspaceMutation\(beforeState\)/);
  assert.equal((arcSource.match(/assertCurrentStateFitsStorage\(\);/g) || []).length, 2);
  assert.equal((arcSource.match(/restoreFailedWorkspaceMutation\(beforeState\)/g) || []).length, 2);
});

test('Move to context actions render as a right-side submenu', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');

  assert.match(source, /moveToSpaceSubmenu\(\(space\) => \(/);
  assert.match(source, /moveSelectedTabsToSpace\(contextTabIds, space\.id\)/);
  assert.match(source, /moveTabToSpace\(tab, space\.id\)/);
  assert.match(source, /moveToSpaceSubmenu\(\(space\) => moveGroupToSpace\(group, space\.id\)\)/);
  assert.match(source, /moveToSpaceSubmenu\(\(space\) => moveFolderGroupToSpace\(folderContext, space\.id\)\)/);
  assert.match(source, /function menuSubmenu\(label, items\)/);
  assert.doesNotMatch(source, /menuLabel\('Move to'\)/);
  assert.doesNotMatch(source, /submenu-left/);
  assert.match(styles, /\.context-submenu-panel/);
  assert.match(styles, /left: calc\(100% \+ 6px\)/);
  assert.doesNotMatch(styles, /submenu-left/);
});

test('tab selection participates in the groups render signature', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /function groupsRenderSignature\(tabGroups, ungrouped\)[\s\S]*selectedTabIds:\s*\[\.\.\.selectedTabIds\]/);
});

test('moving tabs to another Space activates the target Space', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /async function moveTabsToSpace\(tabIds, spaceId, options = \{\}\)[\s\S]*removeTabsFromSpaceSnapshot\(sourceSpaceId, movedTabs\)/);
  assert.match(source, /async function moveTabsToSpace\(tabIds, spaceId, options = \{\}\)[\s\S]*await finishMoveToSpace\(spaceId, \{ stateLocked: true \}\);\s*return movedTabs\.length/);
  assert.match(source, /async function moveSelectedTabsToSpace\(tabIds, spaceId\)[\s\S]*setStatus\(`Moved \$\{moved\} selected tabs to \$\{spaceName\(spaceId\)\}\.`\)/);
  assert.match(source, /async function moveGroupToSpace\(group, spaceId, options = \{\}\)[\s\S]*moveGroupsWithoutSaving\(\[group\], spaceId\);\s*await finishMoveToSpace\(spaceId, \{ stateLocked: true \}\);\s*setStatus\(`Moved group/);
  assert.match(source, /async function moveFolderGroupToSpace\(folderContext, spaceId, options = \{\}\)[\s\S]*moveGroupsWithoutSaving\(groups, spaceId\);\s*await finishMoveToSpace\(spaceId, \{ stateLocked: true \}\);\s*setStatus\(`Moved group/);
});

test('open Space snapshots are merged from the full live view including ungrouped tabs', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /function snapshotOpenSpace\(spaceId\)[\s\S]*const view = buildSpaceViewForSpace\(spaceId\);\s*const snapshot = mergeOpenSpaceSnapshot\(view, state\.spaceSnapshots\[spaceId\]\)/);
});

test('group hover preview only binds for collapsed tag groups', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /bindGroupPreview\(header,\s*groupPreviewGroupForFolder\(folder,\s*collapsed\)\)/);
  assert.match(source, /if \(!group\?\.collapsed \|\| !group\?\.tabs\?\.length\) return;/);
});

test('group hover preview waits two seconds before opening', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /const GROUP_PREVIEW_OPEN_DELAY_MS = 2000;/);
  assert.match(source, /setTimeout\(\(\) => showGroupPreview\(anchor, group\), GROUP_PREVIEW_OPEN_DELAY_MS\)/);
  assert.match(source, /anchor\.addEventListener\('focusin', \(\) => scheduleShowGroupPreview\(anchor, group\)\)/);
});
