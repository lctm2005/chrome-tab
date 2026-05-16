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
  const sanitized = [];

  for (const group of plannedGroups || []) {
    const ids = (group.tabIds || []).map(Number).filter((id) => tabsById.has(id));
    if (ids.length === 0) continue;

    const localBuckets = new Map();
    for (const id of ids) {
      const tab = tabsById.get(id);
      const localTitle = titleForDomain(domainFromUrl(tab.url), tab.title);
      if (!localBuckets.has(localTitle)) localBuckets.set(localTitle, []);
      localBuckets.get(localTitle).push(id);
    }

    if (localBuckets.size <= 1) {
      sanitized.push({ ...group, tabIds: ids });
      continue;
    }

    for (const [title, tabIds] of localBuckets.entries()) {
      sanitized.push({
        title,
        tabIds,
        color: group.color || GROUP_COLORS[sanitized.length % GROUP_COLORS.length],
      });
    }
  }

  return sanitized.map((group, index) => ({
    ...group,
    color: group.color || GROUP_COLORS[index % GROUP_COLORS.length],
  }));
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
    if (tab.groupId > 0) return groupSpaces[tab.groupId] === activeSpaceId;
    return tabSpaces[tab.id] === activeSpaceId;
  });
  const buckets = new Map();

  for (const tab of visibleTabs) {
    const key = tab.groupId > 0 ? `group:${tab.groupId}` : 'ungrouped';
    if (!buckets.has(key)) {
      const group = groupsById.get(tab.groupId);
      buckets.set(key, {
        key,
        id: tab.groupId > 0 ? tab.groupId : 'ungrouped',
        title: tab.groupId > 0 ? (group?.title || titleForDomain(tab.domain || domainFromUrl(tab.url), tab.title)) : 'Ungrouped',
        color: tab.groupId > 0 ? (group?.color || 'grey') : 'grey',
        collapsed: tab.groupId > 0
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

export function planTidyTabNames(tabs) {
  return Object.fromEntries(tabs.map((tab) => [tab.id, tidyPanelName(tab)]));
}

export function tidyPanelName(tab) {
  const domain = domainFromUrl(tab.url);
  const title = String(tab.title || '').replace(/\s+/g, ' ').trim();
  const path = safePath(tab.url);
  if (domain.includes('github.com')) {
    const pr = path.match(/\/pull\/(\d+)/);
    const issue = path.match(/\/issues\/(\d+)/);
    if (pr) return `GitHub - pull/${pr[1]}`;
    if (issue) return `GitHub - issue/${issue[1]}`;
    return 'GitHub';
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
