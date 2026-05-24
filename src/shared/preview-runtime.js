export function isExtensionRuntime(host = globalThis) {
  return Boolean(host?.chrome?.runtime?.id && host?.chrome?.storage?.local);
}

export function createPreviewTabs() {
  return [
    {
      id: 1,
      title: 'Z.AI GLM-5.1 Documentation',
      url: 'https://docs.z.ai/guides/llm/glm-5.1',
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

export function createPreviewCommandHandler(initialTabs = createPreviewTabs(), initialGroups = createPreviewGroups()) {
  let tabs = initialTabs.map((tab, index) => ({ ...tab, index }));
  let groups = initialGroups.map((group) => ({ ...group }));
  let nextId = Math.max(...tabs.map((tab) => tab.id), 0) + 1;
  let nextGroupId = Math.max(...groups.map((group) => group.id), 0) + 1;

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
        return { tab: { ...tab } };
      }
      case 'tabs:focus': {
        const id = Number(payload.tabId);
        tabs = tabs.map((tab) => ({ ...tab, active: tab.id === id }));
        return { tab: { ...tabs.find((tab) => tab.id === id) } };
      }
      case 'tabs:discard': {
        const id = Number(payload.tabId);
        tabs = tabs.map((tab) => tab.id === id ? { ...tab, discarded: true } : tab);
        return { tab: { ...tabs.find((tab) => tab.id === id) } };
      }
      case 'tabs:close': {
        const id = Number(payload.tabId);
        const closingWasActive = tabs.some((tab) => tab.id === id && tab.active);
        tabs = tabs.filter((tab) => tab.id !== id);
        if (closingWasActive && tabs.length) tabs[0].active = true;
        return {};
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
        return { groupId };
      }
      case 'tabs:ungroup': {
        const ids = new Set((payload.tabIds || []).map(Number));
        tabs = tabs.map((tab) => ids.has(tab.id) ? { ...tab, groupId: -1 } : tab);
        const usedGroupIds = new Set(tabs
          .map((tab) => tab.groupId)
          .filter((id) => Number.isFinite(Number(id)) && Number(id) !== -1));
        groups = groups.filter((group) => usedGroupIds.has(group.id));
        return {};
      }
      case 'tabs:groupExisting': {
        const ids = new Set((payload.tabIds || []).map(Number));
        const groupId = Number(payload.groupId);
        tabs = tabs.map((tab) => ids.has(tab.id) ? { ...tab, groupId } : tab);
        return { groupId };
      }
      case 'tabs:move': {
        const tabId = Number(payload.tabId);
        const moving = tabs.find((tab) => tab.id === tabId);
        if (!moving) return {};
        const without = tabs.filter((tab) => tab.id !== tabId);
        const index = Math.max(0, Math.min(Number(payload.index ?? without.length), without.length));
        without.splice(index, 0, moving);
        tabs = reindexTabs(without);
        return {};
      }
      case 'groups:move': {
        const groupId = Number(payload.groupId);
        const movingTabs = tabs.filter((tab) => tab.groupId === groupId);
        if (movingTabs.length === 0) return {};
        const remaining = tabs.filter((tab) => tab.groupId !== groupId);
        const index = Math.max(0, Math.min(Number(payload.index ?? remaining.length), remaining.length));
        remaining.splice(index, 0, ...movingTabs);
        tabs = reindexTabs(remaining);
        return {};
      }
      case 'groups:update': {
        const groupId = Number(payload.groupId);
        groups = groups.map((group) => {
          if (group.id !== groupId) return group;
          return { ...group, ...(payload.update || {}) };
        });
        return { group: { ...groups.find((group) => group.id === groupId) } };
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
          text: 'Preview AI response: the UI wiring works here. After installing the extension, this same action will call your configured BYOK model.',
          usage: null,
        };
      case 'ai:abort':
        return { aborted: true };
      default:
        throw new Error(`Preview mode does not support command: ${type}`);
    }
  };
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
