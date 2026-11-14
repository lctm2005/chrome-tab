import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTitlePath,
  buildGroupTree,
  descendantKeysOf,
  planHierarchyDrop,
  remapGroupParents,
  planLegacyTitlePathMigration,
} from '../src/shared/group-tree.js';

function group(key, title = key, extra = {}) {
  return { key, title, tabs: [], ...extra };
}

test('parseTitlePath splits, trims and compacts adjacent duplicates', () => {
  assert.deepEqual(parseTitlePath('A / B'), ['A', 'B']);
  assert.deepEqual(parseTitlePath('A / / B'), ['A', 'B']);
  assert.deepEqual(parseTitlePath('A / A / B'), ['A', 'B']);
  assert.deepEqual(parseTitlePath('  '), []);
  assert.deepEqual(parseTitlePath(''), []);
  assert.deepEqual(parseTitlePath('Single'), ['Single']);
  assert.deepEqual(parseTitlePath('A / B /'), ['A', 'B']);
});

test('buildGroupTree nests children under parents preserving flat order', () => {
  const groups = [group('a'), group('b'), group('c')];
  const tree = buildGroupTree(groups, { b: 'a' });
  assert.equal(tree.length, 2);
  assert.equal(tree[0].key, 'a');
  assert.deepEqual(tree[0].children.map((node) => node.key), ['b']);
  assert.equal(tree[1].key, 'c');
});

test('buildGroupTree keeps children of a valid parent whose own chain is broken', () => {
  const groups = [group('x'), group('y')];
  const tree = buildGroupTree(groups, { x: 'missing', y: 'x' });
  assert.equal(tree.length, 1);
  assert.equal(tree[0].key, 'x');
  assert.deepEqual(tree[0].children.map((node) => node.key), ['y']);
});

test('buildGroupTree survives parent cycles by promoting members to root', () => {
  const cyclic = buildGroupTree([group('p'), group('q')], { p: 'q', q: 'p' });
  assert.equal(cyclic.length, 2);
  assert.deepEqual(cyclic.map((node) => node.key).sort(), ['p', 'q']);
  for (const node of cyclic) assert.deepEqual(node.children, []);
});

test('buildGroupTree treats self-parent as root and deep chains nest transitively', () => {
  const selfParent = buildGroupTree([group('s')], { s: 's' });
  assert.equal(selfParent.length, 1);
  assert.deepEqual(selfParent[0].children, []);

  const groups = [group('a'), group('b'), group('c')];
  const tree = buildGroupTree(groups, { b: 'a', c: 'b' });
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children[0].key, 'b');
  assert.equal(tree[0].children[0].children[0].key, 'c');
});

test('descendantKeysOf returns transitive descendants excluding self', () => {
  const parents = { b: 'a', c: 'b', d: 'z' };
  assert.deepEqual([...descendantKeysOf('a', parents)].sort(), ['b', 'c']);
  assert.deepEqual([...descendantKeysOf('d', parents)], []);
  assert.deepEqual([...descendantKeysOf('missing', parents)], []);
});

test('planHierarchyDrop inside nests source under target', () => {
  const result = planHierarchyDrop({
    parents: {},
    order: ['a', 'b', 'c'],
    sourceRootKeys: ['c'],
    sourceAllKeys: ['c'],
    targetKey: 'a',
    intent: 'inside',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.parents.c, 'a');
  assert.deepEqual(result.order, ['a', 'c', 'b']);
});

test('planHierarchyDrop before/after re-parents to target parent', () => {
  const after = planHierarchyDrop({
    parents: { b: 'a' },
    order: ['a', 'b', 'c'],
    sourceRootKeys: ['c'],
    sourceAllKeys: ['c'],
    targetKey: 'b',
    intent: 'after',
  });
  assert.equal(after.error, undefined);
  assert.equal(after.parents.c, 'a');
  assert.deepEqual(after.order, ['a', 'b', 'c']);

  const before = planHierarchyDrop({
    parents: { b: 'a' },
    order: ['a', 'b', 'c'],
    sourceRootKeys: ['c'],
    sourceAllKeys: ['c'],
    targetKey: 'b',
    intent: 'before',
  });
  assert.equal(before.parents.c, 'a');
  assert.deepEqual(before.order, ['a', 'c', 'b']);
});

test('planHierarchyDrop root appends at root level', () => {
  const result = planHierarchyDrop({
    parents: { b: 'a' },
    order: ['a', 'b', 'c'],
    sourceRootKeys: ['b'],
    sourceAllKeys: ['b'],
    targetKey: '',
    intent: 'root',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.parents.b, undefined);
  assert.deepEqual(result.order, ['a', 'c', 'b']);
});

test('planHierarchyDrop moves whole subtree preserving internal DFS order', () => {
  const result = planHierarchyDrop({
    parents: { child: 'src', grand: 'child', other: 'tgt' },
    order: ['tgt', 'other', 'src', 'child', 'grand'],
    sourceRootKeys: ['src'],
    sourceAllKeys: ['src', 'child', 'grand'],
    targetKey: 'tgt',
    intent: 'inside',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.parents.src, 'tgt');
  assert.equal(result.parents.child, 'src');
  // other 已是 tgt 的子级，DFS 序中 src 块作为新子级落在既有子树之后
  assert.deepEqual(result.order, ['tgt', 'other', 'src', 'child', 'grand']);
});

test('planHierarchyDrop inside inserts after target existing subtree', () => {
  const result = planHierarchyDrop({
    parents: { child: 'tgt' },
    order: ['a', 'tgt', 'child', 'b'],
    sourceRootKeys: ['a'],
    sourceAllKeys: ['a'],
    targetKey: 'tgt',
    intent: 'inside',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.parents.a, 'tgt');
  assert.equal(result.parents.child, 'tgt');
  assert.deepEqual(result.order, ['tgt', 'child', 'a', 'b']);
});

test('planHierarchyDrop rejects cycles, self targets and no-ops', () => {
  const cycle = planHierarchyDrop({
    parents: { b: 'a' },
    order: ['a', 'b'],
    sourceRootKeys: ['a'],
    sourceAllKeys: ['a', 'b'],
    targetKey: 'b',
    intent: 'inside',
  });
  assert.equal(cycle.error, 'cycle');

  const self = planHierarchyDrop({
    parents: { b: 'a' },
    order: ['a', 'b'],
    sourceRootKeys: ['a'],
    sourceAllKeys: ['a'],
    targetKey: 'a',
    intent: 'inside',
  });
  assert.equal(self.error, 'self');

  const noop = planHierarchyDrop({
    parents: { b: 'a' },
    order: ['a', 'b'],
    sourceRootKeys: ['b'],
    sourceAllKeys: ['b'],
    targetKey: 'a',
    intent: 'inside',
  });
  assert.equal(noop.error, 'no-op');

  const emptySource = planHierarchyDrop({
    parents: {},
    order: ['a', 'b'],
    sourceRootKeys: [],
    sourceAllKeys: [],
    targetKey: 'a',
    intent: 'inside',
  });
  assert.equal(emptySource.error, 'empty-source');

  const missingTarget = planHierarchyDrop({
    parents: {},
    order: ['a', 'b'],
    sourceRootKeys: ['a'],
    sourceAllKeys: ['a'],
    targetKey: '',
    intent: 'before',
  });
  assert.equal(missingTarget.error, 'missing-target');
});

test('planHierarchyDrop derives the source root when callers omit it', () => {
  const result = planHierarchyDrop({
    parents: {},
    order: ['a', 'b'],
    sourceRootKeys: [],
    sourceAllKeys: ['a'],
    targetKey: 'b',
    intent: 'inside',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.parents.a, 'b');
  assert.deepEqual(result.order, ['b', 'a']);
});

test('planLegacyTitlePathMigration tolerates missing inputs and appends multiple renames', () => {
  let counter = 0;
  const onlyGroups = planLegacyTitlePathMigration({
    groupsBySpace: {
      s1: [group('g1', 'A / One'), group('g2', 'A / Two')],
    },
    idFactory: () => `node-${counter++}`,
  });
  // 两个多段标题共享父段 A → A 建一次空节点，两条 rename 依次追加
  assert.deepEqual(
    onlyGroups.renamesBySpace.s1.map((entry) => entry.nextTitle),
    ['One', 'Two'],
  );
  assert.equal(onlyGroups.parentsBySpace.s1.g1, onlyGroups.parentsBySpace.s1.g2);
  assert.equal(Object.keys(onlyGroups.emptyNodesBySpace.s1).length, 1);

  const onlyPaths = planLegacyTitlePathMigration({
    folderPathsBySpace: { s2: ['Solo'] },
    idFactory: () => `node-${counter++}`,
  });
  const s2Nodes = Object.values(onlyPaths.emptyNodesBySpace.s2 || {}).map((node) => node.title);
  assert.deepEqual(s2Nodes, ['Solo']);
});

test('planHierarchyDrop falls back to append when the target left the order', () => {
  const result = planHierarchyDrop({
    parents: {},
    order: ['a', 'b'],
    sourceRootKeys: ['a'],
    sourceAllKeys: ['a'],
    targetKey: 'vanished',
    intent: 'after',
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.order, ['b', 'a']);
});

test('planHierarchyDrop before/after clears the parent when target is root', () => {
  const result = planHierarchyDrop({
    parents: { b: 'a' },
    order: ['a', 'b', 'c'],
    sourceRootKeys: ['b'],
    sourceAllKeys: ['b'],
    targetKey: 'c',
    intent: 'after',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.parents.b, undefined);
  assert.deepEqual(result.order, ['a', 'c', 'b']);
});

test('remapGroupParents rewrites keys and drops entries mapped away', () => {
  const next = remapGroupParents(
    { b: 'a', c: 'b', d: 'gone', e: 'c' },
    new Map([['a', 'a2'], ['b', 'b2'], ['gone', ''], ['e', '']]),
  );
  assert.equal(next.b2, 'a2');
  assert.equal(next.c, 'b2');
  assert.equal(next.b, undefined);
  assert.equal(next.d, undefined);
  assert.equal(next.e, undefined);
});

test('remapGroupParents skips identity remaps and passes through plain maps', () => {
  const next = remapGroupParents({ b: 'a' }, new Map([['a', 'b']]));
  assert.equal(next.b, undefined);
  const copy = remapGroupParents({ b: 'a' }, 'not-a-map');
  assert.deepEqual(copy, { b: 'a' });
});

test('planLegacyTitlePathMigration unwinds " / " titles and stored paths', () => {
  let counter = 0;
  const plan = planLegacyTitlePathMigration({
    folderPathsBySpace: { s1: ['AI / New Group'] },
    groupsBySpace: { s1: [group('g1', 'AI'), group('g2', 'AI / Claude')] },
    idFactory: () => `node-${counter++}`,
  });
  assert.deepEqual(plan.renamesBySpace.s1, [{ key: 'g2', nextTitle: 'Claude' }]);
  assert.equal(plan.parentsBySpace.s1.g2, 'g1');
  const nodes = plan.emptyNodesBySpace.s1;
  const newNodeKeys = Object.keys(nodes);
  assert.equal(newNodeKeys.length, 1);
  assert.equal(nodes[newNodeKeys[0]].title, 'New Group');
  assert.equal(plan.parentsBySpace.s1[newNodeKeys[0]], 'g1');
});

test('planLegacyTitlePathMigration creates nodes for missing parent segments', () => {
  let counter = 0;
  const plan = planLegacyTitlePathMigration({
    folderPathsBySpace: {},
    groupsBySpace: { s1: [group('g1', 'X / Y / Z')] },
    idFactory: () => `node-${counter++}`,
  });
  assert.deepEqual(plan.renamesBySpace.s1, [{ key: 'g1', nextTitle: 'Z' }]);
  const titles = Object.values(plan.emptyNodesBySpace.s1).map((node) => node.title).sort();
  assert.deepEqual(titles, ['X', 'Y']);
  const parents = plan.parentsBySpace.s1;
  const keysByTitle = Object.fromEntries(
    Object.entries(plan.emptyNodesBySpace.s1).map(([key, node]) => [node.title, key]),
  );
  assert.equal(parents[keysByTitle.Y], keysByTitle.X);
  assert.equal(parents.g1, keysByTitle.Y);
});

test('planLegacyTitlePathMigration is idempotent for single-segment titles', () => {
  const plan = planLegacyTitlePathMigration({
    folderPathsBySpace: {},
    groupsBySpace: { s1: [group('g1', 'Plain')] },
    idFactory: () => 'node-x',
  });
  assert.deepEqual(plan.renamesBySpace.s1, []);
  assert.deepEqual(Object.keys(plan.emptyNodesBySpace.s1 ?? {}), []);
  assert.deepEqual(plan.parentsBySpace.s1 ?? {}, {});
});

test('planLegacyTitlePathMigration skips blank stored paths and handles spaces in isolation', () => {
  let counter = 0;
  const plan = planLegacyTitlePathMigration({
    folderPathsBySpace: { s1: ['', '   '], s2: ['Only'] },
    groupsBySpace: { s1: [group('g1', 'Plain')] },
    idFactory: () => `node-${counter++}`,
  });
  assert.deepEqual(plan.renamesBySpace.s1, []);
  const s2Nodes = Object.values(plan.emptyNodesBySpace.s2 || {}).map((node) => node.title);
  assert.deepEqual(s2Nodes, ['Only']);
  assert.deepEqual(plan.parentsBySpace.s2 ?? {}, {});
});

import { groupHierarchyId, resolveKeyParents, toHierarchyParents } from '../src/shared/group-tree.js';

test('groupHierarchyId prefers snapshot identity over the raw key', () => {
  assert.equal(groupHierarchyId({ key: 'group:9', snapshotGroupId: 'sg-a' }), 'sgid:sg-a');
  assert.equal(groupHierarchyId({ key: 'group:9' }), 'group:9');
  assert.equal(groupHierarchyId({ key: 'node:x' }), 'node:x');
  assert.equal(groupHierarchyId({ key: 'group:9', snapshotGroupId: '  ' }), 'group:9');
});

test('resolveKeyParents maps stored ids to current view keys and drops orphans', () => {
  const nodes = [
    { key: 'group:1', snapshotGroupId: 'sg-a', tabs: [] },
    { key: 'group:2', snapshotGroupId: 'sg-b', tabs: [] },
    { key: 'node:x', tabs: [] },
  ];
  const keyParents = resolveKeyParents(nodes, {
    'sgid:sg-b': 'sgid:sg-a',
    'node:x': 'sgid:sg-a',
    'sgid:sg-gone': 'sgid:sg-a',
    'sgid:sg-a': 'sgid:sg-a',
  });
  assert.deepEqual(keyParents, { 'group:2': 'group:1', 'node:x': 'group:1' });
});

test('toHierarchyParents converts drop plans into stored ids', () => {
  const nodes = [
    { key: 'group:1', snapshotGroupId: 'sg-a', tabs: [] },
    { key: 'group:2', tabs: [] },
  ];
  assert.deepEqual(
    toHierarchyParents(nodes, { 'group:2': 'group:1' }),
    { 'group:2': 'sgid:sg-a' },
  );
  // 不在视图里的键按原样保留（空节点键即身份）
  assert.deepEqual(
    toHierarchyParents(nodes, { 'node:y': 'group:1' }),
    { 'node:y': 'sgid:sg-a' },
  );
});

test('identity round-trip survives chrome id churn', () => {
  const before = [{ key: 'group:11', snapshotGroupId: 'sg-a', tabs: [] }];
  const stored = toHierarchyParents(before, { 'group:22': 'group:11' });
  // 折叠后 chrome id 再生：子组 22 获得身份 sg-b，父组 11 → 新键 group:99
  const after = [
    { key: 'group:99', snapshotGroupId: 'sg-a', tabs: [] },
    { key: 'group:55', snapshotGroupId: 'sg-b', tabs: [] },
  ];
  const keyParents = resolveKeyParents(after, { 'sgid:sg-b': 'sgid:sg-a' });
  assert.deepEqual(keyParents, { 'group:55': 'group:99' });
  assert.equal(stored['group:22'], 'sgid:sg-a');
});

test('identity helpers cover fallback and self-link branches', () => {
  const nodes = [{ key: 'group:1', snapshotGroupId: 'sg-a', tabs: [] }, { key: 'node:y', tabs: [] }];
  // 重复身份取首个；child/parent 相同跳过；空 views 全跳过
  assert.deepEqual(resolveKeyParents(nodes, {
    'sgid:sg-a': 'sgid:sg-a',
    'node:y': 'sgid:sg-a',
  }), { 'node:y': 'group:1' });
  assert.deepEqual(resolveKeyParents([], { 'sgid:sg-a': 'sgid:sg-a' }), {});
  // toHierarchyParents：视图内键→身份；视图外键原样保留；自引用跳过
  assert.deepEqual(toHierarchyParents(nodes, {
    'group:1': 'node:y',
    'node:y': 'group:1',
  }), { 'sgid:sg-a': 'node:y', 'node:y': 'sgid:sg-a' });
  const withSelf = toHierarchyParents(nodes, { 'group:1': 'group:1' });
  assert.deepEqual(withSelf, {});
  // groupHierarchyId 空键兜底
  assert.equal(groupHierarchyId({}), '');
  assert.deepEqual(resolveKeyParents(nodes, {}), {});
  assert.deepEqual(toHierarchyParents(nodes, {}), {});
});

test('identity helpers tolerate unknown ids in both directions', () => {
  const nodes = [{ key: 'group:1', snapshotGroupId: 'sg-a', tabs: [] }];
  // resolveKeyParents：父/子身份都不在视图里 → 丢弃（渲染时孤儿升根）
  assert.deepEqual(resolveKeyParents(nodes, { 'sgid:sg-x': 'sgid:sg-y' }), {});
  // toHierarchyParents：双方都是视图外键 → 原样保留（调用方保证域正确）
  assert.deepEqual(
    toHierarchyParents(nodes, { 'group:1': 'group:99' }),
    { 'sgid:sg-a': 'group:99' },
  );
  assert.deepEqual(
    toHierarchyParents(nodes, { 'group:1': 'group:1' }),
    {},
  );
});
