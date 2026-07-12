import { buildChatCompletionRequest, extractAssistantText, getZaiFallbackBaseUrl } from './src/shared/ai.js';
import { serializeGroup, serializeTab } from './src/shared/state.js';

const activeAIRequests = new Map();
const sidePanelPorts = new Map();

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
      return listTabs(message.windowId);
    case 'tabs:create':
      return createTab(message.url, message.active);
    case 'tabs:focus':
      return focusTab(message.tabId);
    case 'tabs:duplicate':
      return duplicateTab(message.tabId);
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

async function listTabs(windowId) {
  const numericWindowId = Number(windowId);
  const query = Number.isFinite(numericWindowId) ? { windowId: numericWindowId } : { currentWindow: true };
  const tabs = await chrome.tabs.query(query);
  const targetWindowId = Number.isFinite(numericWindowId) ? numericWindowId : tabs[0]?.windowId;
  const groups = Number.isFinite(targetWindowId) ? await chrome.tabGroups.query({ windowId: targetWindowId }) : [];
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
  try {
    const tab = await chrome.tabs.update(Number(tabId), { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
    return { tab: serializeTab(tab) };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { tab: null, missing: true };
    throw error;
  }
}

async function duplicateTab(tabId) {
  try {
    const tab = await chrome.tabs.duplicate(Number(tabId));
    return { tab: serializeTab(tab) };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { tab: null, missing: true };
    throw error;
  }
}

async function discardTab(tabId) {
  try {
    const tab = await chrome.tabs.discard(Number(tabId));
    return { tab: serializeTab(tab) };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { tab: null, missing: true };
    throw error;
  }
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(Number(tabId));
    return {};
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { missing: true };
    throw error;
  }
}

async function groupTabs(tabIds, title = 'Tabs', color = 'blue', collapsed = false) {
  const ids = await existingTabIds(tabIds);
  if (ids.length === 0) return { groupId: null, missing: true };
  try {
    const groupId = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(groupId, {
      title: String(title || 'Tabs').slice(0, 32),
      color,
      collapsed: Boolean(collapsed),
    });
    return { groupId };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { groupId: null, missing: true };
    throw error;
  }
}

async function addTabsToGroup(groupId, tabIds) {
  const ids = await existingTabIds(tabIds);
  if (!Number.isFinite(Number(groupId)) || ids.length === 0) return { groupId: null, missing: ids.length === 0 };
  try {
    const nextGroupId = await chrome.tabs.group({ groupId: Number(groupId), tabIds: ids });
    return { groupId: nextGroupId };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { groupId: null, missing: true };
    throw error;
  }
}

async function moveTab(tabId, index) {
  try {
    await chrome.tabs.move(Number(tabId), { index: Math.max(0, Number(index) || 0) });
    return {};
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { missing: true };
    throw error;
  }
}

async function ungroupTabs(tabIds) {
  const ids = await existingTabIds(tabIds);
  if (!ids.length) return { missing: true };
  try {
    await chrome.tabs.ungroup(ids);
    return {};
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { missing: true };
    throw error;
  }
}

async function updateGroup(groupId, update = {}) {
  const safeUpdate = {};
  if ('title' in update) safeUpdate.title = String(update.title || 'Group').slice(0, 32);
  if ('color' in update) safeUpdate.color = update.color;
  if ('collapsed' in update) safeUpdate.collapsed = Boolean(update.collapsed);
  try {
    const group = await chrome.tabGroups.update(Number(groupId), safeUpdate);
    return { group: serializeGroup(group) };
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { group: null, missing: true };
    throw error;
  }
}

async function moveGroup(groupId, index) {
  try {
    await chrome.tabGroups.move(Number(groupId), { index: Math.max(0, Number(index) || 0) });
    return {};
  } catch (error) {
    if (isMissingChromeEntityError(error)) return { missing: true };
    throw error;
  }
}

async function existingTabIds(tabIds = []) {
  const ids = tabIds.map(Number).filter(Number.isFinite);
  const existing = [];
  for (const id of ids) {
    try {
      await chrome.tabs.get(id);
      existing.push(id);
    } catch (error) {
      if (!isMissingChromeEntityError(error)) throw error;
    }
  }
  return existing;
}

function isMissingChromeEntityError(error) {
  return /No (tab|group) with id/i.test(error?.message || String(error));
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
  return {
    title: tab?.title || '',
    url: tab?.url || '',
    headings: [],
  };
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
