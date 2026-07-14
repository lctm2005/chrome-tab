import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isFilePickerCancellation,
  loadRememberedArcFileHandle,
  rememberArcFileHandle,
} from '../src/shared/arc-file-access.js';

test('treats only AbortError as a user-cancelled file picker', () => {
  assert.equal(isFilePickerCancellation({ name: 'AbortError' }), true);
  assert.equal(isFilePickerCancellation({ name: 'NotAllowedError' }), false);
  assert.equal(isFilePickerCancellation(new Error('cancelled')), false);
});

test('Arc handle persistence degrades safely when IndexedDB is unavailable', async () => {
  assert.equal(await loadRememberedArcFileHandle(null), null);
  assert.equal(await rememberArcFileHandle({ name: 'StorableSidebar.json' }, null), false);
});
