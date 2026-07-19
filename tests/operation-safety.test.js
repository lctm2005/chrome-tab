import test from 'node:test';
import assert from 'node:assert/strict';

import {
  commitWindowBoundWrite,
  createRollbackAggregateError,
  createRollbackFailureError,
  fingerprintTidyNameTargets,
  isRollbackIntegrityFailure,
  isOperationUndoVisible,
  runDurableCommitBoundary,
  runAutoGroupUndoRollback,
  withoutOperationRecord,
} from '../src/shared/operation-safety.js';

test('inline retries stop when rollback integrity is uncertain', () => {
  const aggregate = new AggregateError([new Error('restore failed')], 'Storage rollback also failed.');
  const crossRealmAggregate = { name: 'AggregateError', errors: [new Error('restore failed')] };
  const recordedRollback = Object.assign(new Error('Operation rollback was incomplete.'), {
    rollbackFailures: [{ stage: 'restoring storage', error: new Error('restore failed') }],
  });

  assert.equal(isRollbackIntegrityFailure(aggregate), true);
  assert.equal(isRollbackIntegrityFailure(crossRealmAggregate), true);
  assert.equal(isRollbackIntegrityFailure(recordedRollback), true);
  assert.equal(isRollbackIntegrityFailure(Object.assign(new Error('retryable write failure'), {
    rollbackFailures: [],
  })), false);
  assert.equal(isRollbackIntegrityFailure(new Error('retryable write failure')), false);
  assert.equal(isRollbackIntegrityFailure({ name: 'Error', rollbackFailures: 'invalid' }), false);
  assert.equal(isRollbackIntegrityFailure(null), false);
  assert.equal(isRollbackIntegrityFailure('storage failed'), false);
});

test('window-bound writes distinguish stale-before-write from stale-after-commit', async () => {
  let current = false;
  let writes = 0;
  const staleBeforeWrite = await commitWindowBoundWrite({
    isCurrent: () => current,
    write: async () => { writes += 1; },
  });

  assert.equal(staleBeforeWrite, false);
  assert.equal(writes, 0);

  current = true;
  const committedBeforeBindingChanged = await commitWindowBoundWrite({
    isCurrent: () => current,
    write: async () => {
      writes += 1;
      current = false;
    },
  });

  assert.equal(committedBeforeBindingChanged, true);
  assert.equal(current, false);
  assert.equal(writes, 1);

  const storageFailure = new Error('storage rejected the write');
  current = true;
  await assert.rejects(() => commitWindowBoundWrite({
    isCurrent: () => current,
    write: async () => {
      writes += 1;
      throw storageFailure;
    },
  }), (error) => error === storageFailure);
  assert.equal(writes, 2);
});

test('Operation history removal is immutable and removes every matching record', () => {
  const history = [
    { id: 'keep-before', summary: 'Before' },
    { id: 'remove', summary: 'First duplicate' },
    null,
    { id: 'remove', summary: 'Second duplicate' },
    { id: 'keep-after', summary: 'After' },
  ];
  const before = structuredClone(history);

  const remaining = withoutOperationRecord(history, 'remove');

  assert.deepEqual(remaining, [history[0], null, history[4]]);
  assert.notStrictEqual(remaining, history);
  assert.deepEqual(history, before);
});

test('Operation history removal is stable for missing ids and malformed history', () => {
  const history = [{ id: 'keep' }];
  const withoutId = withoutOperationRecord(history, '');

  assert.deepEqual(withoutId, history);
  assert.notStrictEqual(withoutId, history);
  assert.deepEqual(withoutOperationRecord(history), history);
  assert.deepEqual(withoutOperationRecord(null, 'remove'), []);
  assert.deepEqual(withoutOperationRecord({ 0: history[0] }, 'remove'), []);
});

test('Rollback failure errors retain the original cause and ordered failure records', () => {
  const originalError = new Error('Saving the workspace failed');
  const firstRollbackError = new Error('Chrome refused the move');
  const failures = [
    { stage: 'restoring Chrome tabs', error: firstRollbackError },
    { stage: 'saving restored state', error: 'storage is read-only' },
  ];
  const before = [...failures];

  const error = createRollbackFailureError(originalError, failures);

  assert.equal(error.message,
    'Saving the workspace failed. Rollback was incomplete '
    + '(restoring Chrome tabs: Chrome refused the move; saving restored state: storage is read-only).');
  assert.strictEqual(error.cause, originalError);
  assert.strictEqual(error.rollbackFailures, failures);
  assert.deepEqual(error.rollbackFailures, before);
  assert.strictEqual(error.rollbackFailures[0].error, firstRollbackError);
  assert.deepEqual(failures, before);
});

test('Rollback failure errors keep punctuation and make empty or invalid values readable', () => {
  const punctuated = createRollbackFailureError(new Error('Apply failed!'), [
    { stage: '', error: new Error('') },
    null,
  ]);
  const nullCause = createRollbackFailureError(null, null);
  const stringCause = createRollbackFailureError('  Request\nfailed  ', []);

  assert.equal(punctuated.message,
    'Apply failed! Rollback was incomplete '
    + '(rollback step 1: unknown error; rollback step 2: unknown error).');
  assert.equal(nullCause.message,
    'Operation failed. Rollback was incomplete (rollback failure details were unavailable).');
  assert.strictEqual(nullCause.cause, null);
  assert.deepEqual(nullCause.rollbackFailures, []);
  assert.equal(stringCause.message,
    'Request failed. Rollback was incomplete (rollback failure details were unavailable).');
  assert.equal(stringCause.cause, '  Request\nfailed  ');
});

test('Rollback aggregate errors preserve cause and every underlying error in order', () => {
  const originalError = new Error('Original mutation failure');
  const firstRollbackError = new Error('First rollback failure');
  const emptyMessageError = new Error('');
  const failures = [
    { stage: 'first stage', error: firstRollbackError },
    { stage: 'second stage', error: 'second rollback failure' },
    { stage: null, error: null },
    { stage: 'last stage', error: emptyMessageError },
  ];
  const options = { cause: originalError };
  const before = [...failures];

  const error = createRollbackAggregateError('Chrome grouping', failures, options);

  assert.ok(error instanceof AggregateError);
  assert.equal(error.message,
    'Chrome grouping rollback was incomplete '
    + '(first stage: First rollback failure; second stage: second rollback failure; '
    + 'rollback step 3: unknown error; last stage: unknown error).');
  assert.strictEqual(error.cause, originalError);
  assert.strictEqual(error.rollbackFailures, failures);
  assert.deepEqual(error.rollbackFailures, before);
  assert.deepEqual(error.errors, [
    firstRollbackError,
    'second rollback failure',
    null,
    emptyMessageError,
  ]);
  assert.strictEqual(error.errors[0], firstRollbackError);
  assert.strictEqual(error.errors[3], emptyMessageError);
  assert.deepEqual(options, { cause: originalError });
  assert.deepEqual(failures, before);
});

test('Rollback aggregate errors tolerate empty subjects, failures, and options', () => {
  const errorFailure = new Error('direct failure');
  const error = createRollbackAggregateError(new Error(''), [errorFailure, 'plain failure', null]);
  const empty = createRollbackAggregateError(null, null, null);

  assert.equal(error.message,
    'Operation rollback was incomplete '
    + '(rollback step 1: direct failure; rollback step 2: plain failure; rollback step 3: unknown error).');
  assert.deepEqual(error.errors, [errorFailure, 'plain failure', null]);
  assert.strictEqual(error.errors[0], errorFailure);
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.equal(empty.message,
    'Operation rollback was incomplete (rollback failure details were unavailable).');
  assert.deepEqual(empty.errors, []);
  assert.deepEqual(empty.rollbackFailures, []);
});

test('durable commit boundaries distinguish successful commits from pre-commit failures', async () => {
  const calls = [];
  const result = await runDurableCommitBoundary({
    async mutate() {
      calls.push('mutate');
      return { id: 'committed-value' };
    },
    async commit(value) {
      calls.push(`commit:${value.id}`);
    },
    async rollbackBeforeCommit() {
      calls.push('rollback');
    },
    async afterCommit(value) {
      calls.push(`after:${value.id}`);
    },
    async restoreCommittedMemory() {
      calls.push('restore-committed');
    },
  });

  assert.deepEqual(result, {
    value: { id: 'committed-value' },
    committed: true,
    postCommitError: null,
    recoveryError: null,
  });
  assert.deepEqual(calls, ['mutate', 'commit:committed-value', 'after:committed-value']);

  for (const failingStage of ['mutate', 'commit']) {
    const failure = new Error(`${failingStage} failed`);
    const failureCalls = [];
    await assert.rejects(() => runDurableCommitBoundary({
      async mutate() {
        failureCalls.push('mutate');
        if (failingStage === 'mutate') throw failure;
        return 'candidate';
      },
      async commit() {
        failureCalls.push('commit');
        if (failingStage === 'commit') throw failure;
      },
      async rollbackBeforeCommit(error) {
        failureCalls.push(`rollback:${error.message}`);
      },
      async afterCommit() {
        failureCalls.push('after');
      },
      async restoreCommittedMemory() {
        failureCalls.push('restore-committed');
      },
    }), (error) => error === failure);
    assert.deepEqual(failureCalls, failingStage === 'mutate'
      ? ['mutate', 'rollback:mutate failed']
      : ['mutate', 'commit', 'rollback:commit failed']);
  }
});

test('a false window-bound commit result rolls memory back and never runs post-commit work', async () => {
  const calls = [];

  await assert.rejects(() => runDurableCommitBoundary({
    async mutate() {
      calls.push('mutate');
      return 'candidate';
    },
    async commit() {
      calls.push('commit:false');
      return false;
    },
    async rollbackBeforeCommit(error) {
      calls.push(`rollback:${error.message}`);
    },
    async afterCommit() {
      calls.push('after');
    },
    async restoreCommittedMemory() {
      calls.push('restore-committed');
    },
  }), /The durable commit was not applied\./);

  assert.deepEqual(calls, [
    'mutate',
    'commit:false',
    'rollback:The durable commit was not applied.',
  ]);
});

test('rename-style commit failures restore the synchronized checkpoint without a stale rollback write', async () => {
  const storageFailure = new Error('rename storage write failed');
  const synchronized = {
    spaces: [{ id: 'work', name: 'Reviewed name', icon: 'R', color: 'green' }],
    renamedTabs: { 7: 'Reviewed panel name' },
    pageTitles: { 7: 'New ordinary page title' },
    concurrentMetadata: 'keep the latest unrelated edit',
  };
  let memory = structuredClone(synchronized);
  const beforeRename = structuredClone(memory);
  const durable = {
    spaceName: 'Newer external name',
    tabName: 'Newer external panel name',
  };
  let durableWriteAttempts = 0;

  await assert.rejects(() => runDurableCommitBoundary({
    mutate() {
      memory.spaces[0].name = 'Requested stale Space name';
      memory.spaces[0].icon = 'S';
      memory.renamedTabs[7] = 'Requested stale Tab name';
      return structuredClone(memory);
    },
    commit() {
      durableWriteAttempts += 1;
      throw storageFailure;
    },
    rollbackBeforeCommit() {
      // Production rename rollback follows this same memory-only contract. It
      // must not persist the checkpoint because another writer can already own
      // a newer durable name by the time the failed write reports its error.
      memory = structuredClone(beforeRename);
    },
    afterCommit() {
      assert.fail('a failed rename commit must not refresh as if it succeeded');
    },
    restoreCommittedMemory() {
      assert.fail('a failed rename commit has no committed memory to restore');
    },
  }), (error) => error === storageFailure);

  assert.deepEqual(memory, synchronized);
  assert.equal(memory.pageTitles[7], 'New ordinary page title');
  assert.deepEqual(durable, {
    spaceName: 'Newer external name',
    tabName: 'Newer external panel name',
  });
  assert.equal(durableWriteAttempts, 1);
});

test('post-commit failures are returned as warnings and recover committed memory', async () => {
  const postCommitError = new Error('view refresh failed');
  const calls = [];
  const result = await runDurableCommitBoundary({
    async mutate() {
      calls.push('mutate');
      return { durable: true };
    },
    async commit() {
      calls.push('commit');
    },
    async rollbackBeforeCommit() {
      calls.push('rollback');
    },
    async afterCommit() {
      calls.push('after');
      throw postCommitError;
    },
    async restoreCommittedMemory(value, error) {
      calls.push(`restore:${value.durable}:${error.message}`);
    },
  });

  assert.equal(result.committed, true);
  assert.strictEqual(result.postCommitError, postCommitError);
  assert.equal(result.recoveryError, null);
  assert.deepEqual(calls, ['mutate', 'commit', 'after', 'restore:true:view refresh failed']);

  const recoveryError = new Error('memory recovery failed');
  const unrecovered = await runDurableCommitBoundary({
    async mutate() { return 'saved'; },
    async commit() {},
    async rollbackBeforeCommit() {},
    async afterCommit() { throw postCommitError; },
    async restoreCommittedMemory() { throw recoveryError; },
  });
  assert.strictEqual(unrecovered.postCommitError, postCommitError);
  assert.strictEqual(unrecovered.recoveryError, recoveryError);
});

test('a failed pre-commit memory rollback retains the original failure and rollback cause', async () => {
  const commitError = new Error('storage commit failed');
  const rollbackError = new Error('memory rollback failed');

  await assert.rejects(() => runDurableCommitBoundary({
    async mutate() { return 'candidate'; },
    async commit() { throw commitError; },
    async rollbackBeforeCommit() { throw rollbackError; },
    async afterCommit() {},
    async restoreCommittedMemory() {},
  }), (error) => {
    assert.strictEqual(error.cause, commitError);
    assert.strictEqual(error.rollbackFailures[0].error, rollbackError);
    assert.match(error.message, /restoring in-memory state before the durable commit/);
    return true;
  });
});

function autoRollbackOperations(trace, failures = {}) {
  return {
    restoreMemory: async (rollback) => {
      trace.push(['restoreMemory', rollback]);
      if (failures.restoreMemory) throw failures.restoreMemory;
    },
    restoreLiveOrganization: async (live, spaceId) => {
      trace.push(['restoreLiveOrganization', live, spaceId]);
      if (failures.restoreLiveOrganization) throw failures.restoreLiveOrganization;
    },
    saveState: async () => {
      trace.push(['saveState']);
      if (failures.saveState) throw failures.saveState;
    },
    refreshTabs: async (options) => {
      trace.push(['refreshTabs', options]);
      if (failures.refreshTabs) throw failures.refreshTabs;
    },
    loadTabs: async (options) => {
      trace.push(['loadTabs', options]);
      if (failures.loadTabs) throw failures.loadTabs;
    },
    render: async () => {
      trace.push(['render']);
      if (failures.render) throw failures.render;
    },
  };
}

test('Auto Group Undo rollback restores memory, Chrome, storage, and the refreshed view in order', async () => {
  const trace = [];
  const rollback = { live: { groups: ['before'] }, spaceId: 'work' };

  await runAutoGroupUndoRollback(rollback, autoRollbackOperations(trace));

  assert.deepEqual(trace, [
    ['restoreMemory', rollback],
    ['restoreLiveOrganization', rollback.live, 'work'],
    ['saveState'],
    ['refreshTabs', { reloadDormant: true }],
  ]);
});

test('Auto Group Undo rollback refreshes the truthful fallback when Chrome restoration fails', async () => {
  const trace = [];
  const liveError = new Error('Chrome groups changed');
  const rollback = { live: { groups: [] }, spaceId: 'work' };

  await assert.rejects(
    runAutoGroupUndoRollback(rollback, autoRollbackOperations(trace, {
      restoreLiveOrganization: liveError,
    })),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [liveError]);
      assert.equal(error.rollbackFailures[0].stage, 'restoring the pre-Undo Chrome groups');
      return true;
    },
  );
  assert.deepEqual(trace, [
    ['restoreMemory', rollback],
    ['restoreLiveOrganization', rollback.live, 'work'],
    ['loadTabs', { adopt: false }],
    ['render'],
  ]);
});

test('Auto Group Undo rollback preserves ordered live and fallback refresh failures', async () => {
  const trace = [];
  const liveError = new Error('Chrome groups changed');
  const renderError = new Error('Panel render failed');
  const rollback = { live: null, spaceId: 'work' };

  await assert.rejects(
    runAutoGroupUndoRollback(rollback, autoRollbackOperations(trace, {
      restoreLiveOrganization: liveError,
      render: renderError,
    })),
    (error) => {
      assert.deepEqual(error.errors, [liveError, renderError]);
      assert.deepEqual(error.rollbackFailures.map(({ stage }) => stage), [
        'restoring the pre-Undo Chrome groups',
        'refreshing after the failed Undo rollback',
      ]);
      return true;
    },
  );
  assert.deepEqual(trace.at(-1), ['render']);
});

test('Auto Group Undo rollback still refreshes after a restored-state save failure', async () => {
  const trace = [];
  const saveError = new Error('Storage full');
  const rollback = { live: {}, spaceId: 'work' };

  await assert.rejects(
    runAutoGroupUndoRollback(rollback, autoRollbackOperations(trace, {
      saveState: saveError,
    })),
    (error) => {
      assert.deepEqual(error.errors, [saveError]);
      assert.equal(error.rollbackFailures[0].stage, 'saving the restored pre-Undo state');
      return true;
    },
  );
  assert.deepEqual(trace.slice(-2), [
    ['saveState'],
    ['refreshTabs', { reloadDormant: true }],
  ]);
});

test('Auto Group Undo rollback reports refresh failure separately after a successful save', async () => {
  const trace = [];
  const refreshError = new Error('Panel detached');

  await assert.rejects(
    runAutoGroupUndoRollback(
      { live: {}, spaceId: 'work' },
      autoRollbackOperations(trace, { refreshTabs: refreshError }),
    ),
    (error) => {
      assert.deepEqual(error.errors, [refreshError]);
      assert.equal(error.rollbackFailures[0].stage, 'refreshing the restored pre-Undo view');
      return true;
    },
  );
  assert.deepEqual(trace.slice(-2), [
    ['saveState'],
    ['refreshTabs', { reloadDormant: true }],
  ]);
});

test('Auto Group Undo rollback stops before browser work when memory restoration itself fails', async () => {
  const trace = [];
  const memoryError = new Error('Invalid rollback snapshot');

  await assert.rejects(
    runAutoGroupUndoRollback(
      { live: {}, spaceId: 'work' },
      autoRollbackOperations(trace, { restoreMemory: memoryError }),
    ),
    memoryError,
  );
  assert.deepEqual(trace.map(([stage]) => stage), ['restoreMemory']);
});

test('Undo is visible for ten seconds after an applied operation, then expires', () => {
  const operation = { createdAt: 1_000, status: 'applied' };

  assert.equal(isOperationUndoVisible(operation, 1_000), true);
  assert.equal(isOperationUndoVisible(operation, 10_999), true);
  assert.equal(isOperationUndoVisible(operation, 11_000), false);
  assert.equal(isOperationUndoVisible({ ...operation, status: 'undone' }, 1_001), false);
});

test('Undo visibility rejects invalid timestamps and configurable non-positive windows', () => {
  assert.equal(isOperationUndoVisible(null, 1_000), false);
  assert.equal(isOperationUndoVisible({ createdAt: 0, status: 'applied' }, 1_000), false);
  assert.equal(isOperationUndoVisible({ createdAt: 'not-a-date', status: 'applied' }, 1_000), false);
  assert.equal(isOperationUndoVisible({ createdAt: 1_000, status: 'applied' }, Number.NaN), false);
  assert.equal(isOperationUndoVisible({ createdAt: 2_000, status: 'applied' }, 1_000), false);
  assert.equal(isOperationUndoVisible({ createdAt: 1_000, status: 'applied' }, 1_001, 0), false);
  assert.equal(isOperationUndoVisible({ createdAt: 1_000, status: 'applied' }, 1_001, Number.NaN), false);
  assert.equal(isOperationUndoVisible({ createdAt: 1_000, status: 'applied' }, 1_001, -1), false);
  assert.equal(isOperationUndoVisible({ createdAt: Date.now(), status: 'applied' }), true);
});

test('Tidy target fingerprints include URL, page title, pinned state, and current panel name', () => {
  const tabs = [{
    id: 10,
    url: 'https://example.com/spec',
    title: 'Specification',
    panelTitle: 'Spec',
  }];
  const initial = fingerprintTidyNameTargets(tabs, { 10: 'Spec' });

  assert.match(initial, /^tidy-target-v2-[0-9a-f]{8}-1$/);
  assert.notEqual(fingerprintTidyNameTargets([
    { ...tabs[0], url: 'https://example.com/plan' },
  ], { 10: 'Spec' }), initial);
  assert.notEqual(fingerprintTidyNameTargets([
    { ...tabs[0], title: 'Updated specification' },
  ], { 10: 'Spec' }), initial);
  assert.notEqual(fingerprintTidyNameTargets(tabs, { 10: 'Manual override' }), initial);
  assert.notEqual(fingerprintTidyNameTargets([
    { ...tabs[0], pinned: true },
  ], { 10: 'Spec' }), initial);
});

test('Tidy target fingerprints ignore row order and unrelated names', () => {
  const tabs = [
    { id: 20, url: 'https://example.com/b', title: 'B' },
    { id: 10, url: 'https://example.com/a', title: 'A' },
  ];
  const first = fingerprintTidyNameTargets(tabs, { 10: 'Alpha', 999: 'Unrelated' });
  const second = fingerprintTidyNameTargets([...tabs].reverse(), { 10: 'Alpha' });

  assert.equal(first, second);
});

test('Tidy target fingerprints can retain logical identity across Chrome tab replacement', () => {
  const before = fingerprintTidyNameTargets([{
    id: 10,
    url: 'https://example.com/a',
    title: 'A',
  }], { 10: 'Alpha' });
  const after = fingerprintTidyNameTargets([{
    id: 20,
    url: 'https://example.com/a',
    title: 'A',
  }], { 20: 'Alpha' }, { tabIdAliases: { 20: 10 } });

  assert.equal(after, before);
  assert.notEqual(fingerprintTidyNameTargets([{
    id: 20,
    url: 'https://example.com/a',
    title: 'A',
  }], { 20: 'Alpha' }), before);
  assert.equal(fingerprintTidyNameTargets([{
    id: 20,
    url: 'https://example.com/a',
    title: 'A',
  }], { 20: 'Alpha' }, { tabIdAliases: { 20: 'bad' } }),
  fingerprintTidyNameTargets([{
    id: 20,
    url: 'https://example.com/a',
    title: 'A',
  }], { 20: 'Alpha' }));
  assert.equal(fingerprintTidyNameTargets([], {}, { tabIdAliases: null }),
    fingerprintTidyNameTargets([]));
});

test('Tidy target fingerprints reject invalid tab identities and normalize visible text', () => {
  const invalidTabs = [
    null,
    { id: 0 },
    { id: -1 },
    { id: 1.5 },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { id: 'not-a-number' },
  ];
  const empty = fingerprintTidyNameTargets();

  assert.equal(fingerprintTidyNameTargets(null, null), empty);
  assert.equal(fingerprintTidyNameTargets(invalidTabs), empty);
  assert.equal(
    fingerprintTidyNameTargets([{
      id: 7,
      url: null,
      title: '  Page\n title ',
      panelTitle: ' Panel\tname ',
    }]),
    fingerprintTidyNameTargets([{
      id: 7,
      url: '',
      title: 'Page title',
      panelTitle: 'Panel name',
    }], {}),
  );
  assert.equal(
    fingerprintTidyNameTargets([{ id: 7, panelTitle: 'Panel name' }], null),
    fingerprintTidyNameTargets([{ id: 7, panelTitle: 'Panel name' }], {}),
  );
  assert.notEqual(
    fingerprintTidyNameTargets([{ id: 7, panelTitle: 'Panel name' }], { 7: '' }),
    fingerprintTidyNameTargets([{ id: 7, panelTitle: 'Panel name' }]),
  );
});
