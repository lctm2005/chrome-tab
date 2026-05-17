import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adoptUnassignedEntities,
  cleanupMissingEntities,
  closableTabsForSpace,
  closableTabsOutsideSpace,
  fallbackSpaceAfterDelete,
  removeSpaceReferences,
  syncCollapsedGroupsFromChrome,
} from '../src/shared/space-membership.js';

test('adopts new ungrouped tabs and new Chrome groups into the active Space', () => {
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
  assert.equal(state.groupSpaces[8], 'focus');
  assert.equal(state.tabSpaces[3], 'focus');
  assert.equal(state.tabSpaces[4], 'work');
  assert.equal(state.tabSpaces[99], undefined);
  assert.equal(state.renamedTabs[99], undefined);
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

test('treats unassigned normal tabs as outside the active Space during switching', () => {
  const state = {
    groupSpaces: { 7: 'default' },
    tabSpaces: { 4: 'default' },
  };
  const tabs = [
    { id: 1, groupId: 7, url: 'https://example.com/active-group' },
    { id: 4, groupId: -1, url: 'https://example.com/active-loose' },
    { id: 8, groupId: -1, url: 'https://example.com/unassigned' },
    { id: 9, groupId: -1, url: 'chrome://extensions' },
  ];

  const closeable = closableTabsOutsideSpace(tabs, state, 'default', (tab) => tab.url.startsWith('https://'));

  assert.deepEqual(closeable.map((tab) => tab.id), [8]);
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
