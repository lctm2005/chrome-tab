import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeLiveAndDormantGroups } from '../src/shared/space-view-merge.js';

function group({
  key,
  title = 'Docs',
  color = 'blue',
  snapshotGroupId,
  collapsed = false,
  displayTitle,
  tabs = [],
} = {}) {
  return {
    key,
    title,
    color,
    collapsed,
    ...(snapshotGroupId ? { snapshotGroupId } : {}),
    ...(displayTitle ? { displayTitle } : {}),
    tabs,
  };
}

function tab(url, options = {}) {
  return {
    id: options.id,
    title: options.title || url || 'Blank',
    url,
    ...(options.snapshotTabId ? { snapshotTabId: options.snapshotTabId } : {}),
    ...(options.snapshotGroupId ? { snapshotGroupId: options.snapshotGroupId } : {}),
    ...(options.dormant ? { dormant: true } : {}),
  };
}

function urls(groupValue) {
  return groupValue.tabs.map((item) => item.url);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

test('stable group identity merges renamed live and dormant copies', () => {
  const live = [group({
    key: 'group:1',
    title: 'Physical title',
    color: 'red',
    snapshotGroupId: ' group-docs ',
    tabs: [tab('https://docs.test/current', {
      id: 1,
      snapshotTabId: 'row-open',
      snapshotGroupId: 'group-docs',
    })],
  })];
  const dormant = [group({
    key: 'snapshot:docs',
    title: 'Logical Docs',
    displayTitle: 'Saved Docs',
    color: 'blue',
    snapshotGroupId: 'group-docs',
    tabs: [
      tab('https://docs.test/previous', {
        snapshotTabId: 'row-open',
        snapshotGroupId: 'group-docs',
        dormant: true,
      }),
      tab('https://docs.test/saved', {
        snapshotTabId: 'row-saved',
        snapshotGroupId: 'group-docs',
        dormant: true,
      }),
    ],
  })];

  const merged = mergeLiveAndDormantGroups({ liveGroups: live, dormantGroups: dormant });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Logical Docs');
  assert.equal(merged[0].displayTitle, 'Saved Docs');
  assert.equal(merged[0].color, 'red');
  assert.deepEqual(urls(merged[0]), [
    'https://docs.test/current',
    'https://docs.test/saved',
  ]);
});

test('conflicting stable identities do not merge or consume equal legacy URLs', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:1',
      title: 'Same',
      snapshotGroupId: 'group-live',
      tabs: [tab('https://same.test/page', { id: 1 })],
    })],
    dormantGroups: [group({
      key: 'snapshot:1',
      title: 'Same',
      snapshotGroupId: 'group-saved',
      tabs: [tab('https://same.test/page', { dormant: true })],
    })],
  });

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((item) => item.snapshotGroupId), ['group-saved', 'group-live']);
  assert.deepEqual(merged.map((item) => item.tabs.length), [1, 1]);
});

test('legacy groups with the same title but different colors remain separate', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:1',
      title: 'Research',
      color: 'blue',
      tabs: [tab('https://research.test/live', { id: 1 })],
    })],
    dormantGroups: [group({
      key: 'snapshot:1',
      title: 'Research',
      color: 'red',
      tabs: [tab('https://research.test/saved', { dormant: true })],
    })],
  });

  assert.deepEqual(merged.map((item) => item.color), ['red', 'blue']);
  assert.deepEqual(merged.map(urls), [
    ['https://research.test/saved'],
    ['https://research.test/live'],
  ]);
});

test('two stable pairs with the same title merge by identity, not position', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [
      group({
        key: 'group:a',
        title: 'Same',
        tabs: [tab('https://same.test/a-live', { id: 1, snapshotGroupId: 'group-a' })],
      }),
      group({
        key: 'group:b',
        title: 'Same',
        tabs: [tab('https://same.test/b-live', { id: 2, snapshotGroupId: 'group-b' })],
      }),
    ],
    dormantGroups: [
      group({
        key: 'snapshot:b',
        title: 'Same',
        snapshotGroupId: 'group-b',
        tabs: [tab('https://same.test/b-saved', { snapshotGroupId: 'group-b', dormant: true })],
      }),
      group({
        key: 'snapshot:a',
        title: 'Same',
        snapshotGroupId: 'group-a',
        tabs: [tab('https://same.test/a-saved', { snapshotGroupId: 'group-a', dormant: true })],
      }),
    ],
  });

  assert.deepEqual(merged.map(urls), [
    ['https://same.test/b-saved', 'https://same.test/b-live'],
    ['https://same.test/a-saved', 'https://same.test/a-live'],
  ]);
});

test('snapshot order interleaves dormant and matched live groups before new live-only groups', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [
      group({
        key: 'group:c',
        title: 'C live',
        snapshotGroupId: 'group-c',
        tabs: [tab('https://order.test/c-live', { id: 3, snapshotGroupId: 'group-c' })],
      }),
      group({
        key: 'group:a',
        title: 'A live',
        snapshotGroupId: 'group-a',
        tabs: [tab('https://order.test/a-live', { id: 1, snapshotGroupId: 'group-a' })],
      }),
      group({
        key: 'group:new',
        title: 'New live',
        snapshotGroupId: 'group-new',
        tabs: [tab('https://order.test/new-live', { id: 4, snapshotGroupId: 'group-new' })],
      }),
    ],
    dormantGroups: [
      group({
        key: 'snapshot:b',
        title: 'B saved',
        snapshotGroupId: 'group-b',
        tabs: [tab('https://order.test/b-saved', { dormant: true, snapshotGroupId: 'group-b' })],
      }),
      group({
        key: 'snapshot:a',
        title: 'A saved',
        snapshotGroupId: 'group-a',
        tabs: [tab('https://order.test/a-saved', { dormant: true, snapshotGroupId: 'group-a' })],
      }),
      group({
        key: 'snapshot:c',
        title: 'C saved',
        snapshotGroupId: 'group-c',
        tabs: [tab('https://order.test/c-saved', { dormant: true, snapshotGroupId: 'group-c' })],
      }),
    ],
  });

  assert.deepEqual(merged.map((item) => item.snapshotGroupId), [
    'group-b', 'group-a', 'group-c', 'group-new',
  ]);
  assert.deepEqual(merged.map(urls), [
    ['https://order.test/b-saved'],
    ['https://order.test/a-saved', 'https://order.test/a-live'],
    ['https://order.test/c-saved', 'https://order.test/c-live'],
    ['https://order.test/new-live'],
  ]);
});

test('unique title and color provide a legacy fallback when identity is missing', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [
      group({
        key: 'group:docs',
        title: '  Docs ',
        color: 'BLUE',
        snapshotGroupId: 'new-docs-identity',
        tabs: [tab('https://docs.test/live', { id: 1 })],
      }),
      group({
        key: 'group:work',
        title: 'Work',
        color: 'green',
        tabs: [tab('https://work.test/live', { id: 2 })],
      }),
    ],
    dormantGroups: [
      group({
        key: 'snapshot:docs',
        title: 'docs',
        color: 'blue',
        tabs: [tab('https://docs.test/saved', { dormant: true })],
      }),
      group({
        key: 'snapshot:work',
        title: 'work',
        color: 'green',
        tabs: [tab('https://work.test/saved', { dormant: true })],
      }),
    ],
  });

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(urls), [
    ['https://docs.test/saved', 'https://docs.test/live'],
    ['https://work.test/saved', 'https://work.test/live'],
  ]);
});

test('opening the middle saved row keeps the exact snapshot row order', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:docs',
      snapshotGroupId: 'group-docs',
      tabs: [tab('https://order.test/b', {
        id: 2,
        snapshotTabId: 'row-b',
        snapshotGroupId: 'group-docs',
      })],
    })],
    dormantGroups: [group({
      key: 'snapshot:docs',
      snapshotGroupId: 'group-docs',
      tabs: [
        tab('https://order.test/a', {
          snapshotTabId: 'row-a',
          snapshotGroupId: 'group-docs',
          dormant: true,
        }),
        tab('https://order.test/b', {
          snapshotTabId: 'row-b',
          snapshotGroupId: 'group-docs',
          dormant: true,
        }),
        tab('https://order.test/c', {
          snapshotTabId: 'row-c',
          snapshotGroupId: 'group-docs',
          dormant: true,
        }),
      ],
    })],
  });

  assert.deepEqual(urls(merged[0]), [
    'https://order.test/a',
    'https://order.test/b',
    'https://order.test/c',
  ]);
  assert.equal(merged[0].tabs[1].dormant, undefined);
  assert.equal(merged[0].tabs[1].id, 2);
});

test('a stable row moved to another matched Tag is rendered only in its live destination', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [
      group({
        key: 'group:old',
        snapshotGroupId: 'group-old',
        tabs: [tab('https://move.test/stays', {
          id: 1,
          snapshotTabId: 'row-stays',
          snapshotGroupId: 'group-old',
        })],
      }),
      group({
        key: 'group:new',
        snapshotGroupId: 'group-new',
        tabs: [tab('https://move.test/moved', {
          id: 2,
          snapshotTabId: 'row-moved',
          snapshotGroupId: 'group-new',
        })],
      }),
    ],
    dormantGroups: [
      group({
        key: 'snapshot:old',
        snapshotGroupId: 'group-old',
        tabs: [
          tab('https://move.test/stays', {
            snapshotTabId: 'row-stays',
            snapshotGroupId: 'group-old',
            dormant: true,
          }),
          tab('https://move.test/moved', {
            snapshotTabId: 'row-moved',
            snapshotGroupId: 'group-old',
            dormant: true,
          }),
        ],
      }),
      group({ key: 'snapshot:new', snapshotGroupId: 'group-new', tabs: [] }),
    ],
  });

  assert.deepEqual(merged.map(urls), [
    ['https://move.test/stays'],
    ['https://move.test/moved'],
  ]);
});

test('ambiguous legacy metadata does not guess a group pairing', () => {
  const liveAmbiguous = mergeLiveAndDormantGroups({
    liveGroups: [
      group({ key: 'group:1', title: 'Same', tabs: [tab('https://one.test', { id: 1 })] }),
      group({ key: 'group:2', title: 'Same', tabs: [tab('https://two.test', { id: 2 })] }),
    ],
    dormantGroups: [group({
      key: 'snapshot:1',
      title: 'Same',
      tabs: [tab('https://saved.test', { dormant: true })],
    })],
  });
  const dormantAmbiguous = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:1',
      title: 'Same',
      tabs: [tab('https://live.test', { id: 1 })],
    })],
    dormantGroups: [
      group({ key: 'snapshot:1', title: 'Same', tabs: [tab('https://one.test', { dormant: true })] }),
      group({ key: 'snapshot:2', title: 'Same', tabs: [tab('https://two.test', { dormant: true })] }),
    ],
  });

  assert.equal(liveAmbiguous.length, 3);
  assert.equal(dormantAmbiguous.length, 3);
});

test('duplicate URLs are matched one-to-one and preserve the extra saved row', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:1',
      tabs: [tab('https://duplicate.test/page', { id: 1, title: 'Live' })],
    })],
    dormantGroups: [group({
      key: 'snapshot:1',
      tabs: [
        tab('https://duplicate.test/page', { title: 'Saved first', dormant: true }),
        tab('https://duplicate.test/page', { title: 'Saved second', dormant: true }),
      ],
    })],
  });

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].tabs.map((item) => item.title), ['Live', 'Saved second']);
});

test('merging never mutates frozen inputs or reuses their group and tab objects', () => {
  const liveGroups = deepFreeze([group({
    key: 'group:1',
    tabs: [tab('https://immutable.test/live', { id: 1 })],
  })]);
  const dormantGroups = deepFreeze([group({
    key: 'snapshot:1',
    collapsed: false,
    tabs: [tab('https://immutable.test/saved', { dormant: true })],
  })]);
  const collapsedGroups = deepFreeze({ 'snapshot:1': true });
  const recentlyOpenedTabs = deepFreeze([]);
  const liveBefore = structuredClone(liveGroups);
  const dormantBefore = structuredClone(dormantGroups);

  const merged = mergeLiveAndDormantGroups({
    liveGroups,
    dormantGroups,
    collapsedGroups,
    recentlyOpenedTabs,
  });

  assert.deepEqual(liveGroups, liveBefore);
  assert.deepEqual(dormantGroups, dormantBefore);
  assert.notEqual(merged[0], liveGroups[0]);
  assert.notEqual(merged[0].tabs[0], liveGroups[0].tabs[0]);
  merged[0].title = 'Changed output';
  merged[0].tabs[0].title = 'Changed output row';
  assert.equal(liveGroups[0].title, 'Docs');
  assert.equal(liveGroups[0].tabs[0].title, 'https://immutable.test/live');
  assert.deepEqual(mergeLiveAndDormantGroups(), []);
});

test('row matching supports recently opened tabs, navigation fallback, and stable moves', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [
      group({
        key: 'group:recent',
        title: 'Recent',
        snapshotGroupId: 'group-recent',
        tabs: [tab('https://recent.test/new', { id: 91 })],
      }),
      group({
        key: 'group:navigation',
        title: 'Navigation',
        tabs: [tab('https://navigation.test/page?current=1', { id: 92 })],
      }),
      group({
        key: 'group:moved',
        title: 'New home',
        snapshotGroupId: 'group-new-home',
        tabs: [tab('https://moved.test/new', { id: 93, snapshotTabId: 'row-moved' })],
      }),
    ],
    dormantGroups: [
      group({
        key: 'snapshot:recent',
        title: 'Recent',
        snapshotGroupId: 'group-recent',
        tabs: [tab('https://recent.test/old', { dormant: true })],
      }),
      group({
        key: 'snapshot:navigation',
        title: 'Navigation',
        tabs: [tab('https://navigation.test/page?saved=1#section', { dormant: true })],
      }),
      group({
        key: 'snapshot:moved',
        title: 'Old home',
        snapshotGroupId: 'group-old-home',
        tabs: [tab('https://moved.test/old', { snapshotTabId: 'row-moved', dormant: true })],
      }),
    ],
    recentlyOpenedTabs: [{
      url: 'https://recent.test/old',
      snapshotGroupId: 'group-recent',
      tabId: 91,
    }],
  });

  assert.deepEqual(merged.map((item) => item.tabs.length), [1, 1, 0, 1]);
  assert.equal(merged.length, 4);
  assert.equal(merged[2].snapshotGroupId, 'group-old-home');
  assert.equal(merged[2].tabs.length, 0);
});

test('recently opened legacy records require matching title and color metadata', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:1',
      title: 'Docs',
      color: 'blue',
      tabs: [tab('https://docs.test/new', { id: 7 })],
    })],
    dormantGroups: [group({
      key: 'snapshot:1',
      title: 'Docs',
      color: 'blue',
      tabs: [tab('https://docs.test/old', { dormant: true })],
    })],
    recentlyOpenedTabs: [
      {
        urlIdentity: 'https://docs.test/old',
        groupKey: 'other',
        tabId: 7,
      },
      {
        urlIdentity: 'https://docs.test/old',
        groupKey: 'docs',
        groupColor: 'red',
        tabId: 7,
      },
      {
        urlIdentity: 'https://docs.test/old',
        groupTitle: 'Docs',
        groupColor: 'BLUE',
        tabId: 7,
      },
    ],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].tabs.length, 1);
});

test('ungrouped rows merge last, collapse overrides apply, and distinct empty groups survive', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'ungrouped',
      title: 'Ungrouped',
      color: 'grey',
      tabs: [tab('https://loose.test/open', { id: 1 })],
    })],
    dormantGroups: [
      group({
        key: 'snapshot:empty',
        title: 'Empty history',
        color: '',
        collapsed: false,
        tabs: [],
      }),
      group({
        key: 'snapshot:ungrouped',
        title: 'Ungrouped',
        color: 'grey',
        tabs: [
          tab('https://loose.test/open', { dormant: true }),
          tab('https://loose.test/saved', { dormant: true }),
        ],
      }),
    ],
    collapsedGroups: { 'snapshot:empty': true, 'snapshot:ungrouped': false },
  });

  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, 'Empty history');
  assert.equal(merged[0].collapsed, true);
  assert.equal(merged[0].tabs.length, 0);
  assert.equal(merged[1].key, 'ungrouped');
  assert.deepEqual(urls(merged[1]), ['https://loose.test/open', 'https://loose.test/saved']);

  const dormantOnly = mergeLiveAndDormantGroups({
    dormantGroups: [group({
      key: 'saved:ungrouped',
      title: 'Ungrouped',
      color: 'grey',
      tabs: [tab('https://loose.test/only', { dormant: true })],
    })],
  });
  const emptyDormantOnly = mergeLiveAndDormantGroups({
    dormantGroups: [group({
      key: 'saved:ungrouped',
      title: 'Ungrouped',
      color: 'grey',
      tabs: [],
    })],
  });

  assert.equal(dormantOnly.at(-1).title, 'Ungrouped');
  assert.deepEqual(emptyDormantOnly, []);
});

test('multiple legacy Ungrouped snapshots merge without duplicating a matched live row', () => {
  const merged = mergeLiveAndDormantGroups({
    dormantGroups: [
      group({
        key: 'saved:ungrouped:first',
        title: 'Ungrouped',
        color: 'grey',
        tabs: [tab('https://loose.test/first', { dormant: true })],
      }),
      group({
        key: 'saved:ungrouped:second',
        title: 'Ungrouped',
        color: 'grey',
        tabs: [tab('https://loose.test/second', { dormant: true })],
      }),
    ],
  });

  assert.equal(merged.length, 1);
  assert.deepEqual(urls(merged[0]), [
    'https://loose.test/first',
    'https://loose.test/second',
  ]);
});

test('ambiguous and duplicated stable group identities never fall back to metadata', () => {
  const internallyAmbiguous = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:1',
      snapshotGroupId: 'group-a',
      tabs: [tab('https://live.test', { snapshotGroupId: 'group-b' })],
    })],
    dormantGroups: [group({
      key: 'snapshot:1',
      tabs: [tab('https://saved.test', { dormant: true })],
    })],
  });
  const duplicatedLiveIdentity = mergeLiveAndDormantGroups({
    liveGroups: [
      group({ key: 'group:1', snapshotGroupId: 'duplicate', tabs: [] }),
      group({ key: 'group:2', snapshotGroupId: 'duplicate', tabs: [] }),
    ],
    dormantGroups: [group({ key: 'snapshot:1', snapshotGroupId: 'duplicate', tabs: [] })],
  });
  const duplicatedDormantIdentity = mergeLiveAndDormantGroups({
    liveGroups: [group({ key: 'group:1', snapshotGroupId: 'duplicate', tabs: [] })],
    dormantGroups: [
      group({ key: 'snapshot:1', snapshotGroupId: 'duplicate', tabs: [] }),
      group({ key: 'snapshot:2', snapshotGroupId: 'duplicate', tabs: [] }),
    ],
  });

  assert.equal(internallyAmbiguous.length, 2);
  assert.equal(duplicatedLiveIdentity.length, 3);
  assert.equal(duplicatedDormantIdentity.length, 3);
});

test('blank URLs are retained and matching dormant groups use their title as display fallback', () => {
  const merged = mergeLiveAndDormantGroups({
    liveGroups: [group({ key: 'group:1', color: ' ', tabs: [tab('', { id: 1 })] })],
    dormantGroups: [group({ key: 'snapshot:1', color: '   ', tabs: [tab('', { dormant: true })] })],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].displayTitle, 'Docs');
  assert.equal(merged[0].tabs.length, 2);
});

test('defensive empty inputs and identity edge cases remain deterministic', () => {
  const missingCollections = mergeLiveAndDormantGroups({
    liveGroups: null,
    dormantGroups: [{ key: 'raw', title: 'Raw', color: 'blue' }],
  });
  const nullRecentRecords = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:null-records',
      tabs: [tab('https://null-records.test/new', { id: 1 })],
    })],
    dormantGroups: [group({
      key: 'snapshot:null-records',
      tabs: [tab('https://null-records.test/old', { dormant: true })],
    })],
    recentlyOpenedTabs: null,
  });
  const stableUngrouped = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'ungrouped',
      title: 'Ungrouped',
      color: 'grey',
      snapshotGroupId: 'ungrouped-id',
      tabs: [],
    })],
    dormantGroups: [group({
      key: 'snapshot:ungrouped',
      title: 'Ungrouped',
      color: 'grey',
      snapshotGroupId: 'ungrouped-id',
      tabs: [],
    })],
  });
  const conflictingRows = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:rows',
      snapshotGroupId: 'group-rows',
      tabs: [tab('https://rows.test/page', { snapshotTabId: 'live-row' })],
    })],
    dormantGroups: [group({
      key: 'snapshot:rows',
      snapshotGroupId: 'group-rows',
      tabs: [tab('https://rows.test/page', { snapshotTabId: 'saved-row', dormant: true })],
    })],
  });
  const colorlessRecentRecord = mergeLiveAndDormantGroups({
    liveGroups: [group({
      key: 'group:recent',
      tabs: [tab('https://colorless.test/new', { id: 5 })],
    })],
    dormantGroups: [group({
      key: 'snapshot:recent',
      tabs: [tab('https://colorless.test/old', { dormant: true })],
    })],
    recentlyOpenedTabs: [{
      urlIdentity: 'https://colorless.test/old',
      groupKey: 'docs',
      tabId: 5,
    }],
  });

  assert.equal(missingCollections[0].tabs.length, 0);
  assert.equal(nullRecentRecords[0].tabs.length, 2);
  assert.equal(stableUngrouped.length, 1);
  assert.equal(conflictingRows[0].tabs.length, 2);
  assert.equal(colorlessRecentRecord[0].tabs.length, 1);
});
