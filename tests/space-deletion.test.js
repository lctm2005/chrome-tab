import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectSpaceDeletionRollbackFailures,
  createCommittedSpaceDeletionError,
  createSpaceDeletionRollbackJournal,
  planSpaceDeletionPlaceholderCleanup,
  planSpaceDeletionWindowKeepalives,
  projectSpaceDeletionPlaceholderMetadata,
  projectSpaceDeletionRecoveryState,
  projectSpaceDeletionRollbackState,
  spaceDeletionCloseCandidateMismatch,
  spaceDeletionIntentFingerprint,
} from '../src/shared/space-deletion.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function deletionIntentFixture() {
  return {
    spaces: [
      { id: 'work', name: 'Work', icon: 'W', color: 'blue' },
      { id: 'default', name: 'Default', icon: 'D', color: 'grey' },
      { id: 'later', name: 'Later', icon: 'L', color: 'purple' },
    ],
    spaceContexts: { work: '# Launch context', later: '# Unrelated context' },
    spaceSnapshots: {
      work: {
        version: 1,
        identityVersion: 1,
        updatedAt: 10,
        groups: [{
          snapshotGroupId: 'group-work',
          title: 'Launch',
          color: 'blue',
          collapsed: false,
          tabs: [
            {
              snapshotTabId: 'live-row',
              title: 'Live page',
              url: 'https://example.test/live',
            },
            {
              snapshotTabId: 'saved-row',
              title: 'Saved only',
              panelTitle: 'Review later',
              url: 'https://example.test/saved',
            },
          ],
        }],
      },
      later: {
        groups: [{
          title: 'Unrelated',
          color: 'purple',
          tabs: [{ title: 'Other', url: 'https://other.test/' }],
        }],
      },
    },
    askSessions: {
      'space:work': {
        key: 'space:work',
        spaceId: 'work',
        title: 'Work',
        url: '',
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { id: 'q1', role: 'user', text: 'What is left?', createdAt: 1 },
          { id: 'a1', role: 'assistant', text: 'One saved task.', createdAt: 2 },
        ],
      },
    },
  };
}

function deletionIntentPlan() {
  return {
    closingTabs: [{
      id: 7,
      windowId: 10,
      groupId: 20,
      pinned: false,
      url: 'https://example.test/live',
      snapshotGroupId: 'group-work',
      snapshotTabId: 'live-row',
    }],
    preservedPinnedTabs: [{
      id: 8,
      windowId: 10,
      groupId: -1,
      pinned: true,
      url: 'https://example.test/pinned',
    }],
  };
}

test('Space deletion intent fingerprints every reviewed content owner without mutating it', () => {
  const state = deepFreeze(deletionIntentFixture());
  const plan = deepFreeze(deletionIntentPlan());
  const original = spaceDeletionIntentFingerprint({ state, deletingSpaceId: 'work', plan });
  assert.match(original, /^space-deletion-intent-v1:/);

  const viewOnly = deletionIntentFixture();
  viewOnly.activeSpaceId = 'later';
  viewOnly.spaceSnapshots.work.updatedAt = 999;
  viewOnly.spaceSnapshots.work.groups[0].collapsed = true;
  viewOnly.spaceSnapshots.work.groups[0].snapshotGroupId = 'new-generated-group-id';
  viewOnly.spaceSnapshots.work.groups[0].tabs[0].snapshotTabId = 'new-generated-live-id';
  viewOnly.spaceSnapshots.work.groups[0].tabs[1].snapshotTabId = 'new-generated-saved-id';
  viewOnly.askSessions['space:work'].updatedAt = 999;
  viewOnly.askSessions['space:work'].messages[0].id = 'generated-id';
  viewOnly.askSessions['space:work'].messages[0].createdAt = 999;
  viewOnly.spaceContexts.later = '# Changed elsewhere';
  viewOnly.spaces[2].name = 'Changed elsewhere';
  assert.equal(spaceDeletionIntentFingerprint({
    state: viewOnly,
    deletingSpaceId: 'work',
    plan,
  }), original);

  for (const mutate of [
    (next) => { next.spaces[0].name = 'Renamed Work'; },
    (next) => { next.spaces[1].name = 'Renamed fallback'; },
    (next) => { next.spaceContexts.work = '# Revised context'; },
    (next) => { next.spaceSnapshots.work.groups[0].tabs[1].title = 'Revised saved title'; },
    (next) => { next.spaceSnapshots.work.groups[0].tabs[1].url += '?revised=1'; },
    (next) => { next.spaceSnapshots.work.groups[0].tabs[1].panelTitle = 'Do now'; },
    (next) => { next.askSessions['space:work'].messages[1].text = 'Two saved tasks.'; },
    (next) => { next.askSessions['space:work'].messages.push({ role: 'user', text: 'New question' }); },
  ]) {
    const changed = deletionIntentFixture();
    mutate(changed);
    assert.notEqual(spaceDeletionIntentFingerprint({
      state: changed,
      deletingSpaceId: 'work',
      plan,
    }), original);
  }

  for (const mutate of [
    (nextPlan) => { nextPlan.closingTabs[0].url = 'https://example.test/replaced'; },
    (nextPlan) => { nextPlan.closingTabs[0].windowId = 11; },
    (nextPlan) => { nextPlan.closingTabs[0].groupId = -1; },
    (nextPlan) => { nextPlan.preservedPinnedTabs.push(nextPlan.closingTabs.pop()); },
  ]) {
    const changedPlan = deletionIntentPlan();
    mutate(changedPlan);
    assert.notEqual(spaceDeletionIntentFingerprint({
      state: deletionIntentFixture(),
      deletingSpaceId: 'work',
      plan: changedPlan,
    }), original);
  }
});

test('Space deletion intent stays stable when live rows are checkpointed but detects saved-only duplicates', () => {
  const state = deletionIntentFixture();
  const plan = deletionIntentPlan();
  const original = spaceDeletionIntentFingerprint({ state, deletingSpaceId: 'work', plan });

  const checkpointed = structuredClone(state);
  checkpointed.spaceSnapshots.work.groups[0].tabs.unshift({
    snapshotTabId: 'pinned-checkpoint-row',
    title: 'Pinned page',
    url: 'https://example.test/pinned',
  });
  assert.equal(spaceDeletionIntentFingerprint({
    state: checkpointed,
    deletingSpaceId: 'work',
    plan,
  }), original);

  const comparableNavigation = structuredClone(state);
  comparableNavigation.spaceSnapshots.work.groups[0].tabs[0].snapshotTabId = '';
  comparableNavigation.spaceSnapshots.work.groups[0].tabs[0].url = 'https://example.test/live?stored=1';
  const planWithoutIdentity = structuredClone(plan);
  planWithoutIdentity.closingTabs[0].snapshotTabId = '';
  planWithoutIdentity.closingTabs[0].url = 'https://example.test/live?current=2';
  const withoutLiveSnapshot = structuredClone(comparableNavigation);
  withoutLiveSnapshot.spaceSnapshots.work.groups[0].tabs.shift();
  assert.equal(spaceDeletionIntentFingerprint({
    state: comparableNavigation,
    deletingSpaceId: 'work',
    plan: planWithoutIdentity,
  }), spaceDeletionIntentFingerprint({
    state: withoutLiveSnapshot,
    deletingSpaceId: 'work',
    plan: planWithoutIdentity,
  }));

  const duplicates = deletionIntentFixture();
  duplicates.spaceSnapshots.work.groups[0].tabs.push({
    snapshotTabId: 'saved-duplicate',
    title: 'Live URL saved twice',
    url: 'https://example.test/live',
  });
  assert.notEqual(spaceDeletionIntentFingerprint({
    state: duplicates,
    deletingSpaceId: 'work',
    plan,
  }), original);
});

test('Space deletion intent follows fallback selection and tolerates absent optional data', () => {
  const state = deletionIntentFixture();
  const withDefault = spaceDeletionIntentFingerprint({ state, deletingSpaceId: 'work' });
  state.spaces = [state.spaces[0], state.spaces[2], state.spaces[1]];
  assert.equal(spaceDeletionIntentFingerprint({ state, deletingSpaceId: 'work' }), withDefault);

  state.spaces = state.spaces.filter((space) => space.id !== 'default');
  assert.notEqual(spaceDeletionIntentFingerprint({ state, deletingSpaceId: 'work' }), withDefault);
  assert.match(spaceDeletionIntentFingerprint(), /^space-deletion-intent-v1:/);
  assert.doesNotThrow(() => spaceDeletionIntentFingerprint({
    state: [],
    deletingSpaceId: 'missing',
    plan: { closingTabs: null, preservedPinnedTabs: [{ id: 'invalid' }] },
  }));
  assert.doesNotThrow(() => spaceDeletionIntentFingerprint({
    state: {
      spaces: [{ id: 'work', name: 'Work' }],
      spaceSnapshots: { work: { groups: 'invalid' } },
      askSessions: { 'space:work': { messages: null } },
    },
    deletingSpaceId: 'work',
  }));
});

test('Space deletion intent normalizes sparse tabs, snapshots, sessions, and Space identities', () => {
  const sparse = {
    spaces: [null, { id: 'work' }],
    spaceSnapshots: {
      work: {
        groups: [{
          title: 'Only live rows',
          tabs: [{ title: 'Pending', url: 'https://pending.test/' }],
        }],
      },
    },
    askSessions: {
      'space:work': {
        url: 'https://conversation.test/',
        messages: [
          { role: 'system', text: '' },
          { role: 'assistant', text: 'Retained answer' },
        ],
      },
    },
  };
  const sparsePlan = {
    closingTabs: [{
      id: 1,
      windowId: 'not-a-window',
      groupId: 'not-a-group',
      pendingUrl: 'https://pending.test/',
    }],
    preservedPinnedTabs: [{ id: 1 }],
  };
  const fingerprint = spaceDeletionIntentFingerprint({
    state: sparse,
    deletingSpaceId: 'work',
    plan: sparsePlan,
  });
  assert.match(fingerprint, /"windowId":null,"groupId":null/);
  assert.match(fingerprint, /"savedOnlySnapshot":null/);
  assert.match(fingerprint, /Retained answer/);

  const unmatched = structuredClone(sparse);
  unmatched.spaceSnapshots.work.groups[0].tabs[0].url = 'https://saved-only.test/';
  assert.notEqual(spaceDeletionIntentFingerprint({
    state: unmatched,
    deletingSpaceId: 'work',
    plan: sparsePlan,
  }), fingerprint);

  assert.doesNotThrow(() => spaceDeletionIntentFingerprint({
    state: {
      spaces: [{ id: 'work', name: 'Work' }],
      spaceSnapshots: {
        work: {
          identityVersion: 1,
          groups: [{
            title: '',
            tabs: [
              { title: 'Saved first', url: 'https://saved-first.test/' },
              { snapshotTabId: 'matched-id', title: 'Live second', url: 'https://live-second.test/' },
            ],
          }],
        },
      },
      askSessions: { 'space:work': { messages: [] } },
    },
    deletingSpaceId: 'work',
    plan: {
      closingTabs: [{
        id: 2,
        url: 'https://live-second.test/',
        snapshotTabId: 'matched-id',
      }],
    },
  }));

  assert.doesNotThrow(() => spaceDeletionIntentFingerprint({
    state: { spaces: [{ id: null }] },
    deletingSpaceId: '',
  }));
});

test('close candidates fail closed when identity, placement, URL, pin, or Space ownership changes', () => {
  const expected = deepFreeze({
    id: 42,
    windowId: 7,
    groupId: -1,
    pinned: false,
    url: 'https://reviewed.test/',
    snapshotTabId: 'stable-tab-42',
    sessionId: 'session-one',
  });
  const current = { ...expected };
  const state = {
    tabSpaces: { 42: 'deleting' },
    groupSpaces: { 9: 'deleting', 10: 'other' },
  };
  const check = (tab, overrides = {}) => spaceDeletionCloseCandidateMismatch({
    expectedTab: expected,
    currentTabs: [tab],
    state,
    deletingSpaceId: 'deleting',
    ...overrides,
  });

  assert.equal(check(current), '');
  assert.equal(spaceDeletionCloseCandidateMismatch(), 'missing-or-replaced');
  assert.equal(check(current, { currentTabs: null }), 'missing-or-replaced');
  assert.equal(check(current, { currentTabs: [] }), 'missing-or-replaced');
  assert.equal(check(current, { currentTabs: [current, { ...current }] }), 'missing-or-replaced');
  assert.equal(check({ ...current, pinned: true }), 'pinned');
  assert.equal(check({ ...current, windowId: 8 }), 'moved-window');
  assert.equal(check({ ...current, groupId: 9 }), 'moved-group');
  assert.equal(check({ ...current, pendingUrl: 'https://new.test/' }), 'navigated');
  assert.equal(check({ ...current, snapshotTabId: 'replacement-row' }), 'stable-identity-changed');
  assert.equal(check({ ...current, snapshotTabId: undefined }), 'stable-identity-changed');
  assert.equal(check({ ...current, sessionId: 'session-two' }), 'stable-identity-changed');
  assert.equal(check({ ...current, sessionId: undefined }), 'stable-identity-changed');
  assert.equal(check(current, {
    state: { ...state, tabSpaces: { 42: 'other' } },
  }), 'moved-space');
  assert.equal(check(current, { deletingSpaceId: '' }), 'moved-space');

  const grouped = { ...current, groupId: 9 };
  assert.equal(spaceDeletionCloseCandidateMismatch({
    expectedTab: grouped,
    currentTabs: [grouped],
    state,
    deletingSpaceId: 'deleting',
  }), '');
  assert.equal(spaceDeletionCloseCandidateMismatch({
    expectedTab: { ...grouped, groupId: 10 },
    currentTabs: [{ ...grouped, groupId: 10 }],
    state,
    deletingSpaceId: 'deleting',
  }), 'moved-space');
  assert.equal(spaceDeletionCloseCandidateMismatch({
    expectedTab: grouped,
    currentTabs: [grouped],
    state: {},
    deletingSpaceId: 'deleting',
  }), 'moved-space');
  assert.equal(spaceDeletionCloseCandidateMismatch({
    expectedTab: current,
    currentTabs: [current],
    state: {},
    deletingSpaceId: 'deleting',
  }), 'moved-space');

  const legacy = {
    id: 43,
    windowId: 7,
    groupId: -1,
    pinned: false,
    pendingUrl: 'https://legacy.test/',
  };
  assert.equal(spaceDeletionCloseCandidateMismatch({
    expectedTab: legacy,
    currentTabs: [{ ...legacy }],
    state: { tabSpaces: { 43: 'deleting' } },
    deletingSpaceId: 'deleting',
  }), '');
  assert.equal(spaceDeletionCloseCandidateMismatch({
    expectedTab: { id: 44, windowId: 7, groupId: -1 },
    currentTabs: [{ id: 44, windowId: 7, groupId: -1 }],
    state: { tabSpaces: { 44: 'deleting' } },
    deletingSpaceId: 'deleting',
  }), '');
});

test('inactive deletion captures an independent rollback journal without changing the active Space', () => {
  const beforeState = deepFreeze({
    activeSpaceId: 'active',
    spaces: [{ id: 'active' }, { id: 'inactive' }],
  });
  const windowSpaceState = deepFreeze({
    activeSpaceIds: { 10: 'active', 20: 'inactive' },
  });

  const journal = createSpaceDeletionRollbackJournal({
    beforeState,
    deletingSpaceId: 'inactive',
    durableActiveSpaceId: 'active',
    windowSpaceState,
    activeView: 'ask',
    deletingActiveSpace: false,
  });

  assert.deepEqual(journal, {
    beforeState,
    deletingSpaceId: 'inactive',
    durableActiveSpaceId: 'active',
    windowSpaceState,
    activeView: 'ask',
    deletingActiveSpace: false,
    createdTabIds: [],
    checkpointState: null,
    closedTabIds: [],
  });
  assert.notStrictEqual(journal.beforeState, beforeState);
  assert.notStrictEqual(journal.windowSpaceState, windowSpaceState);
  journal.beforeState.activeSpaceId = 'changed-only-in-journal';
  assert.equal(beforeState.activeSpaceId, 'active');

  assert.deepEqual(createSpaceDeletionRollbackJournal({
    beforeState: null,
    deletingSpaceId: null,
    durableActiveSpaceId: null,
    windowSpaceState: null,
    activeView: '',
    deletingActiveSpace: 1,
  }), {
    beforeState: {},
    deletingSpaceId: '',
    durableActiveSpaceId: '',
    windowSpaceState: {},
    activeView: 'space',
    deletingActiveSpace: true,
    createdTabIds: [],
    checkpointState: null,
    closedTabIds: [],
  });
  assert.deepEqual(createSpaceDeletionRollbackJournal(), {
    beforeState: {},
    deletingSpaceId: '',
    durableActiveSpaceId: '',
    windowSpaceState: {},
    activeView: 'space',
    deletingActiveSpace: false,
    createdTabIds: [],
    checkpointState: null,
    closedTabIds: [],
  });
});

test('inactive rollback restores its latest snapshot while preserving current selection and placeholder ownership', () => {
  const beforeState = deepFreeze({
    activeSpaceId: 'active',
    spaces: [{ id: 'active' }, { id: 'inactive' }, { id: 'fallback' }],
    spaceSnapshots: {
      active: { groups: [{ tabs: [{ url: 'https://active.test/' }] }] },
      inactive: { groups: [{ tabs: [{ url: 'https://stale.test/' }] }] },
    },
    tabSpaces: { 7: 'active', 90: 'fallback', 91: 'fallback' },
    tabGroups: { 90: 'temporary', 91: 'temporary' },
    renamedTabs: { 90: 'Temporary', 91: 'Temporary' },
    tabLifecycle: {
      7: { tabId: 7, spaceId: 'active', trackingMode: 'live' },
      old: { snapshotTabId: 'old', spaceId: 'inactive' },
    },
    ephemeralTabIds: [],
  });
  const checkpointState = deepFreeze({
    activeSpaceId: 'active',
    spaceSnapshots: {
      inactive: { groups: [{ tabs: [{ url: 'https://latest.test/' }] }] },
    },
    tabLifecycle: {
      latest: { snapshotTabId: 'latest', spaceId: 'inactive' },
    },
  });

  const rollback = projectSpaceDeletionRollbackState({
    beforeState,
    checkpointState,
    deletingSpaceId: 'inactive',
    createdTabIds: [90, 91],
  });

  assert.equal(rollback.restoreActiveSpaceId, 'active');
  assert.equal(rollback.placeholderSpaceId, 'inactive');
  assert.equal(rollback.retainAsEphemeral, true);
  assert.equal(rollback.state.activeSpaceId, 'active');
  assert.equal(
    rollback.state.spaceSnapshots.inactive.groups[0].tabs[0].url,
    'https://latest.test/',
  );
  assert.equal(rollback.state.spaceSnapshots.active.groups[0].tabs[0].url, 'https://active.test/');
  assert.deepEqual(rollback.state.ephemeralTabIds, [90, 91]);
  assert.deepEqual(rollback.state.tabSpaces, { 7: 'active' });
  assert.deepEqual(rollback.state.tabLifecycle, {
    7: { tabId: 7, spaceId: 'active', trackingMode: 'live' },
    latest: { snapshotTabId: 'latest', spaceId: 'inactive' },
  });

  assert.deepEqual(planSpaceDeletionWindowKeepalives([
    { id: 1, windowId: 10 },
    { id: 2, windowId: 10 },
    { id: 3, windowId: 20 },
    { id: 4, windowId: 20 },
  ], [1, 2, 3]), [10]);

  const cleanup = planSpaceDeletionPlaceholderCleanup([
    { id: 90, windowId: 30, url: 'chrome://newtab/' },
    { id: 91, windowId: 30, pinned: true, url: 'https://user.test/' },
  ], [90, 91]);
  assert.deepEqual(cleanup, {
    closeTabIds: [90],
    retainTabIds: [91],
    retainLiveTabIds: [91],
    missingTabIds: [],
  });

  const cleaned = projectSpaceDeletionPlaceholderMetadata(rollback.state, {
    removedTabIds: cleanup.closeTabIds,
    retainedTabIds: cleanup.retainTabIds,
    liveRetainedTabIds: cleanup.retainLiveTabIds,
    restoreSpaceId: rollback.placeholderSpaceId,
    retainAsEphemeral: rollback.retainAsEphemeral,
  });
  assert.equal(cleaned.activeSpaceId, 'active');
  assert.deepEqual(cleaned.tabSpaces, { 7: 'active', 91: 'inactive' });
  assert.deepEqual(cleaned.ephemeralTabIds, []);

  assert.deepEqual(projectSpaceDeletionRollbackState(), {
    state: {
      tabSpaces: {},
      tabGroups: {},
      renamedTabs: {},
      tabLifecycle: {},
      ephemeralTabIds: [],
    },
    restoreActiveSpaceId: '',
    placeholderSpaceId: '',
    retainAsEphemeral: false,
  });
  assert.equal(projectSpaceDeletionRollbackState({
    deletingSpaceId: 'inactive',
  }).restoreActiveSpaceId, 'inactive');
});

test('rollback keeps recovery rows while removing every known closed live identity', () => {
  const beforeState = deepFreeze({
    activeSpaceId: 'deleting',
    spaces: [{ id: 'deleting' }, { id: 'fallback' }],
    spaceSnapshots: {
      deleting: { groups: [{ title: 'Stale', tabs: [{ url: 'https://stale.test/' }] }] },
    },
    tabSpaces: { 11: 'deleting', 12: 'deleting', 20: 'fallback', 90: 'fallback' },
    tabGroups: { 11: 'virtual-a', 12: 'virtual-b', 20: 'keep', 90: 'temporary' },
    renamedTabs: { 11: 'Closed one', 12: 'Closed two', 20: 'Kept', 90: 'Temporary' },
    tabLifecycle: {
      11: { tabId: 11, snapshotTabId: 'old-11', spaceId: 'deleting' },
      12: { tabId: 12, snapshotTabId: 'old-12', spaceId: 'deleting' },
      20: { tabId: 20, snapshotTabId: 'keep-20', spaceId: 'fallback' },
      90: { tabId: 90, spaceId: 'fallback' },
    },
    tabOrder: {
      deleting: {
        'group:5': [11, 12, 30],
        ungrouped: [12],
      },
      fallback: { keep: [20, 11, 90] },
    },
    ephemeralTabIds: [11, 90, 99],
  });
  const checkpointState = deepFreeze({
    activeSpaceId: 'fallback',
    spaceSnapshots: {
      deleting: {
        version: 1,
        identityVersion: 1,
        updatedAt: 50,
        groups: [{
          snapshotGroupId: 'recovery-group',
          title: 'Recovered',
          color: 'blue',
          tabs: [
            { snapshotTabId: 'row-11', title: 'Closed one', url: 'https://closed.test/one' },
            { snapshotTabId: 'row-12', title: 'Closed two', url: 'https://closed.test/two' },
          ],
        }],
      },
    },
    tabLifecycle: {
      11: { tabId: 11, snapshotTabId: 'row-11', spaceId: 'deleting' },
      12: { tabId: 12, snapshotTabId: 'row-12', spaceId: 'deleting' },
      30: { tabId: 30, snapshotTabId: 'row-30', spaceId: 'deleting' },
    },
  });
  const beforeCopy = structuredClone(beforeState);
  const checkpointCopy = structuredClone(checkpointState);

  const rollback = projectSpaceDeletionRollbackState({
    beforeState,
    checkpointState,
    deletingSpaceId: 'deleting',
    createdTabIds: [90],
    closedTabIds: [11, '12', 12, 90, -1, 'invalid'],
  });

  assert.deepEqual(
    rollback.state.spaceSnapshots.deleting,
    checkpointState.spaceSnapshots.deleting,
    'closed live ids never remove their stable recovery rows',
  );
  assert.deepEqual(rollback.state.tabSpaces, { 20: 'fallback' });
  assert.deepEqual(rollback.state.tabGroups, { 20: 'keep' });
  assert.deepEqual(rollback.state.renamedTabs, { 20: 'Kept' });
  assert.deepEqual(rollback.state.tabLifecycle, {
    20: { tabId: 20, snapshotTabId: 'keep-20', spaceId: 'fallback' },
    30: { tabId: 30, snapshotTabId: 'row-30', spaceId: 'deleting' },
  });
  assert.deepEqual(rollback.state.tabOrder, {
    deleting: { 'group:5': [30], ungrouped: [] },
    fallback: { keep: [20] },
  });
  assert.deepEqual(rollback.state.ephemeralTabIds, [99]);
  assert.deepEqual(beforeState, beforeCopy);
  assert.deepEqual(checkpointState, checkpointCopy);
});

test('recovery restores pre-transition state with the latest deleting-Space checkpoint', () => {
  const beforeState = deepFreeze({
    activeSpaceId: 'deleting',
    spaces: [{ id: 'deleting' }, { id: 'fallback' }],
    collapsedGroups: { original: true },
    spaceSnapshots: {
      deleting: { updatedAt: 1, groups: [{ title: 'Old', tabs: [] }] },
      fallback: { updatedAt: 2, groups: [{ title: 'Fallback before', tabs: [] }] },
    },
    tabLifecycle: {
      1: { snapshotTabId: 'old-row', spaceId: 'deleting' },
      2: { snapshotTabId: 'fallback-before', spaceId: 'fallback' },
      stale: null,
    },
  });
  const checkpointState = deepFreeze({
    activeSpaceId: 'fallback',
    collapsedGroups: { transition: true },
    spaceSnapshots: {
      deleting: {
        updatedAt: 3,
        groups: [{ title: 'Latest', tabs: [{ title: 'Saved', url: 'https://latest.test' }] }],
      },
      fallback: { updatedAt: 4, groups: [{ title: 'Fallback changed', tabs: [] }] },
    },
    tabLifecycle: {
      1: { snapshotTabId: 'latest-row', spaceId: 'deleting' },
      3: { snapshotTabId: 'new-row', spaceId: 'deleting' },
      4: { snapshotTabId: 'fallback-transition', spaceId: 'fallback' },
      ignored: null,
    },
  });
  const beforeCopy = structuredClone(beforeState);
  const checkpointCopy = structuredClone(checkpointState);

  const recovered = projectSpaceDeletionRecoveryState({
    beforeState,
    checkpointState,
    deletingSpaceId: 'deleting',
  });

  assert.equal(recovered.activeSpaceId, 'deleting');
  assert.deepEqual(recovered.collapsedGroups, { original: true });
  assert.deepEqual(recovered.spaceSnapshots.deleting, checkpointState.spaceSnapshots.deleting);
  assert.deepEqual(recovered.spaceSnapshots.fallback, beforeState.spaceSnapshots.fallback);
  assert.deepEqual(recovered.tabLifecycle, {
    1: { snapshotTabId: 'latest-row', spaceId: 'deleting' },
    2: { snapshotTabId: 'fallback-before', spaceId: 'fallback' },
    3: { snapshotTabId: 'new-row', spaceId: 'deleting' },
    stale: null,
  });
  assert.notStrictEqual(recovered, beforeState);
  assert.notStrictEqual(recovered.spaceSnapshots.deleting, checkpointState.spaceSnapshots.deleting);
  recovered.spaceSnapshots.deleting.groups[0].title = 'Output only';
  assert.deepEqual(beforeState, beforeCopy);
  assert.deepEqual(checkpointState, checkpointCopy);
});

test('an authoritative checkpoint without the deleting snapshot removes a stale old copy', () => {
  const recovered = projectSpaceDeletionRecoveryState({
    beforeState: {
      activeSpaceId: 'deleting',
      spaceSnapshots: {
        deleting: { groups: [{ title: 'Stale' }] },
        keep: { groups: [{ title: 'Keep' }] },
      },
      tabLifecycle: {
        1: { snapshotTabId: 'stale', spaceId: 'deleting' },
        2: { snapshotTabId: 'keep', spaceId: 'keep' },
      },
    },
    checkpointState: {
      spaceSnapshots: { keep: { groups: [] } },
      tabLifecycle: {
        3: { snapshotTabId: 'latest', spaceId: 'deleting' },
        4: { snapshotTabId: 'ignored', spaceId: 'keep' },
      },
    },
    deletingSpaceId: 'deleting',
  });

  assert.equal(Object.hasOwn(recovered.spaceSnapshots, 'deleting'), false);
  assert.equal(recovered.spaceSnapshots.keep.groups[0].title, 'Keep');
  assert.deepEqual(recovered.tabLifecycle, {
    2: { snapshotTabId: 'keep', spaceId: 'keep' },
    3: { snapshotTabId: 'latest', spaceId: 'deleting' },
  });
  assert.equal(Object.hasOwn(projectSpaceDeletionRecoveryState({
    beforeState: {
      spaceSnapshots: { deleting: { groups: [] } },
      tabLifecycle: { 1: { spaceId: 'deleting' } },
    },
    checkpointState: {
      spaceSnapshots: { deleting: null },
      tabLifecycle: {},
    },
    deletingSpaceId: 'deleting',
  }).tabLifecycle, '1'), false);
});

test('recovery handles missing state, checkpoint, identity, and snapshot collections immutably', () => {
  const beforeState = { activeSpaceId: 'deleting', spaceSnapshots: null };

  assert.deepEqual(projectSpaceDeletionRecoveryState(), {});
  assert.deepEqual(projectSpaceDeletionRecoveryState({ beforeState: null }), {});
  assert.deepEqual(projectSpaceDeletionRecoveryState({ beforeState, deletingSpaceId: '' }), beforeState);
  assert.deepEqual(projectSpaceDeletionRecoveryState({
    beforeState,
    checkpointState: {},
    deletingSpaceId: 'deleting',
  }), beforeState);
  assert.deepEqual(projectSpaceDeletionRecoveryState({
    beforeState: { activeSpaceId: 'deleting' },
    checkpointState: { spaceSnapshots: { deleting: { groups: [] } } },
    deletingSpaceId: 'deleting',
  }), {
    activeSpaceId: 'deleting',
    spaceSnapshots: { deleting: { groups: [] } },
  });
  assert.deepEqual(projectSpaceDeletionRecoveryState({
    beforeState: { tabLifecycle: { 1: { spaceId: 'deleting' } } },
    checkpointState: { spaceSnapshots: {}, tabLifecycle: [] },
    deletingSpaceId: 'deleting',
  }), { tabLifecycle: { 1: { spaceId: 'deleting' } } });
});

test('placeholder cleanup closes safe candidates and retains one keepalive per empty window', () => {
  const tabs = deepFreeze([
    { id: 1, windowId: 10 },
    { id: 10, windowId: 10, url: 'chrome://newtab/' },
    { id: 20, windowId: 20, active: true, url: 'chrome://newtab' },
    { id: 21, windowId: 20, url: 'chrome://newtab/' },
    { id: 30, windowId: 30, url: 'chrome://newtab/' },
    { id: 40, url: 'chrome://newtab/' },
    { id: 'bad', windowId: 40 },
  ]);
  const before = structuredClone(tabs);

  const plan = planSpaceDeletionPlaceholderCleanup(
    tabs,
    [10, 20, 21, 30, 40, 99, 10, 'invalid', 1.5],
  );

  assert.deepEqual(plan, {
    closeTabIds: [10, 21],
    retainTabIds: [40, 20, 30],
    retainLiveTabIds: [],
    missingTabIds: [99],
  });
  assert.deepEqual(tabs, before);
});

test('a window without an active candidate retains the newest created tab', () => {
  assert.deepEqual(planSpaceDeletionPlaceholderCleanup([
    { id: 60, windowId: 6, url: 'chrome://newtab/' },
    { id: 61, windowId: 6, url: 'chrome://newtab/' },
  ], [60, 61]), {
    closeTabIds: [60],
    retainTabIds: [61],
    retainLiveTabIds: [],
    missingTabIds: [],
  });
});

test('cleanup accepts tab zero and malformed optional collections conservatively', () => {
  assert.deepEqual(planSpaceDeletionPlaceholderCleanup([
    { id: 0, windowId: 0, active: true, url: 'chrome://newtab/' },
    null,
    { id: -1, windowId: 0 },
    { id: 2, windowId: -1, url: 'chrome://newtab/' },
  ], [0, 2]), {
    closeTabIds: [],
    retainTabIds: [2, 0],
    retainLiveTabIds: [],
    missingTabIds: [],
  });
  assert.deepEqual(planSpaceDeletionPlaceholderCleanup(null, null), {
    closeTabIds: [],
    retainTabIds: [],
    retainLiveTabIds: [],
    missingTabIds: [],
  });
});

test('cleanup never closes a placeholder that was pinned or navigated by the user', () => {
  assert.deepEqual(planSpaceDeletionPlaceholderCleanup([
    { id: 70, windowId: 7, pinned: true, url: 'chrome://newtab/' },
    { id: 71, windowId: 7, url: 'https://user.test/' },
    { id: 72, windowId: 7, url: 'chrome://newtab/', pendingUrl: 'https://loading.test/' },
    { id: 73, windowId: 7, url: 'chrome://newtab/' },
  ], [70, 71, 72, 73]), {
    closeTabIds: [73],
    retainTabIds: [70, 71, 72],
    retainLiveTabIds: [70, 71, 72],
    missingTabIds: [],
  });
});

test('checkpoint keepalives follow the current target windows and current survivors', () => {
  const tabs = deepFreeze([
    { id: 1, windowId: 10 },
    { id: 2, windowId: 10 },
    { id: 3, windowId: 20 },
    { id: 4, windowId: 30 },
    { id: 5, windowId: 30 },
    { id: 6 },
  ]);

  assert.deepEqual(planSpaceDeletionWindowKeepalives(tabs, [1, 3, 4, 5, 6]), [20, 30]);
  assert.deepEqual(planSpaceDeletionWindowKeepalives([
    { id: 1, windowId: 99 },
    { id: 2, windowId: 10 },
  ], [1]), [99]);
});

test('extension-owned tabs count as window survivors without becoming deletion targets', () => {
  const allChromeTabs = deepFreeze([
    { id: 1, windowId: 10, url: 'https://space-tab.test/' },
    { id: 2, windowId: 10, url: 'chrome-extension://space-tabs/sidepanel.html?layout=workbench' },
  ]);

  assert.deepEqual(planSpaceDeletionWindowKeepalives(allChromeTabs, [1]), []);
  assert.deepEqual(planSpaceDeletionPlaceholderCleanup([
    ...allChromeTabs,
    { id: 3, windowId: 10, url: 'chrome://newtab/' },
  ], [3]), {
    closeTabIds: [3],
    retainTabIds: [],
    retainLiveTabIds: [],
    missingTabIds: [],
  });
});

test('checkpoint keepalive planning handles zero, missing, duplicate, and malformed ids', () => {
  assert.deepEqual(planSpaceDeletionWindowKeepalives([
    { id: 0, windowId: 0 },
    { id: 1, windowId: 1 },
    { id: -1, windowId: 1 },
    null,
  ], [0, 0, 9, 'bad']), [0]);
  assert.deepEqual(planSpaceDeletionWindowKeepalives(null, null), []);
});

test('placeholder metadata removes closed rows and reassigns retained keepalives', () => {
  const state = deepFreeze({
    tabSpaces: { 10: 'fallback', 20: 'fallback', 30: 'keep' },
    tabGroups: { 10: 'old-close', 20: 'old-retain', 30: 'keep' },
    renamedTabs: { 10: 'Close', 20: 'Retain', 30: 'Keep' },
    tabLifecycle: {
      10: { tabId: 10, spaceId: 'fallback', groupId: 4, trackingMode: 'saved-target' },
      20: { tabId: 20, spaceId: 'fallback', groupId: 5, trackingMode: 'saved-target' },
      30: { tabId: 30, spaceId: 'keep', groupId: -1, trackingMode: 'live' },
    },
    ephemeralTabIds: [10, '20', 30, 'bad'],
    tabOrder: {
      deleting: { ungrouped: [10, 20, 30], malformed: null },
      fallback: null,
    },
  });
  const before = structuredClone(state);

  const projected = projectSpaceDeletionPlaceholderMetadata(state, {
    removedTabIds: [10, 10, 'bad'],
    retainedTabIds: [20],
    restoreSpaceId: 'deleting',
  });

  assert.deepEqual(projected.tabSpaces, { 20: 'deleting', 30: 'keep' });
  assert.deepEqual(projected.tabGroups, { 30: 'keep' });
  assert.deepEqual(projected.renamedTabs, { 30: 'Keep' });
  assert.deepEqual(projected.tabLifecycle, {
    20: { tabId: 20, spaceId: 'deleting', groupId: -1, trackingMode: 'live' },
    30: { tabId: 30, spaceId: 'keep', groupId: -1, trackingMode: 'live' },
  });
  assert.deepEqual(projected.ephemeralTabIds, [30]);
  assert.deepEqual(projected.tabOrder.deleting, { ungrouped: [30], malformed: null });
  assert.deepEqual(state, before);
});

test('retention wins overlap, supports empty restore ownership, and normalizes malformed state', () => {
  const projected = projectSpaceDeletionPlaceholderMetadata({
    tabSpaces: null,
    tabGroups: [],
    renamedTabs: 'invalid',
    tabLifecycle: { 0: { tabId: 0 } },
    ephemeralTabIds: null,
    tabOrder: { space: { group: 'invalid' } },
  }, {
    removedTabIds: [0],
    retainedTabIds: [0, 2],
    restoreSpaceId: '',
  });

  assert.deepEqual(projected.tabSpaces, {});
  assert.deepEqual(projected.tabGroups, {});
  assert.deepEqual(projected.renamedTabs, {});
  assert.deepEqual(projected.tabLifecycle, {});
  assert.deepEqual(projected.ephemeralTabIds, []);
  assert.deepEqual(projected.tabOrder, { space: { group: 'invalid' } });
  assert.deepEqual(projectSpaceDeletionPlaceholderMetadata(), {
    tabSpaces: {},
    tabGroups: {},
    renamedTabs: {},
    tabLifecycle: {},
    ephemeralTabIds: [],
  });
  assert.deepEqual(projectSpaceDeletionPlaceholderMetadata(null, {
    removedTabIds: [1],
  }), {
    tabSpaces: {},
    tabGroups: {},
    renamedTabs: {},
    tabLifecycle: {},
    ephemeralTabIds: [],
  });
});

test('a retained keepalive stays hidden when the recovered Space has saved content', () => {
  const projected = projectSpaceDeletionPlaceholderMetadata({
    tabSpaces: { 8: 'fallback' },
    tabGroups: { 8: 'temporary' },
    renamedTabs: { 8: 'Temporary' },
    tabLifecycle: { 8: { tabId: 8, spaceId: 'fallback', trackingMode: 'saved-target' } },
    ephemeralTabIds: [7, 8],
    tabOrder: { deleting: { ungrouped: [8] } },
  }, {
    retainedTabIds: [8],
    restoreSpaceId: 'deleting',
    retainAsEphemeral: true,
  });

  assert.deepEqual(projected.tabSpaces, {});
  assert.deepEqual(projected.tabGroups, {});
  assert.deepEqual(projected.renamedTabs, {});
  assert.deepEqual(projected.tabLifecycle, {});
  assert.deepEqual(projected.ephemeralTabIds, [7, 8]);
  assert.deepEqual(projected.tabOrder.deleting.ungrouped, []);
});

test('a user-modified retained placeholder becomes a live tab in the restored Space', () => {
  const projected = projectSpaceDeletionPlaceholderMetadata({
    tabSpaces: { 8: 'fallback', 9: 'fallback' },
    tabGroups: { 8: 'temporary', 9: 'temporary' },
    renamedTabs: { 8: 'Temporary', 9: 'User page' },
    tabLifecycle: {
      8: { tabId: 8, spaceId: 'fallback', trackingMode: 'saved-target' },
      9: { tabId: 9, spaceId: 'fallback', trackingMode: 'saved-target' },
    },
    ephemeralTabIds: [8, 9],
  }, {
    retainedTabIds: [8, 9],
    liveRetainedTabIds: [9],
    restoreSpaceId: 'deleting',
    retainAsEphemeral: true,
  });

  assert.deepEqual(projected.tabSpaces, { 9: 'deleting' });
  assert.deepEqual(projected.tabLifecycle, {
    9: { tabId: 9, spaceId: 'deleting', groupId: -1, trackingMode: 'live' },
  });
  assert.deepEqual(projected.ephemeralTabIds, [8]);
});

test('rollback effects preserve cleanup, save, and refresh failure order', async () => {
  const calls = [];
  const closeFailure = new Error('close failed');
  const listFailure = new Error('list failed');
  const saveFailure = new Error('cleanup save failed');
  const refreshFailure = new Error('refresh failed');
  const failures = await collectSpaceDeletionRollbackFailures({
    saveRecovery: async () => calls.push('save-recovery'),
    cleanup: async () => {
      calls.push('cleanup');
      return [
        { stage: 'closing placeholder 1', error: closeFailure },
        { stage: 'checking remaining placeholders', error: listFailure },
      ];
    },
    saveCleanup: async () => {
      calls.push('save-cleanup');
      throw saveFailure;
    },
    refresh: async () => {
      calls.push('refresh');
      throw refreshFailure;
    },
  });

  assert.deepEqual(calls, ['save-recovery', 'cleanup', 'save-cleanup', 'refresh']);
  assert.deepEqual(failures, [
    { stage: 'closing placeholder 1', error: closeFailure },
    { stage: 'checking remaining placeholders', error: listFailure },
    { stage: 'saving aborted deletion placeholder cleanup', error: saveFailure },
    { stage: 'refreshing the restored workspace and saved tabs', error: refreshFailure },
  ]);
});

test('a failed recovery save skips physical cleanup but still refreshes', async () => {
  const calls = [];
  const saveFailure = new Error('recovery save failed');
  const failures = await collectSpaceDeletionRollbackFailures({
    saveRecovery: async () => {
      calls.push('save-recovery');
      throw saveFailure;
    },
    cleanup: async () => calls.push('cleanup'),
    saveCleanup: async () => calls.push('save-cleanup'),
    refresh: async () => calls.push('refresh'),
  });

  assert.deepEqual(calls, ['save-recovery', 'refresh']);
  assert.deepEqual(failures, [{
    stage: 'saving the restored workspace before placeholder cleanup',
    error: saveFailure,
  }]);
});

test('an unexpected cleanup failure is aggregated and does not prevent save or refresh', async () => {
  const calls = [];
  const cleanupFailure = new Error('cleanup crashed');
  const failures = await collectSpaceDeletionRollbackFailures({
    cleanup: async () => {
      calls.push('cleanup');
      throw cleanupFailure;
    },
    saveCleanup: async () => calls.push('save-cleanup'),
    refresh: async () => calls.push('refresh'),
  });

  assert.deepEqual(calls, ['cleanup', 'save-cleanup', 'refresh']);
  assert.deepEqual(failures, [{
    stage: 'cleaning up aborted deletion placeholders',
    error: cleanupFailure,
  }]);
  assert.deepEqual(await collectSpaceDeletionRollbackFailures(), []);
  assert.deepEqual(await collectSpaceDeletionRollbackFailures({
    cleanup: async () => ({ ignored: true }),
  }), []);
});

test('post-commit deletion errors cannot imply that the Space still exists', () => {
  const cause = new Error('refresh disconnected');
  const error = createCommittedSpaceDeletionError('Research', cause);

  assert.equal(error.spaceDeletionCommitted, true);
  assert.strictEqual(error.cause, cause);
  assert.match(error.message, /^Deleted Research,/);
  assert.match(error.message, /The deletion is saved/);
  assert.match(error.message, /refresh disconnected/);
  assert.match(createCommittedSpaceDeletionError('', 'offline').message, /^Deleted the Space,/);
  assert.match(createCommittedSpaceDeletionError(null, null).message, /post-delete refresh failed/);
});
