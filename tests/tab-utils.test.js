import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpaceView,
  decorateTabs,
  domainFromUrl,
  planTidyGroups,
  planTidyTabNames,
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

test('keeps Claude Code tabs out of Monica groups when sanitizing AI plans', () => {
  const tabs = [
    { id: 1, title: 'Claude Code overview', url: 'https://docs.anthropic.com/en/docs/claude-code/overview' },
    { id: 2, title: 'Monica AI Tool dashboard', url: 'https://monica.im/home' },
  ];
  const groups = sanitizeTidyGroups([
    { title: 'Monica', color: 'purple', tabIds: [1, 2] },
  ], tabs);

  assert.deepEqual(groups.map((group) => group.title), ['Claude', 'Monica']);
  assert.deepEqual(groups.map((group) => group.tabIds), [[1], [2]]);
});

test('searches tabs by title, URL, and domain', () => {
  const results = searchTabs([
    { title: 'GLM docs', url: 'https://docs.z.ai/guides', domain: 'docs.z.ai' },
    { title: 'Inbox', url: 'https://mail.example.com', domain: 'mail.example.com' },
  ], 'z.ai');

  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'GLM docs');
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

test('uses Chrome tab group collapsed state when building grouped Space rows', () => {
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

  assert.equal(view[0].collapsed, true);
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

test('plans readable panel-only tab names without creating tab groups', () => {
  const names = planTidyTabNames([
    { id: 1, title: 'GitHub - openai/codex/pull/123', url: 'https://github.com/openai/codex/pull/123' },
    { id: 2, title: 'Chrome Extensions: sidePanel API', url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel' },
  ]);

  assert.equal(names[1], 'GitHub - pull/123');
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
