export function isExtensionRuntime(host = globalThis) {
  return Boolean(host?.chrome?.runtime?.id && host?.chrome?.storage?.local);
}

export function createPreviewTabs() {
  return [
    {
      id: 1,
      title: 'Z.AI GLM-5.2 Documentation',
      url: 'https://docs.z.ai/guides/llm/glm-5.2',
      favIconUrl: '',
      pinned: false,
      muted: false,
      active: false,
      groupId: 1,
      index: 0,
      windowId: 1,
      audible: false,
    },
    {
      id: 2,
      title: 'Browser Spaces Guide',
      url: 'https://example.com/spaces-guide',
      favIconUrl: '',
      pinned: false,
      muted: false,
      active: true,
      groupId: 1,
      index: 1,
      windowId: 1,
      audible: false,
    },
    {
      id: 3,
      title: 'Chrome Side Panel API',
      url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel',
      favIconUrl: '',
      pinned: false,
      muted: false,
      active: false,
      groupId: 2,
      index: 2,
      windowId: 1,
      audible: false,
    },
    {
      id: 4,
      title: 'GitHub Pull Request Review',
      url: 'https://github.com/openai/codex/pulls',
      favIconUrl: '',
      pinned: false,
      muted: false,
      active: false,
      groupId: 2,
      index: 3,
      windowId: 1,
      audible: false,
    },
    {
      id: 5,
      title: 'Inbox - Product Team',
      url: 'https://mail.example.com/inbox',
      favIconUrl: '',
      pinned: false,
      muted: false,
      active: false,
      groupId: 3,
      index: 4,
      windowId: 1,
      audible: false,
    },
  ];
}

export function createPreviewGroups() {
  return [
    { id: 1, title: 'Research', color: 'blue', collapsed: false },
    { id: 2, title: 'Build', color: 'purple', collapsed: false },
    { id: 3, title: 'Inbox', color: 'green', collapsed: false },
  ];
}

const PREVIEW_RUNTIME_STORAGE_KEY = 'spaceTabsPreviewRuntime';

export function createPreviewCommandHandler(initialTabs = createPreviewTabs(), initialGroups = createPreviewGroups()) {
  const stored = readPreviewRuntimeState();
  let tabs = Array.isArray(stored?.tabs)
    ? stored.tabs.map((tab, index) => ({ ...tab, index }))
    : initialTabs.map((tab, index) => ({ ...tab, index }));
  let groups = Array.isArray(stored?.groups)
    ? stored.groups.map((group) => ({ ...group }))
    : initialGroups.map((group) => ({ ...group }));
  let nextId = Number.isFinite(Number(stored?.nextId))
    ? Number(stored.nextId)
    : Math.max(...tabs.map((tab) => tab.id), 0) + 1;
  let nextGroupId = Number.isFinite(Number(stored?.nextGroupId))
    ? Number(stored.nextGroupId)
    : Math.max(...groups.map((group) => group.id), 0) + 1;

  const persistAndReturn = (value) => {
    writePreviewRuntimeState({ tabs, groups, nextId, nextGroupId });
    return value;
  };

  return async function send(type, payload = {}) {
    recordPreviewCommand(type, payload);
    switch (type) {
      case 'tabs:list':
        return { tabs: cloneTabs(tabs), groups: groups.map((group) => ({ ...group })) };
      case 'tabs:create': {
        const tab = {
          id: nextId++,
          title: titleFromUrl(payload.url || 'chrome://newtab'),
          url: payload.url || 'chrome://newtab',
          favIconUrl: '',
          pinned: false,
          muted: false,
          active: payload.active !== false,
          groupId: -1,
          index: tabs.length,
          windowId: 1,
          audible: false,
        };
        tabs = (payload.active === false ? tabs : tabs.map((item) => ({ ...item, active: false }))).concat(tab);
        return persistAndReturn({ tab: { ...tab } });
      }
      case 'tabs:openUnique': {
        const matchUrl = String(payload.matchUrl || payload.url || '');
        const matches = tabs.filter((tab) => String(tab.url || '').startsWith(matchUrl));
        const existing = matches[0];
        if (!existing) {
          const tab = {
            id: nextId++,
            title: titleFromUrl(payload.url || 'chrome://newtab'),
            url: payload.url || 'chrome://newtab',
            favIconUrl: '',
            pinned: false,
            muted: false,
            active: true,
            groupId: -1,
            index: tabs.length,
            windowId: 1,
            audible: false,
          };
          tabs = tabs.map((item) => ({ ...item, active: false })).concat(tab);
          return persistAndReturn({ tab: { ...tab }, reused: false });
        }
        const duplicateIds = new Set(matches.slice(1).map((tab) => tab.id));
        tabs = tabs.filter((tab) => !duplicateIds.has(tab.id)).map((tab) => ({
          ...tab,
          active: tab.id === existing.id,
          url: tab.id === existing.id ? payload.url : tab.url,
          title: tab.id === existing.id ? titleFromUrl(payload.url) : tab.title,
        }));
        return persistAndReturn({
          tab: { ...tabs.find((tab) => tab.id === existing.id) },
          reused: true,
          closedDuplicates: duplicateIds.size,
        });
      }
      case 'tabs:focus': {
        const id = Number(payload.tabId);
        tabs = tabs.map((tab) => ({ ...tab, active: tab.id === id }));
        return persistAndReturn({ tab: { ...tabs.find((tab) => tab.id === id) } });
      }
      case 'tabs:duplicate': {
        const id = Number(payload.tabId);
        const sourceIndex = tabs.findIndex((tab) => tab.id === id);
        if (sourceIndex < 0) return { tab: null, missing: true };
        const source = tabs[sourceIndex];
        const tab = {
          ...source,
          id: nextId++,
          active: true,
          discarded: false,
        };
        const nextTabs = tabs.map((item) => ({ ...item, active: false }));
        nextTabs.splice(sourceIndex + 1, 0, tab);
        tabs = reindexTabs(nextTabs);
        return persistAndReturn({ tab: { ...tabs[sourceIndex + 1] } });
      }
      case 'tabs:discard': {
        const id = Number(payload.tabId);
        tabs = tabs.map((tab) => tab.id === id ? { ...tab, discarded: true } : tab);
        return persistAndReturn({ tab: { ...tabs.find((tab) => tab.id === id) } });
      }
      case 'tabs:close': {
        const id = Number(payload.tabId);
        const closingWasActive = tabs.some((tab) => tab.id === id && tab.active);
        tabs = tabs.filter((tab) => tab.id !== id);
        if (closingWasActive && tabs.length) tabs[0].active = true;
        return persistAndReturn({});
      }
      case 'tabs:group': {
        const groupId = nextGroupId++;
        const ids = new Set((payload.tabIds || []).map(Number));
        tabs = tabs.map((tab) => ids.has(tab.id) ? { ...tab, groupId } : tab);
        groups.push({
          id: groupId,
          title: payload.title || 'Group',
          color: payload.color || 'blue',
          collapsed: Boolean(payload.collapsed),
        });
        return persistAndReturn({ groupId });
      }
      case 'tabs:ungroup': {
        const ids = new Set((payload.tabIds || []).map(Number));
        tabs = tabs.map((tab) => ids.has(tab.id) ? { ...tab, groupId: -1 } : tab);
        const usedGroupIds = new Set(tabs
          .map((tab) => tab.groupId)
          .filter((id) => Number.isFinite(Number(id)) && Number(id) !== -1));
        groups = groups.filter((group) => usedGroupIds.has(group.id));
        return persistAndReturn({});
      }
      case 'tabs:groupExisting': {
        const ids = new Set((payload.tabIds || []).map(Number));
        const groupId = Number(payload.groupId);
        tabs = tabs.map((tab) => ids.has(tab.id) ? { ...tab, groupId } : tab);
        return persistAndReturn({ groupId });
      }
      case 'tabs:move': {
        const tabId = Number(payload.tabId);
        const moving = tabs.find((tab) => tab.id === tabId);
        if (!moving) return {};
        const without = tabs.filter((tab) => tab.id !== tabId);
        const index = Math.max(0, Math.min(Number(payload.index ?? without.length), without.length));
        without.splice(index, 0, moving);
        tabs = reindexTabs(without);
        return persistAndReturn({});
      }
      case 'groups:move': {
        const groupId = Number(payload.groupId);
        const movingTabs = tabs.filter((tab) => tab.groupId === groupId);
        if (movingTabs.length === 0) return {};
        const remaining = tabs.filter((tab) => tab.groupId !== groupId);
        const index = Math.max(0, Math.min(Number(payload.index ?? remaining.length), remaining.length));
        remaining.splice(index, 0, ...movingTabs);
        tabs = reindexTabs(remaining);
        return persistAndReturn({});
      }
      case 'groups:update': {
        const groupId = Number(payload.groupId);
        groups = groups.map((group) => {
          if (group.id !== groupId) return group;
          return { ...group, ...(payload.update || {}) };
        });
        return persistAndReturn({ group: { ...groups.find((group) => group.id === groupId) } });
      }
      case 'page:extract': {
        const active = tabs.find((tab) => tab.active) || tabs[0];
        return {
          page: {
            title: active?.title || 'Preview page',
            url: active?.url || location.href,
            text: 'This is preview text because file:// cannot read a real active Chrome tab. Install the extension to summarize the actual page.',
          },
        };
      }
      case 'ai:chat':
        return {
          text: previewAIText(payload.messages),
          usage: null,
        };
      case 'ai:abort':
        return { aborted: true };
      default:
        throw new Error(`Preview mode does not support command: ${type}`);
    }
  };
}

function previewAIText(messages = []) {
  const systemText = messages
    .filter((message) => message?.role === 'system')
    .map((message) => String(message.content || ''))
    .join('\n');
  const input = previewAIInput(messages);

  if (/Group browser tabs into concise topic\/work buckets/i.test(systemText)) {
    return JSON.stringify(previewTidyGroups(input));
  }
  if (/Rename browser tabs for a compact sidebar/i.test(systemText)) {
    return JSON.stringify(input.map((tab) => ({
      id: tab.id,
      title: previewTabName(tab.title),
    })));
  }
  return 'Preview AI response: the UI wiring works here. After installing the extension, this same action will call your configured BYOK model.';
}

function previewAIInput(messages = []) {
  const content = [...messages]
    .reverse()
    .find((message) => message?.role === 'user')?.content;
  try {
    const parsed = JSON.parse(String(content || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function previewTidyGroups(tabs = []) {
  const buckets = new Map();
  for (const tab of tabs) {
    const title = String(tab?.title || '');
    let group = 'Related Work';
    if (/pull request|code review|github|\bpr\b/i.test(title)) group = 'Code Review';
    else if (/inbox|mail|message/i.test(title)) group = 'Team Inbox';
    else if (/plan|alpha|beta|launch/i.test(title)) group = 'Planning';
    else if (/documentation|\bdocs?\b|guide|browser|chrome|research/i.test(title)) group = 'Product Research';
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group).push(Number(tab.id));
  }

  const colors = ['cyan', 'purple', 'green', 'orange', 'blue'];
  return [...buckets.entries()].map(([title, tabIds], index) => ({
    title,
    tabIds: tabIds.filter(Number.isFinite),
    color: colors[index % colors.length],
  }));
}

function previewTabName(title) {
  const words = String(title || 'Untitled').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 6).join(' ') || 'Untitled';
}

function readPreviewRuntimeState() {
  try {
    return JSON.parse(globalThis.sessionStorage?.getItem(PREVIEW_RUNTIME_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writePreviewRuntimeState(state) {
  try {
    globalThis.sessionStorage?.setItem(PREVIEW_RUNTIME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Preview persistence is best-effort; non-browser tests do not provide sessionStorage.
  }
}

function recordPreviewCommand(type, payload) {
  const host = typeof globalThis === 'undefined' ? null : globalThis;
  const history = host?.__SPACE_TABS_PREVIEW_COMMANDS__;
  if (!Array.isArray(history)) return;
  history.push({ type, payload: structuredCloneSafe(payload) });
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function cloneTabs(tabs) {
  return tabs.map((tab, index) => ({ ...tab, index }));
}

function reindexTabs(tabs) {
  return tabs.map((tab, index) => ({ ...tab, index }));
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'chrome:') return 'New Tab';
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return 'New Tab';
  }
}
