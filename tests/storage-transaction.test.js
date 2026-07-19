import assert from 'node:assert/strict';
import test from 'node:test';

import {
  persistStoragePair,
  persistStorageStep,
} from '../src/shared/storage-transaction.js';
import {
  projectDormantSnapshotGroupRemoval,
  projectOpenedDormantTabRemoval,
} from '../src/shared/dormant-snapshot.js';

function storageStep(name, initial, value, options = {}) {
  const data = initial === undefined ? {} : { [name]: structuredClone(initial) };
  const calls = [];
  let setCount = 0;
  return {
    data,
    calls,
    step: {
      key: name,
      value,
      async get() {
        calls.push('get');
        if (options.getError) throw options.getError;
        return structuredClone(data);
      },
      async set(update) {
        setCount += 1;
        calls.push(`set:${JSON.stringify(update[name])}`);
        data[name] = structuredClone(update[name]);
        if (options.setErrorAt === setCount) throw options.setError;
      },
      async remove(key) {
        calls.push(`remove:${key}`);
        delete data[key];
        if (options.removeError) throw options.removeError;
      },
    },
  };
}

test('persists routing first and durable workspace state as the final commit', async () => {
  const order = [];
  const first = storageStep('window', { active: 'old' }, { active: 'new' });
  const second = storageStep('workspace', { tabs: ['old'] }, { tabs: ['new'] });
  for (const record of [first, second]) {
    const originalGet = record.step.get;
    const originalSet = record.step.set;
    record.step.get = async () => { order.push(`get:${record.step.key}`); return originalGet(); };
    record.step.set = async (value) => { order.push(`set:${record.step.key}`); return originalSet(value); };
  }

  await persistStoragePair(first.step, second.step);
  assert.deepEqual(order, ['get:window', 'get:workspace', 'set:window', 'set:workspace']);
  assert.deepEqual(first.data.window, { active: 'new' });
  assert.deepEqual(second.data.workspace, { tabs: ['new'] });
});

test('a first write that applies and rejects is compensated before durable state is attempted', async () => {
  const failure = new Error('session unavailable');
  const first = storageStep('window', 'old-window', 'new-window', {
    setErrorAt: 1,
    setError: failure,
  });
  const second = storageStep('workspace', 'old-workspace', 'new-workspace');

  await assert.rejects(() => persistStoragePair(first.step, second.step), (error) => error === failure);
  assert.equal(first.data.window, 'old-window');
  assert.equal(second.data.workspace, 'old-workspace');
  assert.deepEqual(second.calls, ['get']);
});

test('a durable commit failure rolls both areas back even after a partial write', async () => {
  const failure = new Error('local quota exceeded');
  const first = storageStep('window', 'old-window', 'new-window');
  const second = storageStep('workspace', 'old-workspace', 'new-workspace', {
    setErrorAt: 1,
    setError: failure,
  });

  await assert.rejects(() => persistStoragePair(first.step, second.step), (error) => error === failure);
  assert.equal(first.data.window, 'old-window');
  assert.equal(second.data.workspace, 'old-workspace');
  assert.deepEqual(second.calls, ['get', 'set:"new-workspace"', 'set:"old-workspace"']);
  assert.deepEqual(first.calls, ['get', 'set:"new-window"', 'set:"old-window"']);
});

test('rollback removes keys that did not exist before the attempted transaction', async () => {
  const failure = new Error('commit failed');
  const first = storageStep('window', undefined, 'new-window');
  const second = storageStep('workspace', undefined, 'new-workspace', {
    setErrorAt: 1,
    setError: failure,
  });

  await assert.rejects(() => persistStoragePair(first.step, second.step), (error) => error === failure);
  assert.deepEqual(first.data, {});
  assert.deepEqual(second.data, {});
  assert.ok(first.calls.includes('remove:window'));
  assert.ok(second.calls.includes('remove:workspace'));
});

test('read failures perform no writes and rollback failures remain visible with the original cause', async () => {
  const readFailure = new Error('cannot inspect session');
  const unreadable = storageStep('window', 'old', 'new', { getError: readFailure });
  const untouched = storageStep('workspace', 'old', 'new');
  await assert.rejects(() => persistStoragePair(unreadable.step, untouched.step), (error) => error === readFailure);
  assert.deepEqual(unreadable.calls, ['get']);
  assert.deepEqual(untouched.calls, ['get']);

  const writeFailure = new Error('write failed');
  const rollbackFailure = new Error('rollback failed');
  const first = storageStep('window', undefined, 'new', {
    setErrorAt: 1,
    setError: writeFailure,
    removeError: rollbackFailure,
  });
  const second = storageStep('workspace', 'old', 'new');
  await assert.rejects(() => persistStoragePair(first.step, second.step), (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.strictEqual(error.cause, writeFailure);
    assert.deepEqual(error.errors, [writeFailure, rollbackFailure]);
    assert.match(error.message, /write failed\. Storage rollback also failed\./);
    return true;
  });
});

test('null reads are treated as absent and non-Error write failures remain intelligible', async () => {
  const writeFailure = 'storage backend disconnected';
  const rollbackFailure = new Error('remove failed');
  const firstCalls = [];
  const first = {
    key: 'window',
    value: 'new',
    async get() {
      firstCalls.push('get');
      return null;
    },
    async set() {
      firstCalls.push('set');
      throw writeFailure;
    },
    async remove(key) {
      firstCalls.push(`remove:${key}`);
      throw rollbackFailure;
    },
  };
  const second = storageStep('workspace', 'old', 'new');

  await assert.rejects(() => persistStoragePair(first, second.step), (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.cause, writeFailure);
    assert.deepEqual(error.errors, [writeFailure, rollbackFailure]);
    assert.match(error.message, /storage backend disconnected\. Storage rollback also failed\./);
    return true;
  });
  assert.deepEqual(firstCalls, ['get', 'set', 'remove:window']);
  assert.deepEqual(second.calls, ['get']);
});

test('a single storage commit succeeds without compensation', async () => {
  const storage = storageStep('workspace', { completed: false }, { completed: true });

  await persistStorageStep(storage.step);

  assert.deepEqual(storage.data.workspace, { completed: true });
  assert.deepEqual(storage.calls, [
    'get',
    'set:{"completed":true}',
  ]);
});

test('a single storage commit that applies and rejects restores the previous value', async () => {
  const failure = new Error('local storage rejected completion');
  const storage = storageStep('workspace', { completed: false }, { completed: true }, {
    setErrorAt: 1,
    setError: failure,
  });

  await assert.rejects(() => persistStorageStep(storage.step), (error) => error === failure);

  assert.deepEqual(storage.data.workspace, { completed: false });
  assert.deepEqual(storage.calls, [
    'get',
    'set:{"completed":true}',
    'set:{"completed":false}',
  ]);
});

test('a failed first write removes a newly introduced single storage key', async () => {
  const failure = 'storage unavailable';
  const storage = storageStep('workspace', undefined, { completed: true }, {
    setErrorAt: 1,
    setError: failure,
  });

  await assert.rejects(() => persistStorageStep(storage.step), (error) => error === failure);

  assert.deepEqual(storage.data, {});
  assert.deepEqual(storage.calls, [
    'get',
    'set:{"completed":true}',
    'remove:workspace',
  ]);
});

test('single-key compensation failures preserve both the write and rollback errors', async () => {
  const writeFailure = new Error('write failed');
  const rollbackFailure = new Error('restore failed');
  const storage = storageStep('workspace', undefined, { completed: true }, {
    setErrorAt: 1,
    setError: writeFailure,
    removeError: rollbackFailure,
  });

  await assert.rejects(() => persistStorageStep(storage.step), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.strictEqual(error.cause, writeFailure);
    assert.deepEqual(error.errors, [writeFailure, rollbackFailure]);
    assert.equal(error.message, 'write failed. Storage rollback also failed.');
    return true;
  });
});

function savedOnlyWorkspace() {
  return {
    version: 4,
    activeSpaceId: 'saved',
    spaces: [{ id: 'saved', name: 'Saved', icon: 'S', color: 'blue' }],
    spaceContexts: { saved: '# Keep this user context' },
    askSessions: {
      'space:saved': {
        key: 'space:saved',
        messages: [{ id: 'question', role: 'user', text: 'Keep this conversation' }],
      },
    },
    spaceSnapshots: {
      saved: {
        version: 1,
        identityVersion: 1,
        updatedAt: 10,
        groups: [
          {
            snapshotGroupId: 'saved-group-a',
            title: 'Saved A',
            color: 'blue',
            tabs: [
              {
                snapshotTabId: 'saved-tab-remove',
                title: 'Remove me',
                url: 'https://saved.test/remove',
              },
              {
                snapshotTabId: 'saved-tab-keep',
                title: 'Keep me',
                url: 'https://saved.test/keep',
              },
            ],
          },
          {
            snapshotGroupId: 'saved-group-b',
            title: 'Saved B',
            color: 'green',
            tabs: [{
              snapshotTabId: 'saved-tab-b',
              title: 'Keep group B',
              url: 'https://saved.test/group-b',
            }],
          },
        ],
      },
    },
  };
}

test('saved-only tab checkpoint failure restores snapshot, Context, and identities before an exact retry', async () => {
  const before = savedOnlyWorkspace();
  const after = structuredClone(before);
  after.spaceSnapshots.saved = projectOpenedDormantTabRemoval(
    before.spaceSnapshots.saved,
    {
      snapshotGroupId: 'saved-group-a',
      snapshotTabId: 'saved-tab-remove',
      title: 'Remove me',
      url: 'https://saved.test/remove',
    },
    { snapshotGroupId: 'saved-group-a', title: 'Saved A', color: 'blue' },
    20,
  );
  const failure = new Error('saved tab checkpoint failed after apply');
  const storage = storageStep('spaceTabsState', before, after, {
    setErrorAt: 1,
    setError: failure,
  });

  await assert.rejects(() => persistStorageStep(storage.step), (error) => error === failure);
  assert.deepEqual(storage.data.spaceTabsState, before);

  await persistStorageStep(storage.step);
  const saved = storage.data.spaceTabsState;
  assert.equal(saved.spaceContexts.saved, '# Keep this user context');
  assert.deepEqual(saved.askSessions, before.askSessions);
  assert.deepEqual(saved.spaceSnapshots.saved.groups.map((group) => ({
    id: group.snapshotGroupId,
    tabs: group.tabs.map((tab) => tab.snapshotTabId),
  })), [
    { id: 'saved-group-a', tabs: ['saved-tab-keep'] },
    { id: 'saved-group-b', tabs: ['saved-tab-b'] },
  ]);
});

test('saved-only group checkpoint failure preserves the whole group before an exact retry', async () => {
  const before = savedOnlyWorkspace();
  const after = structuredClone(before);
  after.spaceSnapshots.saved = projectDormantSnapshotGroupRemoval(
    before.spaceSnapshots.saved,
    { snapshotGroupId: 'saved-group-b', title: 'Saved B', color: 'green' },
    20,
  );
  const failure = new Error('saved group checkpoint failed after apply');
  const storage = storageStep('spaceTabsState', before, after, {
    setErrorAt: 1,
    setError: failure,
  });

  await assert.rejects(() => persistStorageStep(storage.step), (error) => error === failure);
  assert.deepEqual(storage.data.spaceTabsState, before);

  await persistStorageStep(storage.step);
  const saved = storage.data.spaceTabsState;
  assert.equal(saved.spaceContexts.saved, '# Keep this user context');
  assert.deepEqual(saved.askSessions, before.askSessions);
  assert.deepEqual(saved.spaceSnapshots.saved.groups.map((group) => ({
    id: group.snapshotGroupId,
    tabs: group.tabs.map((tab) => tab.snapshotTabId),
  })), [
    { id: 'saved-group-a', tabs: ['saved-tab-remove', 'saved-tab-keep'] },
  ]);
});
