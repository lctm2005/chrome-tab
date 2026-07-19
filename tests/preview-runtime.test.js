import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPreviewCommandHandler,
  createPreviewGroups,
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
  assert.deepEqual(createPreviewGroups().map((group) => group.title), ['Research', 'Build', 'Inbox']);
});

test('preview command handler returns tab group metadata', async () => {
  const send = createPreviewCommandHandler();
  const listed = await send('tabs:list');
  const listedAcrossWindows = await send('tabs:listAll');

  assert.ok(listed.groups.length >= 2);
  assert.equal(listed.groups.some((group) => group.title === 'Research'), true);
  assert.deepEqual(listed.allTabs, listed.tabs);
  assert.deepEqual(listed.allGroups, listed.groups);
  assert.deepEqual(listed.existingTabIds, listed.tabs.map((tab) => tab.id));
  assert.deepEqual(listed.existingWindowIds, [1]);
  assert.deepEqual(listed.existingGroupIds, listed.groups.map((group) => group.id));
  assert.deepEqual(listed.pendingLifecycleTabIds, []);
  assert.deepEqual(listed.suppressedLifecycleTabIds, []);
  assert.deepEqual(listedAcrossWindows, listed);
});

test('preview inventory reports distinct browser windows in stable order', async () => {
  const send = createPreviewCommandHandler([
    { id: 10, title: 'Later window', url: 'https://two.example/', windowId: 2, groupId: -1 },
    { id: 11, title: 'Earlier window', url: 'https://one.example/', windowId: 1, groupId: -1 },
  ], []);

  const listed = await send('tabs:list');

  assert.deepEqual(listed.existingWindowIds, [1, 2]);
});

test('preview command handler can record command history for e2e invariants', async () => {
  globalThis.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
  try {
    const send = createPreviewCommandHandler();
    await send('tabs:create', { url: 'https://example.com/new' });
    await send('tabs:focus', { tabId: 2 });

    assert.deepEqual(
      globalThis.__SPACE_TABS_PREVIEW_COMMANDS__.map((command) => command.type),
      ['tabs:create', 'tabs:focus']
    );
    assert.deepEqual(globalThis.__SPACE_TABS_PREVIEW_COMMANDS__[0].payload, {
      url: 'https://example.com/new',
    });
  } finally {
    delete globalThis.__SPACE_TABS_PREVIEW_COMMANDS__;
  }
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

test('preview command handler reuses a matching Workbench tab', async () => {
  const send = createPreviewCommandHandler();
  const matchUrl = 'http://localhost/sidepanel.html?layout=workbench';
  const first = await send('tabs:openUnique', { url: matchUrl, matchUrl });
  await send('tabs:duplicate', { tabId: first.tab.id });
  const second = await send('tabs:openUnique', { url: `${matchUrl}&view=settings`, matchUrl });
  const listed = await send('tabs:list');

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.closedDuplicates, 1);
  assert.equal(listed.tabs.filter((tab) => tab.url.startsWith(matchUrl)).length, 1);
  assert.equal(second.tab.url, `${matchUrl}&view=settings`);
});

test('preview command handler supports duplicating a tab beside the source', async () => {
  const send = createPreviewCommandHandler();

  const duplicated = await send('tabs:duplicate', { tabId: 2 });
  const listed = await send('tabs:list');
  const sourceIndex = listed.tabs.findIndex((tab) => tab.id === 2);
  const duplicateIndex = listed.tabs.findIndex((tab) => tab.id === duplicated.tab.id);

  assert.equal(duplicated.tab.url, 'https://example.com/spaces-guide');
  assert.equal(duplicated.tab.title, 'Browser Spaces Guide');
  assert.equal(duplicated.tab.groupId, 1);
  assert.equal(duplicateIndex, sourceIndex + 1);
  assert.equal(listed.tabs.filter((tab) => tab.active).length, 1);
  assert.equal(listed.tabs[duplicateIndex].active, true);
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

test('preview relative tab moves mirror Chrome ordering and reject stale drag targets', async () => {
  const send = createPreviewCommandHandler([
    { id: 1, index: 0, groupId: 7, windowId: 1, url: 'https://one.example/' },
    { id: 2, index: 1, groupId: 7, windowId: 1, url: 'https://two.example/' },
    { id: 3, index: 2, groupId: 7, windowId: 1, url: 'https://three.example/' },
    { id: 4, index: 3, groupId: 8, windowId: 1, url: 'https://four.example/' },
    { id: 5, index: 4, groupId: 7, windowId: 2, url: 'https://five.example/' },
  ], [
    { id: 7, title: 'Target', color: 'blue', collapsed: false },
    { id: 8, title: 'Other', color: 'red', collapsed: false },
  ]);

  await send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 3,
    edge: 'after',
    expectedGroupId: 7,
  });
  assert.deepEqual((await send('tabs:list')).tabs.map((tab) => tab.id), [2, 3, 1, 4, 5]);

  await send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 2,
    edge: 'before',
    expectedGroupId: 7,
  });
  const ordered = (await send('tabs:list')).tabs.map((tab) => tab.id);
  assert.deepEqual(ordered, [1, 2, 3, 4, 5]);
  await send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 2,
    edge: 'before',
    expectedGroupId: 7,
  });
  await send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 1,
    edge: 'before',
    expectedGroupId: 7,
  });
  assert.deepEqual((await send('tabs:list')).tabs.map((tab) => tab.id), ordered);

  for (const payload of [
    { tabId: 'bad', anchorTabId: 2, edge: 'before', expectedGroupId: 7 },
    { tabId: -1, anchorTabId: 2, edge: 'before', expectedGroupId: 7 },
    { tabId: 1, anchorTabId: 'bad', edge: 'before', expectedGroupId: 7 },
    { tabId: 1, anchorTabId: -1, edge: 'before', expectedGroupId: 7 },
  ]) {
    await assert.rejects(
      send('tabs:moveRelative', payload),
      /A live source tab and anchor tab are required/,
    );
  }
  await assert.rejects(send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 2,
    edge: 'sideways',
    expectedGroupId: 7,
  }), /before or after/);
  await assert.rejects(send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 2,
    edge: 'before',
    expectedGroupId: 1.5,
  }), /valid target tab group/);
  await assert.rejects(send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 2,
    edge: 'before',
    expectedGroupId: -2,
  }), /valid target tab group/);

  assert.deepEqual(await send('tabs:moveRelative', {
    tabId: 99,
    anchorTabId: 2,
    edge: 'before',
    expectedGroupId: 7,
  }), {
    missing: true,
    missingStage: 'reading source and anchor tabs',
    missingMessage: 'No tab with id: 99',
  });
  assert.deepEqual(await send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 99,
    edge: 'before',
    expectedGroupId: 7,
  }), {
    missing: true,
    missingStage: 'reading source and anchor tabs',
    missingMessage: 'No tab with id: 99',
  });
  await assert.rejects(send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 5,
    edge: 'before',
    expectedGroupId: 7,
  }), /same Chrome window/);
  await assert.rejects(send('tabs:moveRelative', {
    tabId: 1,
    anchorTabId: 4,
    edge: 'before',
    expectedGroupId: 7,
  }), /target tab group changed/);
  await assert.rejects(send('tabs:moveRelative', {
    tabId: 4,
    anchorTabId: 1,
    edge: 'before',
    expectedGroupId: 7,
  }), /target tab group changed/);
});

test('preview command handler returns mock AI text', async () => {
  const send = createPreviewCommandHandler();
  const response = await send('ai:chat', {
    messages: [{ role: 'user', content: 'Hello' }],
  });

  assert.match(response.text, /Preview AI/);
});

test('preview AI returns a parseable topic plan for Auto Group', async () => {
  const send = createPreviewCommandHandler();
  const response = await send('ai:chat', {
    messages: [
      { role: 'system', content: 'Group browser tabs into concise topic/work buckets.' },
      {
        role: 'user',
        content: JSON.stringify([
          { id: 1, title: 'Browser AI documentation', url: 'https://docs.example/a' },
          { id: 2, title: 'Chrome AI research', url: 'https://research.example/b' },
          { id: 3, title: 'GitHub pull request review', url: 'https://github.com/example/repo/pull/3' },
        ]),
      },
    ],
  });

  const groups = JSON.parse(response.text);
  assert.deepEqual(groups[0].tabIds, [1, 2]);
  assert.equal(groups[0].title, 'Product Research');
  assert.equal(groups[1].title, 'Code Review');
});

test('preview command handler mirrors create defaults and inactive background creation', async () => {
  const send = createPreviewCommandHandler([], []);
  const background = await send('tabs:create', { url: 'not a valid URL', active: false });
  const foreground = await send('tabs:create');
  const listed = await send('tabs:list');

  assert.equal(background.tab.title, 'New Tab');
  assert.equal(background.tab.active, false);
  assert.equal(foreground.tab.url, 'chrome://newtab');
  assert.equal(foreground.tab.title, 'New Tab');
  assert.equal(foreground.tab.active, true);
  assert.deepEqual(listed.tabs.map((tab) => tab.active), [false, true]);
});

test('preview commands report missing mutation targets without fabricating records', async () => {
  const send = createPreviewCommandHandler();
  const before = await send('tabs:list');

  assert.deepEqual(await send('tabs:focus', { tabId: 9999 }), { tab: null, missing: true });
  assert.deepEqual(await send('tabs:duplicate', { tabId: 9999 }), { tab: null, missing: true });
  assert.deepEqual(await send('tabs:discard', { tabId: 9999 }), { tab: null, missing: true });
  assert.deepEqual(await send('tabs:close', { tabId: 9999 }), { missing: true });
  assert.deepEqual(await send('tabs:close', { tabId: 'not-a-tab' }), {});
  assert.deepEqual(await send('tabs:group', { tabIds: [1, 9999] }), {
    groupId: null,
    missing: true,
  });
  assert.deepEqual(await send('tabs:group', { tabIds: null }), {
    groupId: null,
    missing: true,
  });
  assert.deepEqual(await send('tabs:groupExisting', { groupId: 'bad', tabIds: [1] }), {
    groupId: null,
    missing: false,
  });
  assert.deepEqual(await send('tabs:groupExisting', { groupId: 9999, tabIds: [1] }), {
    groupId: null,
    missing: true,
  });
  assert.deepEqual(await send('tabs:groupExisting', { groupId: 1, tabIds: [1, 9999] }), {
    groupId: null,
    missing: true,
  });
  assert.deepEqual(await send('tabs:ungroup', { tabIds: [1, 9999] }), { missing: true });
  assert.deepEqual(await send('groups:update', { groupId: 9999 }), { group: null, missing: true });
  assert.deepEqual(await send('tabs:move', { tabId: 9999, index: 0 }), {});
  assert.deepEqual(await send('groups:move', { groupId: 9999, index: 0 }), {});
  assert.deepEqual(await send('tabs:list'), before);
});

test('preview removes empty Chrome groups after every membership mutation', async () => {
  const send = createPreviewCommandHandler([
    { id: 1, title: 'Move me', url: 'https://one.example/', active: true, groupId: 10, windowId: 1 },
    { id: 2, title: 'Target', url: 'https://two.example/', active: false, groupId: 20, windowId: 1 },
    { id: 3, title: 'Close me', url: 'https://three.example/', active: false, groupId: 30, windowId: 1 },
    { id: 4, title: 'Regroup me', url: 'https://four.example/', active: false, groupId: 40, windowId: 1 },
  ], [
    { id: 10, title: 'Source', color: 'red', collapsed: false },
    { id: 20, title: 'Target', color: 'blue', collapsed: false },
    { id: 30, title: 'Closing', color: 'yellow', collapsed: false },
    { id: 40, title: 'Regrouping', color: 'green', collapsed: false },
    { id: 99, title: 'Impossible empty group', color: 'grey', collapsed: false },
  ]);

  let listed = await send('tabs:list');
  assert.deepEqual(listed.existingGroupIds, [10, 20, 30, 40]);
  assert.equal(listed.groups.some((group) => group.id === 99), false);

  assert.deepEqual(await send('tabs:groupExisting', { groupId: 20, tabIds: [1] }), { groupId: 20 });
  listed = await send('tabs:list');
  assert.deepEqual(listed.existingGroupIds, [20, 30, 40]);
  assert.equal(listed.groups.some((group) => group.id === 10), false);

  await send('tabs:close', { tabId: 3 });
  listed = await send('tabs:list');
  assert.deepEqual(listed.existingGroupIds, [20, 40]);

  const regrouped = await send('tabs:group', { tabIds: [4] });
  listed = await send('tabs:list');
  assert.deepEqual(listed.existingGroupIds, [20, regrouped.groupId]);
  assert.equal(listed.groups.some((group) => group.id === 40), false);

  await send('tabs:ungroup', { tabIds: [1, 2] });
  listed = await send('tabs:listAll');
  assert.deepEqual(listed.existingGroupIds, [regrouped.groupId]);
  assert.deepEqual(listed.groups.map((group) => group.id), [regrouped.groupId]);
});

test('preview grouping is atomic and rejects cross-window membership', async () => {
  const send = createPreviewCommandHandler([
    { id: 1, title: 'Target', url: 'https://one.example/', active: true, groupId: 7, windowId: 1 },
    { id: 2, title: 'Other window', url: 'https://two.example/', active: false, groupId: -1, windowId: 2 },
    { id: 3, title: 'Missing window', url: 'https://three.example/', active: false, groupId: -1 },
  ], [
    { id: 7, title: 'Target', color: 'blue', collapsed: false },
  ]);
  const before = await send('tabs:list');

  await assert.rejects(
    send('tabs:group', { tabIds: [1, 2] }),
    /same Chrome window/,
  );
  await assert.rejects(
    send('tabs:groupExisting', { groupId: 7, tabIds: [2] }),
    /same Chrome window/,
  );
  await assert.rejects(
    send('tabs:group', { tabIds: [3] }),
    /same Chrome window/,
  );
  assert.deepEqual(await send('tabs:list'), before);
});

test('preview new groups mirror Chrome contiguity and preserve tab-strip order', async () => {
  const ungrouped = createPreviewCommandHandler([
    { id: 10, title: 'Keep before', groupId: -1, windowId: 1 },
    { id: 11, title: 'First selected', groupId: -1, windowId: 1 },
    { id: 12, title: 'Keep between', groupId: -1, windowId: 1 },
    { id: 13, title: 'Last selected', groupId: -1, windowId: 1 },
  ], []);
  const ungroupedResult = await ungrouped('tabs:group', { tabIds: [13, 11] });
  let listed = await ungrouped('tabs:list');
  assert.deepEqual(listed.tabs.map((tab) => tab.id), [10, 11, 13, 12]);
  assert.deepEqual(
    listed.tabs.filter((tab) => tab.groupId === ungroupedResult.groupId).map((tab) => tab.id),
    [11, 13],
  );

  const grouped = createPreviewCommandHandler([
    { id: 1, title: 'Old group start', groupId: 7, windowId: 1 },
    { id: 2, title: 'Selected from old group', groupId: 7, windowId: 1 },
    { id: 3, title: 'Old group end', groupId: 7, windowId: 1 },
    { id: 4, title: 'Keep after old group', groupId: -1, windowId: 1 },
    { id: 5, title: 'Selected later', groupId: -1, windowId: 1 },
    { id: 6, title: 'Other group start', groupId: 8, windowId: 1 },
    { id: 7, title: 'Other group end', groupId: 8, windowId: 1 },
  ], [
    { id: 7, title: 'Old', color: 'red', collapsed: false },
    { id: 8, title: 'Other', color: 'green', collapsed: false },
  ]);
  const groupedResult = await grouped('tabs:group', { tabIds: [5, 2] });
  listed = await grouped('tabs:list');
  assert.deepEqual(listed.tabs.map((tab) => tab.id), [1, 3, 2, 5, 4, 6, 7]);
  assert.deepEqual(
    listed.tabs.filter((tab) => tab.groupId === groupedResult.groupId).map((tab) => tab.id),
    [2, 5],
  );
  assert.deepEqual(listed.tabs.filter((tab) => tab.groupId === 7).map((tab) => tab.id), [1, 3]);
  assert.deepEqual(listed.tabs.filter((tab) => tab.groupId === 8).map((tab) => tab.id), [6, 7]);

  const groupAtEnd = createPreviewCommandHandler([
    { id: 20, title: 'Before', groupId: -1, windowId: 1 },
    { id: 21, title: 'Selected at group start', groupId: 9, windowId: 1 },
    { id: 22, title: 'Group tail', groupId: 9, windowId: 1 },
  ], [{ id: 9, title: 'Tail', color: 'blue', collapsed: false }]);
  const tailResult = await groupAtEnd('tabs:group', { tabIds: [21] });
  listed = await groupAtEnd('tabs:list');
  assert.deepEqual(listed.tabs.map((tab) => tab.id), [20, 22, 21]);
  assert.equal(listed.tabs.at(-1).groupId, tailResult.groupId);
});

test('preview existing groups absorb tabs at their visual edges in stable order', async () => {
  const send = createPreviewCommandHandler([
    { id: 1, title: 'Selected on left', groupId: 8, windowId: 1 },
    { id: 2, title: 'Old left group remainder', groupId: 8, windowId: 1 },
    { id: 3, title: 'Keep before target', groupId: -1, windowId: 1 },
    { id: 4, title: 'Target start', groupId: 7, windowId: 1 },
    { id: 5, title: 'Target end', groupId: 7, windowId: 1 },
    { id: 6, title: 'Keep after target', groupId: -1, windowId: 1 },
    { id: 7, title: 'Selected on right', groupId: 9, windowId: 1 },
    { id: 8, title: 'Old right group remainder', groupId: 9, windowId: 1 },
  ], [
    { id: 7, title: 'Target', color: 'blue', collapsed: false },
    { id: 8, title: 'Left', color: 'red', collapsed: false },
    { id: 9, title: 'Right', color: 'green', collapsed: false },
  ]);

  assert.deepEqual(await send('tabs:groupExisting', { groupId: 7, tabIds: [7, 1] }), {
    groupId: 7,
  });
  let listed = await send('tabs:list');
  assert.deepEqual(listed.tabs.map((tab) => tab.id), [2, 3, 1, 4, 5, 7, 6, 8]);
  assert.deepEqual(listed.tabs.filter((tab) => tab.groupId === 7).map((tab) => tab.id), [1, 4, 5, 7]);
  assert.deepEqual(listed.tabs.filter((tab) => tab.groupId === 8).map((tab) => tab.id), [2]);
  assert.deepEqual(listed.tabs.filter((tab) => tab.groupId === 9).map((tab) => tab.id), [8]);

  await send('tabs:groupExisting', { groupId: 7, tabIds: [5] });
  listed = await send('tabs:list');
  assert.deepEqual(listed.tabs.map((tab) => tab.id), [2, 3, 1, 4, 5, 7, 6, 8]);
});

test('preview grouping, ungrouping, moving, and updates preserve exact ordering and defaults', async () => {
  const initialTabs = [
    { id: 10, title: 'A', url: 'https://a.example/', active: true, groupId: -1, windowId: 1 },
    { id: 11, title: 'B', url: 'https://b.example/', active: false, groupId: -1, windowId: 1 },
    { id: 12, title: 'C', url: 'https://c.example/', active: false, groupId: -1, windowId: 1 },
  ];
  const send = createPreviewCommandHandler(initialTabs, []);
  const createdGroup = await send('tabs:group', { tabIds: [10, 11] });
  assert.equal((await send('groups:update', { groupId: createdGroup.groupId })).group.id, createdGroup.groupId);
  let listed = await send('tabs:list');
  assert.deepEqual(listed.groups, [{
    id: createdGroup.groupId,
    title: 'Group',
    color: 'blue',
    collapsed: false,
  }]);

  await send('groups:update', {
    groupId: createdGroup.groupId,
    update: { title: 'Updated', color: 'orange', collapsed: true },
  });
  await send('tabs:move', { tabId: 12, index: -100 });
  await send('groups:move', { groupId: createdGroup.groupId });
  listed = await send('tabs:list');
  assert.deepEqual(listed.tabs.map((tab) => tab.id), [12, 10, 11]);
  assert.equal(listed.groups[0].title, 'Updated');
  assert.equal(listed.groups[0].collapsed, true);

  await send('tabs:ungroup', { tabIds: [10, 11] });
  listed = await send('tabs:list');
  assert.equal(listed.groups.length, 0);
  assert.ok(listed.tabs.every((tab) => tab.groupId === -1));

  const explicit = await send('tabs:group', {
    tabIds: [12],
    title: 'Explicit',
    color: 'green',
    collapsed: true,
  });
  await send('tabs:groupExisting', { tabIds: [10], groupId: explicit.groupId });
  listed = await send('tabs:list');
  assert.deepEqual(
    listed.tabs.filter((tab) => tab.groupId === explicit.groupId).map((tab) => tab.id).sort(),
    [10, 12],
  );
});

test('preview close keeps the prior active tab unless the active target was removed', async () => {
  const send = createPreviewCommandHandler();
  await send('tabs:close', { tabId: 1 });
  let listed = await send('tabs:list');
  assert.equal(listed.tabs.find((tab) => tab.id === 2).active, true);

  await send('tabs:close', { tabId: 2 });
  listed = await send('tabs:list');
  assert.equal(listed.tabs[0].active, true);

  const only = createPreviewCommandHandler([
    { id: 1, title: 'Only', url: 'https://only.example/', active: true, groupId: -1 },
  ], []);
  await only('tabs:close', { tabId: 1 });
  assert.deepEqual((await only('tabs:list')).tabs, []);
});

test('preview page extraction covers active, fallback, filtered, and empty page sets', async () => {
  const send = createPreviewCommandHandler([
    { id: 1, title: '', url: '', active: false, groupId: -1 },
    { id: 2, title: 'Readable', url: 'https://example.com/readable', active: true, groupId: -1 },
    { id: 3, title: 'Restricted', url: 'chrome://settings', active: false, groupId: -1 },
  ], []);
  const active = await send('page:extract');
  const pages = await send('pages:extract', { tabIds: [2, 3, 999] });

  assert.equal(active.page.title, 'Readable');
  assert.equal(active.page.url, 'https://example.com/readable');
  assert.equal(pages.pages.length, 1);
  assert.equal(pages.pages[0].tabId, 2);
  assert.equal(pages.totalChars, pages.pages[0].text.length);
  assert.deepEqual(pages.failures, []);
  assert.equal(pages.truncated, false);
  assert.deepEqual((await send('pages:extract')).pages, []);

  const fallback = createPreviewCommandHandler([
    { id: 1, title: '', url: '', active: false, groupId: -1 },
  ], []);
  assert.equal((await fallback('page:extract')).page.title, 'Preview page');
  const empty = createPreviewCommandHandler([], []);
  assert.deepEqual(await empty('page:extract'), {
    page: {
      title: 'Preview page',
      url: '',
      text: 'This is preview text because file:// cannot read a real active Chrome tab. Install the extension to summarize the actual page.',
    },
  });
});

test('preview AI covers tidy names, every grouping bucket, invalid input, and abort', async () => {
  const send = createPreviewCommandHandler();
  const tidy = await send('ai:chat', {
    messages: [
      { role: 'system', content: 'Rename browser tabs for a compact sidebar.' },
      { role: 'user', content: JSON.stringify([
        { id: 1, title: '  One two three four five six seven  ' },
        { id: 2, title: '' },
      ]) },
    ],
  });
  assert.deepEqual(JSON.parse(tidy.text), [
    { id: 1, title: 'One two three four five six' },
    { id: 2, title: 'Untitled' },
  ]);

  const grouped = await send('ai:chat', {
    messages: [
      { role: 'system', content: 'Group browser tabs into concise topic/work buckets.' },
      { role: 'user', content: JSON.stringify([
        { id: 1, title: 'GitHub PR review' },
        { id: 2, title: 'Mail inbox' },
        { id: 3, title: 'Launch plan' },
        { id: 4, title: 'Chrome documentation' },
        { id: 5, title: 'Miscellaneous' },
        { id: 'invalid', title: 'Miscellaneous too' },
      ]) },
    ],
  });
  const groups = JSON.parse(grouped.text);
  assert.deepEqual(groups.map((group) => group.title), [
    'Code Review', 'Team Inbox', 'Planning', 'Product Research', 'Related Work',
  ]);
  assert.deepEqual(groups.at(-1).tabIds, [5]);
  assert.deepEqual(groups.map((group) => group.color), ['cyan', 'purple', 'green', 'orange', 'blue']);

  const invalidJson = await send('ai:chat', {
    messages: [
      { role: 'system', content: 'Rename browser tabs for a compact sidebar.' },
      { role: 'user', content: '{invalid' },
    ],
  });
  const nonArray = await send('ai:chat', {
    messages: [
      { role: 'system', content: 'Rename browser tabs for a compact sidebar.' },
      { role: 'user', content: '{}' },
    ],
  });
  assert.equal(invalidJson.text, '[]');
  assert.equal(nonArray.text, '[]');
  assert.deepEqual(await send('ai:abort'), { aborted: true });
  await assert.rejects(() => send('unknown:command'), /Preview mode does not support command/);
});

test('preview runtime persists mutations and resumes safe ids from session storage', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  try {
    values.set('spaceTabsPreviewRuntime', JSON.stringify({
      tabs: [{ id: 40, title: 'Stored', url: 'https://stored.example/', active: true, groupId: -1, windowId: 1 }],
      groups: [],
      nextId: 41,
      nextGroupId: 8,
    }));
    const resumed = createPreviewCommandHandler();
    assert.equal((await resumed('tabs:create', { url: 'https://next.example/' })).tab.id, 41);
    assert.equal((await resumed('tabs:group', { tabIds: [40] })).groupId, 8);

    const again = createPreviewCommandHandler();
    const listed = await again('tabs:list');
    assert.ok(listed.tabs.some((tab) => tab.id === 41));
    assert.ok(listed.groups.some((group) => group.id === 8));

    values.set('spaceTabsPreviewRuntime', '{invalid');
    assert.equal((await createPreviewCommandHandler([], [])('tabs:list')).tabs.length, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else delete globalThis.sessionStorage;
  }
});

test('preview persistence and command recording stay best-effort when host cloning or storage fails', async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const cloneDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => { throw new Error('blocked'); },
    },
  });
  globalThis.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
  try {
    const send = createPreviewCommandHandler([], []);
    const functionPayload = { callback() {} };
    await send('tabs:list', functionPayload);
    assert.equal(globalThis.__SPACE_TABS_PREVIEW_COMMANDS__[0].payload, functionPayload);
    assert.equal((await send('tabs:create', { url: 'https://still-works.example/' })).tab.id, 1);

    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined });
    await send('tabs:list', { serializable: true });
    const circular = {};
    circular.self = circular;
    await send('tabs:list', circular);
    assert.notEqual(globalThis.__SPACE_TABS_PREVIEW_COMMANDS__[2].payload, circular);
    assert.equal(globalThis.__SPACE_TABS_PREVIEW_COMMANDS__[3].payload, circular);
  } finally {
    delete globalThis.__SPACE_TABS_PREVIEW_COMMANDS__;
    if (storageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', storageDescriptor);
    else delete globalThis.sessionStorage;
    if (cloneDescriptor) Object.defineProperty(globalThis, 'structuredClone', cloneDescriptor);
    else delete globalThis.structuredClone;
  }
});

test('preview command defaults remain safe when optional payload fields are omitted', async () => {
  const send = createPreviewCommandHandler([
    { id: 1, title: 'No URL', url: '', active: false, groupId: -1 },
    { id: 2, title: 'File URL', url: 'file:///tmp/preview.html', active: false, groupId: -1 },
  ], []);

  const byUrl = await send('tabs:openUnique', { url: 'https://www.example.com/path' });
  assert.equal(byUrl.tab.title, 'example.com');
  const fileUrl = await send('tabs:openUnique', { url: 'file:///tmp/other.html' });
  assert.equal(fileUrl.tab.title, 'file:///tmp/other.html');

  const empty = createPreviewCommandHandler([], []);
  const defaultUnique = await empty('tabs:openUnique');
  assert.equal(defaultUnique.tab.url, 'chrome://newtab');
  assert.equal(defaultUnique.tab.title, 'New Tab');

  assert.deepEqual(await send('tabs:group'), { groupId: null, missing: true });
  assert.deepEqual(await send('tabs:ungroup'), { missing: true });
  assert.deepEqual(await send('tabs:groupExisting'), { groupId: null, missing: false });
  await send('tabs:move', { tabId: 1 });
  assert.equal((await send('tabs:list')).tabs.at(-1).id, 1);
  assert.deepEqual((await send('pages:extract', { tabIds: [1] })).pages, []);

  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'file:///preview.html' },
  });
  try {
    assert.equal((await createPreviewCommandHandler([], [])('page:extract')).page.url, 'file:///preview.html');
  } finally {
    if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
    else delete globalThis.location;
  }

  const noMessages = await send('ai:chat');
  assert.match(noMessages.text, /Preview AI response/);
  const blankSystem = await send('ai:chat', { messages: [{ role: 'system', content: '' }] });
  assert.match(blankSystem.text, /Preview AI response/);
  const blankTitles = await send('ai:chat', {
    messages: [
      { role: 'system', content: 'Rename browser tabs for a compact sidebar.' },
      { role: 'user', content: JSON.stringify([
        { id: 1, title: '   ' },
      ]) },
    ],
  });
  assert.deepEqual(JSON.parse(blankTitles.text), [{ id: 1, title: 'Untitled' }]);
  const missingTitleGroup = await send('ai:chat', {
    messages: [
      { role: 'system', content: 'Group browser tabs into concise topic/work buckets.' },
      { role: 'user', content: JSON.stringify([{ id: 1 }]) },
    ],
  });
  assert.equal(JSON.parse(missingTitleGroup.text)[0].title, 'Related Work');
});
