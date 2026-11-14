import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTitlePath,
  buildGroupTree,
  descendantKeysOf,
  hierarchyAnchorForNode,
  planHierarchyDrop,
  remapGroupParents,
  planLegacyTitlePathMigration,
  resolveHierarchyAnchorToKey,
  resolveHierarchyKeyParents,
  upgradeHierarchyParentAnchors,
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


import { nodeDepth, subtreeHeight } from '../src/shared/group-tree.js';

test('nodeDepth and subtreeHeight measure identity-free chains', () => {
  const parents = { b: 'a', c: 'b', x: 'z' };
  assert.equal(nodeDepth('a', parents), 1);
  assert.equal(nodeDepth('b', parents), 2);
  assert.equal(nodeDepth('c', parents), 3);
  assert.equal(nodeDepth('x', parents), 2);
  assert.equal(nodeDepth('missing', parents), 1);
  assert.equal(subtreeHeight('a', parents), 3);
  assert.equal(subtreeHeight('b', parents), 2);
  assert.equal(subtreeHeight('c', parents), 1);
  assert.equal(subtreeHeight('missing', parents), 1);
});

test('nodeDepth and subtreeHeight default to an empty parent map', () => {
  assert.equal(subtreeHeight('solo'), 1);
  const rootDrop = planHierarchyDrop({
    order: ['solo', 'x'],
    sourceRootKeys: ['x'],
    sourceAllKeys: ['x'],
    intent: 'root',
  });
  assert.equal(rootDrop.error, undefined);
  assert.deepEqual(rootDrop.order, ['solo', 'x']);
  assert.deepEqual(rootDrop.parents, {});
});

test('nodeDepth survives parent cycles', () => {
  assert.equal(nodeDepth('p', { p: 'q', q: 'p' }), 2);
  assert.equal(nodeDepth('q', { p: 'q', q: 'p' }), 2);
});

test('planHierarchyDrop enforces maxDepth for inside and sibling drops', () => {
  const base = { parents: { b: 'a' }, order: ['a', 'b', 'c', 'd'] };
  const insideOk = planHierarchyDrop({
    ...base, sourceRootKeys: ['c'], sourceAllKeys: ['c'], targetKey: 'b', intent: 'inside', maxDepth: 3,
  });
  assert.equal(insideOk.error, undefined);
  assert.equal(insideOk.parents.c, 'b');

  const tooDeep = planHierarchyDrop({
    parents: { b: 'a', c: 'b' },
    order: ['a', 'b', 'c', 'd'],
    sourceRootKeys: ['d'], sourceAllKeys: ['d'], targetKey: 'c', intent: 'inside', maxDepth: 3,
  });
  assert.equal(tooDeep.error, 'max-depth');

  const siblingOk = planHierarchyDrop({
    parents: { b: 'a', c: 'b' },
    order: ['a', 'b', 'c', 'd'],
    sourceRootKeys: ['d'], sourceAllKeys: ['d'], targetKey: 'c', intent: 'after', maxDepth: 3,
  });
  assert.equal(siblingOk.error, undefined);
  // d 与 c 同层（都是 b 的子，第 3 层）
  assert.equal(siblingOk.parents.d, 'b');

  const subtreeTooDeep = planHierarchyDrop({
    parents: { b: 'a', c: 'b' },
    order: ['a', 'b', 'c', 'd'],
    sourceRootKeys: ['a'], sourceAllKeys: ['a', 'b', 'c'], targetKey: 'd', intent: 'inside', maxDepth: 3,
  });
  assert.equal(subtreeTooDeep.error, 'max-depth');
});

test('hierarchyAnchorForNode prefers snapshot identity then stable keys then raw keys', () => {
  assert.equal(hierarchyAnchorForNode({ snapshotGroupId: 'group:u1', key: 'group:77' }), 'sgid:group:u1');
  assert.equal(hierarchyAnchorForNode({ key: 'node:abc' }), 'node:abc');
  assert.equal(hierarchyAnchorForNode({ key: 'vgroup:vg1' }), 'vgroup:vg1');
  assert.equal(hierarchyAnchorForNode({ key: 'group:77' }), 'group:77');
  assert.equal(hierarchyAnchorForNode({ key: 'snapshot:2:work:group:u1' }), 'snapshot:2:work:group:u1');
  assert.equal(hierarchyAnchorForNode({ key: 'ungrouped' }), '');
  assert.equal(hierarchyAnchorForNode(null), '');
});

test('resolveHierarchyKeyParents projects anchors to view keys and skips unresolved edges', () => {
  const bySnapshotGroupId = new Map([
    ['group:u1', 'snapshot:0:work:group:u1'],
    ['group:u2', 'group:44'],
  ]);
  const resolved = resolveHierarchyKeyParents({
    'sgid:group:u1': 'sgid:group:u2',
    'node:abc': 'sgid:group:u2',
    'snapshot:0:work:group:u1': 'vgroup:vg1',
    'sgid:group:missing': 'sgid:group:u1',
    'sgid:group:u1': 'sgid:group:u1',
  }, bySnapshotGroupId);
  assert.deepEqual(resolved, {
    'snapshot:0:work:group:u1': 'group:44',
    'node:abc': 'group:44',
    'snapshot:0:work:group:u1': 'vgroup:vg1',
  });
  // raw legacy keys pass through unchanged (dual-domain read)
  const legacy = resolveHierarchyKeyParents({ b: 'a' }, new Map());
  assert.deepEqual(legacy, { b: 'a' });
});

test('upgradeHierarchyParentAnchors upgrades raw keys idempotently and reports changes', () => {
  const anchorByKey = new Map([['group:77', 'sgid:group:u1']]);
  const first = upgradeHierarchyParentAnchors(
    { 'group:77': 'node:abc', 'snapshot:1:w:g:u9': 'group:77' },
    anchorByKey,
  );
  assert.equal(first.changed, true);
  assert.deepEqual(first.parents, {
    'sgid:group:u1': 'node:abc',
    'snapshot:1:w:g:u9': 'sgid:group:u1',
  });
  const second = upgradeHierarchyParentAnchors(first.parents, anchorByKey);
  assert.equal(second.changed, false);
  assert.deepEqual(second.parents, first.parents);
});

test('remapGroupParents replaces anchor endpoints and drops vanished keys', () => {
  // child sgid:old → sgid:new（父已消失 → 条目被删，渲染时升根）
  const vanishedParent = remapGroupParents({
    'sgid:group:old': 'sgid:group:parent',
  }, new Map([
    ['sgid:group:old', 'sgid:group:new'],
    ['sgid:group:parent', ''],
  ]));
  assert.deepEqual(vanishedParent, {});
  // node:abc → sgid:old → sgid:new：物化/合并后边随身份迁移
  const migrated = remapGroupParents({
    'node:abc': 'sgid:group:old',
  }, new Map([['sgid:group:old', 'sgid:group:new']]));
  assert.deepEqual(migrated, { 'node:abc': 'sgid:group:new' });
  // 自环被丢弃
  const selfLoop = remapGroupParents({
    'sgid:group:a': 'sgid:group:b',
  }, new Map([['sgid:group:b', 'sgid:group:a']]));
  assert.deepEqual(selfLoop, {});
});

test('anchor helpers handle empty and unresolvable inputs', () => {
  assert.equal(resolveHierarchyAnchorToKey(''), '');
  assert.equal(resolveHierarchyAnchorToKey('sgid:group:gone', new Map()), '');
  // parents 未提供 → 空投影
  assert.deepEqual(resolveHierarchyKeyParents(undefined, new Map()), {});
  // 父端点解析失败 → 该边不进投影（数据保留在存储域）
  assert.deepEqual(resolveHierarchyKeyParents({
    'group:44': 'sgid:group:missing-parent',
  }, new Map([['group:44', 'group:44']])), {});
  // 空端点在升级时被丢弃且报告变化
  const upgraded = upgradeHierarchyParentAnchors({
    'group:77': '',
    '': 'node:abc',
  }, new Map([['group:77', 'sgid:group:u1']]));
  assert.equal(upgraded.changed, true);
  assert.deepEqual(upgraded.parents, {});
});

test('anchor projection and upgrade tolerate explicit null parent maps', () => {
  assert.deepEqual(resolveHierarchyKeyParents(null, new Map()), {});
  const upgraded = upgradeHierarchyParentAnchors(null, new Map());
  assert.equal(upgraded.changed, false);
  assert.deepEqual(upgraded.parents, {});
});
