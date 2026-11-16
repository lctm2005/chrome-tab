import test from 'node:test';
import assert from 'node:assert/strict';

import { migratePanelTabIdReplacement } from '../src/shared/tab-replacement.js';

test('tab replacement migrates every panel identity without mutating the source model', () => {
  const oldTab = { id: 7, url: 'https://same.example/page', title: 'Old page' };
  const newTab = {
    id: 70,
    url: 'https://same.example/replaced',
    title: 'Replacement page',
    active: true,
  };
  const model = {
    marker: 'preserved',
    tabs: [
      { ...oldTab, active: true, snapshotTabId: 'stable-old' },
      { id: 8, title: 'Other live tab' },
    ],
    foreignLiveTabs: [{ id: 9, title: 'Other window' }],
    selectedTabIds: new Set([7, 8]),
    selectionAnchorTabId: 7,
    recentlyOpenedDormantTabs: [
      { tabId: '7', snapshotTabId: 'snapshot-old' },
      { tabId: 8, snapshotTabId: 'snapshot-other' },
      null,
    ],
    syntheticPlaceholderTabIds: new Set([7, 70, 9]),
    dragState: { type: 'tab', tabId: '7' },
  };
  const sourceSnapshot = structuredClone(model);

  const result = migratePanelTabIdReplacement(model, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: newTab,
  });

  assert.equal(result.replacementApplied, true);
  assert.equal(result.dragInvalidated, true);
  assert.equal(result.marker, 'preserved');
  assert.equal(result.visibleTabsChanged, true);
  assert.deepEqual(result.tabs, [
    {
      ...oldTab,
      active: true,
      snapshotTabId: 'stable-old',
      ...newTab,
      id: 70,
    },
    { id: 8, title: 'Other live tab' },
  ]);
  assert.equal(result.foreignLiveTabs, model.foreignLiveTabs);
  assert.deepEqual(result.selectedTabIds, [70, 8]);
  assert.equal(result.selectionAnchorTabId, 70);
  assert.deepEqual(result.recentlyOpenedDormantTabs, [
    { tabId: 70, snapshotTabId: 'snapshot-old' },
    { tabId: 8, snapshotTabId: 'snapshot-other' },
    null,
  ]);
  assert.deepEqual(result.syntheticPlaceholderTabIds, [70, 9]);
  assert.deepEqual(model, sourceSnapshot);
});

test('tab replacement updates visible collections immediately, preserves order, and removes stale duplicates', () => {
  const oldLiveTab = {
    id: 7,
    title: 'Old live title',
    url: 'https://old.example/',
    snapshotTabId: 'stable-row',
  };
  const existingReplacement = {
    id: 70,
    title: 'Already observed replacement',
    url: 'https://intermediate.example/',
    groupId: 4,
  };
  const otherTab = { id: 8, title: 'Keep position' };
  const primitive = 'malformed-but-preserved';
  const foreignOld = { id: '7', title: 'Foreign old', windowId: 2 };
  const model = {
    tabs: [otherTab, oldLiveTab, primitive, existingReplacement],
    foreignLiveTabs: [foreignOld, { id: 9, title: 'Foreign other' }],
  };
  const source = structuredClone(model);

  const migrated = migratePanelTabIdReplacement(model, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: {
      id: 70,
      title: 'Final replacement',
      url: 'https://final.example/',
      active: true,
    },
  });

  assert.equal(migrated.visibleTabsChanged, true);
  assert.deepEqual(migrated.tabs, [
    otherTab,
    {
      ...oldLiveTab,
      ...existingReplacement,
      title: 'Final replacement',
      url: 'https://final.example/',
      active: true,
      id: 70,
    },
    primitive,
  ]);
  assert.deepEqual(migrated.foreignLiveTabs, [
    {
      ...foreignOld,
      id: 70,
      title: 'Final replacement',
      url: 'https://final.example/',
      active: true,
    },
    { id: 9, title: 'Foreign other' },
  ]);
  assert.deepEqual(model, source);
});

test('a repeated replacement enriches the already-rendered row without changing its position', () => {
  const tabs = [
    { id: 1, title: 'Before' },
    { id: 70, title: 'Loading', snapshotTabId: 'stable-row' },
    { id: 2, title: 'After' },
  ];
  const result = migratePanelTabIdReplacement({ tabs, foreignLiveTabs: [] }, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: { id: 70, title: 'Loaded', status: 'complete' },
  });

  assert.equal(result.visibleTabsChanged, true);
  assert.deepEqual(result.tabs, [
    tabs[0],
    { id: 70, title: 'Loaded', snapshotTabId: 'stable-row', status: 'complete' },
    tabs[2],
  ]);
  assert.deepEqual(result.foreignLiveTabs, []);
});

test('a replacement outside the visible collections preserves their references and skips rendering work', () => {
  const tabs = [{ id: 1, title: 'Visible' }, null];
  const foreignLiveTabs = [{ id: 2, title: 'Other window' }];
  const result = migratePanelTabIdReplacement({ tabs, foreignLiveTabs }, {
    removedTabId: 7,
    addedTabId: 70,
  });

  assert.equal(result.visibleTabsChanged, false);
  assert.equal(result.tabs, tabs);
  assert.equal(result.foreignLiveTabs, foreignLiveTabs);
});

test('repeating a replacement migrates selection and placeholder ids consistently', () => {
  const oldTab = { id: 7, url: 'https://example.test/old', title: 'Old' };
  const first = migratePanelTabIdReplacement({
    selectedTabIds: [7],
    selectionAnchorTabId: 7,
    recentlyOpenedDormantTabs: [{ tabId: 7 }],
    syntheticPlaceholderTabIds: [7],
    dragState: { type: 'group', tabId: 7 },
  }, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: { id: 70 },
  });

  const second = migratePanelTabIdReplacement(first, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: {
      id: 70,
      url: 'https://example.test/final',
      title: 'Loaded replacement',
    },
  });

  assert.equal(first.dragInvalidated, false);
  assert.equal(second.dragInvalidated, false);
  assert.deepEqual(second.selectedTabIds, [70]);
  assert.equal(second.selectionAnchorTabId, 70);
  assert.deepEqual(second.syntheticPlaceholderTabIds, [70]);
  assert.deepEqual(second.recentlyOpenedDormantTabs, [{ tabId: 70 }]);
});

test('malformed optional state is normalized safely for a valid numeric-string replacement', () => {
  const result = migratePanelTabIdReplacement({
    selectedTabIds: ['7', 'bad', 7],
    selectionAnchorTabId: '7',
    recentlyOpenedDormantTabs: null,
    syntheticPlaceholderTabIds: 'not-iterable',
    dragState: null,
  }, {
    removedTabId: '7',
    addedTabId: '70',
    replacementTab: [],
  });

  assert.equal(result.replacementApplied, true);
  assert.equal(result.dragInvalidated, false);
  assert.deepEqual(result.selectedTabIds, [70]);
  assert.equal(result.selectionAnchorTabId, 70);
  assert.deepEqual(result.recentlyOpenedDormantTabs, []);
  assert.deepEqual(result.syntheticPlaceholderTabIds, []);

  const emptyModel = migratePanelTabIdReplacement([], {
    removedTabId: 2,
    addedTabId: 3,
  });
  assert.deepEqual(emptyModel.selectedTabIds, []);
  assert.deepEqual(emptyModel.recentlyOpenedDormantTabs, []);
  assert.deepEqual(emptyModel.syntheticPlaceholderTabIds, []);
});

test('invalid and no-op replacements preserve the source model and report no UI invalidation', () => {
  const marker = { nested: true };
  const model = { marker, selectedTabIds: new Set([7]), dragState: { type: 'tab', tabId: 7 } };
  const invalidReplacements = [
    undefined,
    null,
    [],
    {},
    { removedTabId: null, addedTabId: 70 },
    { removedTabId: 7, addedTabId: undefined },
    { removedTabId: 7, addedTabId: '' },
    { removedTabId: 7, addedTabId: 'not-a-tab' },
    { removedTabId: 7.5, addedTabId: 70 },
    { removedTabId: -1, addedTabId: 70 },
    { removedTabId: 7, addedTabId: Number.MAX_SAFE_INTEGER + 1 },
    { removedTabId: 7, addedTabId: 7 },
  ];

  for (const replacement of invalidReplacements) {
    const result = migratePanelTabIdReplacement(model, replacement);
    assert.equal(result.replacementApplied, false);
    assert.equal(result.dragInvalidated, false);
    assert.equal(result.marker, marker);
    assert.equal(result.selectedTabIds, model.selectedTabIds);
  }

  assert.deepEqual(migratePanelTabIdReplacement(), {
    replacementApplied: false,
    dragInvalidated: false,
  });
  assert.deepEqual(migratePanelTabIdReplacement(null, null), {
    replacementApplied: false,
    dragInvalidated: false,
  });
});

test('only a live tab drag for the removed id is invalidated', () => {
  for (const dragState of [
    undefined,
    null,
    { type: 'group', tabId: 7 },
    { type: 'tab', tabId: 8 },
    { type: 'tab', tabId: null },
  ]) {
    const result = migratePanelTabIdReplacement({ dragState }, {
      removedTabId: 7,
      addedTabId: 70,
    });
    assert.equal(result.dragInvalidated, false);
  }

  assert.equal(migratePanelTabIdReplacement({
    dragState: { type: 'tab', tabId: '7' },
  }, {
    removedTabId: 7,
    addedTabId: 70,
  }).dragInvalidated, true);
});

test('null metadata never aliases the legitimate Chrome tab id zero', () => {
  const dormant = { tabId: null, snapshotTabId: 'snapshot-only' };
  const result = migratePanelTabIdReplacement({
    selectedTabIds: [0],
    selectionAnchorTabId: 0,
    recentlyOpenedDormantTabs: [dormant],
    syntheticPlaceholderTabIds: new Set([0]),
    dragState: { type: 'tab', tabId: null },
  }, {
    removedTabId: 0,
    addedTabId: 1,
  });

  assert.deepEqual(result.selectedTabIds, [1]);
  assert.equal(result.selectionAnchorTabId, 1);
  assert.equal(result.recentlyOpenedDormantTabs[0], dormant);
  assert.deepEqual(result.syntheticPlaceholderTabIds, [1]);
  assert.equal(result.dragInvalidated, false);
});
