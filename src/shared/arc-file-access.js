const ARC_HANDLE_DATABASE = 'space-tabs-local-files';
const ARC_HANDLE_STORE = 'file-handles';
const ARC_HANDLE_KEY = 'arc-storable-sidebar';

export async function loadRememberedArcFileHandle(indexedDBApi = globalThis.indexedDB) {
  if (!indexedDBApi?.open) return null;
  const database = await openHandleDatabase(indexedDBApi);
  try {
    return await requestResult(database.transaction(ARC_HANDLE_STORE, 'readonly').objectStore(ARC_HANDLE_STORE).get(ARC_HANDLE_KEY));
  } finally {
    database.close();
  }
}

export async function rememberArcFileHandle(handle, indexedDBApi = globalThis.indexedDB) {
  if (!handle || !indexedDBApi?.open) return false;
  const database = await openHandleDatabase(indexedDBApi);
  try {
    await requestResult(database.transaction(ARC_HANDLE_STORE, 'readwrite').objectStore(ARC_HANDLE_STORE).put(handle, ARC_HANDLE_KEY));
    return true;
  } finally {
    database.close();
  }
}

export async function forgetRememberedArcFileHandle(indexedDBApi = globalThis.indexedDB) {
  if (!indexedDBApi?.open) return;
  const database = await openHandleDatabase(indexedDBApi);
  try {
    await requestResult(database.transaction(ARC_HANDLE_STORE, 'readwrite').objectStore(ARC_HANDLE_STORE).delete(ARC_HANDLE_KEY));
  } finally {
    database.close();
  }
}

export function isFilePickerCancellation(error) {
  return error?.name === 'AbortError';
}

function openHandleDatabase(indexedDBApi) {
  return new Promise((resolve, reject) => {
    const request = indexedDBApi.open(ARC_HANDLE_DATABASE, 1);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(ARC_HANDLE_STORE)) {
        request.result.createObjectStore(ARC_HANDLE_STORE);
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('Could not open local Arc file access.')), { once: true });
    request.addEventListener('blocked', () => reject(new Error('Local Arc file access is blocked by another Space Tabs window.')), { once: true });
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result ?? null), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('Local Arc file access failed.')), { once: true });
  });
}
