import test from 'node:test';
import assert from 'node:assert/strict';

import { chromeGroupTitle } from '../src/shared/group-title.js';

import {
  assertCompleteAutoGroupPlan,
  buildGroupPreviewItems,
  buildSpaceView,
  countPlannedRegroups,
  compactTabForAI,
  compactUrlForAI,
  decorateTabs,
  domainFromUrl,
  isChromeNewTabUrl,
  isForeignWindowTab,
  isPageShortcutCapableUrl,
  isPlaceholderTabTitle,
  planDuplicateUrlClosures,
  planTidyGroups,
  planTidyTabNames,
  planGroupPreviewPlacement,
  plannedRegroupTabIds,
  preferredFocusableTab,
  sanitizeTidyGroups,
  spaceGroupPlan,
  searchTabs,
  tabRowPresentation,
  tidyPanelName,
  titleForDomain,
} from '../src/shared/tab-utils.js';

test('recognizes Chrome new-tab URLs with the canonical trailing slash', () => {
  assert.equal(isChromeNewTabUrl('chrome://newtab'), true);
  assert.equal(isChromeNewTabUrl('chrome://newtab/'), true);
  assert.equal(isChromeNewTabUrl(' chrome://newtab/#fragment '), true);
  assert.equal(isChromeNewTabUrl('chrome://newtab/not-the-placeholder'), false);
  assert.equal(isChromeNewTabUrl('https://newtab/'), false);
});

test('tab row presentation gives valid foreign tabs priority over dormant semantics', () => {
  assert.deepEqual(tabRowPresentation({
    foreignWindowTabId: 0,
    foreignWindowId: 12,
    dormant: true,
    domain: 'example.test',
    url: 'https://example.test/page',
  }), {
    foreign: true,
    ariaStateLabel: 'open in another window',
    secondaryLabel: 'example.test · Open in another window',
    foreignWindowTabId: 0,
    foreignWindowId: 12,
  });

  assert.deepEqual(tabRowPresentation({
    foreignWindowTabId: 9,
    foreignWindowId: '12',
    dormant: true,
    url: 'https://fallback.test/page',
  }), {
    foreign: true,
    ariaStateLabel: 'open in another window',
    secondaryLabel: 'https://fallback.test/page · Open in another window',
    foreignWindowTabId: 9,
    foreignWindowId: null,
  });

  assert.deepEqual(tabRowPresentation({ foreignWindowTabId: 9 }), {
    foreign: true,
    ariaStateLabel: 'open in another window',
    secondaryLabel: 'Open in another window',
    foreignWindowTabId: 9,
    foreignWindowId: null,
  });
});

test('tab row presentation keeps ordinary saved and live rows distinct', () => {
  assert.deepEqual(tabRowPresentation({ dormant: true, domain: 'saved.test' }), {
    foreign: false,
    ariaStateLabel: 'saved tab',
    secondaryLabel: 'saved.test',
    foreignWindowTabId: null,
    foreignWindowId: null,
  });
  assert.deepEqual(tabRowPresentation({ url: 'https://live.test/page' }), {
    foreign: false,
    ariaStateLabel: '',
    secondaryLabel: 'https://live.test/page',
    foreignWindowTabId: null,
    foreignWindowId: null,
  });
  assert.deepEqual(tabRowPresentation(null), {
    foreign: false,
    ariaStateLabel: '',
    secondaryLabel: '',
    foreignWindowTabId: null,
    foreignWindowId: null,
  });
});

test('foreign tab detection accepts id zero and rejects coercible or invalid markers', () => {
  assert.equal(isForeignWindowTab({ foreignWindowTabId: 0 }), true);
  assert.equal(isForeignWindowTab({ foreignWindowTabId: 8 }), true);
  for (const foreignWindowTabId of [undefined, null, '0', '8', -1, 1.5, NaN, Infinity]) {
    assert.equal(isForeignWindowTab({ foreignWindowTabId }), false);
  }
  assert.equal(isForeignWindowTab(), false);
  assert.equal(isForeignWindowTab(null), false);
});

test('bounds Auto Group AI input and removes URL query data', () => {
  assert.equal(
    compactUrlForAI('https://example.com/research/item?token=secret&source=campaign#private'),
    'https://example.com/research/item',
  );
  const compact = compactTabForAI({
    id: 7,
    title: `Long title ${'x'.repeat(400)}`,
    url: `https://example.com/path?${'private='.repeat(200)}`,
  });
  assert.equal(compact.id, 7);
  assert.equal(compact.title.length, 240);
  assert.equal(compact.url, 'https://example.com/path');
  assert.equal(compact.domain, 'example.com');
});

test('counts only grouped tabs that Auto Group would move to a different titled group', () => {
  const tabs = [
    { id: 1, groupId: -1 },
    { id: 2, groupId: 10 },
    { id: 3, groupId: 20 },
    { id: 4, groupId: 20 },
  ];
  const groups = [
    { id: 10, title: 'Research' },
    { id: 20, title: 'Build' },
  ];
  const plan = [
    { title: 'Research', tabIds: [1, 2, 3] },
    { title: 'Build', tabIds: [4] },
  ];

  assert.equal(countPlannedRegroups(plan, tabs, groups), 1);
  assert.deepEqual(plannedRegroupTabIds(plan, tabs, groups), [3]);
  assert.equal(countPlannedRegroups([{ title: 'Research', tabIds: [1, 2] }], tabs, groups), 0);
  assert.equal(countPlannedRegroups([], tabs, groups), 0);
});

test('extracts readable domains from URLs', () => {
  assert.equal(domainFromUrl('https://docs.z.ai/guides/llm/glm-5.1'), 'docs.z.ai');
  assert.equal(domainFromUrl('chrome://extensions'), 'chrome');
  assert.equal(domainFromUrl('not a url'), 'unknown');
  assert.equal(domainFromUrl('file:///tmp/example.html'), 'unknown');
});

test('decorates tabs with display metadata without inventing primary sections', () => {
  const tabs = decorateTabs([
    { id: 1, title: 'Example', url: 'https://example.com', pinned: true, active: false },
    { id: 2, title: 'Hacker News', url: 'https://news.ycombinator.com', pinned: false, active: true },
  ], {
    renamedTabs: {
      1: 'Old Space-specific name',
      2: 'News panel name',
    },
  });

  assert.equal(tabs[0].displayTitle, 'Example');
  assert.equal(tabs[0].title, 'Example');
  assert.equal(tabs[0].panelTitle, undefined);
  assert.equal(tabs[1].displayTitle, 'News panel name');
  assert.equal(tabs[1].title, 'Hacker News');
  assert.equal(tabs[1].panelTitle, 'News panel name');
  assert.equal(tabs[1].domain, 'news.ycombinator.com');
});

test('decorates tabs by ignoring transient placeholder titles', () => {
  const tabs = decorateTabs([
    { id: 1, title: '...', url: 'https://bytedance.larkoffice.com/docx/123' },
    { id: 2, title: '…', url: 'https://bytedance.larkoffice.com/docx/456' },
    { id: 3, title: '...', url: 'https://example.com/renamed' },
  ], {
    renamedTabs: {
      3: 'Renamed page',
    },
  });

  assert.equal(tabs[0].displayTitle, 'bytedance.larkoffice.com');
  assert.equal(tabs[1].displayTitle, 'bytedance.larkoffice.com');
  assert.equal(tabs[2].displayTitle, 'Renamed page');
  assert.equal(tabs[2].panelTitle, 'Renamed page');
});

test('plans tidy groups from tab domains and titles', () => {
  const groups = planTidyGroups([
    { id: 1, title: 'GitHub issue', url: 'https://github.com/a/b/issues/1' },
    { id: 2, title: 'GitHub PR', url: 'https://github.com/a/b/pull/2' },
    { id: 3, title: 'Z.AI docs', url: 'https://docs.z.ai/guides' },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'GitHub');
  assert.deepEqual(groups[0].tabIds, [1, 2]);
});

test('treats a temporarily missing tab list as an empty tidy plan', () => {
  assert.deepEqual(planTidyGroups(), []);
});

test('keeps AI topic groups intact across different domains', () => {
  const tabs = [
    { id: 1, title: 'Claude Code overview', url: 'https://docs.anthropic.com/en/docs/claude-code/overview' },
    { id: 2, title: 'Claude Code GitHub Actions setup', url: 'https://github.com/example/claude-code-actions' },
    { id: 3, title: 'Monica AI Tool dashboard', url: 'https://monica.im/home' },
    { id: 4, title: 'Claude Code troubleshooting', url: 'https://example.com/claude-code-debug' },
  ];
  const groups = sanitizeTidyGroups([
    { title: 'Claude Code', color: 'purple', tabIds: [1, 2, 2, 999] },
    { title: 'Monica', color: 'green', tabIds: [2, 3] },
    { title: '  claude   code  ', color: 'blue', tabIds: [4] },
  ], tabs);

  assert.deepEqual(groups.map((group) => group.title), ['Claude Code', 'Monica']);
  assert.deepEqual(groups.map((group) => group.tabIds), [[1, 2, 4], [3]]);
});

test('keeps complete logical Auto Group titles instead of persisting Chrome display truncation', () => {
  const longTitle = 'Auto Group Canonical Duplicate E2E';
  const groups = sanitizeTidyGroups([
    { title: longTitle, tabIds: [1] },
  ], [{ id: 1 }]);

  assert.equal(groups[0].title, longTitle);
});

test('rejects an AI group plan that silently leaves eligible tabs unassigned', () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const completePlan = [
    { title: 'Research', tabIds: [1, 2] },
    { title: 'Later', tabIds: [3] },
  ];

  assert.equal(assertCompleteAutoGroupPlan(completePlan, tabs), completePlan);
  assert.throws(
    () => assertCompleteAutoGroupPlan([
      { title: 'Research', tabIds: [1, 2] },
    ], tabs),
    /incomplete group plan.*1 eligible tab unassigned/i,
  );
  assert.throws(
    () => assertCompleteAutoGroupPlan([null], [{ id: 1 }, null, { id: 2 }]),
    /incomplete group plan.*2 eligible tabs unassigned/i,
  );
  assert.deepEqual(assertCompleteAutoGroupPlan(), []);
  assert.equal(assertCompleteAutoGroupPlan(null, null), null);
});

test('searches tabs by title, URL, and domain', () => {
  const results = searchTabs([
    { title: 'GLM docs', url: 'https://docs.z.ai/guides', domain: 'docs.z.ai' },
    { title: 'Inbox', url: 'https://mail.example.com', domain: 'mail.example.com' },
  ], 'z.ai');

  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'GLM docs');
});

test('builds searchable group preview rows from panel tab metadata', () => {
  const items = buildGroupPreviewItems({
    title: 'AI',
    tabs: [
      {
        id: 1,
        title: '...',
        displayTitle: 'ZHIPU AI OPEN PLATFORM',
        url: 'https://bigmodel.cn/dev',
        domain: 'bigmodel.cn',
        favIconUrl: 'https://example.com/zhipu.png',
        active: true,
      },
      {
        id: 2,
        title: 'NotebookLM: personalized notes',
        url: 'https://notebooklm.google.com',
        domain: 'notebooklm.google.com',
        dormant: true,
      },
    ],
  }, 'note');

  assert.deepEqual(items, [{
    id: 2,
    title: 'NotebookLM: personalized notes',
    subtitle: 'notebooklm.google.com',
    url: 'https://notebooklm.google.com',
    favIconUrl: '',
    active: false,
    dormant: true,
  }]);
});

test('places group hover preview to the right instead of covering the group from the left', () => {
  assert.deepEqual(planGroupPreviewPlacement({
    anchorRect: { left: 24, right: 260, top: 120, width: 236 },
    viewportWidth: 900,
    viewportHeight: 720,
    panelHeight: 280,
  }), {
    width: 360,
    maxHeight: 704,
    left: 268,
    top: 114,
    placement: 'right',
  });

  const compact = planGroupPreviewPlacement({
    anchorRect: { left: 28, right: 730, top: 180, width: 702 },
    viewportWidth: 758,
    viewportHeight: 768,
    panelHeight: 480,
  });

  assert.equal(compact.placement, 'right-edge');
  assert.equal(compact.width, 348);
  assert.equal(compact.left, 402);
  assert.ok(compact.left > 360, 'compact preview should stay on the right side of the panel');
});

test('prefers web pages when choosing a tab to keep shortcuts usable', () => {
  const tabs = [
    { id: 1, url: 'about:blank' },
    { id: 2, url: 'chrome://extensions' },
    { id: 3, url: 'https://example.com/page' },
  ];

  assert.equal(isPageShortcutCapableUrl('https://example.com'), true);
  assert.equal(isPageShortcutCapableUrl('chrome://newtab'), false);
  assert.equal(preferredFocusableTab(tabs).id, 3);
  assert.equal(preferredFocusableTab(tabs.slice(0, 2)).id, 1);
});

test('plans exact duplicate webpage URL closures while keeping one tab', () => {
  const closeIds = planDuplicateUrlClosures([
    { id: 1, url: 'https://example.com/a', index: 0 },
    { id: 2, url: 'https://example.com/a', index: 1, active: true },
    { id: 3, url: 'https://example.com/a', index: 2 },
    { id: 4, url: 'https://example.com/a#section', index: 3 },
    { id: 5, url: 'chrome://newtab', index: 4 },
    { id: 6, url: 'chrome://newtab', index: 5 },
  ]);

  assert.deepEqual(closeIds, [1, 3]);
});

test('prefers pinned duplicate webpage tabs when no duplicate is active', () => {
  const closeIds = planDuplicateUrlClosures([
    { id: 1, url: 'https://example.com/a', index: 0 },
    { id: 2, url: 'https://example.com/a', index: 1, pinned: true },
    { id: 3, url: 'https://example.com/a', index: 2 },
  ]);

  assert.deepEqual(closeIds, [1, 3]);
});

test('plans a Chrome tab group for the active space', () => {
  const plan = spaceGroupPlan({
    space: { name: 'Work', color: 'blue' },
    tabIds: [1, 2],
  });

  assert.deepEqual(plan, {
    title: 'Work',
    color: 'blue',
    tabIds: [1, 2],
  });
});

test('compacts Chrome group titles without collisions or broken emoji', () => {
  const title31 = 'a'.repeat(31);
  const title32 = 'b'.repeat(32);
  const sharedAsciiPrefix = 'c'.repeat(32);
  const sharedChinesePrefix = '资料'.repeat(16);
  const emojiBoundary = `${'😀'.repeat(15)}a😀`;

  assert.equal(spaceGroupPlan({ space: { name: title31 }, tabIds: [] }).title, title31);
  assert.equal(spaceGroupPlan({ space: { name: title32 }, tabIds: [] }).title, title32);

  const asciiA = spaceGroupPlan({ space: { name: `${sharedAsciiPrefix}A` }, tabIds: [] }).title;
  const asciiB = spaceGroupPlan({ space: { name: `${sharedAsciiPrefix}B` }, tabIds: [] }).title;
  const chineseA = spaceGroupPlan({ space: { name: `${sharedChinesePrefix}甲` }, tabIds: [] }).title;
  const chineseB = spaceGroupPlan({ space: { name: `${sharedChinesePrefix}乙` }, tabIds: [] }).title;
  const emoji = spaceGroupPlan({ space: { name: emojiBoundary }, tabIds: [] }).title;

  assert.notEqual(asciiA, asciiB, 'different long titles with the same prefix need distinct Chrome identities');
  assert.notEqual(chineseA, chineseB, 'CJK titles must not collide after Chrome compaction');
  for (const title of [asciiA, asciiB, chineseA, chineseB, emoji]) {
    assert.ok(title.length <= 32, `Chrome title exceeds 32 UTF-16 code units: ${title}`);
    assert.doesNotMatch(title, /[\uD800-\uDBFF]$/, 'Chrome title must not end with a split surrogate');
  }
});

test('builds a Space -> TabGroup -> Tab view', () => {
  const view = buildSpaceView({
    activeSpaceId: 'work',
    groupSpaces: { 8: 'work', 9: 'personal' },
    tabs: [
      { id: 1, title: 'Spec', url: 'https://docs.example.com', groupId: 8 },
      { id: 2, title: 'Mail', url: 'https://mail.example.com', groupId: 9 },
      { id: 3, title: 'Loose', url: 'https://loose.example.com', groupId: -1 },
    ],
    groups: [
      { id: 8, title: 'Docs', color: 'blue' },
      { id: 9, title: 'Personal', color: 'green' },
    ],
  });

  assert.equal(view.length, 1);
  assert.equal(view[0].title, 'Docs');
  assert.deepEqual(view[0].tabs.map((tab) => tab.id), [1]);
});

test('treats Chrome tab group id 0 as a real group', () => {
  const view = buildSpaceView({
    activeSpaceId: 'work',
    groupSpaces: { 0: 'work' },
    tabs: [
      { id: 1, title: 'Spec', url: 'https://docs.example.com', groupId: 0 },
      { id: 2, title: 'Loose', url: 'https://loose.example.com', groupId: -1 },
    ],
    groups: [
      { id: 0, title: 'Zero', color: 'blue' },
    ],
  });

  assert.equal(view.length, 1);
  assert.equal(view[0].key, 'group:0');
  assert.deepEqual(view[0].tabs.map((tab) => tab.id), [1]);
});

test('builds Space view using saved group order, tab order, and collapsed state', () => {
  const view = buildSpaceView({
    activeSpaceId: 'default',
    groupSpaces: { 8: 'default' },
    tabSpaces: { 3: 'default' },
    groupOrder: { default: ['ungrouped', 'group:8'] },
    tabOrder: { default: { 'group:8': [2, 1] } },
    collapsedGroups: { 'group:8': true },
    tabs: [
      { id: 1, title: 'Spec', url: 'https://docs.example.com/a', groupId: 8, index: 0 },
      { id: 2, title: 'Guide', url: 'https://docs.example.com/b', groupId: 8, index: 1 },
      { id: 3, title: 'Loose', url: 'https://loose.example.com', groupId: -1, index: 2 },
    ],
    groups: [
      { id: 8, title: 'Docs', color: 'blue' },
    ],
  });

  assert.deepEqual(view.map((group) => group.key), ['ungrouped', 'group:8']);
  assert.equal(view[1].collapsed, true);
  assert.deepEqual(view[1].tabs.map((tab) => tab.id), [2, 1]);
});

test('builds legacy virtual groups only for ungrouped local tabs', () => {
  const view = buildSpaceView({
    activeSpaceId: 'default',
    tabSpaces: { 1: 'default', 2: 'default' },
    tabGroups: { 1: 'vgroup:docs' },
    virtualGroups: {
      'vgroup:docs': { title: 'Docs', color: 'green', spaceId: 'default' },
    },
    groupOrder: { default: ['vgroup:docs', 'ungrouped'] },
    tabs: [
      { id: 1, title: 'Spec', url: 'https://docs.example.com/a', groupId: -1 },
      { id: 2, title: 'Loose', url: 'https://loose.example.com', groupId: -1 },
    ],
    includeUngrouped: true,
  });

  assert.deepEqual(view.map((group) => group.key), ['vgroup:docs', 'ungrouped']);
  assert.equal(view[0].title, 'Docs');
  assert.deepEqual(view[0].tabs.map((tab) => tab.id), [1]);
  assert.deepEqual(view[1].tabs.map((tab) => tab.id), [2]);
});

test('uses Chrome group ownership ahead of stale local tab ownership in Space view', () => {
  const view = buildSpaceView({
    activeSpaceId: 'default',
    groupSpaces: { 8: 'other' },
    tabSpaces: { 1: 'default', 2: 'other' },
    tabs: [
      { id: 1, title: 'Spec', url: 'https://docs.example.com/a', groupId: 8 },
      { id: 2, title: 'Plan', url: 'https://docs.example.com/b', groupId: 8 },
      { id: 3, title: 'Foreign', url: 'https://docs.example.com/c', groupId: 8 },
    ],
    groups: [
      { id: 8, title: 'Chrome Group', color: 'blue' },
    ],
    includeUngrouped: true,
  });

  assert.deepEqual(view.map((group) => group.key), ['ungrouped']);
  assert.deepEqual(view[0].tabs.map((tab) => tab.id), []);
});

test('renders Chrome groups before stale virtual mappings for grouped tabs', () => {
  const view = buildSpaceView({
    activeSpaceId: 'default',
    groupSpaces: { 8: 'default' },
    tabSpaces: { 1: 'default' },
    tabGroups: { 1: 'vgroup:docs' },
    virtualGroups: {
      'vgroup:docs': { title: 'Local Docs', color: 'green', spaceId: 'default' },
    },
    tabs: [
      { id: 1, title: 'Spec', url: 'https://docs.example.com/a', groupId: 8 },
    ],
    groups: [
      { id: 8, title: 'Chrome Docs', color: 'blue' },
    ],
  });

  assert.deepEqual(view.map((group) => group.key), ['group:8']);
  assert.equal(view[0].title, 'Chrome Docs');
});

test('keeps an explicitly untitled Chrome group distinct from inferred and Ungrouped sections', () => {
  const view = buildSpaceView({
    activeSpaceId: 'default',
    groupSpaces: { 8: 'default', 9: 'default' },
    tabs: [
      { id: 1, title: 'Spec', url: 'https://docs.example.com/a', groupId: 8 },
      { id: 2, title: 'Inbox', url: 'https://mail.example.com/inbox', groupId: 9 },
    ],
    groups: [
      { id: 8, title: '', color: 'blue' },
      { id: 9, color: 'red' },
    ],
    includeUngrouped: true,
  });

  assert.deepEqual(view.map(({ key, title }) => ({ key, title })), [
    { key: 'group:8', title: '' },
    { key: 'group:9', title: 'Mail' },
    { key: 'ungrouped', title: 'Ungrouped' },
  ]);
});

test('uses local collapsed state over Chrome tab group state', () => {
  const view = buildSpaceView({
    activeSpaceId: 'default',
    groupSpaces: { 8: 'default' },
    collapsedGroups: { 'group:8': false },
    tabs: [
      { id: 1, title: 'Spec', url: 'https://docs.example.com/a', groupId: 8 },
    ],
    groups: [
      { id: 8, title: 'Docs', color: 'blue', collapsed: true },
    ],
  });

  assert.equal(view[0].collapsed, false);
});

test('can keep an empty Ungrouped bucket visible as a drop target', () => {
  const view = buildSpaceView({
    activeSpaceId: 'default',
    groupSpaces: { 8: 'default' },
    tabs: [
      { id: 1, title: 'Spec', url: 'https://docs.example.com/a', groupId: 8 },
    ],
    groups: [
      { id: 8, title: 'Docs', color: 'blue' },
    ],
    includeUngrouped: true,
  });

  assert.deepEqual(view.map((group) => group.key), ['group:8', 'ungrouped']);
  assert.deepEqual(view.find((group) => group.key === 'ungrouped').tabs, []);
});

test('normalizes Space group plans and filters invalid tab ids', () => {
  const longName = 'A very long Space name that Chrome should truncate safely';
  const plan = spaceGroupPlan({
    space: { name: longName, color: 'not-a-color' },
    tabIds: [1, '2', 'bad', Number.NaN],
  });

  assert.deepEqual(plan, {
    title: chromeGroupTitle(longName, 'Space'),
    color: 'blue',
    tabIds: [1, 2],
  });
});

test('ignores pinned tabs when planning tidy groups', () => {
  const groups = planTidyGroups([
    { id: 1, title: 'Pinned GitHub issue', url: 'https://github.com/a/b/issues/1', pinned: true },
    { id: 2, title: 'GitHub PR', url: 'https://github.com/a/b/pull/2' },
  ]);

  assert.deepEqual(groups, [
    { title: 'GitHub', tabIds: [2], color: 'blue' },
  ]);
});

test('plans readable panel-only tab names without creating tab groups', () => {
  const names = planTidyTabNames([
    { id: 1, title: 'GitHub - openai/codex/pull/123', url: 'https://github.com/openai/codex/pull/123' },
    { id: 2, title: 'Chrome Extensions: sidePanel API', url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel' },
  ]);

  assert.equal(names[1], 'GitHub - openai/codex PR #123');
  assert.equal(names[2], 'Chrome Extensions - sidePanel API');
});

test('preserves existing panel names when tidying tab names', () => {
  const names = planTidyTabNames([
    { id: 1, title: '67.216.201.49 - 入站', url: 'https://67.216.201.49:44374/yeeZEFFCMxa0ut6T5D/panel/inbounds' },
    { id: 2, title: 'Chrome Extensions: sidePanel API', url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel' },
  ], {
    existingNames: { 1: '3X-UI' },
    preserveExisting: true,
  });

  assert.equal(names[1], '3X-UI');
  assert.equal(names[2], 'Chrome Extensions - sidePanel API');
});

test('tidies 3X-UI panel pages without using the IP host as the app name', () => {
  const names = planTidyTabNames([
    { id: 1, title: '67.216.201.49 - 入站', url: 'https://67.216.201.49:44374/yeeZEFFCMxa0ut6T5D/panel/inbounds' },
  ]);

  assert.equal(names[1], '3X-UI - 入站');
});

test('tidies common AI and search pages into visibly shorter panel names', () => {
  const names = planTidyTabNames([
    { id: 1, title: 'Build responsive front-end designs with Codex | OpenAI Developers', url: 'https://developers.openai.com/codex/use-cases/frontend-designs' },
    { id: 2, title: 'Claude Code overview - Anthropic', url: 'https://docs.anthropic.com/en/docs/claude-code/overview' },
    { id: 3, title: 'Account - Monica', url: 'https://monica.im/home' },
    { id: 4, title: '百度新闻——海量中文资讯平台', url: 'https://news.baidu.com/' },
  ]);

  assert.equal(names[1], 'OpenAI - Codex frontend designs');
  assert.equal(names[2], 'Claude - Code overview');
  assert.equal(names[3], 'Monica - Account');
  assert.equal(names[4], 'Baidu News');
});

test('keeps GitHub repository context when tidying panel names', () => {
  const names = planTidyTabNames([
    {
      id: 1,
      title: 'GitHub - AgriciDaniel/claude-code-router',
      url: 'https://github.com/AgriciDaniel/claude-code-router',
      outlineHeadings: ['AgriciDaniel/claude-code-router', 'README'],
    },
    {
      id: 2,
      title: 'Fix request routing by alice · Pull Request #42 · AgriciDaniel/claude-code-router',
      url: 'https://github.com/AgriciDaniel/claude-code-router/pull/42',
      outlineHeadings: ['Fix request routing'],
    },
  ]);

  assert.equal(names[1], 'GitHub - AgriciDaniel/claude-code-router');
  assert.equal(names[2], 'GitHub - AgriciDaniel/claude-code-router PR #42 Fix request routing');
});

test('tidies names with loading/placeholder titles like dots using heading or domain fallback', () => {
  const names = planTidyTabNames([
    { id: 1, title: '...', url: 'https://bytedance.larkoffice.com/docx/123', outlineHeadings: ['Mail Harness 架构详情介绍', 'README'] },
    { id: 2, title: 'loading...', url: 'https://bytedance.larkoffice.com/docx/456', outlineHeadings: [] },
    { id: 3, title: '…', url: 'https://bytedance.larkoffice.com/docx/789', outlineHeadings: [] },
    { id: 4, title: 'loading…', url: 'https://bytedance.larkoffice.com/docx/000', outlineHeadings: [] },
  ]);

  assert.equal(names[1], 'Mail Harness 架构详情介绍');
  assert.equal(names[2], 'bytedance.larkoffice.com');
  assert.equal(names[3], 'bytedance.larkoffice.com');
  assert.equal(names[4], 'bytedance.larkoffice.com');
});

test('handles empty and malformed transient inputs without breaking panel actions', () => {
  assert.equal(isChromeNewTabUrl(), false);
  assert.equal(isChromeNewTabUrl('not a URL'), false);
  assert.equal(isPageShortcutCapableUrl(), false);
  assert.equal(isPageShortcutCapableUrl('not a URL'), false);
  assert.deepEqual(decorateTabs(), []);
  assert.deepEqual(searchTabs(undefined, 'find me'), []);
  assert.deepEqual(buildSpaceView(), []);
  assert.deepEqual(spaceGroupPlan(), {
    title: 'Space',
    color: 'blue',
    tabIds: [],
  });
  assert.deepEqual(compactTabForAI(), {
    id: undefined,
    title: '',
    url: '',
    domain: 'unknown',
  });
  assert.equal(tidyPanelName(), 'unknown');
  assert.equal(titleForDomain(), 'Other');
  assert.equal(preferredFocusableTab(), null);
});

test('uses the compact-right preview layout when enough side room remains', () => {
  const placement = planGroupPreviewPlacement({
    anchorRect: { left: 20, right: 350, top: 590, width: 330 },
    viewportWidth: 700,
    viewportHeight: 700,
    panelHeight: 280,
  });

  assert.deepEqual(placement, {
    width: 334,
    maxHeight: 684,
    left: 358,
    top: 412,
    placement: 'right-compact',
  });

  const safeDefaults = planGroupPreviewPlacement({
    anchorRect: { left: 'bad', width: -10, top: 'bad' },
    viewportWidth: 0,
    viewportHeight: Number.NaN,
    preferredWidth: -1,
    minWidth: 0,
    panelHeight: 0,
  });
  assert.equal(safeDefaults.left, 8);
  assert.equal(safeDefaults.top, 8);
  assert.equal(safeDefaults.maxHeight, 584);
});

test('builds bounded preview rows with useful fallbacks for incomplete tab data', () => {
  assert.deepEqual(buildGroupPreviewItems(undefined), []);
  assert.deepEqual(buildGroupPreviewItems({ tabs: [{}] }, '', { limit: -1 }), []);
  assert.deepEqual(buildGroupPreviewItems({
    tabs: [
      { id: 1, panelTitle: 'Saved name', url: 'https://example.com/a' },
      { id: 2, url: 'not a URL', domain: 'unknown' },
      {},
    ],
  }, '', { limit: 'not-a-number' }), [
    {
      id: 1,
      title: 'Saved name',
      subtitle: 'example.com',
      url: 'https://example.com/a',
      favIconUrl: '',
      active: false,
      dormant: false,
    },
    {
      id: 2,
      title: 'not a URL',
      subtitle: 'not a URL',
      url: 'not a URL',
      favIconUrl: '',
      active: false,
      dormant: false,
    },
    {
      id: undefined,
      title: 'Untitled',
      subtitle: '',
      url: '',
      favIconUrl: '',
      active: false,
      dormant: false,
    },
  ]);
});

test('recognizes placeholder variants but keeps real loading titles', () => {
  assert.equal(isPlaceholderTabTitle(), true);
  assert.equal(isPlaceholderTabTitle(' 。 … '), true);
  assert.equal(isPlaceholderTabTitle('LOADING⋯'), true);
  assert.equal(isPlaceholderTabTitle('Loading report'), false);
});

test('classifies tidy groups by user-facing purpose and cycles safe colors', () => {
  const groups = planTidyGroups([
    null,
    { id: 0, title: 'Ignored', url: 'https://ignored.example' },
    { id: 1, title: 'Claude chat', url: 'https://example.com/chat' },
    { id: 2, title: 'Monica helper', url: 'https://example.com/helper' },
    { id: 3, title: 'Repository', url: 'https://github.com/openai/codex' },
    { id: 4, title: 'API guide', url: 'https://example.com/api' },
    { id: 5, title: 'Inbox', url: 'https://example.com/inbox' },
    { id: 6, title: 'Team meeting', url: 'https://example.com/meeting' },
    { id: 7, title: 'Product', url: 'https://shop.example.com/product' },
    { id: 8, title: 'Broken', url: 'not a URL' },
  ]);

  assert.deepEqual(groups.map(({ title, color }) => ({ title, color })), [
    { title: 'Claude', color: 'blue' },
    { title: 'Monica', color: 'green' },
    { title: 'GitHub', color: 'purple' },
    { title: 'Docs', color: 'yellow' },
    { title: 'Mail', color: 'pink' },
    { title: 'Calendar', color: 'cyan' },
    { title: 'Example', color: 'orange' },
    { title: 'Other', color: 'blue' },
  ]);

  assert.equal(titleForDomain('docs.example.com', 'Page'), 'Docs');
  assert.equal(titleForDomain('mail.example.com', 'Page'), 'Mail');
  assert.equal(titleForDomain('calendar.example.com', 'Page'), 'Calendar');
  assert.equal(titleForDomain('localhost', 'Page'), 'Localhost');
});

test('sanitizes incomplete AI group plans and assigns each live tab once', () => {
  assert.deepEqual(sanitizeTidyGroups(), []);
  assert.deepEqual(sanitizeTidyGroups([
    { title: '', tabIds: [1, '1', 'bad', null] },
    { title: 'Later', tabIds: [1, 2] },
    { title: 'Empty', tabIds: null },
  ], [
    { id: 1 },
    { id: 2 },
  ]), [
    { title: 'Tabs', tabIds: [1], color: 'blue' },
    { title: 'Later', tabIds: [2], color: 'green' },
  ]);
  assert.deepEqual(plannedRegroupTabIds(), []);
  assert.deepEqual(plannedRegroupTabIds([
    { title: 'Unused' },
    { title: 'Docs', tabIds: [9] },
  ], [
    { id: 9, groupId: 42 },
  ]), [9]);
  assert.deepEqual(planTidyTabNames(), {});
  assert.deepEqual(planDuplicateUrlClosures(null), []);
});

test('keeps the earliest duplicate when no active or pinned copy exists', () => {
  assert.deepEqual(planDuplicateUrlClosures([
    null,
    { id: 1, url: 'not a URL' },
    { id: 2, url: 'https://example.com/only', index: 9 },
    { id: 3, url: ' https://example.com/same ', index: 4 },
    { id: 4, url: 'https://example.com/same', index: 2 },
  ]), [3]);
  assert.deepEqual(planDuplicateUrlClosures([
    { id: 5, url: 'https://example.com/no-index' },
    { id: 6, url: 'https://example.com/no-index' },
  ]), [6]);
});

test('infers missing Chrome-group metadata and applies virtual-group defaults', () => {
  const view = buildSpaceView({
    activeSpaceId: 'work',
    groupSpaces: { 8: 'work' },
    tabSpaces: { 2: 'work', 3: 'work' },
    tabGroups: { 2: 'virtual:notes' },
    virtualGroups: {
      'virtual:notes': { title: 'Notes', collapsed: true },
    },
    collapsedGroups: { ungrouped: true },
    tabs: [
      { id: 1, title: 'API guide', url: 'https://docs.example.com/api', groupId: 8, index: 2 },
      { id: 2, title: 'Scratchpad', url: 'https://notes.example.com', groupId: -1, index: 1 },
      { id: 3, title: 'Loose', url: 'https://loose.example.com', groupId: -1, index: 0 },
    ],
    includeUngrouped: true,
  });

  assert.deepEqual(view.map(({ key, title, color, collapsed }) => ({ key, title, color, collapsed })), [
    { key: 'group:8', title: 'Docs', color: 'grey', collapsed: false },
    { key: 'virtual:notes', title: 'Notes', color: 'grey', collapsed: true },
    { key: 'ungrouped', title: 'Ungrouped', color: 'grey', collapsed: true },
  ]);
});

test('tidies major service pages and generic fallbacks into recognizable names', () => {
  const cases = [
    [{ title: 'Issues - GitHub', url: 'https://github.com/issues', outlineHeadings: null }, 'GitHub - Issues'],
    [{ title: 'GitHub', url: 'https://github.com/issues', outlineHeadings: [null, 'x', 'Navigation menu', 'Project overview'] }, 'GitHub - Project overview'],
    [{ title: 'Bug report', url: 'https://github.com/openai/codex/issues/27' }, 'GitHub - openai/codex issue #27'],
    [{ title: 'API reference', url: 'https://developers.openai.com/api-reference/responses' }, 'OpenAI - responses'],
    [{ title: 'Developers', url: 'https://developers.openai.com/' }, 'OpenAI Developers'],
    [{ title: 'ChatGPT | OpenAI', url: 'https://openai.com/chatgpt' }, 'OpenAI - ChatGPT'],
    [{ title: 'OpenAI', url: 'https://openai.com/' }, 'OpenAI'],
    [{ title: 'Models - Anthropic', url: 'https://www.anthropic.com/models' }, 'Claude - Models'],
    [{ title: 'Anthropic', url: 'https://docs.anthropic.com/en/docs/claude-code/' }, 'Claude - Code'],
    [{ title: 'Monica AI', url: 'https://monica.im/' }, 'Monica'],
    [{ title: '百度一下', url: 'https://www.baidu.com/' }, 'Baidu'],
    [{ title: '作者文章', url: 'https://baijiahao.baidu.com/s?id=1' }, 'Baijiahao'],
    [{ title: 'ZHIPU AI OPEN PLATFORM', url: 'https://bigmodel.cn/dev' }, 'Zhipu AI - Open Platform'],
    [{ title: '模型列表 - Zhipu AI', url: 'https://open.bigmodel.cn/models' }, 'Zhipu AI - 模型列表'],
    [{ title: 'X-UI 面板', url: 'https://server.example/panel/outbounds' }, '3X-UI - 出站'],
    [{ title: '3X-UI', url: 'https://server.example/panel' }, '3X-UI'],
    [{ title: 'Xray panel', url: 'https://server.example/panel/custom-route' }, '3X-UI - custom route'],
    [{ title: '', url: 'https://developer.chrome.com/' }, 'Chrome Extensions - Docs'],
    [{ title: 'Anything', url: 'https://docs.z.ai/guide' }, 'Z.AI - GLM docs'],
    [{ title: 'Anything', url: 'https://resources.arc.net/help' }, 'Browser docs'],
    [{ title: 'Messages', url: 'https://mail.example.com/' }, 'Mail - Inbox'],
    [{ title: 'Offline title', url: 'not a URL' }, 'Offline title'],
    [{ title: '', url: 'https://plain.example.com/' }, 'plain.example.com'],
    [{ title: 'x'.repeat(60), url: 'https://plain.example.com/' }, `${'x'.repeat(45)}...`],
    [
      { title: `${'Long topic '.repeat(8)}| OpenAI`, url: 'https://openai.com/research' },
      `${`OpenAI - ${'Long topic '.repeat(8).trim()}`.slice(0, 45)}...`,
    ],
  ];

  for (const [tab, expected] of cases) assert.equal(tidyPanelName(tab), expected);

  assert.equal(compactUrlForAI(' chrome://extensions/?secret=1#hash '), 'chrome://extensions/?secret=1#hash');
  assert.equal(compactUrlForAI(`not a URL?${'x'.repeat(600)}`).length, 512);
  assert.equal(titleForDomain('', ''), 'Tabs');
});
