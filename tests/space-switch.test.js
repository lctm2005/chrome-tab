import test from 'node:test';
import assert from 'node:assert/strict';

import {
  orderSpaceSwitchPhysicalIds,
  planSpaceSwitch,
  SPACE_SWITCH_PHASES,
  SPACE_SWITCH_SKIP_REASONS,
} from '../src/shared/space-switch.js';

test('Space switch physical order keeps saved ids first and live-only ids stable', () => {
  assert.deepEqual(
    orderSpaceSwitchPhysicalIds(
      [30, 10, 40, 20, 30, -1, 'bad'],
      [20, 10, 999, 20, -1, null],
    ),
    [20, 10, 30, 40],
  );
  assert.deepEqual(orderSpaceSwitchPhysicalIds([3, 2, 1], []), [3, 2, 1]);
  assert.deepEqual(orderSpaceSwitchPhysicalIds(null, [1, 2]), []);
});

test('Space switch closes only safe source-owned tabs and activates an existing target first', () => {
  const tabs = [
    { id: 1, groupId: -1, url: 'https://source.test/loose', custom: { owner: 'source' } },
    { id: 2, groupId: 10, url: 'https://source.test/grouped' },
    { id: 3, groupId: -1, url: 'https://source.test/pinned', pinned: true },
    { id: 4, groupId: -1, url: 'chrome://settings/' },
    { id: 5, groupId: -1, url: 'https://unassigned.test/' },
    { id: 6, groupId: 20, url: 'https://target.test/grouped', custom: { owner: 'target' } },
    { id: 7, groupId: -1, url: 'https://other.test/' },
    { id: 8, groupId: -1, url: 'file:///Users/me/source.txt' },
    { id: 9, groupId: -1, url: 'ftp://source.test/archive' },
    { id: 10, groupId: -1, url: 'https://target.test/loose' },
    { id: 11, groupId: 30, url: 'https://unassigned-group.test/' },
    { id: 12, groupId: -1, url: 'chrome-extension://extension-id/page.html' },
  ];
  const state = {
    groupSpaces: { 10: 'source', 20: 'target' },
    tabSpaces: {
      1: 'source',
      3: 'source',
      4: 'source',
      7: 'other',
      8: 'source',
      9: 'source',
      10: 'target',
      12: 'source',
    },
  };
  const snapshot = null;
  const frozen = structuredClone({ tabs, state, snapshot });

  const plan = planSpaceSwitch({
    tabs,
    state,
    sourceSpaceId: ' source ',
    targetSpaceId: ' target ',
    targetSnapshot: snapshot,
    foreignLiveTabs: [],
    fileSchemeAccess: false,
  });

  assert.deepEqual(plan.sourceClosableTabs.map((tab) => tab.id), [1, 2]);
  assert.deepEqual(plan.targetLiveTabs.map((tab) => tab.id), [6, 10]);
  assert.deepEqual(plan.restoreGroups, []);
  assert.deepEqual(plan.restoreGroupIndexes, []);
  assert.deepEqual(plan.skippedRows, []);
  assert.deepEqual(plan.reasons, {});
  assert.equal(plan.needsFallback, false);
  assert.deepEqual(plan.executionOrder, [
    SPACE_SWITCH_PHASES.MATERIALIZE_TARGET,
    SPACE_SWITCH_PHASES.ACTIVATE_TARGET,
    SPACE_SWITCH_PHASES.CLOSE_SOURCE,
  ]);
  assert.deepEqual(plan.phases, [
    { phase: 'materialize-target', required: false, mode: 'existing-live-tabs' },
    { phase: 'activate-target', required: true, after: 'materialize-target' },
    { phase: 'close-source', required: true, after: 'activate-target' },
  ]);
  assert.equal(plan.sourceClosePrecondition, 'target-activated');
  assert.equal(plan.sourceSpaceId, 'source');
  assert.equal(plan.targetSpaceId, 'target');

  assert.notEqual(plan.sourceClosableTabs[0], tabs[0]);
  assert.notEqual(plan.targetLiveTabs[0], tabs[5]);
  plan.sourceClosableTabs[0].custom.owner = 'changed';
  plan.targetLiveTabs[0].custom.owner = 'changed';
  assert.deepEqual({ tabs, state, snapshot }, frozen, 'planning and returned clones isolate live state');
});

test('Space switch restores missing stable rows beside a pinned or partial live target', () => {
  const plan = planSpaceSwitch({
    tabs: [
      {
        id: 1,
        groupId: -1,
        pinned: true,
        url: 'https://target.test/pinned',
        snapshotTabId: 'target-live-row',
      },
      {
        id: 2,
        groupId: 20,
        url: 'https://target.test/group-live',
        snapshotTabId: 'target-group-live-row',
      },
      { id: 3, groupId: -1, url: 'https://source.test/' },
    ],
    state: {
      groupSpaces: { 20: 'target' },
      tabSpaces: { 1: 'target', 3: 'source' },
    },
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    targetSnapshot: {
      groups: [{
        snapshotGroupId: 'target-group',
        title: 'Target Tag',
        color: 'green',
        collapsed: false,
        custom: { preserved: true },
        tabs: [
          { snapshotTabId: 'target-live-row', url: 'https://target.test/pinned' },
          { snapshotTabId: 'target-group-live-row', url: 'https://target.test/group-live' },
          { snapshotTabId: 'target-missing-row', url: 'https://target.test/missing' },
        ],
      }],
    },
  });

  assert.deepEqual(plan.targetLiveTabs.map((tab) => tab.id), [1, 2]);
  assert.deepEqual(plan.restoreGroups, [{
    snapshotGroupId: 'target-group',
    title: 'Target Tag',
    color: 'green',
    collapsed: false,
    custom: { preserved: true },
    tabs: [{ snapshotTabId: 'target-missing-row', url: 'https://target.test/missing' }],
  }]);
  assert.deepEqual(plan.restoreGroupIndexes, [0]);
  assert.equal(plan.needsFallback, false);
  assert.deepEqual(plan.phases, [
    { phase: 'materialize-target', required: true, mode: 'snapshot-partial' },
    { phase: 'activate-target', required: true, after: 'materialize-target' },
    { phase: 'close-source', required: true, after: 'activate-target' },
  ]);
});

test('Space switch claims local legacy target rows one-to-one and canonicalizes stable group identity', () => {
  const tabs = [
    { id: 1, windowId: 1, groupId: -1, url: 'https://same.test/duplicate' },
    { id: 2, windowId: 1, groupId: 20, url: 'chrome://settings/' },
    { id: 3, windowId: 1, groupId: -1, url: 'https://nav.test/page?live=1#current' },
    { id: 9, windowId: 1, groupId: -1, url: 'https://source.test/' },
  ];
  const state = {
    browserSessionId: 'session-current',
    groupSpaces: { 20: 'target' },
    tabSpaces: { 1: 'target', 3: 'target', 9: 'source' },
    tabLifecycle: {
      2: {
        snapshotTabId: 'row-stable',
        snapshotGroupId: 'wrong-old-group',
        spaceId: 'target',
        trackingMode: 'live',
        sessionId: 'session-current',
      },
    },
  };
  const targetSnapshot = {
    groups: [
      {
        snapshotGroupId: 'group-canonical',
        title: 'Canonical',
        tabs: [
          { snapshotTabId: 'row-duplicate-a', url: 'https://same.test/duplicate' },
          { snapshotTabId: 'row-duplicate-b', url: 'https://same.test/duplicate' },
          { snapshotTabId: 'row-stable', url: 'https://saved.test/before-navigation' },
        ],
      },
      {
        snapshotGroupId: 'group-navigation',
        title: 'Navigation fallback',
        tabs: [{ snapshotTabId: 'row-navigation', url: 'https://nav.test/page?saved=1' }],
      },
    ],
  };
  const frozen = structuredClone({ tabs, state, targetSnapshot });

  const plan = planSpaceSwitch({
    tabs,
    state,
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    targetSnapshot,
  });

  assert.deepEqual(plan.targetLiveTabs, [
    {
      ...tabs[0],
      snapshotTabId: 'row-duplicate-a',
      snapshotGroupId: 'group-canonical',
    },
    {
      ...tabs[1],
      snapshotTabId: 'row-stable',
      snapshotGroupId: 'group-canonical',
    },
    {
      ...tabs[2],
      snapshotTabId: 'row-navigation',
      snapshotGroupId: 'group-navigation',
    },
  ]);
  assert.deepEqual(plan.restoreGroupIndexes, [0]);
  assert.deepEqual(plan.restoreGroups, [{
    snapshotGroupId: 'group-canonical',
    title: 'Canonical',
    tabs: [{ snapshotTabId: 'row-duplicate-b', url: 'https://same.test/duplicate' }],
  }]);
  assert.deepEqual(plan.skippedRows, []);
  assert.deepEqual(plan.phases[0], {
    phase: 'materialize-target',
    required: true,
    mode: 'snapshot-partial',
  });
  assert.deepEqual(
    { tabs, state, targetSnapshot },
    frozen,
    'local identity claims are returned only on isolated planner clones',
  );
});

test('Space switch safely claims stable-less local snapshot rows without inventing identities', () => {
  const tabs = [
    { id: 1, groupId: -1, url: 'https://legacy.test/row-group' },
    { id: 2, groupId: -1, url: 'https://legacy.test/no-identities' },
  ];
  const plan = planSpaceSwitch({
    tabs,
    state: {
      groupSpaces: {},
      tabSpaces: { 1: 'target', 2: 'target' },
    },
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    targetSnapshot: {
      groups: [
        {
          tabs: [{
            snapshotGroupId: 'row-only-group',
            url: 'https://legacy.test/row-group',
          }],
        },
        {
          tabs: [{ url: 'https://legacy.test/no-identities' }],
        },
      ],
    },
  });

  assert.deepEqual(plan.targetLiveTabs, [
    { ...tabs[0], snapshotGroupId: 'row-only-group' },
    tabs[1],
  ]);
  assert.deepEqual(plan.restoreGroups, []);
  assert.deepEqual(plan.restoreGroupIndexes, []);
  assert.deepEqual(plan.skippedRows, []);
  assert.equal(plan.phases[0].mode, 'existing-live-tabs');
});

test('Space switch restores ordered grouped and ungrouped snapshot rows without URL deduplication', () => {
  const tabs = [{ id: 1, groupId: -1, url: 'https://source.test/', custom: { live: true } }];
  const state = {
    groupSpaces: {
      90: 'target',
      91: 'source',
    },
    tabSpaces: {
      1: 'source',
      92: 'target',
      93: 'source',
      95: 'target',
    },
    tabLifecycle: {
      92: { snapshotTabId: 'foreign-lifecycle' },
    },
  };
  const foreignLiveTabs = [
    {
      id: 90,
      windowId: 2,
      groupId: 90,
      url: 'https://same.test/page',
      snapshotTabId: ' foreign-direct ',
    },
    { id: 92, windowId: 2, groupId: -1, url: 'https://foreign.test/lifecycle' },
    {
      id: 93,
      windowId: 2,
      groupId: -1,
      url: 'https://same.test/page',
      snapshotTabId: 'row-a',
    },
    {
      id: 94,
      windowId: 2,
      groupId: -1,
      url: 'https://same.test/page',
      snapshotTabId: 'row-b',
    },
    { id: 95, windowId: 2, groupId: -1, url: 'https://foreign.test/no-stable-id' },
  ];
  const snapshot = {
    version: 1,
    identityVersion: 1,
    customRoot: { keep: true },
    groups: [
      {
        snapshotGroupId: 'group-main',
        title: 'Main',
        color: 'purple',
        collapsed: true,
        customGroup: { nested: ['preserved'] },
        tabs: [
          {
            snapshotTabId: 'row-a',
            title: 'Same URL A',
            url: 'https://same.test/page',
            customRow: { order: 1 },
          },
          {
            snapshotTabId: 'row-b',
            title: 'Same URL B',
            url: 'https://same.test/page',
            customRow: { order: 2 },
          },
          {
            snapshotTabId: 'foreign-direct',
            title: 'Open elsewhere (decorated)',
            url: 'https://same.test/page',
          },
          {
            snapshotTabId: 'foreign-lifecycle',
            title: 'Open elsewhere (lifecycle)',
            url: 'https://foreign.test/lifecycle',
          },
          {
            snapshotTabId: 'file-row',
            title: 'Local file',
            url: 'file:///Users/me/target.txt',
          },
          { snapshotTabId: 'invalid-row', title: 'Invalid', url: '' },
          { snapshotTabId: 'chrome-row', title: 'Chrome', url: 'chrome://settings/' },
          { snapshotTabId: 'about-row', title: 'About', url: 'about:blank' },
        ],
      },
      {
        title: 'Ungrouped',
        color: 'grey',
        restorable: true,
        customGroup: { ungrouped: true },
        tabs: [
          {
            title: 'Ungrouped target',
            url: 'https://target.test/loose',
            customRow: { nested: { retained: true } },
          },
          null,
        ],
      },
      { title: 'Empty', customGroup: { retainedNowhere: true }, tabs: null },
      null,
    ],
  };
  const frozen = structuredClone({ tabs, state, foreignLiveTabs, snapshot });

  const plan = planSpaceSwitch({
    tabs,
    state,
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    targetSnapshot: snapshot,
    foreignLiveTabs,
    fileSchemeAccess: false,
  });

  assert.deepEqual(plan.targetLiveTabs, []);
  assert.deepEqual(plan.restoreGroups, [
    {
      ...snapshot.groups[0],
      tabs: [snapshot.groups[0].tabs[0], snapshot.groups[0].tabs[1]],
    },
    {
      ...snapshot.groups[1],
      tabs: [snapshot.groups[1].tabs[0]],
    },
  ]);
  assert.deepEqual(plan.restoreGroupIndexes, [0, 1]);
  assert.equal(
    Object.hasOwn(plan.restoreGroups[1], 'groupIndex'),
    false,
    'the source index is planner metadata rather than persisted Tag metadata',
  );
  assert.deepEqual(
    plan.restoreGroups[0].tabs.map((tab) => [tab.snapshotTabId, tab.url]),
    [
      ['row-a', 'https://same.test/page'],
      ['row-b', 'https://same.test/page'],
    ],
    'stable rows sharing one URL are distinct and stay in snapshot order',
  );
  assert.deepEqual(plan.skippedRows.map((entry) => entry.reason), [
    SPACE_SWITCH_SKIP_REASONS.OPEN_IN_OTHER_WINDOW,
    SPACE_SWITCH_SKIP_REASONS.OPEN_IN_OTHER_WINDOW,
    SPACE_SWITCH_SKIP_REASONS.FILE_ACCESS_REQUIRED,
    SPACE_SWITCH_SKIP_REASONS.INVALID_URL,
    SPACE_SWITCH_SKIP_REASONS.UNSUPPORTED_URL,
    SPACE_SWITCH_SKIP_REASONS.UNSUPPORTED_URL,
    SPACE_SWITCH_SKIP_REASONS.INVALID_URL,
  ]);
  assert.deepEqual(plan.reasons, {
    [SPACE_SWITCH_SKIP_REASONS.OPEN_IN_OTHER_WINDOW]: 2,
    [SPACE_SWITCH_SKIP_REASONS.FILE_ACCESS_REQUIRED]: 1,
    [SPACE_SWITCH_SKIP_REASONS.INVALID_URL]: 2,
    [SPACE_SWITCH_SKIP_REASONS.UNSUPPORTED_URL]: 2,
  });
  assert.deepEqual(plan.skippedRows[0], {
    reason: 'open-in-other-window',
    groupIndex: 0,
    tabIndex: 2,
    group: {
      snapshotGroupId: 'group-main',
      title: 'Main',
      color: 'purple',
      collapsed: true,
      customGroup: { nested: ['preserved'] },
    },
    row: snapshot.groups[0].tabs[2],
  });
  assert.equal(plan.needsFallback, false);
  assert.deepEqual(plan.phases, [
    { phase: 'materialize-target', required: true, mode: 'snapshot' },
    { phase: 'activate-target', required: true, after: 'materialize-target' },
    { phase: 'close-source', required: true, after: 'activate-target' },
  ]);

  plan.restoreGroups[0].customGroup.nested[0] = 'changed';
  plan.restoreGroups[0].tabs[0].customRow.order = 99;
  plan.skippedRows[0].group.customGroup.nested[0] = 'changed';
  plan.skippedRows[0].row.title = 'changed';
  assert.deepEqual(
    { tabs, state, foreignLiveTabs, snapshot },
    frozen,
    'all group, row, and skip metadata is deeply cloned',
  );
});

test('Space switch permits file closing and restoration only after file access is granted', () => {
  const plan = planSpaceSwitch({
    tabs: [
      { id: 1, groupId: -1, url: 'file:///Users/me/source.txt' },
      { id: 2, groupId: -1, url: 'file:///Users/me/pinned.txt', pinned: true },
    ],
    state: { tabSpaces: { 1: 'source', 2: 'source' }, groupSpaces: {} },
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    targetSnapshot: {
      groups: [{
        title: 'Files',
        color: 'blue',
        tabs: [
          { snapshotTabId: 'file', title: 'File', url: 'file:///Users/me/target.txt' },
          { snapshotTabId: 'web', title: 'Web', url: 'https://target.test/' },
        ],
      }],
    },
    fileSchemeAccess: true,
  });

  assert.deepEqual(plan.sourceClosableTabs.map((tab) => tab.id), [1]);
  assert.deepEqual(plan.restoreGroups[0].tabs.map((tab) => tab.snapshotTabId), ['file', 'web']);
  assert.deepEqual(plan.reasons, {});
  assert.equal(plan.needsFallback, false);
});

test('Space switch can close a navigated saved target only when its source row is uniquely recoverable', () => {
  const tabs = Array.from({ length: 13 }, (_, index) => ({
    id: index + 1,
    groupId: -1,
    url: `chrome://source-${index + 1}/`,
  }));
  tabs[1].pinned = true;
  tabs.push({ id: 20, groupId: -1, url: 'https://target.test/live' });
  const state = {
    browserSessionId: 'session-current',
    groupSpaces: {},
    tabSpaces: Object.fromEntries([
      ...tabs.slice(0, 13).map((tab) => [tab.id, 'source']),
      [20, 'target'],
    ]),
    tabLifecycle: {
      1: savedTargetBinding('row-http'),
      2: savedTargetBinding('row-pinned'),
      3: { ...savedTargetBinding('row-live-mode'), trackingMode: 'live' },
      4: { ...savedTargetBinding(''), snapshotTabId: '' },
      5: savedTargetBinding('row-missing'),
      6: savedTargetBinding('row-ambiguous'),
      7: savedTargetBinding('row-unsupported'),
      8: { ...savedTargetBinding('row-wrong-space'), spaceId: 'other' },
      9: savedTargetBinding('row-file'),
      10: { ...savedTargetBinding('row-stale'), sessionId: 'session-old' },
      11: {
        ...savedTargetBinding('row-no-group'),
        snapshotGroupId: '',
      },
      12: {
        ...savedTargetBinding('row-row-group'),
        snapshotGroupId: 'row-group',
      },
      13: {
        snapshotTabId: 'row-no-space',
        trackingMode: 'saved-target',
      },
    },
  };
  const sourceSnapshot = {
    groups: [
      { title: 'Malformed source group' },
      {
        snapshotGroupId: 'group-source',
        tabs: [
          { snapshotTabId: 'row-http', url: 'https://source.test/saved' },
          { snapshotTabId: 'row-pinned', url: 'https://source.test/pinned' },
          { snapshotTabId: 'row-live-mode', url: 'https://source.test/live-mode' },
          { snapshotTabId: 'row-ambiguous', url: 'https://source.test/duplicate-a' },
          { snapshotTabId: 'row-ambiguous', url: 'https://source.test/duplicate-b' },
          { snapshotTabId: 'row-unsupported', url: 'chrome://settings/' },
          { snapshotTabId: 'row-wrong-space', url: 'https://source.test/wrong-space' },
          { snapshotTabId: 'row-file', url: 'file:///Users/me/saved-target.txt' },
          { snapshotTabId: 'row-stale', url: 'https://source.test/stale-session' },
        ],
      },
      {
        snapshotGroupId: 'group-other',
        tabs: [{ snapshotTabId: 'row-http', url: 'https://source.test/other-copy' }],
      },
      {
        tabs: [
          null,
          { snapshotTabId: 'row-no-group', url: 'https://source.test/no-group' },
          {
            snapshotTabId: 'row-row-group',
            snapshotGroupId: 'row-group',
            url: 'https://source.test/row-group',
          },
          { snapshotTabId: 'row-no-space', url: 'https://source.test/no-space' },
        ],
      },
    ],
  };

  const withoutFileAccess = planSpaceSwitch({
    tabs,
    state,
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    sourceSnapshot,
  });
  assert.deepEqual(withoutFileAccess.sourceClosableTabs.map((tab) => tab.id), [1, 11, 12]);

  const withFileAccess = planSpaceSwitch({
    tabs,
    state,
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    sourceSnapshot,
    fileSchemeAccess: true,
  });
  assert.deepEqual(withFileAccess.sourceClosableTabs.map((tab) => tab.id), [1, 9, 11, 12]);

  const withoutSourceSnapshot = planSpaceSwitch({
    tabs: [tabs[0], tabs.at(-1)],
    state: {
      ...state,
      tabSpaces: { 1: 'source', 20: 'target' },
    },
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
  });
  assert.deepEqual(withoutSourceSnapshot.sourceClosableTabs, []);

  function savedTargetBinding(snapshotTabId) {
    return {
      snapshotTabId,
      snapshotGroupId: 'group-source',
      spaceId: 'source',
      trackingMode: 'saved-target',
      sessionId: 'session-current',
    };
  }
});

test('Space switch matches foreign legacy tabs to snapshot rows one-to-one and respects stable groups', () => {
  const plan = planSpaceSwitch({
    tabs: [],
    state: {
      groupSpaces: {},
      tabSpaces: { 9: 'target', 10: 'target' },
      tabLifecycle: {
        9: { snapshotGroupId: 'group-b', spaceId: 'target' },
      },
    },
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    foreignLiveTabs: [
      { id: 9, groupId: -1, windowId: 2, url: 'https://same.test/across-groups' },
      { id: 10, groupId: -1, windowId: 3, url: 'https://same.test/duplicate' },
    ],
    targetSnapshot: {
      groups: [
        {
          snapshotGroupId: 'group-a',
          title: 'A',
          tabs: [
            { url: 'https://same.test/across-groups', title: 'Keep group A' },
            { url: 'https://same.test/duplicate', title: 'Consumed duplicate' },
            { url: 'https://same.test/duplicate', title: 'Keep duplicate' },
          ],
        },
        {
          snapshotGroupId: 'group-b',
          title: 'B',
          tabs: [{ url: 'https://same.test/across-groups', title: 'Open in group B' }],
        },
      ],
    },
  });

  assert.deepEqual(plan.restoreGroupIndexes, [0]);
  assert.deepEqual(plan.restoreGroups, [{
    snapshotGroupId: 'group-a',
    title: 'A',
    tabs: [
      { url: 'https://same.test/across-groups', title: 'Keep group A' },
      { url: 'https://same.test/duplicate', title: 'Keep duplicate' },
    ],
  }]);
  assert.deepEqual(plan.skippedRows.map((entry) => [
    entry.groupIndex,
    entry.tabIndex,
    entry.reason,
  ]), [
    [0, 1, SPACE_SWITCH_SKIP_REASONS.OPEN_IN_OTHER_WINDOW],
    [1, 0, SPACE_SWITCH_SKIP_REASONS.OPEN_IN_OTHER_WINDOW],
  ]);
  assert.deepEqual(plan.reasons, {
    [SPACE_SWITCH_SKIP_REASONS.OPEN_IN_OTHER_WINDOW]: 2,
  });
});

test('Space switch reports source indexes for stable-less restorable snapshot groups', () => {
  const plan = planSpaceSwitch({
    tabs: [],
    state: {},
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    targetSnapshot: {
      groups: [
        { title: 'Not restorable', tabs: [{ url: 'chrome://settings/' }] },
        { title: 'Legacy Tag', color: 'cyan', tabs: [{ url: 'https://legacy.test/' }] },
      ],
    },
  });

  assert.deepEqual(plan.restoreGroupIndexes, [1]);
  assert.deepEqual(plan.restoreGroups, [{
    title: 'Legacy Tag',
    color: 'cyan',
    tabs: [{ url: 'https://legacy.test/' }],
  }]);
  assert.equal(Object.hasOwn(plan.restoreGroups[0], 'groupIndex'), false);
});

test('Space switch requires an activated fallback before source closing when target is empty', () => {
  const plan = planSpaceSwitch({
    tabs: [],
    state: {},
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
  });

  assert.deepEqual(plan.sourceClosableTabs, []);
  assert.deepEqual(plan.targetLiveTabs, []);
  assert.deepEqual(plan.restoreGroups, []);
  assert.deepEqual(plan.restoreGroupIndexes, []);
  assert.deepEqual(plan.skippedRows, []);
  assert.equal(plan.needsFallback, true);
  assert.deepEqual(plan.phases, [
    { phase: 'materialize-target', required: true, mode: 'fallback-tab' },
    { phase: 'activate-target', required: true, after: 'materialize-target' },
    { phase: 'close-source', required: false, after: 'activate-target' },
  ]);
});

test('Space switch tolerates empty and partially shaped snapshot groups without mutating state', () => {
  const state = { groupSpaces: [], tabSpaces: [] };
  const snapshot = { groups: [null, { title: 'No rows' }, { title: 'Null rows', tabs: null }] };
  const frozen = structuredClone({ state, snapshot });

  const plan = planSpaceSwitch({
    tabs: [],
    state,
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    targetSnapshot: snapshot,
    foreignLiveTabs: null,
    fileSchemeAccess: null,
  });

  assert.equal(plan.needsFallback, true);
  assert.deepEqual(plan.restoreGroups, []);
  assert.deepEqual(plan.skippedRows, []);
  assert.deepEqual({ state, snapshot }, frozen);
});

test('Space switch rejects ambiguous or malformed top-level inputs', () => {
  const valid = {
    tabs: [],
    state: {},
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
  };
  const invalid = [
    [undefined, /options must be an object/],
    [[], /options must be an object/],
    [{ ...valid, tabs: {} }, /tabs must be an array/],
    [{ ...valid, state: null }, /state must be an object/],
    [{ ...valid, state: [] }, /state must be an object/],
    [{ ...valid, sourceSpaceId: 1 }, /sourceSpaceId must be a non-empty string/],
    [{ ...valid, sourceSpaceId: '   ' }, /sourceSpaceId must be a non-empty string/],
    [{ ...valid, targetSpaceId: null }, /targetSpaceId must be a non-empty string/],
    [{ ...valid, targetSpaceId: '' }, /targetSpaceId must be a non-empty string/],
    [{ ...valid, targetSpaceId: 'source' }, /Source and target Spaces must be different/],
    [{ ...valid, targetSnapshot: 1 }, /Target snapshot must be an object or null/],
    [{ ...valid, targetSnapshot: [] }, /Target snapshot must be an object or null/],
    [{ ...valid, targetSnapshot: { groups: {} } }, /snapshot groups must be an array/],
    [{ ...valid, sourceSnapshot: 1 }, /Source snapshot must be an object or null/],
    [{ ...valid, sourceSnapshot: [] }, /Source snapshot must be an object or null/],
    [{ ...valid, sourceSnapshot: { groups: {} } }, /Source snapshot groups must be an array/],
    [{ ...valid, foreignLiveTabs: {} }, /Foreign live tabs must be an array/],
    [{ ...valid, fileSchemeAccess: 'yes' }, /fileSchemeAccess must be a boolean/],
  ];

  for (const [input, pattern] of invalid) {
    assert.throws(() => planSpaceSwitch(input), pattern);
  }
});
