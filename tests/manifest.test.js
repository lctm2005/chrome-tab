import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('declares the Chrome MV3 side panel extension surface', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name.includes('Arc Sidecar'), false);
  assert.equal(manifest.action.default_title.includes('Arc Sidecar'), false);
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.commands._execute_action.suggested_key.mac, 'Alt+S');
  assert.equal(manifest.commands._execute_action.description, 'Toggle Space Tabs');
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://*/*', 'https://*/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['content-script.js']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  await access(new URL('../content-script.js', import.meta.url));
  for (const permission of ['sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting', 'activeTab', 'favicon']) {
    assert.ok(manifest.permissions.includes(permission), `missing ${permission}`);
  }
  assert.equal(manifest.permissions.includes('bookmarks'), false);
  assert.equal(manifest.permissions.includes('downloads'), false);
  assert.ok(manifest.host_permissions.includes('https://api.z.ai/*'));
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  assert.ok(manifest.optional_host_permissions.includes('http://*/*'));
  for (const size of ['16', '32', '48', '128']) {
    assert.equal(manifest.icons[size], `icons/icon${size}.png`);
    assert.equal(manifest.action.default_icon[size], `icons/icon${size}.png`);
    await access(new URL(`../icons/icon${size}.png`, import.meta.url));
  }
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
  assert.match(background, /chrome\.tabs\.query\(query\)/);
});

test('sidepanel refresh adopts orphan Chrome groups with orphan tabs', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

  assert.match(source, /adoptGroups:\s*Boolean\(options\.adoptGroups\s*\?\?\s*options\.adopt\)/);
  assert.match(source, /setInterval\(\(\) => refreshTabs\(\{ adopt: true \}\), 2500\)/);
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

test('Move to context actions render as a right-side submenu', async () => {
  const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');

  assert.match(source, /moveToSpaceSubmenu\(\(space\) => moveTabToSpace\(tab, space\.id\)\)/);
  assert.match(source, /moveToSpaceSubmenu\(\(space\) => moveGroupToSpace\(group, space\.id\)\)/);
  assert.match(source, /moveToSpaceSubmenu\(\(space\) => moveFolderGroupToSpace\(folderContext, space\.id\)\)/);
  assert.match(source, /function menuSubmenu\(label, items\)/);
  assert.doesNotMatch(source, /menuLabel\('Move to'\)/);
  assert.doesNotMatch(source, /submenu-left/);
  assert.match(styles, /\.context-submenu-panel/);
  assert.match(styles, /left: calc\(100% \+ 6px\)/);
  assert.doesNotMatch(styles, /submenu-left/);
});
