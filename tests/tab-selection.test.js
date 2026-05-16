import test from 'node:test';
import assert from 'node:assert/strict';

import {
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

test('context menu preserves a multi-selection only when right-clicking inside it', () => {
  assert.deepEqual(selectionForContextMenu({ selectedTabIds: [10, 20], clickedTabId: 20 }), [10, 20]);
  assert.deepEqual(selectionForContextMenu({ selectedTabIds: [10, 20], clickedTabId: 30 }), [30]);
});
