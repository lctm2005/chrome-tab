import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPreviewCommandHandler,
  createPreviewTabs,
  isExtensionRuntime,
} from '../src/shared/preview-runtime.js';

test('detects real Chrome extension runtime availability', () => {
  assert.equal(isExtensionRuntime({}), false);
  assert.equal(isExtensionRuntime({ chrome: { runtime: {} } }), false);
  assert.equal(isExtensionRuntime({
    chrome: {
      runtime: { id: 'abc' },
      storage: { local: {} },
    },
  }), true);
});

test('creates preview tabs for file based UI demos', () => {
  const tabs = createPreviewTabs();

  assert.ok(tabs.length >= 4);
  assert.equal(tabs.some((tab) => tab.groupId > 0), true);
  assert.equal(tabs.filter((tab) => tab.active).length, 1);
});

test('preview command handler returns tab group metadata', async () => {
  const send = createPreviewCommandHandler();
  const listed = await send('tabs:list');

  assert.ok(listed.groups.length >= 2);
  assert.equal(listed.groups.some((group) => group.title === 'Research'), true);
});

test('preview command handler supports tab creation, focus, and close', async () => {
  const send = createPreviewCommandHandler();
  const created = await send('tabs:create', { url: 'https://example.com/new' });
  assert.equal(created.tab.url, 'https://example.com/new');

  await send('tabs:focus', { tabId: 2 });
  let listed = await send('tabs:list');
  assert.equal(listed.tabs.find((tab) => tab.id === 2).active, true);

  await send('tabs:close', { tabId: 2 });
  listed = await send('tabs:list');
  assert.equal(listed.tabs.some((tab) => tab.id === 2), false);
});

test('preview command handler supports discarding background tabs', async () => {
  const send = createPreviewCommandHandler();

  await send('tabs:discard', { tabId: 2 });
  const listed = await send('tabs:list');

  assert.equal(listed.tabs.find((tab) => tab.id === 2).discarded, true);
});

test('preview command handler supports group rename and tab ungroup', async () => {
  const send = createPreviewCommandHandler();

  await send('groups:update', { groupId: 1, update: { title: 'Renamed' } });
  let listed = await send('tabs:list');
  assert.equal(listed.groups.find((group) => group.id === 1).title, 'Renamed');

  await send('tabs:ungroup', { tabIds: [1] });
  listed = await send('tabs:list');
  assert.equal(listed.tabs.find((tab) => tab.id === 1).groupId, -1);
});

test('preview command handler supports drag sorting commands', async () => {
  const send = createPreviewCommandHandler();

  await send('tabs:move', { tabId: 4, index: 1 });
  let listed = await send('tabs:list');
  assert.deepEqual(listed.tabs.map((tab) => tab.id).slice(0, 3), [1, 4, 2]);

  await send('tabs:groupExisting', { groupId: 1, tabIds: [4] });
  listed = await send('tabs:list');
  assert.equal(listed.tabs.find((tab) => tab.id === 4).groupId, 1);

  await send('groups:move', { groupId: 1, index: 3 });
  listed = await send('tabs:list');
  assert.equal(listed.tabs.find((tab) => tab.id === 1).index >= 2, true);
});

test('preview command handler returns mock AI text', async () => {
  const send = createPreviewCommandHandler();
  const response = await send('ai:chat', {
    messages: [{ role: 'user', content: 'Hello' }],
  });

  assert.match(response.text, /Preview AI/);
});
