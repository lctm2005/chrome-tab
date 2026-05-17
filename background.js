import { buildChatCompletionRequest, extractAssistantText, getZaiFallbackBaseUrl } from './src/shared/ai.js';
import { serializeGroup, serializeTab } from './src/shared/state.js';

const activeAIRequests = new Map();
const sidePanelPorts = new Map();
const BOOKMARK_ROOT_TITLE = 'Space Tabs';
const BOOKMARK_SPACE_MARKER = 'space:';
const MAX_BOOKMARK_FOLDER_DEPTH = 3;

chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  sidePanelPorts.set(port, { visible: true });
  port.onMessage.addListener((message) => {
    if (message?.type === 'panel:visibility') {
      const record = sidePanelPorts.get(port);
      if (record) record.visible = message.visible !== false;
    }
  });
  port.onDisconnect.addListener(() => sidePanelPorts.delete(port));
});

async function handleMessage(message, sender = {}) {
  switch (message?.type) {
    case 'panel:toggle':
      return togglePanel(sender);
    case 'panel:focus':
      return focusPanel(sender);
    case 'shortcut:action':
      return forwardShortcutAction(message.action, sender);
    case 'tabs:list':
      return listTabs();
    case 'tabs:create':
      return createTab(message.url, message.active);
    case 'tabs:focus':
      return focusTab(message.tabId);
    case 'tabs:discard':
      return discardTab(message.tabId);
    case 'tabs:close':
      return closeTab(message.tabId);
    case 'tabs:group':
      return groupTabs(message.tabIds, message.title, message.color, message.collapsed);
    case 'tabs:groupExisting':
      return addTabsToGroup(message.groupId, message.tabIds);
    case 'tabs:move':
      return moveTab(message.tabId, message.index);
    case 'tabs:ungroup':
      return ungroupTabs(message.tabIds);
    case 'groups:update':
      return updateGroup(message.groupId, message.update);
    case 'groups:move':
      return moveGroup(message.groupId, message.index);
    case 'bookmarks:saveSpaceSnapshot':
      return saveSpaceSnapshotToBookmarks(message.space, message.snapshot);
    case 'bookmarks:loadSpaceSnapshot':
      return loadSpaceSnapshotFromBookmarks(message.spaceId);
    case 'bookmarks:removeSpace':
      return removeSpaceBookmarks(message.spaceId);
    case 'page:outline':
      return extractTabOutline(message.tabId);
    case 'page:extract':
      return extractActivePage();
    case 'ai:chat':
      return runChatCompletion(message.settings, message.messages, message.requestId);
    case 'ai:abort':
      return abortChatCompletion(message.requestId);
    default:
      throw new Error(`Unknown message type: ${message?.type}`);
  }
}

async function togglePanel(sender = {}) {
  const visiblePorts = getVisibleSidePanelPorts();
  if (visiblePorts.length > 0) {
    for (const port of visiblePorts) {
      try {
        port.postMessage({ type: 'panel:close' });
      } catch {
        sidePanelPorts.delete(port);
      }
    }
    return { closed: true };
  }

  const windowId = await sidePanelWindowId(sender);
  if (await openSidePanel(windowId)) {
    return { opened: true };
  }
  throw new Error('Cannot open the side panel from this page.');
}

async function focusPanel(sender = {}) {
  const windowId = await sidePanelWindowId(sender);
  return { focused: await openSidePanel(windowId) };
}

async function forwardShortcutAction(action, sender = {}) {
  if (!action) throw new Error('Missing shortcut action.');
  const visiblePorts = getVisibleSidePanelPorts();
  if (visiblePorts.length === 0) {
    const windowId = await sidePanelWindowId(sender);
    if (await openSidePanel(windowId)) {
      return { opened: true, forwarded: false };
    }
    return { forwarded: false };
  }

  for (const port of visiblePorts) {
    try {
      port.postMessage({ type: 'shortcut:action', action });
    } catch {
      sidePanelPorts.delete(port);
    }
  }
  return { forwarded: true };
}

function getVisibleSidePanelPorts() {
  return [...sidePanelPorts.entries()]
    .filter(([, record]) => record.visible)
    .map(([port]) => port);
}

async function sidePanelWindowId(sender = {}) {
  if (Number.isFinite(sender.tab?.windowId)) return sender.tab.windowId;
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (Number.isFinite(activeTab?.windowId)) return activeTab.windowId;
  const focusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  return focusedWindow?.id;
}

async function openSidePanel(windowId) {
  if (!chrome.sidePanel?.open || !Number.isFinite(windowId)) return false;
  await chrome.sidePanel.open({ windowId });
  return true;
}

async function listTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const windowId = tabs[0]?.windowId;
  const groups = windowId ? await chrome.tabGroups.query({ windowId }) : [];
  return {
    tabs: tabs.sort((a, b) => a.index - b.index).map(serializeTab),
    groups: groups.map(serializeGroup),
  };
}

async function createTab(url = 'chrome://newtab', active = true) {
  const tab = await chrome.tabs.create({ url, active: active !== false });
  return { tab: serializeTab(tab) };
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.update(Number(tabId), { active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  return { tab: serializeTab(tab) };
}

async function discardTab(tabId) {
  const tab = await chrome.tabs.discard(Number(tabId));
  return { tab: serializeTab(tab) };
}

async function closeTab(tabId) {
  await chrome.tabs.remove(Number(tabId));
  return {};
}

async function groupTabs(tabIds, title = 'Tabs', color = 'blue', collapsed = false) {
  const ids = tabIds.map(Number).filter(Number.isFinite);
  if (ids.length === 0) return { groupId: null };
  const groupId = await chrome.tabs.group({ tabIds: ids });
  await chrome.tabGroups.update(groupId, {
    title: String(title || 'Tabs').slice(0, 32),
    color,
    collapsed: Boolean(collapsed),
  });
  return { groupId };
}

async function addTabsToGroup(groupId, tabIds) {
  const ids = tabIds.map(Number).filter(Number.isFinite);
  if (!Number.isFinite(Number(groupId)) || ids.length === 0) return { groupId: null };
  const nextGroupId = await chrome.tabs.group({ groupId: Number(groupId), tabIds: ids });
  return { groupId: nextGroupId };
}

async function moveTab(tabId, index) {
  await chrome.tabs.move(Number(tabId), { index: Math.max(0, Number(index) || 0) });
  return {};
}

async function ungroupTabs(tabIds) {
  const ids = tabIds.map(Number).filter(Number.isFinite);
  if (ids.length) await chrome.tabs.ungroup(ids);
  return {};
}

async function updateGroup(groupId, update = {}) {
  const safeUpdate = {};
  if ('title' in update) safeUpdate.title = String(update.title || 'Group').slice(0, 32);
  if ('color' in update) safeUpdate.color = update.color;
  if ('collapsed' in update) safeUpdate.collapsed = Boolean(update.collapsed);
  const group = await chrome.tabGroups.update(Number(groupId), safeUpdate);
  return { group: serializeGroup(group) };
}

async function moveGroup(groupId, index) {
  await chrome.tabGroups.move(Number(groupId), { index: Math.max(0, Number(index) || 0) });
  return {};
}

async function saveSpaceSnapshotToBookmarks(space = {}, snapshot = {}) {
  const root = await ensureBookmarkRoot();
  const existing = await findSpaceBookmarkFolder(space.id, root);
  if (existing) await chrome.bookmarks.removeTree(existing.id);

  const bookmarkGroups = Array.isArray(snapshot?.groups)
    ? snapshot.groups
      .map((group) => ({
        ...group,
        tabs: Array.isArray(group?.tabs) ? group.tabs.filter((tab) => isBookmarkableUrl(tab?.url)) : [],
      }))
      .filter((group) => group.tabs.length > 0)
    : [];

  if (!space?.id || bookmarkGroups.length === 0) {
    return { saved: false };
  }

  const spaceFolder = await chrome.bookmarks.create({
    parentId: root.id,
    title: bookmarkSpaceTitle(space),
  });

  for (const group of bookmarkGroups) {
    const leaf = await ensureBookmarkPath(spaceFolder.id, bookmarkPathForGroup(group));
    for (const tab of group.tabs) {
      await chrome.bookmarks.create({
        parentId: leaf.id,
        title: String(tab.title || tab.url || 'Untitled').slice(0, 240),
        url: tab.url,
      });
    }
  }

  return { saved: true, rootId: root.id, spaceFolderId: spaceFolder.id };
}

async function loadSpaceSnapshotFromBookmarks(spaceId) {
  const root = await getBookmarkRoot();
  if (!root) return { snapshot: null };
  const spaceFolder = await findSpaceBookmarkFolder(spaceId, root);
  if (!spaceFolder) return { snapshot: null };

  const [tree] = await chrome.bookmarks.getSubTree(spaceFolder.id);
  const groups = [];
  collectBookmarkGroups(tree, [], groups);

  return {
    snapshot: {
      version: 1,
      updatedAt: Date.now(),
      groups,
    },
  };
}

async function removeSpaceBookmarks(spaceId) {
  const root = await getBookmarkRoot();
  if (!root) return { removed: false };
  const existing = await findSpaceBookmarkFolder(spaceId, root);
  if (existing) await chrome.bookmarks.removeTree(existing.id);
  return { removed: Boolean(existing) };
}

async function getBookmarkParent() {
  const [tree] = await chrome.bookmarks.getTree();
  return tree.children?.find((node) => node.id === '2') || tree.children?.find((node) => !node.url) || tree;
}

async function getBookmarkRoot() {
  const parent = await getBookmarkParent();
  return parent.children?.find((node) => !node.url && node.title === BOOKMARK_ROOT_TITLE) || null;
}

async function ensureBookmarkRoot() {
  const parent = await getBookmarkParent();
  const existing = parent.children?.find((node) => !node.url && node.title === BOOKMARK_ROOT_TITLE);
  if (existing) return existing;
  return chrome.bookmarks.create({ parentId: parent.id, title: BOOKMARK_ROOT_TITLE });
}

async function findSpaceBookmarkFolder(spaceId, root = null) {
  if (!spaceId) return null;
  const bookmarkRoot = root || await getBookmarkRoot();
  if (!bookmarkRoot) return null;
  const [tree] = await chrome.bookmarks.getSubTree(bookmarkRoot.id);
  const marker = `[${BOOKMARK_SPACE_MARKER}${spaceId}]`;
  return (tree.children || []).find((node) => !node.url && node.title.includes(marker)) || null;
}

function bookmarkSpaceTitle(space = {}) {
  return `${String(space.name || 'Space').trim() || 'Space'} [${BOOKMARK_SPACE_MARKER}${space.id}]`;
}

function bookmarkPathForGroup(group = {}) {
  const rawParts = String(group.title || 'Ungrouped')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  const parts = rawParts.length ? rawParts : ['Ungrouped'];
  if (parts.length <= MAX_BOOKMARK_FOLDER_DEPTH) return parts;
  return [
    ...parts.slice(0, MAX_BOOKMARK_FOLDER_DEPTH - 1),
    parts.slice(MAX_BOOKMARK_FOLDER_DEPTH - 1).join(' / '),
  ];
}

async function ensureBookmarkPath(parentId, parts) {
  let parent = (await chrome.bookmarks.get(parentId))[0];
  for (const title of parts) {
    const [freshParent] = await chrome.bookmarks.getSubTree(parent.id);
    let child = freshParent.children?.find((node) => !node.url && node.title === title);
    if (!child) child = await chrome.bookmarks.create({ parentId: parent.id, title });
    parent = child;
  }
  return parent;
}

function collectBookmarkGroups(node, path, groups) {
  const children = Array.isArray(node?.children) ? node.children : [];
  const bookmarks = children.filter((child) => child.url && isBookmarkableUrl(child.url));
  if (bookmarks.length && path.length) {
    groups.push({
      title: path.join(' / '),
      color: path.join(' / ') === 'Ungrouped' ? 'grey' : 'blue',
      collapsed: true,
      tabs: bookmarks.map((bookmark) => ({
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
      })),
    });
  }

  for (const child of children) {
    if (!child.url) collectBookmarkGroups(child, [...path, child.title || 'Folder'].slice(0, MAX_BOOKMARK_FOLDER_DEPTH), groups);
  }
}

function isBookmarkableUrl(url) {
  return /^(https?:|file:)/.test(String(url || '')) || url === 'chrome://newtab';
}

async function extractActivePage() {
  const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
  if (!tab?.id) throw new Error('No active tab found.');
  if (!/^https?:|^file:/.test(tab.url || '')) {
    throw new Error('Chrome does not allow page extraction on this URL.');
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const selection = window.getSelection()?.toString() || '';
      const article = document.querySelector('article')?.innerText || '';
      const body = document.body?.innerText || '';
      const text = (selection || article || body).replace(/\s+/g, ' ').trim().slice(0, 14000);
      return {
        title: document.title,
        url: location.href,
        selection,
        text,
      };
    },
  });

  return { page: result?.result || { title: tab.title, url: tab.url, text: '' } };
}

async function extractTabOutline(tabId) {
  const tab = await chrome.tabs.get(Number(tabId));
  const fallback = {
    title: tab?.title || '',
    url: tab?.url || '',
    headings: [],
  };
  if (!tab?.id || !/^https?:/.test(tab.url || '')) return fallback;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'page:outline' });
    return {
      title: response?.title || fallback.title,
      url: response?.url || fallback.url,
      headings: Array.isArray(response?.headings) ? response.headings.slice(0, 10) : [],
    };
  } catch {
    return fallback;
  }
}

async function runChatCompletion(settings, messages, requestId = '') {
  if (!settings?.apiKey) throw new Error('AI API key is missing. Add it in Settings.');
  const controller = new AbortController();
  const safeRequestId = requestId || crypto.randomUUID();
  activeAIRequests.set(safeRequestId, controller);
  try {
    const payload = await fetchChatCompletion(settings, messages, controller.signal);
    return {
      text: extractAssistantText(payload),
      usage: payload.usage || null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('AI request was stopped.');
    throw error;
  } finally {
    activeAIRequests.delete(safeRequestId);
  }
}

async function abortChatCompletion(requestId = '') {
  if (!requestId) {
    for (const controller of activeAIRequests.values()) controller.abort();
    activeAIRequests.clear();
    return { aborted: true };
  }
  const controller = activeAIRequests.get(requestId);
  if (!controller) return { aborted: false };
  controller.abort();
  activeAIRequests.delete(requestId);
  return { aborted: true };
}

async function fetchChatCompletion(settings, messages, signal) {
  const request = buildChatCompletionRequest(settings, messages);
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal,
  });

  const payload = await response.json().catch(async () => ({
    error: { message: await response.text() },
  }));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `AI request failed with ${response.status}`;
    const fallbackBaseUrl = getZaiFallbackBaseUrl(settings.baseUrl);
    if (fallbackBaseUrl && /insufficient|balance|quota|余额不足|资源包/i.test(message)) {
      return fetchChatCompletion({ ...settings, baseUrl: fallbackBaseUrl }, messages, signal);
    }
    throw new Error(message);
  }

  return payload;
}
