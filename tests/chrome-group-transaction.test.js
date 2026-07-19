import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureChromeGroupMutationMemory,
  captureChromeGroupTitleRollback,
  captureTabGroupMembership,
  orderDuplicateChromeGroups,
  projectChromeGroupRollbackMemory,
  remapChromeGroupBindings,
  remapLogicalChromeGroupTitles,
  resolveChromeGroupIdReplacement,
  restoreTabGroupMembership,
  restoreTabPositions,
  runChromeGroupMutationTransaction,
} from '../src/shared/chrome-group-transaction.js';

test('Tidy keeps the first durable live Tag metadata instead of the lowest Chrome group id', () => {
  const lowChromeId = { id: 5, key: 'group:5', title: 'docs', color: 'red', collapsed: false };
  const canonical = { id: 90, key: 'group:90', title: 'Docs', color: 'purple', collapsed: true };
  const later = { id: 20, key: 'group:20', title: ' DOCS ', color: 'yellow', collapsed: false };
  const byStableIdentity = orderDuplicateChromeGroups([lowChromeId, canonical, later], {
    canonicalSnapshotGroupId: 'snapshot-first',
    tabLifecycle: {
      1: { groupId: 5, snapshotGroupId: 'snapshot-later' },
      2: { groupId: 90, snapshotGroupId: 'snapshot-first' },
      3: { groupId: 20, snapshotGroupId: 'snapshot-third' },
    },
    visibleGroupKeys: ['group:5', 'group:20', 'group:90'],
    groupOrder: ['group:20', 'group:90', 'group:5'],
  });
  assert.deepEqual(byStableIdentity, [canonical, lowChromeId, later]);
  assert.equal(byStableIdentity[0].color, 'purple');
  assert.equal(byStableIdentity[0].collapsed, true);

  const byLiveStableRow = orderDuplicateChromeGroups([lowChromeId, canonical], {
    canonicalSnapshotGroupId: 'snapshot-first',
    canonicalGroupIds: [90],
    tabLifecycle: {
      1: { groupId: 5, snapshotGroupId: 'snapshot-first' },
      2: { groupId: 90, snapshotGroupId: 'snapshot-first' },
    },
    visibleGroupKeys: ['group:5', 'group:90'],
  });
  assert.deepEqual(
    byLiveStableRow,
    [canonical, lowChromeId],
    'the physical group containing the canonical stable row outranks a stale cached group id',
  );

  const byVisibleOrder = orderDuplicateChromeGroups([lowChromeId, canonical, later], {
    visibleGroupKeys: ['group:20', 'group:90'],
    groupOrder: ['group:90', 'group:5', 'group:20'],
  });
  assert.deepEqual(byVisibleOrder, [later, canonical, lowChromeId]);

  const byDurableOrder = orderDuplicateChromeGroups([lowChromeId, canonical], {
    visibleGroupKeys: [],
    groupOrder: ['group:90', 'group:5'],
  });
  assert.deepEqual(byDurableOrder, [canonical, lowChromeId]);
  const unrankedA = { id: 200, key: 'group:200', color: 'cyan' };
  const unrankedB = { id: 100, key: 'group:100', color: 'orange' };
  assert.deepEqual(
    orderDuplicateChromeGroups([unrankedA, unrankedB], {
      canonicalSnapshotGroupId: 'missing-canonical',
      tabLifecycle: { 9: { groupId: 9 } },
    }),
    [unrankedA, unrankedB],
    'equal ranks preserve first-visible metadata instead of falling back to Chrome id',
  );
  assert.deepEqual(orderDuplicateChromeGroups(null), []);
  assert.deepEqual(orderDuplicateChromeGroups(), []);
});
import { persistStorageStep } from '../src/shared/storage-transaction.js';

function createGroupBrowser({ tabs = [], groups = [], nextGroupId = 100 } = {}) {
  const tabMap = new Map(tabs.map((tab) => [Number(tab.id), { ...tab }]));
  const groupMap = new Map(groups.map((group) => [Number(group.id), { ...group }]));
  const calls = [];
  let createCallCount = 0;
  let failCreateCall = 0;

  function removeEmptyGroups() {
    for (const groupId of [...groupMap.keys()]) {
      if (![...tabMap.values()].some((tab) => Number(tab.groupId) === groupId)) groupMap.delete(groupId);
    }
  }

  function moveIntoGroup(tabIds, groupId) {
    for (const tabId of tabIds) {
      const tab = tabMap.get(Number(tabId));
      if (tab) tab.groupId = groupId;
    }
    removeEmptyGroups();
  }

  return {
    calls,
    tabs: tabMap,
    groups: groupMap,
    failCreateOnceAt(callNumber) {
      failCreateCall = callNumber;
    },
    async listTabs() {
      calls.push(['list']);
      return [...tabMap.values()].map((tab) => ({ ...tab }));
    },
    async ungroupTabs(tabIds) {
      calls.push(['ungroup', [...tabIds]]);
      for (const tabId of tabIds) {
        const tab = tabMap.get(Number(tabId));
        if (tab) tab.groupId = -1;
      }
      removeEmptyGroups();
    },
    async addTabsToGroup(groupId, tabIds) {
      calls.push(['add', Number(groupId), [...tabIds]]);
      if (!groupMap.has(Number(groupId))) return null;
      moveIntoGroup(tabIds, Number(groupId));
      return Number(groupId);
    },
    async createGroup(tabIds, metadata = {}) {
      createCallCount += 1;
      calls.push(['create', [...tabIds], { ...metadata }]);
      if (createCallCount === failCreateCall) throw new Error(`create ${createCallCount} failed`);
      const groupId = nextGroupId;
      nextGroupId += 1;
      groupMap.set(groupId, { id: groupId, ...metadata });
      moveIntoGroup(tabIds, groupId);
      return groupId;
    },
    async moveTab(tabId, position = {}) {
      calls.push(['move', Number(tabId), { ...position }]);
      const tab = tabMap.get(Number(tabId));
      if (!tab) throw new Error(`missing tab ${tabId}`);
      const sourceWindowId = Number(tab.windowId);
      const targetWindowId = Number.isSafeInteger(Number(position.windowId))
        ? Number(position.windowId)
        : sourceWindowId;
      const targetIndex = Math.max(0, Number(position.index) || 0);
      tab.windowId = targetWindowId;
      const affectedWindowIds = new Set([sourceWindowId, targetWindowId]);
      for (const windowId of affectedWindowIds) {
        const windowTabs = [...tabMap.values()]
          .filter((item) => Number(item.windowId) === windowId && Number(item.id) !== Number(tabId))
          .sort((left, right) => Number(left.index) - Number(right.index));
        if (windowId === targetWindowId) {
          windowTabs.splice(Math.min(targetIndex, windowTabs.length), 0, tab);
        }
        windowTabs.forEach((item, index) => { item.index = index; });
      }
    },
    async groupAs(tabIds, metadata = {}) {
      return this.createGroup(tabIds, metadata);
    },
    semanticLayout() {
      const groupsByTitle = [...groupMap.values()]
        .map((group) => ({
          title: group.title,
          color: group.color,
          collapsed: Boolean(group.collapsed),
          tabIds: [...tabMap.values()]
            .filter((tab) => Number(tab.groupId) === Number(group.id))
            .map((tab) => Number(tab.id))
            .sort((left, right) => left - right),
        }))
        .filter((group) => group.tabIds.length > 0)
        .sort((left, right) => left.title.localeCompare(right.title));
      const ungroupedTabIds = [...tabMap.values()]
        .filter((tab) => Number(tab.groupId) < 0)
        .map((tab) => Number(tab.id))
        .sort((left, right) => left - right);
      return { groups: groupsByTitle, ungroupedTabIds };
    },
    orderedTabIds(windowId = 1) {
      return [...tabMap.values()]
        .filter((tab) => Number(tab.windowId) === Number(windowId))
        .sort((left, right) => Number(left.index) - Number(right.index))
        .map((tab) => Number(tab.id));
    },
  };
}

function captureAll(browser) {
  const tabs = [...browser.tabs.values()];
  const groups = [...browser.groups.values()];
  return captureTabGroupMembership(tabs, groups, tabs.map((tab) => tab.id));
}

async function replaceWholeLayout(browser, groups, ungroupedTabIds = []) {
  await browser.ungroupTabs([...browser.tabs.keys()]);
  for (const group of groups) {
    await browser.createGroup(group.tabIds, group);
  }
  await browser.ungroupTabs(ungroupedTabIds);
}

function autoGroupRollbackState() {
  return {
    spaces: [
      { id: 'work', name: 'Work' },
      { id: 'other', name: 'Other' },
    ],
    activeSpaceId: 'work',
    groupSpaces: { 10: 'work', 20: 'work', 99: 'other' },
    collapsedGroups: {
      'group:10': true,
      'group:20': false,
      'group:99': true,
      ungrouped: true,
    },
    groupOrder: {
      work: ['group:10', 'group:20', 'ungrouped'],
      other: ['group:99'],
    },
    tabOrder: {
      work: {
        'group:10': [1, 2],
        'group:20': [3, 4],
        ungrouped: [5],
      },
      other: { 'group:99': [99] },
    },
    tabLifecycle: {
      1: {
        tabId: 1,
        groupId: 10,
        spaceId: 'work',
        snapshotGroupId: 'snapshot-group-a',
        snapshotTabId: 'snapshot-tab-1',
        url: 'https://one.test/',
      },
      2: {
        tabId: 2,
        groupId: 10,
        spaceId: 'work',
        snapshotGroupId: 'snapshot-group-a',
        snapshotTabId: 'snapshot-tab-2',
        url: 'https://two.test/',
      },
      3: {
        tabId: 3,
        groupId: 20,
        spaceId: 'work',
        snapshotGroupId: 'snapshot-group-b',
        snapshotTabId: 'snapshot-tab-3',
        url: 'https://three.test/',
      },
      4: {
        tabId: 4,
        groupId: 20,
        spaceId: 'work',
        snapshotGroupId: 'snapshot-group-b',
        snapshotTabId: 'snapshot-tab-4',
        url: 'https://four.test/',
      },
      5: {
        tabId: 5,
        groupId: -1,
        spaceId: 'work',
        snapshotGroupId: 'snapshot-ungrouped',
        snapshotTabId: 'snapshot-tab-5',
        url: 'https://five.test/',
      },
    },
    spaceSnapshots: {
      work: {
        version: 1,
        updatedAt: 123,
        groups: [
          {
            snapshotGroupId: 'snapshot-group-a',
            title: 'Before A',
            color: 'red',
            collapsed: true,
            tabs: [
              { snapshotTabId: 'snapshot-tab-1', url: 'https://one.test/' },
              { snapshotTabId: 'snapshot-tab-2', url: 'https://two.test/' },
            ],
          },
          {
            snapshotGroupId: 'snapshot-group-b',
            title: 'Before B',
            color: 'cyan',
            collapsed: false,
            tabs: [
              { snapshotTabId: 'snapshot-tab-3', url: 'https://three.test/' },
              { snapshotTabId: 'snapshot-tab-4', url: 'https://four.test/' },
            ],
          },
          {
            snapshotGroupId: 'snapshot-ungrouped',
            title: 'Ungrouped',
            color: 'grey',
            collapsed: true,
            tabs: [{ snapshotTabId: 'snapshot-tab-5', url: 'https://five.test/' }],
          },
        ],
      },
    },
    operationHistory: [{ id: 'existing-operation', type: 'tidy-names', status: 'applied' }],
    unrelatedMetadata: { preserved: true },
  };
}

function autoGroupRollbackMemory(state) {
  return {
    state: structuredClone(state),
    logicalTitles: new Map([
      [10, 'Before A'],
      [20, 'Before B'],
      [99, 'Other'],
    ]),
    selectedTabIds: new Set([2, 5]),
    selectionAnchorTabId: 2,
    dormantSpaceView: [{
      key: 'snapshot:saved',
      tabs: [{ snapshotTabId: 'saved-tab', url: 'https://saved.test/' }],
    }],
    dormantSpaceViewSpaceId: 'other',
  };
}

function assertAutoGroupStateRestored(actualState, expectedState, originalState) {
  assert.deepEqual(actualState.groupSpaces, expectedState.groupSpaces);
  assert.deepEqual(actualState.groupOrder, expectedState.groupOrder);
  assert.deepEqual(actualState.tabOrder, expectedState.tabOrder);
  assert.deepEqual(actualState.collapsedGroups, expectedState.collapsedGroups);
  assert.deepEqual(actualState.tabLifecycle, expectedState.tabLifecycle);
  assert.deepEqual(actualState.spaceSnapshots, originalState.spaceSnapshots);
  assert.deepEqual(actualState.operationHistory, originalState.operationHistory);
  assert.deepEqual(actualState, expectedState);
  assert.equal(
    actualState.operationHistory.some((operation) => operation?.id === 'ghost-auto-group'),
    false,
  );
}

test('captures only existing unique tabs with user-visible group metadata and safe defaults', () => {
  const snapshot = captureTabGroupMembership([
    { id: 1, groupId: 10 },
    { id: '2', groupId: 20 },
    { id: 3, groupId: -1 },
    { id: 4, groupId: 30 },
    { id: 5, groupId: 40 },
    { id: -4, groupId: 10 },
  ], [
    { id: 10, title: 'Physical', displayTitle: ' Logical ', color: ' red ', collapsed: true },
    { id: 20, title: 42, color: '', collapsed: false },
    { id: 40, title: '', displayTitle: 'Must not be invented', color: 'cyan', collapsed: true },
    { id: -3, title: 'Ignored' },
  ], [1, '1', 2, 3, 4, 5, -4, 'bad', null, undefined, '']);

  assert.deepEqual(snapshot, {
    tabs: [
      { tabId: 1, groupId: 10 },
      { tabId: 2, groupId: 20 },
      { tabId: 3, groupId: -1 },
      { tabId: 4, groupId: 30 },
      { tabId: 5, groupId: 40 },
    ],
    groups: [
      { groupId: 10, title: 'Logical', color: 'red', collapsed: true, tabIds: [1] },
      { groupId: 20, title: 'Group', color: 'blue', collapsed: false, tabIds: [2] },
      { groupId: 30, title: 'Group', color: 'blue', collapsed: false, tabIds: [4] },
      { groupId: 40, title: '', color: 'cyan', collapsed: true, tabIds: [5] },
    ],
  });

  assert.deepEqual(captureTabGroupMembership(null, null, null), { tabs: [], groups: [] });
});

test('captures and projects rollback memory without sharing mutable state', () => {
  const source = {
    state: { activeSpaceId: 'work', nested: { count: 1 } },
    logicalTitles: new Map([[0, 'Zero'], [12, 'Twelve']]),
    selectedTabIds: new Set([0, 7]),
    selectionAnchorTabId: 0,
    dormantSpaceView: [{ key: 'snapshot:0', tabs: [{ url: 'https://saved.test/' }] }],
    dormantSpaceViewSpaceId: 'saved',
  };
  const snapshot = captureChromeGroupMutationMemory(source);

  assert.deepEqual(snapshot, {
    state: { activeSpaceId: 'work', nested: { count: 1 } },
    logicalTitles: [[0, 'Zero'], [12, 'Twelve']],
    selectedTabIds: [0, 7],
    selectionAnchorTabId: 0,
    dormantSpaceView: [{ key: 'snapshot:0', tabs: [{ url: 'https://saved.test/' }] }],
    dormantSpaceViewSpaceId: 'saved',
  });

  source.state.nested.count = 2;
  source.logicalTitles.set(0, 'Changed');
  source.selectedTabIds.add(9);
  source.dormantSpaceView[0].tabs[0].url = 'https://changed.test/';
  assert.equal(snapshot.state.nested.count, 1);
  assert.deepEqual(snapshot.logicalTitles, [[0, 'Zero'], [12, 'Twelve']]);
  assert.deepEqual(snapshot.selectedTabIds, [0, 7]);
  assert.equal(snapshot.dormantSpaceView[0].tabs[0].url, 'https://saved.test/');

  const projected = projectChromeGroupRollbackMemory(snapshot);
  assert.deepEqual(projected.state, snapshot.state);
  assert.deepEqual(projected.logicalTitles, new Map(snapshot.logicalTitles));
  assert.deepEqual(projected.selectedTabIds, new Set(snapshot.selectedTabIds));
  assert.equal(projected.selectionAnchorTabId, 0);
  assert.deepEqual(projected.dormantSpaceView, snapshot.dormantSpaceView);
  assert.equal(projected.dormantSpaceViewSpaceId, 'saved');

  projected.state.nested.count = 3;
  projected.logicalTitles.set(0, 'Projected');
  projected.selectedTabIds.add(10);
  projected.dormantSpaceView[0].tabs[0].url = 'https://projected.test/';
  assert.equal(snapshot.state.nested.count, 1);
  assert.deepEqual(snapshot.logicalTitles, [[0, 'Zero'], [12, 'Twelve']]);
  assert.deepEqual(snapshot.selectedTabIds, [0, 7]);
  assert.equal(snapshot.dormantSpaceView[0].tabs[0].url, 'https://saved.test/');
});

test('captures each physical Chrome group title once and rejects unsafe ids without coercing empties to zero', () => {
  const empty = [];
  const withZero = captureChromeGroupTitleRollback(empty, {
    key: 'group:0',
    id: 99,
    title: '',
    displayTitle: 'Zero display',
  });
  assert.deepEqual(empty, [], 'the input title list remains unchanged');
  assert.deepEqual(withZero, [{ groupId: 0, title: '' }]);

  const withNumericString = captureChromeGroupTitleRollback(withZero, {
    key: 'not-a-group',
    id: '12',
    title: 'Twelve',
  });
  const withFallback = captureChromeGroupTitleRollback(withNumericString, {
    id: 13,
    title: '',
    displayTitle: '',
  });
  assert.deepEqual(withFallback, [
    { groupId: 0, title: '' },
    { groupId: 12, title: 'Twelve' },
    { groupId: 13, title: '' },
  ]);
  assert.equal(captureChromeGroupTitleRollback(withFallback, {
    key: 'group:13',
    title: 'Must not replace the first capture',
  }), withFallback);

  for (const group of [
    {},
    { id: null },
    { id: '' },
    { id: -1 },
    { id: 1.5 },
    { id: Infinity },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { key: 'group:-1' },
    { key: `group:${Number.MAX_SAFE_INTEGER + 1}` },
    { key: 12 },
  ]) {
    assert.equal(captureChromeGroupTitleRollback(withFallback, group), withFallback);
  }

  assert.deepEqual(captureChromeGroupTitleRollback(null, { id: 14, title: 'Fourteen' }), [
    { groupId: 14, title: 'Fourteen' },
  ]);
  assert.deepEqual(captureChromeGroupTitleRollback(null, { id: 16 }), [
    { groupId: 16, title: 'Group' },
  ]);
  assert.deepEqual(captureChromeGroupTitleRollback([{ groupId: null, title: 'Invalid' }], {
    id: 15,
    title: 'Fifteen',
  }), [
    { groupId: null, title: 'Invalid' },
    { groupId: 15, title: 'Fifteen' },
  ]);
});

test('resolves normalized Chrome group replacement chains without mutating or guessing through cycles', () => {
  const replacements = new Map([
    [10, 20],
    [20, 30],
    [30, 30],
    [40, 50],
    ['80', '90'],
    ['invalid', 100],
    [60, -1],
    [70, ''],
  ]);
  const before = [...replacements];

  assert.equal(resolveChromeGroupIdReplacement(10, replacements), 30);
  assert.equal(resolveChromeGroupIdReplacement(30, replacements), 30);
  assert.equal(resolveChromeGroupIdReplacement(40, replacements), 50);
  assert.equal(resolveChromeGroupIdReplacement(50, replacements), 50);
  assert.equal(resolveChromeGroupIdReplacement('80', replacements), 90);
  assert.equal(resolveChromeGroupIdReplacement(null, replacements), null);
  assert.equal(resolveChromeGroupIdReplacement('', replacements), null);
  assert.equal(resolveChromeGroupIdReplacement(-1, replacements), null);
  assert.deepEqual([...replacements], before);

  assert.equal(resolveChromeGroupIdReplacement(1, new Map([
    [1, 2],
    ['1', '2'],
  ])), 2);
  assert.throws(() => resolveChromeGroupIdReplacement(1, new Map([
    [1, 2],
    ['1', 3],
  ])), /conflicting replacement ids/);
  assert.throws(() => resolveChromeGroupIdReplacement(1, new Map([
    [1, 2],
    [2, 1],
  ])), /replacement cycle includes 1/);
});

test('remaps logical Chrome titles immutably across chains and reports ambiguous destinations', () => {
  const titles = new Map([
    [10, 'Ten'],
    [40, 'Forty'],
    [50, 'Fifty'],
  ]);
  const replacements = new Map([
    [10, 20],
    [20, 30],
    [40, 40],
  ]);
  const projected = remapLogicalChromeGroupTitles(titles, replacements);

  assert.deepEqual(projected, new Map([
    [30, 'Ten'],
    [40, 'Forty'],
    [50, 'Fifty'],
  ]));
  assert.notEqual(projected, titles);
  assert.deepEqual(titles, new Map([
    [10, 'Ten'],
    [40, 'Forty'],
    [50, 'Fifty'],
  ]));
  assert.deepEqual(remapLogicalChromeGroupTitles(new Map([[1, 'One']])), new Map([[1, 'One']]));
  assert.deepEqual(remapLogicalChromeGroupTitles(new Map(), replacements), new Map());

  assert.throws(() => remapLogicalChromeGroupTitles(new Map([
    [10, 'Source'],
    [20, 'Destination'],
  ]), new Map([[10, 20]])), /both map to 20/);
  assert.throws(() => remapLogicalChromeGroupTitles(new Map([
    [1, 'Numeric'],
    ['1', 'String'],
  ])), /both map to 1/);
  assert.throws(() => remapLogicalChromeGroupTitles(new Map([[null, 'Invalid']])), /Invalid logical Chrome group id/);
  assert.throws(() => remapLogicalChromeGroupTitles(new Map([[1, 'Cycle']]), new Map([
    [1, 2],
    [2, 1],
  ])), /replacement cycle/);
});

test('restores mixed original memberships and recreates a group Chrome deleted when it became empty', async () => {
  const browser = createGroupBrowser({
    tabs: [
      { id: 1, groupId: 10 },
      { id: 2, groupId: 10 },
      { id: 3, groupId: 20 },
      { id: 4, groupId: 20 },
      { id: 5, groupId: -1 },
    ],
    groups: [
      { id: 10, title: 'Alpha', color: 'red', collapsed: true },
      { id: 20, title: 'Beta', color: 'blue', collapsed: false },
    ],
    nextGroupId: 30,
  });
  const before = captureAll(browser);
  await browser.groupAs([1, 2, 3, 5], { title: 'Unexpected', color: 'grey' });
  assert.equal(browser.groups.has(10), false, 'Chrome removes a group after every member leaves');

  const replacements = await restoreTabGroupMembership(before, browser);

  assert.deepEqual([...replacements], [[10, 31]]);
  assert.deepEqual(browser.semanticLayout(), {
    groups: [
      { title: 'Alpha', color: 'red', collapsed: true, tabIds: [1, 2] },
      { title: 'Beta', color: 'blue', collapsed: false, tabIds: [3, 4] },
    ],
    ungroupedTabIds: [5],
  });
  assert.deepEqual(browser.calls.filter(([type]) => type === 'ungroup'), [
    ['ungroup', [1, 2, 3, 5]],
  ]);
  assert.ok(browser.calls.some((call) => call[0] === 'add' && call[1] === 20));
});

test('does nothing when memberships are already unchanged and ignores closed or invalid snapshot groups', async () => {
  const browser = createGroupBrowser({
    tabs: [{ id: 1, groupId: 10 }],
    groups: [{ id: 10, title: 'Kept', color: 'green' }],
  });
  const unchanged = captureAll(browser);
  unchanged.tabs.push({ tabId: 999, groupId: 12 });
  unchanged.groups.push(
    { groupId: 12, title: 'Closed', tabIds: [999] },
    { groupId: -1, title: 'Invalid', tabIds: [1] },
  );

  const supplied = new Map([[70, 71]]);
  assert.equal(await restoreTabGroupMembership(unchanged, browser, supplied), supplied);
  assert.deepEqual(browser.calls, [['list']]);
});

test('reports a group that cannot be reattached or recreated and preserves prior replacement results', async () => {
  const replacements = new Map([[1, 2]]);
  const snapshot = {
    tabs: [{ tabId: 8, groupId: 40 }],
    groups: [{ groupId: 40, title: ' Lost ', color: '', collapsed: false, tabIds: [8, 8, 'bad'] }],
  };
  const operations = {
    listTabs: async () => [{ id: 8, groupId: -1 }],
    ungroupTabs: async () => assert.fail('an already ungrouped tab must not be ungrouped again'),
    addTabsToGroup: async () => 'invalid',
    createGroup: async (tabIds, metadata) => {
      assert.deepEqual(tabIds, [8]);
      assert.deepEqual(metadata, { title: 'Lost', color: 'blue', collapsed: false });
      return null;
    },
  };

  await assert.rejects(
    () => restoreTabGroupMembership(snapshot, operations, replacements),
    /Could not restore Chrome group "Lost"/,
  );
  assert.deepEqual([...replacements], [[1, 2]]);
  assert.deepEqual(await restoreTabGroupMembership({}, {
    listTabs: async () => [],
  }), new Map());
  assert.deepEqual(await restoreTabGroupMembership({}, {
    listTabs: async () => null,
  }), new Map());

  let fallbackMetadata = null;
  const fallbackReplacements = await restoreTabGroupMembership({
    tabs: [{ tabId: 9, groupId: 50 }],
    groups: [{ groupId: 50, tabIds: [9] }],
  }, {
    listTabs: async () => [{ id: 9, groupId: -1 }],
    ungroupTabs: async () => assert.fail('the tab is already ungrouped'),
    addTabsToGroup: async () => null,
    createGroup: async (_tabIds, metadata) => {
      fallbackMetadata = metadata;
      return 51;
    },
  });
  assert.deepEqual(fallbackMetadata, { title: 'Group', color: 'blue', collapsed: false });
  assert.deepEqual([...fallbackReplacements], [[50, 51]]);

  await assert.rejects(() => restoreTabGroupMembership({
    tabs: [],
    groups: [{ groupId: 50, title: '', tabIds: [9] }],
  }, {
    listTabs: async () => [{ id: 9, groupId: 99 }],
    ungroupTabs: async () => {},
    addTabsToGroup: async () => null,
    createGroup: async () => null,
  }), /Could not restore Chrome group "Group"/);
});

test('rollback reports incomplete when Chrome loses a tab during ungroup or position restore', async () => {
  await assert.rejects(() => restoreTabGroupMembership({
    tabs: [{ tabId: 1, groupId: -1 }],
    groups: [],
  }, {
    listTabs: async () => [{ id: 1, groupId: 9 }],
    ungroupTabs: async () => ({ missing: true }),
  }), /closed or was replaced/);

  await assert.rejects(() => restoreTabGroupMembership({
    tabs: [{ tabId: 1, groupId: -1, windowId: 1, index: 0 }],
    groups: [],
  }, {
    listTabs: async () => [{ id: 1, groupId: -1, windowId: 1, index: 1 }],
    moveTab: async () => ({ missing: true }),
  }), /closed or was replaced/);
});

test('remaps every durable Chrome group binding while preserving order and unrelated metadata', () => {
  const state = {
    groupSpaces: { 10: 'work', 99: 'other' },
    collapsedGroups: { 'group:10': false, 'group:99': true },
    groupOrder: {
      work: ['group:10', 'group:20', 'group:30', 'group:20'],
      other: ['group:99'],
    },
    tabOrder: {
      work: {
        'group:10': [1, 2],
        'group:20': [2, 3],
      },
      other: { 'group:99': [9] },
    },
    tabLifecycle: {
      1: { groupId: 10, title: 'One' },
      2: { groupId: -1, title: 'Two' },
      3: null,
    },
  };
  const result = remapChromeGroupBindings(state, new Map([
    [10, 20],
    ['bad', 30],
    [30, 30],
  ]));

  assert.equal(result, state);
  assert.deepEqual(state.groupSpaces, { 20: 'work', 99: 'other' });
  assert.deepEqual(state.collapsedGroups, { 'group:20': false, 'group:99': true });
  assert.deepEqual(state.groupOrder, {
    work: ['group:20', 'group:30'],
    other: ['group:99'],
  });
  assert.deepEqual(state.tabOrder.work, { 'group:20': [1, 2, 3] });
  assert.equal(state.tabLifecycle[1].groupId, 20);
  assert.equal(state.tabLifecycle[2].groupId, -1);

  const minimal = {};
  assert.equal(remapChromeGroupBindings(minimal, new Map([[1, 2]])), minimal);

  const sparse = {
    groupSpaces: { 7: 'sparse' },
    collapsedGroups: { 'group:7': true },
    groupOrder: { sparse: null },
    tabOrder: { sparse: { 'group:7': [7] }, empty: null },
    tabLifecycle: {},
  };
  remapChromeGroupBindings(sparse, new Map([[7, 8]]));
  assert.deepEqual(sparse.groupOrder.sparse, []);
  assert.deepEqual(sparse.tabOrder.sparse, { 'group:8': [7] });

  const emptyPreviousOrder = {
    groupSpaces: {},
    collapsedGroups: {},
    groupOrder: {},
    tabOrder: { work: { 'group:11': null, 'group:12': [12] } },
    tabLifecycle: {},
  };
  remapChromeGroupBindings(emptyPreviousOrder, new Map([[11, 12]]));
  assert.deepEqual(emptyPreviousOrder.tabOrder.work, { 'group:12': [12] });
});

test('transaction returns the applied value and checkpoints it without rollback', async () => {
  const calls = [];
  const result = await runChromeGroupMutationTransaction({
    apply: async () => {
      calls.push('apply');
      return 42;
    },
    checkpoint: async (value) => calls.push(`checkpoint:${value}`),
    rollback: async () => calls.push('rollback'),
  });
  assert.equal(result, 42);
  assert.deepEqual(calls, ['apply', 'checkpoint:42']);
});

test('transaction rolls back both apply and checkpoint failures without hiding the original error', async () => {
  const applyFailure = new Error('apply failed');
  const checkpointFailure = new Error('save failed');
  const calls = [];
  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: async () => { throw applyFailure; },
    checkpoint: async () => assert.fail('checkpoint must not run'),
    rollback: async (error) => calls.push(error),
  }), (error) => error === applyFailure);
  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: async () => 'changed',
    checkpoint: async () => { throw checkpointFailure; },
    rollback: async (error) => calls.push(error),
  }), (error) => error === checkpointFailure);
  assert.deepEqual(calls, [applyFailure, checkpointFailure]);
});

test('transaction exposes rollback failure together with Error and non-Error causes', async () => {
  const rollbackFailure = new Error('restore failed');
  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: async () => {},
    checkpoint: async () => { throw new Error('write failed'); },
    rollback: async () => { throw rollbackFailure; },
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause.message, 'write failed');
    assert.equal(error.errors[1], rollbackFailure);
    assert.match(error.message, /write failed Chrome group rollback was incomplete/);
    return true;
  });

  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: async () => { throw 'offline'; },
    checkpoint: async () => {},
    rollback: async () => { throw new Error('also offline'); },
  }), (error) => {
    assert.match(error.message, /offline Chrome group rollback was incomplete/);
    return true;
  });
});

test('a multi-group folder rename restores every physical title after a partial update or save failure', async () => {
  for (const failureStage of ['second update', 'save']) {
    const titles = new Map([[10, 'Before A'], [20, 'Before B']]);
    const before = new Map(titles);
    await assert.rejects(() => runChromeGroupMutationTransaction({
      apply: async () => {
        titles.set(10, 'After A');
        if (failureStage === 'second update') throw new Error('second title update failed');
        titles.set(20, 'After B');
      },
      checkpoint: async () => {
        if (failureStage === 'save') throw new Error('title save failed');
      },
      rollback: async () => {
        for (const [groupId, title] of before) titles.set(groupId, title);
      },
    }), failureStage === 'save' ? /title save failed/ : /second title update failed/);
    assert.deepEqual(titles, before);
  }
});

test('same-group sorting restores the original window and index after its checkpoint fails', async () => {
  const browser = createGroupBrowser({
    tabs: [
      { id: 1, groupId: 10, windowId: 1, index: 0 },
      { id: 2, groupId: 10, windowId: 1, index: 1 },
      { id: 3, groupId: 10, windowId: 1, index: 2 },
    ],
    groups: [{ id: 10, title: 'Same', color: 'blue', collapsed: false }],
  });
  const rollbackSnapshot = captureTabGroupMembership(
    [...browser.tabs.values()],
    [...browser.groups.values()],
    [2],
  );
  assert.deepEqual(rollbackSnapshot.tabs, [
    { tabId: 2, groupId: 10, windowId: 1, index: 1 },
  ]);

  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: () => browser.moveTab(2, { index: 0 }),
    checkpoint: async () => { throw new Error('sort save failed'); },
    rollback: () => restoreTabGroupMembership(rollbackSnapshot, browser),
  }), /sort save failed/);

  assert.deepEqual(browser.orderedTabIds(1), [1, 2, 3]);
  assert.equal(browser.tabs.get(2).groupId, 10);
  assert.deepEqual(browser.calls.filter(([type]) => type === 'move').at(-1), [
    'move', 2, { index: 1, windowId: 1 },
  ]);
});

test('position restoration orders index-only records and skips invalid indexes without inventing a window', async () => {
  const tabs = [
    { id: 1, groupId: -1, index: 2 },
    { id: 2, groupId: -1, index: 0 },
    { id: 3, groupId: -1, index: -1 },
    { id: 4, groupId: -1, index: 'invalid' },
  ];
  const snapshot = captureTabGroupMembership(tabs, [], [1, 2, 3, 4]);
  const moves = [];
  await restoreTabGroupMembership(snapshot, {
    listTabs: async () => tabs,
    ungroupTabs: async () => {},
    addTabsToGroup: async () => null,
    createGroup: async () => null,
    moveTab: async (tabId, position) => moves.push([tabId, position]),
  });
  assert.deepEqual(moves, [
    [2, { index: 0 }],
    [1, { index: 2 }],
  ]);
});

test('Auto Group Undo can restore captured physical positions without changing memberships again', async () => {
  const moves = [];
  await restoreTabPositions(null, null, async () => {
    assert.fail('empty legacy checkpoints must not attempt a tab move');
  });
  await restoreTabPositions([
    { tabId: 2, groupId: -1, windowId: 4, index: 2 },
    { tabId: 1, groupId: 9, windowId: 4, index: 1 },
    { tabId: 999, groupId: -1, windowId: 4, index: 0 },
  ], [
    { id: 1, groupId: 101, windowId: 4, index: 2 },
    { id: 2, groupId: -1, windowId: 4, index: 1 },
  ], async (tabId, position) => {
    moves.push([tabId, position]);
    return {};
  });

  assert.deepEqual(moves, [
    [1, { index: 1, windowId: 4 }],
    [2, { index: 2, windowId: 4 }],
  ]);
});

test('cross-group rollback recreates a vanished one-tab source group and restores its position', async () => {
  const browser = createGroupBrowser({
    tabs: [
      { id: 1, groupId: 10, windowId: 1, index: 0 },
      { id: 2, groupId: 20, windowId: 1, index: 1 },
      { id: 3, groupId: 20, windowId: 1, index: 2 },
    ],
    groups: [
      { id: 10, title: 'Source', color: 'red', collapsed: true },
      { id: 20, title: 'Target', color: 'green', collapsed: false },
    ],
    nextGroupId: 30,
  });
  const rollbackSnapshot = captureTabGroupMembership(
    [...browser.tabs.values()],
    [...browser.groups.values()],
    [1],
  );

  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: async () => {
      await browser.addTabsToGroup(20, [1]);
      await browser.moveTab(1, { index: 2 });
      assert.equal(browser.groups.has(10), false);
    },
    checkpoint: async () => { throw new Error('cross-group save failed'); },
    rollback: () => restoreTabGroupMembership(rollbackSnapshot, browser),
  }), /cross-group save failed/);

  assert.deepEqual(browser.orderedTabIds(1), [1, 2, 3]);
  assert.deepEqual(browser.semanticLayout(), {
    groups: [
      { title: 'Source', color: 'red', collapsed: true, tabIds: [1] },
      { title: 'Target', color: 'green', collapsed: false, tabIds: [2, 3] },
    ],
    ungroupedTabIds: [],
  });
});

test('rollback recreates an explicitly untitled Chrome group without a display-name fallback', async () => {
  const browser = createGroupBrowser({
    tabs: [
      { id: 1, groupId: 10, windowId: 1, index: 0 },
      { id: 2, groupId: 20, windowId: 1, index: 1 },
    ],
    groups: [
      { id: 10, title: '', displayTitle: 'Invented label', color: 'cyan', collapsed: true },
      { id: 20, title: 'Target', color: 'green', collapsed: false },
    ],
    nextGroupId: 30,
  });
  const rollbackSnapshot = captureTabGroupMembership(
    [...browser.tabs.values()],
    [...browser.groups.values()],
    [1],
  );
  assert.equal(rollbackSnapshot.groups[0].title, '');

  await browser.addTabsToGroup(20, [1]);
  assert.equal(browser.groups.has(10), false);
  const replacements = await restoreTabGroupMembership(rollbackSnapshot, browser);

  assert.deepEqual([...replacements], [[10, 30]]);
  assert.deepEqual(browser.calls.filter(([type]) => type === 'create').at(-1), [
    'create',
    [1],
    { title: '', color: 'cyan', collapsed: true },
  ]);
  assert.deepEqual(browser.semanticLayout(), {
    groups: [
      { title: '', color: 'cyan', collapsed: true, tabIds: [1] },
      { title: 'Target', color: 'green', collapsed: false, tabIds: [2] },
    ],
    ungroupedTabIds: [],
  });
});

test('virtual target rollback ungroups every batch-materialized tab and restores all original positions', async () => {
  const browser = createGroupBrowser({
    tabs: [
      { id: 1, groupId: 10, windowId: 1, index: 0 },
      { id: 2, groupId: -1, windowId: 1, index: 1 },
      { id: 3, groupId: -1, windowId: 1, index: 2 },
    ],
    groups: [{ id: 10, title: 'Source', color: 'purple', collapsed: true }],
    nextGroupId: 20,
  });
  const rollbackSnapshot = captureTabGroupMembership(
    [...browser.tabs.values()],
    [...browser.groups.values()],
    [1, 2, 3],
  );

  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: async () => {
      await browser.groupAs([1, 2, 3], { title: 'Virtual target', color: 'cyan', collapsed: false });
      await browser.moveTab(1, { index: 2 });
    },
    checkpoint: async () => { throw new Error('virtual save failed'); },
    rollback: () => restoreTabGroupMembership(rollbackSnapshot, browser),
  }), /virtual save failed/);

  assert.deepEqual(browser.orderedTabIds(1), [1, 2, 3]);
  assert.deepEqual(browser.semanticLayout(), {
    groups: [{ title: 'Source', color: 'purple', collapsed: true, tabIds: [1] }],
    ungroupedTabIds: [2, 3],
  });
});

test('Auto Group Apply restores full Chrome and workspace state when creating its second target group fails', async () => {
  const browser = createGroupBrowser({
    tabs: [
      { id: 1, groupId: 10, windowId: 1, index: 0 },
      { id: 2, groupId: 10, windowId: 1, index: 1 },
      { id: 3, groupId: 20, windowId: 1, index: 2 },
      { id: 4, groupId: 20, windowId: 1, index: 3 },
      { id: 5, groupId: -1, windowId: 1, index: 4, pinned: true },
    ],
    groups: [
      { id: 10, title: 'Before A', color: 'red', collapsed: true },
      { id: 20, title: 'Before B', color: 'cyan', collapsed: false },
    ],
    nextGroupId: 30,
  });
  const originalState = autoGroupRollbackState();
  let memory = autoGroupRollbackMemory(originalState);
  const rollbackMemory = captureChromeGroupMutationMemory(memory);
  const rollbackMembership = captureAll(browser);
  const beforeLayout = browser.semanticLayout();
  const beforeTabOrder = browser.orderedTabIds();
  let persistedState = structuredClone(originalState);
  let replacements = new Map();
  browser.failCreateOnceAt(2);

  assert.deepEqual(
    rollbackMembership.tabs.map((tab) => tab.tabId),
    [1, 2, 3, 4, 5],
    'rollback includes grouped, ungrouped, and pinned live tabs',
  );
  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: async () => {
      memory.state.spaceSnapshots.work = {
        version: 1,
        updatedAt: 999,
        groups: [{ title: 'Proposal A', tabs: [{ url: 'https://one.test/' }] }],
      };
      memory.state.operationHistory.push({
        id: 'ghost-auto-group',
        type: 'auto-group',
        status: 'applied',
      });
      await browser.ungroupTabs([...browser.tabs.keys()]);
      const proposalGroupId = await browser.createGroup([1, 3], {
        title: 'Proposal A',
        color: 'yellow',
        collapsed: false,
      });
      memory.state.groupSpaces = { [proposalGroupId]: 'work', 99: 'other' };
      memory.state.groupOrder.work = [`group:${proposalGroupId}`, 'ungrouped'];
      memory.state.tabOrder.work = {
        [`group:${proposalGroupId}`]: [1, 3],
        ungrouped: [2, 4, 5],
      };
      memory.state.collapsedGroups = {
        [`group:${proposalGroupId}`]: false,
        ungrouped: false,
      };
      memory.state.tabLifecycle[1].groupId = proposalGroupId;
      memory.state.tabLifecycle[2].groupId = -1;
      memory.state.tabLifecycle[3].groupId = proposalGroupId;
      memory.state.tabLifecycle[4].groupId = -1;
      memory.logicalTitles = new Map([
        [proposalGroupId, 'Proposal A'],
        [99, 'Other'],
      ]);
      await browser.moveTab(3, { index: 0, windowId: 1 });
      await browser.createGroup([2, 4], {
        title: 'Proposal B',
        color: 'green',
        collapsed: true,
      });
    },
    checkpoint: async () => assert.fail('the partial browser mutation must not be checkpointed'),
    rollback: async () => {
      replacements = await restoreTabGroupMembership(rollbackMembership, browser);
      memory = projectChromeGroupRollbackMemory(rollbackMemory, replacements);
      persistedState = structuredClone(memory.state);
    },
  }), /create 2 failed/);

  const expected = projectChromeGroupRollbackMemory(rollbackMemory, replacements);
  assert.deepEqual(browser.semanticLayout(), beforeLayout);
  assert.deepEqual(browser.orderedTabIds(), beforeTabOrder);
  assert.deepEqual([...replacements.keys()], [10, 20]);
  assert.equal(browser.groups.has(30), false, 'the first newly created proposal group is removed');
  assert.equal(
    [...browser.groups.values()].some((group) => String(group.title).startsWith('Proposal')),
    false,
  );
  assertAutoGroupStateRestored(memory.state, expected.state, originalState);
  assert.deepEqual(memory.logicalTitles, expected.logicalTitles);
  assert.deepEqual(memory.selectedTabIds, expected.selectedTabIds);
  assert.equal(memory.selectionAnchorTabId, expected.selectionAnchorTabId);
  assert.deepEqual(memory.dormantSpaceView, expected.dormantSpaceView);
  assert.equal(memory.dormantSpaceViewSpaceId, expected.dormantSpaceViewSpaceId);
  assert.deepEqual(persistedState, expected.state);
});

test('Auto Group Apply compensates an applied-then-rejected workspace write before full rollback', async () => {
  const browser = createGroupBrowser({
    tabs: [
      { id: 1, groupId: 10, windowId: 1, index: 0 },
      { id: 2, groupId: 10, windowId: 1, index: 1 },
      { id: 3, groupId: 20, windowId: 1, index: 2 },
      { id: 4, groupId: 20, windowId: 1, index: 3 },
      { id: 5, groupId: -1, windowId: 1, index: 4, pinned: true },
    ],
    groups: [
      { id: 10, title: 'Before A', color: 'red', collapsed: true },
      { id: 20, title: 'Before B', color: 'cyan', collapsed: false },
    ],
    nextGroupId: 30,
  });
  const originalState = autoGroupRollbackState();
  let memory = autoGroupRollbackMemory(originalState);
  const rollbackMemory = captureChromeGroupMutationMemory(memory);
  const rollbackMembership = captureAll(browser);
  const beforeLayout = browser.semanticLayout();
  const beforeTabOrder = browser.orderedTabIds();
  const storageError = new Error('workspace host applied the value, then rejected');
  const storageWrites = [];
  let storedWorkspace = structuredClone(originalState);
  let rejectAfterFirstAppliedWrite = true;
  let replacements = new Map();

  const persistWorkspace = (value) => persistStorageStep({
    key: 'workspace',
    value: structuredClone(value),
    get: async () => ({ workspace: structuredClone(storedWorkspace) }),
    set: async (items) => {
      storedWorkspace = structuredClone(items.workspace);
      storageWrites.push(structuredClone(storedWorkspace));
      if (rejectAfterFirstAppliedWrite) {
        rejectAfterFirstAppliedWrite = false;
        throw storageError;
      }
    },
    remove: async () => assert.fail('the workspace key existed before the transaction'),
  });

  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: async () => {
      await browser.ungroupTabs([...browser.tabs.keys()]);
      const firstGroupId = await browser.createGroup([1, 3], {
        title: 'After A',
        color: 'yellow',
        collapsed: false,
      });
      const secondGroupId = await browser.createGroup([2, 5], {
        title: 'After B',
        color: 'green',
        collapsed: true,
      });
      await browser.moveTab(4, { index: 0, windowId: 1 });
      memory.state.groupSpaces = {
        [firstGroupId]: 'work',
        [secondGroupId]: 'work',
        99: 'other',
      };
      memory.state.groupOrder.work = [
        `group:${firstGroupId}`,
        `group:${secondGroupId}`,
        'ungrouped',
      ];
      memory.state.tabOrder.work = {
        [`group:${firstGroupId}`]: [1, 3],
        [`group:${secondGroupId}`]: [2, 5],
        ungrouped: [4],
      };
      memory.state.collapsedGroups = {
        [`group:${firstGroupId}`]: false,
        [`group:${secondGroupId}`]: true,
        ungrouped: false,
      };
      memory.state.tabLifecycle[1].groupId = firstGroupId;
      memory.state.tabLifecycle[2].groupId = secondGroupId;
      memory.state.tabLifecycle[3].groupId = firstGroupId;
      memory.state.tabLifecycle[4].groupId = -1;
      memory.state.tabLifecycle[5].groupId = secondGroupId;
      memory.state.spaceSnapshots.work = {
        version: 1,
        updatedAt: 999,
        groups: [{ title: 'After A' }, { title: 'After B' }],
      };
      memory.state.operationHistory.push({
        id: 'ghost-auto-group',
        type: 'auto-group',
        status: 'applied',
      });
      memory.logicalTitles = new Map([
        [firstGroupId, 'After A'],
        [secondGroupId, 'After B'],
        [99, 'Other'],
      ]);
    },
    checkpoint: () => persistWorkspace(memory.state),
    rollback: async () => {
      replacements = await restoreTabGroupMembership(rollbackMembership, browser);
      memory = projectChromeGroupRollbackMemory(rollbackMemory, replacements);
      await persistWorkspace(memory.state);
    },
  }), (error) => error === storageError);

  const expected = projectChromeGroupRollbackMemory(rollbackMemory, replacements);
  assert.equal(storageWrites.length, 3);
  assert.equal(
    storageWrites[0].operationHistory.some((operation) => operation?.id === 'ghost-auto-group'),
    true,
    'the storage host really did observe the proposed state before rejecting',
  );
  assert.deepEqual(storageWrites[1], originalState, 'single-key compensation restores the old value');
  assert.deepEqual(storageWrites[2], expected.state, 'rollback persists remapped Chrome group bindings');
  assert.deepEqual(browser.semanticLayout(), beforeLayout);
  assert.deepEqual(browser.orderedTabIds(), beforeTabOrder);
  assert.equal(browser.groups.has(30), false);
  assert.equal(browser.groups.has(31), false);
  assert.equal(
    [...browser.groups.values()].some((group) => String(group.title).startsWith('After')),
    false,
  );
  assertAutoGroupStateRestored(memory.state, expected.state, originalState);
  assert.deepEqual(memory.logicalTitles, expected.logicalTitles);
  assert.deepEqual(memory.selectedTabIds, expected.selectedTabIds);
  assert.equal(memory.selectionAnchorTabId, expected.selectionAnchorTabId);
  assert.deepEqual(memory.dormantSpaceView, expected.dormantSpaceView);
  assert.equal(memory.dormantSpaceViewSpaceId, expected.dormantSpaceViewSpaceId);
  assert.deepEqual(storedWorkspace, expected.state);
});

test('Auto Group Undo restores the exact pre-Undo layout when creating its second target group fails', async () => {
  const browser = createGroupBrowser({
    tabs: [
      { id: 1, groupId: 10 },
      { id: 2, groupId: 10 },
      { id: 3, groupId: 20 },
      { id: 4, groupId: 20 },
    ],
    groups: [
      { id: 10, title: 'Auto A', color: 'red', collapsed: true },
      { id: 20, title: 'Auto B', color: 'cyan', collapsed: false },
    ],
    nextGroupId: 30,
  });
  const autoLayout = browser.semanticLayout();
  const rollbackSnapshot = captureAll(browser);
  browser.failCreateOnceAt(2);

  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: () => replaceWholeLayout(browser, [
      { title: 'Old X', color: 'yellow', collapsed: false, tabIds: [1, 3] },
      { title: 'Old Y', color: 'green', collapsed: true, tabIds: [2, 4] },
    ]),
    checkpoint: async () => {},
    rollback: () => restoreTabGroupMembership(rollbackSnapshot, browser),
  }), /create 2 failed/);

  assert.deepEqual(browser.semanticLayout(), autoLayout);
});

test('a one-time save failure after browser changes restores the user-visible group layout', async () => {
  const browser = createGroupBrowser({
    tabs: [
      { id: 1, groupId: 10 },
      { id: 2, groupId: 10 },
      { id: 3, groupId: -1 },
    ],
    groups: [{ id: 10, title: 'Before', color: 'purple', collapsed: true }],
    nextGroupId: 20,
  });
  const beforeLayout = browser.semanticLayout();
  const rollbackSnapshot = captureAll(browser);
  let saveAttempts = 0;

  await assert.rejects(() => runChromeGroupMutationTransaction({
    apply: () => replaceWholeLayout(browser, [
      { title: 'After', color: 'blue', collapsed: false, tabIds: [1, 3] },
    ], [2]),
    checkpoint: async () => {
      saveAttempts += 1;
      throw new Error('one-time storage failure');
    },
    rollback: async () => {
      await restoreTabGroupMembership(rollbackSnapshot, browser);
      saveAttempts += 1;
    },
  }), /one-time storage failure/);

  assert.equal(saveAttempts, 2, 'rollback gets a fresh persistence attempt');
  assert.deepEqual(browser.semanticLayout(), beforeLayout);
});
