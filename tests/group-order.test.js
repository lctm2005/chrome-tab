import test from 'node:test';
import assert from 'node:assert/strict';
import { planGroupReorder } from '../src/shared/group-order.js';

test('reorders live, saved and empty Tags independently without changing the input', () => {
  const order = ['node:parent', 'group:7', 'snapshot:0:work:child', 'node:child'];
  const moved = planGroupReorder({ order, sourceKeys: ['node:parent'], targetKey: 'node:child', intent: 'after' });
  assert.deepEqual(moved.order, ['group:7', 'snapshot:0:work:child', 'node:child', 'node:parent']);
  assert.deepEqual(order, ['node:parent', 'group:7', 'snapshot:0:work:child', 'node:child']);
  assert.equal(Object.hasOwn(moved, 'parents'), false);
});

test('supports before, after, end and no-change positions without losing Tags', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(planGroupReorder({ order, sourceKeys: ['c'], targetKey: 'a', intent: 'before' }).order, ['c', 'a', 'b']);
  assert.deepEqual(planGroupReorder({ order, sourceKeys: ['c'], targetKey: 'a' }).order, ['a', 'c', 'b']);
  assert.deepEqual(planGroupReorder({ order, sourceKeys: ['a'], intent: 'end' }).order, ['b', 'c', 'a']);
  assert.deepEqual(planGroupReorder({ order, sourceKeys: ['a'], targetKey: 'b', intent: 'before' }).order, order);
});

test('moves a selection in its original display order and ignores duplicate keys', () => {
  assert.deepEqual(planGroupReorder({
    order: ['a', 'b', 'c', 'd', 'd'], sourceKeys: ['c', 'a', 'a'], targetKey: 'd', intent: 'after',
  }).order, ['b', 'd', 'a', 'c']);
});

test('rejects stale sources, missing targets, self-drops and retired nesting intents', () => {
  assert.equal(planGroupReorder().error, 'missing-source');
  assert.equal(planGroupReorder({ order: ['a'], sourceKeys: ['gone'] }).error, 'missing-source');
  assert.equal(planGroupReorder({ order: ['a'], sourceKeys: ['a'], intent: 'inside' }).error, 'invalid-intent');
  assert.equal(planGroupReorder({ order: ['a'], sourceKeys: ['a'] }).error, 'invalid-target');
  assert.equal(planGroupReorder({ order: ['a'], sourceKeys: ['a'], targetKey: 'a' }).error, 'invalid-target');
});
