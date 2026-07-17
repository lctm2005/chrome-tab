import test from 'node:test';
import assert from 'node:assert/strict';

import { chromeGroupTitle } from '../src/shared/group-title.js';
import {
  bindLiveTabsToSnapshot,
  claimViewSnapshotLifecycleId,
  ensureSnapshotLifecycleIds,
  reduceTabLifecycleEvent,
  resolveViewSnapshotGroupId,
  sanitizeSnapshotWithLifecycleIds,
} from '../src/shared/tab-lifecycle.js';
import { mergeSpaceSnapshot } from '../src/shared/space-snapshot.js';

function snapshotFixture() {
  return {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    spaceId: 'work',
    groups: [
      {
        snapshotGroupId: 'group-docs',
        title: 'Docs',
        color: 'blue',
        collapsed: false,
        tabs: [
          { snapshotTabId: 'row-first', title: 'First', panelTitle: 'First panel', url: 'https://same.test/page' },
          { snapshotTabId: 'row-second', title: 'Second', panelTitle: 'Second panel', url: 'https://same.test/page' },
          { snapshotTabId: 'row-other', title: 'Other', url: 'https://other.test/page' },
        ],
      },
    ],
  };
}

function lifecycleState(overrides = {}) {
  return {
    browserSessionId: 'session-current',
    tabLifecycle: {
      10: {
        tabId: 10,
        snapshotTabId: 'row-first',
        snapshotGroupId: 'group-docs',
        spaceId: 'work',
        url: 'https://same.test/page',
        title: 'First',
        panelTitle: 'First panel',
        windowId: 1,
        groupId: 100,
        trackingMode: 'live',
        sessionId: 'session-current',
      },
      11: {
        tabId: 11,
        snapshotTabId: 'row-second',
        snapshotGroupId: 'group-docs',
        spaceId: 'work',
        url: 'https://same.test/page',
        title: 'Second',
        panelTitle: 'Second panel',
        windowId: 1,
        groupId: 100,
        trackingMode: 'live',
        sessionId: 'session-current',
      },
    },
    spaceSnapshots: { work: snapshotFixture() },
    tabSpaces: { 10: 'work', 11: 'work' },
    renamedTabs: { 10: 'First panel', 11: 'Second panel' },
    tabGroups: { 10: 'local-docs', 11: 'local-docs' },
    ephemeralTabIds: [9, 11],
    tabOrder: { work: { 'group:100': [10, 11, 12] } },
    ...overrides,
  };
}

test('adds stable unique local identities without mutating malformed or legacy snapshots', () => {
  assert.equal(ensureSnapshotLifecycleIds(null), null);
  const invalidArray = [];
  assert.strictEqual(ensureSnapshotLifecycleIds(invalidArray), invalidArray);

  const source = {
    version: 1,
    identityVersion: 2,
    groups: [
      {
        snapshotGroupId: ' kept-group ',
        title: 'One',
        tabs: [
          { snapshotTabId: 'kept-tab', url: 'https://one.test' },
          { snapshotTabId: 'kept-tab', url: 'https://duplicate.test' },
        ],
      },
      {
        snapshotGroupId: 'kept-group',
        title: 'Two',
        tabs: [null, { snapshotTabId: '__proto__', url: 'https://unsafe.test' }],
      },
    ],
  };
  const original = structuredClone(source);
  const requests = [];
  const result = ensureSnapshotLifecycleIds(source, (kind, index) => {
    requests.push([kind, index]);
    if (kind === 'group') return 'kept-group';
    if (index === 1) return 'kept-tab';
    return index === 2 ? 'generated-tab' : 'bad id with spaces';
  });

  assert.deepEqual(source, original);
  assert.notStrictEqual(result, source);
  assert.equal(result.identityVersion, 2);
  assert.deepEqual(result.groups.map((group) => group.snapshotGroupId), ['kept-group', 'group-2']);
  assert.deepEqual(result.groups.flatMap((group) => group.tabs.map((tab) => tab.snapshotTabId)), [
    'kept-tab',
    'tab-2',
    'generated-tab',
    'tab-4',
  ]);
  assert.deepEqual(requests, [['tab', 1], ['group', 1], ['tab', 2], ['tab', 3]]);
  assert.deepEqual(ensureSnapshotLifecycleIds(result, () => {
    throw new Error('an already-identified snapshot must not call the factory');
  }), result);

  const fallback = ensureSnapshotLifecycleIds({ groups: 'bad', identityVersion: 0 });
  assert.deepEqual(fallback, { groups: [], identityVersion: 1 });
  const collision = ensureSnapshotLifecycleIds({
    groups: [
      { snapshotGroupId: 'group-2', tabs: [] },
      { tabs: [{ snapshotTabId: 'tab-2' }, {}] },
    ],
  });
  assert.deepEqual(collision.groups.map((group) => group.snapshotGroupId), ['group-2', 'group-2-2']);
  assert.deepEqual(collision.groups[1].tabs.map((tab) => tab.snapshotTabId), ['tab-2', 'tab-2-2']);
});

test('portable same-URL rows receive unique identities before legacy sanitization', () => {
  const portable = {
    version: 1,
    groups: [{
      title: 'Duplicates',
      color: 'blue',
      tabs: [
        { title: 'First copy', url: 'https://same.test/page' },
        { title: 'Second copy', url: 'https://same.test/page' },
      ],
    }],
  };
  const original = structuredClone(portable);
  const normalized = sanitizeSnapshotWithLifecycleIds(
    portable,
    (kind, index) => `${kind}-portable-${index}`,
  );

  assert.deepEqual(portable, original);
  assert.equal(normalized.identityVersion, 1);
  assert.deepEqual(normalized.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'tab-portable-0',
    'tab-portable-1',
  ]);
  assert.equal(normalized.groups[0].tabs.length, 2);
});

test('a unique rebound row identity replaces a stale live group identity', () => {
  let generated = 0;
  const createId = () => {
    generated += 1;
    return 'group-generated';
  };

  assert.equal(
    resolveViewSnapshotGroupId('group-auto-target', new Set(['group-source']), createId),
    'group-source',
  );
  assert.equal(
    resolveViewSnapshotGroupId('group-current', new Set(), createId),
    'group-current',
  );
  assert.equal(
    resolveViewSnapshotGroupId('group-current', new Set(['group-a', 'group-b']), createId),
    'group-current',
  );
  assert.equal(resolveViewSnapshotGroupId('', new Set(), createId), 'group-generated');
  assert.equal(generated, 1);

  const claimedGroupIds = new Set();
  assert.equal(resolveViewSnapshotGroupId(
    'group-stale-a',
    new Set(['group-shared']),
    () => 'group-generated-a',
    claimedGroupIds,
  ), 'group-shared');
  assert.equal(resolveViewSnapshotGroupId(
    'group-stale-b',
    new Set(['group-shared']),
    () => 'group-generated-b',
    claimedGroupIds,
  ), 'group-generated-b');
});

test('view lifecycle identities are claimed once even when stale bindings are duplicated', () => {
  const claimed = new Set(['row-already-used']);
  const generated = ['row-already-used', 'row-generated-a', 'row-generated-b'];
  const createId = () => generated.shift();

  assert.equal(claimViewSnapshotLifecycleId('', claimed, createId), 'row-generated-a');
  assert.equal(claimViewSnapshotLifecycleId('row-kept', claimed, createId), 'row-kept');
  assert.equal(claimViewSnapshotLifecycleId('row-kept', claimed, createId), 'row-generated-b');
  assert.deepEqual([...claimed], [
    'row-already-used',
    'row-generated-a',
    'row-kept',
    'row-generated-b',
  ]);
});

test('binds duplicate URLs one-to-one by stable id, group, and panel title', () => {
  const snapshot = snapshotFixture();
  const existing = {
    20: {
      snapshotTabId: 'row-other',
      snapshotGroupId: 'group-docs',
      spaceId: 'work',
      trackingMode: 'saved-target',
      sessionId: 'session-current',
      windowId: 8,
      groupId: 100,
      index: 4,
      pinned: true,
    },
  };
  const view = [
    {
      snapshotGroupId: 'group-docs',
      title: 'Docs',
      color: 'blue',
      spaceId: 'work',
      tabs: [
        { id: 20, title: 'Navigated', url: 'https://navigated.test', windowId: 2, groupId: 100 },
        { id: 21, title: 'Second live', panelTitle: 'Second panel', url: 'https://same.test/page', windowId: 2, groupId: 100, index: 8, pinned: false },
        { id: 22, title: 'First live', panelTitle: 'First panel', url: 'https://same.test/page', windowId: 2, groupId: 100, index: 9, pinned: false, sessionId: 'tab-session' },
        { id: 23, title: 'No row', url: 'https://missing.test' },
        { id: -1, title: 'Invalid', url: 'https://other.test/page' },
      ],
    },
  ];

  const bindings = bindLiveTabsToSnapshot(view, snapshot, existing);
  assert.deepEqual(Object.keys(bindings), ['20', '21', '22']);
  assert.equal(bindings[20].snapshotTabId, 'row-other');
  assert.equal(bindings[20].trackingMode, 'saved-target');
  assert.equal(bindings[20].windowId, 2);
  assert.equal(bindings[20].index, 4);
  assert.equal(bindings[20].pinned, true);
  assert.equal(bindings[21].snapshotTabId, 'row-second');
  assert.equal(bindings[21].title, 'Second live');
  assert.equal(bindings[21].panelTitle, 'Second panel');
  assert.equal(bindings[21].index, 8);
  assert.equal(bindings[21].pinned, false);
  assert.equal(bindings[22].snapshotTabId, 'row-first');
  assert.equal(bindings[22].title, 'First live');
  assert.equal(bindings[22].panelTitle, 'First panel');
  assert.equal(bindings[22].index, 9);
  assert.equal(bindings[22].pinned, false);
  assert.equal(bindings[22].sessionId, 'tab-session');
  assert.deepEqual(snapshot, snapshotFixture());
});

test('reserves a later existing stable duplicate before an earlier unbound replacement', () => {
  const snapshot = snapshotFixture();
  const bindings = bindLiveTabsToSnapshot([{
    snapshotGroupId: 'group-docs',
    title: 'Docs',
    color: 'blue',
    spaceId: 'work',
    tabs: [
      { id: 30, title: 'Replacement first in Chrome order', url: 'https://same.test/page' },
      { id: 31, title: 'Surviving bound duplicate', url: 'https://same.test/page' },
    ],
  }], snapshot, {
    31: {
      snapshotTabId: 'row-first',
      snapshotGroupId: 'group-docs',
      spaceId: 'work',
    },
  });

  assert.equal(bindings[31].snapshotTabId, 'row-first');
  assert.equal(bindings[30].snapshotTabId, 'row-second');
  assert.equal(bindings[31].title, 'Surviving bound duplicate');
  assert.equal(bindings[30].title, 'Replacement first in Chrome order');
});

test('reserves a later live stable identity before URL-matching an earlier new duplicate', () => {
  const snapshot = snapshotFixture();
  const bindings = bindLiveTabsToSnapshot([{
    snapshotGroupId: 'group-docs',
    title: 'Docs',
    color: 'blue',
    spaceId: 'work',
    tabs: [
      { id: 40, title: 'New duplicate', url: 'https://same.test/page' },
      {
        id: 41,
        snapshotTabId: 'row-first',
        title: 'Explicitly identified duplicate',
        url: 'https://same.test/page',
      },
    ],
  }], snapshot);

  assert.equal(bindings[41].snapshotTabId, 'row-first');
  assert.equal(bindings[40].snapshotTabId, 'row-second');
});

test('binding falls back through group and global exact URL matches without reusing rows', () => {
  const snapshot = {
    spaceId: 'space-from-snapshot',
    sessionId: 'snapshot-session',
    groups: [
      {
        snapshotGroupId: 'g-a', title: 'A', color: 'red', tabs: [
          { snapshotTabId: 'a-1', title: 'A one', url: 'https://same.test', panelTitle: 'Named' },
          { snapshotTabId: 'a-2', title: 'A two', url: 'https://same.test' },
        ],
      },
      {
        snapshotGroupId: 'g-b', title: 'B', color: 'blue', tabs: [
          { snapshotTabId: 'b-1', title: 'B one', url: 'https://same.test', panelTitle: 'Remote' },
          { snapshotTabId: '', title: 'Ignored invalid identity', url: 'https://same.test' },
        ],
      },
    ],
  };
  const bindings = bindLiveTabsToSnapshot([
    { title: 'A', color: 'red', tabs: [
      { id: 1, url: 'https://same.test', panelTitle: 'Named', trackingMode: 'unexpected' },
      { id: 2, url: 'https://same.test' },
    ] },
    { title: 'Unknown', color: 'grey', tabs: [
      { id: 3, url: 'https://same.test', panelTitle: 'Remote' },
      { id: 4, url: 'https://same.test' },
      { id: 5, url: '' },
      { id: 6, url: 'https://same.test' },
    ] },
  ], snapshot);

  assert.deepEqual(Object.fromEntries(Object.entries(bindings).map(([id, binding]) => [id, binding.snapshotTabId])), {
    1: 'a-1',
    2: 'a-2',
    3: 'b-1',
  });
  assert.equal(bindings[1].spaceId, 'space-from-snapshot');
  assert.equal(bindings[1].sessionId, 'snapshot-session');
  assert.equal(bindings[1].groupId, -1);
  assert.equal(bindings[1].windowId, null);
  assert.equal(bindings[1].trackingMode, 'live');
  assert.equal(bindings[2].title, 'A two');
  assert.deepEqual(bindLiveTabsToSnapshot(null, null, null), {});
  assert.deepEqual(bindLiveTabsToSnapshot([{ tabs: [{ id: 0, url: 'https://same.test' }] }], {
    groups: [{ tabs: [{ url: 'https://same.test' }] }],
  }), {});
});

test('binding accepts Chrome tab id zero and preserves existing fallback metadata', () => {
  const bindings = bindLiveTabsToSnapshot([{
    title: '', color: '', tabs: [{
      id: 0,
      title: '',
      url: 'https://zero.test',
      snapshotTabId: 'zero-row',
    }],
  }], {
    groups: [{
      snapshotGroupId: 'zero-group',
      title: 'Ungrouped',
      color: 'grey',
      tabs: [{ snapshotTabId: 'zero-row', title: 'Zero fallback', url: 'https://zero.test' }],
    }],
  }, {
    0: {
      snapshotTabId: 'zero-row',
      snapshotGroupId: 'zero-group',
      spaceId: 'fallback-space',
      windowId: 4,
      groupId: 8,
      panelTitle: 'Existing panel',
      sessionId: 'existing-session',
    },
  });

  assert.deepEqual(bindings[0], {
    snapshotTabId: 'zero-row',
    snapshotGroupId: 'zero-group',
    spaceId: 'fallback-space',
    windowId: 4,
    groupId: 8,
    panelTitle: 'Existing panel',
    sessionId: 'existing-session',
    tabId: 0,
    url: 'https://zero.test',
    title: 'Zero fallback',
    index: 0,
    pinned: false,
    trackingMode: 'live',
  });

  const urlTitleFallback = bindLiveTabsToSnapshot([{
    tabs: [{ id: 1, title: '', url: 'https://fallback-title.test' }],
  }], {
    groups: [{
      snapshotGroupId: 'fallback-group', title: '', color: '',
      tabs: [{ snapshotTabId: 'fallback-row', title: '', url: 'https://fallback-title.test' }],
    }],
  });
  assert.equal(urlTitleFallback[1].title, 'https://fallback-title.test');
});

test('a durable identity never rebinds to another saved row with the same URL', () => {
  for (const provisional of [true, false]) {
    const bindings = bindLiveTabsToSnapshot([{
      snapshotGroupId: 'group-docs',
      title: 'Docs',
      color: 'blue',
      tabs: [{
        id: 30,
        snapshotTabId: 'source-row',
        title: 'Moved independent tab',
        url: 'https://same.test/page',
      }],
    }], snapshotFixture(), {
      30: {
        snapshotTabId: 'source-row',
        snapshotGroupId: 'source-group',
        provisional,
      },
    });

    assert.deepEqual(bindings, {}, `provisional=${provisional}`);
  }
});

test('cross-Space same-URL moves retain both identities through merge and rebind', () => {
  const targetSnapshot = {
    version: 1,
    identityVersion: 1,
    groups: [{
      snapshotGroupId: 'target-group',
      title: 'Target',
      color: 'blue',
      tabs: [{ snapshotTabId: 'target-row', title: 'Saved target', url: 'https://same.test/page' }],
    }],
  };
  const liveView = [{
    snapshotGroupId: 'source-group',
    title: 'Target',
    color: 'blue',
    tabs: [{
      id: 30,
      snapshotTabId: 'source-row',
      title: 'Moved live tab',
      url: 'https://same.test/page',
    }],
  }];
  const existing = {
    30: {
      snapshotTabId: 'source-row',
      snapshotGroupId: 'source-group',
      spaceId: 'target',
      provisional: false,
    },
  };

  assert.deepEqual(bindLiveTabsToSnapshot(liveView, targetSnapshot, existing), {});
  const merged = mergeSpaceSnapshot({
    version: 1,
    identityVersion: 1,
    groups: liveView.map((group) => ({
      ...group,
      tabs: group.tabs.map(({ id, ...tab }) => tab),
    })),
  }, targetSnapshot);
  assert.deepEqual(merged.groups.flatMap((group) => group.tabs.map((tab) => tab.snapshotTabId)), [
    'target-row',
    'source-row',
  ]);
  assert.equal(
    bindLiveTabsToSnapshot(liveView, merged, existing)[30].snapshotTabId,
    'source-row',
  );
});

test('created tabs keep their creation-time Space identity until a restorable URL can be upserted', () => {
  const state = lifecycleState({
    spaces: [{ id: 'work' }, { id: 'focus' }],
    tabLifecycle: {},
    tabSpaces: {},
    groupSpaces: {},
  });
  const original = structuredClone(state);
  const createdEvent = {
    type: 'created',
    eventId: 'created-30',
    sessionId: 'session-current',
    tabId: 30,
    spaceId: 'focus',
    tab: {
      id: 30,
      title: 'New Tab',
      url: 'chrome://newtab/',
      windowId: 8,
      groupId: -1,
      index: 2,
      pinned: false,
    },
    targetGroup: {
      spaceId: 'focus',
      snapshotGroupId: 'created-ungrouped',
      title: 'Ungrouped',
      color: 'grey',
    },
  };
  const provisional = reduceTabLifecycleEvent({ state, event: createdEvent, now: 10 });
  assert.deepEqual(state, original, 'the reducer never mutates its input');
  assert.equal(provisional.tabSpaces[30], 'focus');
  assert.equal(provisional.tabLifecycle[30].snapshotTabId, 'tab:created-30');
  assert.equal(provisional.tabLifecycle[30].snapshotGroupId, 'created-ungrouped');
  assert.equal(provisional.tabLifecycle[30].provisional, true);
  assert.equal(provisional.spaceSnapshots.focus, undefined);

  const navigated = reduceTabLifecycleEvent({
    state: provisional,
    event: {
      type: 'updated',
      tabId: 30,
      changeInfo: { url: 'https://created.test/page', title: 'Created page' },
      targetGroup: createdEvent.targetGroup,
    },
    now: 11,
  });
  assert.equal(navigated.tabLifecycle[30].provisional, false);
  assert.deepEqual(navigated.spaceSnapshots.focus.groups[0], {
    snapshotGroupId: 'created-ungrouped',
    title: 'Ungrouped',
    color: 'grey',
    collapsed: false,
    restorable: true,
    tabs: [{
      snapshotTabId: 'tab:created-30',
      title: 'Created page',
      url: 'https://created.test/page',
    }],
  });

  assert.strictEqual(
    reduceTabLifecycleEvent({ state: navigated, event: createdEvent, now: 12 }),
    navigated,
    'replaying the created journal event cannot duplicate or overwrite a bound tab',
  );
  const repeatedUpdate = reduceTabLifecycleEvent({
    state: navigated,
    event: {
      type: 'updated', tabId: 30,
      changeInfo: { url: 'https://created.test/page', title: 'Created page' },
    },
    now: 13,
  });
  assert.equal(repeatedUpdate.spaceSnapshots.focus.groups[0].tabs.length, 1);
});

test('provisional lifecycle rows follow native grouping and pinned state without creating ghosts', () => {
  const base = lifecycleState({
    spaces: [{ id: 'work' }],
    tabLifecycle: {},
    tabSpaces: {},
    groupSpaces: {},
  });
  const provisional = reduceTabLifecycleEvent({
    state: base,
    event: {
      type: 'created', eventId: 'grouped-40', sessionId: 'session-current',
      tabId: 40, spaceId: 'work',
      tab: { id: 40, url: 'chrome://newtab/', title: 'New Tab', groupId: -1, windowId: 1 },
      targetGroup: {
        spaceId: 'work', snapshotGroupId: 'temporary-ungrouped',
        title: 'Ungrouped', color: 'grey',
      },
    },
  });
  const grouped = reduceTabLifecycleEvent({
    state: provisional,
    event: {
      type: 'updated', tabId: 40, changeInfo: { groupId: 50 },
      targetGroup: {
        spaceId: 'work', snapshotGroupId: 'native-docs',
        title: 'Native Docs', color: 'cyan', collapsed: true,
      },
    },
  });
  assert.equal(grouped.tabLifecycle[40].snapshotGroupId, 'native-docs');
  assert.equal(grouped.groupSpaces[50], 'work');
  assert.equal(grouped.tabSpaces[40], undefined);

  const page = reduceTabLifecycleEvent({
    state: grouped,
    event: {
      type: 'updated', tabId: 40,
      changeInfo: { url: 'https://grouped.test/', title: 'Grouped' },
      targetGroup: {
        spaceId: 'work', snapshotGroupId: 'native-docs',
        title: 'Native Docs', color: 'cyan', collapsed: true,
      },
    },
  });
  const nativeGroup = page.spaceSnapshots.work.groups.find((group) => group.snapshotGroupId === 'native-docs');
  assert.deepEqual(nativeGroup.tabs.map((tab) => tab.snapshotTabId), ['tab:grouped-40']);
  assert.equal(page.spaceSnapshots.work.groups.some((group) => group.snapshotGroupId === 'temporary-ungrouped'), false);

  const pinned = reduceTabLifecycleEvent({
    state: page,
    event: { type: 'updated', tabId: 40, changeInfo: { pinned: true } },
    now: 20,
  });
  assert.equal(pinned.spaceSnapshots.work.groups.some((group) => group.snapshotGroupId === 'native-docs'), false);
  assert.equal(pinned.tabLifecycle[40].provisional, true);
  const unpinned = reduceTabLifecycleEvent({
    state: pinned,
    event: {
      type: 'updated', tabId: 40, changeInfo: { pinned: false },
      targetGroup: {
        spaceId: 'work', snapshotGroupId: 'native-docs',
        title: 'Native Docs', color: 'cyan', collapsed: true,
      },
    },
    now: 21,
  });
  assert.equal(unpinned.spaceSnapshots.work.groups
    .find((group) => group.snapshotGroupId === 'native-docs').tabs.length, 1);
  assert.equal(unpinned.tabLifecycle[40].provisional, false);
});

test('created lifecycle events enforce Space, session, scheme, and duplicate identity boundaries', () => {
  const initial = lifecycleState({
    spaces: [{ id: 'work' }],
    tabLifecycle: {},
    tabSpaces: {},
    groupSpaces: {},
    spaceSnapshots: {},
  });
  const create = (state, id, url, overrides = {}) => reduceTabLifecycleEvent({
    state,
    event: {
      type: 'created', eventId: `event-${id}`, sessionId: 'session-current',
      tabId: id, spaceId: 'work',
      tab: { id, url, title: `Tab ${id}`, groupId: -1, windowId: 1, ...overrides },
      targetGroup: {
        spaceId: 'work', snapshotGroupId: 'ungrouped-created',
        title: 'Ungrouped', color: 'grey',
      },
    },
  });
  let next = create(initial, 50, 'https://duplicate.test/');
  next = create(next, 51, 'https://duplicate.test/');
  next = create(next, 52, 'file:///tmp/restorable.html');
  next = create(next, 53, 'data:text/html,unsafe');
  next = create(next, 54, 'about:blank');
  next = create(next, 55, 'https://pinned.test/', { pinned: true });
  assert.deepEqual(next.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'tab:event-50', 'tab:event-51', 'tab:event-52',
  ]);
  assert.equal(next.tabLifecycle[53].provisional, true);
  assert.equal(next.tabLifecycle[55].provisional, true);

  const deletedSpace = reduceTabLifecycleEvent({
    state: initial,
    event: {
      type: 'created', eventId: 'deleted-space', sessionId: 'session-current',
      tabId: 60, spaceId: 'deleted', tab: { id: 60, url: 'https://no.test/' },
    },
  });
  assert.strictEqual(deletedSpace, initial);
  const stale = reduceTabLifecycleEvent({
    state: initial,
    event: {
      type: 'created', eventId: 'stale-session', sessionId: 'old-session',
      tabId: 61, spaceId: 'work', tab: { id: 61, url: 'https://no.test/' },
    },
  });
  assert.strictEqual(stale, initial);

  const existing = lifecycleState();
  assert.strictEqual(reduceTabLifecycleEvent({
    state: existing,
    event: {
      type: 'created', eventId: 'must-not-overwrite', sessionId: 'session-current',
      tabId: 10, spaceId: 'work', tab: { id: 10, url: 'https://wrong.test/' },
    },
  }), existing);
});

test('native close removes the exact duplicate occurrence and live metadata idempotently', () => {
  const state = lifecycleState();
  const original = structuredClone(state);
  const closed = reduceTabLifecycleEvent({
    state,
    event: { type: 'removed', tabId: 11, sessionId: 'session-current' },
    now: 50,
  });

  assert.deepEqual(state, original);
  assert.deepEqual(closed.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-first',
    'row-other',
  ]);
  assert.equal(closed.spaceSnapshots.work.updatedAt, 50);
  assert.equal(closed.tabLifecycle[11], undefined);
  assert.equal(closed.tabSpaces[11], undefined);
  assert.equal(closed.renamedTabs[11], undefined);
  assert.equal(closed.tabGroups[11], undefined);
  assert.deepEqual(closed.ephemeralTabIds, [9]);
  assert.deepEqual(closed.tabOrder.work['group:100'], [10, 12]);

  const replayed = reduceTabLifecycleEvent({
    state: closed,
    event: { type: 'removed', tabId: 11, binding: original.tabLifecycle[11] },
    now: 51,
  });
  assert.deepEqual(replayed, closed);
});

test('suppressed and whole-window removals preserve snapshots while cleaning live ids', () => {
  for (const event of [
    { type: 'removed', tabId: 10, suppressed: true },
    { type: 'removed', tabId: 10, disposition: 'panel-managed' },
    { type: 'removed', tabId: 10, isWindowClosing: true },
  ]) {
    const next = reduceTabLifecycleEvent({ state: lifecycleState(), event, now: 20 });
    assert.deepEqual(next.spaceSnapshots.work, snapshotFixture());
    assert.equal(next.tabLifecycle[10], undefined);
  }

  const unknownBinding = reduceTabLifecycleEvent({
    state: lifecycleState(),
    event: { type: 'removed', tabId: 99 },
  });
  assert.deepEqual(unknownBinding.spaceSnapshots.work, snapshotFixture());

  const staleBinding = lifecycleState();
  staleBinding.tabLifecycle[10].sessionId = 'old-session';
  assert.strictEqual(reduceTabLifecycleEvent({
    state: staleBinding,
    event: { type: 'removed', tabId: 10 },
  }), staleBinding);
});

test('whole-window teardown ignores Chrome synthetic ungrouping before preserving the saved Tag', () => {
  const state = lifecycleState();
  const afterSyntheticUngroup = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated',
      tabId: 10,
      changeInfo: { groupId: -1 },
      preserveGroupForWindowClose: true,
      targetGroup: {
        spaceId: 'work',
        snapshotGroupId: 'group-ungrouped',
        title: 'Ungrouped',
        color: 'grey',
      },
      tab: { id: 10, groupId: -1 },
    },
    now: 19,
  });

  assert.equal(afterSyntheticUngroup.tabLifecycle[10].groupId, 100);
  assert.equal(afterSyntheticUngroup.tabLifecycle[10].snapshotGroupId, 'group-docs');
  assert.deepEqual(afterSyntheticUngroup.spaceSnapshots.work, snapshotFixture());
  const afterCombinedTeardownUpdate = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated',
      tabId: 10,
      changeInfo: {
        groupId: -1,
        url: 'https://same.test/final-before-close',
        title: 'Final before close',
      },
      preserveGroupForWindowClose: true,
      targetGroup: {
        spaceId: 'work',
        snapshotGroupId: 'group-ungrouped',
        title: 'Ungrouped',
        color: 'grey',
      },
      tab: { id: 10, groupId: -1 },
    },
    now: 19,
  });
  const combinedRow = afterCombinedTeardownUpdate.spaceSnapshots.work.groups[0].tabs
    .find((tab) => tab.snapshotTabId === 'row-first');
  assert.equal(afterCombinedTeardownUpdate.tabLifecycle[10].groupId, 100);
  assert.equal(afterCombinedTeardownUpdate.tabLifecycle[10].snapshotGroupId, 'group-docs');
  assert.deepEqual(combinedRow, {
    snapshotTabId: 'row-first',
    title: 'Final before close',
    panelTitle: 'First panel',
    url: 'https://same.test/final-before-close',
  });
  const defensiveRegroup = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated',
      tabId: 10,
      changeInfo: { groupId: 200 },
      preserveGroupForWindowClose: true,
      targetGroup: {
        spaceId: 'work',
        snapshotGroupId: 'group-second',
        title: 'Second',
        color: 'red',
      },
    },
    now: 19,
  });
  assert.equal(defensiveRegroup.tabLifecycle[10].groupId, 200);
  assert.equal(defensiveRegroup.tabLifecycle[10].snapshotGroupId, 'group-second');
  const markerWithoutExplicitChange = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated',
      tabId: 10,
      groupId: -1,
      preserveGroupForWindowClose: true,
      targetGroup: {
        spaceId: 'work',
        snapshotGroupId: 'group-ungrouped',
        title: 'Ungrouped',
        color: 'grey',
      },
    },
    now: 19,
  });
  assert.equal(markerWithoutExplicitChange.tabLifecycle[10].groupId, -1);
  assert.equal(markerWithoutExplicitChange.tabLifecycle[10].snapshotGroupId, 'group-ungrouped');
  const afterWindowClose = reduceTabLifecycleEvent({
    state: afterSyntheticUngroup,
    event: { type: 'removed', tabId: 10, isWindowClosing: true },
    now: 20,
  });
  assert.equal(afterWindowClose.tabLifecycle[10], undefined);
  assert.deepEqual(afterWindowClose.spaceSnapshots.work, snapshotFixture());
});

test('live navigation updates one stable row consistently and saved targets wait for commit', () => {
  const pathname = reduceTabLifecycleEvent({
    state: lifecycleState(),
    event: {
      type: 'updated',
      tabId: 10,
      changeInfo: { url: 'https://same.test/new-path', title: 'New path' },
    },
    now: 100,
  });
  const row = pathname.spaceSnapshots.work.groups[0].tabs.find((tab) => tab.snapshotTabId === 'row-first');
  assert.deepEqual(row, {
    snapshotTabId: 'row-first',
    title: 'New path',
    panelTitle: 'First panel',
    url: 'https://same.test/new-path',
  });
  assert.equal(pathname.spaceSnapshots.work.groups[0].tabs.length, 3);
  assert.equal(pathname.tabLifecycle[10].url, 'https://same.test/new-path');
  assert.equal(pathname.tabLifecycle[10].title, 'New path');
  assert.equal(pathname.tabLifecycle[10].panelTitle, 'First panel');

  const query = reduceTabLifecycleEvent({
    state: lifecycleState(),
    event: { type: 'updated', tabId: 10, url: 'https://same.test/page?q=1#x' },
    now: '101',
  });
  assert.equal(query.spaceSnapshots.work.groups[0].tabs[0].url, 'https://same.test/page?q=1#x');
  assert.equal(query.spaceSnapshots.work.updatedAt, 101);

  const savedState = lifecycleState();
  savedState.tabLifecycle[10].trackingMode = 'saved-target';
  const saved = reduceTabLifecycleEvent({
    state: savedState,
    event: {
      type: 'updated',
      tabId: 10,
      changeInfo: { url: 'https://same.test/later', title: 'Later' },
      tab: { groupId: 101 },
    },
    now: 102,
  });
  assert.equal(saved.spaceSnapshots.work.groups[0].tabs[0].url, 'https://same.test/page');
  assert.equal(saved.tabLifecycle[10].url, 'https://same.test/later');
  assert.equal(saved.tabLifecycle[10].groupId, 101);

  const committed = reduceTabLifecycleEvent({
    state: saved,
    event: {
      type: 'updated',
      tabId: 10,
      title: 'Committed',
      url: 'https://same.test/committed',
      commitSavedTarget: true,
      trackingMode: 'live',
    },
    now: 103,
  });
  assert.equal(committed.spaceSnapshots.work.groups[0].tabs[0].url, 'https://same.test/committed');
  assert.equal(committed.spaceSnapshots.work.groups[0].tabs[0].title, 'Committed');
  assert.equal(committed.tabLifecycle[10].trackingMode, 'live');
});

test('non-restorable navigation removes stale recovery rows and reuses the stable identity on return', () => {
  for (const url of ['chrome://newtab', 'chrome://new-tab-page/?x=1', 'chrome-extension://id/page.html', 'data:text/plain,no']) {
    const next = reduceTabLifecycleEvent({
      state: lifecycleState(),
      event: { type: 'updated', tabId: 10, changeInfo: { url } },
      now: Number.NaN,
    });
    assert.equal(next.spaceSnapshots.work.groups[0].tabs.some((tab) => tab.snapshotTabId === 'row-first'), false);
    assert.equal(next.spaceSnapshots.work.updatedAt, 0);
    assert.equal(next.tabLifecycle[10].url, url);
    assert.equal(next.tabLifecycle[10].provisional, true);
  }

  const returned = reduceTabLifecycleEvent({
    state: reduceTabLifecycleEvent({
      state: lifecycleState(),
      event: { type: 'updated', tabId: 10, changeInfo: { url: 'chrome://newtab' } },
    }),
    event: { type: 'updated', tabId: 10, changeInfo: { url: 'https://returned.test/page' } },
    now: 6,
  });
  const returnedRow = returned.spaceSnapshots.work.groups[0].tabs
    .find((tab) => tab.snapshotTabId === 'row-first');
  assert.equal(returnedRow.url, 'https://returned.test/page');
  assert.equal(returned.tabLifecycle[10].provisional, false);

  const titleOnly = reduceTabLifecycleEvent({
    state: lifecycleState(),
    event: { type: 'updated', tabId: 10, changeInfo: { title: '' } },
    now: 5,
  });
  assert.equal(titleOnly.spaceSnapshots.work.groups[0].tabs[0].title, 'First');

  const invalidTimestamp = reduceTabLifecycleEvent({
    state: lifecycleState(),
    event: { type: 'updated', tabId: 10, changeInfo: { url: 'https://returned.test/invalid-time' } },
    now: Number.NaN,
  });
  assert.equal(invalidTimestamp.spaceSnapshots.work.updatedAt, 0);
});

test('group changes move one stable row within and across Spaces without duplication', () => {
  const state = lifecycleState({
    spaceSnapshots: {
      work: snapshotFixture(),
      focus: {
        version: 1,
        identityVersion: 1,
        updatedAt: 1,
        groups: [{
          snapshotGroupId: 'group-focus',
          title: 'Focus',
          color: 'red',
          tabs: [
            { snapshotTabId: 'focus-row', title: 'Focus', url: 'https://focus.test' },
            { snapshotTabId: 'same-url-copy', title: 'Independent copy', url: 'https://same.test/page' },
          ],
        }],
      },
    },
  });
  const moved = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated',
      tabId: 10,
      changeInfo: { groupId: 200 },
      targetGroup: {
        spaceId: 'focus',
        snapshotGroupId: 'group-focus',
        title: 'Focus',
        color: 'red',
      },
    },
    now: 200,
  });
  assert.equal(moved.spaceSnapshots.work.groups[0].tabs.some((tab) => tab.snapshotTabId === 'row-first'), false);
  assert.deepEqual(moved.spaceSnapshots.focus.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'focus-row', 'same-url-copy', 'row-first',
  ]);
  assert.equal(moved.tabLifecycle[10].spaceId, 'focus');
  assert.equal(moved.tabLifecycle[10].snapshotGroupId, 'group-focus');
  assert.equal(moved.tabLifecycle[10].groupId, 200);
  assert.equal(moved.groupSpaces[200], 'focus');

  const replayed = reduceTabLifecycleEvent({ state: moved, event: {
    type: 'updated', tabId: 10, groupId: 200,
    targetGroup: { spaceId: 'focus', snapshotGroupId: 'group-focus' },
  }, now: 201 });
  assert.deepEqual(replayed.spaceSnapshots.focus.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'focus-row', 'same-url-copy', 'row-first',
  ]);

  const newDestination = reduceTabLifecycleEvent({ state: lifecycleState(), event: {
    type: 'updated', tabId: 10, changeInfo: { groupId: 300 },
    targetGroup: {
      spaceId: 'new-space', snapshotGroupId: 'new-group', title: '', color: '', collapsed: true,
    },
  }, now: 202 });
  assert.deepEqual(newDestination.spaceSnapshots['new-space'].groups, [{
    snapshotGroupId: 'new-group',
    title: 'Ungrouped',
    color: 'grey',
    collapsed: true,
    restorable: true,
    tabs: [snapshotFixture().groups[0].tabs[0]],
  }]);

  const onlyRowState = lifecycleState({
    tabLifecycle: { 10: lifecycleState().tabLifecycle[10] },
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'group-docs', title: 'Docs', color: 'blue',
          tabs: [snapshotFixture().groups[0].tabs[0]],
        }],
      },
    },
  });
  const removedEmptySource = reduceTabLifecycleEvent({ state: onlyRowState, event: {
    type: 'updated', tabId: 10,
    targetGroup: { spaceId: 'focus', snapshotGroupId: 'focus-group', title: 'Focus', color: 'red' },
  }, now: 203 });
  assert.equal(removedEmptySource.spaceSnapshots.work, undefined);
  assert.equal(removedEmptySource.spaceSnapshots.focus.groups[0].tabs[0].snapshotTabId, 'row-first');

  const preservedEmptySource = lifecycleState({
    tabLifecycle: { 10: lifecycleState().tabLifecycle[10] },
    spaceSnapshots: {
      work: {
        preserveGroups: true,
        groups: [{
          snapshotGroupId: 'group-docs', title: 'Docs', color: 'blue',
          tabs: [snapshotFixture().groups[0].tabs[0]],
        }],
      },
    },
  });
  const preserved = reduceTabLifecycleEvent({ state: preservedEmptySource, event: {
    type: 'updated', tabId: 10,
    targetGroup: { spaceId: 'focus', snapshotGroupId: 'focus-group', title: 'Focus', color: 'red' },
  }, now: 203 });
  assert.deepEqual(preserved.spaceSnapshots.work.groups, [{
    snapshotGroupId: 'group-docs', title: 'Docs', color: 'blue', tabs: [],
  }]);

  const collisionState = lifecycleState({
    spaceSnapshots: {
      work: snapshotFixture(),
      focus: {
        groups: [{
          snapshotGroupId: 'focus-group', title: 'Focus', color: 'red',
          tabs: [{ snapshotTabId: 'row-first', title: 'Unrelated collision', url: 'https://collision.test' }],
        }],
      },
    },
  });
  const collision = reduceTabLifecycleEvent({ state: collisionState, event: {
    type: 'updated', tabId: 10, changeInfo: { groupId: 500 },
    targetGroup: {
      spaceId: 'focus', snapshotGroupId: 'focus-group', title: 'Focus', color: 'red',
    },
  }, now: 204 });
  assert.equal(collision.tabLifecycle[10].spaceId, 'focus');
  assert.equal(collision.spaceSnapshots.work.groups[0].tabs.some((tab) => tab.snapshotTabId === 'row-first'), false);
  assert.deepEqual(collision.spaceSnapshots.focus.groups[0].tabs, [snapshotFixture().groups[0].tabs[0]]);
});

test('native Chrome group metadata, ordering, and removal stay coherent without the side panel', () => {
  const source = lifecycleState();
  const sourceBefore = structuredClone(source);
  const updated = reduceTabLifecycleEvent({
    state: source,
    event: {
      type: 'group-updated',
      groupId: 100,
      spaceId: 'work',
      snapshotGroupId: 'group-docs',
      group: { id: 100, title: 'Native rename', color: 'orange', collapsed: true },
    },
    now: 30,
  });
  assert.deepEqual({
    title: updated.spaceSnapshots.work.groups[0].title,
    color: updated.spaceSnapshots.work.groups[0].color,
    collapsed: updated.spaceSnapshots.work.groups[0].collapsed,
    updatedAt: updated.spaceSnapshots.work.updatedAt,
  }, {
    title: 'Native rename', color: 'orange', collapsed: true, updatedAt: 30,
  });
  assert.equal(updated.groupSpaces[100], 'work');
  assert.equal(updated.collapsedGroups['group:100'], true);
  assert.deepEqual(source, sourceBefore, 'group lifecycle reducers do not mutate their input');

  const logicalTitle = 'A deliberately long logical Chrome group title that must survive its own update event';
  const logical = lifecycleState();
  logical.spaceSnapshots.work.groups[0].title = logicalTitle;
  const preserved = reduceTabLifecycleEvent({
    state: logical,
    event: {
      type: 'group-updated', groupId: 100, spaceId: 'work', snapshotGroupId: 'group-docs',
      group: { id: 100, title: chromeGroupTitle(logicalTitle), color: 'blue', collapsed: false },
    },
  });
  assert.equal(preserved.spaceSnapshots.work.groups[0].title, logicalTitle);

  const cleared = reduceTabLifecycleEvent({
    state: preserved,
    event: {
      type: 'group-updated', groupId: 100, spaceId: 'work', snapshotGroupId: 'group-docs',
      group: { id: 100, title: '', color: 'blue', collapsed: false },
    },
  });
  assert.equal(cleared.spaceSnapshots.work.groups[0].title, '');

  const renamedAfterClear = reduceTabLifecycleEvent({
    state: cleared,
    event: {
      type: 'group-updated', groupId: 100, spaceId: 'work', snapshotGroupId: 'group-docs',
      group: { id: 100, title: 'Tabs', color: 'blue', collapsed: false },
    },
  });
  assert.equal(renamedAfterClear.spaceSnapshots.work.groups[0].title, 'Tabs');

  const orderedState = lifecycleState();
  orderedState.spaceSnapshots.work.groups.push({
    snapshotGroupId: 'group-second',
    title: 'Second group',
    color: 'red',
    collapsed: false,
    tabs: [{ snapshotTabId: 'row-fourth', title: 'Fourth', url: 'https://fourth.test/' }],
  });
  orderedState.tabLifecycle[12] = {
    tabId: 12,
    snapshotTabId: 'row-fourth',
    snapshotGroupId: 'group-second',
    spaceId: 'work',
    url: 'https://fourth.test/',
    title: 'Fourth',
    windowId: 1,
    groupId: 200,
    trackingMode: 'live',
    sessionId: 'session-current',
  };
  orderedState.groupSpaces = { ...(orderedState.groupSpaces || {}), 100: 'work', 200: 'work' };
  orderedState.groupOrder = { work: ['group:100', 'virtual:saved'] };
  const reordered = reduceTabLifecycleEvent({
    state: orderedState,
    event: {
      type: 'group-updated', groupId: 100, spaceId: 'work', snapshotGroupId: 'group-docs',
      group: { id: 100, title: 'Docs', color: 'blue', collapsed: false },
      orderedGroupIds: [200, 100],
      orderedSnapshotGroupIds: ['group-second', 'group-docs'],
    },
  });
  assert.deepEqual(reordered.spaceSnapshots.work.groups.map((group) => group.snapshotGroupId), [
    'group-second', 'group-docs',
  ]);
  assert.deepEqual(reordered.groupOrder.work, ['group:200', 'group:100', 'virtual:saved']);

  const metadataOnly = reduceTabLifecycleEvent({
    state: orderedState,
    event: {
      type: 'group-updated', source: 'updated', groupId: 100,
      spaceId: 'work', snapshotGroupId: 'group-docs',
      group: { id: 100, title: 'Renamed without moving', color: 'blue', collapsed: false },
      orderedGroupIds: [200, 100],
      orderedSnapshotGroupIds: ['group-second', 'group-docs'],
    },
    now: 31,
  });
  assert.equal(metadataOnly.spaceSnapshots.work.groups[0].title, 'Renamed without moving');
  assert.deepEqual(metadataOnly.spaceSnapshots.work.groups.map((group) => group.snapshotGroupId), [
    'group-docs', 'group-second',
  ]);
  assert.deepEqual(metadataOnly.groupOrder.work, ['group:100', 'virtual:saved']);

  const interleavedState = lifecycleState({
    groupSpaces: { 100: 'work', 200: 'work' },
    groupOrder: { work: ['group:100', 'virtual:dormant', 'group:200'] },
    spaces: [{ id: 'work' }],
  });
  interleavedState.spaceSnapshots.work.groups.splice(1, 0, {
    snapshotGroupId: 'group-dormant',
    title: 'Dormant',
    color: 'grey',
    collapsed: false,
    tabs: [{ snapshotTabId: 'row-dormant', title: 'Dormant', url: 'https://dormant.test/' }],
  }, {
    snapshotGroupId: 'group-live-second',
    title: 'Live second',
    color: 'red',
    collapsed: false,
    tabs: [{ snapshotTabId: 'row-live-second', title: 'Live second', url: 'https://live-second.test/' }],
  });
  interleavedState.tabLifecycle[20] = {
    tabId: 20, snapshotTabId: 'row-live-second', snapshotGroupId: 'group-live-second',
    spaceId: 'work', groupId: 200, windowId: 1, url: 'https://live-second.test/',
    title: 'Live second', trackingMode: 'live', sessionId: 'session-current',
  };
  const physicalOrder = {
    orderedGroupIds: [200, 100],
    orderedSnapshotGroupIds: ['group-live-second', 'group-docs'],
  };
  const reorderedByGroupEvent = reduceTabLifecycleEvent({
    state: interleavedState,
    event: {
      type: 'group-updated', groupId: 100, spaceId: 'work', snapshotGroupId: 'group-docs',
      group: { id: 100, title: 'Docs', color: 'blue', collapsed: false },
      ...physicalOrder,
    },
  });
  assert.deepEqual(
    reorderedByGroupEvent.spaceSnapshots.work.groups.map((group) => group.snapshotGroupId),
    ['group-live-second', 'group-dormant', 'group-docs'],
  );
  assert.deepEqual(reorderedByGroupEvent.groupOrder.work, [
    'group:200', 'virtual:dormant', 'group:100',
  ]);

  const reorderedByMembership = reduceTabLifecycleEvent({
    state: interleavedState,
    event: {
      type: 'updated', tabId: 10, changeInfo: { groupId: 100 },
      targetGroup: {
        spaceId: 'work', snapshotGroupId: 'group-docs',
        title: 'Docs', color: 'blue', ...physicalOrder,
      },
    },
  });
  assert.deepEqual(
    reorderedByMembership.spaceSnapshots.work.groups.map((group) => group.snapshotGroupId),
    ['group-live-second', 'group-dormant', 'group-docs'],
  );
  assert.deepEqual(reorderedByMembership.groupOrder.work, [
    'group:200', 'virtual:dormant', 'group:100',
  ]);

  reordered.tabOrder.work['group:100'] = [10, 11];
  reordered.groupOrder.focus = ['virtual:focus', 'group:100'];
  reordered.tabOrder.focus = { 'group:100': [99] };
  const removed = reduceTabLifecycleEvent({
    state: reordered,
    event: { type: 'group-removed', groupId: 100 },
  });
  assert.equal(removed.groupSpaces[100], undefined);
  assert.equal(removed.collapsedGroups['group:100'], undefined);
  assert.equal(removed.groupOrder.work.includes('group:100'), false);
  assert.equal(removed.groupOrder.focus.includes('group:100'), false);
  assert.equal(removed.tabOrder.work['group:100'], undefined);
  assert.equal(removed.tabOrder.focus['group:100'], undefined);
  assert.deepEqual(removed.spaceSnapshots, reordered.spaceSnapshots, 'group removal waits for tab events before pruning rows');
});

test('native group events refuse missing, deleted, or ambiguous snapshot ownership', () => {
  const state = lifecycleState();
  for (const event of [
    { type: 'group-updated', groupId: -1, spaceId: 'work', snapshotGroupId: 'group-docs' },
    { type: 'group-updated', groupId: 100, spaceId: 'deleted', snapshotGroupId: 'group-docs' },
    { type: 'group-updated', groupId: 100, spaceId: 'work', snapshotGroupId: 'missing' },
  ]) {
    assert.strictEqual(reduceTabLifecycleEvent({ state, event }), state);
  }
  assert.strictEqual(reduceTabLifecycleEvent({
    state,
    event: { type: 'group-removed', groupId: -1 },
  }), state);
});

test('group membership updates keep ungrouped ownership and clear stale local grouping', () => {
  const ungrouped = reduceTabLifecycleEvent({ state: lifecycleState(), event: {
    type: 'updated', tabId: 10, changeInfo: { groupId: -1 },
  } });
  assert.equal(ungrouped.tabSpaces[10], 'work');
  assert.equal(ungrouped.tabGroups[10], undefined);

  const grouped = reduceTabLifecycleEvent({ state: ungrouped, event: {
    type: 'updated', tabId: 10, groupId: 900,
  } });
  assert.equal(grouped.tabSpaces[10], 'work', 'an unknown native group must not erase source ownership');
  assert.equal(grouped.tabGroups[10], undefined);

  const knownGroup = reduceTabLifecycleEvent({
    state: lifecycleState({ groupSpaces: { 900: 'work' } }),
    event: { type: 'updated', tabId: 10, groupId: 900 },
  });
  assert.equal(knownGroup.tabSpaces[10], undefined);
});

test('implicit Chrome ungrouping during pin matches an explicit groupId event and never restores the old Tag', () => {
  const targetGroup = {
    spaceId: 'work',
    snapshotGroupId: 'group-ungrouped',
    title: 'Ungrouped',
    color: 'grey',
    collapsed: false,
  };
  const pinEvent = {
    type: 'updated',
    tabId: 10,
    changeInfo: { pinned: true },
    tab: { pinned: true, groupId: -1 },
    targetGroup,
  };
  const implicit = reduceTabLifecycleEvent({ state: lifecycleState(), event: pinEvent, now: 40 });
  const explicit = reduceTabLifecycleEvent({
    state: lifecycleState(),
    event: {
      ...pinEvent,
      changeInfo: { pinned: true, groupId: -1 },
    },
    now: 40,
  });
  assert.deepEqual(implicit, explicit);
  assert.equal(implicit.tabLifecycle[10].groupId, -1);
  assert.equal(implicit.tabLifecycle[10].snapshotGroupId, 'group-ungrouped');
  assert.equal(implicit.tabSpaces[10], 'work');
  assert.equal(implicit.tabGroups[10], undefined);

  const unpinned = reduceTabLifecycleEvent({
    state: implicit,
    event: {
      type: 'updated',
      tabId: 10,
      changeInfo: { pinned: false },
      tab: { pinned: false, groupId: -1 },
    },
    now: 41,
  });
  const restoredGroup = unpinned.spaceSnapshots.work.groups.find((group) => (
    group.snapshotGroupId === 'group-ungrouped'
  ));
  assert.equal(restoredGroup.title, 'Ungrouped');
  assert.deepEqual(restoredGroup.tabs.map((tab) => tab.snapshotTabId), ['row-first']);
  assert.equal(unpinned.spaceSnapshots.work.groups.find((group) => (
    group.snapshotGroupId === 'group-docs'
  )).tabs.some((tab) => tab.snapshotTabId === 'row-first'), false);
});

test('a delayed Chrome ungroup event keeps an exact checkpointed virtual Tag', () => {
  const state = lifecycleState({
    tabLifecycle: {
      ...lifecycleState().tabLifecycle,
      10: {
        ...lifecycleState().tabLifecycle[10],
        groupId: -1,
      },
    },
    tabGroups: { 10: 'vgroup:moved-docs' },
    virtualGroups: {
      'vgroup:moved-docs': {
        id: 'vgroup:moved-docs',
        spaceId: 'work',
        snapshotGroupId: 'group-docs',
        title: 'Docs',
        color: 'blue',
      },
    },
  });
  const delayed = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated',
      tabId: 10,
      changeInfo: { groupId: -1 },
      targetGroup: {
        spaceId: 'work',
        snapshotGroupId: 'group-docs',
        title: 'Docs',
        color: 'blue',
      },
    },
  });

  assert.equal(delayed.tabGroups[10], 'vgroup:moved-docs');
  assert.equal(delayed.tabSpaces[10], 'work');

  const mismatchedVirtual = reduceTabLifecycleEvent({
    state: {
      ...state,
      virtualGroups: {
        'vgroup:moved-docs': {
          ...state.virtualGroups['vgroup:moved-docs'],
          snapshotGroupId: 'different-group',
        },
      },
    },
    event: {
      type: 'updated',
      tabId: 10,
      changeInfo: { groupId: -1 },
      targetGroup: {
        spaceId: 'work',
        snapshotGroupId: 'group-docs',
        title: 'Docs',
        color: 'blue',
      },
    },
  });
  assert.equal(mismatchedVirtual.tabGroups[10], undefined);
});

test('native moved events update the final Chrome order and stable snapshot row order', () => {
  const moved = reduceTabLifecycleEvent({ state: lifecycleState(), event: {
    type: 'moved',
    tabId: 10,
    moveInfo: { toIndex: 7, windowId: 3 },
    orderedTabIds: [11, 10, 11, -1, 'bad', 12],
    spaceId: 'work',
    groupKey: 'group:100',
  }, now: 300 });
  assert.equal(moved.tabLifecycle[10].index, 7);
  assert.equal(moved.tabLifecycle[10].windowId, 3);
  assert.deepEqual(moved.tabOrder.work['group:100'], [11, 10, 12]);
  assert.deepEqual(moved.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-second', 'row-first', 'row-other',
  ]);
  assert.equal(moved.spaceSnapshots.work.updatedAt, 300);

  const singleLiveRow = reduceTabLifecycleEvent({ state: lifecycleState(), event: {
    type: 'moved',
    tabId: 11,
    moveInfo: { toIndex: 1, windowId: 1 },
    orderedTabIds: [11],
    spaceId: 'work',
    groupKey: 'group:100',
  }, now: 301 });
  assert.deepEqual(singleLiveRow.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-first', 'row-second', 'row-other',
  ], 'one physical live row keeps its exact position between saved-only siblings');

  const mixedSnapshot = snapshotFixture();
  mixedSnapshot.groups[0].tabs = [
    mixedSnapshot.groups[0].tabs[0],
    mixedSnapshot.groups[0].tabs[2],
    mixedSnapshot.groups[0].tabs[1],
  ];
  const dormantMiddle = reduceTabLifecycleEvent({
    state: lifecycleState({ spaceSnapshots: { work: mixedSnapshot } }),
    event: {
    type: 'moved',
    tabId: 10,
    moveInfo: { toIndex: 2, windowId: 1 },
    orderedTabIds: [11, 10],
    spaceId: 'work',
    groupKey: 'group:100',
    },
    now: 302,
  });
  assert.deepEqual(dormantMiddle.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-second', 'row-other', 'row-first',
  ], 'native live reordering swaps only live slots and preserves saved-only row positions');

  const indexOnly = reduceTabLifecycleEvent({ state: lifecycleState(), event: {
    type: 'moved', tabId: 10, toIndex: 2,
  } });
  assert.equal(indexOnly.tabLifecycle[10].index, 2);
  assert.equal(indexOnly.tabLifecycle[10].windowId, 1);

  const initializedOrder = reduceTabLifecycleEvent({
    state: lifecycleState({ tabOrder: {} }),
    event: {
      type: 'moved', tabId: 10, toIndex: 1,
      orderedTabIds: [10], spaceId: 'work', groupKey: 'group:100',
    },
  });
  assert.deepEqual(initializedOrder.tabOrder.work['group:100'], [10]);

  const missingSnapshot = reduceTabLifecycleEvent({
    state: lifecycleState({ spaceSnapshots: {} }),
    event: {
      type: 'moved', tabId: 10, toIndex: 1,
      orderedTabIds: [10], spaceId: 'work', groupKey: 'group:100',
    },
  });
  assert.deepEqual(missingSnapshot.tabOrder.work['group:100'], [10]);
  const missingGroupState = lifecycleState();
  missingGroupState.tabLifecycle[10].snapshotGroupId = 'missing-group';
  const missingGroup = reduceTabLifecycleEvent({
    state: missingGroupState,
    event: {
      type: 'moved', tabId: 10, toIndex: 1,
      orderedTabIds: [10], spaceId: 'work', groupKey: 'group:100',
    },
  });
  assert.deepEqual(missingGroup.spaceSnapshots, missingGroupState.spaceSnapshots);
});

test('membership updates correct an earlier moved event using the physical target-group order', () => {
  const runUpdateOrder = (updateOrder) => {
    const state = lifecycleState({
      spaces: [{ id: 'work' }, { id: 'focus' }],
      groupSpaces: { 100: 'work' },
      tabOrder: { work: { 'group:100': [10, 11, 12] } },
    });
    let next = reduceTabLifecycleEvent({
      state,
      event: {
        type: 'moved', tabId: 11, moveInfo: { toIndex: 1, windowId: 2 },
        orderedTabIds: [10, 11], spaceId: 'work', groupKey: 'group:300',
      },
      now: 301,
    });
    assert.deepEqual(next.tabOrder.work['group:300'], [10, 11]);

    for (const tabId of updateOrder) {
      next = reduceTabLifecycleEvent({
        state: next,
        event: {
          type: 'updated', tabId, changeInfo: { groupId: 300 },
          targetGroup: {
            spaceId: 'focus', snapshotGroupId: 'group-native',
            title: 'Native', color: 'green', orderedTabIds: [10, 11],
          },
        },
        now: 302 + tabId,
      });
    }

    assert.equal(next.tabOrder.work['group:300'], undefined);
    assert.deepEqual(next.tabOrder.work['group:100'], [12]);
    assert.deepEqual(next.tabOrder.focus['group:300'], [10, 11]);
    assert.deepEqual(
      next.spaceSnapshots.focus.groups[0].tabs.map((tab) => tab.snapshotTabId),
      ['row-first', 'row-second'],
    );
    assert.deepEqual(
      next.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId),
      ['row-other'],
    );
    assert.equal(next.groupSpaces[300], 'focus');
  };

  runUpdateOrder([10, 11]);
  runUpdateOrder([11, 10]);
});

test('physical group reconciliation skips unknown, stale, and unsafe peers but adopts provisional peers', () => {
  const state = lifecycleState({
    spaces: [{ id: 'work' }, { id: 'focus' }],
    groupSpaces: { 100: 'work' },
  });
  state.tabLifecycle[21] = {
    tabId: 21, snapshotTabId: 'stale-row', snapshotGroupId: 'stale-group',
    spaceId: 'work', groupId: 100, provisional: true, sessionId: 'stale-session',
  };
  state.tabLifecycle[22] = {
    tabId: 22, snapshotTabId: 'provisional-row', snapshotGroupId: 'provisional-group',
    spaceId: 'work', groupId: 100, provisional: true, sessionId: 'session-current',
  };
  state.tabLifecycle[23] = {
    tabId: 23, snapshotTabId: 'missing-row', snapshotGroupId: 'missing-group',
    spaceId: 'work', groupId: 100, provisional: false, sessionId: 'session-current',
  };

  const next = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated', tabId: 10, changeInfo: { groupId: 300 },
      targetGroup: {
        spaceId: 'focus', snapshotGroupId: 'group-native', title: 'Native', color: 'green',
        orderedTabIds: [10, 99, 21, 22, 23],
      },
    },
  });

  assert.equal(next.tabLifecycle[21].spaceId, 'work');
  assert.deepEqual({
    spaceId: next.tabLifecycle[22].spaceId,
    snapshotGroupId: next.tabLifecycle[22].snapshotGroupId,
    groupId: next.tabLifecycle[22].groupId,
  }, { spaceId: 'focus', snapshotGroupId: 'group-native', groupId: 300 });
  assert.equal(next.tabLifecycle[23].spaceId, 'work');
  assert.equal(next.tabLifecycle[99], undefined);
});

test('empty source groups obey preserveGroups and ungrouped persistence rules', () => {
  const oneRow = (preserveGroups, title = 'Only', color = 'blue') => lifecycleState({
    tabLifecycle: {
      10: lifecycleState().tabLifecycle[10],
    },
    spaceSnapshots: {
      work: {
        preserveGroups,
        groups: [{
          snapshotGroupId: 'group-docs', title, color,
          tabs: [{ snapshotTabId: 'row-first', title: 'First', url: 'https://same.test/page' }],
        }],
      },
    },
  });

  const kept = reduceTabLifecycleEvent({ state: oneRow(true), event: { type: 'removed', tabId: 10 }, now: 1 });
  assert.equal(kept.spaceSnapshots.work.groups.length, 1);
  assert.deepEqual(kept.spaceSnapshots.work.groups[0].tabs, []);
  const droppedUngrouped = reduceTabLifecycleEvent({
    state: oneRow(true, 'Ungrouped', 'grey'),
    event: { type: 'removed', tabId: 10 },
    now: 1,
  });
  assert.equal(droppedUngrouped.spaceSnapshots.work, undefined);
  const droppedDefaultUngrouped = reduceTabLifecycleEvent({
    state: oneRow(true, '', ''),
    event: { type: 'removed', tabId: 10 },
    now: 1,
  });
  assert.equal(droppedDefaultUngrouped.spaceSnapshots.work, undefined);
});

test('attached and detached events preserve Space identity across windows', () => {
  const detached = reduceTabLifecycleEvent({ state: lifecycleState(), event: {
    type: 'detached', tabId: 10, detachInfo: { oldWindowId: 1 },
  } });
  assert.equal(detached.tabLifecycle[10].windowId, null);
  assert.equal(detached.tabLifecycle[10].detachedFromWindowId, 1);
  assert.equal(detached.tabLifecycle[10].spaceId, 'work');

  const attached = reduceTabLifecycleEvent({ state: detached, event: {
    type: 'attached', tabId: 10, attachInfo: { newWindowId: 2, newPosition: 4 },
  } });
  assert.equal(attached.tabLifecycle[10].windowId, 2);
  assert.equal(attached.tabLifecycle[10].index, 4);
  assert.equal('detachedFromWindowId' in attached.tabLifecycle[10], false);

  const detachedUnknownWindow = reduceTabLifecycleEvent({ state: attached, event: {
    type: 'detached', tabId: 10,
  } });
  assert.equal('detachedFromWindowId' in detachedUnknownWindow.tabLifecycle[10], false);
});

test('tab replacement transfers all live-id metadata while keeping snapshot identity', () => {
  const askKey = 'tab:10:https://same.test/page';
  const state = lifecycleState({
    askSessions: {
      [askKey]: {
        key: askKey,
        tabId: 10,
        title: 'First',
        url: 'https://same.test/page',
        messages: [{ id: 'm1', role: 'user', text: 'Keep this', createdAt: 1 }],
      },
    },
    activeAskSessionKey: askKey,
    operationHistory: [
      {
        id: 'tidy',
        type: 'tidy-names',
        before: { renamedTabs: { 10: null, 11: 'Second panel' } },
        after: { renamedTabs: { 10: 'First panel' }, targetFingerprint: 'tidy-fingerprint' },
      },
      {
        id: 'auto',
        type: 'auto-group',
        before: {
          live: {
            groups: [{ title: 'Docs', tabIds: [10, 11] }, null],
            ungroupedTabIds: [10],
          },
        },
        after: { organizationFingerprint: 'organization-fingerprint' },
      },
      {
        id: 'restore',
        type: 'restore-backup',
        before: {
          liveOwnership: {
            tabs: [{ id: 10, spaceId: 'work' }, { id: 11, spaceId: 'work' }, null],
            groups: [{ id: 100, spaceId: 'work' }],
            lifecycle: [
              { id: 10, binding: { tabId: 10, snapshotTabId: 'row-first' } },
              { id: 11, binding: { tabId: 11, snapshotTabId: 'row-second' } },
              null,
            ],
          },
        },
      },
      {
        id: 'tidy-unrelated',
        type: 'tidy-names',
        before: { renamedTabs: { 11: 'Before' } },
        after: { renamedTabs: { 11: 'After' } },
      },
      {
        id: 'restore-sparse',
        type: 'restore-backup',
        before: { liveOwnership: { lifecycle: [{ id: 10, binding: null }] } },
      },
      { id: 'portable', type: 'workspace', before: { keep: true } },
      null,
    ],
  });
  const replaced = reduceTabLifecycleEvent({ state, event: {
    type: 'replaced',
    removedTabId: 10,
    addedTabId: 20,
    tab: {
      windowId: 3,
      groupId: 300,
      url: 'https://replacement.test',
      title: 'Replacement',
    },
  } });
  assert.equal(replaced.tabLifecycle[10], undefined);
  assert.equal(replaced.tabLifecycle[20].snapshotTabId, 'row-first');
  assert.equal(replaced.tabLifecycle[20].windowId, 3);
  assert.equal(replaced.tabLifecycle[20].groupId, 300);
  assert.equal(replaced.tabLifecycle[20].url, 'https://replacement.test');
  assert.equal(replaced.tabLifecycle[20].title, 'Replacement');
  assert.equal(replaced.spaceSnapshots.work.groups[0].tabs[0].url, 'https://replacement.test');
  assert.equal(replaced.spaceSnapshots.work.groups[0].tabs[0].title, 'Replacement');
  assert.equal(replaced.tabSpaces[20], 'work');
  assert.equal(replaced.renamedTabs[20], 'First panel');
  assert.equal(replaced.tabGroups[20], 'local-docs');
  assert.deepEqual(replaced.tabOrder.work['group:100'], [20, 11, 12]);
  const reboundAskKey = 'tab:20:https://same.test/page';
  assert.equal(replaced.askSessions[askKey], undefined);
  assert.deepEqual(replaced.askSessions[reboundAskKey].messages,
    state.askSessions[askKey].messages);
  assert.equal(replaced.activeAskSessionKey, reboundAskKey);
  const [tidy, autoGroup, restore, unrelatedTidy, sparseRestore, portable, sparse] =
    replaced.operationHistory;
  assert.deepEqual(tidy.before.renamedTabs, { 11: 'Second panel', 20: null });
  assert.deepEqual(tidy.after.renamedTabs, { 20: 'First panel' });
  assert.deepEqual(tidy.after.tabIdAliases, { 20: 10 });
  assert.deepEqual(autoGroup.before.live.groups[0].tabIds, [20, 11]);
  assert.deepEqual(autoGroup.before.live.groups[1], { tabIds: [] });
  assert.deepEqual(autoGroup.before.live.ungroupedTabIds, [20]);
  assert.deepEqual(autoGroup.after.tabIdAliases, { 20: 10 });
  assert.deepEqual(restore.before.liveOwnership.tabs, [
    { id: 20, spaceId: 'work' },
    { id: 11, spaceId: 'work' },
    null,
  ]);
  assert.deepEqual(restore.before.liveOwnership.groups, [{ id: 100, spaceId: 'work' }]);
  assert.deepEqual(restore.before.liveOwnership.lifecycle, [
    { id: 20, binding: { tabId: 20, snapshotTabId: 'row-first' } },
    { id: 11, binding: { tabId: 11, snapshotTabId: 'row-second' } },
    null,
  ]);
  assert.deepEqual(unrelatedTidy.before.renamedTabs, { 11: 'Before' });
  assert.deepEqual(unrelatedTidy.after.renamedTabs, { 11: 'After' });
  assert.deepEqual(sparseRestore.before.liveOwnership.lifecycle, [{ id: 20, binding: null }]);
  assert.strictEqual(portable, state.operationHistory[5]);
  assert.equal(sparse, null);

  const replacedAgain = reduceTabLifecycleEvent({ state: replaced, event: {
    type: 'replaced', removedTabId: 20, addedTabId: 30, tab: {},
  } });
  assert.deepEqual(replacedAgain.operationHistory[0].after.tabIdAliases, { 30: 10 });
  assert.deepEqual(replacedAgain.operationHistory[1].after.tabIdAliases, { 30: 10 });
  assert.equal(replacedAgain.askSessions['tab:30:https://same.test/page'].tabId, 30);

  const orphanActiveKey = 'tab:10:https://missing-session.test/';
  const activeWithoutSession = reduceTabLifecycleEvent({
    state: lifecycleState({ askSessions: {}, activeAskSessionKey: orphanActiveKey }),
    event: { type: 'replaced', removedTabId: 10, addedTabId: 40 },
  });
  assert.equal(activeWithoutSession.activeAskSessionKey,
    'tab:40:https://missing-session.test/');
  const activeWithoutAskState = reduceTabLifecycleEvent({
    state: lifecycleState({ activeAskSessionKey: orphanActiveKey }),
    event: { type: 'replaced', removedTabId: 10, addedTabId: 41 },
  });
  assert.equal(activeWithoutAskState.activeAskSessionKey,
    'tab:41:https://missing-session.test/');

  const ephemeralState = lifecycleState({ ephemeralTabIds: [10, 20] });
  const deduped = reduceTabLifecycleEvent({ state: ephemeralState, event: {
    type: 'replaced', removedTabId: 10, addedTabId: 20, tab: {},
  } });
  assert.deepEqual(deduped.ephemeralTabIds, [20]);
  assert.deepEqual(reduceTabLifecycleEvent({ state: deduped, event: {
    type: 'replaced', removedTabId: 10, addedTabId: 20,
  } }), deduped);

  const nonRestorable = reduceTabLifecycleEvent({ state: lifecycleState(), event: {
    type: 'replaced', removedTabId: 10, addedTabId: 21,
    tab: { url: 'chrome://newtab' },
  }, now: 4 });
  assert.equal(nonRestorable.spaceSnapshots.work.groups[0].tabs[0].url, 'https://same.test/page');
  const titleOnly = reduceTabLifecycleEvent({ state: lifecycleState(), event: {
    type: 'replaced', removedTabId: 10, addedTabId: 22,
    tab: { title: 'Only title' },
  }, now: 5 });
  assert.equal(titleOnly.spaceSnapshots.work.groups[0].tabs[0].title, 'Only title');
  const urlOnly = reduceTabLifecycleEvent({ state: lifecycleState(), event: {
    type: 'replaced', removedTabId: 10, addedTabId: 23,
    tab: { url: 'https://only-url.test' },
  }, now: 6 });
  assert.equal(urlOnly.spaceSnapshots.work.groups[0].tabs[0].url, 'https://only-url.test');
});

test('invalid events, stale sessions, and stale bindings cannot mutate current state', () => {
  const state = lifecycleState();
  for (const request of [
    {},
    { state: null, event: { type: 'removed', tabId: 10 } },
    { state, event: null },
    { state, event: { type: 'unknown', tabId: 10 } },
    { state, event: { type: 'removed', tabId: -1 } },
    { state, event: { type: 'updated', tabId: 'bad' } },
    { state, event: { type: 'moved', tabId: 10, toIndex: -1 } },
    { state, event: { type: 'moved', tabId: -1, toIndex: 1 } },
    { state, event: { type: 'attached', tabId: 10, newWindowId: -1 } },
    { state, event: { type: 'attached', tabId: -1, newWindowId: 2 } },
    { state, event: { type: 'detached', tabId: -1 } },
    { state, event: { type: 'replaced', removedTabId: 10, addedTabId: 10 } },
    { state, event: { type: 'removed', tabId: 10, sessionId: 'old-session' } },
  ]) {
    assert.strictEqual(reduceTabLifecycleEvent(request), request.state);
  }

  const stale = lifecycleState();
  stale.tabLifecycle[10].sessionId = 'old-session';
  for (const type of ['updated', 'moved', 'attached', 'detached']) {
    assert.strictEqual(reduceTabLifecycleEvent({
      state: stale,
      event: { type, tabId: 10, newWindowId: 2 },
    }), stale);
  }
  assert.strictEqual(reduceTabLifecycleEvent({
    state: stale,
    event: { type: 'replaced', removedTabId: 10, addedTabId: 20 },
  }), stale);

  const missing = lifecycleState({ tabLifecycle: {} });
  for (const type of ['updated', 'moved', 'attached', 'detached']) {
    assert.strictEqual(reduceTabLifecycleEvent({
      state: missing,
      event: { type, tabId: 10, newWindowId: 2 },
    }), missing);
  }
  const replacedWithoutBinding = reduceTabLifecycleEvent({
    state: missing,
    event: { type: 'replaced', removedTabId: 10, addedTabId: 20 },
  });
  assert.notStrictEqual(replacedWithoutBinding, missing);
  assert.equal(replacedWithoutBinding.tabSpaces[10], undefined);
  assert.equal(replacedWithoutBinding.tabSpaces[20], 'work');
  assert.equal(replacedWithoutBinding.renamedTabs[20], 'First panel');
  assert.equal(replacedWithoutBinding.tabGroups[20], 'local-docs');
  assert.deepEqual(replacedWithoutBinding.tabOrder.work['group:100'], [20, 11, 12]);
  assert.strictEqual(reduceTabLifecycleEvent({
    state,
    event: { type: 'replaced', removedTabId: -1, addedTabId: 20 },
  }), state);
});

test('missing or invalid stable row locations never guess during update or move', () => {
  const state = lifecycleState();
  state.tabLifecycle[10] = {
    ...state.tabLifecycle[10],
    snapshotTabId: 'missing-row',
  };
  const updated = reduceTabLifecycleEvent({ state, event: {
    type: 'updated', tabId: 10, changeInfo: { title: 'No target' },
  }, now: 1 });
  assert.deepEqual(updated.spaceSnapshots, state.spaceSnapshots);
  const moved = reduceTabLifecycleEvent({ state, event: {
    type: 'updated', tabId: 10,
    targetGroup: { spaceId: 'focus', snapshotGroupId: 'focus-group' },
  }, now: 2 });
  assert.deepEqual(moved.spaceSnapshots, state.spaceSnapshots);
  assert.equal(moved.tabLifecycle[10].spaceId, 'work');

  const invalidIdentity = lifecycleState();
  invalidIdentity.tabLifecycle[10].snapshotTabId = '';
  const removed = reduceTabLifecycleEvent({
    state: invalidIdentity,
    event: { type: 'removed', tabId: 10 },
  });
  assert.deepEqual(removed.spaceSnapshots, invalidIdentity.spaceSnapshots);
});

test('ambiguous global row ids are never guessed without a Space binding', () => {
  const duplicate = snapshotFixture();
  const state = lifecycleState({
    tabLifecycle: {},
    spaceSnapshots: { work: duplicate, focus: structuredClone(duplicate) },
  });
  const next = reduceTabLifecycleEvent({ state, event: {
    type: 'removed',
    tabId: 30,
    binding: { snapshotTabId: 'row-first', spaceId: '' },
  }, now: 9 });
  assert.deepEqual(next.spaceSnapshots, state.spaceSnapshots);
});

test('native fallback event fields create and clean up groups with user-facing defaults', () => {
  const base = lifecycleState({
    spaces: [{ id: 'work' }],
    tabLifecycle: {},
    tabSpaces: {},
    groupSpaces: {},
    spaceSnapshots: {},
  });
  const ungrouped = reduceTabLifecycleEvent({
    state: base,
    event: {
      type: 'created',
      sessionId: 'session-current',
      tab: {
        id: 30,
        url: 'https://created-from-native.test/',
        windowId: 2,
        index: 1,
      },
      targetGroup: { spaceId: 'work' },
    },
    now: 40,
  });
  assert.equal(ungrouped.tabSpaces[30], 'work');
  assert.deepEqual(ungrouped.spaceSnapshots.work.groups, [{
    snapshotGroupId: 'group:30',
    title: 'Ungrouped',
    color: 'grey',
    collapsed: false,
    restorable: true,
    tabs: [{
      snapshotTabId: 'tab:30',
      title: 'https://created-from-native.test/',
      url: 'https://created-from-native.test/',
    }],
  }]);

  const grouped = reduceTabLifecycleEvent({
    state: ungrouped,
    event: {
      type: 'created',
      eventId: 'native-grouped',
      sessionId: 'session-current',
      tabId: 31,
      spaceId: 'work',
      tab: {
        id: 31,
        title: 'Grouped page',
        url: 'https://grouped-native.test/',
        groupId: 70,
        windowId: 2,
      },
      targetGroup: { spaceId: 'work', snapshotGroupId: 'native-group' },
    },
    now: 41,
  });
  assert.equal(grouped.groupSpaces[70], 'work');
  assert.equal(grouped.tabSpaces[31], undefined);
  assert.deepEqual(grouped.spaceSnapshots.work.groups[1], {
    snapshotGroupId: 'native-group',
    title: 'Tabs',
    color: 'blue',
    collapsed: false,
    tabs: [{
      snapshotTabId: 'tab:native-grouped',
      title: 'Grouped page',
      url: 'https://grouped-native.test/',
    }],
  });

  const pinned = reduceTabLifecycleEvent({
    state: grouped,
    event: { type: 'updated', tabId: 31, pinned: true },
    now: 42,
  });
  assert.equal(pinned.tabLifecycle[31].pinned, true);
  assert.equal(pinned.spaceSnapshots.work.groups.some((group) => (
    group.tabs.some((tab) => tab.snapshotTabId === 'tab:native-grouped')
  )), false);

  const groupState = lifecycleState({
    groupSpaces: { 100: 'work', 200: 'work' },
    collapsedGroups: { 'group:100': false },
    groupOrder: { work: ['group:100', 'group:200'] },
  });
  groupState.spaceSnapshots.work.groups[0].title = '';
  groupState.spaceSnapshots.work.groups[0].color = '';
  groupState.spaceSnapshots.work.groups.push({
    snapshotGroupId: 'group-second',
    title: 'Second',
    color: 'red',
    collapsed: false,
    tabs: [],
  });
  const groupUpdated = reduceTabLifecycleEvent({
    state: groupState,
    event: {
      type: 'group-updated',
      group: { id: 100 },
      spaceId: 'work',
      snapshotGroupId: 'group-docs',
      orderedSnapshotGroupIds: ['', 'group-second', 'group-second'],
    },
    now: 43,
  });
  assert.equal(groupUpdated.spaceSnapshots.work.groups[0].title, '');
  assert.equal(groupUpdated.spaceSnapshots.work.groups[0].color, '');
  assert.equal(groupUpdated.spaceSnapshots.work.groups[0].collapsed, false);
  assert.deepEqual(groupUpdated.spaceSnapshots.work.groups.map((group) => group.snapshotGroupId), [
    'group-docs', 'group-second',
  ]);

  const groupRemoved = reduceTabLifecycleEvent({
    state: groupUpdated,
    event: { type: 'group-removed', group: { id: 100 } },
  });
  assert.equal(groupRemoved.groupSpaces[100], undefined);
  assert.equal(groupRemoved.collapsedGroups['group:100'], undefined);
  assert.equal(groupRemoved.groupOrder.work.includes('group:100'), false);
});

test('invalid provisional identities and missing replacement rows never fabricate snapshots', () => {
  const state = lifecycleState();
  const invalidIdentity = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated',
      tabId: 40,
      binding: {
        provisional: true,
        trackingMode: 'live',
        sessionId: 'session-current',
        title: 'No identity',
        url: 'https://missing-identity.test/',
      },
    },
    now: 50,
  });
  assert.deepEqual(invalidIdentity.spaceSnapshots, state.spaceSnapshots);
  assert.equal(invalidIdentity.tabLifecycle[40].provisional, true);

  const duplicateIdentity = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated',
      tabId: 41,
      binding: {
        provisional: true,
        trackingMode: 'live',
        sessionId: 'session-current',
        spaceId: 'focus',
        snapshotGroupId: 'focus-group',
        snapshotTabId: 'row-first',
        title: 'Duplicate identity',
        url: 'https://duplicate-identity.test/',
      },
    },
    now: 51,
  });
  assert.equal(duplicateIdentity.spaceSnapshots.focus, undefined);

  const urlTitleFallback = reduceTabLifecycleEvent({
    state,
    event: {
      type: 'updated',
      tabId: 42,
      binding: {
        provisional: true,
        trackingMode: 'live',
        sessionId: 'session-current',
        spaceId: 'focus',
        snapshotGroupId: 'focus-group',
        snapshotTabId: 'focus-row',
        title: '',
        url: 'https://title-fallback.test/',
      },
      targetGroup: { title: 'Focus', color: 'red' },
    },
    now: 52,
  });
  assert.equal(
    urlTitleFallback.spaceSnapshots.focus.groups[0].tabs[0].title,
    'https://title-fallback.test/',
  );

  const missingRowState = lifecycleState();
  missingRowState.tabLifecycle[10].snapshotTabId = 'missing-row';
  const replaced = reduceTabLifecycleEvent({
    state: missingRowState,
    event: {
      type: 'replaced',
      removedTabId: 10,
      addedTabId: 43,
      tab: { url: 'https://replacement-without-row.test/', title: 'Replacement' },
    },
    now: 53,
  });
  assert.deepEqual(replaced.spaceSnapshots, missingRowState.spaceSnapshots);
  assert.equal(replaced.tabLifecycle[43].snapshotTabId, 'missing-row');
});
