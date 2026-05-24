import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adoptUnassignedEntities,
  cleanupMissingEntities,
  closableTabsForSpace,
  closableTabsOutsideSpace,
  fallbackSpaceAfterDelete,
  removeSpaceReferences,
  restoreSnapshotOwnership,
  syncCollapsedGroupsFromChrome,
} from '../src/shared/space-membership.js';

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

test('lets local tab ownership override Chrome tab group id 0', () => {
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
  assert.equal(state.tabSpaces[1], 'stale');
  assert.deepEqual(closableTabsForSpace([
    { id: 1, groupId: 0 },
  ], state, 'stale', () => true).map((tab) => tab.id), [1]);
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

test('can clean closed tabs and groups without adopting new entities', () => {
  const state = {
    groupSpaces: { 7: 'work', 8: 'focus' },
    tabSpaces: { 4: 'work', 9: 'focus' },
    renamedTabs: { 9: 'Gone' },
  };

  cleanupMissingEntities(state, [
    { id: 4, groupId: -1 },
  ], [
    { id: 7 },
  ]);

  assert.deepEqual(state.groupSpaces, { 7: 'work' });
  assert.deepEqual(state.tabSpaces, { 4: 'work' });
  assert.deepEqual(state.renamedTabs, {});
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
    groupOrder: { default: ['group:7'], focus: ['group:8'] },
    tabOrder: { default: { ungrouped: [4] }, focus: { ungrouped: [5] } },
    spaceSnapshots: { default: { groups: [] }, focus: { groups: [] } },
  };

  removeSpaceReferences(state, 'default');

  assert.deepEqual(state.groupSpaces, { 8: 'focus' });
  assert.deepEqual(state.tabSpaces, { 5: 'focus' });
  assert.equal(state.groupOrder.default, undefined);
  assert.equal(state.tabOrder.default, undefined);
  assert.equal(state.spaceSnapshots.default, undefined);
});
