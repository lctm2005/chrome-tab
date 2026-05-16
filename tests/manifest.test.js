import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';

test('declares the Chrome MV3 side panel extension surface', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name.includes('Arc Sidecar'), false);
  assert.equal(manifest.action.default_title.includes('Arc Sidecar'), false);
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.commands._execute_action.suggested_key.mac, 'Command+S');
  assert.equal(manifest.commands._execute_action.description, 'Toggle Space Tabs');
  for (const permission of ['sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting', 'activeTab']) {
    assert.ok(manifest.permissions.includes(permission), `missing ${permission}`);
  }
  assert.equal(manifest.permissions.includes('downloads'), false);
  assert.equal(manifest.permissions.includes('bookmarks'), false);
  assert.ok(manifest.host_permissions.includes('https://api.z.ai/*'));
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  assert.ok(manifest.optional_host_permissions.includes('http://*/*'));
  for (const size of ['16', '32', '48', '128']) {
    assert.equal(manifest.icons[size], `icons/icon${size}.png`);
    assert.equal(manifest.action.default_icon[size], `icons/icon${size}.png`);
    await access(new URL(`../icons/icon${size}.png`, import.meta.url));
  }
});
