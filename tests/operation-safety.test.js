import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fingerprintTidyNameTargets,
  isOperationUndoVisible,
} from '../src/shared/operation-safety.js';

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
  assert.equal(isOperationUndoVisible({ createdAt: 2_000, status: 'applied' }, 1_000), false);
  assert.equal(isOperationUndoVisible({ createdAt: 1_000, status: 'applied' }, 1_001, 0), false);
});

test('Tidy target fingerprints include URL, page title, and current panel name', () => {
  const tabs = [{
    id: 10,
    url: 'https://example.com/spec',
    title: 'Specification',
    panelTitle: 'Spec',
  }];
  const initial = fingerprintTidyNameTargets(tabs, { 10: 'Spec' });

  assert.match(initial, /^tidy-target-v1-[0-9a-f]{8}-1$/);
  assert.notEqual(fingerprintTidyNameTargets([
    { ...tabs[0], url: 'https://example.com/plan' },
  ], { 10: 'Spec' }), initial);
  assert.notEqual(fingerprintTidyNameTargets([
    { ...tabs[0], title: 'Updated specification' },
  ], { 10: 'Spec' }), initial);
  assert.notEqual(fingerprintTidyNameTargets(tabs, { 10: 'Manual override' }), initial);
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
