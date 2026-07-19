import test from 'node:test';
import assert from 'node:assert/strict';

import {
  askMessagesRenderSignature,
  groupsRenderSignature,
  spacesRenderSignature,
} from '../src/shared/panel-render-signatures.js';

function localTab(overrides = {}) {
  return {
    id: 11,
    snapshotTabId: 'snapshot-tab-11',
    snapshotGroupId: 'snapshot-group-1',
    title: 'Example title',
    displayTitle: 'Example display title',
    panelTitle: 'Example panel title',
    url: 'https://example.com/page',
    pendingUrl: '',
    domain: 'example.com',
    favIconUrl: 'https://example.com/favicon.ico',
    active: false,
    pinned: false,
    muted: false,
    dormant: false,
    dormantGroupKey: '',
    groupId: 7,
    index: 3,
    windowId: 5,
    ...overrides,
  };
}

function group(overrides = {}) {
  return {
    key: 'group:7',
    id: 7,
    snapshotGroupId: 'snapshot-group-1',
    title: 'Work / Research',
    displayTitle: 'Research',
    color: 'blue',
    collapsed: false,
    dormant: false,
    tabs: [localTab()],
    ...overrides,
  };
}

function groupsOptions(overrides = {}) {
  const renderedGroup = group();
  return {
    activeSpaceId: 'space-a',
    fileSchemeAccessAllowed: false,
    spaceGroupsCollapsed: false,
    collapsedGroups: {
      'folder:space-a:Work': false,
      'folder:space-a:Work/Research': true,
      'folder:space-b:Unrelated': true,
      'group:7': false,
    },
    selectedTabIds: new Set(),
    groups: [renderedGroup],
    folderTree: [{
      type: 'folder',
      key: 'folder:space-a:Work',
      children: [{
        type: 'folder',
        key: 'folder:space-a:Work/Research',
        children: [{ type: 'folder-tabs', group: renderedGroup }],
      }],
    }, { type: 'group', group: renderedGroup }],
    ...overrides,
  };
}

function changedGroupSignature(mutator) {
  const options = groupsOptions();
  const baseline = groupsRenderSignature(options);
  mutator(options);
  assert.notEqual(groupsRenderSignature(options), baseline);
}

test('groups render signature defaults to a stable empty render model', () => {
  assert.deepEqual(JSON.parse(groupsRenderSignature()), {
    activeSpaceId: '',
    fileSchemeAccessAllowed: false,
    spaceGroupsCollapsed: false,
    collapsedGroups: [],
    groups: [],
  });
});

test('groups signature includes only collapsed keys that can affect the current render', () => {
  const options = groupsOptions();
  const baseline = groupsRenderSignature(options);
  const model = JSON.parse(baseline);

  assert.deepEqual(model.collapsedGroups, [
    ['folder:space-a:Work', false],
    ['folder:space-a:Work/Research', true],
    ['group:7', false],
  ]);

  options.collapsedGroups['folder:space-b:Unrelated'] = false;
  options.collapsedGroups['stale:space-a:key'] = true;
  assert.equal(groupsRenderSignature(options), baseline);

  options.collapsedGroups['folder:space-a:Work'] = true;
  assert.notEqual(groupsRenderSignature(options), baseline);
});

test('groups signature normalizes collapse truthiness and ignores map insertion order', () => {
  const options = groupsOptions({
    collapsedGroups: {
      'group:7': 0,
      'folder:space-a:Work/Research': 1,
      'folder:space-a:Work': '',
    },
  });
  const baseline = groupsRenderSignature(options);
  options.collapsedGroups = {
    'folder:space-a:Work': null,
    'folder:space-a:Work/Research': 'yes',
    'group:7': false,
  };
  assert.equal(groupsRenderSignature(options), baseline);
});

test('groups signature tracks every group DOM and group-listener dependency', () => {
  for (const [field, value] of [
    ['key', 'group:8'],
    ['id', 8],
    ['snapshotGroupId', 'snapshot-group-2'],
    ['title', 'Work / Reading'],
    ['displayTitle', 'Reading'],
    ['color', 'green'],
    ['collapsed', true],
    ['dormant', true],
  ]) {
    changedGroupSignature((options) => {
      options.groups[0][field] = value;
    });
  }

  changedGroupSignature((options) => options.groups.push(group({ key: 'group:8' })));

  const orderedGroups = groupsOptions({
    groups: [group(), group({ key: 'group:8', id: 8 })],
  });
  const orderedGroupsSignature = groupsRenderSignature(orderedGroups);
  orderedGroups.groups.reverse();
  assert.notEqual(groupsRenderSignature(orderedGroups), orderedGroupsSignature);

  const orderedTabs = groupsOptions({
    groups: [group({ tabs: [localTab(), localTab({ id: 12 })] })],
  });
  const orderedTabsSignature = groupsRenderSignature(orderedTabs);
  orderedTabs.groups[0].tabs.reverse();
  assert.notEqual(groupsRenderSignature(orderedTabs), orderedTabsSignature);
});

test('groups signature tracks every tab-row DOM and event-listener dependency', () => {
  for (const [field, value] of [
    ['id', 12],
    ['snapshotTabId', 'snapshot-tab-12'],
    ['snapshotGroupId', 'snapshot-group-2'],
    ['title', 'Changed title'],
    ['displayTitle', 'Changed display title'],
    ['panelTitle', 'Changed panel title'],
    ['url', 'https://example.net/changed'],
    ['pendingUrl', 'https://example.net/pending'],
    ['domain', 'example.net'],
    ['favIconUrl', 'https://example.net/favicon.ico'],
    ['active', true],
    ['pinned', true],
    ['muted', true],
    ['dormant', true],
    ['dormantGroupKey', 'snapshot:1'],
    ['groupId', 8],
    ['index', 4],
    ['windowId', 6],
  ]) {
    changedGroupSignature((options) => {
      options.groups[0].tabs[0][field] = value;
    });
  }
});

test('groups signature uses strict foreign-window presentation semantics', () => {
  const invalidMarkers = [null, '12', -1, 1.5];
  const baseline = groupsRenderSignature(groupsOptions());

  for (const foreignWindowTabId of invalidMarkers) {
    const options = groupsOptions();
    options.groups[0].tabs[0].foreignWindowTabId = foreignWindowTabId;
    options.groups[0].tabs[0].foreignWindowId = 9;
    assert.equal(groupsRenderSignature(options), baseline);
  }

  const foreign = groupsOptions();
  foreign.groups[0].tabs[0].foreignWindowTabId = 0;
  foreign.groups[0].tabs[0].foreignWindowId = 9;
  const foreignSignature = groupsRenderSignature(foreign);
  assert.notEqual(foreignSignature, baseline);
  assert.deepEqual(JSON.parse(foreignSignature).groups[0].tabs[0], {
    ...JSON.parse(baseline).groups[0].tabs[0],
    foreign: true,
    foreignWindowTabId: 0,
    foreignWindowId: 9,
    secondaryLabel: 'example.com · Open in another window',
    ariaStateLabel: 'open in another window',
  });

  foreign.groups[0].tabs[0].foreignWindowId = '9';
  assert.notEqual(groupsRenderSignature(foreign), foreignSignature);
  assert.equal(JSON.parse(groupsRenderSignature(foreign)).groups[0].tabs[0].foreignWindowId, null);
});

test('groups signature tracks selection only when it changes a visible row', () => {
  const options = groupsOptions();
  const baseline = groupsRenderSignature(options);
  options.selectedTabIds = new Set([999]);
  assert.equal(groupsRenderSignature(options), baseline);

  options.selectedTabIds = new Set([11]);
  assert.notEqual(groupsRenderSignature(options), baseline);

  const foreign = groupsOptions();
  foreign.groups[0].tabs[0].foreignWindowTabId = 11;
  const foreignBaseline = groupsRenderSignature(foreign);
  foreign.selectedTabIds = new Set([11]);
  assert.equal(groupsRenderSignature(foreign), foreignBaseline);

  const dormant = groupsOptions();
  dormant.groups[0].tabs[0].dormant = true;
  const dormantBaseline = groupsRenderSignature(dormant);
  dormant.selectedTabIds = new Set([11]);
  assert.equal(groupsRenderSignature(dormant), dormantBaseline);
});

test('groups signature handles empty group tabs, missing group keys, and childless folders', () => {
  const options = groupsOptions({
    groups: [null, group({ key: '', tabs: undefined })],
    folderTree: [{ type: 'folder', key: '' }, { type: 'group' }],
  });
  const model = JSON.parse(groupsRenderSignature(options));
  assert.deepEqual(model.collapsedGroups, []);
  assert.deepEqual(model.groups[0].tabs, []);
});

test('groups signature rerenders for panel-level inputs that change Groups behavior', () => {
  for (const [field, value] of [
    ['activeSpaceId', 'space-b'],
    ['fileSchemeAccessAllowed', true],
    ['spaceGroupsCollapsed', true],
  ]) {
    changedGroupSignature((options) => {
      options[field] = value;
    });
  }
});

test('Ask message signature tracks rendered content and timestamp fallbacks', () => {
  assert.equal(askMessagesRenderSignature(), '["",[]]');
  assert.equal(askMessagesRenderSignature(null), '["",[]]');

  const session = {
    key: 'tab:11',
    messages: [
      { id: 'm1', role: 'user', createdAt: 10, text: 'Question' },
      { id: 'm2', role: 'assistant', createdAt: 20, updatedAt: 30, text: 'Answer' },
      { id: 'm3', role: 'assistant', text: 'No timestamp' },
    ],
  };
  const baseline = askMessagesRenderSignature(session);
  assert.deepEqual(JSON.parse(baseline), [
    'tab:11',
    [
      ['m1', 'user', 10, 'Question'],
      ['m2', 'assistant', 30, 'Answer'],
      ['m3', 'assistant', 0, 'No timestamp'],
    ],
  ]);

  const variants = [
    { ...session, key: 'tab:12' },
    { ...session, messages: [{ ...session.messages[0], id: 'changed' }, ...session.messages.slice(1)] },
    { ...session, messages: [{ ...session.messages[0], role: 'assistant' }, ...session.messages.slice(1)] },
    { ...session, messages: [{ ...session.messages[0], createdAt: 11 }, ...session.messages.slice(1)] },
    { ...session, messages: [{ ...session.messages[0], text: 'Changed' }, ...session.messages.slice(1)] },
    { ...session, messages: [...session.messages].reverse() },
  ];
  for (const variant of variants) assert.notEqual(askMessagesRenderSignature(variant), baseline);
});

test('Spaces signature tracks dock DOM and listener dependencies', () => {
  assert.deepEqual(JSON.parse(spacesRenderSignature()), ['', false, '', false, '', []]);
  const options = {
    layoutMode: 'sidepanel',
    workbenchMode: false,
    activeView: 'space',
    onboardingCompleted: true,
    activeSpaceId: 'space-a',
    spaces: [
      { id: 'space-a', name: 'Work', icon: 'W' },
      { id: 'space-b', name: 'Personal' },
    ],
  };
  const baseline = spacesRenderSignature(options);
  assert.deepEqual(JSON.parse(baseline), [
    'sidepanel', false, 'space', true, 'space-a',
    [['space-a', 'Work', 'W'], ['space-b', 'Personal', '']],
  ]);

  const variants = [
    { ...options, layoutMode: 'workbench' },
    { ...options, workbenchMode: true },
    { ...options, activeView: 'ask' },
    { ...options, onboardingCompleted: false },
    { ...options, activeSpaceId: 'space-b' },
    { ...options, spaces: [{ ...options.spaces[0], id: 'space-c' }, options.spaces[1]] },
    { ...options, spaces: [{ ...options.spaces[0], name: 'Projects' }, options.spaces[1]] },
    { ...options, spaces: [{ ...options.spaces[0], icon: 'P' }, options.spaces[1]] },
    { ...options, spaces: [...options.spaces].reverse() },
  ];
  for (const variant of variants) assert.notEqual(spacesRenderSignature(variant), baseline);
});
