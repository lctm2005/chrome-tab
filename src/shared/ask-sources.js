import { isPageShortcutCapableUrl } from './tab-utils.js';

export const DEFAULT_ASK_SOURCE_LIMIT = 12;
export const MAX_ASK_SOURCE_LIMIT = 24;

export function selectAskSpaceSources(spaceView = [], selectedTabIds = [], options = {}) {
  const allTabs = uniqueSpaceTabs(spaceView);
  const selectedValues = iterableValues(selectedTabIds);
  const selectedIds = normalizeTabIds(selectedValues);
  const selectedIdSet = new Set(selectedIds);
  const mode = selectedValues.length > 0 ? 'selected' : 'all';
  const eligibleTabs = allTabs.filter(isAskSourceTab);
  const candidates = mode === 'selected'
    ? eligibleTabs.filter((tab) => selectedIdSet.has(Number(tab.id)))
    : eligibleTabs;
  const limit = normalizeSourceLimit(options.limit);
  const tabs = candidates.slice(0, limit);
  const includedKeys = new Set(tabs.map(tabIdentity));
  const untouchedTabs = allTabs.filter((tab) => !includedKeys.has(tabIdentity(tab)));
  const limitedCount = Math.max(0, candidates.length - tabs.length);

  return {
    mode,
    tabs,
    tabIds: tabs.map((tab) => Number(tab.id)),
    untouchedTabs,
    count: tabs.length,
    untouchedCount: untouchedTabs.length,
    truncated: limitedCount > 0,
    counts: {
      total: allTabs.length,
      eligible: eligibleTabs.length,
      selected: selectedIds.length,
      requested: candidates.length,
      included: tabs.length,
      untouched: untouchedTabs.length,
      excluded: allTabs.length - eligibleTabs.length,
      limited: limitedCount,
    },
  };
}

export function appendAskSourceLinks(answer, pages = []) {
  const linkedPages = (Array.isArray(pages) ? pages : [])
    .filter((page) => isPageShortcutCapableUrl(page?.url))
    .map((page, index) => {
      const title = String(page.title || page.url || `Source ${index + 1}`)
        .replace(/[\[\]]/g, '')
        .trim();
      const url = String(page.url || '').replace(/\)/g, '%29');
      return { number: index + 1, title, url };
    });
  let text = String(answer || '').trim();
  if (linkedPages.length === 0) return text;
  for (const page of linkedPages) {
    text = linkInlineCitation(text, page.number, page.url);
  }
  const sources = linkedPages.map((page) => `- [[${page.number}] ${page.title}](${page.url})`);
  return `${text}\n\n### Sources\n${sources.join('\n')}`.trim();
}

function linkInlineCitation(text, number, url) {
  const marker = `[${number}]`;
  const link = `[[${number}]](${url})`;
  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf(marker, cursor);
    if (index < 0) return output + text.slice(cursor);
    const alreadyLinked = index > 0 && text[index - 1] === '[';
    output += text.slice(cursor, index) + (alreadyLinked ? marker : link);
    cursor = index + marker.length;
  }
  return output;
}

function uniqueSpaceTabs(spaceView = []) {
  const tabs = [];
  const indexes = new Map();
  for (const group of Array.isArray(spaceView) ? spaceView : []) {
    for (const tab of Array.isArray(group?.tabs) ? group.tabs : []) {
      if (!tab || typeof tab !== 'object') continue;
      const key = tabIdentity(tab);
      if (!key) continue;
      const existingIndex = indexes.get(key);
      if (existingIndex === undefined) {
        indexes.set(key, tabs.length);
        tabs.push(tab);
      } else if (tabs[existingIndex]?.dormant && !tab.dormant) {
        tabs[existingIndex] = tab;
      }
    }
  }
  return tabs;
}

function isAskSourceTab(tab) {
  return !tab?.dormant &&
    Number.isFinite(Number(tab?.id)) &&
    isPageShortcutCapableUrl(tab?.url);
}

function normalizeTabIds(values = []) {
  const ids = [];
  const seen = new Set();
  for (const value of iterableValues(values)) {
    const id = Number(value);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function iterableValues(values) {
  if (Array.isArray(values)) return values;
  if (values && typeof values[Symbol.iterator] === 'function') return [...values];
  return [];
}

function tabIdentity(tab = {}) {
  const numericId = Number(tab.id);
  if (Number.isFinite(numericId)) return `id:${numericId}`;
  const id = String(tab.id || '').trim();
  if (id) return `id:${id}`;
  const url = String(tab.url || '').trim();
  return url ? `url:${url}` : '';
}

function normalizeSourceLimit(value) {
  const limit = Math.floor(Number(value));
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_ASK_SOURCE_LIMIT;
  return Math.min(limit, MAX_ASK_SOURCE_LIMIT);
}
