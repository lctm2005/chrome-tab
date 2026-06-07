import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpaceView,
  decorateTabs,
  domainFromUrl,
  isPageShortcutCapableUrl,
  planDuplicateUrlClosures,
  planTidyGroups,
  planTidyTabNames,
  preferredFocusableTab,
  sanitizeTidyGroups,
  spaceGroupPlan,
  searchTabs,
} from '../src/shared/tab-utils.js';

test('extracts readable domains from URLs', () => {
  assert.equal(domainFromUrl('https://docs.z.ai/guides/llm/glm-5.1'), 'docs.z.ai');
  assert.equal(domainFromUrl('chrome://extensions'), 'chrome');
  assert.equal(domainFromUrl('not a url'), 'unknown');
});

test('decorates tabs with display metadata without inventing primary sections', () => {
  const tabs = decorateTabs([
    { id: 1, title: 'Example', url: 'https://example.com', pinned: true, active: false },
    { id: 2, title: 'Hacker News', url: 'https://news.ycombinator.com', pinned: false, active: true },
  ]);

  assert.equal(tabs[0].displayTitle, 'Example');
  assert.equal(tabs[1].domain, 'news.ycombinator.com');
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

test('searches tabs by title, URL, and domain', () => {
  const results = searchTabs([
    { title: 'GLM docs', url: 'https://docs.z.ai/guides', domain: 'docs.z.ai' },
    { title: 'Inbox', url: 'https://mail.example.com', domain: 'mail.example.com' },
  ], 'z.ai');

  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'GLM docs');
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
  const plan = spaceGroupPlan({
    space: { name: 'A very long Space name that Chrome should truncate safely', color: 'not-a-color' },
    tabIds: [1, '2', 'bad', Number.NaN],
  });

  assert.deepEqual(plan, {
    title: 'A very long Space name that Chro',
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
  ]);

  assert.equal(names[1], 'Mail Harness 架构详情介绍');
  assert.equal(names[2], 'bytedance.larkoffice.com');
});
