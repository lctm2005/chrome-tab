import { moveIndexAfterTabs, moveIndexBeforeTab } from './tab-move.js';

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

  const removeEmptyGroups = () => {
    const usedGroupIds = new Set(tabs
      .map((tab) => Number(tab?.groupId))
      .filter((groupId) => Number.isSafeInteger(groupId) && groupId >= 0));
    groups = groups.filter((group) => usedGroupIds.has(Number(group?.id)));
  };
  removeEmptyGroups();

  const persistAndReturn = (value) => {
    removeEmptyGroups();
    writePreviewRuntimeState({ tabs, groups, nextId, nextGroupId });
    return value;
  };

  return async function send(type, payload = {}) {
    recordPreviewCommand(type, payload);
    switch (type) {
      case 'tabs:list':
      case 'tabs:listAll': {
        const listedTabs = cloneTabs(tabs);
        const listedGroups = groups.map((group) => ({ ...group }));
        return {
          tabs: listedTabs,
          groups: listedGroups,
          allTabs: cloneTabs(tabs),
          allGroups: groups.map((group) => ({ ...group })),
          existingTabIds: tabs
            .map((tab) => Number(tab?.id))
            .filter((tabId) => Number.isSafeInteger(tabId) && tabId >= 0),
          existingWindowIds: [...new Set(tabs
            .map((tab) => Number(tab?.windowId))
            .filter((windowId) => Number.isSafeInteger(windowId) && windowId >= 0))]
            .sort((left, right) => left - right),
          existingGroupIds: groups
            .map((group) => Number(group?.id))
            .filter((groupId) => Number.isSafeInteger(groupId) && groupId >= 0),
          pendingLifecycleTabIds: [],
          suppressedLifecycleTabIds: [],
        };
      }
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
        const target = tabs.find((tab) => tab.id === id);
        if (!target) return { tab: null, missing: true };
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
        const target = tabs.find((tab) => tab.id === id);
        if (!target) return { tab: null, missing: true };
        tabs = tabs.map((tab) => tab.id === id ? { ...tab, discarded: true } : tab);
        return persistAndReturn({ tab: { ...tabs.find((tab) => tab.id === id) } });
      }
      case 'tabs:close': {
        const id = Number(payload.tabId);
        if (!Number.isSafeInteger(id) || id < 0) return {};
        const target = tabs.find((tab) => tab.id === id);
        if (!target) return { missing: true };
        const closingWasActive = Boolean(target.active);
        tabs = tabs.filter((tab) => tab.id !== id);
        if (closingWasActive && tabs.length) tabs[0].active = true;
        return persistAndReturn({});
      }
      case 'tabs:group': {
        const requestedIds = normalizedPreviewTabIds(payload.tabIds);
        const ids = new Set(requestedIds);
        const selectedTabs = tabs.filter((tab) => ids.has(Number(tab.id)));
        if (requestedIds.length === 0 || selectedTabs.length !== requestedIds.length) {
          return { groupId: null, missing: true };
        }
        const windowIds = new Set(selectedTabs.map((tab) => previewWindowId(tab)));
        if (windowIds.size !== 1 || windowIds.has(null)) {
          throw new Error('Selected tabs must be in the same Chrome window.');
        }
        const groupId = nextGroupId++;
        // Chrome sorts requested tab IDs by their current strip position, then
        // moves them as one block without splitting the first tab's old group.
        const firstSelectedIndex = tabs.findIndex((tab) => ids.has(Number(tab.id)));
        const firstSourceGroupId = Number(tabs[firstSelectedIndex].groupId);
        let destinationIndex = firstSelectedIndex;
        if (Number.isSafeInteger(firstSourceGroupId) && firstSourceGroupId >= 0) {
          while (
            destinationIndex < tabs.length &&
            Number(tabs[destinationIndex].groupId) === firstSourceGroupId
          ) {
            destinationIndex += 1;
          }
        }
        const selectedBeforeDestination = tabs
          .slice(0, destinationIndex)
          .filter((tab) => ids.has(Number(tab.id)))
          .length;
        const remainingTabs = tabs.filter((tab) => !ids.has(Number(tab.id)));
        remainingTabs.splice(
          destinationIndex - selectedBeforeDestination,
          0,
          ...selectedTabs.map((tab) => ({ ...tab, groupId })),
        );
        tabs = reindexTabs(remainingTabs);
        groups.push({
          id: groupId,
          title: payload.title || 'Group',
          color: payload.color || 'blue',
          collapsed: Boolean(payload.collapsed),
        });
        return persistAndReturn({ groupId });
      }
      case 'tabs:ungroup': {
        const requestedIds = normalizedPreviewTabIds(payload.tabIds);
        const ids = new Set(requestedIds);
        const selectedTabs = tabs.filter((tab) => ids.has(Number(tab.id)));
        if (requestedIds.length === 0 || selectedTabs.length !== requestedIds.length) {
          return { missing: true };
        }
        tabs = tabs.map((tab) => ids.has(tab.id) ? { ...tab, groupId: -1 } : tab);
        return persistAndReturn({});
      }
      case 'tabs:groupExisting': {
        const groupId = Number(payload.groupId);
        if (!Number.isFinite(groupId)) return { groupId: null, missing: false };
        const requestedIds = normalizedPreviewTabIds(payload.tabIds);
        const ids = new Set(requestedIds);
        const selectedTabs = tabs.filter((tab) => ids.has(Number(tab.id)));
        const targetGroup = groups.find((group) => Number(group.id) === groupId);
        const targetTab = tabs.find((tab) => Number(tab.groupId) === groupId);
        if (
          requestedIds.length === 0 ||
          selectedTabs.length !== requestedIds.length ||
          !targetGroup ||
          !targetTab
        ) {
          return { groupId: null, missing: true };
        }
        const targetWindowId = previewWindowId(targetTab);
        if (
          targetWindowId === null ||
          selectedTabs.some((tab) => previewWindowId(tab) !== targetWindowId)
        ) {
          throw new Error('Selected tabs must be in the same Chrome window.');
        }
        // Chrome keeps an existing group in place: tabs from its left join at
        // the front and tabs from its right join at the back, all in strip order.
        const targetIds = new Set(tabs
          .filter((tab) => Number(tab.groupId) === groupId)
          .map((tab) => Number(tab.id)));
        const groupedIds = new Set([...targetIds, ...ids]);
        const firstTargetIndex = tabs.findIndex((tab) => targetIds.has(Number(tab.id)));
        const destinationIndex = tabs
          .slice(0, firstTargetIndex)
          .filter((tab) => !groupedIds.has(Number(tab.id)))
          .length;
        const groupedTabs = tabs
          .filter((tab) => groupedIds.has(Number(tab.id)))
          .map((tab) => ({ ...tab, groupId }));
        const remainingTabs = tabs.filter((tab) => !groupedIds.has(Number(tab.id)));
        remainingTabs.splice(destinationIndex, 0, ...groupedTabs);
        tabs = reindexTabs(remainingTabs);
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
      case 'tabs:moveRelative': {
        const tabId = Number(payload.tabId);
        const anchorTabId = Number(payload.anchorTabId);
        const expectedGroupId = Number(payload.expectedGroupId);
        if (!Number.isSafeInteger(tabId) || tabId < 0 ||
            !Number.isSafeInteger(anchorTabId) || anchorTabId < 0) {
          throw new Error('A live source tab and anchor tab are required for this move.');
        }
        if (tabId === anchorTabId) return {};
        if (!['before', 'after'].includes(payload.edge)) {
          throw new Error('A tab move must be before or after its anchor.');
        }
        if (!Number.isInteger(expectedGroupId) || expectedGroupId < -1) {
          throw new Error('A valid target tab group is required for this move.');
        }
        const moving = tabs.find((tab) => tab.id === tabId);
        const anchor = tabs.find((tab) => tab.id === anchorTabId);
        if (!moving || !anchor) {
          const missingId = moving ? anchorTabId : tabId;
          return {
            missing: true,
            missingStage: 'reading source and anchor tabs',
            missingMessage: `No tab with id: ${missingId}`,
          };
        }
        if (Number(moving.windowId) !== Number(anchor.windowId)) {
          throw new Error('The source tab and target tab must be in the same Chrome window.');
        }
        if (Number(moving.groupId) !== expectedGroupId ||
            Number(anchor.groupId) !== expectedGroupId) {
          throw new Error('The target tab group changed while moving this tab.');
        }
        const index = payload.edge === 'before'
          ? moveIndexBeforeTab(moving.index, anchor.index)
          : moveIndexAfterTabs(moving.index, [anchor.index]);
        if (index === moving.index) return {};
        const without = tabs.filter((tab) => tab.id !== tabId);
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
        const target = groups.find((group) => group.id === groupId);
        if (!target) return { group: null, missing: true };
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
            url: active?.url || globalThis.location?.href || '',
            text: 'This is preview text because file:// cannot read a real active Chrome tab. Install the extension to summarize the actual page.',
          },
        };
      }
      case 'pages:extract': {
        const ids = new Set((payload.tabIds || []).map(Number));
        const pages = tabs
          .filter((tab) => ids.has(Number(tab.id)) && /^https?:/.test(tab.url || ''))
          .map((tab) => {
            const text = `Preview content for ${tab.title}. This local preview stands in for page text extracted only after confirmation.`;
            return {
              tabId: tab.id,
              title: tab.title,
              url: tab.url,
              text,
              selection: '',
              charCount: text.length,
              originalCharCount: text.length,
              truncated: false,
            };
          });
        return {
          pages,
          failures: [],
          totalChars: pages.reduce((sum, page) => sum + page.charCount, 0),
          truncated: false,
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
  const history = globalThis.__SPACE_TABS_PREVIEW_COMMANDS__;
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

function normalizedPreviewTabIds(tabIds = []) {
  return [...new Set((Array.isArray(tabIds) ? tabIds : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id >= 0))];
}

function previewWindowId(tab) {
  const windowId = Number(tab?.windowId);
  return Number.isSafeInteger(windowId) && windowId >= 0 ? windowId : null;
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
