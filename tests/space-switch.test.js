import test from 'node:test';
import assert from 'node:assert/strict';

import {
  orderSpaceSwitchPhysicalIds,
  planSpaceSwitch,
  SPACE_SWITCH_PHASES,
} from '../src/shared/space-switch.js';

test('Space switch physical order keeps preferred ids first and live-only ids stable', () => {
  assert.deepEqual(
    orderSpaceSwitchPhysicalIds(
      [30, 10, 40, 20, 30, -1, 'bad', '', false, undefined],
      [20, 10, 999, 20, -1, null, true],
    ),
    [20, 10, 30, 40],
  );
  assert.deepEqual(orderSpaceSwitchPhysicalIds([3, 2, 1], []), [3, 2, 1]);
  assert.deepEqual(orderSpaceSwitchPhysicalIds(null, [1, 2]), []);
});

test('Space switch keeps every target Tag dormant and always activates only a New Tab keepalive', () => {
  const tabs = [
    { id: 1, groupId: -1, url: 'https://source.test/loose', custom: { owner: 'source' } },
    { id: 2, groupId: 10, url: 'https://source.test/grouped' },
    { id: 3, groupId: -1, url: 'https://source.test/pinned', pinned: true },
    { id: 4, groupId: -1, url: 'chrome://settings/' },
    { id: 5, groupId: 20, url: 'https://target.test/already-live' },
  ];
  const state = {
    groupSpaces: { 10: 'source', 20: 'target' },
    tabSpaces: { 1: 'source', 3: 'source', 4: 'source' },
  };
  const targetSnapshot = {
    groups: [{
      snapshotGroupId: 'target-group',
      title: 'Large dormant TagGroup',
      tabs: Array.from({ length: 100 }, (_, index) => ({
        snapshotTabId: `target-row-${index}`,
        url: `https://target.test/${index}`,
      })),
    }],
  };
  const frozen = structuredClone({ tabs, state, targetSnapshot });

  const plan = planSpaceSwitch({
    tabs,
    state,
    sourceSpaceId: ' source ',
    targetSpaceId: ' target ',
    targetSnapshot,
    foreignLiveTabs: [{ id: 99, groupId: 30, url: 'https://target.test/foreign' }],
  });

  assert.deepEqual(plan.sourceClosableTabs.map((tab) => tab.id), [1, 2]);
  assert.deepEqual(plan.targetLiveTabs, []);
  assert.deepEqual(plan.restoreGroups, []);
  assert.deepEqual(plan.restoreGroupIndexes, []);
  assert.deepEqual(plan.skippedRows, []);
  assert.deepEqual(plan.reasons, {});
  assert.equal(plan.needsFallback, true);
  assert.deepEqual(plan.executionOrder, [
    SPACE_SWITCH_PHASES.MATERIALIZE_TARGET,
    SPACE_SWITCH_PHASES.ACTIVATE_TARGET,
    SPACE_SWITCH_PHASES.CLOSE_SOURCE,
  ]);
  assert.deepEqual(plan.phases, [
    { phase: 'materialize-target', required: true, mode: 'fallback-tab' },
    { phase: 'activate-target', required: true, after: 'materialize-target' },
    { phase: 'close-source', required: true, after: 'activate-target' },
  ]);
  assert.equal(plan.sourceClosePrecondition, 'target-activated');
  assert.equal(plan.sourceSpaceId, 'source');
  assert.equal(plan.targetSpaceId, 'target');
  assert.notEqual(plan.sourceClosableTabs[0], tabs[0]);
  plan.sourceClosableTabs[0].custom.owner = 'changed';
  assert.deepEqual({ tabs, state, targetSnapshot }, frozen);
});

test('Space switch still prepares a keepalive when there are no source tabs to close', () => {
  const plan = planSpaceSwitch({
    tabs: [],
    state: { groupSpaces: [], tabSpaces: [] },
    sourceSpaceId: 'source',
    targetSpaceId: 'target',
    targetSnapshot: { groups: [null, { title: 'Empty', tabs: null }] },
    foreignLiveTabs: null,
    fileSchemeAccess: null,
  });

  assert.equal(plan.needsFallback, true);
  assert.deepEqual(plan.phases, [
    { phase: 'materialize-target', required: true, mode: 'fallback-tab' },
    { phase: 'activate-target', required: true, after: 'materialize-target' },
    { phase: 'close-source', required: false, after: 'activate-target' },
  ]);
});

test('Space switch closes a navigated saved target only when its source row is uniquely recoverable', () => {
  const tabs = Array.from({ length: 14 }, (_, index) => ({
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
      ...tabs.slice(0, 14).map((tab) => [tab.id, 'source']),
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
      11: { ...savedTargetBinding('row-no-group'), snapshotGroupId: '' },
      12: { ...savedTargetBinding('row-row-group'), snapshotGroupId: 'row-group' },
      13: { snapshotTabId: 'row-no-space', trackingMode: 'saved-target' },
      14: 1,
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
    state: { ...state, tabSpaces: { 1: 'source', 20: 'target' } },
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
    [{ ...valid, sourceSnapshot: { groups: {} } }, /snapshot groups must be an array/],
    [{ ...valid, foreignLiveTabs: {} }, /Foreign live tabs must be an array/],
    [{ ...valid, fileSchemeAccess: 'yes' }, /fileSchemeAccess must be a boolean/],
  ];

  for (const [input, pattern] of invalid) {
    assert.throws(() => planSpaceSwitch(input), pattern);
  }
});
