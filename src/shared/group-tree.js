// State-backed group hierarchy primitives.
//
// Hierarchy lives in state.groupParents[spaceId] as { child: parent } edges.
// Edges are persisted in the ANCHOR domain (see hierarchyAnchorForNode): view
// keys (chrome group ids, snapshot indexes) regenerate on fold/restore,
// snapshot reindex and browser restarts, so referencing them directly made
// every regeneration point a potential silent hierarchy loss. Titles stay
// single-segment: nothing here encodes or reads "/" paths except the legacy
// migration planner. All functions are pure so the 100% branch coverage gate
// can pin every edge case (cycles, orphans, vanished keys).

const SGID_ANCHOR_PREFIX = 'sgid:';

const STABLE_KEY_PREFIXES = ['node:', 'vgroup:'];

// Splits a legacy " / " title path into trimmed, non-empty parts with
// adjacent duplicates collapsed ("A / A / B" → ["A", "B"]).
export function parseTitlePath(title) {
  const parts = String(title || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.filter((part, index) => index === 0 || part !== parts[index - 1]);
}

function cycleMemberKeys(parents) {
  const cycleKeys = new Set();
  for (const startKey of Object.keys(parents)) {
    const seen = new Set();
    let current = startKey;
    while (parents[current]) {
      if (seen.has(current)) {
        cycleKeys.add(current);
        break;
      }
      seen.add(current);
      current = parents[current];
    }
  }
  return cycleKeys;
}

// A parent link is usable only when the direct parent exists in the view and
// is not part of a parent cycle; otherwise the child renders at root. The
// broken ancestor chain above a valid parent does not affect the child.
function directParentKey(key, parents, byKey, cycleKeys) {
  const parent = parents[key];
  if (!parent || parent === key || cycleKeys.has(parent) || !byKey.has(parent)) return null;
  return parent;
}

export function buildGroupTree(groups, parents = {}) {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const children = new Map(groups.map((group) => [group.key, []]));
  const cycleKeys = cycleMemberKeys(parents);
  const rootKeys = new Set();
  for (const group of groups) {
    const parentKey = directParentKey(group.key, parents, byKey, cycleKeys);
    if (parentKey) children.get(parentKey).push(group);
    else rootKeys.add(group.key);
  }
  const buildNode = (group) => ({
    ...group,
    children: children.get(group.key).map(buildNode),
  });
  return groups.filter((group) => rootKeys.has(group.key)).map(buildNode);
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

// The persisted order is a flat DFS list (parents before children). Insertion
// keeps that invariant: "inside" lands after the target's existing subtree,
// "before"/"after" bracket the target's subtree block, "root" appends.
// 目标节点深度：根=1，沿父链累加。循环父链走一步即停，不挂死。
export function nodeDepth(key, parents = {}) {
  let depth = 1;
  let current = key;
  const seen = new Set([key]);
  while (parents[current]) {
    const parent = parents[current];
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    current = parent;
    depth += 1;
  }
  return depth;
}

// 子树高度：自身=1，子节点链的最大深度。
export function subtreeHeight(key, parents = {}) {
  const descendants = descendantKeysOf(key, parents);
  if (descendants.size === 0) return 1;
  const rootDepth = nodeDepth(key, parents);
  const descendantDepths = [...descendants].map((d) => nodeDepth(d, parents));
  return Math.max(...descendantDepths) - rootDepth + 1;
}

export function planHierarchyDrop({
  parents = {},
  order = [],
  sourceRootKeys = [],
  sourceAllKeys = [],
  targetKey = '',
  intent = 'inside',
  maxDepth = null,
}) {
  if (!Array.isArray(sourceAllKeys) || sourceAllKeys.length === 0) {
    return { error: 'empty-source', message: 'Nothing is being dragged.' };
  }
  const sourceSet = new Set(sourceAllKeys);
  const sourceRoots = Array.isArray(sourceRootKeys) && sourceRootKeys.length
    ? sourceRootKeys
    : [sourceAllKeys[0]];
  if (intent !== 'root') {
    if (!targetKey) {
      return { error: 'missing-target', message: 'The drop target disappeared. Try the drag again.' };
    }
    if (sourceRoots.includes(targetKey)) {
      return { error: 'self', message: 'A group cannot be dropped into itself.' };
    }
    const sourceDescendants = new Set();
    for (const rootKey of sourceRoots) {
      for (const key of descendantKeysOf(rootKey, parents)) sourceDescendants.add(key);
    }
    if (sourceDescendants.has(targetKey)) {
      return { error: 'cycle', message: 'A group cannot be dropped inside its own subgroup.' };
    }
    if (intent === 'inside' && parents[sourceRoots[0]] === targetKey) {
      return { error: 'no-op', message: 'The group is already there.' };
    }
  }

  const nextParents = { ...parents };
  for (const rootKey of sourceRoots) delete nextParents[rootKey];
  if (intent === 'inside') {
    for (const rootKey of sourceRoots) nextParents[rootKey] = targetKey;
  } else if (intent === 'before' || intent === 'after') {
    const sharedParent = parents[targetKey];
    for (const rootKey of sourceRoots) {
      if (sharedParent) nextParents[rootKey] = sharedParent;
    }
  }
  if (Number.isFinite(Number(maxDepth)) && Number(maxDepth) > 0) {
    const maxDepthValue = Number(maxDepth);
    const sourceHeight = Math.max(...sourceRoots.map((rootKey) => {
      const rootDepth = nodeDepth(rootKey, nextParents);
      const descendantDepths = [...descendantKeysOf(rootKey, nextParents)]
        .map((descendant) => nodeDepth(descendant, nextParents));
      return descendantDepths.length > 0
        ? Math.max(...descendantDepths) - rootDepth + 1
        : 1;
    }));
    for (const rootKey of sourceRoots) {
      const depthAfterDrop = intent === 'inside'
        ? nodeDepth(targetKey, nextParents) + 1
        : nodeDepth(targetKey, nextParents);
      if (depthAfterDrop + sourceHeight - 1 > maxDepthValue) {
        return {
          error: 'max-depth',
          message: `Groups can nest at most ${maxDepthValue} levels.`,
          sourceRootKeys,
          sourceAllKeys,
          targetKey,
          intent,
        };
      }
    }
  }

  const working = order.filter((key) => !sourceSet.has(key));
  const sourceBlock = order.filter((key) => sourceSet.has(key));
  let insertAt = working.length;
  if (intent === 'before' && working.includes(targetKey)) {
    insertAt = working.indexOf(targetKey);
  } else if ((intent === 'inside' || intent === 'after') && working.includes(targetKey)) {
    const descendants = descendantKeysOf(targetKey, nextParents);
    let index = working.indexOf(targetKey) + 1;
    while (index < working.length && descendants.has(working[index])) index += 1;
    insertAt = index;
  }
  working.splice(insertAt, 0, ...sourceBlock);
  // 回显拖放意图，调用方在锁内可用最新状态重算同一意图。
  return {
    parents: nextParents,
    order: working,
    sourceRootKeys,
    sourceAllKeys,
    targetKey,
    intent,
  };
}

// --- Anchor domain ---------------------------------------------------------

// Encodes the durable anchor for a view node. Preference order: snapshot row
// identity (durable across restarts and materialization), stable keys, then
// the raw view key as a fallback that the per-render normalizer upgrades once
// the node gains an identity. Returns '' for nothing referenceable.
export function hierarchyAnchorForNode(node = {}) {
  const snapshotGroupId = String(node?.snapshotGroupId || '').trim();
  if (snapshotGroupId) return `${SGID_ANCHOR_PREFIX}${snapshotGroupId}`;
  const key = String(node?.key || '');
  if (!key || key === 'ungrouped') return '';
  if (STABLE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return key;
  return key;
}

// Resolves one anchor back to the current view key ('' when unresolvable).
// Raw legacy keys pass through unchanged (dual-domain read).
export function resolveHierarchyAnchorToKey(anchor, bySnapshotGroupId = new Map()) {
  const value = String(anchor || '');
  if (!value) return '';
  if (value.startsWith(SGID_ANCHOR_PREFIX)) {
    return bySnapshotGroupId.get(value.slice(SGID_ANCHOR_PREFIX.length)) || '';
  }
  return value;
}

// Projects persisted edges into the current view-key domain for rendering and
// planning. Edges whose endpoint cannot be projected right now are omitted
// from the projection only — storage keeps them until identity returns.
export function resolveHierarchyKeyParents(parents = {}, bySnapshotGroupId = new Map()) {
  const resolved = {};
  for (const [childAnchor, parentAnchor] of Object.entries(parents || {})) {
    const childKey = resolveHierarchyAnchorToKey(childAnchor, bySnapshotGroupId);
    const parentKey = resolveHierarchyAnchorToKey(parentAnchor, bySnapshotGroupId);
    if (childKey && parentKey && childKey !== parentKey) resolved[childKey] = parentKey;
  }
  return resolved;
}

// Idempotent per-render upgrade: raw keys become sgid anchors once the view
// node has a durable identity. node:/vgroup:/sgid: entries pass through.
// Returns the upgraded map plus whether anything changed (callers persist).
export function upgradeHierarchyParentAnchors(parents = {}, anchorByKey = new Map()) {
  const toAnchor = (value) => {
    const raw = String(value || '');
    if (!raw) return '';
    if (raw.startsWith(SGID_ANCHOR_PREFIX)) return raw;
    if (STABLE_KEY_PREFIXES.some((prefix) => raw.startsWith(prefix))) return raw;
    return anchorByKey.get(raw) || raw;
  };
  const next = {};
  let changed = false;
  for (const [child, parent] of Object.entries(parents || {})) {
    const nextChild = toAnchor(child);
    const nextParent = toAnchor(parent);
    if (nextChild !== child || nextParent !== parent) changed = true;
    if (nextChild && nextParent && nextChild !== nextParent) next[nextChild] = nextParent;
  }
  return { parents: next, changed };
}

// Replaces moved/renamed group keys in the parent map. replacements maps an
// old key to its new key; mapping a key to '' means it vanished and drops any
// entry that referenced it (children promote to root at render time).
// Domain-agnostic: works on view keys and anchors alike.
export function remapGroupParents(parents = {}, replacements = new Map()) {
  const next = {};
  if (!(replacements instanceof Map)) return { ...parents };
  for (const [childKey, parentKey] of Object.entries(parents)) {
    const nextChild = replacements.get(childKey) ?? childKey;
    const nextParent = replacements.get(parentKey) ?? parentKey;
    if (!nextChild || !nextParent || nextChild === nextParent) continue;
    next[nextChild] = nextParent;
  }
  return next;
}

// Pure planner for the one-time legacy migration: stored folder paths and
// " / " titles become empty nodes + parent links + leaf renames. The caller
// (sidepanel) applies renames to Chrome/snapshots; this function never does.
export function planLegacyTitlePathMigration({
  folderPathsBySpace = {},
  groupsBySpace = {},
  idFactory,
}) {
  const emptyNodesBySpace = {};
  const parentsBySpace = {};
  const renamesBySpace = {};
  const ensureNodeChain = (spaceId, parts, titleToKey) => {
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

  const spaceIds = new Set([
    ...Object.keys(folderPathsBySpace),
    ...Object.keys(groupsBySpace),
  ]);
  for (const spaceId of spaceIds) {
    renamesBySpace[spaceId] = renamesBySpace[spaceId] || [];
    const groups = groupsBySpace[spaceId] || [];
    const titleToKey = new Map();
    for (const group of groups) {
      const parts = parseTitlePath(group.title);
      if (parts.length === 1) titleToKey.set(parts[0].toLowerCase(), group.key);
    }
    for (const path of folderPathsBySpace[spaceId] || []) {
      const parts = parseTitlePath(path);
      if (parts.length === 0) continue;
      ensureNodeChain(spaceId, parts, titleToKey);
    }
    for (const group of groups) {
      const parts = parseTitlePath(group.title);
      if (parts.length <= 1) continue;
      const parentKey = ensureNodeChain(spaceId, parts.slice(0, -1), titleToKey);
      if (parentKey) {
        parentsBySpace[spaceId] = { ...parentsBySpace[spaceId], [group.key]: parentKey };
      }
      renamesBySpace[spaceId] = [
        ...renamesBySpace[spaceId],
        { key: group.key, nextTitle: parts.at(-1) },
      ];
    }
  }
  return { emptyNodesBySpace, parentsBySpace, renamesBySpace };
}
