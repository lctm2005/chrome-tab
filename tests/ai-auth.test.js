import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aiAuthScope,
  assertSafeAIAuthTransport,
  createScopedAIAuth,
  persistScopedAIConfiguration,
  scopedAIKey,
} from '../src/shared/ai-auth.js';

const openAI = {
  provider: 'openai',
  baseUrl: 'https://ignored.example/v1',
  model: 'gpt-5.4-mini',
  apiKey: '  openai-key  ',
};

test('binds session-only AI keys to the normalized provider endpoint', () => {
  const auth = createScopedAIAuth(openAI);

  assert.deepEqual(aiAuthScope(openAI), {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  });
  assert.deepEqual(auth, {
    apiKey: 'openai-key',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  });
  assert.equal(scopedAIKey(auth, openAI), 'openai-key');
  assert.equal(scopedAIKey(auth, { ...openAI, provider: 'deepseek' }), '');
  assert.equal(scopedAIKey(auth, {
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'custom',
  }), '');
  assert.equal(scopedAIKey({ ...auth, baseUrl: 'https://other.example/v1' }, openAI), '');
  assert.equal(scopedAIKey({
    apiKey: 'old-coding-key',
    provider: 'z-ai',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
  }, {
    provider: 'z-ai',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-5.1',
  }), '', 'a Coding Plan key must not be rebound automatically to the general Z.ai endpoint');
});

test('rejects unscoped, empty, malformed, and keyless-provider credentials', () => {
  assert.equal(scopedAIKey({ apiKey: 'legacy-key' }, openAI), '');
  assert.equal(scopedAIKey({}, openAI), '');
  assert.equal(scopedAIKey({ apiKey: 'legacy-key', provider: 'openai' }, openAI), '');
  assert.equal(scopedAIKey({ ...aiAuthScope(openAI), apiKey: '  ' }, openAI), '');
  assert.equal(scopedAIKey(null, openAI), '');
  assert.equal(createScopedAIAuth({ ...openAI, apiKey: '' }), null);
  assert.equal(createScopedAIAuth({
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama',
    apiKey: 'must-not-be-used',
  }), null);
});

test('requires encrypted transport for remote API keys while allowing loopback development', () => {
  assert.equal(assertSafeAIAuthTransport(openAI), true);
  assert.equal(assertSafeAIAuthTransport({ ...openAI, apiKey: '' }), true);
  assert.equal(assertSafeAIAuthTransport({
    provider: 'ollama',
    baseUrl: 'http://remote.example/v1',
    model: 'llama',
    apiKey: 'ignored',
  }), true);

  for (const baseUrl of [
    'http://localhost:11434/v1',
    'http://models.localhost:11434/v1',
    'http://127.0.0.42:8000/v1',
    'http://[::1]:8000/v1',
  ]) {
    assert.equal(assertSafeAIAuthTransport({
      provider: 'openai-compatible',
      baseUrl,
      model: 'local',
      apiKey: 'local-key',
    }), true);
  }

  for (const baseUrl of [
    'http://llm.example.com/v1',
    'http://128.0.0.1/v1',
    'http://127.0.0.a/v1',
    'ftp://localhost/v1',
  ]) {
    assert.throws(() => assertSafeAIAuthTransport({
      provider: 'openai-compatible',
      baseUrl,
      model: 'remote',
      apiKey: 'remote-key',
    }), /HTTPS.*localhost/i);
  }
  for (const baseUrl of ['not a url', 'http://127.0.0.999/v1']) {
    assert.throws(() => assertSafeAIAuthTransport({
      provider: 'openai-compatible',
      baseUrl,
      model: 'broken',
      apiKey: 'key',
    }), /valid http\(s\)/i);
  }
});

function atomicOperations(overrides = {}) {
  const calls = [];
  const operations = {
    readSettings: async () => {
      calls.push('read-settings');
      return { workspace: 'before' };
    },
    readAuth: async () => {
      calls.push('read-auth');
      return { secret: 'before' };
    },
    persistSettings: async () => calls.push('settings'),
    persistAuth: async (auth) => calls.push(`auth:${auth.provider}`),
    clearAuth: async () => calls.push('clear'),
    restoreSettings: async (snapshot) => calls.push(`restore-settings:${snapshot.workspace}`),
    restoreAuth: async (snapshot) => calls.push(`restore-auth:${snapshot.secret}`),
    ...overrides(calls),
  };
  return { calls, operations };
}

test('atomically persists public provider settings before a scoped key', async () => {
  const { calls, operations } = atomicOperations(() => ({}));
  const auth = await persistScopedAIConfiguration(openAI, operations);

  assert.equal(auth.apiKey, 'openai-key');
  assert.deepEqual(calls, ['read-settings', 'read-auth', 'settings', 'auth:openai']);
});

test('rolls public settings back when either keyed write applies and rejects', async () => {
  const first = atomicOperations((calls) => ({
    persistSettings: async () => {
      calls.push('settings');
      throw new Error('local failed');
    },
  }));
  await assert.rejects(() => persistScopedAIConfiguration(openAI, first.operations), /local failed/);
  assert.deepEqual(first.calls, [
    'read-settings',
    'read-auth',
    'settings',
    'restore-settings:before',
  ]);

  const second = atomicOperations((calls) => ({
    persistAuth: async () => {
      calls.push('auth');
      throw new Error('session failed');
    },
  }));
  await assert.rejects(() => persistScopedAIConfiguration(openAI, second.operations), /session failed/);
  assert.deepEqual(second.calls, [
    'read-settings',
    'read-auth',
    'settings',
    'auth',
    'restore-auth:before',
    'restore-settings:before',
  ]);
});

test('restores both durable stores after the secret write applies and rejects, then retries consistently', async () => {
  let settingsStore = { workspace: 'before' };
  let authStore = { secret: 'before' };
  let failSecretAfterApply = true;
  const desiredSettings = { workspace: 'after' };
  const calls = [];
  const operations = {
    readSettings: async () => structuredClone(settingsStore),
    readAuth: async () => structuredClone(authStore),
    persistSettings: async () => {
      calls.push('settings:after');
      settingsStore = structuredClone(desiredSettings);
    },
    persistAuth: async (auth) => {
      calls.push(`auth:${auth.apiKey}`);
      authStore = structuredClone(auth);
      if (failSecretAfterApply) {
        failSecretAfterApply = false;
        throw new Error('session failed after apply');
      }
    },
    clearAuth: async () => {
      authStore = {};
    },
    restoreSettings: async (snapshot) => {
      calls.push(`restore-settings:${snapshot.workspace}`);
      settingsStore = structuredClone(snapshot);
    },
    restoreAuth: async (snapshot) => {
      calls.push(`restore-auth:${snapshot.secret}`);
      authStore = structuredClone(snapshot);
    },
  };

  await assert.rejects(
    () => persistScopedAIConfiguration(openAI, operations),
    /session failed after apply/,
  );
  assert.deepEqual(settingsStore, { workspace: 'before' });
  assert.deepEqual(authStore, { secret: 'before' });
  assert.deepEqual(calls, [
    'settings:after',
    'auth:openai-key',
    'restore-auth:before',
    'restore-settings:before',
  ]);

  calls.length = 0;
  const auth = await persistScopedAIConfiguration(openAI, operations);
  assert.deepEqual(settingsStore, desiredSettings);
  assert.deepEqual(authStore, auth);
  assert.deepEqual(calls, ['settings:after', 'auth:openai-key']);
});

test('atomically clears old auth before persisting a keyless configuration', async () => {
  const keyless = { ...openAI, apiKey: '' };
  const success = atomicOperations(() => ({}));
  assert.equal(await persistScopedAIConfiguration(keyless, success.operations), null);
  assert.deepEqual(success.calls, ['read-settings', 'read-auth', 'clear', 'settings']);

  const first = atomicOperations((calls) => ({
    clearAuth: async () => {
      calls.push('clear');
      throw new Error('clear failed');
    },
  }));
  await assert.rejects(() => persistScopedAIConfiguration(keyless, first.operations), /clear failed/);
  assert.deepEqual(first.calls, [
    'read-settings',
    'read-auth',
    'clear',
    'restore-auth:before',
  ]);

  const second = atomicOperations((calls) => ({
    persistSettings: async () => {
      calls.push('settings');
      throw new Error('settings failed');
    },
  }));
  await assert.rejects(() => persistScopedAIConfiguration(keyless, second.operations), /settings failed/);
  assert.deepEqual(second.calls, [
    'read-settings',
    'read-auth',
    'clear',
    'settings',
    'restore-settings:before',
    'restore-auth:before',
  ]);
});

test('AI configuration reads fail before writes and rollback failures preserve the cause', async () => {
  const readFailure = atomicOperations((calls) => ({
    readSettings: async () => {
      calls.push('read-settings-failed');
      throw new Error('read failed');
    },
  }));
  await assert.rejects(() => persistScopedAIConfiguration(openAI, readFailure.operations), /read failed/);
  assert.deepEqual(readFailure.calls, ['read-settings-failed', 'read-auth']);

  const rollbackFailure = atomicOperations((calls) => ({
    persistAuth: async () => {
      calls.push('auth');
      throw 'auth failed';
    },
    restoreAuth: async () => {
      calls.push('restore-auth-failed');
      throw new Error('auth rollback failed');
    },
  }));
  await assert.rejects(
    () => persistScopedAIConfiguration(openAI, rollbackFailure.operations),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, 'auth failed');
      assert.match(error.message, /auth failed.*rollback was incomplete/i);
      assert.equal(error.errors.length, 2);
      return true;
    },
  );
  assert.deepEqual(rollbackFailure.calls, [
    'read-settings',
    'read-auth',
    'settings',
    'auth',
    'restore-auth-failed',
    'restore-settings:before',
  ]);

  const errorRollbackFailure = atomicOperations((calls) => ({
    persistSettings: async () => {
      calls.push('settings-failed');
      throw new Error('settings write failed');
    },
    restoreSettings: async () => {
      calls.push('restore-settings-failed');
      throw new Error('settings rollback failed');
    },
  }));
  await assert.rejects(
    () => persistScopedAIConfiguration(openAI, errorRollbackFailure.operations),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause.message, 'settings write failed');
      assert.match(error.message, /settings write failed.*rollback was incomplete/i);
      assert.deepEqual(error.errors.map((failure) => failure.message), [
        'settings write failed',
        'settings rollback failed',
      ]);
      return true;
    },
  );
  assert.deepEqual(errorRollbackFailure.calls, [
    'read-settings',
    'read-auth',
    'settings-failed',
    'restore-settings-failed',
  ]);
});
