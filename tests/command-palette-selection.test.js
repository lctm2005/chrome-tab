import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureCommandPaletteTabSelection,
  commandPaletteFocusGuard,
  resolveCommandPaletteTabSelection,
} from '../src/shared/command-palette-selection.js';

const spaces = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

function view(spaceId, tabs, key = `group:${spaceId}`) {
  return [{ key, spaceId, tabs: tabs.map((tab) => ({ ...tab, spaceId })) }];
}

test('captures physical foreign-window identity and preserves Chrome tab id zero', () => {
  const foreign = {
    id: 9,
    windowId: 4,
    groupId: 3,
    url: 'https://current.test/',
    snapshotTabId: 'row-9',
    sessionId: 'session',
  };
  assert.deepEqual(captureCommandPaletteTabSelection({
    spaceId: 'b',
    tab: {
      id: 'saved-row',
      foreignWindowTabId: 9,
      url: 'https://saved.test/',
      dormant: true,
      snapshotTabId: 'row-9',
    },
  }, [foreign]), {
    spaceId: 'b',
    mode: 'live',
    tabId: 9,
    url: 'https://current.test/',
    snapshotTabId: 'row-9',
    sessionId: 'session',
    groupKey: '',
  });
  assert.equal(captureCommandPaletteTabSelection({
    spaceId: 'a',
    tab: { id: 0, url: 'https://zero.test/' },
  }, [{ id: 0, url: 'https://zero.test/' }]).tabId, 0);
  assert.equal(captureCommandPaletteTabSelection(null).mode, 'dormant');
});

test('resolves the same live tab and follows only one exact stable replacement', () => {
  const selected = {
    spaceId: 'b',
    mode: 'live',
    tabId: 5,
    url: 'https://same.test/',
    snapshotTabId: 'stable-row',
    sessionId: 'session',
  };
  const original = {
    id: 5,
    url: selected.url,
    snapshotTabId: selected.snapshotTabId,
    sessionId: selected.sessionId,
  };
  const direct = resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [original]),
    liveTabs: [original],
  });
  assert.equal(direct.tab.id, 5);
  assert.equal(direct.replaced, false);

  const replacement = { ...original, id: 8 };
  const followed = resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [replacement]),
    liveTabs: [replacement],
  });
  assert.equal(followed.tab.id, 8);
  assert.equal(followed.replaced, true);

  assert.equal(resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [replacement, { ...replacement, id: 9 }]),
    liveTabs: [replacement, { ...replacement, id: 9 }],
  }), null, 'ambiguous replacement identities fail closed');
});

test('rejects navigation, closure, Space moves, identity changes, and invalid inventories', () => {
  const selected = {
    spaceId: 'b',
    mode: 'live',
    tabId: 5,
    url: 'https://before.test/',
    snapshotTabId: 'row-5',
    sessionId: 'session',
  };
  const live = {
    id: 5,
    url: selected.url,
    snapshotTabId: selected.snapshotTabId,
    sessionId: selected.sessionId,
  };
  const resolve = (overrides = {}) => resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [live]),
    liveTabs: [live],
    ...overrides,
  });

  assert.equal(resolve({ liveTabs: [{ ...live, url: 'https://after.test/' }] }), null);
  assert.equal(resolve({ liveTabs: [] }), null);
  assert.equal(resolve({ spaceView: view('c', [live]) }), null);
  assert.equal(resolve({ liveTabs: [{ ...live, snapshotTabId: 'replacement-row' }] }), null);
  assert.equal(resolve({ liveTabs: [{ ...live, sessionId: 'other-session' }] }), null);
  assert.equal(resolve({ liveTabs: [live, live] }), null);
  assert.equal(resolveCommandPaletteTabSelection({ ...selected, spaceId: 'missing' }, {
    spaces,
    spaceView: view('b', [live]),
    liveTabs: [live],
  }), null);
  assert.equal(resolveCommandPaletteTabSelection({ ...selected, tabId: null, snapshotTabId: '' }, {
    spaces,
    spaceView: view('b', [live]),
    liveTabs: [live],
  }), null);
});

test('re-resolves dormant rows by stable identity and never turns a stale live result dormant', () => {
  const dormant = {
    id: 'render:9',
    dormant: true,
    dormantGroupKey: 'saved:b',
    snapshotTabId: 'saved-row',
    url: 'https://saved.test/',
  };
  const selected = captureCommandPaletteTabSelection({ spaceId: 'b', tab: dormant });
  const resolved = resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [{ ...dormant, id: 'render:2' }], 'saved:b'),
  });
  assert.equal(resolved.mode, 'dormant');
  assert.equal(resolved.tab.id, 'render:2');
  assert.equal(resolved.groupKey, 'saved:b');

  const opened = {
    id: 7,
    url: dormant.url,
    snapshotTabId: dormant.snapshotTabId,
  };
  const openedResolution = resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [opened], 'saved:b'),
    liveTabs: [opened],
  });
  assert.equal(openedResolution.mode, 'live');
  assert.equal(openedResolution.tab.id, 7);

  assert.equal(resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [{ ...dormant, url: 'https://edited.test/' }], 'saved:b'),
  }), null);
  assert.equal(resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [dormant, { ...dormant, id: 'duplicate' }], 'saved:b'),
  }), null);

  const staleLive = captureCommandPaletteTabSelection({
    spaceId: 'b',
    tab: opened,
  }, [opened]);
  assert.equal(resolveCommandPaletteTabSelection(staleLive, {
    spaces,
    spaceView: view('b', [dormant], 'saved:b'),
    liveTabs: [],
  }), null);
});

test('legacy dormant resolution is unique within its group and focus guards preserve physical fields', () => {
  const selected = {
    spaceId: 'b',
    mode: 'dormant',
    tabId: null,
    url: 'https://legacy.test/',
    snapshotTabId: '',
    sessionId: '',
    groupKey: 'legacy',
  };
  const tab = { id: 'legacy:0', dormant: true, url: selected.url };
  assert.equal(resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [tab], 'legacy'),
  }).tab.id, 'legacy:0');
  assert.equal(resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: view('b', [tab], 'other'),
  }), null);

  assert.deepEqual(commandPaletteFocusGuard({
    id: 0,
    windowId: 2,
    groupId: -1,
    pendingUrl: 'https://pending.test/',
    url: 'https://old.test/',
  }), {
    tabId: 0,
    windowId: 2,
    groupId: -1,
    url: 'https://pending.test/',
  });
  assert.equal(commandPaletteFocusGuard({ id: -1 }), null);
});

test('fails closed across missing physical rows and exercises empty legacy fallbacks', () => {
  const missingForeign = captureCommandPaletteTabSelection({
    spaceId: 'b',
    tab: {
      id: 'saved-row',
      foreignWindowTabId: 44,
      dormant: true,
      url: 'https://saved.test/',
    },
  }, []);
  assert.deepEqual(missingForeign, {
    spaceId: 'b',
    mode: 'live',
    tabId: 44,
    url: '',
    snapshotTabId: '',
    sessionId: '',
    groupKey: '',
  });

  const emptyLive = {
    spaceId: 'b',
    mode: 'live',
    tabId: 5,
    url: '',
    snapshotTabId: 'empty-url-row',
    sessionId: '',
  };
  const directEmpty = { id: 5, url: '', snapshotTabId: 'empty-url-row' };
  assert.equal(resolveCommandPaletteTabSelection(emptyLive, {
    spaces,
    spaceView: view('b', [directEmpty]),
    liveTabs: [directEmpty],
  }).tab.id, 5);
  const replacementEmpty = { ...directEmpty, id: 6 };
  assert.equal(resolveCommandPaletteTabSelection(emptyLive, {
    spaces,
    spaceView: view('b', [replacementEmpty]),
    liveTabs: [replacementEmpty],
  }).tab.id, 6);

  const emptyDormant = {
    spaceId: 'b',
    mode: 'dormant',
    url: '',
    snapshotTabId: 'empty-saved-row',
    groupKey: 'fallback-group',
  };
  const inheritedMetadataView = [{
    spaceId: 'b',
    key: '',
    tabs: [{
      id: 'saved:empty',
      dormant: true,
      dormantGroupKey: 'fallback-group',
      snapshotTabId: 'empty-saved-row',
      url: '',
    }],
  }];
  const inherited = resolveCommandPaletteTabSelection(emptyDormant, {
    spaces,
    spaceView: inheritedMetadataView,
  });
  assert.equal(inherited.mode, 'dormant');
  assert.equal(inherited.groupKey, 'fallback-group');
});

test('a saved row materialized as live still requires one matching physical identity', () => {
  const selected = {
    spaceId: 'b',
    mode: 'dormant',
    url: 'https://materialized.test/',
    snapshotTabId: 'materialized-row',
    groupKey: 'saved:b',
  };
  const materialized = {
    id: 7,
    url: selected.url,
    snapshotTabId: selected.snapshotTabId,
  };
  const currentView = view('b', [materialized], 'saved:b');

  assert.equal(resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: currentView,
    liveTabs: [],
  }), null);
  assert.equal(resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: currentView,
    liveTabs: [{ ...materialized, url: 'https://navigated.test/' }],
  }), null);
  assert.equal(resolveCommandPaletteTabSelection(selected, {
    spaces,
    spaceView: currentView,
    liveTabs: [{ ...materialized, snapshotTabId: 'other-row' }],
  }), null);
});
