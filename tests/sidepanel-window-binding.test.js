import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';

const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
const ast = parse(source, {
  ecmaVersion: 'latest',
  sourceType: 'module',
  locations: true,
});

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else {
      walk(value, visit);
    }
  }
}

const functions = new Map();
walk(ast, (node) => {
  if (node.type === 'FunctionDeclaration' && node.id?.name) {
    functions.set(node.id.name, node);
  }
});

function propertyName(property) {
  if (property?.key?.type === 'Identifier') return property.key.name;
  if (property?.key?.type === 'Literal') return String(property.key.value);
  return '';
}

function objectHasProperty(node, name, expectedBoolean = null) {
  if (node?.type !== 'ObjectExpression') return false;
  return node.properties.some((property) => {
    if (propertyName(property) !== name) return false;
    if (expectedBoolean === null) return true;
    return property.value?.type === 'Literal' && property.value.value === expectedBoolean;
  });
}

function directCalls(functionNode, calleeName) {
  const calls = [];
  walk(functionNode.body, (node) => {
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === calleeName) {
      calls.push(node);
    }
  });
  return calls;
}

test('queued panel tasks freeze the host-window binding at invocation', () => {
  const runTask = functions.get('runTask');
  assert.ok(runTask);
  const runTaskSource = source.slice(runTask.start, runTask.end);
  assert.match(runTaskSource, /const windowBinding = capturePanelWindowBinding\(\)/);
  assert.match(runTaskSource, /await task\(windowBinding\)/);
  assert.ok(
    runTaskSource.indexOf('capturePanelWindowBinding()') < runTaskSource.indexOf('taskQueue.then'),
    'binding must be captured before the task is queued',
  );

  const rebound = functions.get('handlePanelWindowRebound');
  assert.match(
    source.slice(rebound.start, rebound.end),
    /reconcilePanelWindowRebind\(transition\)/,
    'window rebind work must use its authoritative transition instead of the captured UI binding',
  );
});

test('New Space binds to the Workbench window at dialog confirmation time', () => {
  const addSpace = functions.get('addSpace');
  assert.ok(addSpace);
  const addSpaceSource = source.slice(addSpace.start, addSpace.end);
  const dialog = addSpaceSource.indexOf('await askText');
  const confirmedBinding = addSpaceSource.indexOf('windowBinding = capturePanelWindowBinding()');
  const synchronized = addSpaceSource.indexOf('syncStateFromStorage({ windowBinding })');

  assert.ok(
    dialog >= 0 && dialog < confirmedBinding && confirmedBinding < synchronized,
    'moving a Workbench while the dialog is open must not reuse the opening-click binding',
  );
  assert.match(addSpaceSource, /if \(synchronized === false\) \{[\s\S]*throw new Error/,
    'a second move before persistence must be visible instead of silently dropping the draft');
  assert.match(addSpaceSource, /value: draft[\s\S]*catch \(error\)[\s\S]*formatAIError\(error\)/,
    'a failed confirmation must return to the same draft dialog');
});

test('a Space pair committed before a host move is never rolled back as stale view state', () => {
  const switchSpace = functions.get('switchSpace');
  assert.ok(switchSpace);
  const switchSource = source.slice(switchSpace.start, switchSpace.end);
  const save = switchSource.indexOf('const saved = await saveState({ windowBinding })');
  const preCommitFailure = switchSource.indexOf('if (saved !== true)');
  const rollback = switchSource.indexOf('rollbackWindowBoundCreatedTabMutation(checkpoint');
  const postCommitClose = switchSource.indexOf('const closeOutcome = await closeSpaceSwitchSourceTabs');

  assert.ok(
    save >= 0 && save < preCommitFailure && preCommitFailure < rollback && rollback < postCommitClose,
    'binding changes observed after a successful pair write belong outside the rollback region',
  );
  assert.doesNotMatch(switchSource, /saved\s*===\s*false\s*\|\|\s*!isCurrentPanelWindowBinding/);
  assert.doesNotMatch(
    switchSource.slice(postCommitClose),
    /rollbackWindowBoundCreatedTabMutation|restoreWorkspaceMemoryCheckpoint/,
  );
  assert.match(switchSource.slice(postCommitClose), /This panel moved before its switched view could refresh[\s\S]*return true/);
});

test('window-derived user mutations explicitly scope reads, browser commands, and checkpoints', () => {
  const mutationFunctions = [
    'addSpace',
    'focusForeignWindowTab',
    'focusTab',
    'renameTab',
    'duplicateTab',
    'renameGroup',
    'renameFolderGroup',
    'groupSelectedTabs',
    'closeTab',
    'removeDormantTab',
    'updateSavedTabUrl',
    'moveTabsToSpace',
    'moveGroupToSpace',
    'moveFolderGroupToSpace',
    'deleteGroup',
    'deleteFolderGroup',
    'deleteGroupsAndTabs',
    'toggleFolder',
    'toggleGroup',
    'moveGroupBlockIntoContext',
    'moveGroupBlockBesideContext',
    'reorderTab',
    'tidyTabNames',
    'autoGroupTabs',
    'undoLastOperation',
    'exportSpaceData',
    'restoreSpaceData',
    'importArcFile',
    'undoLastArcImport',
  ];

  for (const name of mutationFunctions) {
    const fn = functions.get(name);
    assert.ok(fn, `missing ${name}`);
    const fnSource = source.slice(fn.start, fn.end);
    assert.match(fnSource, /windowBinding/, `${name} must carry a window binding`);

    for (const callee of ['syncStateFromStorage', 'loadTabs', 'refreshTabs', 'refreshTabsView']) {
      for (const call of directCalls(fn, callee)) {
        assert.ok(
          objectHasProperty(call.arguments[0], 'windowBinding'),
          `${name}:${call.loc.start.line} ${callee} must receive windowBinding`,
        );
      }
    }

    for (const call of directCalls(fn, 'send')) {
      assert.ok(
        objectHasProperty(call.arguments[2], 'windowBinding'),
        `${name}:${call.loc.start.line} send must receive windowBinding`,
      );
    }

    for (const call of directCalls(fn, 'saveState')) {
      const options = call.arguments[0];
      assert.ok(
        objectHasProperty(options, 'windowBinding') ||
          objectHasProperty(options, 'persistWindowState', false),
        `${name}:${call.loc.start.line} saveState must bind a window or explicitly preserve all window mappings`,
      );
    }
  }
});

test('new and saved tab creation stop compensation at the durable commit boundary', () => {
  for (const name of ['newTabInActiveSpace', 'openDormantTab']) {
    const fn = functions.get(name);
    const fnSource = source.slice(fn.start, fn.end);
    const rollbackEnd = fnSource.indexOf('rollbackWindowBoundCreatedTabMutation');
    const cleanup = fnSource.indexOf('await closeEphemeralTabs', rollbackEnd);
    assert.ok(rollbackEnd >= 0 && cleanup > rollbackEnd, `${name} cleanup must be post-commit`);
    assert.match(fnSource, /storageMayBeDirty = true;[\s\S]*await saveState\(\{ windowBinding \}\)/);
    assert.match(fnSource, /allowStaleWindowBinding: true/);
    assert.match(fnSource, /opened and was saved/);
  }

  const cleanup = functions.get('closeEphemeralTabs');
  const cleanupSource = source.slice(cleanup.start, cleanup.end);
  assert.match(cleanupSource, /result\.closedTabIds\.length > 0[\s\S]*saveState\(\{ persistWindowState: false \}\)/);
});

test('Command Palette tools and group delete buttons keep their gesture-time binding', () => {
  const palette = functions.get('runSelectedCommandPaletteItem');
  assert.ok(palette);
  const paletteSource = source.slice(palette.start, palette.end);
  assert.match(paletteSource, /openAskPage\(\{ windowBinding \}\)/);
  assert.match(paletteSource, /tidyTabNames\(\{ \.\.\.\(prepared\.organizationRequest \|\| \{\}\), windowBinding \}\)/);
  assert.match(paletteSource, /autoGroupTabs\(\{ \.\.\.\(prepared\.organizationRequest \|\| \{\}\), windowBinding \}\)/);
  assert.match(paletteSource, /openWorkbench\(\{ view: 'settings', windowBinding \}\)/);
  assert.match(paletteSource, /isCurrentPanelWindowBinding\(windowBinding\)/);

  for (const name of ['createGroupCard', 'createFolderTabs']) {
    const fn = functions.get(name);
    assert.ok(fn, `missing ${name}`);
    const fnSource = source.slice(fn.start, fn.end);
    assert.match(
      fnSource,
      /actionButton\('\u00d7', 'Delete group', \(windowBinding\) => \([\s\S]*deleteGroup\(group, \{ windowBinding \}\)/,
      `${name} must forward actionButton's gesture-time binding`,
    );
  }
});

test('eager tab-replacement reconciliation cannot rewrite another window mapping', () => {
  const reconcile = functions.get('reconcileChromeTabReplacement');
  assert.ok(reconcile);
  const fnSource = source.slice(reconcile.start, reconcile.end);
  assert.match(fnSource, /const windowBinding = capturePanelWindowBinding\(\)/);
  assert.match(fnSource, /syncStateFromStorage\(\{ windowBinding \}\)/);
  assert.match(
    fnSource,
    /saveState\(\{ persistWindowState: false, windowBinding \}\)/,
  );
  assert.doesNotMatch(fnSource, /await saveState\(\)/);
});

test('Chrome-group rollback can finish in the original window after the host moves', () => {
  const groupRollback = functions.get('restoreChromeGroupMutationAfterFailure');
  const groupRollbackSource = source.slice(groupRollback.start, groupRollback.end);
  assert.match(groupRollbackSource, /const messageOptions = \{[\s\S]*allowStaleWindowBinding:/);
  assert.match(
    groupRollbackSource,
    /createGroup: \(tabIds, group\) => createChromeGroup\(tabIds, \{[\s\S]*\.\.\.messageOptions/,
  );

  const liveRestore = functions.get('restoreLiveOrganization');
  const liveRestoreSource = source.slice(liveRestore.start, liveRestore.end);
  assert.match(liveRestoreSource, /allowStaleWindowBinding: options\.allowStaleWindowBinding === true/);
  for (const call of directCalls(liveRestore, 'loadTabs')) {
    assert.ok(
      call.arguments[0]?.type === 'ObjectExpression' &&
        call.arguments[0].properties.some((property) => property.type === 'SpreadElement' &&
          property.argument?.name === 'messageOptions'),
      `restoreLiveOrganization:${call.loc.start.line} loadTabs must carry rollback message options`,
    );
  }
  assert.match(liveRestoreSource, /send\('tabs:ungroup',[\s\S]*messageOptions\)/);
  assert.match(liveRestoreSource, /send\('tabs:move',[\s\S]*messageOptions\)/);
  assert.match(liveRestoreSource, /createChromeGroup\(tabIds, \{[\s\S]*\.\.\.messageOptions/);

  const undoRollback = functions.get('restoreAutoGroupUndoAfterFailure');
  const undoRollbackSource = source.slice(undoRollback.start, undoRollback.end);
  assert.match(undoRollbackSource, /allowStaleWindowBinding: Boolean\(options\.windowBinding\)/);
  assert.match(undoRollbackSource, /isCurrentPanelWindowBinding\(options\.windowBinding\)[\s\S]*refreshTabs/);

  const autoGroup = functions.get('autoGroupTabs');
  const autoGroupSource = source.slice(autoGroup.start, autoGroup.end);
  assert.match(
    autoGroupSource,
    /const beforeLive = captureLiveOrganization\(sourceSpaceId\)[\s\S]*rollback\.membership = captureTabGroupMembership\([\s\S]*beforeLive\.tabs\.map\(\(tab\) => tab\.tabId\)/,
  );
  assert.match(
    autoGroupSource,
    /rollback: \(\) => restoreChromeGroupMutationAfterFailure\(rollback, \{[\s\S]*windowBinding,[\s\S]*persistRestoredState: true/,
  );
  assert.doesNotMatch(autoGroupSource, /restoreLiveOrganization\(beforeLive/);
});

test('legacy migration and deletion rollback checkpoint only the source-window outcome', () => {
  const materialize = functions.get('materializeLegacyVirtualGroups');
  const materializeSource = source.slice(materialize.start, materialize.end);
  assert.match(
    materializeSource,
    /if \(groupId === null\) continue;[\s\S]*cleanupUnusedVirtualGroups\(\);[\s\S]*await saveState\(\{ persistWindowState: false \}\)/,
  );

  const rollback = functions.get('rollbackSpaceDeletionTransition');
  const rollbackSource = source.slice(rollback.start, rollback.end);
  assert.match(
    rollbackSource,
    /restoreFailedWorkspaceMutation\(state, \{ windowBinding: options\.windowBinding \}\)/,
  );
  assert.match(
    rollbackSource,
    /cleanupAbortedSpaceDeletionPlaceholders\(transition, \{[\s\S]*windowBinding: options\.windowBinding/,
  );

  const cleanup = functions.get('cleanupAbortedSpaceDeletionPlaceholders');
  const cleanupSource = source.slice(cleanup.start, cleanup.end);
  assert.match(cleanupSource, /allowStaleWindowBinding: Boolean\(options\.windowBinding\)/);
  assert.match(cleanupSource, /send\('tabs:listAll', \{\}, messageOptions\)/);
  assert.match(cleanupSource, /send\('tabs:close', \{ tabId, preserveSnapshot: false \}, messageOptions\)/);

  const restore = functions.get('restoreFailedWorkspaceMutation');
  const restoreSource = source.slice(restore.start, restore.end);
  assert.match(restoreSource, /if \(!isCurrentPanelWindowBinding\(options\.windowBinding\)\) return;/);
});
