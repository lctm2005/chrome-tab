import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIAuthVault, decryptAIAuth, encryptAIAuth } from '../src/shared/ai-vault.js';
import { scopedAIKey } from '../src/shared/ai-auth.js';
import { SECRET_STORAGE_KEY } from '../src/shared/state.js';

const auth = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'test-vault-key' };
const wrapped = { [SECRET_STORAGE_KEY]: { ai: auth } };

function fixture() {
  let record;
  let legacy = structuredClone(wrapped);
  let failWrite = false;
  let failCleanup = false;
  const options = {
    readRecord: async () => structuredClone(record),
    writeRecord: async (next) => {
      if (failWrite) throw new Error('Storage full');
      record = structuredClone(next);
    },
    readLegacy: async () => legacy,
    removeLegacy: async () => {
      if (failCleanup) throw new Error('Cleanup interrupted');
      legacy = {};
    },
  };
  return {
    options,
    vault: () => createAIAuthVault(options),
    record: () => record,
    legacy: () => legacy,
    failWrite: (value) => { failWrite = value; },
    failCleanup: (value) => { failCleanup = value; },
  };
}

test('encrypts credentials with non-extractable AES-GCM and rejects tampered ciphertext', async () => {
  const record = await encryptAIAuth(auth);
  assert.equal(record.key.extractable, false);
  assert.equal(record.key.algorithm.name, 'AES-GCM');
  assert.equal(record.key.algorithm.length, 256);
  assert.equal(record.iv.length, 12);
  assert.equal(JSON.stringify(record).includes(auth.apiKey), false);
  await assert.rejects(() => crypto.subtle.exportKey('raw', record.key));
  assert.deepEqual(await decryptAIAuth(structuredClone(record)), auth);
  const second = await encryptAIAuth(auth);
  assert.notDeepEqual(record.iv, second.iv);
  const damaged = structuredClone(record);
  new Uint8Array(damaged.ciphertext)[0] ^= 1;
  await assert.rejects(() => decryptAIAuth(damaged));
  await assert.rejects(() => decryptAIAuth({ ...record, version: 99 }), /Unsupported/);
  await assert.rejects(() => decryptAIAuth({ ...record, key: second.key }));
  await assert.rejects(async () => decryptAIAuth(await encryptAIAuth({ apiKey: 'unscoped' })), /scope/);
});

test('migrates an existing scoped session key only after the encrypted record commits', async () => {
  const f = fixture();
  assert.deepEqual(await f.vault().get(), wrapped);
  assert.deepEqual(f.legacy(), {});
  assert.deepEqual(await f.vault().get(), wrapped, 'new view recovers the durable key without a session');
  assert.equal(scopedAIKey((await f.vault().get())[SECRET_STORAGE_KEY].ai, { ...auth, provider: 'deepseek' }), '');
});

test('retains the legacy key when migration fails and retries safely', async () => {
  const f = fixture();
  f.failWrite(true);
  await assert.rejects(() => f.vault().get(), /Storage full/);
  assert.deepEqual(f.legacy(), wrapped);
  assert.equal(f.record(), undefined);
  f.failWrite(false);
  assert.deepEqual(await f.vault().get(), wrapped);
});

test('never migrates unscoped keys or silently rebinds a previous provider endpoint', async () => {
  for (const ai of [
    null, {}, { apiKey: 'unscoped' },
    { ...auth, baseUrl: 'https://another.example/v1' },
    { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'unused' },
  ]) {
    const f = fixture();
    f.options.readLegacy = async () => ({ [SECRET_STORAGE_KEY]: { ai } });
    assert.deepEqual(await f.vault().get(), {});
    assert.equal(f.record(), undefined);
  }
});

test('clearing a durable key cannot resurrect a stale legacy key after cleanup failure', async () => {
  const f = fixture();
  f.failCleanup(true);
  await f.vault().set(wrapped);
  await f.vault().remove();
  assert.deepEqual(f.legacy(), wrapped);
  assert.deepEqual(await f.vault().get(), {});
  assert.deepEqual(f.record(), { version: 1, cleared: true });
  f.failCleanup(false);
  assert.deepEqual(await f.vault().get(), {});
  assert.deepEqual(f.legacy(), {});
});

test('a failed replacement or clear preserves the previously committed key', async () => {
  const f = fixture();
  await f.vault().set(wrapped);
  f.failWrite(true);
  await assert.rejects(() => f.vault().set({ [SECRET_STORAGE_KEY]: { ai: { ...auth, apiKey: 'replacement' } } }), /Storage full/);
  await assert.rejects(() => f.vault().remove(), /Storage full/);
  assert.deepEqual(await f.vault().get(), wrapped);
  await assert.rejects(() => f.vault().set({ [SECRET_STORAGE_KEY]: { ai: { apiKey: 'unscoped' } } }), /provider endpoint/);
});

test('a fresh installation without legacy auth returns no key', async () => {
  const f = fixture();
  f.options.readLegacy = async () => ({});
  assert.deepEqual(await f.vault().get(), {});
});

test('raw encrypted snapshots support rollback and replacement of an unreadable key', async () => {
  const f = fixture();
  await f.vault().set(wrapped);
  const original = await f.vault().snapshot();
  const damaged = structuredClone(original);
  new Uint8Array(damaged.ciphertext)[0] ^= 1;
  await f.vault().restore(damaged);
  await assert.rejects(() => f.vault().get(), (error) => (
    error.code === 'AI_AUTH_STORAGE' && /Enter and save it again/.test(error.message)
  ));
  assert.deepEqual(await f.vault().snapshot(), damaged, 'a failed read never overwrites the existing record');
  await f.vault().set(wrapped);
  assert.deepEqual(await f.vault().get(), wrapped);
  await f.vault().restore(original);
  assert.deepEqual(await f.vault().get(), wrapped);
  await f.vault().restore(undefined);
  assert.deepEqual(await f.vault().get(), {});
});

test('a storage read failure is identified as a local credential error', async () => {
  const vault = createAIAuthVault({ readRecord: async () => { throw new Error('Database unavailable'); } });
  await assert.rejects(() => vault.get(), (error) => (
    error.code === 'AI_AUTH_STORAGE' && /Workspace data is still available/.test(error.message)
  ));
});
