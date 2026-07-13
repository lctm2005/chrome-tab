import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('declares the Chrome MV3 side panel extension surface', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Space: Arc-like Workspaces for Chrome');
  assert.equal(manifest.short_name, 'Space');
  assert.equal(manifest.version, '0.5.1');
  assert.equal(manifest.name.includes('Arc Sidecar'), false);
  assert.equal(manifest.action.default_title.includes('Arc Sidecar'), false);
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.commands._execute_action.suggested_key.mac, 'Alt+S');
  assert.equal(manifest.commands._execute_action.description, 'Toggle Space');
  assert.equal(manifest.content_scripts, undefined);
  for (const permission of ['sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting', 'activeTab', 'favicon']) {
    assert.ok(manifest.permissions.includes(permission), `missing ${permission}`);
  }
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

  for (const id of ['askScope', 'exportSpaceDataButton', 'spaceBackupInput', 'restoreSpaceDataButton']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(source, /createPrompt\('ask-space'/);
  assert.match(source, /createSpaceBackup\(state\)/);
  assert.match(source, /restoreSpaceBackup\(state, pendingSpaceBackup\)/);
  assert.doesNotMatch(html, /id="contextView"|id="spaceContextInput"|id="summarizePageButton"/);
  assert.doesNotMatch(source, /currentSpaceContextForAI|summarizeCurrentPage/);
});

test('sidepanel exposes focused onboarding and full-page Workbench Settings', async () => {
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');

  for (const id of ['openWorkbenchButton', 'onboardingDialog', 'onboardingArcInput', 'undoArcImportButton']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(source, /const workbenchMode = layoutMode === 'workbench'/);
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
  assert.match(html, /class="arc-import-settings" hidden/);
  assert.doesNotMatch(html, /Cross-Space Search/i);
  assert.doesNotMatch(source, /workspace-search/);
});

test('Workbench setup and Space switching preserve the Workbench surface', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /runOnboardingButton[\s\S]*activeView = workbenchMode \? 'ask' : 'space';[\s\S]*openOnboarding\(\)/);
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

  assert.match(source, /removeStaleActiveSpaceTabsFromSnapshot\(previousTabs, contentTabs\)/);
  assert.match(source, /oldUrlKey && oldUrlKey !== nextUrlKey/);
  assert.match(source, /!currentUrlKeys\.has\(oldUrlKey\)/);
});

test('tabs list requests are scoped to the side panel window when possible', async () => {
  const sidepanel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');

  assert.match(sidepanel, /panelWindowId\s*=\s*await currentPanelWindowId\(\)/);
  assert.match(sidepanel, /type === 'tabs:list'[\s\S]*windowId: panelWindowId/);
  assert.match(background, /case 'tabs:list':\s*return listTabs\(message\.windowId\)/);
  assert.match(background, /openUniqueTab\(message\.url, message\.matchUrl, sender\.tab\?\.id\)/);
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
  assert.match(source, /async function addSpace\(\)[\s\S]*withSharedStateLock[\s\S]*syncStateFromStorage\(\)[\s\S]*state\.spaces\.push\(space\)[\s\S]*await saveState\(\)[\s\S]*activateSpace\(space\.id, \{ stateLocked: true \}\)/);
  assert.match(source, /async function runTask\(task\)[\s\S]*if \(extensionRuntime\) await syncStateFromStorage\(\)/);
  assert.match(source, /async function tidyTabNames\(\)[\s\S]*sourceSpaceId[\s\S]*withSharedStateLock[\s\S]*active Space changed while Tidy Names was open/);
  assert.match(source, /async function autoGroupTabs\(\)[\s\S]*sourceSpaceId[\s\S]*withSharedStateLock[\s\S]*Tabs changed while Auto Group was open/);
  assert.match(source, /async function importArcFile\(\)[\s\S]*withSharedStateLock[\s\S]*createArcImportPlan\(pendingArcImportText, \{ existingSpaces: state\.spaces \}\)/);
});

test('folder drag before or after reparents groups beside the target', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /moveGroupBlockBesideContext\(sourceKeys, targetContext, intent\)/);
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
  assert.match(source, /function updateSavedTabUrl\(tab\)/);
  assert.match(source, /updateSnapshotTab\(/);
});

test('tidy names uses AI when configured without overwriting manual names', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /parseTidyNames/);
  assert.match(source, /createPrompt\('tidy-names'/);
  assert.match(source, /state\.ai\.apiKey/);
  assert.match(source, /existingNames:\s*state\.renamedTabs/);
  assert.match(source, /preserveExisting:\s*true/);
});

test('Tidy Names and Auto Group preview changes before applying them', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /title: 'Preview Tidy Names'/);
  assert.match(source, /if \(!confirmed\) return;[\s\S]*for \(const tabId of duplicateTabIds\)/);
  assert.match(source, /tabBelongsToSpace\(tab, state\.activeSpaceId\)/);
  assert.match(source, /isPageShortcutCapableUrl\(tab\.url\)/);
  assert.match(source, /const regroupedCount = countPlannedRegroups\(plannedGroups, candidates, groups\)/);
  assert.match(source, /title: 'Auto Group Preview'/);
  assert.match(source, /source: regroup \? liveGroupsById\.get/);
  assert.match(source, /variant: 'groups'/);
  assert.match(source, /AI returned no valid groups/);
  assert.match(source, /Open saved tabs in this Space first, then run Auto Group\.[\s\S]*showStatusToast\(message, 'error'\)/);
  assert.match(source, /extensionRuntime && candidates\.length > 0 && providerRequiresApiKey/);
  assert.match(source, /async function autoGroupTabs\(\) \{\s*await syncAISettingsFromStorage\(\)/);
  assert.match(source, /showStatusToast\(message, 'error'\)/);
  assert.doesNotMatch(source, /Auto Group needs[\s\S]{0,200}openWorkbench/);
  assert.doesNotMatch(source, /plannedGroups\.length === 0\) plannedGroups = planTidyGroups/);
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

  assert.match(source, /async function moveTabsToSpace\(tabIds, spaceId\)[\s\S]*removeTabsFromSpaceSnapshot\(sourceSpaceId, movedTabs\)/);
  assert.match(source, /async function moveTabsToSpace\(tabIds, spaceId\)[\s\S]*await finishMoveToSpace\(spaceId\);\s*return movedTabs\.length/);
  assert.match(source, /async function moveSelectedTabsToSpace\(tabIds, spaceId\)[\s\S]*setStatus\(`Moved \$\{moved\} selected tabs to \$\{spaceName\(spaceId\)\}\.`\)/);
  assert.match(source, /async function moveGroupToSpace\(group, spaceId\)[\s\S]*moveGroupsWithoutSaving\(\[group\], spaceId\);\s*await finishMoveToSpace\(spaceId\);\s*setStatus\(`Moved group/);
  assert.match(source, /async function moveFolderGroupToSpace\(folderContext, spaceId\)[\s\S]*moveGroupsWithoutSaving\(groups, spaceId\);\s*await finishMoveToSpace\(spaceId\);\s*setStatus\(`Moved group/);
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
