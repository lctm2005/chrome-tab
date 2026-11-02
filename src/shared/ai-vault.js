import { createScopedAIAuth, scopedAIKey } from './ai-auth.js';
import { SECRET_STORAGE_KEY } from './state.js';

const DATABASE_NAME = 'space-tabs-ai-vault';
const STORE_NAME = 'auth';
const RECORD_ID = 'current';
const additionalData = new TextEncoder().encode('Space Tabs AI auth v1');

function storageError(message, cause) {
  const error = new Error(message, { cause });
  error.code = 'AI_AUTH_STORAGE';
  return error;
}

// The CryptoKey is non-extractable, but lives in the same browser profile as
// the ciphertext. This is local encryption, not an OS keychain or protection
// against code already running in the extension's origin.
export async function encryptAIAuth(auth, crypto = globalThis.crypto) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    new TextEncoder().encode(JSON.stringify(auth)),
  );
  return { version: 1, key, iv, ciphertext };
}

export async function decryptAIAuth(record, crypto = globalThis.crypto) {
  if (record.version !== 1) throw new Error('Unsupported saved API key format.');
  if (record.cleared === true) return null;
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: record.iv, additionalData },
    record.key,
    record.ciphertext,
  );
  const auth = JSON.parse(new TextDecoder().decode(plaintext));
  if (!auth?.apiKey || scopedAIKey(auth, auth) !== auth.apiKey) {
    throw new Error('Invalid saved API key scope.');
  }
  return auth;
}

// Callers serialize configuration changes with the shared workspace lock.
// A committed tombstone prevents a stale legacy session key from resurfacing
// if Chrome fails to remove the old session entry after a durable write.
export function createAIAuthVault({
  readRecord = () => accessRecord('readonly'),
  writeRecord = (record) => accessRecord('readwrite', record),
  readLegacy = async () => ({}),
  removeLegacy = async () => {},
} = {}) {
  const cleanup = () => removeLegacy().catch(() => undefined);
  return {
    // Configuration rollback preserves the exact encrypted record, even when
    // its key cannot be decrypted. A replacement can still repair that case.
    snapshot: readRecord,
    async restore(record) {
      await writeRecord(record ?? { version: 1, cleared: true });
      await cleanup();
    },
    async get() {
      let record;
      try {
        record = await readRecord();
      } catch (error) {
        throw storageError('Saved API key storage is unavailable. Workspace data is still available; try saving the key again later.', error);
      }
      if (record !== undefined) {
        let auth;
        try {
          auth = await decryptAIAuth(record);
        } catch (error) {
          throw storageError('Saved API key could not be read. Enter and save it again in Settings.', error);
        }
        await cleanup();
        return auth ? { [SECRET_STORAGE_KEY]: { ai: auth } } : {};
      }
      const legacy = (await readLegacy())?.[SECRET_STORAGE_KEY]?.ai;
      const auth = createScopedAIAuth(legacy || {});
      // Never bind an unscoped legacy key, or silently change its endpoint.
      if (!auth || scopedAIKey(legacy, auth) !== auth.apiKey) return {};
      await writeRecord(await encryptAIAuth(auth));
      await cleanup();
      return { [SECRET_STORAGE_KEY]: { ai: auth } };
    },
    async set(value) {
      const auth = value?.[SECRET_STORAGE_KEY]?.ai;
      if (!auth?.apiKey || scopedAIKey(auth, auth) !== auth.apiKey) {
        throw new Error('Cannot save an API key without its provider endpoint.');
      }
      await writeRecord(await encryptAIAuth(auth));
      await cleanup();
    },
    async remove() {
      await writeRecord({ version: 1, cleared: true });
      await cleanup();
    },
  };
}

async function accessRecord(mode, value) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onerror = () => reject(request.error);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(storageError('Close other Space Tabs views and try saving the API key again.'));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = mode === 'readonly' ? store.get(RECORD_ID) : store.put(value, RECORD_ID);
      // Resolve only on commit; request success alone does not mean durable.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(storageError('API key storage was interrupted.', transaction.error));
      transaction.onerror = () => reject(storageError('Could not save the API key on this device.', transaction.error));
    });
  } finally {
    database.close();
  }
}
