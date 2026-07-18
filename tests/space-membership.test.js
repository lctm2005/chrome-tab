import test from 'node:test';
import assert from 'node:assert/strict';

import { chromeGroupTitle } from '../src/shared/group-title.js';
import { resetChromeSessionBindings } from '../src/shared/state.js';

import {
  adoptUnassignedEntities,
  captureLiveSpaceOwnership,
  cleanupMissingEntities,
  closableTabsForSpace,
  closableTabsOutsideSpace,
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
} from '../src/shared/space-membership.js';

test('panel-only tab titles update and clear every durable copy used during refresh and Undo', () => {
  const matchingRow = {
    snapshotTabId: 'row-7',
    title: 'Page title',
    panelTitle: 'Old panel title',
    url: 'https://example.test/',
  };
  const unrelatedRow = {
    snapshotTabId: 'row-other',
    panelTitle: 'Unrelated title',
    url: 'https://other.test/',
  };
  const state = {
    renamedTabs: null,
    tabLifecycle: {
      7: {
        spaceId: 'work',
        snapshotGroupId: 'group-work',
        snapshotTabId: 'row-7',
        title: 'Page title',
        panelTitle: 'Old panel title',
      },
    },
    spaceSnapshots: {
      work: {
        groups: [
          { snapshotGroupId: 'group-work', tabs: [matchingRow, unrelatedRow] },
          { snapshotGroupId: 'group-other', tabs: [{ snapshotTabId: 'row-7', panelTitle: 'Other group' }] },
        ],
      },
    },
  };

  assert.equal(setLiveTabPanelTitle(state, 7, '  Restored   panel name  '), true);
  assert.equal(state.renamedTabs[7], 'Restored panel name');
  assert.equal(state.tabLifecycle[7].panelTitle, 'Restored panel name');
  assert.equal(state.tabLifecycle[7].title, 'Page title');
  assert.equal(matchingRow.panelTitle, 'Restored panel name');
  assert.equal(matchingRow.title, 'Page title');
  assert.equal(unrelatedRow.panelTitle, 'Unrelated title');

  assert.equal(setLiveTabPanelTitle(state, '7', '   '), true);
  assert.equal(Object.hasOwn(state.renamedTabs, 7), false);
  assert.equal(Object.hasOwn(state.tabLifecycle[7], 'panelTitle'), false);
  assert.equal(state.tabLifecycle[7].title, 'Page title');
  assert.equal(Object.hasOwn(matchingRow, 'panelTitle'), false);
  assert.equal(matchingRow.title, 'Page title');

  const unbound = {};
  assert.equal(setLiveTabPanelTitle(unbound, 8, 'Standalone'), true);
  assert.deepEqual(unbound.renamedTabs, { 8: 'Standalone' });
  assert.equal(setLiveTabPanelTitle(unbound, 'not-a-tab', 'Ignored'), false);
});

test('Restore Undo reinstates matching multi-window ownership and assigns changed or new tabs per window', () => {
  const spaces = [{ id: 'a' }, { id: 'b' }];
  const before = {
    spaces,
    activeSpaceId: 'a',
    tabSpaces: { 1: 'a', 2: 'b', 9: 'missing' },
    groupSpaces: { 20: 'b', 99: 'missing' },
    tabLifecycle: {
      1: {
        tabId: 1,
        spaceId: 'a',
        snapshotGroupId: 'group-a',
        snapshotTabId: 'tab-a',
        trackingMode: 'live',
        sessionId: 'session-1',
      },
      3: {
        tabId: 3,
        spaceId: 'b',
        snapshotGroupId: 'group-b',
        snapshotTabId: 'tab-b',
        trackingMode: 'saved-target',
        sessionId: 'session-1',
      },
    },
  };
  const originalTabs = [
    { id: 1, windowId: 1, groupId: -1, url: 'https://a.test/' },
    { id: 2, windowId: 2, groupId: -1, url: 'https://b.test/' },
    { id: 3, windowId: 2, groupId: 20, url: 'https://group.test/' },
    { id: 'bad', windowId: 2, groupId: -1, url: 'https://bad.test/' },
  ];
  const captured = captureLiveSpaceOwnership(before, originalTabs, [
    { id: 20, windowId: 2 },
    { id: 'bad', windowId: 2 },
  ]);
  assert.deepEqual(captured, {
    tabs: [
      { id: 1, windowId: 1, url: 'https://a.test/', spaceId: 'a' },
      { id: 2, windowId: 2, url: 'https://b.test/', spaceId: 'b' },
    ],
    groups: [{ id: 20, windowId: 2, spaceId: 'b' }],
    lifecycle: [
      {
        id: 1,
        windowId: 1,
        url: 'https://a.test/',
        binding: before.tabLifecycle[1],
      },
      {
        id: 3,
        windowId: 2,
        url: 'https://group.test/',
        binding: before.tabLifecycle[3],
      },
    ],
  });

  const restored = {
    spaces,
    activeSpaceId: 'a',
    tabSpaces: { 100: 'a' },
    groupSpaces: { 200: 'a' },
    groupOrder: {},
    tabOrder: {},
    collapsedGroups: {},
    tabGroups: {},
    virtualGroups: {},
    renamedTabs: {},
    tabLifecycle: {},
    spaceSnapshots: {
      a: {
        groups: [{
          snapshotGroupId: 'group-a',
          tabs: [{ snapshotTabId: 'tab-a', url: 'https://a.test/' }],
        }],
      },
      b: {
        groups: [{
          snapshotGroupId: 'group-b',
          tabs: [{ snapshotTabId: 'tab-b', url: 'https://group.test/' }],
        }],
      },
    },
  };
  const currentTabs = [
    { id: 1, windowId: 1, groupId: -1, pendingUrl: 'https://a.test/' },
    { id: 2, windowId: 2, groupId: -1, url: 'https://navigated.test/' },
    { id: 3, windowId: 2, groupId: 20, url: 'https://group.test/' },
    { id: 4, windowId: 2, groupId: -1, url: 'https://new.test/' },
  ];
  const result = restoreLiveSpaceOwnership(
    restored,
    currentTabs,
    [{ id: 20 }],
    captured,
    (windowId) => windowId === 2 ? 'b' : 'not-a-space',
  );

  assert.deepEqual(result, { restoredTabs: 1, restoredGroups: 1, restoredLifecycle: 2 });
  assert.deepEqual(restored.groupSpaces, { 20: 'b' });
  assert.deepEqual(restored.tabSpaces, { 1: 'a', 2: 'b', 4: 'b' });
  assert.deepEqual(restored.tabLifecycle, {
    1: {
      ...before.tabLifecycle[1],
      windowId: 1,
      groupId: -1,
      url: 'https://a.test/',
    },
    3: {
      ...before.tabLifecycle[3],
      windowId: 2,
      groupId: 20,
      url: 'https://group.test/',
    },
  });
});

test('Restore Undo rejects lifecycle bindings whose live page or saved identity no longer matches', () => {
  const state = {
    spaces: [{ id: 'a' }],
    activeSpaceId: 'a',
    groupSpaces: {},
    tabSpaces: {},
    tabLifecycle: { stale: true },
    groupOrder: {},
    tabOrder: {},
    collapsedGroups: {},
    tabGroups: {},
    virtualGroups: {},
    renamedTabs: {},
    spaceSnapshots: { a: { groups: [] } },
  };
  const result = restoreLiveSpaceOwnership(
    state,
    [{ id: 1, windowId: 1, groupId: -1, url: 'https://changed.test/' }],
    [],
    {
      lifecycle: [
        null,
        { id: 1, windowId: 1, url: 'https://old.test/', binding: {} },
        {
          id: 1,
          windowId: 1,
          url: 'https://changed.test/',
          binding: {
            spaceId: 'a',
            snapshotGroupId: 'missing-group',
            snapshotTabId: 'missing-tab',
          },
        },
      ],
    },
  );

  assert.equal(result.restoredLifecycle, 0);
  assert.deepEqual(state.tabLifecycle, {});
});

test('Restore Undo immediately restores an ungrouped manual title from its exact lifecycle identity', () => {
  const binding = {
    spaceId: 'work',
    snapshotGroupId: 'ungrouped-work',
    snapshotTabId: 'saved-reading',
    trackingMode: 'live',
  };
  const before = {
    spaces: [{ id: 'work' }],
    tabSpaces: { 7: 'work' },
    groupSpaces: {},
    tabLifecycle: { 7: binding },
  };
  const liveTabs = [{ id: 7, windowId: 2, groupId: -1, url: 'https://example.com/reading' }];
  const captured = captureLiveSpaceOwnership(before, liveTabs, []);
  const state = {
    spaces: [{ id: 'work' }],
    activeSpaceId: 'work',
    groupSpaces: {},
    tabSpaces: {},
    tabLifecycle: {},
    renamedTabs: {},
    groupOrder: {},
    tabOrder: {},
    collapsedGroups: {},
    tabGroups: {},
    virtualGroups: {},
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'ungrouped-work',
          title: 'Ungrouped',
          color: 'grey',
          restorable: true,
          tabs: [{
            snapshotTabId: 'saved-reading',
            panelTitle: '  Read   next  ',
            url: 'https://example.com/reading',
          }],
        }],
      },
    },
  };

  const result = restoreLiveSpaceOwnership(state, liveTabs, [], captured);

  assert.equal(result.restoredLifecycle, 1);
  assert.equal(state.renamedTabs[7], 'Read next');
});

test('live ownership capture and restore reject malformed/default records without inventing bindings', () => {
  assert.deepEqual(captureLiveSpaceOwnership({}, null, null), {
    tabs: [],
    groups: [],
    lifecycle: [],
  });
  assert.deepEqual(captureLiveSpaceOwnership({
    spaces: [null, {}, { id: 'work' }],
    groupSpaces: { 20: 'work', 21: '', 22: 'work' },
  }, [
    { id: 30, groupId: 20, windowId: 1, url: 'https://example.com/grouped' },
  ], null), {
    tabs: [],
    groups: [{ id: 20, windowId: 1, spaceId: 'work' }],
    lifecycle: [],
  });

  const emptyState = {};
  assert.deepEqual(restoreLiveSpaceOwnership(emptyState, null, null, {
    tabs: null,
    groups: null,
    lifecycle: null,
  }), {
    restoredTabs: 0,
    restoredGroups: 0,
    restoredLifecycle: 0,
  });
  assert.deepEqual(emptyState.renamedTabs, {});

  const liveTabs = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1,
    windowId: 1,
    groupId: -1,
    url: index === 10 ? '' : `https://example.com/${index + 1}`,
  }));
  liveTabs[10] = { id: 11, windowId: 1 };
  liveTabs.push({
    id: 30,
    windowId: 1,
    groupId: 20,
    url: 'https://example.com/grouped',
  });
  const state = {
    spaces: [null, {}, { id: 'work' }],
    activeSpaceId: 'missing',
    renamedTabs: { 9: 'Keep existing' },
    groupOrder: {},
    tabOrder: {},
    collapsedGroups: {},
    tabGroups: {},
    virtualGroups: {},
    spaceSnapshots: {
      work: {
        groups: [
          null,
          { snapshotGroupId: 'no-tabs' },
          {
            snapshotGroupId: 'group',
            tabs: [null, { snapshotTabId: 'tab', panelTitle: '' }],
          },
          {
            snapshotGroupId: 'duplicate',
            tabs: [
              { snapshotTabId: 'same', panelTitle: 'First' },
              { snapshotTabId: 'same', panelTitle: 'Second' },
            ],
          },
        ],
      },
    },
  };
  const malformedBindings = [
    null,
    'not-an-object',
    { snapshotGroupId: 'group', snapshotTabId: 'tab' },
    { spaceId: 'work', snapshotTabId: 'tab' },
    { spaceId: 'work', snapshotGroupId: 'group' },
    { spaceId: 'missing', snapshotGroupId: 'group', snapshotTabId: 'tab' },
    { spaceId: 'work', snapshotGroupId: 'no-tabs', snapshotTabId: 'tab' },
    { spaceId: 'work', snapshotGroupId: 'group', snapshotTabId: 'missing' },
    { spaceId: 'work', snapshotGroupId: 'group', snapshotTabId: 'tab' },
    { spaceId: 'work', snapshotGroupId: 'duplicate', snapshotTabId: 'same' },
    { spaceId: 'work', snapshotGroupId: 'group', snapshotTabId: 'tab' },
  ];
  const result = restoreLiveSpaceOwnership(state, liveTabs, [null, { id: 21, windowId: 2 }], {
    groups: [
      null,
      { id: 21, windowId: 1 },
      { id: 20, windowId: 1, spaceId: 'work' },
    ],
    tabs: [
      null,
      { id: 1, windowId: 1 },
      { id: 11, windowId: 1, spaceId: 'work' },
    ],
    lifecycle: malformedBindings.map((binding, index) => ({
      id: index + 1,
      windowId: 1,
      ...(index === 10 ? {} : { url: `https://example.com/${index + 1}` }),
      binding,
    })),
  }, () => '');

  assert.deepEqual(result, {
    restoredTabs: 1,
    restoredGroups: 1,
    restoredLifecycle: 3,
  });
  assert.equal(state.groupSpaces[20], 'work');
  assert.equal(state.tabLifecycle[11].groupId, -1);
  assert.deepEqual(state.renamedTabs, { 9: 'Keep existing' });
});

test('marks exact same-Space tabs in other windows one-to-one without mutating snapshots', () => {
  const dormantView = [{
    title: 'Research',
    tabs: [
      { id: 'saved:1', url: 'https://example.com/doc?copy=1' },
      { id: 'saved:2', url: 'https://example.com/doc?copy=2' },
      { id: 'saved:3', url: 'https://example.com/grouped' },
      { id: 'saved:4', url: 'https://example.com/missing' },
    ],
  }];
  const state = {
    groupSpaces: { 7: 'work' },
    tabSpaces: { 0: 'work', 2: 'work', 3: 'other', 4: 'work' },
    ephemeralTabIds: [4],
  };
  const result = markDormantTabsOpenInOtherWindows(dormantView, [
    { id: 2, groupId: -1, windowId: 20, url: 'https://example.com/doc?copy=2' },
    { id: 0, groupId: -1, windowId: 10, url: 'https://example.com/doc?copy=1' },
    { id: 5, groupId: 7, windowId: 30, url: 'https://example.com/grouped' },
    { id: 3, groupId: -1, windowId: 40, url: 'https://example.com/missing' },
    { id: 4, groupId: -1, windowId: 50, url: 'https://example.com/missing' },
    { id: '6', groupId: -1, windowId: 60, url: 'https://example.com/missing' },
  ], state, 'work');

  assert.deepEqual(result[0].tabs.map((tab) => [tab.foreignWindowTabId, tab.foreignWindowId]), [
    [0, 10],
    [2, 20],
    [5, 30],
    [undefined, undefined],
  ]);
  assert.equal(dormantView[0].tabs[0].foreignWindowTabId, undefined);
  assert.notStrictEqual(result[0], dormantView[0]);
  assert.notStrictEqual(result[0].tabs[0], dormantView[0].tabs[0]);
});

test('uses navigation fallback only after exact matches and consumes each foreign tab once', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: { 8: 'work', 9: 'work' },
  };
  const result = markDormantTabsOpenInOtherWindows([{
    tabs: [
      { url: 'https://example.com/doc?saved=1' },
      { url: 'https://example.com/doc?saved=2' },
      { url: 'https://example.com/already', foreignWindowTabId: 8, foreignWindowId: 1 },
    ],
  }], [
    { id: 9, groupId: -1, windowId: 2, url: 'https://example.com/doc?live=1#section' },
    { id: 8, groupId: -1, windowId: 3, url: 'https://example.com/already' },
  ], state, 'work');

  assert.equal(result[0].tabs[0].foreignWindowTabId, 9);
  assert.equal(result[0].tabs[1].foreignWindowTabId, undefined);
  assert.equal(result[0].tabs[2].foreignWindowTabId, 8);
  assert.equal(result[0].tabs[2].foreignWindowId, 1);
});

test('uses stable row identity before URL when equal URLs exist in different groups', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: { 9: 'work' },
  };
  const result = markDormantTabsOpenInOtherWindows([
    {
      title: 'Group A',
      snapshotGroupId: 'group-a',
      tabs: [{ snapshotTabId: 'row-a', url: 'https://same.test/page' }],
    },
    {
      title: 'Group B',
      snapshotGroupId: 'group-b',
      tabs: [{ snapshotTabId: 'row-b', url: 'https://same.test/page' }],
    },
  ], [{
    id: 9,
    groupId: -1,
    windowId: 2,
    snapshotGroupId: 'group-b',
    snapshotTabId: 'row-b',
    url: 'https://same.test/page?live-navigation=1',
  }], state, 'work');

  assert.equal(result[0].tabs[0].foreignWindowTabId, undefined);
  assert.equal(result[1].tabs[0].foreignWindowTabId, 9);
  assert.equal(result[1].tabs[0].foreignWindowId, 2);
});

test('does not let URL fallback override contradictory stable identities', () => {
  const state = { groupSpaces: {}, tabSpaces: { 9: 'work' } };
  const result = markDormantTabsOpenInOtherWindows([{
    snapshotGroupId: 'group-a',
    tabs: [{ snapshotTabId: 'row-a', url: 'https://same.test/page' }],
  }], [{
    id: 9,
    groupId: -1,
    snapshotGroupId: 'group-b',
    snapshotTabId: 'row-b',
    url: 'https://same.test/page',
  }], state, 'work');

  assert.equal(result[0].tabs[0].foreignWindowTabId, undefined);
});

test('prefers matching group identity for legacy rows without stable tab ids', () => {
  const state = { groupSpaces: {}, tabSpaces: { 8: 'work', 9: 'work' } };
  const result = markDormantTabsOpenInOtherWindows([
    {
      snapshotGroupId: 'group-a',
      tabs: [{ url: 'https://same.test/page' }],
    },
    {
      snapshotGroupId: 'group-b',
      tabs: [{ url: 'https://same.test/page' }],
    },
  ], [
    { id: 9, groupId: -1, windowId: 9, snapshotGroupId: 'group-b', url: 'https://same.test/page' },
    { id: 8, groupId: -1, windowId: 8, snapshotGroupId: 'group-a', url: 'https://same.test/page' },
  ], state, 'work');

  assert.equal(result[0].tabs[0].foreignWindowTabId, 8);
  assert.equal(result[1].tabs[0].foreignWindowTabId, 9);
});

test('repairs malformed cross-window inputs to an empty cloned view', () => {
  assert.deepEqual(markDormantTabsOpenInOtherWindows(null, null, null, 'work'), []);
  assert.deepEqual(markDormantTabsOpenInOtherWindows([{ title: 'Empty', tabs: null }], {}, {}, 'work'), [
    { title: 'Empty', tabs: [] },
  ]);
  assert.deepEqual(markDormantTabsOpenInOtherWindows([{ tabs: [{ url: '' }] }], [
    { id: 1, groupId: -1, url: '' },
  ], { tabSpaces: { 1: 'work' } }, 'work'), [{ tabs: [{ url: '' }] }]);
});

test('adopts new ungrouped tabs without auto-adopting Chrome groups', () => {
  const state = {
    groupSpaces: { 7: 'work' },
    tabSpaces: { 4: 'work', 99: 'stale' },
    renamedTabs: { 99: 'Gone' },
    collapsedGroups: {},
  };

  adoptUnassignedEntities(state, [
    { id: 1, groupId: 7 },
    { id: 2, groupId: 8 },
    { id: 3, groupId: -1 },
    { id: 4, groupId: -1 },
  ], [
    { id: 7 },
    { id: 8 },
  ], 'focus');

  assert.equal(state.groupSpaces[7], 'work');
  assert.equal(state.groupSpaces[8], undefined);
  assert.equal(state.tabSpaces[3], 'focus');
  assert.equal(state.tabSpaces[4], 'work');
  assert.equal(state.tabSpaces[99], undefined);
  assert.equal(state.renamedTabs[99], undefined);
});

test('can explicitly adopt new Chrome groups into the active Space', () => {
  const state = {
    groupSpaces: { 7: 'work' },
    tabSpaces: {},
    renamedTabs: {},
    collapsedGroups: {},
  };

  adoptUnassignedEntities(state, [
    { id: 1, groupId: 7 },
    { id: 2, groupId: 8 },
  ], [
    { id: 7 },
    { id: 8 },
  ], 'focus', { adoptGroups: true });

  assert.equal(state.groupSpaces[7], 'work');
  assert.equal(state.groupSpaces[8], 'focus');
});

test('uses Chrome tab group ownership over stale local tab ownership', () => {
  const state = {
    groupSpaces: { 0: 'work' },
    tabSpaces: { 1: 'stale' },
    renamedTabs: {},
    collapsedGroups: {},
  };

  adoptUnassignedEntities(state, [
    { id: 1, groupId: 0 },
  ], [
    { id: 0 },
  ], 'focus');

  assert.equal(state.groupSpaces[0], 'work');
  assert.equal(state.tabSpaces[1], undefined);
  assert.deepEqual(closableTabsForSpace([
    { id: 1, groupId: 0 },
  ], state, 'work', () => true).map((tab) => tab.id), [1]);
});

test('adopts a new Chrome group when it contains an owned local tab', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: { 1: 'focus' },
    renamedTabs: {},
    collapsedGroups: {},
    groupOrder: { focus: [] },
  };

  adoptUnassignedEntities(state, [
    { id: 1, groupId: 9 },
    { id: 2, groupId: 9 },
  ], [
    { id: 9 },
  ], 'default');

  assert.deepEqual(state.groupSpaces, { 9: 'focus' });
  assert.deepEqual(state.tabSpaces, {});
  assert.deepEqual(state.groupOrder.focus, ['group:9']);
});

test('adopts the active Chrome group when local group ownership was lost', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    collapsedGroups: {},
    groupOrder: { default: [] },
  };

  adoptUnassignedEntities(state, [
    { id: 1, groupId: 9, active: true },
    { id: 2, groupId: 9, active: false },
    { id: 3, groupId: -1, active: false },
  ], [
    { id: 9 },
  ], 'default');

  assert.deepEqual(state.groupSpaces, { 9: 'default' });
  assert.deepEqual(state.tabSpaces, { 3: 'default' });
  assert.deepEqual(state.groupOrder.default, ['group:9']);
});

test('syncs Chrome tab group collapsed state into Space state', () => {
  const state = { collapsedGroups: { 'group:7': false } };

  syncCollapsedGroupsFromChrome(state, [
    { id: 7, collapsed: true },
    { id: 8, collapsed: false },
  ]);

  assert.equal(state.collapsedGroups['group:7'], true);
  assert.equal(state.collapsedGroups['group:8'], false);
});

test('cleans missing Chrome ownership while retaining lifecycle bindings for queued removal events', () => {
  const state = {
    groupSpaces: { 7: 'work', 8: 'focus' },
    tabSpaces: { 4: 'work', 9: 'focus' },
    renamedTabs: { 9: 'Gone' },
    tabLifecycle: {
      4: { snapshotTabId: 'row-4', spaceId: 'work' },
      9: { snapshotTabId: 'row-9', spaceId: 'focus' },
    },
  };

  cleanupMissingEntities(state, [
    { id: 4, groupId: -1 },
  ], [
    { id: 7 },
  ]);

  assert.deepEqual(state.groupSpaces, { 7: 'work' });
  assert.deepEqual(state.tabSpaces, { 4: 'work' });
  assert.deepEqual(state.renamedTabs, {});
  assert.deepEqual(state.tabLifecycle, {
    4: { snapshotTabId: 'row-4', spaceId: 'work' },
    9: { snapshotTabId: 'row-9', spaceId: 'focus' },
  });
});

function lifecycleInventoryCleanupState() {
  return {
    browserSessionId: 'session-current',
    groupSpaces: {},
    tabSpaces: { 4: 'work', 5: 'work' },
    renamedTabs: { 4: 'First copy', 5: 'Second copy' },
    tabGroups: { 4: 'vgroup:first', 5: 'vgroup:second' },
    virtualGroups: {
      'vgroup:first': { title: 'First', spaceId: 'work' },
      'vgroup:second': { title: 'Second', spaceId: 'work' },
    },
    ephemeralTabIds: [4, 5, 99],
    tabOrder: { work: { 'group:loose': [4, 5, 99] } },
    tabLifecycle: {
      4: {
        tabId: 4,
        snapshotTabId: 'row-first',
        snapshotGroupId: 'group-loose',
        spaceId: 'work',
        windowId: 1,
        groupId: -1,
        url: 'https://same.test/page',
        sessionId: 'session-current',
      },
      5: {
        tabId: 5,
        snapshotTabId: 'row-second',
        snapshotGroupId: 'group-loose',
        spaceId: 'work',
        windowId: 1,
        groupId: -1,
        url: 'https://same.test/page',
        sessionId: 'session-current',
      },
    },
    spaceSnapshots: {
      work: {
        version: 1,
        identityVersion: 1,
        updatedAt: 1,
        groups: [{
          snapshotGroupId: 'group-loose',
          title: 'Ungrouped',
          color: 'grey',
          restorable: true,
          tabs: [
            { snapshotTabId: 'row-first', title: 'First', url: 'https://same.test/page' },
            { snapshotTabId: 'row-second', title: 'Second', url: 'https://same.test/page' },
          ],
        }],
      },
    },
  };
}

test('ambiguous missing lifecycle tabs are deferred once while their prior window is still live', () => {
  const state = lifecycleInventoryCleanupState();
  state.tabLifecycle[10] = {
    tabId: 10,
    snapshotTabId: '',
    windowId: 1,
    sessionId: '',
  };
  state.tabLifecycle[6] = { tabId: 6, windowId: 1, snapshotTabId: 'pending-row' };
  state.tabLifecycle[7] = { tabId: 7, windowId: 1, snapshotTabId: 'suppressed-row' };
  state.tabLifecycle[8] = { tabId: 8, windowId: 2, snapshotTabId: 'closed-window-row' };
  state.tabLifecycle[9] = { tabId: 9, windowId: 'not-a-window', snapshotTabId: 'unknown-row' };
  state.tabLifecycle.invalid = { windowId: 1 };
  const options = {
    existingTabIds: [5, null],
    existingWindowIds: [1, 'invalid'],
    pendingLifecycleTabIds: [6, null],
    suppressedLifecycleTabIds: [7, Number.NaN],
  };
  const prior = {
    4: {
      identity: JSON.stringify([
        'session-current',
        'work',
        'group-loose',
        'row-first',
        '',
        1,
        '-1',
        'https://same.test/page',
      ]),
      firstObservedAt: 900,
      lastObservedAt: 950,
    },
    10: { identity: 'stale-identity', firstObservedAt: 700, lastObservedAt: 950 },
    99: { identity: 'no-longer-bound', firstObservedAt: 1, lastObservedAt: 2 },
  };
  const beforeState = structuredClone(state);
  const beforeOptions = structuredClone(options);
  const beforePrior = structuredClone(prior);

  const result = planLifecycleCleanupDeferral(state, options, prior, 1_000, 500);

  assert.deepEqual(result, {
    deferredTabIds: [4, 10],
    observations: {
      4: {
        identity: JSON.stringify([
          'session-current',
          'work',
          'group-loose',
          'row-first',
          '',
          1,
          '-1',
          'https://same.test/page',
        ]),
        firstObservedAt: 900,
        lastObservedAt: 1_000,
      },
      10: {
        identity: JSON.stringify(['', '', '', '', '', 1, '', '']),
        firstObservedAt: 1_000,
        lastObservedAt: 1_000,
      },
    },
  });
  assert.deepEqual(state, beforeState, 'planning does not mutate persisted lifecycle state');
  assert.deepEqual(options, beforeOptions, 'planning does not mutate the inventory response');
  assert.deepEqual(prior, beforePrior, 'planning does not mutate observations from the prior refresh');
});

test('ambiguous lifecycle cleanup is confirmed at the grace boundary and identity changes restart it', () => {
  const state = lifecycleInventoryCleanupState();
  const options = {
    existingTabIds: [5],
    existingWindowIds: [1],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [],
  };
  const first = planLifecycleCleanupDeferral(state, options, {}, 1_000, 500);
  assert.deepEqual(first.deferredTabIds, [4]);

  const withinGrace = planLifecycleCleanupDeferral(state, options, first.observations, 1_499, 500);
  assert.equal(withinGrace.observations[4].firstObservedAt, 1_000);
  assert.equal(withinGrace.observations[4].lastObservedAt, 1_499);
  assert.deepEqual(withinGrace.deferredTabIds, [4]);

  const atBoundary = planLifecycleCleanupDeferral(state, options, first.observations, 1_500, 500);
  assert.deepEqual(atBoundary, { deferredTabIds: [], observations: {} });

  const changedState = structuredClone(state);
  changedState.tabLifecycle[4].snapshotTabId = 'replacement-row';
  const changedIdentity = planLifecycleCleanupDeferral(
    changedState,
    options,
    first.observations,
    1_500,
    500,
  );
  assert.deepEqual(changedIdentity, {
    deferredTabIds: [4],
    observations: {
      4: {
        identity: JSON.stringify([
          'session-current',
          'work',
          'group-loose',
          'replacement-row',
          '',
          1,
          '-1',
          'https://same.test/page',
        ]),
        firstObservedAt: 1_500,
        lastObservedAt: 1_500,
      },
    },
  });

  const futureObservation = {
    4: {
      identity: changedIdentity.observations[4].identity,
      firstObservedAt: 1_501,
      lastObservedAt: 1_501,
    },
  };
  assert.equal(planLifecycleCleanupDeferral(
    changedState,
    options,
    futureObservation,
    1_500,
    500,
  ).observations[4].firstObservedAt, 1_500);

  const invalidObservation = {
    4: {
      identity: changedIdentity.observations[4].identity,
      firstObservedAt: 'invalid',
      lastObservedAt: 1_500,
    },
  };
  assert.equal(planLifecycleCleanupDeferral(
    changedState,
    options,
    invalidObservation,
    1_500,
    500,
  ).observations[4].firstObservedAt, 1_500);

  assert.deepEqual(planLifecycleCleanupDeferral(state, options, first.observations, 1_000, 0), {
    deferredTabIds: [],
    observations: {},
  });

  const afterLongSamplingGap = planLifecycleCleanupDeferral(
    state,
    options,
    first.observations,
    7_000,
    500,
    5_000,
  );
  assert.equal(afterLongSamplingGap.observations[4].firstObservedAt, 7_000);
  assert.equal(afterLongSamplingGap.observations[4].lastObservedAt, 7_000);

  for (const [field, value] of [
    ['sessionId', 'next-session'],
    ['spaceId', 'next-space'],
    ['snapshotGroupId', 'next-group'],
    ['trackingMode', 'saved-target'],
    ['groupId', 42],
    ['url', 'https://changed.test/page'],
  ]) {
    const moved = structuredClone(state);
    moved.tabLifecycle[4][field] = value;
    const restarted = planLifecycleCleanupDeferral(
      moved,
      options,
      first.observations,
      1_500,
      500,
    );
    assert.equal(restarted.observations[4].firstObservedAt, 1_500, `${field} restarts grace`);
  }
});

test('deferral protects the exact row until a consecutive authoritative refresh confirms closure', () => {
  const state = lifecycleInventoryCleanupState();
  const liveTabs = [
    { id: 5, groupId: -1, windowId: 1, url: 'https://same.test/page' },
  ];
  const inventory = {
    existingTabIds: [5],
    existingWindowIds: [1],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [],
    existingGroupIds: [],
  };
  const before = structuredClone(state);
  const first = planLifecycleCleanupDeferral(state, inventory, {}, 1_000, 500);

  cleanupMissingEntities(state, liveTabs, [], {
    ...inventory,
    pendingLifecycleTabIds: first.deferredTabIds,
  });
  assert.deepEqual(state, before, 'the first ambiguous inventory cannot remove user data');

  const confirmed = planLifecycleCleanupDeferral(
    state,
    inventory,
    first.observations,
    1_500,
    500,
  );
  assert.deepEqual(confirmed, { deferredTabIds: [], observations: {} });
  cleanupMissingEntities(state, liveTabs, [], inventory);
  assert.deepEqual(Object.keys(state.tabLifecycle), ['5']);
  assert.deepEqual(state.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-second',
  ]);
});

test('authoritative lifecycle deferral clears observations when ambiguity disappears', () => {
  const state = lifecycleInventoryCleanupState();
  const prior = {
    4: {
      identity: JSON.stringify([
        'session-current',
        'work',
        'group-loose',
        'row-first',
        '',
        1,
        '-1',
        'https://same.test/page',
      ]),
      firstObservedAt: 1_000,
      lastObservedAt: 1_000,
    },
  };
  const base = {
    existingTabIds: [5],
    existingWindowIds: [1],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [],
  };
  const variants = [
    { ...base, existingTabIds: [4, 5] },
    { ...base, existingWindowIds: [] },
    { ...base, pendingLifecycleTabIds: [4] },
    { ...base, suppressedLifecycleTabIds: [4] },
  ];
  for (const options of variants) {
    assert.deepEqual(planLifecycleCleanupDeferral(state, options, prior, 1_100, 500), {
      deferredTabIds: [],
      observations: {},
    });
  }
});

test('lifecycle cleanup deferral fails safe for incomplete inventories and invalid clocks', () => {
  const state = lifecycleInventoryCleanupState();
  const complete = {
    existingTabIds: [],
    existingWindowIds: [1],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [],
  };
  const invalidInputs = [
    {},
    { ...complete, existingTabIds: null },
    { ...complete, existingWindowIds: null },
    { ...complete, pendingLifecycleTabIds: null },
    { ...complete, suppressedLifecycleTabIds: null },
  ];
  for (const options of invalidInputs) {
    assert.deepEqual(planLifecycleCleanupDeferral(state, options, {}, 1_000, 500), {
      deferredTabIds: [],
      observations: {},
    });
  }
  for (const [now, graceMs, maxGapMs] of [
    [Number.NaN, 500, 5_000],
    [1_000, Infinity, 5_000],
    [1_000, -1, 5_000],
    [1_000, 500, Infinity],
    [1_000, 500, -1],
  ]) {
    assert.deepEqual(planLifecycleCleanupDeferral(
      state,
      complete,
      {},
      now,
      graceMs,
      maxGapMs,
    ), {
      deferredTabIds: [],
      observations: {},
    });
  }

  assert.deepEqual(planLifecycleCleanupDeferral(undefined, complete, [], '1000', '500'), {
    deferredTabIds: [],
    observations: {},
  });
  assert.deepEqual(planLifecycleCleanupDeferral({}, complete, null, 1_000, 500), {
    deferredTabIds: [],
    observations: {},
  });
  assert.deepEqual(planLifecycleCleanupDeferral({}, undefined, undefined), {
    deferredTabIds: [],
    observations: {},
  });
});

test('authoritative inventory removes only the missing stable row when duplicate URLs remain live', () => {
  const state = lifecycleInventoryCleanupState();
  const originalState = state;

  cleanupMissingEntities(state, [
    { id: 5, groupId: -1, windowId: 1, url: 'https://same.test/page' },
  ], [], {
    existingTabIds: [5, null],
    existingWindowIds: [1, 'invalid'],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [],
    existingGroupIds: [],
  });

  assert.equal(state, originalState, 'cleanup preserves the caller-owned state object');
  assert.deepEqual(Object.keys(state.tabLifecycle), ['5']);
  assert.deepEqual(state.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-second',
  ]);
  assert.deepEqual(state.tabSpaces, { 5: 'work' });
  assert.deepEqual(state.renamedTabs, { 5: 'Second copy' });
  assert.deepEqual(state.tabGroups, { 5: 'vgroup:second' });
  assert.deepEqual(state.virtualGroups, {
    'vgroup:second': { title: 'Second', spaceId: 'work' },
  });
  assert.deepEqual(state.ephemeralTabIds, [5, 99]);
  assert.deepEqual(state.tabOrder, { work: { 'group:loose': [5, 99] } });
  assert.ok(state.spaceSnapshots.work.updatedAt > 1);
});

test('pending lifecycle ids retain every transferable map and stable duplicate row', () => {
  const state = lifecycleInventoryCleanupState();
  const before = structuredClone(state);

  cleanupMissingEntities(state, [
    { id: 5, groupId: -1, windowId: 1, url: 'https://same.test/page' },
  ], [], {
    existingTabIds: [5],
    existingWindowIds: [1],
    pendingLifecycleTabIds: [4, null, Number.NaN],
    suppressedLifecycleTabIds: [4],
    existingGroupIds: [],
  });

  assert.deepEqual(state, before);
});

test('present lifecycle ids retain bindings and duplicate snapshot rows unchanged', () => {
  const state = lifecycleInventoryCleanupState();
  const before = structuredClone(state);

  cleanupMissingEntities(state, [
    { id: 4, groupId: -1, windowId: 1, url: 'https://same.test/page' },
    { id: 5, groupId: -1, windowId: 1, url: 'https://same.test/page' },
  ], [], {
    existingTabIds: [4, 5],
    existingWindowIds: [1],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [],
    existingGroupIds: [],
  });

  assert.deepEqual(state, before);
});

test('lifecycle reconciliation stays fail-safe without an explicit suppression inventory', () => {
  const state = lifecycleInventoryCleanupState();

  cleanupMissingEntities(state, [
    { id: 5, groupId: -1, windowId: 1, url: 'https://same.test/page' },
  ], [], {
    existingTabIds: [5],
    existingWindowIds: [1],
    pendingLifecycleTabIds: [],
    existingGroupIds: [],
  });

  assert.deepEqual(Object.keys(state.tabLifecycle).sort(), ['4', '5']);
  assert.deepEqual(state.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-first',
    'row-second',
  ]);

  const withoutBindings = { tabLifecycle: null };
  assert.doesNotThrow(() => cleanupMissingEntities(withoutBindings, [], [], {
    existingTabIds: [],
    existingWindowIds: [],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [],
    existingGroupIds: [],
  }));
  assert.equal(withoutBindings.tabLifecycle, null);
});

test('authoritative inventory retains saved rows when their whole Chrome window closed', () => {
  const state = lifecycleInventoryCleanupState();
  state.tabLifecycle[5].windowId = 2;
  state.tabLifecycle[6] = null;
  state.tabSpaces[6] = 'work';
  state.tabOrder.work['group:loose'].push(6);
  state.ephemeralTabIds.push(6);
  state.tabLifecycle.invalid = { windowId: 2 };

  cleanupMissingEntities(state, [
    { id: 5, groupId: -1, windowId: 2, url: 'https://same.test/page' },
  ], [], {
    existingTabIds: [5],
    existingWindowIds: [2],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [],
    existingGroupIds: [],
  });

  assert.deepEqual(Object.keys(state.tabLifecycle).sort(), ['5', 'invalid']);
  assert.deepEqual(state.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-first',
    'row-second',
  ]);
  assert.deepEqual(state.tabSpaces, { 5: 'work' });
  assert.deepEqual(state.ephemeralTabIds, [5, 99]);
  assert.deepEqual(state.tabOrder, { work: { 'group:loose': [5, 99] } });
});

test('a missing tab with no trustworthy prior window preserves its saved stable row', () => {
  const state = lifecycleInventoryCleanupState();
  delete state.tabLifecycle[4].windowId;

  cleanupMissingEntities(state, [
    { id: 5, groupId: -1, windowId: 1, url: 'https://same.test/page' },
  ], [], {
    existingTabIds: [5],
    existingWindowIds: [1],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [],
    existingGroupIds: [],
  });

  assert.deepEqual(Object.keys(state.tabLifecycle), ['5']);
  assert.deepEqual(state.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-first',
    'row-second',
  ]);
  assert.deepEqual(state.tabSpaces, { 5: 'work' });
  assert.deepEqual(state.renamedTabs, { 5: 'Second copy' });
  assert.deepEqual(state.tabGroups, { 5: 'vgroup:second' });
});

test('an absent panel-suppressed tab clears live metadata but keeps its exact saved row', () => {
  const state = lifecycleInventoryCleanupState();

  cleanupMissingEntities(state, [
    { id: 5, groupId: -1, windowId: 1, url: 'https://same.test/page' },
  ], [], {
    existingTabIds: [5],
    existingWindowIds: [1],
    pendingLifecycleTabIds: [],
    suppressedLifecycleTabIds: [4, null, Number.NaN],
    existingGroupIds: [],
  });

  assert.deepEqual(Object.keys(state.tabLifecycle), ['5']);
  assert.deepEqual(state.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-first',
    'row-second',
  ]);
  assert.deepEqual(state.tabSpaces, { 5: 'work' });
  assert.deepEqual(state.renamedTabs, { 5: 'Second copy' });
  assert.deepEqual(state.tabGroups, { 5: 'vgroup:second' });
  assert.deepEqual(state.ephemeralTabIds, [5, 99]);
  assert.deepEqual(state.tabOrder, { work: { 'group:loose': [5, 99] } });
});

test('keeps ownership metadata for entities that still exist in another Chrome window', () => {
  const state = {
    groupSpaces: { 7: 'window-a', 8: 'window-b' },
    tabSpaces: { 4: 'window-a', 5: 'window-b' },
    renamedTabs: { 4: 'A tab', 5: 'B tab' },
    tabLifecycle: {
      4: { snapshotTabId: 'row-a', spaceId: 'window-a' },
      5: { snapshotTabId: 'row-b', spaceId: 'window-b' },
    },
    tabGroups: { 4: 'vgroup:a', 5: 'vgroup:b' },
    virtualGroups: {
      'vgroup:a': { title: 'A', spaceId: 'window-a' },
      'vgroup:b': { title: 'B', spaceId: 'window-b' },
    },
  };

  cleanupMissingEntities(state, [
    { id: 4, groupId: -1, windowId: 1 },
  ], [
    { id: 7, windowId: 1 },
  ], {
    existingTabIds: [4, 5],
    existingGroupIds: [7, 8],
  });

  assert.deepEqual(state.groupSpaces, { 7: 'window-a', 8: 'window-b' });
  assert.deepEqual(state.tabSpaces, { 4: 'window-a', 5: 'window-b' });
  assert.deepEqual(state.renamedTabs, { 4: 'A tab', 5: 'B tab' });
  assert.deepEqual(state.tabGroups, { 4: 'vgroup:a', 5: 'vgroup:b' });
  assert.deepEqual(state.tabLifecycle, {
    4: { snapshotTabId: 'row-a', spaceId: 'window-a' },
    5: { snapshotTabId: 'row-b', spaceId: 'window-b' },
  });
  assert.deepEqual(state.virtualGroups, {
    'vgroup:a': { title: 'A', spaceId: 'window-a' },
    'vgroup:b': { title: 'B', spaceId: 'window-b' },
  });
});

test('cleans missing foreign-window metadata without racing its lifecycle removal journal', () => {
  const state = {
    groupSpaces: { 7: 'window-a', 8: 'window-b' },
    tabSpaces: { 4: 'window-a', 5: 'window-b' },
    renamedTabs: { 4: 'A tab', 5: 'B tab' },
    tabLifecycle: {
      4: { snapshotTabId: 'row-a', spaceId: 'window-a' },
      5: { snapshotTabId: 'row-b', spaceId: 'window-b' },
    },
    tabGroups: { 4: 'vgroup:a', 5: 'vgroup:b' },
    virtualGroups: {
      'vgroup:a': { title: 'A', spaceId: 'window-a' },
      'vgroup:b': { title: 'B', spaceId: 'window-b' },
    },
  };

  cleanupMissingEntities(state, [
    { id: 4, groupId: -1, windowId: 1 },
  ], [
    { id: 7, windowId: 1 },
  ], {
    existingTabIds: [4],
    existingGroupIds: [7],
  });

  assert.deepEqual(state.groupSpaces, { 7: 'window-a' });
  assert.deepEqual(state.tabSpaces, { 4: 'window-a' });
  assert.deepEqual(state.renamedTabs, { 4: 'A tab' });
  assert.deepEqual(state.tabGroups, { 4: 'vgroup:a' });
  assert.deepEqual(state.tabLifecycle, {
    4: { snapshotTabId: 'row-a', spaceId: 'window-a' },
    5: { snapshotTabId: 'row-b', spaceId: 'window-b' },
  });
  assert.deepEqual(state.virtualGroups, {
    'vgroup:a': { title: 'A', spaceId: 'window-a' },
  });
});

test('adopts local-window entities without deleting metadata from another live window', () => {
  const state = {
    groupSpaces: { 8: 'window-b' },
    tabSpaces: { 5: 'window-b' },
    renamedTabs: { 5: 'B tab' },
    tabGroups: { 5: 'vgroup:b' },
    virtualGroups: {
      'vgroup:b': { title: 'B', spaceId: 'window-b' },
    },
    groupOrder: { 'window-a': [], 'window-b': [] },
  };

  adoptUnassignedEntities(state, [
    { id: 4, groupId: 7, active: true, windowId: 1 },
  ], [
    { id: 7, windowId: 1 },
  ], 'window-a', {
    adoptGroups: true,
    existingTabIds: [4, 5],
    existingGroupIds: [7, 8],
  });

  assert.deepEqual(state.groupSpaces, { 7: 'window-a', 8: 'window-b' });
  assert.deepEqual(state.tabSpaces, { 5: 'window-b' });
  assert.deepEqual(state.renamedTabs, { 5: 'B tab' });
  assert.deepEqual(state.tabGroups, { 5: 'vgroup:b' });
  assert.deepEqual(state.virtualGroups, {
    'vgroup:b': { title: 'B', spaceId: 'window-b' },
  });
});

test('keeps Chrome group ownership when live tabs still reference the group', () => {
  const state = {
    groupSpaces: { 7: 'work' },
    tabSpaces: {},
    renamedTabs: {},
  };

  cleanupMissingEntities(state, [
    { id: 4, groupId: 7 },
  ], []);

  assert.deepEqual(state.groupSpaces, { 7: 'work' });
});

test('cleans local virtual group mappings for closed tabs', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: { 4: 'work', 9: 'work' },
    tabGroups: { 4: 'vgroup:docs', 9: 'vgroup:stale' },
    virtualGroups: {
      'vgroup:docs': { title: 'Docs', color: 'blue', spaceId: 'work' },
      'vgroup:stale': { title: 'Stale', color: 'grey', spaceId: 'work' },
    },
    renamedTabs: { 9: 'Gone' },
  };

  cleanupMissingEntities(state, [
    { id: 4, groupId: -1 },
  ], []);

  assert.deepEqual(state.tabSpaces, { 4: 'work' });
  assert.deepEqual(state.tabGroups, { 4: 'vgroup:docs' });
  assert.deepEqual(state.virtualGroups, {
    'vgroup:docs': { title: 'Docs', color: 'blue', spaceId: 'work' },
  });
  assert.deepEqual(state.renamedTabs, {});
});

test('cleans stale virtual mappings from grouped live tabs', () => {
  const state = {
    groupSpaces: { 8: 'work' },
    tabSpaces: { 4: 'work' },
    tabGroups: { 4: 'vgroup:old' },
    virtualGroups: {
      'vgroup:old': { title: 'Old', color: 'blue', spaceId: 'work' },
    },
    renamedTabs: {},
  };

  cleanupMissingEntities(state, [
    { id: 4, groupId: 8 },
  ], [
    { id: 8 },
  ]);

  assert.deepEqual(state.tabSpaces, { 4: 'work' });
  assert.deepEqual(state.tabGroups, {});
  assert.deepEqual(state.virtualGroups, {});
});

test('treats missing snapshots as a no-op and repairs damaged ownership maps before restore', () => {
  assert.deepEqual(restoreSnapshotOwnership(null), {
    groupTitles: {},
    renamedTabs: {},
  });

  const state = {
    groupSpaces: null,
    tabSpaces: null,
    spaceSnapshots: {
      work: {
        groups: [{
          title: 'Docs',
          color: 'blue',
          tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
        }],
      },
    },
  };

  restoreSnapshotOwnership(state, [
    { id: 4, groupId: -1, url: 'https://example.com/spec' },
  ], []);

  assert.deepEqual(state.groupSpaces, {});
  assert.deepEqual(state.tabSpaces, { 4: 'work' });
});

test('skips already-owned and empty Chrome groups and tolerates unavailable Chrome lists', () => {
  const state = {
    groupSpaces: { 1: 'existing' },
    tabSpaces: {},
    groupOrder: {},
    spaceSnapshots: {
      work: {
        groups: [{
          title: 'Docs',
          color: 'blue',
          tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
        }],
      },
    },
  };

  restoreSnapshotOwnership(state, null, null);
  restoreSnapshotOwnership(state, [
    { id: 30, groupId: 3, url: '' },
  ], [
    { id: 1, title: 'Docs', color: 'blue' },
    { id: 2, title: 'Docs', color: 'blue' },
    { id: 3, title: 'Docs', color: 'blue' },
  ]);

  assert.deepEqual(state.groupSpaces, { 1: 'existing' });
  assert.deepEqual(state.tabSpaces, {});
});

test('already-owned Chrome groups still restore logical titles and panel names', () => {
  const state = {
    groupSpaces: { 7: 'work' },
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'durable-docs',
          title: 'A full logical group title that is longer than Chrome shows',
          color: 'blue',
          tabs: [{
            snapshotTabId: 'durable-spec',
            panelTitle: 'Product specification',
            url: 'https://example.com/spec',
          }],
        }],
      },
      other: {
        groups: [{
          snapshotGroupId: 'other-docs',
          title: 'Wrong Space title',
          color: 'blue',
          tabs: [{ url: 'https://example.com/spec' }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [{
    id: 70,
    groupId: 7,
    snapshotGroupId: 'durable-docs',
    snapshotTabId: 'durable-spec',
    url: 'https://example.com/spec',
  }], [{ id: 7, title: 'A full logical group titl~abc123', color: 'blue' }]);

  assert.deepEqual(state.groupSpaces, { 7: 'work' });
  assert.deepEqual(state.renamedTabs, { 70: 'Product specification' });
  assert.deepEqual(state.groupOrder.work, ['group:7']);
  assert.deepEqual(metadata, {
    groupTitles: { 7: 'A full logical group title that is longer than Chrome shows' },
    renamedTabs: { 70: 'Product specification' },
  });
});

test('restores an explicitly untitled Chrome group without matching missing-title fallbacks', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [], fallback: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'untitled-group',
          title: '',
          color: 'cyan',
          tabs: [{ url: 'https://example.com/shared' }],
        }],
      },
      fallback: {
        groups: [{
          color: 'cyan',
          tabs: [{ url: 'https://example.com/shared' }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [{
    id: 70,
    groupId: 7,
    url: 'https://example.com/shared',
  }], [{ id: 7, title: '', color: 'cyan' }]);

  assert.deepEqual(state.groupSpaces, { 7: 'work' });
  assert.deepEqual(state.groupOrder, { work: ['group:7'], fallback: [] });
  assert.deepEqual(metadata, {
    groupTitles: { 7: '' },
    renamedTabs: {},
  });

  const ambiguous = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { one: [], two: [] },
    spaceSnapshots: {
      one: { groups: [{ title: '', color: 'cyan', tabs: [{ url: 'https://example.com/shared' }] }] },
      two: { groups: [{ title: '', color: 'cyan', tabs: [{ url: 'https://example.com/shared' }] }] },
    },
  };
  assert.deepEqual(restoreSnapshotOwnership(ambiguous, [{
    id: 80,
    groupId: 8,
    url: 'https://example.com/shared',
  }], [{ id: 8, title: '', color: 'cyan' }]), {
    groupTitles: {},
    renamedTabs: {},
  });
  assert.deepEqual(ambiguous.groupSpaces, {});
});

test('restores default group metadata after mismatches, zero overlap, and duplicate same-Space candidates', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    groupOrder: {},
    spaceSnapshots: {
      empty: {},
      mismatch: {
        groups: [{
          title: 'Other',
          color: 'blue',
          tabs: [{ url: 'https://example.com/live' }],
        }],
      },
      zero: {
        groups: [{ tabs: [{ url: 'https://example.com/other' }] }],
      },
      defaults: {
        groups: [
          { tabs: [{ url: 'https://example.com/live' }, { url: 'https://example.com/live' }] },
          { tabs: [{ url: 'https://example.com/live' }] },
          { title: 'Ungrouped', tabs: [{ url: 'https://example.com/temporary' }] },
          { title: 'Empty', color: 'orange' },
          { title: 'Missing URL', color: 'red', tabs: [{}] },
        ],
      },
    },
  };

  restoreSnapshotOwnership(state, [
    { id: 10, groupId: 99, url: 'https://example.com/live' },
  ], [
    { id: 99 },
  ]);

  assert.deepEqual(state.groupSpaces, { 99: 'defaults' });
  assert.deepEqual(state.groupOrder, { defaults: ['group:99'] });
});

test('restores ownership even when damaged state has no group ordering collection', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    spaceSnapshots: {
      work: {
        groups: [{
          title: 'Docs',
          color: 'blue',
          tabs: [{ url: 'https://example.com/spec' }],
        }],
      },
    },
  };

  restoreSnapshotOwnership(state, [
    { id: 10, groupId: 99, url: 'https://example.com/spec' },
  ], [
    { id: 99, title: 'Docs', color: 'blue' },
  ]);

  assert.deepEqual(state.groupSpaces, { 99: 'work' });
  assert.equal(state.groupOrder, undefined);
});

test('cleanup and Space deletion tolerate missing optional ownership collections', () => {
  assert.doesNotThrow(() => cleanupMissingEntities({}, [], []));
  assert.doesNotThrow(() => cleanupMissingEntities({}, [], [], {
    existingTabIds: [],
    existingWindowIds: [],
    pendingLifecycleTabIds: [],
  }));
  assert.doesNotThrow(() => removeSpaceReferences({
    groupOrder: {},
    tabOrder: {},
    spaceSnapshots: {},
    activeAskSessionKey: 'space:other',
  }, 'missing'));
});

test('invalid entity ids cannot masquerade as Chrome group or tab id zero', () => {
  const state = {
    groupSpaces: { 0: 'stale', 7: 'live' },
    tabSpaces: { 0: 'stale', 4: 'live' },
    renamedTabs: { 0: 'Stale', 4: 'Live' },
    tabGroups: { 0: 'vgroup:stale', 4: 'vgroup:live' },
    virtualGroups: {
      'vgroup:stale': { title: 'Stale', spaceId: 'stale' },
      'vgroup:live': { title: 'Live', spaceId: 'live' },
    },
  };

  cleanupMissingEntities(state, [
    { id: 4, groupId: -1 },
    { id: null, groupId: null },
  ], [
    { id: 7 },
    { id: null },
  ], {
    existingTabIds: [4, null, '', Number.NaN, Number.POSITIVE_INFINITY],
    existingGroupIds: [7, null, '', Number.NaN, Number.POSITIVE_INFINITY],
  });

  assert.deepEqual(state.groupSpaces, { 7: 'live' });
  assert.deepEqual(state.tabSpaces, { 4: 'live' });
  assert.deepEqual(state.renamedTabs, { 4: 'Live' });
  assert.deepEqual(state.tabGroups, { 4: 'vgroup:live' });
  assert.deepEqual(state.virtualGroups, {
    'vgroup:live': { title: 'Live', spaceId: 'live' },
  });
});

test('restores Space ownership for Chrome-restored groups and tabs from snapshots', () => {
  const state = {
    groupSpaces: { 7: 'arc-work' },
    tabSpaces: { 4: 'arc-work' },
    renamedTabs: {},
    groupOrder: { 'arc-work': ['group:7'] },
    spaceSnapshots: {
      'arc-work': {
        groups: [
          {
            title: 'Docs / Long Folder Name That Chrome Truncates',
            color: 'blue',
            tabs: [
              { title: 'Spec', url: 'https://example.com/spec' },
              { title: 'Plan', url: 'https://example.com/plan' },
            ],
          },
          {
            title: 'Ungrouped',
            color: 'grey',
            tabs: [
              { title: 'Inbox', url: 'https://example.com/inbox' },
            ],
          },
        ],
      },
    },
  };
  const tabs = [
    { id: 10, groupId: 99, url: 'https://example.com/spec' },
    { id: 11, groupId: 99, url: 'https://example.com/plan' },
    { id: 12, groupId: -1, url: 'https://example.com/inbox' },
  ];
  const groups = [
    { id: 99, title: 'Docs / Long Folder Name That Chr', color: 'blue' },
  ];

  restoreSnapshotOwnership(state, tabs, groups);
  cleanupMissingEntities(state, tabs, groups);

  assert.deepEqual(state.groupSpaces, { 99: 'arc-work' });
  assert.deepEqual(state.tabSpaces, {});
  assert.deepEqual(state.groupOrder['arc-work'], ['group:7', 'group:99']);
});

test('restores distinct same-prefix long groups after Chrome restarts with compact titles', () => {
  const prefix = 'quarterly-research-project'.padEnd(32, 'x');
  const workTitle = `${prefix}A`;
  const personalTitle = `${prefix}B`;
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    groupOrder: { work: [], personal: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          title: workTitle,
          color: 'blue',
          tabs: [{ title: 'Work', url: 'https://example.com/work' }],
        }],
      },
      personal: {
        groups: [{
          title: personalTitle,
          color: 'blue',
          tabs: [{ title: 'Personal', url: 'https://example.com/personal' }],
        }],
      },
    },
  };
  const tabs = [
    { id: 1, groupId: 101, url: 'https://example.com/work' },
    { id: 2, groupId: 202, url: 'https://example.com/personal' },
  ];
  const groups = [
    { id: 101, title: chromeGroupTitle(workTitle), color: 'blue' },
    { id: 202, title: chromeGroupTitle(personalTitle), color: 'blue' },
  ];

  const metadata = restoreSnapshotOwnership(state, tabs, groups);

  assert.notEqual(groups[0].title, groups[1].title);
  assert.deepEqual(state.groupSpaces, { 101: 'work', 202: 'personal' });
  assert.deepEqual(state.groupOrder, {
    work: ['group:101'],
    personal: ['group:202'],
  });
  assert.deepEqual(metadata.groupTitles, {
    101: workTitle,
    202: personalTitle,
  });
  assert.deepEqual(metadata.renamedTabs, {});
});

test('owned long Tag uses lifecycle identity instead of an ambiguous physical-title shadow', () => {
  const logicalTitle = 'Renamed Group E2E same-prefix identity 0123456789 alpha requested title';
  const physicalTitle = chromeGroupTitle(logicalTitle);
  const state = {
    groupSpaces: { 101: 'default' },
    tabSpaces: {},
    tabLifecycle: {
      1: {
        tabId: 1,
        groupId: 101,
        spaceId: 'default',
        snapshotGroupId: 'group:logical',
        snapshotTabId: 'tab:logical',
      },
    },
    groupOrder: { default: [] },
    spaceSnapshots: {
      default: {
        groups: [
          {
            snapshotGroupId: 'group:logical',
            title: logicalTitle,
            color: 'blue',
            tabs: [{ snapshotTabId: 'tab:logical', url: 'https://example.com/same' }],
          },
          {
            snapshotGroupId: 'group:physical-shadow',
            title: physicalTitle,
            color: 'blue',
            tabs: [{ snapshotTabId: 'tab:shadow', url: 'https://example.com/same' }],
          },
        ],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(
    state,
    [{ id: 1, groupId: 101, url: 'https://example.com/same' }],
    [{ id: 101, title: physicalTitle, color: 'blue' }],
  );

  assert.deepEqual(metadata.groupTitles, { 101: logicalTitle });
  assert.deepEqual(state.groupOrder.default, ['group:101']);
});

test('restores a unique snapshot panel title for a newly owned live group tab', () => {
  const logicalTitle = `${'Design research '.repeat(3)}archive`;
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: { 43: 'Existing name' },
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          title: logicalTitle,
          color: 'purple',
          tabs: [
            {
              title: 'Browser title',
              panelTitle: '  Read   later  ',
              url: 'https://example.com/paper',
            },
            {
              title: 'No custom name',
              url: 'https://example.com/notes',
            },
          ],
        }],
      },
    },
  };
  const tabs = [
    { id: 41, groupId: 88, url: 'https://example.com/paper' },
    { id: 42, groupId: 88, url: 'https://example.com/notes' },
    { id: 43, groupId: 88, url: 'https://example.com/paper' },
    { id: 44, groupId: 88, url: 'https://example.com/live-only' },
  ];
  const groups = [{ id: 88, title: chromeGroupTitle(logicalTitle), color: 'purple' }];

  const metadata = restoreSnapshotOwnership(state, tabs, groups);

  assert.deepEqual(state.groupSpaces, { 88: 'work' });
  assert.deepEqual(state.renamedTabs, {
    41: 'Read later',
    43: 'Existing name',
  });
  assert.deepEqual(metadata, {
    groupTitles: { 88: logicalTitle },
    renamedTabs: { 41: 'Read later' },
  });
});

test('grouped restore never steals ownership or a manual name across contradictory stable identities', () => {
  const state = {
    activeSpaceId: 'personal',
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [], personal: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'saved-group',
          title: 'Docs',
          color: 'blue',
          tabs: [{
            snapshotTabId: 'saved-row',
            panelTitle: 'Saved manual name',
            url: 'https://example.com/shared',
          }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [{
    id: 501,
    groupId: 99,
    spaceId: 'personal',
    snapshotGroupId: 'live-group',
    snapshotTabId: 'live-row',
    url: 'https://example.com/shared',
  }], [{ id: 99, title: 'Docs', color: 'blue' }]);

  assert.deepEqual(state.groupSpaces, {});
  assert.deepEqual(state.renamedTabs, {});
  assert.deepEqual(state.groupOrder, { work: [], personal: [] });
  assert.deepEqual(metadata, { groupTitles: {}, renamedTabs: {} });
});

test('known group ownership ignores a stale lifecycle binding without a Space', () => {
  const state = {
    groupSpaces: { 99: 'work' },
    tabSpaces: {},
    tabLifecycle: {
      501: {
        groupId: 99,
        spaceId: '',
        snapshotGroupId: 'personal-group',
        snapshotTabId: 'personal-row',
      },
    },
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'work-group',
          title: 'Docs',
          color: 'blue',
          tabs: [{
            snapshotTabId: 'work-row',
            url: 'https://example.com/shared',
          }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [{
    id: 501,
    groupId: 99,
    url: 'https://example.com/shared',
  }], [{ id: 99, title: 'Docs', color: 'blue' }]);

  assert.deepEqual(state.groupSpaces, { 99: 'work' });
  assert.deepEqual(state.groupOrder, { work: ['group:99'] });
  assert.deepEqual(metadata, { groupTitles: { 99: 'Docs' }, renamedTabs: {} });
});

test('matching stable group ownership cannot copy a panel name from a different stable row', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'shared-group',
          title: 'Docs',
          color: 'blue',
          tabs: [{
            snapshotTabId: 'saved-row',
            panelTitle: 'Saved manual name',
            url: 'https://example.com/shared',
          }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [{
    id: 502,
    groupId: 100,
    snapshotGroupId: 'shared-group',
    snapshotTabId: 'independent-row',
    url: 'https://example.com/shared',
  }], [{ id: 100, title: 'Docs', color: 'blue' }]);

  assert.deepEqual(state.groupSpaces, { 100: 'work' });
  assert.deepEqual(state.renamedTabs, {});
  assert.deepEqual(metadata, {
    groupTitles: { 100: 'Docs' },
    renamedTabs: {},
  });
});

test('stable grouped identities survive navigation and outrank mutable Chrome group metadata', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'docs-group',
          title: 'Saved logical title',
          color: 'blue',
          tabs: [{
            snapshotTabId: 'spec-row',
            panelTitle: 'Product spec',
            url: 'https://example.com/spec?saved=1#old',
          }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [{
    id: 503,
    groupId: 101,
    snapshotGroupId: 'docs-group',
    snapshotTabId: 'spec-row',
    url: 'https://example.com/spec?live=2#new',
  }], [{ id: 101, title: 'Renamed in Chrome', color: 'red' }]);

  assert.deepEqual(state.groupSpaces, { 101: 'work' });
  assert.deepEqual(state.renamedTabs, { 503: 'Product spec' });
  assert.deepEqual(metadata, {
    groupTitles: { 101: 'Saved logical title' },
    renamedTabs: { 503: 'Product spec' },
  });
});

test('a stable row identity restores a group when either group identity is missing', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          title: 'Saved group',
          color: 'green',
          tabs: [{
            snapshotTabId: 'stable-row',
            panelTitle: 'Stable row name',
            url: 'https://example.com/old-location',
          }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [{
    id: 504,
    groupId: 102,
    snapshotGroupId: 'live-only-group-id',
    snapshotTabId: 'stable-row',
    url: 'https://example.com/new-location',
  }], [{ id: 102, title: 'Different live title', color: 'yellow' }]);

  assert.deepEqual(state.groupSpaces, { 102: 'work' });
  assert.deepEqual(metadata.renamedTabs, { 504: 'Stable row name' });
});

test('grouped URL fallback remains compatible when only the snapshot side lacks stable ids', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          title: 'Legacy docs',
          color: 'cyan',
          tabs: [{
            panelTitle: 'Legacy manual name',
            url: 'https://example.com/legacy',
          }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [{
    id: 505,
    groupId: 103,
    snapshotGroupId: 'new-group-id',
    snapshotTabId: 'new-row-id',
    url: 'https://example.com/legacy',
  }], [{ id: 103, title: 'Legacy docs', color: 'cyan' }]);

  assert.deepEqual(state.groupSpaces, { 103: 'work' });
  assert.deepEqual(state.renamedTabs, { 505: 'Legacy manual name' });
  assert.deepEqual(metadata.renamedTabs, { 505: 'Legacy manual name' });
});

test('grouped URL fallback rejects conflicting row ids even when group ids are unavailable', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          title: 'Docs',
          color: 'blue',
          tabs: [{
            snapshotTabId: 'saved-row',
            panelTitle: 'Wrong name',
            url: 'https://example.com/shared',
          }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [{
    id: 506,
    groupId: 104,
    snapshotTabId: 'live-row',
    url: 'https://example.com/shared',
  }], [{ id: 104, title: 'Docs', color: 'blue' }]);

  assert.deepEqual(state.groupSpaces, {});
  assert.deepEqual(state.renamedTabs, {});
  assert.deepEqual(metadata, { groupTitles: {}, renamedTabs: {} });
});

test('stable grouped identity wins over a stronger legacy URL candidate', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [], personal: [] },
    spaceSnapshots: {
      personal: {
        groups: [{
          title: 'Docs',
          color: 'blue',
          tabs: [
            { url: 'https://example.com/exact-a' },
            { url: 'https://example.com/exact-b' },
          ],
        }],
      },
      work: {
        groups: [{
          title: 'Old title',
          color: 'red',
          tabs: [{
            snapshotTabId: 'stable-row',
            panelTitle: 'Stable choice',
            url: 'https://example.com/old',
          }],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [
    {
      id: 507,
      groupId: 105,
      snapshotTabId: 'stable-row',
      url: 'https://example.com/current',
    },
    { id: 508, groupId: 105, url: 'https://example.com/exact-a' },
    { id: 509, groupId: 105, url: 'https://example.com/exact-b' },
  ], [{ id: 105, title: 'Docs', color: 'blue' }]);

  assert.deepEqual(state.groupSpaces, { 105: 'work' });
  assert.deepEqual(metadata.renamedTabs, { 507: 'Stable choice' });
});

test('grouped restore refuses damaged live groups with conflicting group identities', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'group-a',
          title: 'Docs',
          color: 'blue',
          tabs: [
            { snapshotTabId: 'row-a', url: 'https://example.com/a' },
            { snapshotTabId: 'row-b', url: 'https://example.com/b' },
          ],
        }],
      },
    },
  };

  restoreSnapshotOwnership(state, [
    {
      id: 510,
      groupId: 106,
      snapshotGroupId: 'group-a',
      snapshotTabId: 'row-a',
      url: 'https://example.com/a',
    },
    {
      id: 511,
      groupId: 106,
      snapshotGroupId: 'group-b',
      snapshotTabId: 'row-b',
      url: 'https://example.com/b',
    },
  ], [{ id: 106, title: 'Docs', color: 'blue' }]);

  assert.deepEqual(state.groupSpaces, {});
});

test('browser restart restores grouped and persistent ungrouped manual titles from unique exact URLs', () => {
  const previousSession = {
    browserSessionId: 'before-restart',
    spaces: [{ id: 'work' }],
    activeSpaceId: 'work',
    groupSpaces: { 1: 'work' },
    tabSpaces: { 2: 'work' },
    renamedTabs: { 1: 'Old grouped id', 2: 'Old ungrouped id' },
    tabGroups: {},
    tabLifecycle: {},
    virtualGroups: {},
    ephemeralTabIds: [],
    groupOrder: { work: ['group:1'] },
    tabOrder: {},
    collapsedGroups: {},
    operationHistory: [],
    spaceSnapshots: {
      work: {
        groups: [
          {
            snapshotGroupId: 'docs',
            title: 'Docs',
            color: 'blue',
            tabs: [{
              snapshotTabId: 'spec',
              panelTitle: '  Product   spec  ',
              url: 'https://example.com/spec',
            }],
          },
          {
            snapshotGroupId: 'loose',
            title: 'Ungrouped',
            color: 'grey',
            restorable: true,
            tabs: [{
              snapshotTabId: 'reading',
              panelTitle: 'Read later',
              url: 'https://example.com/reading',
            }],
          },
        ],
      },
    },
  };
  const state = resetChromeSessionBindings(previousSession, 'after-restart');

  const metadata = restoreSnapshotOwnership(state, [
    { id: 101, groupId: 90, url: 'https://example.com/spec' },
    { id: 102, groupId: -1, url: 'https://example.com/reading' },
  ], [
    { id: 90, title: 'Docs', color: 'blue' },
  ]);

  assert.deepEqual(state.groupSpaces, { 90: 'work' });
  assert.deepEqual(state.tabSpaces, { 102: 'work' });
  assert.deepEqual(state.renamedTabs, {
    101: 'Product spec',
    102: 'Read later',
  });
  assert.deepEqual(metadata, {
    groupTitles: { 90: 'Docs' },
    renamedTabs: { 101: 'Product spec', 102: 'Read later' },
  });
});

test('browser restart never guesses grouped or ungrouped manual titles from duplicate URLs', () => {
  const previousSession = {
    browserSessionId: 'before-restart',
    spaces: [{ id: 'work' }, { id: 'personal' }],
    activeSpaceId: 'work',
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: { 1: 'Stale' },
    tabGroups: {},
    tabLifecycle: {},
    virtualGroups: {},
    ephemeralTabIds: [],
    groupOrder: {},
    tabOrder: {},
    collapsedGroups: {},
    operationHistory: [],
    spaceSnapshots: {
      work: {
        groups: [
          {
            title: 'Docs',
            color: 'blue',
            tabs: [
              { panelTitle: 'First grouped name', url: 'https://example.com/grouped' },
              { panelTitle: 'Second grouped name', url: 'https://example.com/grouped' },
            ],
          },
          {
            title: 'Ungrouped',
            color: 'grey',
            restorable: true,
            tabs: [
              { panelTitle: 'First loose name', url: 'https://example.com/loose' },
              { panelTitle: 'Second loose name', url: 'https://example.com/loose' },
              { panelTitle: 'Work copy', url: 'https://example.com/cross-space' },
            ],
          },
        ],
      },
      personal: {
        groups: [{
          title: 'Ungrouped',
          color: 'grey',
          restorable: true,
          tabs: [{ panelTitle: 'Personal copy', url: 'https://example.com/cross-space' }],
        }],
      },
    },
  };
  const state = resetChromeSessionBindings(previousSession, 'after-restart');

  const metadata = restoreSnapshotOwnership(state, [
    { id: 201, groupId: 91, url: 'https://example.com/grouped' },
    { id: 202, groupId: -1, url: 'https://example.com/loose' },
    { id: 203, groupId: -1, url: 'https://example.com/cross-space' },
  ], [{ id: 91, title: 'Docs', color: 'blue' }]);

  assert.deepEqual(state.groupSpaces, { 91: 'work' });
  assert.deepEqual(state.tabSpaces, { 202: 'work' });
  assert.deepEqual(state.renamedTabs, {});
  assert.deepEqual(metadata.renamedTabs, {});
});

test('stable ungrouped identity resolves duplicate URLs without falling back from contradictory identity', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: { 303: 'work', 307: 'personal' },
    renamedTabs: { 306: 'Keep my name' },
    tabLifecycle: {
      301: {
        spaceId: 'work',
        snapshotGroupId: 'loose',
        snapshotTabId: 'second',
      },
      302: {
        spaceId: 'work',
        snapshotGroupId: 'missing',
        snapshotTabId: 'missing',
      },
      303: {
        snapshotGroupId: 'loose',
        snapshotTabId: 'first',
      },
      304: {
        snapshotTabId: 'first',
      },
      307: {
        spaceId: 'work',
        snapshotGroupId: 'loose',
        snapshotTabId: 'first',
      },
    },
    groupOrder: {},
    spaceSnapshots: {
      work: {
        groups: [{
          snapshotGroupId: 'loose',
          title: 'Ungrouped',
          color: 'grey',
          restorable: true,
          tabs: [
            {
              snapshotTabId: 'first',
              panelTitle: 'First copy',
              url: 'https://example.com/shared',
            },
            {
              snapshotTabId: 'second',
              panelTitle: 'Second copy',
              url: 'https://example.com/shared',
            },
            {
              snapshotTabId: 'unique',
              panelTitle: 'Snapshot name',
              url: 'https://example.com/unique',
            },
          ],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [
    { id: 301, groupId: -1, url: 'https://example.com/shared' },
    { id: 302, groupId: -1, url: 'https://example.com/shared' },
    { id: 303, groupId: -1, url: 'https://example.com/shared' },
    { id: 304, groupId: -1, url: 'https://example.com/shared' },
    { id: 305, groupId: -1, url: '' },
    { id: 306, groupId: -1, url: 'https://example.com/unique' },
    { id: 307, groupId: -1, url: 'https://example.com/shared' },
  ], []);

  assert.deepEqual(state.tabSpaces, {
    301: 'work',
    303: 'work',
    306: 'work',
    307: 'personal',
  });
  assert.deepEqual(state.renamedTabs, {
    301: 'Second copy',
    303: 'First copy',
    306: 'Keep my name',
  });
  assert.deepEqual(metadata.renamedTabs, {
    301: 'Second copy',
    303: 'First copy',
  });
});

test('does not guess logical titles or panel names when same-owner snapshot matches conflict', () => {
  const legacyPrefix = 'legacy-title-prefix'.padEnd(32, 'x');
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [
          {
            title: `${legacyPrefix}A`,
            color: 'blue',
            tabs: [{
              panelTitle: 'First name',
              url: 'https://example.com/shared',
            }],
          },
          {
            title: `${legacyPrefix}B`,
            color: 'blue',
            tabs: [{
              panelTitle: 'Second name',
              url: 'https://example.com/shared',
            }],
          },
        ],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [
    { id: 51, groupId: 99, url: 'https://example.com/shared' },
  ], [
    { id: 99, title: legacyPrefix, color: 'blue' },
  ]);

  assert.deepEqual(state.groupSpaces, { 99: 'work' });
  assert.deepEqual(state.renamedTabs, {});
  assert.deepEqual(metadata, { groupTitles: {}, renamedTabs: {} });
});

test('does not restore a panel name when duplicate same-URL rows disagree', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [] },
    spaceSnapshots: {
      work: {
        groups: [{
          title: 'Docs',
          color: 'blue',
          tabs: [
            { panelTitle: 'First name', url: 'https://example.com/shared' },
            { panelTitle: 'Second name', url: 'https://example.com/shared' },
          ],
        }],
      },
    },
  };

  const metadata = restoreSnapshotOwnership(state, [
    { id: 61, groupId: 100, url: 'https://example.com/shared' },
  ], [
    { id: 100, title: 'Docs', color: 'blue' },
  ]);

  assert.deepEqual(state.renamedTabs, {});
  assert.deepEqual(metadata, {
    groupTitles: { 100: 'Docs' },
    renamedTabs: {},
  });
});

test('restores non-imported Space groups after Chrome assigns new ids', () => {
  const state = {
    groupSpaces: { 21: 'default' },
    tabSpaces: { 31: 'default' },
    renamedTabs: {},
    groupOrder: { default: ['group:21', 'ungrouped'] },
    spaceSnapshots: {
      default: {
        groups: [
          {
            title: 'Local Work',
            color: 'green',
            tabs: [
              { title: 'Issue', url: 'https://example.com/issue' },
              { title: 'Notes', url: 'https://example.com/notes' },
            ],
          },
          {
            title: 'Ungrouped',
            color: 'grey',
            tabs: [
              { title: 'Loose', url: 'https://example.com/loose' },
            ],
          },
        ],
      },
    },
  };
  const tabs = [
    { id: 41, groupId: 88, url: 'https://example.com/issue' },
    { id: 42, groupId: 88, url: 'https://example.com/notes' },
    { id: 43, groupId: -1, url: 'https://example.com/loose' },
  ];
  const groups = [
    { id: 88, title: 'Local Work', color: 'green' },
  ];

  restoreSnapshotOwnership(state, tabs, groups);
  cleanupMissingEntities(state, tabs, groups);

  assert.deepEqual(state.groupSpaces, { 88: 'default' });
  assert.deepEqual(state.tabSpaces, {});
  assert.deepEqual(state.groupOrder.default, ['group:21', 'ungrouped', 'group:88']);
});

test('does not restore ambiguous snapshot group ownership', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [], personal: [] },
    spaceSnapshots: {
      work: {
        groups: [
          {
            title: 'Docs',
            color: 'blue',
            tabs: [{ title: 'Spec', url: 'https://example.com/shared' }],
          },
        ],
      },
      personal: {
        groups: [
          {
            title: 'Docs',
            color: 'blue',
            tabs: [{ title: 'Spec', url: 'https://example.com/shared' }],
          },
        ],
      },
    },
  };

  restoreSnapshotOwnership(state, [
    { id: 10, groupId: 99, url: 'https://example.com/shared' },
  ], [
    { id: 99, title: 'Docs', color: 'blue' },
  ]);

  assert.deepEqual(state.groupSpaces, {});
  assert.deepEqual(state.groupOrder, { work: [], personal: [] });
});

test('uses stronger URL overlap to resolve restored snapshot groups', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: { work: [], research: [] },
    spaceSnapshots: {
      work: {
        groups: [
          {
            title: 'Docs',
            color: 'blue',
            tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
          },
        ],
      },
      research: {
        groups: [
          {
            title: 'Docs',
            color: 'blue',
            tabs: [
              { title: 'Spec', url: 'https://example.com/spec' },
              { title: 'Plan', url: 'https://example.com/plan' },
            ],
          },
        ],
      },
    },
  };

  restoreSnapshotOwnership(state, [
    { id: 10, groupId: 99, url: 'https://example.com/spec' },
    { id: 11, groupId: 99, url: 'https://example.com/plan' },
  ], [
    { id: 99, title: 'Docs', color: 'blue' },
  ]);

  assert.deepEqual(state.groupSpaces, { 99: 'research' });
  assert.deepEqual(state.groupOrder.research, ['group:99']);
});

test('does not restore temporary ungrouped tabs from snapshots', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: {},
    spaceSnapshots: {
      default: {
        groups: [
          {
            title: 'Ungrouped',
            color: 'grey',
            tabs: [
              { title: 'Search', url: 'https://google.com' },
            ],
          },
        ],
      },
    },
  };

  restoreSnapshotOwnership(state, [
    { id: 10, groupId: -1, url: 'https://google.com' },
  ], []);

  assert.deepEqual(state.tabSpaces, {});
});

test('does not restore ungrouped URLs or ambiguous ungrouped ownership', () => {
  const state = {
    groupSpaces: {},
    tabSpaces: {},
    renamedTabs: {},
    groupOrder: {},
    spaceSnapshots: {
      work: {
        groups: [
          {
            title: 'Docs',
            color: 'blue',
            tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
          },
          {
            title: 'Ungrouped',
            color: 'grey',
            tabs: [{ title: 'Loose', url: 'https://example.com/loose' }],
          },
        ],
      },
      personal: {
        groups: [
          {
            title: 'Research',
            color: 'green',
            tabs: [{ title: 'Spec copy', url: 'https://example.com/spec' }],
          },
        ],
      },
    },
  };

  restoreSnapshotOwnership(state, [
    { id: 10, groupId: -1, url: 'https://example.com/spec' },
    { id: 11, groupId: -1, url: 'https://example.com/loose' },
  ], []);

  assert.deepEqual(state.tabSpaces, {});
});

test('finds close candidates by Space ownership without touching other Spaces', () => {
  const state = {
    groupSpaces: { 7: 'default', 8: 'focus' },
    tabSpaces: { 4: 'default', 5: 'focus' },
  };
  const tabs = [
    { id: 1, groupId: 7, url: 'https://example.com/a' },
    { id: 2, groupId: 8, url: 'https://example.com/b' },
    { id: 4, groupId: -1, url: 'chrome://extensions' },
    { id: 5, groupId: -1, url: 'https://example.com/c' },
  ];

  const closeable = closableTabsForSpace(tabs, state, 'default', (tab) => tab.url.startsWith('https://'));

  assert.deepEqual(closeable.map((tab) => tab.id), [1]);
});

test('deleting a Space closes ordinary tabs but moves pinned survivors to the fallback', () => {
  const state = {
    groupSpaces: { 7: 'work', 8: 'other' },
    tabSpaces: { 1: 'work', 2: 'work', 4: 'other' },
    tabLifecycle: {
      1: { snapshotTabId: 'pinned-loose', spaceId: 'other', trackingMode: 'saved-target' },
      2: { snapshotTabId: 'ordinary', spaceId: 'work' },
      3: { snapshotTabId: 'pinned-grouped', spaceId: 'work', groupId: -1, pinned: false },
    },
  };
  const tabs = [
    { id: 1, groupId: -1, pinned: true },
    { id: 2, groupId: -1, pinned: false },
    { id: 3, groupId: 7, pinned: true },
    { id: 4, groupId: -1, pinned: true },
  ];

  const plan = planSpaceTabDeletion(tabs, state, 'work');
  assert.deepEqual(plan.closingTabs.map((tab) => tab.id), [2]);
  assert.deepEqual(plan.preservedPinnedTabs.map((tab) => tab.id), [1, 3]);
  assert.equal(spaceTabDeletionFingerprint(plan), '[[1,true],[2,false],[3,true]]');
  assert.notEqual(
    spaceTabDeletionFingerprint(planSpaceTabDeletion([
      tabs[0],
      { ...tabs[1], pinned: true },
      tabs[2],
      tabs[3],
    ], state, 'work')),
    spaceTabDeletionFingerprint(plan),
  );
  assert.deepEqual(
    reassignPinnedTabsAfterSpaceDelete(state, tabs, 'work', 'default'),
    [1, 3],
  );
  assert.deepEqual(state.tabSpaces, { 1: 'default', 2: 'work', 4: 'other' });
  assert.deepEqual(state.groupSpaces, { 7: 'default', 8: 'other' });
  assert.equal(state.tabLifecycle[1].spaceId, 'default');
  assert.equal(state.tabLifecycle[1].trackingMode, 'live');
  assert.equal(state.tabLifecycle[1].groupId, -1);
  assert.equal(state.tabLifecycle[1].pinned, true);
  assert.equal(state.tabLifecycle[2].spaceId, 'work');
  assert.equal(state.tabLifecycle[3].spaceId, 'default');
  assert.equal(state.tabLifecycle[3].groupId, 7);
  assert.equal(state.tabLifecycle[3].pinned, true);
  assert.deepEqual(reassignPinnedTabsAfterSpaceDelete(state, tabs, 'default', 'default'), []);
  assert.deepEqual(reassignPinnedTabsAfterSpaceDelete(state, tabs, 'default', ''), []);
});

test('Space deletion fingerprints normalize missing plan arrays and tab order', () => {
  assert.equal(spaceTabDeletionFingerprint(), '[]');
  assert.equal(spaceTabDeletionFingerprint({ closingTabs: null, preservedPinnedTabs: null }), '[]');
  assert.equal(spaceTabDeletionFingerprint({
    closingTabs: [{ id: 9 }, { id: 2 }],
    preservedPinnedTabs: [{ id: 5 }],
  }), '[[2,false],[5,true],[9,false]]');
});

test('undoing imported Spaces reassigns their live tabs and Chrome groups across windows', () => {
  const state = {
    groupSpaces: { 7: 'arc-a', 8: 'keep' },
    tabSpaces: { 1: 'arc-b', 2: 'keep' },
    tabLifecycle: {
      1: { snapshotTabId: 'loose-import', spaceId: 'arc-b' },
      3: { snapshotTabId: 'group-import', spaceId: 'arc-a' },
      4: { snapshotTabId: 'group-keep', spaceId: 'keep' },
      5: { snapshotTabId: 'orphan-import', spaceId: 'arc-b' },
    },
  };
  const result = reassignTabsFromRemovedSpaces(state, [
    { id: 1, groupId: -1, windowId: 10 },
    { id: 2, groupId: -1, windowId: 20 },
    { id: 3, groupId: 7, windowId: 20 },
    { id: 4, groupId: 8, windowId: 30 },
    { id: 5, groupId: -1, windowId: 30 },
  ], new Set(['arc-a', 'arc-b']), (tab) => Number(tab.windowId) === 30 ? 'reading' : 'keep');

  assert.deepEqual(result, { tabIds: [1, 3, 5], groupIds: [7], spaceIds: ['keep', 'reading'] });
  assert.deepEqual(state.tabSpaces, { 1: 'keep', 2: 'keep', 5: 'reading' });
  assert.deepEqual(state.groupSpaces, { 7: 'keep', 8: 'keep' });
  assert.equal(state.tabLifecycle[1].spaceId, 'keep');
  assert.equal(state.tabLifecycle[1].trackingMode, 'live');
  assert.equal(state.tabLifecycle[3].spaceId, 'keep');
  assert.equal(state.tabLifecycle[3].trackingMode, 'live');
  assert.equal(state.tabLifecycle[4].spaceId, 'keep');
  assert.equal(state.tabLifecycle[5].spaceId, 'reading');
  assert.equal(state.tabLifecycle[5].trackingMode, 'live');
  assert.deepEqual(reassignTabsFromRemovedSpaces(state, [], ['keep'], 'keep'), { tabIds: [], groupIds: [], spaceIds: [] });
  assert.deepEqual(reassignTabsFromRemovedSpaces(state, [], ['keep'], ''), { tabIds: [], groupIds: [], spaceIds: [] });
  assert.deepEqual(reassignTabsFromRemovedSpaces(state, [], null, 'keep'), { tabIds: [], groupIds: [], spaceIds: [] });

  const fixedFallbackState = {
    groupSpaces: {},
    tabSpaces: { 20: 'arc-a', 21: 'arc-a' },
    tabLifecycle: {},
  };
  assert.deepEqual(reassignTabsFromRemovedSpaces(fixedFallbackState, [
    { id: 20, groupId: -1 },
    { id: 21, groupId: -1 },
  ], ['arc-a'], (tab) => tab.id === 20 ? null : 'keep'), {
    tabIds: [21],
    groupIds: [],
    spaceIds: ['keep'],
  });
  assert.deepEqual(reassignTabsFromRemovedSpaces({
    groupSpaces: {},
    tabSpaces: { 22: 'arc-a' },
    tabLifecycle: {},
  }, [{ id: 22, groupId: -1 }], ['arc-a'], 'keep'), {
    tabIds: [22],
    groupIds: [],
    spaceIds: ['keep'],
  });
});

test('does not close unassigned normal tabs during Space switching', () => {
  const state = {
    groupSpaces: { 7: 'default' },
    tabSpaces: { 4: 'default' },
  };
  const tabs = [
    { id: 1, groupId: 7, url: 'https://example.com/active-group' },
    { id: 4, groupId: -1, url: 'https://example.com/active-loose' },
    { id: 5, groupId: -1, url: 'https://example.com/foreign-owned' },
    { id: 8, groupId: -1, url: 'https://example.com/unassigned' },
    { id: 9, groupId: -1, url: 'chrome://extensions' },
  ];
  state.tabSpaces[5] = 'focus';

  const closeable = closableTabsOutsideSpace(tabs, state, 'default', (tab) => tab.url.startsWith('https://'));

  assert.deepEqual(closeable.map((tab) => tab.id), [5]);
});

test('chooses the default Space as the delete fallback when available', () => {
  const spaces = [
    { id: 'work', name: 'Work' },
    { id: 'default', name: 'Space' },
    { id: 'focus', name: 'Focus' },
  ];

  assert.deepEqual(fallbackSpaceAfterDelete(spaces, 'work'), { id: 'default', name: 'Space' });
  assert.deepEqual(fallbackSpaceAfterDelete(spaces, 'default'), { id: 'work', name: 'Work' });
  assert.equal(fallbackSpaceAfterDelete([{ id: 'default', name: 'Space' }], 'default'), null);
});

test('removes Space ownership, ordering, and snapshots when deleting a Space', () => {
  const state = {
    groupSpaces: { 7: 'default', 8: 'focus' },
    tabSpaces: { 4: 'default', 5: 'focus' },
    tabGroups: { 4: 'vgroup:dead', 5: 'vgroup:live' },
    virtualGroups: {
      'vgroup:dead': { title: 'Dead', spaceId: 'default' },
      'vgroup:live': { title: 'Live', spaceId: 'focus' },
    },
    groupOrder: { default: ['group:7'], focus: ['group:8'] },
    tabOrder: { default: { ungrouped: [4] }, focus: { ungrouped: [5] } },
    spaceSnapshots: { default: { groups: [] }, focus: { groups: [] } },
    spaceContexts: { default: '# Delete me', focus: '# Keep me' },
    askSessions: {
      'space:default': { key: 'space:default' },
      'space:focus': { key: 'space:focus' },
    },
    activeAskSessionKey: 'space:default',
    tabLifecycle: {
      4: { snapshotTabId: 'row-default', spaceId: 'default' },
      5: { snapshotTabId: 'row-focus', spaceId: 'focus' },
    },
    collapsedSpaceGroups: { default: true, focus: true },
    collapsedGroups: {
      'group:7': true,
      'group:8': true,
      'vgroup:dead': true,
      'vgroup:live': true,
      'folder:default:Docs': true,
      'folder:defaults:Keep': true,
      'snapshot:0:default:snapshot-dead': true,
      'snapshot:0:focus:snapshot-live': true,
      'snapshot:0:Legacy title': true,
      'snapshot::default:damaged': true,
    },
    operationHistory: [
      { id: 'dead-operation', spaceId: 'default' },
      { id: 'live-operation', spaceId: 'focus' },
      { id: 'global-operation' },
    ],
    lastArcImport: {
      spaceIds: ['default', 'focus'],
      importedAt: 123,
      afterFingerprints: {
        default: 'portable-space-v1-deadbeef',
        focus: 'portable-space-v1-12345678',
      },
    },
  };

  removeSpaceReferences(state, 'default');

  assert.deepEqual(state.groupSpaces, { 8: 'focus' });
  assert.deepEqual(state.tabSpaces, { 5: 'focus' });
  assert.equal(state.groupOrder.default, undefined);
  assert.equal(state.tabOrder.default, undefined);
  assert.equal(state.spaceSnapshots.default, undefined);
  assert.equal(state.spaceContexts.default, undefined);
  assert.equal(state.spaceContexts.focus, '# Keep me');
  assert.equal(state.askSessions['space:default'], undefined);
  assert.deepEqual(state.askSessions['space:focus'], { key: 'space:focus' });
  assert.equal(state.activeAskSessionKey, '');
  assert.deepEqual(state.virtualGroups, {
    'vgroup:live': { title: 'Live', spaceId: 'focus' },
  });
  assert.deepEqual(state.tabGroups, { 5: 'vgroup:live' });
  assert.deepEqual(state.tabLifecycle, {
    5: { snapshotTabId: 'row-focus', spaceId: 'focus' },
  });
  assert.deepEqual(state.collapsedSpaceGroups, { focus: true });
  assert.deepEqual(state.collapsedGroups, {
    'group:8': true,
    'vgroup:live': true,
    'folder:defaults:Keep': true,
    'snapshot:0:focus:snapshot-live': true,
    'snapshot:0:Legacy title': true,
    'snapshot::default:damaged': true,
  });
  assert.deepEqual(state.operationHistory, [
    { id: 'live-operation', spaceId: 'focus' },
    { id: 'global-operation' },
  ]);
  assert.deepEqual(state.lastArcImport, {
    spaceIds: ['focus'],
    importedAt: 123,
    afterFingerprints: { focus: 'portable-space-v1-12345678' },
  });
});

test('clears a final deleted Arc Space import marker and tolerates sparse state', () => {
  const state = {
    lastArcImport: { spaceIds: ['arc-only'], importedAt: 1 },
  };

  assert.doesNotThrow(() => removeSpaceReferences(state, 'arc-only'));
  assert.equal(state.lastArcImport, null);

  const legacy = {
    lastArcImport: { spaceIds: ['arc-old', 'arc-keep'], importedAt: 2 },
  };
  removeSpaceReferences(legacy, 'arc-old');
  assert.deepEqual(legacy.lastArcImport, { spaceIds: ['arc-keep'], importedAt: 2 });

  const incompleteFingerprints = {
    lastArcImport: {
      spaceIds: ['arc-old', 'arc-keep'],
      importedAt: 3,
      afterFingerprints: { 'arc-old': 'portable-space-v1-deadbeef' },
    },
  };
  removeSpaceReferences(incompleteFingerprints, 'arc-old');
  assert.deepEqual(incompleteFingerprints.lastArcImport, {
    spaceIds: ['arc-keep'],
    importedAt: 3,
    afterFingerprints: {},
  });
});
