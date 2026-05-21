const GROUP_COLORS = ['blue', 'green', 'purple', 'yellow', 'pink', 'cyan', 'orange'];

export function domainFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'chrome:') return 'chrome';
    return url.hostname.replace(/^www\./, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function decorateTabs(tabs, state = {}) {
  return tabs.map((tab) => {
    const domain = domainFromUrl(tab.url);
    return {
      ...tab,
      domain,
      displayTitle: state.renamedTabs?.[tab.id] || tab.title || domain,
    };
  });
}

export function searchTabs(tabs, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return tabs;
  return tabs.filter((tab) => {
    return [tab.title, tab.displayTitle, tab.url, tab.domain]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
}

export function isPageShortcutCapableUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function preferredFocusableTab(tabs = []) {
  return tabs.find((tab) => isPageShortcutCapableUrl(tab.url)) || tabs[0] || null;
}

export function planTidyGroups(tabs) {
  const buckets = new Map();
  for (const tab of tabs) {
    if (!tab?.id || tab.pinned) continue;
    const domain = domainFromUrl(tab.url);
    const title = titleForDomain(domain, tab.title);
    if (!buckets.has(title)) buckets.set(title, []);
    buckets.get(title).push(tab.id);
  }

  return [...buckets.entries()]
    .filter(([, tabIds]) => tabIds.length > 0)
    .map(([title, tabIds], index) => ({
      title,
      tabIds,
      color: GROUP_COLORS[index % GROUP_COLORS.length],
    }));
}

export function sanitizeTidyGroups(plannedGroups, tabs) {
  const tabsById = new Map((tabs || []).map((tab) => [Number(tab.id), tab]));
  const assigned = new Set();
  const sanitizedByTitle = new Map();
  const sanitized = [];

  for (const group of plannedGroups || []) {
    const ids = uniqueNumbers(group.tabIds)
      .filter((id) => tabsById.has(id) && !assigned.has(id));
    if (ids.length === 0) continue;
    ids.forEach((id) => assigned.add(id));
    const title = compactGroupTitle(group.title);
    const titleKey = groupTitleKey(title);
    const existing = sanitizedByTitle.get(titleKey);
    if (existing) {
      existing.tabIds.push(...ids);
      continue;
    }
    const sanitizedGroup = { title, tabIds: ids, color: group.color };
    sanitizedByTitle.set(titleKey, sanitizedGroup);
    sanitized.push(sanitizedGroup);
  }

  return sanitized.map((group, index) => ({
    ...group,
    color: group.color || GROUP_COLORS[index % GROUP_COLORS.length],
  }));
}

export function groupTitleKey(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueNumbers(values = []) {
  const seen = new Set();
  const ids = [];
  for (const value of values || []) {
    const id = Number(value);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function compactGroupTitle(title) {
  const text = String(title || 'Tabs').replace(/\s+/g, ' ').trim();
  return (text || 'Tabs').slice(0, 32);
}

export function buildSpaceView({
  activeSpaceId,
  tabs,
  groups = [],
  groupSpaces = {},
  tabSpaces = {},
  groupOrder = {},
  tabOrder = {},
  collapsedGroups = {},
  includeUngrouped = false,
}) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const visibleTabs = tabs.filter((tab) => {
    if (isGroupedTab(tab)) return groupSpaces[tab.groupId] === activeSpaceId;
    return tabSpaces[tab.id] === activeSpaceId;
  });
  const buckets = new Map();

  for (const tab of visibleTabs) {
    const grouped = isGroupedTab(tab);
    const key = grouped ? `group:${tab.groupId}` : 'ungrouped';
    if (!buckets.has(key)) {
      const group = groupsById.get(tab.groupId);
      buckets.set(key, {
        key,
        id: grouped ? tab.groupId : 'ungrouped',
        title: grouped ? (group?.title || titleForDomain(tab.domain || domainFromUrl(tab.url), tab.title)) : 'Ungrouped',
        color: grouped ? (group?.color || 'grey') : 'grey',
        collapsed: grouped
          ? Boolean(group?.collapsed ?? collapsedGroups[key])
          : Boolean(collapsedGroups[key]),
        tabs: [],
      });
    }
    buckets.get(key).tabs.push(tab);
  }

  if (includeUngrouped && !buckets.has('ungrouped')) {
    buckets.set('ungrouped', {
      key: 'ungrouped',
      id: 'ungrouped',
      title: 'Ungrouped',
      color: 'grey',
      collapsed: Boolean(collapsedGroups.ungrouped),
      tabs: [],
    });
  }

  const spaceTabOrder = tabOrder[activeSpaceId] || {};
  const orderedGroups = [...buckets.values()]
    .filter((group) => group.tabs.length > 0 || (includeUngrouped && group.key === 'ungrouped'))
    .map((group) => ({
      ...group,
      tabs: sortBySavedOrder(group.tabs, spaceTabOrder[group.key] || [], (tab) => tab.id),
    }));

  return sortBySavedOrder(orderedGroups, groupOrder[activeSpaceId] || [], (group) => group.key);
}

function isGroupedTab(tab) {
  return Number.isFinite(Number(tab?.groupId)) && Number(tab.groupId) !== -1;
}

export function planTidyTabNames(tabs) {
  return Object.fromEntries(tabs.map((tab) => [tab.id, tidyPanelName(tab)]));
}

export function planDuplicateUrlClosures(tabs = []) {
  const buckets = new Map();
  for (const tab of tabs || []) {
    if (!tab?.id || !isPageShortcutCapableUrl(tab.url)) continue;
    const url = String(tab.url || '').trim();
    if (!url) continue;
    if (!buckets.has(url)) buckets.set(url, []);
    buckets.get(url).push(tab);
  }

  const closeIds = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const keep = preferredDuplicateUrlTab(bucket);
    for (const tab of bucket) {
      if (Number(tab.id) !== Number(keep.id)) closeIds.push(Number(tab.id));
    }
  }
  return closeIds;
}

function preferredDuplicateUrlTab(tabs) {
  return tabs.find((tab) => tab.active) ||
    tabs.find((tab) => tab.pinned) ||
    [...tabs].sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0))[0];
}

export function tidyPanelName(tab) {
  const domain = domainFromUrl(tab.url);
  const title = String(tab.title || '').replace(/\s+/g, ' ').trim();
  const path = safePath(tab.url);
  if (domain.includes('github.com')) {
    const repo = githubRepositoryName(path, tab.outlineHeadings);
    const heading = bestContentHeading(tab.outlineHeadings, [repo, 'GitHub']);
    const pr = path.match(/\/pull\/(\d+)/);
    const issue = path.match(/\/issues\/(\d+)/);
    if (pr) return githubContextName(repo, `PR #${pr[1]}`, heading);
    if (issue) return githubContextName(repo, `issue #${issue[1]}`, heading);
    if (repo) return compactText(`GitHub - ${repo}`, 72);
    const clean = stripKnownSuffixes(title, ['GitHub']);
    return compactName('GitHub', clean || heading);
  }
  if (domain.includes('developers.openai.com')) {
    if (path.includes('/codex/use-cases/frontend-designs')) return 'OpenAI - Codex frontend designs';
    const topic = readablePathTail(path);
    return topic ? `OpenAI - ${topic}` : 'OpenAI Developers';
  }
  if (domain.includes('openai.com')) {
    const clean = stripKnownSuffixes(title, ['OpenAI', 'OpenAI Developers']);
    return compactName('OpenAI', clean);
  }
  if (domain.includes('anthropic.com')) {
    if (path.includes('/claude-code/')) {
      const topic = readablePathTail(path);
      return topic ? compactText(`Claude - Code ${topic}`) : 'Claude - Code';
    }
    const clean = stripKnownSuffixes(title, ['Anthropic']);
    return compactName('Claude', clean);
  }
  if (domain.includes('monica.im')) {
    const clean = stripKnownSuffixes(title, ['Monica', 'Monica AI']);
    return compactName('Monica', clean);
  }
  if (domain === 'baidu.com') return 'Baidu';
  if (domain === 'news.baidu.com') return 'Baidu News';
  if (domain.includes('baijiahao.baidu.com')) return 'Baijiahao';
  if (domain.includes('bigmodel.cn') || domain.includes('zhipuai.cn')) {
    const clean = stripKnownSuffixes(title, ['ZHIPU AI OPEN PLATFORM', 'Zhipu AI']);
    return compactName('Zhipu AI', clean || 'Open Platform');
  }
  if (domain.includes('developer.chrome.com')) {
    const tail = title.split(/[:|-]/).map((part) => part.trim()).filter(Boolean).pop();
    return `Chrome Extensions - ${tail || 'Docs'}`;
  }
  if (domain.includes('docs.z.ai')) return 'Z.AI - GLM docs';
  if (domain.includes('resources.arc.net')) return 'Browser docs';
  if (domain.includes('mail.')) return 'Mail - Inbox';
  return title.length > 48 ? `${title.slice(0, 45)}...` : (title || domain);
}

export function titleForDomain(domain, title = '') {
  if (domain === 'unknown') return 'Other';
  if (domain.includes('anthropic.com') || /claude/i.test(title)) return 'Claude';
  if (domain.includes('monica.im') || /monica/i.test(title)) return 'Monica';
  if (domain.includes('github.com')) return 'GitHub';
  if (domain.includes('docs.') || /docs|documentation|guide/i.test(title)) return 'Docs';
  if (domain.includes('mail.') || /mail|inbox/i.test(title)) return 'Mail';
  if (domain.includes('calendar') || /calendar|meeting/i.test(title)) return 'Calendar';
  const root = domain.split('.').slice(-2, -1)[0] || domain.split('.')[0] || 'Tabs';
  return root.charAt(0).toUpperCase() + root.slice(1);
}

export function compactTabForAI(tab) {
  return {
    id: tab.id,
    title: tab.title || '',
    url: tab.url || '',
    domain: domainFromUrl(tab.url),
  };
}

export function spaceGroupPlan({ space, tabIds }) {
  return {
    title: String(space?.name || 'Space').slice(0, 32),
    color: normalizeChromeGroupColor(space?.color),
    tabIds: (tabIds || []).map(Number).filter(Number.isFinite),
  };
}

function normalizeChromeGroupColor(color) {
  const allowed = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
  return allowed.has(color) ? color : 'blue';
}

function safePath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return '';
  }
}

function githubRepositoryName(path, headings = []) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.length >= 2 && !isGithubNonRepoRoute(parts[0])) return `${parts[0]}/${parts[1]}`;
  const headingRepo = (headings || [])
    .map((heading) => String(heading || '').trim())
    .find((heading) => /^[^/\s]+\/[^/\s]+$/.test(heading));
  return headingRepo || '';
}

function isGithubNonRepoRoute(route) {
  return new Set([
    'about',
    'codespaces',
    'collections',
    'dashboard',
    'enterprise',
    'explore',
    'features',
    'issues',
    'login',
    'marketplace',
    'new',
    'notifications',
    'organizations',
    'pricing',
    'pulls',
    'search',
    'settings',
    'sponsors',
    'topics',
  ]).has(String(route || '').toLowerCase());
}

function bestContentHeading(headings = [], excluded = []) {
  const blocked = new Set(
    excluded
      .filter(Boolean)
      .flatMap((value) => [String(value).trim().toLowerCase(), String(value).split('/').pop()?.trim().toLowerCase()])
  );
  return (headings || [])
    .map((heading) => String(heading || '').replace(/\s+/g, ' ').trim())
    .find((heading) => (
      heading.length >= 3 &&
      !blocked.has(heading.toLowerCase()) &&
      !/^(navigation menu|readme|code|issues|pull requests|actions|projects|security|insights)$/i.test(heading)
    )) || '';
}

function githubContextName(repo, kind, heading) {
  const suffix = [kind, heading].filter(Boolean).join(' ');
  const subject = [repo, suffix].filter(Boolean).join(' ');
  return compactText(subject ? `GitHub - ${subject}` : `GitHub - ${kind}`, 72);
}

function readablePathTail(path) {
  const parts = String(path || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  const tail = parts.at(-1) || '';
  return tail
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .join(' ');
}

function stripKnownSuffixes(title, suffixes) {
  let clean = String(title || '').trim();
  for (const suffix of suffixes) {
    const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean
      .replace(new RegExp(`\\s*[|—-]\\s*${escaped}\\s*$`, 'i'), '')
      .replace(new RegExp(`^${escaped}\\s*[|—-]\\s*`, 'i'), '')
      .trim();
  }
  return clean;
}

function compactName(prefix, value) {
  const clean = String(value || '').trim();
  if (!clean) return prefix;
  const normalized = clean
    .replace(/\s+/g, ' ')
    .replace(/^overview$/i, 'overview')
    .trim();
  const result = `${prefix} - ${normalized}`;
  return compactText(result);
}

function compactText(value, maxLength = 48) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function sortBySavedOrder(items, savedOrder, getKey) {
  const order = new Map((savedOrder || []).map((key, index) => [String(key), index]));
  return [...items].sort((a, b) => {
    const aKey = String(getKey(a));
    const bKey = String(getKey(b));
    const aOrder = order.has(aKey) ? order.get(aKey) : Number.MAX_SAFE_INTEGER;
    const bOrder = order.has(bKey) ? order.get(bKey) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return Number(a.index ?? 0) - Number(b.index ?? 0);
  });
}
