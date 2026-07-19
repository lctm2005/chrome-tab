import test from 'node:test';
import assert from 'node:assert/strict';

import {
  replaceSelectionTabId,
  resolveFreshTabSelection,
  selectionForContextMenu,
  tabSelectionFromClick,
} from '../src/shared/tab-selection.js';

test('plain tab click selects only the clicked tab', () => {
  const selection = tabSelectionFromClick({
    orderedTabIds: [10, 20, 30],
    selectedTabIds: [10, 30],
    anchorTabId: 10,
    clickedTabId: 20,
  });

  assert.deepEqual(selection, { selectedTabIds: [20], anchorTabId: 20 });
});

test('additive tab click toggles a tab while keeping other selections', () => {
  const selection = tabSelectionFromClick({
    orderedTabIds: [10, 20, 30],
    selectedTabIds: [10],
    anchorTabId: 10,
    clickedTabId: 30,
    additive: true,
  });

  assert.deepEqual(selection, { selectedTabIds: [10, 30], anchorTabId: 30 });
});

test('shift tab click selects an ordered range from the anchor', () => {
  const selection = tabSelectionFromClick({
    orderedTabIds: [10, 20, 30, 40],
    selectedTabIds: [10],
    anchorTabId: 20,
    clickedTabId: 40,
    range: true,
  });

  assert.deepEqual(selection, { selectedTabIds: [20, 30, 40], anchorTabId: 20 });
});

test('shift tab click supports a reverse range without duplicating ordered ids', () => {
  const selection = tabSelectionFromClick({
    orderedTabIds: [10, 20, '20', 30, 40],
    selectedTabIds: [40],
    anchorTabId: 40,
    clickedTabId: 10,
    range: true,
  });

  assert.deepEqual(selection, { selectedTabIds: [10, 20, 30, 40], anchorTabId: 40 });
});

test('range selection falls back to the clicked tab when its anchor is missing', () => {
  assert.deepEqual(tabSelectionFromClick({
    orderedTabIds: [10, 20, 30],
    selectedTabIds: [10, 20],
    clickedTabId: 30,
    range: true,
  }), { selectedTabIds: [30], anchorTabId: 30 });

  assert.deepEqual(tabSelectionFromClick({
    orderedTabIds: [10, 20, 30],
    selectedTabIds: [10, 20],
    anchorTabId: 99,
    clickedTabId: 30,
    range: true,
  }), { selectedTabIds: [30], anchorTabId: 30 });
});

test('additive click removes an already selected tab', () => {
  const selection = tabSelectionFromClick({
    orderedTabIds: [10, 20, 30],
    selectedTabIds: [10, 20, 30],
    anchorTabId: 10,
    clickedTabId: 20,
    additive: true,
  });

  assert.deepEqual(selection, { selectedTabIds: [10, 30], anchorTabId: 20 });
});

test('missing clicks preserve a normalized unique selection and anchor', () => {
  const invalidIds = [10, '10', 20, 20, null, '', undefined, NaN, Infinity, -1, 2.5, 'bad'];

  assert.deepEqual(tabSelectionFromClick({
    selectedTabIds: invalidIds,
    anchorTabId: '20',
  }), { selectedTabIds: [10, 20], anchorTabId: 20 });
  assert.deepEqual(tabSelectionFromClick({
    selectedTabIds: invalidIds,
    anchorTabId: null,
    clickedTabId: '',
  }), { selectedTabIds: [10, 20], anchorTabId: null });
});

test('context menu preserves a multi-selection only when right-clicking inside it', () => {
  assert.deepEqual(selectionForContextMenu({ selectedTabIds: [10, 20], clickedTabId: 20 }), [10, 20]);
  assert.deepEqual(selectionForContextMenu({ selectedTabIds: [10, 20], clickedTabId: 30 }), [30]);
});

test('context menu ignores invalid and duplicate tab ids', () => {
  const selectedTabIds = [10, '10', null, '', NaN, Infinity, -1, 2.5, 20, 20];

  assert.deepEqual(selectionForContextMenu({ selectedTabIds, clickedTabId: '20' }), [10, 20]);
  assert.deepEqual(selectionForContextMenu({ selectedTabIds, clickedTabId: 30 }), [30]);
  assert.deepEqual(selectionForContextMenu({ selectedTabIds: null, clickedTabId: 30 }), [30]);
  assert.deepEqual(selectionForContextMenu({ selectedTabIds, clickedTabId: null }), []);
  assert.deepEqual(selectionForContextMenu({ selectedTabIds, clickedTabId: 'bad' }), []);
});

test('tab replacement keeps selected and anchored identity on Chrome replacement ids', () => {
  assert.deepEqual(replaceSelectionTabId({
    selectedTabIds: [10, 20],
    anchorTabId: 10,
    removedTabId: 10,
    addedTabId: 30,
  }), { selectedTabIds: [30, 20], anchorTabId: 30 });

  assert.deepEqual(replaceSelectionTabId({
    selectedTabIds: [10, 20],
    anchorTabId: 20,
    removedTabId: 10,
    addedTabId: 20,
  }), { selectedTabIds: [20], anchorTabId: 20 });
});

test('invalid or irrelevant tab replacements preserve a normalized selection', () => {
  assert.deepEqual(replaceSelectionTabId({
    selectedTabIds: [10, '10', 20],
    anchorTabId: '20',
    removedTabId: 'bad',
    addedTabId: 30,
  }), { selectedTabIds: [10, 20], anchorTabId: 20 });
  assert.deepEqual(replaceSelectionTabId({
    selectedTabIds: [10, 20],
    anchorTabId: 10,
    removedTabId: 10,
    addedTabId: 10,
  }), { selectedTabIds: [10, 20], anchorTabId: 10 });
});

test('fresh tab selection preserves requested order and returns the exact live objects', () => {
  const first = { id: 10, title: 'First' };
  const second = { id: 20, title: 'Second' };
  const result = resolveFreshTabSelection({
    requestedTabIds: ['20', 10, '20'],
    tabs: [first, second],
    isEligible: (tab) => tab.title !== '',
  });

  assert.deepEqual(result, {
    status: 'ready',
    requestedTabIds: [20, 10],
    selectedTabs: [second, first],
    unavailableTabIds: [],
  });
  assert.equal(result.selectedTabs[0], second);
  assert.equal(result.selectedTabs[1], first);
});

test('fresh tab selection rejects the whole action when any requested tab changed', () => {
  const first = { id: 10, pinned: false };
  const newlyPinned = { id: 20, pinned: true };
  assert.deepEqual(resolveFreshTabSelection({
    requestedTabIds: [10, 20, 30],
    tabs: [first, newlyPinned],
    isEligible: (tab) => !tab.pinned,
  }), {
    status: 'stale',
    requestedTabIds: [10, 20, 30],
    selectedTabs: [first],
    unavailableTabIds: [20, 30],
  });
});

test('fresh tab selection normalizes empty, duplicate, malformed, and optional inputs', () => {
  assert.deepEqual(resolveFreshTabSelection(), {
    status: 'empty',
    requestedTabIds: [],
    selectedTabs: [],
    unavailableTabIds: [],
  });
  assert.deepEqual(resolveFreshTabSelection({
    requestedTabIds: [0, '0', -1, 1.5, '', 'bad'],
    tabs: [{ id: 0, value: 'first' }, { id: '0', value: 'duplicate' }, null, { id: -1 }],
    isEligible: null,
  }), {
    status: 'ready',
    requestedTabIds: [0],
    selectedTabs: [{ id: 0, value: 'first' }],
    unavailableTabIds: [],
  });
  assert.deepEqual(resolveFreshTabSelection({ requestedTabIds: [1], tabs: null }), {
    status: 'stale',
    requestedTabIds: [1],
    selectedTabs: [],
    unavailableTabIds: [1],
  });
  assert.deepEqual(resolveFreshTabSelection({
    requestedTabIds: [2],
    tabs: [{ id: 2 }],
  }), {
    status: 'ready',
    requestedTabIds: [2],
    selectedTabs: [{ id: 2 }],
    unavailableTabIds: [],
  });
});
