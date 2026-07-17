import test from 'node:test';
import assert from 'node:assert/strict';

import {
  closeGuardedTabIdsSequentially,
  closeTabIdsSequentially,
  reviewedTabCloseCandidateMismatch,
  rollbackCreatedTabsOnCheckpointFailure,
  runDestructiveTabClose,
  runGuardedDestructiveTabClose,
  tabCloseGuardFor,
  tabCloseGuardMismatch,
  tabMatchesDestructiveTarget,
} from '../src/shared/tab-close-transaction.js';
import { createPanelWindowBindingController } from '../src/shared/panel-routing.js';

test('closes tabs in order and reports the first real failure without continuing', async () => {
  const calls = [];
  const failure = new Error('Chrome refused the second close');
  const result = await closeTabIdsSequentially([1, '2', 3], async (tabId) => {
    calls.push(tabId);
    if (tabId === 2) throw failure;
  });

  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(result.closedTabIds, [1]);
  assert.equal(result.failedTabId, 2);
  assert.strictEqual(result.error, failure);
});

test('treats missing responses as successful closes and returns every id', async () => {
  const result = await closeTabIdsSequentially([4, 5], async (tabId) => (
    tabId === 4 ? { missing: true } : {}
  ));

  assert.deepEqual(result, {
    closedTabIds: [4, 5],
    failedTabId: null,
    error: null,
  });
});

test('revalidates immediately before each close and stops without touching the changed target', async () => {
  const calls = [];
  const changed = new Error('tab changed');
  const result = await closeTabIdsSequentially(
    [1, 2, 3],
    async (tabId) => calls.push(`close:${tabId}`),
    {
      beforeClose: async (tabId, context) => {
        calls.push(`check:${tabId}:${context.closedTabIds.join(',')}`);
        if (tabId === 2) throw changed;
      },
    },
  );

  assert.deepEqual(calls, ['check:1:', 'close:1', 'check:2:1']);
  assert.deepEqual(result.closedTabIds, [1]);
  assert.equal(result.failedTabId, 2);
  assert.strictEqual(result.error, changed);
});

test('guarded batches skip changed targets at both guard layers and continue closing safe tabs', async () => {
  const calls = [];
  const result = await closeGuardedTabIdsSequentially(
    [1, 2, 3, 4],
    async (tabId, context) => {
      calls.push(`inspect:${tabId}:${context.closedTabIds.join(',')}:${context.skippedTabs.map((entry) => entry.tabId).join(',')}`);
      return tabId === 2 ? 'pinned' : '';
    },
    async (tabId) => {
      calls.push(`close:${tabId}`);
      return tabId === 3 ? { skipped: true, reason: 'moved-group' } : {};
    },
  );

  assert.deepEqual(calls, [
    'inspect:1::',
    'close:1',
    'inspect:2:1:',
    'inspect:3:1:2',
    'close:3',
    'inspect:4:1:2,3',
    'close:4',
  ]);
  assert.deepEqual(result, {
    closedTabIds: [1, 4],
    skippedTabs: [
      { tabId: 2, reason: 'pinned' },
      { tabId: 3, reason: 'moved-group' },
    ],
    failedTabId: null,
    error: null,
  });
});

test('guarded batches default late skip reasons and stop only on real inspect or close failures', async () => {
  const lateSkip = await closeGuardedTabIdsSequentially(
    [5],
    async () => '',
    async () => ({ skipped: true }),
  );
  assert.deepEqual(lateSkip.skippedTabs, [{ tabId: 5, reason: 'changed' }]);

  const inspectFailure = new Error('inventory unavailable');
  const inspected = await closeGuardedTabIdsSequentially(
    [6, 7],
    async (tabId) => {
      if (tabId === 7) throw inspectFailure;
      return '';
    },
    async () => ({}),
  );
  assert.deepEqual(inspected.closedTabIds, [6]);
  assert.equal(inspected.failedTabId, 7);
  assert.strictEqual(inspected.error, inspectFailure);

  const closeFailure = new Error('Chrome unavailable');
  const closed = await closeGuardedTabIdsSequentially(
    [8],
    async () => '',
    async () => { throw closeFailure; },
  );
  assert.deepEqual(closed.skippedTabs, []);
  assert.equal(closed.failedTabId, 8);
  assert.strictEqual(closed.error, closeFailure);
});

test('a changed later candidate aborts the transaction before the first tab is closed', async () => {
  const calls = [];
  const reviewedTabIds = [1, 2, 3];
  const currentIdentity = new Map([[1, 'reviewed-1'], [2, 'replacement-2'], [3, 'reviewed-3']]);

  await assert.rejects(() => runDestructiveTabClose({
    tabIds: reviewedTabIds,
    checkpoint: async () => calls.push('checkpoint'),
    beforeClose: async (_tabId, { closedTabIds }) => {
      const closed = new Set(closedTabIds);
      for (const candidateId of reviewedTabIds.filter((id) => !closed.has(id))) {
        if (currentIdentity.get(candidateId) !== `reviewed-${candidateId}`) {
          throw new Error('reviewed deletion set changed');
        }
      }
    },
    closeTab: async (tabId) => calls.push(`close:${tabId}`),
    commit: async () => calls.push('commit'),
    reconcile: async ({ closedTabIds }) => calls.push(`reconcile:${closedTabIds.join(',')}`),
  }), /reviewed deletion set changed/);

  assert.deepEqual(calls, ['checkpoint', 'reconcile:']);
});

test('physical close guards reject replacement, pin, move, and navigation races', () => {
  const tab = {
    id: 8,
    pinned: false,
    windowId: 2,
    groupId: -1,
    url: 'https://safe.test/',
  };
  const guard = {
    tabId: 8,
    requireUnpinned: true,
    windowId: 2,
    groupId: -1,
    url: 'https://safe.test/',
  };

  assert.equal(tabCloseGuardMismatch(tab, guard), '');
  assert.equal(tabCloseGuardMismatch(), 'missing-or-replaced');
  assert.equal(tabCloseGuardMismatch({ ...tab, id: 9 }, guard), 'missing-or-replaced');
  assert.equal(tabCloseGuardMismatch({ ...tab, pinned: true }, guard), 'pinned');
  assert.equal(tabCloseGuardMismatch({ ...tab, windowId: 3 }, guard), 'moved-window');
  assert.equal(tabCloseGuardMismatch({ ...tab, groupId: 4 }, guard), 'moved-group');
  assert.equal(tabCloseGuardMismatch({
    ...tab,
    pendingUrl: 'https://navigating.test/',
  }, guard), 'navigated');
  assert.equal(tabCloseGuardMismatch(tab, {
    tabId: 8,
    windowId: 'invalid',
    groupId: -2,
  }), '');
  assert.equal(tabCloseGuardMismatch({ id: 8 }, { tabId: 8, url: '' }), '');
  assert.equal(tabCloseGuardMismatch(tab, { tabId: -1 }), 'missing-or-replaced');
  assert.deepEqual(tabCloseGuardFor({
    ...tab,
    pendingUrl: 'https://pending.test/',
  }), {
    tabId: 8,
    requireUnpinned: true,
    windowId: 2,
    groupId: -1,
    url: 'https://pending.test/',
  });
  assert.deepEqual(tabCloseGuardFor(), {
    tabId: undefined,
    requireUnpinned: true,
    windowId: undefined,
    groupId: undefined,
    url: '',
  });
});

test('reviewed close candidates reject pin, placement, navigation, replacement, and ownership races', () => {
  const expectedTab = {
    id: 10,
    pinned: false,
    windowId: 1,
    groupId: 7,
    url: 'https://reviewed.test/',
    snapshotTabId: 'tab-stable',
    sessionId: 'session-1',
  };
  const state = {
    groupSpaces: { 7: 'work', 8: 'other' },
    tabSpaces: { 10: 'work' },
    tabGroups: {},
    tabLifecycle: {
      10: { snapshotTabId: 'tab-stable', sessionId: 'session-1' },
    },
  };
  const mismatch = (tab, overrides = {}) => reviewedTabCloseCandidateMismatch({
    expectedTab,
    currentTabs: tab === undefined ? [] : [tab],
    state,
    targetSpaceId: 'work',
    targetGroupKey: 'group:7',
    ...overrides,
  });

  assert.equal(reviewedTabCloseCandidateMismatch(), 'missing-or-replaced');
  assert.equal(reviewedTabCloseCandidateMismatch({ expectedTab, currentTabs: null }), 'missing-or-replaced');
  assert.equal(mismatch(undefined), 'missing-or-replaced');
  assert.equal(mismatch(expectedTab, { currentTabs: [expectedTab, expectedTab] }), 'missing-or-replaced');
  assert.equal(mismatch({ ...expectedTab, pinned: true }), 'pinned');
  assert.equal(mismatch({ ...expectedTab, windowId: 2 }), 'moved-window');
  assert.equal(mismatch({ ...expectedTab, groupId: 8 }), 'moved-group');
  assert.equal(mismatch({ ...expectedTab, url: 'https://changed.test/' }), 'navigated');
  assert.equal(mismatch(expectedTab), '');
  assert.equal(mismatch(expectedTab, {
    expectedTab: { ...expectedTab, snapshotTabId: '', sessionId: 'session-1' },
  }), '');
  assert.equal(mismatch(expectedTab, {
    expectedTab: { ...expectedTab, snapshotTabId: '', sessionId: 'session-1' },
    state: { ...state, tabLifecycle: {} },
  }), 'stable-identity-changed');
  assert.equal(mismatch(expectedTab, {
    state: { ...state, tabLifecycle: {} },
  }), 'stable-identity-changed');
  assert.equal(mismatch(expectedTab, {
    expectedTab: { ...expectedTab, snapshotTabId: '' },
    state: {
      ...state,
      tabLifecycle: { 10: { snapshotTabId: '', sessionId: 'other-session' } },
    },
  }), 'stable-identity-changed');
  assert.equal(mismatch(expectedTab, {
    expectedTab: { ...expectedTab, snapshotTabId: '', sessionId: '' },
    state: { ...state, groupSpaces: { 7: 'other' } },
  }), 'moved-space-or-group');
  assert.equal(reviewedTabCloseCandidateMismatch({
    expectedTab: { ...expectedTab, snapshotTabId: '', sessionId: '' },
    currentTabs: [expectedTab],
    state,
    targetGroupKey: 'group:8',
  }), 'moved-group');
});

test('destructive target matching distinguishes physical, virtual, ungrouped, and moved Space membership', () => {
  const state = {
    groupSpaces: { 7: 'work' },
    tabSpaces: { 11: 'work', 12: 'work', 13: 'other' },
    tabGroups: { 11: 'vgroup:docs' },
  };
  assert.equal(tabMatchesDestructiveTarget({ id: 10, groupId: 7 }, state, 'work', 'group:7'), true);
  assert.equal(tabMatchesDestructiveTarget({ id: 10, groupId: 7 }, state, 'work'), true);
  assert.equal(tabMatchesDestructiveTarget({ id: 10, groupId: 7 }, state, 'other', 'group:7'), false);
  assert.equal(tabMatchesDestructiveTarget({ id: 10, groupId: 7 }, state, 'work', 'group:8'), false);
  assert.equal(tabMatchesDestructiveTarget({ id: 10, groupId: 7 }, state, 'work', 'group:-1'), false);
  assert.equal(tabMatchesDestructiveTarget({ id: 10, groupId: 7 }, state, 'work', 'vgroup:docs'), false);
  assert.equal(tabMatchesDestructiveTarget({ id: 11, groupId: -1 }, state, 'work', 'vgroup:docs'), true);
  assert.equal(tabMatchesDestructiveTarget({ id: 11, groupId: -1 }, state, 'work', 'ungrouped'), false);
  assert.equal(tabMatchesDestructiveTarget({ id: 12, groupId: -1 }, state, 'work', 'ungrouped'), true);
  assert.equal(tabMatchesDestructiveTarget({ id: 12, groupId: -1 }, state, 'work', 'group:not-a-number'), false);
  assert.equal(tabMatchesDestructiveTarget({ id: 13, groupId: -1 }, state, 'work', 'ungrouped'), false);
  assert.equal(tabMatchesDestructiveTarget({ id: 'invalid', groupId: -1 }, state, 'work', 'ungrouped'), false);
  assert.equal(tabMatchesDestructiveTarget({ id: 12, groupId: 'invalid' }, state, 'work', 'ungrouped'), false);
  assert.equal(tabMatchesDestructiveTarget({ id: 12, groupId: -1 }, {
    ...state,
    tabGroups: [],
  }, 'work', 'ungrouped'), true);
  assert.equal(tabMatchesDestructiveTarget({ id: 14, groupId: 7 }, {
    ...state,
    groupSpaces: [],
  }), true);
  assert.equal(tabMatchesDestructiveTarget({ id: 15, groupId: -1 }, {
    ...state,
    tabSpaces: [],
  }), true);
  assert.equal(tabMatchesDestructiveTarget({ id: 12, groupId: -1 }, state, 'work', {
    toString: () => '',
  }), true);
  assert.equal(tabMatchesDestructiveTarget({ id: 12, groupId: -1 }, {
    ...state,
    tabGroups: {},
  }, 'work', 'vgroup:missing'), false);
});

test('a successful creation checkpoint keeps every created tab open', async () => {
  const closes = [];
  const result = await rollbackCreatedTabsOnCheckpointFailure(
    [4, 5],
    async () => 'committed',
    async (tabId) => closes.push(tabId),
  );

  assert.equal(result, 'committed');
  assert.deepEqual(closes, []);
});

test('a rejected creation checkpoint closes unique valid ids in reverse order', async () => {
  const failure = new Error('storage rejected');
  const closes = [];
  await assert.rejects(() => rollbackCreatedTabsOnCheckpointFailure(
    [4, '5', 4, 'invalid', 6.5],
    async () => { throw failure; },
    async (tabId) => closes.push(tabId),
  ), (error) => error === failure);

  assert.deepEqual(closes, [5, 4]);
});

test('a create response that resumes after the Workbench moves is still compensated', async () => {
  const response = deferred();
  const controller = createPanelWindowBindingController({ hostTabId: 41, windowId: 7 });
  const binding = controller.current();
  const createdTabIds = [];
  const closes = [];
  const operation = rollbackCreatedTabsOnCheckpointFailure(
    createdTabIds,
    async () => {
      const created = await response.promise;
      const tabId = Number(created.tab?.id);
      if (Number.isSafeInteger(tabId)) createdTabIds.push(tabId);
      if (!controller.isCurrent(binding)) {
        throw new Error('Workbench moved while tabs:create was pending');
      }
    },
    async (tabId) => closes.push(tabId),
  );

  controller.handleAttached(41, { newWindowId: 8 });
  response.resolve({ tab: { id: 73, windowId: 7 } });
  await assert.rejects(operation, /Workbench moved/);
  assert.deepEqual(closes, [73], 'the tab physically created in the old window is closed');
});

test('creation checkpoint cleanup reports every close failure without hiding the cause', async () => {
  const failure = new Error('storage rejected');
  const cleanupFailure = new Error('Chrome refused cleanup');
  await assert.rejects(() => rollbackCreatedTabsOnCheckpointFailure(
    [7, 8],
    async () => { throw failure; },
    async (tabId) => {
      if (tabId === 8) throw cleanupFailure;
    },
  ), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.strictEqual(error.cause, failure);
    assert.deepEqual(error.errors, [failure, cleanupFailure]);
    assert.match(error.message, /storage rejected.*could not close every created tab/i);
    return true;
  });
});

test('creation cleanup keeps non-Error checkpoint failures intelligible', async () => {
  await assert.rejects(() => rollbackCreatedTabsOnCheckpointFailure(
    [9],
    async () => { throw 'storage unavailable'; },
    async () => { throw new Error('close unavailable'); },
  ), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, 'storage unavailable');
    assert.match(error.message, /^storage unavailable/);
    return true;
  });
});

test('never closes a tab when the durable checkpoint fails', async () => {
  const calls = [];
  await assert.rejects(() => runDestructiveTabClose({
    tabIds: [1, 2],
    checkpoint: async () => {
      calls.push('checkpoint');
      throw new Error('storage unavailable');
    },
    closeTab: async (tabId) => calls.push(`close:${tabId}`),
    commit: async () => calls.push('commit'),
    reconcile: async () => calls.push('reconcile'),
  }), /storage unavailable/);
  assert.deepEqual(calls, ['checkpoint']);
});

test('resolves a fresh close list only after the durable checkpoint succeeds', async () => {
  const calls = [];
  let currentTabIds = [1];
  const closed = await runDestructiveTabClose({
    tabIds: async () => {
      calls.push('resolve');
      return currentTabIds;
    },
    checkpoint: async () => {
      calls.push('checkpoint');
      currentTabIds = [2, 3];
    },
    closeTab: async (tabId) => calls.push(`close:${tabId}`),
    commit: async (closedTabIds) => calls.push(`commit:${closedTabIds.join(',')}`),
    reconcile: async () => calls.push('reconcile'),
  });

  assert.deepEqual(closed, [2, 3]);
  assert.deepEqual(calls, ['checkpoint', 'resolve', 'close:2', 'close:3', 'commit:2,3']);
});

test('guarded destructive transactions commit the exact closed and skipped outcome', async () => {
  const calls = [];
  let targets = [20];
  const result = await runGuardedDestructiveTabClose({
    tabIds: async () => {
      calls.push('resolve');
      return targets;
    },
    checkpoint: async () => {
      calls.push('checkpoint');
      targets = [21, 22, 23];
    },
    inspectTab: async (tabId) => (tabId === 22 ? 'pinned' : ''),
    closeTab: async (tabId) => {
      calls.push(`close:${tabId}`);
      return tabId === 23 ? { skipped: true, reason: 'navigated' } : {};
    },
    commit: async (outcome) => calls.push(`commit:${JSON.stringify(outcome)}`),
    reconcile: async () => calls.push('reconcile'),
  });

  assert.deepEqual(result.closedTabIds, [21]);
  assert.deepEqual(result.skippedTabs, [
    { tabId: 22, reason: 'pinned' },
    { tabId: 23, reason: 'navigated' },
  ]);
  assert.deepEqual(calls, [
    'checkpoint',
    'resolve',
    'close:21',
    'close:23',
    'commit:{"closedTabIds":[21],"skippedTabs":[{"tabId":22,"reason":"pinned"},{"tabId":23,"reason":"navigated"}]}',
  ]);
});

test('sidepanel-style guarded batches preserve changed metadata while committing safe closes', async () => {
  const reviewedTabs = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    pinned: false,
    windowId: 1,
    groupId: -1,
    url: `https://reviewed.test/${index + 1}`,
  }));
  const browserTabs = new Map(reviewedTabs.map((tab) => [tab.id, { ...tab }]));
  const state = {
    groupSpaces: { 9: 'other' },
    tabSpaces: Object.fromEntries(reviewedTabs.map((tab) => [tab.id, 'work'])),
    tabGroups: {},
    tabLifecycle: {},
    renamedTabs: Object.fromEntries(reviewedTabs.map((tab) => [tab.id, `Row ${tab.id}`])),
  };
  const result = await runGuardedDestructiveTabClose({
    tabIds: reviewedTabs.map((tab) => tab.id),
    checkpoint: async () => {},
    inspectTab: async (tabId) => reviewedTabCloseCandidateMismatch({
      expectedTab: reviewedTabs.find((tab) => tab.id === tabId),
      currentTabs: [...browserTabs.values()],
      state,
      targetSpaceId: 'work',
      targetGroupKey: 'ungrouped',
    }),
    closeTab: async (tabId) => {
      browserTabs.delete(tabId);
      if (tabId === 1) {
        browserTabs.get(2).pinned = true;
        browserTabs.get(3).groupId = 9;
        browserTabs.get(4).windowId = 2;
        browserTabs.get(5).url = 'https://navigated.test/';
        browserTabs.delete(6);
        state.tabSpaces[8] = 'other';
      }
      return {};
    },
    commit: async ({ closedTabIds }) => {
      const liveIds = new Set(browserTabs.keys());
      for (const tabId of closedTabIds) {
        delete state.tabSpaces[tabId];
        delete state.renamedTabs[tabId];
      }
      for (const tabId of Object.keys(state.renamedTabs).map(Number)) {
        if (!liveIds.has(tabId)) {
          delete state.tabSpaces[tabId];
          delete state.renamedTabs[tabId];
        }
      }
    },
    reconcile: async () => assert.fail('protected changes are skips, not failures'),
  });

  assert.deepEqual(result.closedTabIds, [1, 7]);
  assert.deepEqual(result.skippedTabs, [
    { tabId: 2, reason: 'pinned' },
    { tabId: 3, reason: 'moved-group' },
    { tabId: 4, reason: 'moved-window' },
    { tabId: 5, reason: 'navigated' },
    { tabId: 6, reason: 'missing-or-replaced' },
    { tabId: 8, reason: 'moved-space-or-group' },
  ]);
  assert.deepEqual([...browserTabs.keys()].sort((left, right) => left - right), [2, 3, 4, 5, 8]);
  assert.deepEqual(Object.keys(state.renamedTabs).map(Number).sort((left, right) => left - right), [2, 3, 4, 5, 8]);
  assert.equal(state.tabSpaces[8], 'other');
});

test('guarded destructive transactions reconcile real close and final commit failures', async () => {
  const closeFailure = new Error('Chrome unavailable');
  const closeCalls = [];
  await assert.rejects(() => runGuardedDestructiveTabClose({
    tabIds: [30, 31],
    checkpoint: async () => closeCalls.push('checkpoint'),
    inspectTab: async () => '',
    closeTab: async (tabId) => {
      closeCalls.push(`close:${tabId}`);
      if (tabId === 31) throw closeFailure;
      return {};
    },
    commit: async () => closeCalls.push('commit'),
    reconcile: async (outcome) => closeCalls.push(`reconcile:${outcome.closedTabIds.join(',')}`),
  }), (error) => error === closeFailure);
  assert.deepEqual(closeCalls, [
    'checkpoint',
    'close:30',
    'close:31',
    'reconcile:30',
  ]);

  const commitFailure = new Error('storage unavailable');
  const commitCalls = [];
  await assert.rejects(() => runGuardedDestructiveTabClose({
    tabIds: [32],
    checkpoint: async () => commitCalls.push('checkpoint'),
    inspectTab: async () => '',
    closeTab: async () => ({}),
    commit: async () => { throw commitFailure; },
    reconcile: async (outcome) => {
      commitCalls.push(`reconcile:${outcome.closedTabIds.join(',')}`);
      throw new Error('refresh also failed');
    },
  }), (error) => error === commitFailure);
  assert.deepEqual(commitCalls, ['checkpoint', 'reconcile:32']);
});

test('guarded destructive transactions never inspect when the checkpoint fails', async () => {
  const calls = [];
  await assert.rejects(() => runGuardedDestructiveTabClose({
    tabIds: [40],
    checkpoint: async () => {
      calls.push('checkpoint');
      throw new Error('checkpoint failed');
    },
    inspectTab: async () => calls.push('inspect'),
    closeTab: async () => calls.push('close'),
    commit: async () => calls.push('commit'),
    reconcile: async () => calls.push('reconcile'),
  }), /checkpoint failed/);
  assert.deepEqual(calls, ['checkpoint']);
});

test('reconciles a partial close and never commits the destructive mutation', async () => {
  const calls = [];
  const failure = new Error('second close failed');
  await assert.rejects(() => runDestructiveTabClose({
    tabIds: [1, 2, 3],
    checkpoint: async () => calls.push('checkpoint'),
    closeTab: async (tabId) => {
      calls.push(`close:${tabId}`);
      if (tabId === 2) throw failure;
    },
    commit: async () => calls.push('commit'),
    reconcile: async (result) => calls.push(`reconcile:${result.closedTabIds.join(',')}:${result.failedTabId}`),
  }), (error) => error === failure);
  assert.deepEqual(calls, [
    'checkpoint',
    'close:1',
    'close:2',
    'reconcile:1:2',
  ]);
});

test('keeps the original close error when immediate reconciliation also fails', async () => {
  const failure = new Error('close failed');
  await assert.rejects(() => runDestructiveTabClose({
    tabIds: [1],
    checkpoint: async () => {},
    closeTab: async () => { throw failure; },
    commit: async () => {},
    reconcile: async () => { throw new Error('refresh failed'); },
  }), (error) => error === failure);
});

test('commits only after every close and reconciles a failed final commit', async () => {
  const calls = [];
  const commitFailure = new Error('commit failed');
  await assert.rejects(() => runDestructiveTabClose({
    tabIds: [7, 8],
    checkpoint: async () => calls.push('checkpoint'),
    closeTab: async (tabId) => calls.push(`close:${tabId}`),
    commit: async (closedTabIds) => {
      calls.push(`commit:${closedTabIds.join(',')}`);
      throw commitFailure;
    },
    reconcile: async (result) => calls.push(`reconcile:${result.closedTabIds.join(',')}:${result.failedTabId}`),
  }), (error) => error === commitFailure);
  assert.deepEqual(calls, [
    'checkpoint',
    'close:7',
    'close:8',
    'commit:7,8',
    'reconcile:7,8:null',
  ]);

  const successful = [];
  const closed = await runDestructiveTabClose({
    tabIds: [9],
    checkpoint: async () => successful.push('checkpoint'),
    closeTab: async (tabId) => successful.push(`close:${tabId}`),
    commit: async (closedTabIds) => successful.push(`commit:${closedTabIds.join(',')}`),
    reconcile: async () => successful.push('reconcile'),
  });
  assert.deepEqual(closed, [9]);
  assert.deepEqual(successful, ['checkpoint', 'close:9', 'commit:9']);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
