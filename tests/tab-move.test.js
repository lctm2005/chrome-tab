import assert from 'node:assert/strict';
import test from 'node:test';

import {
  moveIndexAfterTabs,
  moveIndexBeforeTab,
  planMixedTabDropOrder,
  planTabDropOrder,
  tabOrderAfterDuplicate,
} from '../src/shared/tab-move.js';

function live(id, title = `Live ${id}`) {
  return { id, title, url: `https://live-${id}.test`, dormant: false };
}

function dormant(id, snapshotTabId = `saved-${id}`) {
  return {
    id: `snapshot:group:${id}`,
    snapshotTabId,
    title: `Saved ${id}`,
    url: `https://saved-${id}.test`,
    dormant: true,
  };
}

test('moving before a later tab compensates for removal from the old index', () => {
  assert.equal(moveIndexBeforeTab(1, 4), 3);
  assert.equal(moveIndexBeforeTab(4, 1), 1);
  assert.equal(moveIndexBeforeTab(3, 3), 3);
});

test('moving to a Tag tail stays after the last peer in either direction', () => {
  assert.equal(moveIndexAfterTabs(1, [4, 5]), 5);
  assert.equal(moveIndexAfterTabs(7, [4, 5]), 6);
  assert.equal(moveIndexAfterTabs(5, [4, 5, 5]), 5);
  assert.equal(moveIndexAfterTabs(3, []), 3);
  assert.equal(moveIndexAfterTabs(3, null), 3);
});

test('invalid Chrome indexes do not produce a destructive move', () => {
  for (const value of [-1, 1.5, 'bad', null, undefined]) {
    assert.equal(moveIndexBeforeTab(value, 2), null);
    assert.equal(moveIndexBeforeTab(2, value), null);
    assert.equal(moveIndexAfterTabs(value, [2]), null);
  }
  assert.equal(moveIndexAfterTabs(2, [-1, 1.5, 'bad']), 2);
});

test('a null row anchor means group tail and never coerces to tab id zero', () => {
  assert.deepEqual(planTabDropOrder({
    tabId: 30,
    targetTabIds: [30, 20, 10],
    beforeTabId: null,
  }), {
    status: 'move',
    order: [20, 10, 30],
    anchorTabId: 10,
    edge: 'after',
  });
  assert.deepEqual(planTabDropOrder({
    tabId: 30,
    targetTabIds: [20, 10, 30],
  }), {
    status: 'noop',
    order: [20, 10, 30],
    anchorTabId: 10,
    edge: 'after',
  });
});

test('row drops produce exact before order and recognize harmless no-ops', () => {
  assert.deepEqual(planTabDropOrder({
    tabId: 10,
    targetTabIds: [10, 20, 30],
    beforeTabId: 30,
  }), {
    status: 'move',
    order: [20, 10, 30],
    anchorTabId: 30,
    edge: 'before',
  });
  assert.deepEqual(planTabDropOrder({
    tabId: 20,
    targetTabIds: [10, 20, 30],
    beforeTabId: 30,
  }), {
    status: 'noop',
    order: [10, 20, 30],
    anchorTabId: 30,
    edge: 'before',
  });
  assert.deepEqual(planTabDropOrder({
    tabId: 20,
    targetTabIds: [10, 20, 30],
    beforeTabId: 20,
  }), {
    status: 'noop',
    order: [10, 20, 30],
    anchorTabId: 20,
    edge: 'before',
  });
});

test('cross-group tails, stale anchors, and invalid identities are explicit', () => {
  assert.deepEqual(planTabDropOrder({
    tabId: 40,
    targetTabIds: [10, 20, 20, 'bad'],
  }), {
    status: 'move',
    order: [10, 20, 40],
    anchorTabId: 20,
    edge: 'after',
  });
  assert.deepEqual(planTabDropOrder({
    tabId: 40,
    targetTabIds: [],
  }), {
    status: 'move',
    order: [40],
    anchorTabId: null,
    edge: 'after',
  });
  assert.deepEqual(planTabDropOrder({
    tabId: 40,
    targetTabIds: [10, 20],
    beforeTabId: 99,
  }), {
    status: 'stale',
    order: [10, 20],
    anchorTabId: 99,
    edge: 'before',
  });
  assert.deepEqual(planTabDropOrder({ tabId: 'bad' }), {
    status: 'invalid', order: [], anchorTabId: null, edge: null,
  });
  assert.deepEqual(planTabDropOrder({ tabId: 40, beforeTabId: 'bad' }), {
    status: 'invalid', order: [], anchorTabId: null, edge: null,
  });
  assert.deepEqual(planTabDropOrder(), {
    status: 'invalid', order: [], anchorTabId: null, edge: null,
  });
  assert.deepEqual(planTabDropOrder({
    tabId: 40,
    targetTabIds: null,
  }).order, [40]);
});

test('a duplicate is placed immediately after its source in the visible order', () => {
  assert.deepEqual(tabOrderAfterDuplicate([10, 20, 30], 20, 40), [10, 20, 40, 30]);
  assert.deepEqual(tabOrderAfterDuplicate([10, 20, 20, 40, 30], 20, 40), [10, 20, 40, 30]);
  assert.deepEqual(tabOrderAfterDuplicate(null, 20, 40), [20, 40]);
});

test('a source missing from stale saved order remains ahead of its duplicate', () => {
  assert.deepEqual(tabOrderAfterDuplicate([10, 30], 20, 40), [10, 30, 20, 40]);
});

test('invalid or identical duplicate identities leave a sanitized visible order', () => {
  const expected = [0, 10];
  for (const value of [null, undefined, '', -1, 1.5, 'bad']) {
    assert.deepEqual(tabOrderAfterDuplicate([0, 10, 10, -1, 'bad'], value, 20), expected);
    assert.deepEqual(tabOrderAfterDuplicate([0, 10, 10, -1, 'bad'], 10, value), expected);
  }
  assert.deepEqual(tabOrderAfterDuplicate([0, 10, 10], 10, 10), expected);
});

test('mixed row drops persist the visible order while anchoring Chrome to the nearest live peer', () => {
  const a = live(10);
  const saved = dormant('middle');
  const c = live(30);
  const plan = planMixedTabDropOrder({
    tab: c,
    targetTabs: [a, saved, c],
    beforeTab: saved,
  });

  assert.deepEqual(plan, {
    status: 'move',
    visibleTabs: [a, c, saved],
    order: [10, 30],
    anchorTabId: 10,
    edge: 'after',
  });
});

test('a dormant before-row can use the following live tab when it is the closest Chrome anchor', () => {
  const source = live(30);
  const saved = dormant('first');
  const following = live(40);
  assert.deepEqual(planMixedTabDropOrder({
    tab: source,
    targetTabs: [saved, following, source],
    beforeTab: saved,
  }), {
    status: 'move',
    visibleTabs: [source, saved, following],
    order: [30, 40],
    anchorTabId: 40,
    edge: 'before',
  });
});

test('cross-group mixed drops preserve before, tail, and saved-only target semantics', () => {
  const source = live(50);
  const first = dormant('first');
  const peer = live(60);

  assert.deepEqual(planMixedTabDropOrder({
    tab: source,
    targetTabs: [first, peer],
    beforeTab: first,
  }), {
    status: 'move',
    visibleTabs: [source, first, peer],
    order: [50, 60],
    anchorTabId: 60,
    edge: 'before',
  });
  assert.deepEqual(planMixedTabDropOrder({
    tab: source,
    targetTabs: [peer, first],
  }), {
    status: 'move',
    visibleTabs: [peer, first, source],
    order: [60, 50],
    anchorTabId: 60,
    edge: 'after',
  });
  assert.deepEqual(planMixedTabDropOrder({
    tab: source,
    targetTabs: [first],
  }), {
    status: 'move',
    visibleTabs: [first, source],
    order: [50],
    anchorTabId: null,
    edge: null,
  });
});

test('mixed drops recognize exact no-ops and stale before-row references', () => {
  const a = live(10);
  const saved = dormant('middle');
  const c = live(30);
  const rows = [a, saved, c];

  assert.deepEqual(planMixedTabDropOrder({ tab: a, targetTabs: rows, beforeTab: a }), {
    status: 'noop', visibleTabs: rows, order: [10, 30], anchorTabId: null, edge: null,
  });
  assert.deepEqual(planMixedTabDropOrder({ tab: c, targetTabs: rows }), {
    status: 'noop', visibleTabs: rows, order: [10, 30], anchorTabId: null, edge: null,
  });
  assert.deepEqual(planMixedTabDropOrder({
    tab: live(90),
    targetTabs: rows,
    beforeTab: live(90),
  }), {
    status: 'stale', visibleTabs: rows, order: [10, 30], anchorTabId: null, edge: null,
  });
  assert.deepEqual(planMixedTabDropOrder({ tab: a, targetTabs: rows, beforeTab: dormant('gone') }), {
    status: 'stale', visibleTabs: rows, order: [10, 30], anchorTabId: null, edge: null,
  });
});

test('mixed drop planning rejects ambiguous or malformed visible identities without mutation', () => {
  const source = live(10);
  const legacySaved = dormant('legacy', '');
  const frozenRows = Object.freeze([source, legacySaved]);
  assert.equal(planMixedTabDropOrder({
    tab: source,
    targetTabs: frozenRows,
    beforeTab: legacySaved,
  }).status, 'noop');
  assert.deepEqual(frozenRows, [source, legacySaved]);

  const invalidPlan = { status: 'invalid', visibleTabs: [], order: [], anchorTabId: null, edge: null };
  assert.deepEqual(planMixedTabDropOrder({ tab: source, targetTabs: null }), {
    status: 'move', visibleTabs: [source], order: [10], anchorTabId: null, edge: null,
  });
  for (const input of [
    {},
    { tab: null, targetTabs: [] },
    { tab: '10', targetTabs: [] },
    { tab: live(-1), targetTabs: [] },
    { tab: source, targetTabs: [{}] },
    { tab: source, targetTabs: [source, { ...source }] },
    { tab: source, targetTabs: [source], beforeTab: {} },
    { tab: source, targetTabs: [{ dormant: true }] },
  ]) {
    assert.deepEqual(planMixedTabDropOrder(input), invalidPlan);
  }
});
