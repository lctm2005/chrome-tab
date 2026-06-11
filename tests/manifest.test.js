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
  for (const permission of ['sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting', 'activeTab']) {
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
