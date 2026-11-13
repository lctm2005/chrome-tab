# Group Hierarchy (真父子分组) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用状态层真父子关系取代标题路径编码的文件夹壳：父组卡同时容纳自身 tab 与子组卡，拖拽只写状态不改标题，并根除指纹/checkpoint 两类报错。

**Architecture:** 新共享纯函数模块 `src/shared/group-tree.js`（树构建/拖拽规划/键重映射/迁移规划）+ `state.js` 新键 `groupParents`/`emptyNodes`；sidepanel.js 渲染递归组卡、拖拽走纯状态事务、菜单/CRUD 改节点制；`organization-plan.js` 指纹去易变字段；`tab-lifecycle.js` 新增 checkpoint 治愈规划纯函数。

**Tech Stack:** ES modules（无构建步骤）、node:test、e2e = `scripts/e2e-extension-smoke.mjs`（真实 Chrome + CDP）。

## Global Constraints

- shared 与 background 单测覆盖率门槛 100% 行/分支（`npm run test:coverage:node`）；新共享模块必须带直接分支测试。
- 状态单键整写：所有持久化经 `saveState`（Web Lock 内）；拖拽 apply 不发 Chrome 消息。
- MV3 禁外部脚本；不改 `manifest.json` 权限（无需动 CHROMEWEBSTORE.md/PRIVACY.md）。
- 语法检查：改动后跑 `npm run check`（含 `node --check sidepanel.js`）。
- 缓存戳：本计划完成后 sidepanel.html 的 `?v=32` → `?v=33`。
- 测试种子 URL 必须不重定向（指纹含 url 全等）。
- e2e 驱动断言：嵌套节点不能只在 `#groupsList` 顶层找，要用父容器 children 断言。

---

### Task 1: `src/shared/group-tree.js` 纯函数模块

**Files:**
- Create: `src/shared/group-tree.js`
- Test: `tests/group-tree.test.js`

**Interfaces:**
- Produces（后续任务全部依赖）:
  - `parseTitlePath(title) -> string[]`（按 `/` 拆段、去空、去相邻重复）
  - `buildGroupTree(groups, parents) -> node[]`（node = `{...group, children: node[]}`；孤儿/环安全升根）
  - `descendantKeysOf(key, parents) -> Set<string>`（不含自身）
  - `planHierarchyDrop({ parents, order, sourceRootKeys, sourceAllKeys, targetKey, intent }) -> { parents, order } | { error, message }`（intent: `'inside'|'before'|'after'|'root'`）
  - `remapGroupParents(parents, replacements) -> object`
  - `planLegacyTitlePathMigration({ folderPathsBySpace, groupsBySpace, idFactory }) -> { emptyNodesBySpace, parentsBySpace, renamesBySpace }`

- [ ] **Step 1: 写失败测试** `tests/group-tree.test.js`

```js
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
  assert.deepEqual(parseTitlePath('Single'), ['Single']);
});

test('buildGroupTree nests children under parents preserving flat order', () => {
  const groups = [group('a'), group('b'), group('c')];
  const tree = buildGroupTree(groups, { b: 'a' });
  assert.equal(tree.length, 2);
  assert.equal(tree[0].key, 'a');
  assert.deepEqual(tree[0].children.map((n) => n.key), ['b']);
  assert.equal(tree[1].key, 'c');
});

test('buildGroupTree promotes orphans and survives parent cycles', () => {
  const groups = [group('x'), group('y')];
  const tree = buildGroupTree(groups, { x: 'missing', y: 'x' });
  // x 的父不在视图 → x 升根；y 挂在 x 下
  assert.equal(tree.length, 1);
  assert.equal(tree[0].key, 'x');
  assert.deepEqual(tree[0].children.map((n) => n.key), ['y']);
  const cyclic = buildGroupTree([group('p'), group('q')], { p: 'q', q: 'p' });
  assert.equal(cyclic.length, 2);
});

test('descendantKeysOf returns transitive descendants excluding self', () => {
  const parents = { b: 'a', c: 'b', d: 'z' };
  assert.deepEqual([...descendantKeysOf('a', parents)].sort(), ['b', 'c']);
  assert.deepEqual([...descendantKeysOf('d', parents)], []);
});

test('planHierarchyDrop inside nests source under target', () => {
  const parents = {};
  const order = ['a', 'b', 'c'];
  const result = planHierarchyDrop({
    parents, order, sourceRootKeys: ['c'], sourceAllKeys: ['c'], targetKey: 'a', intent: 'inside',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.parents.c, 'a');
  assert.deepEqual(result.order, ['a', 'c', 'b']);
});

test('planHierarchyDrop before/after re-parents to target parent', () => {
  const parents = { b: 'a' };
  const order = ['a', 'b', 'c'];
  const after = planHierarchyDrop({
    parents, order, sourceRootKeys: ['c'], sourceAllKeys: ['c'], targetKey: 'b', intent: 'after',
  });
  assert.equal(after.parents.c, 'a');
  assert.deepEqual(after.order, ['a', 'b', 'c']);
  const before = planHierarchyDrop({
    parents: { b: 'a' }, order: ['a', 'b', 'c'],
    sourceRootKeys: ['c'], sourceAllKeys: ['c'], targetKey: 'b', intent: 'before',
  });
  assert.deepEqual(before.order, ['a', 'c', 'b']);
  assert.equal(before.parents.c, 'a');
});

test('planHierarchyDrop root appends at root level', () => {
  const parents = { b: 'a' };
  const result = planHierarchyDrop({
    parents, order: ['a', 'b', 'c'],
    sourceRootKeys: ['b'], sourceAllKeys: ['b'], targetKey: '', intent: 'root',
  });
  assert.equal(result.parents.b, undefined);
  assert.deepEqual(result.order, ['a', 'c', 'b']);
});

test('planHierarchyDrop moves whole subtree preserving internal DFS order', () => {
  const parents = { child: 'src', grand: 'child', other: 'tgt' };
  const order = ['tgt', 'other', 'src', 'child', 'grand'];
  const result = planHierarchyDrop({
    parents, order,
    sourceRootKeys: ['src'], sourceAllKeys: ['src', 'child', 'grand'],
    targetKey: 'tgt', intent: 'inside',
  });
  assert.equal(result.parents.src, 'tgt');
  assert.equal(result.parents.child, 'src');
  assert.deepEqual(result.order, ['tgt', 'src', 'child', 'grand', 'other']);
});

test('planHierarchyDrop rejects cycles, self targets and no-ops', () => {
  const parents = { b: 'a' };
  const cycle = planHierarchyDrop({
    parents, order: ['a', 'b'], sourceRootKeys: ['a'], sourceAllKeys: ['a', 'b'],
    targetKey: 'b', intent: 'inside',
  });
  assert.equal(cycle.error, 'cycle');
  const self = planHierarchyDrop({
    parents, order: ['a', 'b'], sourceRootKeys: ['a'], sourceAllKeys: ['a'],
    targetKey: 'a', intent: 'inside',
  });
  assert.equal(self.error, 'self');
  const noop = planHierarchyDrop({
    parents: { b: 'a' }, order: ['a', 'b'], sourceRootKeys: ['b'], sourceAllKeys: ['b'],
    targetKey: 'a', intent: 'inside',
  });
  assert.equal(noop.error, 'no-op');
  const missing = planHierarchyDrop({
    parents, order: ['a', 'b'], sourceRootKeys: [], sourceAllKeys: [],
    targetKey: 'a', intent: 'inside',
  });
  assert.equal(missing.error, 'empty-source');
});

test('remapGroupParents rewrites child and parent keys and drops lost parents', () => {
  const parents = { b: 'a', c: 'b', d: 'gone' };
  const next = remapGroupParents(parents, new Map([['a', 'a2'], ['b', 'b2']]));
  assert.equal(next.b, 'a2');
  assert.equal(next.c, 'b2');
  assert.equal(next.d, undefined);
});

test('planLegacyTitlePathMigration unwinds " / " titles and stored paths', () => {
  let counter = 0;
  const idFactory = () => `node-${counter++}`;
  const plan = planLegacyTitlePathMigration({
    folderPathsBySpace: { s1: ['AI / New Group'] },
    groupsBySpace: { s1: [group('g1', 'AI'), group('g2', 'AI / Claude')] },
    idFactory,
  });
  // 组 g2 拆为父链：AI 与 g1 重名 → 挂靠 g1；g2 叶标题改 Claude
  assert.deepEqual(plan.renamesBySpace.s1, [{ key: 'g2', nextTitle: 'Claude' }]);
  assert.equal(plan.parentsBySpace.s1.g2, 'g1');
  // folderPaths 的 "AI / New Group"：AI 挂靠 g1，New Group 为空节点挂在 g1 下
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
  const titles = Object.values(plan.emptyNodesBySpace.s1).map((n) => n.title).sort();
  assert.deepEqual(titles, ['X', 'Y']);
  const parents = plan.parentsBySpace.s1;
  const xKey = Object.keys(plan.emptyNodesBySpace.s1).find((k) => plan.emptyNodesBySpace.s1[k].title === 'X');
  const yKey = Object.keys(plan.emptyNodesBySpace.s1).find((k) => plan.emptyNodesBySpace.s1[k].title === 'Y');
  assert.equal(parents[yKey], xKey);
  assert.equal(parents.g1, yKey);
});

test('planLegacyTitlePathMigration is idempotent for single-segment titles', () => {
  const plan = planLegacyTitlePathMigration({
    folderPathsBySpace: {},
    groupsBySpace: { s1: [group('g1', 'Plain')] },
    idFactory: () => 'node-x',
  });
  assert.deepEqual(plan.renamesBySpace.s1, []);
  assert.deepEqual(Object.keys(plan.emptyNodesBySpace.s1 ?? {}), []);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/group-tree.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/shared/group-tree.js`**

```js
// State-backed group hierarchy primitives. Hierarchy lives in
// state.groupParents; titles stay single-segment. All functions are pure.

export function parseTitlePath(title) {
  const parts = String(title || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.filter((part, index) => index === 0 || part !== parts[index - 1]);
}

// parent 键必须出现在视图里才算有效父级；链上出现环/缺失一律把该子树升根，
// 渲染永不因脏 parents 数据挂死。
export function buildGroupTree(groups, parents = {}) {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const children = new Map(groups.map((group) => [group.key, []]));
  const resolvedRootKeys = new Set();
  const resolveParentKey = (key) => {
    const seen = new Set([key]);
    let current = key;
    while (parents[current]) {
      if (seen.has(parents[current]) || !byKey.has(parents[current])) return null;
      seen.add(parents[current]);
      current = parents[current];
    }
    return current === key ? null : current;
  };
  for (const group of groups) {
    const parentKey = resolveParentKey(group.key);
    if (parentKey) {
      children.get(parentKey).push(group);
    } else {
      resolvedRootKeys.add(group.key);
    }
  }
  const buildNode = (group) => ({
    ...group,
    children: children.get(group.key).map(buildNode),
  });
  return groups.filter((group) => resolvedRootKeys.has(group.key)).map(buildNode);
}

export function descendantKeysOf(key, parents = {}) {
  const descendants = new Set();
  const collect = (parentKey) => {
    for (const [childKey, parent] of Object.entries(parents)) {
      if (parent !== parentKey || descendants.has(childKey)) continue;
      descendants.add(childKey);
      collect(childKey);
    }
  };
  collect(key);
  return descendants;
}

// order 是全节点 DFS 扁平序（父在子前）。插入保持 DFS 不变量：inside 插到
// target 子树块之后；before 插到 target 块前；after 插到 target 块后；root 追加。
export function planHierarchyDrop({
  parents = {},
  order = [],
  sourceRootKeys = [],
  sourceAllKeys = [],
  targetKey = '',
  intent = 'inside',
}) {
  if (!sourceAllKeys.length) return { error: 'empty-source', message: 'Nothing is being dragged.' };
  const sourceSet = new Set(sourceAllKeys);
  if (intent !== 'root') {
    if (!targetKey) return { error: 'missing-target', message: 'The drop target disappeared. Try the drag again.' };
    if (sourceSet.has(targetKey)) {
      return { error: 'self', message: 'A group cannot be dropped into itself.' };
    }
    if (descendantKeysOf(sourceRootKeys[0], parents).has(targetKey) ||
        sourceRootKeys.some((rootKey) => descendantKeysOf(rootKey, parents).has(targetKey))) {
      return { error: 'cycle', message: 'A group cannot be dropped inside its own subgroup.' };
    }
    if (intent === 'inside' && parents[sourceRootKeys[0]] === targetKey &&
        !orderSomeBetween(order, targetKey, sourceRootKeys[0])) {
      return { error: 'no-op', message: 'The group is already there.' };
    }
  }

  const nextParents = { ...parents };
  for (const rootKey of sourceRootKeys) delete nextParents[rootKey];
  if (intent === 'inside') nextParents[sourceRootKeys[0]] = targetKey;
  if (intent === 'before' || intent === 'after') nextParents[sourceRootKeys[0]] = parents[targetKey] || undefined;
  if (nextParents[sourceRootKeys[0]] === undefined) delete nextParents[sourceRootKeys[0]];

  const working = order.filter((key) => !sourceSet.has(key));
  const sourceBlock = order.filter((key) => sourceSet.has(key));
  let insertAt;
  if (intent === 'root' || !working.includes(targetKey)) {
    insertAt = working.length;
  } else if (intent === 'before') {
    insertAt = working.indexOf(targetKey);
  } else {
    // inside / after：target 子树块（target + 其 DFS 中的后代连续段）末尾
    insertAt = subtreeEndIndex(working, targetKey, nextParents);
  }
  working.splice(insertAt, 0, ...sourceBlock);
  return { parents: nextParents, order: working };
}

function orderSomeBetween(order, ancestorKey, key) {
  // no-op 判定只关心「已是直接子级且位于其子树末尾」这一种等价布局之外都允许重排
  const chain = [...descendantKeysOf(ancestorKey, {})];
  return chain.includes(key);
}

function subtreeEndIndex(working, targetKey, nextParents) {
  const descendants = descendantKeysOf(targetKey, nextParents);
  let index = working.indexOf(targetKey) + 1;
  while (index < working.length && descendants.has(working[index])) index += 1;
  return index;
}

export function remapGroupParents(parents = {}, replacements = new Map()) {
  if (!(replacements instanceof Map)) return { ...parents };
  const next = {};
  for (const [childKey, parentKey] of Object.entries(parents)) {
    const nextChild = replacements.get(childKey) || childKey;
    const nextParent = replacements.get(parentKey) || parentKey;
    if (nextChild === nextParent) continue;
    if (!nextParent) continue;
    next[nextChild] = nextParent;
  }
  return next;
}

// 纯规划：旧 folderPaths 路径与 " / " 标题 → 空节点 + parents + 改名清单。
// 应用（Chrome 写入 / 快照改写）由 sidepanel 执行；本函数零副作用。
export function planLegacyTitlePathMigration({
  folderPathsBySpace = {},
  groupsBySpace = {},
  idFactory = () => `node:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`,
}) {
  const emptyNodesBySpace = {};
  const parentsBySpace = {};
  const renamesBySpace = {};
  for (const spaceId of new Set([...Object.keys(folderPathsBySpace), ...Object.keys(groupsBySpace)])) {
    const groups = groupsBySpace[spaceId] || [];
    const titleToKey = new Map();
    for (const group of groups) {
      const parts = parseTitlePath(group.title);
      if (parts.length === 1) titleToKey.set(parts[0].toLowerCase(), group.key);
    }
    const ensureNodeChain = (parts) => {
      let previousKey = '';
      for (const part of parts) {
        const existing = titleToKey.get(part.toLowerCase());
        if (existing) {
          previousKey = existing;
          continue;
        }
        const nodeKey = idFactory();
        emptyNodesBySpace[spaceId] = {
          ...emptyNodesBySpace[spaceId],
          [nodeKey]: { title: part, color: 'blue' },
        };
        if (previousKey) {
          parentsBySpace[spaceId] = { ...parentsBySpace[spaceId], [nodeKey]: previousKey };
        }
        titleToKey.set(part.toLowerCase(), nodeKey);
        previousKey = nodeKey;
      }
      return previousKey;
    };
    for (const path of folderPathsBySpace[spaceId] || []) {
      const parts = parseTitlePath(path);
      if (parts.length === 0) continue;
      ensureNodeChain(parts.slice(0, -1));
      const leafParent = ensureNodeChain([parts.at(-1)]);
      if (leafParent && parentsBySpace[spaceId]) delete parentsBySpace[spaceId][leafParent];
      // 叶段本身是叶子节点：若它已由 ensureNodeChain 挂到 previousKey 下则保留
    }
    for (const group of groups) {
      const parts = parseTitlePath(group.title);
      if (parts.length <= 1) continue;
      const parentKey = ensureNodeChain(parts.slice(0, -1));
      if (parentKey) {
        parentsBySpace[spaceId] = { ...parentsBySpace[spaceId], [group.key]: parentKey };
      }
      renamesBySpace[spaceId] = [
        ...(renamesBySpace[spaceId] || []),
        { key: group.key, nextTitle: parts.at(-1) },
      ];
    }
  }
  return { emptyNodesBySpace, parentsBySpace, renamesBySpace };
}
```

- [ ] **Step 4: 跑测试到全绿**

Run: `node --test tests/group-tree.test.js`
Expected: PASS（全部用例）。若 `planHierarchyDrop` 的 no-op/子树插入与用例断言不符，修实现不改断言。

- [ ] **Step 5: 覆盖率门槛**

Run: `npm run test:coverage:shared`
Expected: 100% statements/branches/functions/lines（新文件无未覆盖分支；不达标补直接分支测试）。

- [ ] **Step 6: Commit**

```bash
git add src/shared/group-tree.js tests/group-tree.test.js
git commit -m "feat: shared group-tree hierarchy primitives"
```

---

### Task 2: `state.js` schema（groupParents / emptyNodes）+ 迁移接线

**Files:**
- Modify: `src/shared/state.js`（defaults 两处：~37-46、~88；merge 两处：~241-255）
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: Task 1 的 `planLegacyTitlePathMigration`（本任务只加 schema 键；迁移应用在 sidepanel Task 6）。
- Produces: `state.groupParents` = `{ [spaceId]: { [childKey]: parentKey } }`；`state.emptyNodes` = `{ [spaceId]: { [nodeKey]: { title, color } } }`；`state.folderPaths` 保留默认 `{}`（只读兼容，不再写入）。

- [ ] **Step 1: 失败测试**（追加到 `tests/state.test.js`）

```js
test('normalizeState defaults and merges groupParents and emptyNodes per space', () => {
  const stored = {
    spaces: [{ id: 'work', name: 'Work' }],
    activeSpaceId: 'work',
    groupParents: { work: { 'group:9': 'group:7' } },
    emptyNodes: { work: { 'node:1': { title: 'New Group', color: 'blue' } } },
  };
  const state = normalizeStateForTest(stored);
  assert.deepEqual(state.groupParents, { work: { 'group:9': 'group:7' } });
  assert.deepEqual(state.emptyNodes, { work: { 'node:1': { title: 'New Group', color: 'blue' } } });
  const empty = normalizeStateForTest({});
  assert.deepEqual(empty.groupParents, {});
  assert.deepEqual(empty.emptyNodes, {});
  assert.deepEqual(empty.folderPaths, {});
});
```

（`normalizeStateForTest` 用该测试文件既有的 normalize 入口别名；若文件内没有则 `import { normalizeState } from '../src/shared/state.js'` 并以实际导出名替换。）

- [ ] **Step 2: 跑失败** — `node --test tests/state.test.js` → FAIL
- [ ] **Step 3: 实现** — 在 `state.js` 两段 defaults 各加 `groupParents: {}`、`emptyNodes: {}`；两段 merge 各加（模式照抄 `folderPaths` 行）：

```js
groupParents: compatibleSpaceModel && stored.groupParents && typeof stored.groupParents === 'object'
  ? { ...defaults.groupParents, ...stored.groupParents }
  : defaults.groupParents,
emptyNodes: compatibleSpaceModel && stored.emptyNodes && typeof stored.emptyNodes === 'object'
  ? { ...defaults.emptyNodes, ...stored.emptyNodes }
  : defaults.emptyNodes,
```

- [ ] **Step 4: 全绿** — `node --test tests/state.test.js` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: groupParents/emptyNodes state schema"`

---

### Task 3: 组织指纹去易变字段（修报错 2）

**Files:**
- Modify: `src/shared/organization-plan.js:755-792`（`fingerprintLiveGroups`）、`ORGANIZATION_FINGERPRINT_VERSION`（文件顶部常量）
- Test: `tests/organization-plan.test.js`（新建）

**Interfaces:**
- Produces: 指纹 v2 —— 每 tab 仅 `tabId`（alias 感知）、`url`、`pinned`、`order`、`windowId`；组级 `title/color/collapsed` 不变。

- [ ] **Step 1: 失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrganizationCandidates } from '../src/shared/organization-plan.js';

function liveGroupsFixture(title = 'Alpha') {
  return [{
    key: 'group:1', title, color: 'blue', collapsed: false,
    tabs: [{ id: 10, title: 'Loading…', url: 'https://a.test/x', pinned: false, windowId: 1, index: 0 }],
  }];
}

test('organization fingerprint ignores tab title drift', () => {
  const before = buildOrganizationCandidates({ liveGroups: liveGroupsFixture(), snapshot: { version: 1, groups: [] } });
  const drifted = liveGroupsFixture();
  drifted[0].tabs[0].title = 'Real Page Title — Loaded';
  const after = buildOrganizationCandidates({ liveGroups: drifted, snapshot: { version: 1, groups: [] } });
  assert.equal(after.fingerprint, before.fingerprint);
});

test('organization fingerprint still reacts to url / order / grouping changes', () => {
  const base = buildOrganizationCandidates({ liveGroups: liveGroupsFixture(), snapshot: { version: 1, groups: [] } });
  const urlMoved = liveGroupsFixture();
  urlMoved[0].tabs[0].url = 'https://a.test/y';
  assert.notEqual(buildOrganizationCandidates({ liveGroups: urlMoved, snapshot: { version: 1, groups: [] } }).fingerprint, base.fingerprint);
  const reordered = liveGroupsFixture();
  reordered[0].tabs[0].index = 3;
  assert.notEqual(buildOrganizationCandidates({ liveGroups: reordered, snapshot: { version: 1, groups: [] } }).fingerprint, base.fingerprint);
});
```

- [ ] **Step 2: 失败** — `node --test tests/organization-plan.test.js` → FAIL（title 变化改变了指纹）
- [ ] **Step 3: 实现** — `fingerprintLiveGroups` 的 tab `value` 对象删去 `title`、`displayTitle`、`panelTitle` 三行；`ORGANIZATION_FINGERPRINT_VERSION` 常量 `v1` → `v2`。
- [ ] **Step 4: 全绿 + 回归** — `node --test tests/organization-plan.test.js` PASS；`node --test tests/` 全量确认无其他用例依赖旧指纹值。
- [ ] **Step 5: Commit** — `feat: drop volatile tab titles from organization fingerprint (v2)`

---

### Task 4: lifecycle 绑定治愈规划（修报错 1）

**Files:**
- Modify: `src/shared/tab-lifecycle.js`（新增导出）
- Test: `tests/tab-lifecycle.test.js`（追加）

**Interfaces:**
- Produces: `planStaleLifecycleBindingHeal({ snapshotTabId, snapshotGroups, candidateSnapshotGroupId }) -> { action: 'keep'|'heal'|'clear', snapshotGroupId }`
  - `keep`：当前快照里有唯一组包含该行（现状路径，不调用）。
  - `heal`：candidate.source 的 snapshotGroupId 仍存在于快照 → 绑定改指该组。
  - `clear`：两边都失联 → 清 stale 绑定，行退化为未保存 live 行。

- [ ] **Step 1: 失败测试**（追加到 tab-lifecycle.test.js）

```js
import { planStaleLifecycleBindingHeal } from '../src/shared/tab-lifecycle.js';

test('planStaleLifecycleBindingHeal keeps unique matches, heals by candidate group, clears otherwise', () => {
  const snapshotGroups = [
    { snapshotGroupId: 'g-docs', tabs: [{ snapshotTabId: 'row-1' }] },
    { snapshotGroupId: 'g-old', tabs: [{ snapshotTabId: 'row-orphan' }] },
  ];
  assert.equal(planStaleLifecycleBindingHeal({ snapshotTabId: 'row-1', snapshotGroups }).action, 'keep');
  assert.deepEqual(
    planStaleLifecycleBindingHeal({ snapshotTabId: 'row-orphan', snapshotGroups, candidateSnapshotGroupId: 'g-old' }),
    { action: 'heal', snapshotGroupId: 'g-old' },
  );
  assert.deepEqual(
    planStaleLifecycleBindingHeal({ snapshotTabId: 'row-orphan', snapshotGroups, candidateSnapshotGroupId: 'g-gone' }),
    { action: 'clear', snapshotGroupId: '' },
  );
  assert.deepEqual(
    planStaleLifecycleBindingHeal({ snapshotTabId: '', snapshotGroups }),
    { action: 'clear', snapshotGroupId: '' },
  );
});
```

- [ ] **Step 2: 失败** — FAIL（导出不存在）
- [ ] **Step 3: 实现**（tab-lifecycle.js 追加）

```js
export function planStaleLifecycleBindingHeal({
  snapshotTabId = '',
  snapshotGroups = [],
  candidateSnapshotGroupId = '',
}) {
  const rowId = String(snapshotTabId || '').trim();
  if (rowId) {
    const owners = (snapshotGroups || []).filter((group) => (group?.tabs || []).some((tab) => (
      String(tab?.snapshotTabId || '').trim() === rowId
    )));
    if (owners.length === 1) {
      return { action: 'keep', snapshotGroupId: String(owners[0].snapshotGroupId || '') };
    }
    const candidateId = String(candidateSnapshotGroupId || '').trim();
    const candidate = candidateId
      ? (snapshotGroups || []).find((group) => String(group?.snapshotGroupId || '') === candidateId)
      : null;
    if (candidate) return { action: 'heal', snapshotGroupId: candidateId };
  }
  return { action: 'clear', snapshotGroupId: '' };
}
```

- [ ] **Step 4: 全绿** + `npm run test:coverage:shared`
- [ ] **Step 5: Commit** — `feat: heal plan for stale snapshot lifecycle bindings`

---

### Task 5: 快照清退防线（保存行消失的上游根因）

**Files:**
- Modify: `src/shared/space-snapshot.js`（新增导出 `snapshotGroupHasLiveBoundRows`）
- Modify: `sidepanel.js` `replaceActiveSpaceSnapshotGroups`（:7362-7372 的 filter）与 `dormantGroupsFromSnapshot` 的 filter（:2261-2264）不动；只改 replace 的过滤
- Test: `tests/space-snapshot.test.js`（追加）

**Interfaces:**
- Consumes: live 绑定行 id 集合由 sidepanel 传入（`new Set(Object.values(state.tabLifecycle).map(b => String(b.snapshotTabId)))`）。
- Produces: `snapshotGroupHasLiveBoundRows(group, liveBoundSnapshotTabIds) -> boolean`

- [ ] **Step 1: 失败测试**

```js
test('snapshotGroupHasLiveBoundRows detects groups whose rows are still live-bound', () => {
  const group = { title: 'Docs', tabs: [{ snapshotTabId: 'row-1' }, { snapshotTabId: 'row-2' }] };
  assert.equal(snapshotGroupHasLiveBoundRows(group, new Set(['row-1'])), true);
  assert.equal(snapshotGroupHasLiveBoundRows(group, new Set(['row-other'])), false);
  assert.equal(snapshotGroupHasLiveBoundRows(group, new Set()), false);
});
```

- [ ] **Step 2: 失败 → Step 3: 实现**

```js
export function snapshotGroupHasLiveBoundRows(group = {}, liveBoundSnapshotTabIds = new Set()) {
  if (!(liveBoundSnapshotTabIds instanceof Set) || liveBoundSnapshotTabIds.size === 0) return false;
  return (group?.tabs || []).some((tab) => liveBoundSnapshotTabIds.has(String(tab?.snapshotTabId || '').trim()));
}
```

- Step 3b: `sidepanel.js` `replaceActiveSpaceSnapshotGroups` 的 groups filter 改为：

```js
const liveBoundRows = new Set(Object.values(state.tabLifecycle || {})
  .map((binding) => String(binding?.snapshotTabId || '').trim())
  .filter(Boolean));
groups: groups.filter((group) => (
  snapshotGroupShouldPersist(baseSnapshot, group) ||
  snapshotGroupHasLiveBoundRows(group, liveBoundRows)
)),
```

（import 行加 `snapshotGroupHasLiveBoundRows`。）

- [ ] **Step 4: 全绿 → Step 5: Commit** — `fix: never purge snapshot groups whose rows are still live-bound`

---

### Task 6: sidepanel 载入迁移 + checkpoint 治愈接线

**Files:**
- Modify: `sidepanel.js`
  - 新增 `applyLegacyHierarchyMigration()`（在 `loadState`/首次 `syncStateFromStorage` 后、首帧 `render()` 前调用一次，`sessionStorage` 标记防重跑）
  - `checkpointAutoGroupLifecycleBindings`（:9183-9234）：`uniqueSnapshotGroupForTabId` 未命中分支改走 `planStaleLifecycleBindingHeal`
- Test: e2e（Task 10）；单测覆盖在 Task 1/4 已完成（sidepanel 只做接线）

- [ ] **Step 1: checkpoint 治愈** — 把 :9202-9218 的 throw 分支替换为：

```js
if (!currentTab || !isGroupedTab(currentTab) || !binding || !snapshotTabId) {
  throw new Error( /* 原 missing 前置条件分支保留：live 行/tab 缺失仍中止 */ );
}
const heal = planStaleLifecycleBindingHeal({
  snapshotTabId,
  snapshotGroups,
  candidateSnapshotGroupId: validSnapshotLifecycleId(candidate?.source?.snapshot?.snapshotGroupId),
});
if (heal.action === 'clear') {
  console.warn(`Stale saved-row binding healed by clear for "${plannedGroup.title}": ${snapshotTabId}`);
  state.tabLifecycle[liveTabId] = { ...binding, snapshotGroupId: '', snapshotTabId: '', provisional: true };
  continue;
}
const targetSnapshotGroupId = heal.action === 'heal'
  ? heal.snapshotGroupId
  : validSnapshotLifecycleId(matchingSnapshotGroup?.snapshotGroupId);
```

（原 `matches 0` throw 仅在 `!currentTab || !isGroupedTab(currentTab) || !binding || !snapshotTabId` 时保留；import 行加 `planStaleLifecycleBindingHeal`。）

- [ ] **Step 2: 迁移应用**

```js
async function applyLegacyHierarchyMigration() {
  if (sessionStorage.getItem('spaceTabsHierarchyMigrated') === '1') return;
  try {
    const plan = planLegacyTitlePathMigration({
      folderPathsBySpace: state.folderPaths || {},
      groupsBySpace: Object.fromEntries(state.spaces.map((space) => [space.id, buildSpaceViewForSpace(space.id)])),
    });
    for (const spaceId of Object.keys(plan.emptyNodesBySpace)) {
      state.emptyNodes[spaceId] = { ...(state.emptyNodes[spaceId] || {}), ...plan.emptyNodesBySpace[spaceId] };
    }
    for (const spaceId of Object.keys(plan.parentsBySpace)) {
      state.groupParents[spaceId] = { ...(state.groupParents[spaceId] || {}), ...plan.parentsBySpace[spaceId] };
    }
    const renames = plan.renamesBySpace || {};
    for (const [spaceId, entries] of Object.entries(renames)) {
      for (const { key, nextTitle } of entries) {
        const group = buildSpaceViewForSpace(spaceId).find((item) => item.key === key);
        if (!group) continue;
        if (group.dormant) renameDormantSnapshotGroup(group, nextTitle);
        else if (!isVirtualGroupKey(group.key)) {
          const groupId = groupIdFromKey(group.key);
          if (groupId === null) continue;
          await send('groups:update', { groupId, update: { title: nextTitle } }).catch(() => null);
          logicalChromeGroupTitles.set(groupId, normalizeGroupTitle(nextTitle, 'Group'));
        }
      }
    }
    for (const spaceId of Object.keys(state.folderPaths || {})) state.folderPaths[spaceId] = [];
    await saveState({ persistWindowState: false });
  } catch (error) {
    console.error('Hierarchy migration failed; leaving titles as-is.', error);
  } finally {
    sessionStorage.setItem('spaceTabsHierarchyMigrated', '1');
  }
}
```

调用点：`loadState` 成功分支末尾 `await applyLegacyHierarchyMigration();`（一次即可；失败回退为标题原样）。

- [ ] **Step 3:** `npm run check` → PASS；`node --test tests/` 全量 PASS
- [ ] **Step 4: Commit** — `feat: apply legacy hierarchy migration and heal stale auto-group checkpoints`

---

### Task 7: 渲染树改造（去文件夹壳）

**Files:**
- Modify: `sidepanel.js`
  - `renderGroups`（:2267-2307）：删 `createFolderTree`/`storedFolderPathsForSpace`/`groupContextsFromFolderTree`/`groupDragContextsFromFolderTree`/`folderGroupContextFingerprint`/`createFolderTreeNode`/`createFolderSection`/`createFolderTabs`/`toggleFolder`/`handleFolderHeaderClick`/`folderContextFromHeader`/`folderIconSvg`/`folderOpenIconSvg`/`groupFolderIcon` 派生树用法
  - 新增 `visibleHierarchyNodes(spaceId)`（spaceView 组 + `state.emptyNodes[spaceId]` 合成节点，按 `groupOrder` DFS 排）与 `renderHierarchy()`
  - `createGroupCard(group, depth, childNodes)`：头部 + tab 列表 + `children` 容器（`.group-children`，`--group-depth: depth`）
- Modify: `sidepanel.css`（`.group-children` 缩进、`.group-card.empty-node .tab-list:empty::after{content:"Drop tabs or groups here"}`、删除 `.folder-*` 规则）
- Test: e2e Task 10

- [ ] **Step 1: 节点合成与渲染**

```js
function hierarchyParentsForSpace(spaceId = state.activeSpaceId) {
  return state.groupParents?.[spaceId] || {};
}

function visibleHierarchyNodes(spaceId = state.activeSpaceId) {
  const parents = hierarchyParentsForSpace(spaceId);
  const emptyNodes = state.emptyNodes?.[spaceId] || {};
  const order = state.groupOrder?.[spaceId] || [];
  const synthetic = Object.entries(emptyNodes).map(([key, node]) => ({
    key,
    id: key,
    title: node.title || 'Group',
    displayTitle: node.title || 'Group',
    color: node.color || 'blue',
    collapsed: Boolean(state.collapsedGroups[key]),
    dormant: false,
    emptyNode: true,
    tabs: [],
    spaceId,
  }));
  const nodes = [...spaceView.filter((group) => group.key !== 'ungrouped'), ...synthetic]
    .sort((left, right) => orderIndex(order, left.key) - orderIndex(order, right.key));
  return { nodes, parents };
}

function orderIndex(order, key) {
  const index = order.indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
```

`renderGroups` 主体改为：

```js
const { nodes, parents } = visibleHierarchyNodes();
const tree = buildGroupTree(nodes, parents);
renderedGroupContexts = new Map(nodes.map((node) => [node.key, node]));
renderedGroupDragContexts = new Map(nodes.map((node) => [node.key, {
  type: 'group', key: node.key, groupKeys: [node.key, ...descendantKeysOf(node.key, parents)],
}]));
const groupCards = tree.map((node) => createGroupCard(node, 0));
if (ungrouped) groupCards.push(createUngroupedSection(ungrouped));
els.groupsList.replaceChildren(...groupCards);
```

`createGroupCard(group, depth, children = [])`：现 `createGroupCard` 基础上（保留 header/tab-list/拖拽绑定）追加：

```js
card.style.setProperty('--group-depth', String(depth));
if (!group.collapsed && children.length) {
  const childrenWrap = document.createElement('div');
  childrenWrap.className = 'group-children';
  childrenWrap.replaceChildren(...children.map((child) => createGroupCard(child, depth + 1)));
  card.append(childrenWrap);
}
if (group.emptyNode) {
  card.classList.add('empty-node');
  // 空节点：可接 tab 拖入（物化）与组拖入（收子组）
  card.addEventListener('dragover', (event) => acceptGroupOrTabDrop(event, group));
  card.addEventListener('drop', (event) => dropGroupOrTab(event, group));
}
```

`createGroupToggle` 里 `groupFolderIcon` 改回单一文件夹 SVG（无开合变体需求可保留现 SVG）。

- [ ] **Step 2:** `npm run check`；`node --test tests/panel-render-signatures.test.js` 等渲染相关单测按需对齐（签名函数若引用 folder 结构则更新）
- [ ] **Step 3: Commit** — `feat: render state-backed group tree (retire folder shells)`

---

### Task 8: 拖拽重写（纯状态事务 + 根区拖放 + 指示线）

**Files:**
- Modify: `sidepanel.js`
  - `startGroupDrag`（:6994-7015 区域）：`sourceRootKeys`/`sourceAllKeys` 进 dragState；删除 `startFolderDrag`
  - `acceptGroupDrop`/`dropGroup`（:7017-7059）：intent 判定沿用 `groupDropIntent`（25% 边带），target 为空节点同组卡
  - 新增根区拖放：`els.groupsList` 上 `dragover`/`drop`（target 未命中任何组卡时）→ `intent: 'root'`；拖拽经过显示 `.drop-indicator`（插入线元素，绝对定位）
  - `moveGroupBlockIntoContext`/`moveGroupBlockBesideContext`/`groupTitleForNestedMove`/`retitleGroupForNestedMove`/`targetPathForSiblingMove`/`groupOrderAfterNestedMove`/`groupOrderAfterSiblingMove`/`groupForFolderTabDrop` 全部退役，统一为一个 `applyHierarchyDrop(dragState, plan, options)`：

```js
async function applyHierarchyDrop(dragState, plan, options = {}) {
  const windowBinding = options.windowBinding;
  if (!options.stateLocked) {
    return withFreshSpaceStateMutation(() => {
      assertFreshOrganizationDrag(options);
      return applyHierarchyDrop(dragState, plan, { ...options, stateLocked: true });
    }, { windowBinding });
  }
  const spaceId = state.activeSpaceId;
  const rollback = captureChromeGroupMutationRollback();
  await runChromeGroupMutationTransaction({
    apply: async () => {
      state.groupParents[spaceId] = plan.parents;
      state.groupOrder[spaceId] = plan.order;
      // 折叠键不动（键稳定）；空节点/组键均无需重命名 —— Chrome 零写入
    },
    checkpoint: () => saveState({ persistWindowState: false, windowBinding }),
    rollback: () => restoreChromeGroupMutationAfterFailure(rollback, { windowBinding }),
  });
  await refreshTabs({ windowBinding });
}
```

`dropGroup` 主流程：

```js
function dropGroup(event, target) {
  const targetKey = target?.emptyNode || target?.key ? target.key : '';
  const plan = planHierarchyDrop({
    parents: hierarchyParentsForSpace(),
    order: state.groupOrder[state.activeSpaceId] || [],
    sourceRootKeys: dragState.sourceRootKeys,
    sourceAllKeys: dragState.groupKeys,
    targetKey,
    intent: targetKey ? groupDropIntent(event) : 'root',
  });
  event.preventDefault();
  event.stopPropagation();
  clearDropIndicator();
  if (plan.error) {
    if (plan.error !== 'no-op') setStatus(plan.message);
    return;
  }
  runTask((windowBinding) => applyHierarchyDrop(dragState, plan, {
    windowBinding,
    sourceSpaceId: dragState.sourceSpaceId,
    expectedFingerprint: dragState.organizationFingerprint,
  }));
}
```

- [ ] **Step 1:** 按上述替换；根区 handler：`els.groupsList.addEventListener('dragover', …)` 仅当 `dragState?.type==='group'` 且 `event.target === els.groupsList`（未落在任何卡片）时 preventDefault + 显示指示线；`drop` → `planHierarchyDrop({…, intent:'root'})`
- [ ] **Step 2:** `npm run check`；`node --test tests/tab-move.test.js tests/tab-selection.test.js`（tab 拖拽路径不受影响的回归）
- [ ] **Step 3: Commit** — `feat: state-only hierarchy drag & drop with root drop zone`

---

### Task 9: 菜单 / CRUD / 键重映射 / 空节点物化

**Files:**
- Modify: `sidepanel.js`
  - `showGroupContextMenu`（:10021）：`New Subgroup` → `createEmptyGroupNode(group.key)`（父 = 该组）
  - 新增 `els.groupsList` `contextmenu` → 空白处 `New Group`（根级空节点）
  - `deleteGroup`（找到函数）分支：`group.emptyNode` → 后代为空直接删（`deleteEmptyGroupNode(key)`），否则确认（文案列出子组数与 tab 数，删除整棵子树）
  - 删除：`renameFolderGroup`/`deleteFolderGroup`/`moveFolderGroupToSpace`/`renameStoredEmptyFolder`/`deleteStoredEmptyFolder`/`createEmptySubgroup`/`storedFolderPathsForSpace`/`setStoredFolderPathsForSpace`/`folderPartsForStoredPath`/`rekeyCollapsedFolderKeys`（:4200-5130、:10065-10185 区域）
  - `moveGroupToSpace`：subtree 一起搬；`groupParents[targetSpaceId]` 子项保留内部父子，源空间删除相应键
  - 键重映射接线：`replaceGroupOrderKeys`（:5451）、`transferGroupLocalState`（:11807）内同步 `state.groupParents[spaceId] = remapGroupParents(...)`；`remapSnapshotGroupIndexedState` 调用点（:7374）后接同 map 的 `remapGroupParents`
  - 空节点物化：tab 拖入空节点 → `createChromeGroup(tabIds, { title: node.title, color: node.color, sourceKey: node.key })`（`bindChromeGroup` 的 `transferGroupLocalState` 已处理 sourceKey 换键，补 `emptyNodes` 项删除 + parents 重映射）
- Test: e2e Task 10

- [ ] **Step 1:** 实现上述；`createEmptyGroupNode(parentKey = '')`:

```js
async function createEmptyGroupNode(parentKey = '', options = {}) {
  const name = await askText({
    title: parentKey ? 'New Subgroup' : 'New Group',
    label: 'Group title',
    value: 'New Group',
    confirmText: 'Create',
  });
  if (name === null) return;
  const clean = name.trim();
  if (!clean) return;
  const spaceId = state.activeSpaceId;
  const key = `node:${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;
  state.emptyNodes[spaceId] = { ...(state.emptyNodes[spaceId] || {}), [key]: { title: clean, color: nextGroupColor() } };
  if (parentKey) state.groupParents[spaceId] = { ...(state.groupParents[spaceId] || {}), [key]: parentKey };
  state.groupOrder[spaceId] = insertAfterSubtree(state.groupOrder[spaceId] || [], parentKey, key);
  await saveState({ persistWindowState: false, windowBinding: options.windowBinding });
  render();
  setStatus(`Created group "${clean}".`);
}
```

（`insertAfterSubtree(order, parentKey, key)`：parentKey 空 → 追加根级；否则插到该键子树块之后 —— 语义与 `subtreeEndIndex` 一致，可从 group-tree.js 导出复用。）

- [ ] **Step 2:** `npm run check`；`node --test tests/space-deletion.test.js tests/space-transfer.test.js`（删除/搬移路径回归；断言若引用 folder 函数则同步更新）
- [ ] **Step 3: Commit** — `feat: node-based group menus, CRUD and parent-map remapping`

---

### Task 10: e2e 场景 + 阈值 + 缓存戳

**Files:**
- Modify: `scripts/e2e-extension-smoke.mjs`（新增场景）
- Modify: `scripts/e2e-coverage-union.mjs` 阈值（按实测）
- Modify: `sidepanel.html`（`?v=32` → `?v=33` 两处）

- [ ] **Step 1:** 新场景（复用现有驱动原语）：
  1. `hierarchy-nested-render`：右键组卡 → New Subgroup → 断言父卡 `.group-children` 内出现空节点卡（不在顶层找）。
  2. `hierarchy-drag-into`：CDP 拖组 A 头中部到组 B → 断言 `groupParents` 落库 + 渲染嵌套 + Chrome 组 A 标题**未变**。
  3. `hierarchy-drag-out`：子组拖到面板空白 → 断言回根级。
  4. `hierarchy-empty-node-delete`：空节点 × 直接删除，无 confirm。
  5. `hierarchy-rename-parent`：改父组名 → 子组标题/位置不变，Chrome 组名单段。
  6. `hierarchy-migration`：预置旧态（folderPaths + " / " 标题）→ 载入后断言层级等价、组名单段。
- [ ] **Step 2:** `npm run e2e:smoke` 全绿（连续两轮防时序漂移）；`npm run e2e:coverage` + `verify:coverage:e2e:union` 更新阈值为实测值。
- [ ] **Step 3:** `sidepanel.html` 缓存戳 v33；`npm run check`。
- [ ] **Step 4: Commit** — `test: e2e hierarchy scenarios and cache stamp v33`

---

### Task 11: 终验与部署

- [ ] **Step 1:** `npm run check` && `node --test tests/` && `npm run test:coverage:node` 全绿
- [ ] **Step 2:** `npm run e2e:smoke`（两轮）
- [ ] **Step 3:** 部署：`rsync -av --exclude config.local.js --exclude .git /Users/bytedance/github/chrome-tab/ ~/Downloads/space-tabs/`（排除 `config.local.js`）；chrome-devtools MCP reload 扩展
- [ ] **Step 4:** 手工回归用户三个场景（图1 建子组不重复；图2/3 拖组进组无壳；子组拖回根区）；验证原 4 类报错在 Tidy/Auto Group 与拖拽后不再出现
- [ ] **Step 5:** 若全部通过：`git commit`（剩余改动）；失败则回到对应 Task 修复

---

## Self-Review 记录

- Spec 覆盖：§3 数据模型→Task 1/2/9；§3 迁移→Task 1（规划）+Task 6（应用）；§4 渲染→Task 7；§5 拖拽→Task 8；§6 菜单→Task 9；§7 报错→Task 3/4/5/6；§8 测试→Task 1-5 单测 + Task 10 e2e；§10 缓存戳→Task 10。
- 类型一致性：`planHierarchyDrop` 入参/出参、`remapGroupParents(parents, replacements: Map)`、`planStaleLifecycleBindingHeal` 返回 `{action, snapshotGroupId}` 在 Task 1/4/6/8/9 中一致。
- 已知取舍：`orderSomeBetween` 辅助在 Task 1 代码中实现过简（no-op 判定只覆盖"已是子级"），落地时以测试断言为准微调实现，不改接口。
