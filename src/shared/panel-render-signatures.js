import { tabRowPresentation } from './tab-utils.js';

export function groupsRenderSignature({
  activeSpaceId = '',
  fileSchemeAccessAllowed = false,
  spaceGroupsCollapsed = false,
  collapsedGroups = {},
  selectedTabIds = [],
  groups = [],
  folderTree = [],
} = {}) {
  const renderedGroups = groups.filter(Boolean);
  const visibleCollapsedKeys = new Set(
    renderedGroups.map((group) => group.key).filter(Boolean),
  );
  addVisibleFolderKeys(folderTree, visibleCollapsedKeys);
  const selected = new Set(selectedTabIds);

  return JSON.stringify({
    activeSpaceId,
    fileSchemeAccessAllowed: Boolean(fileSchemeAccessAllowed),
    spaceGroupsCollapsed: Boolean(spaceGroupsCollapsed),
    collapsedGroups: [...visibleCollapsedKeys]
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, Boolean(collapsedGroups[key])]),
    groups: renderedGroups.map((group) => groupRenderModel(group, selected)),
  });
}

export function askMessagesRenderSignature(session = {}) {
  return JSON.stringify([
    session?.key || '',
    (session?.messages || []).map((message) => [
      message.id,
      message.role,
      message.updatedAt || message.createdAt || 0,
      message.text,
    ]),
  ]);
}

export function spacesRenderSignature({
  layoutMode = '',
  workbenchMode = false,
  activeView = '',
  onboardingCompleted = false,
  activeSpaceId = '',
  spaces = [],
} = {}) {
  return JSON.stringify([
    layoutMode,
    Boolean(workbenchMode),
    activeView,
    Boolean(onboardingCompleted),
    activeSpaceId,
    spaces.map((space) => [space.id, space.name, space.icon || '']),
  ]);
}

function addVisibleFolderKeys(nodes, keys) {
  for (const node of nodes) {
    if (node.type !== 'folder') continue;
    if (node.key) keys.add(node.key);
    addVisibleFolderKeys(node.children || [], keys);
  }
}

function groupRenderModel(group, selectedTabIds) {
  return {
    key: group.key,
    id: group.id,
    snapshotGroupId: group.snapshotGroupId,
    title: group.title,
    displayTitle: group.displayTitle,
    color: group.color,
    collapsed: Boolean(group.collapsed),
    dormant: Boolean(group.dormant),
    tabs: (group.tabs || []).map((tab) => tabRenderModel(tab, selectedTabIds)),
  };
}

function tabRenderModel(tab, selectedTabIds) {
  const presentation = tabRowPresentation(tab);
  return {
    id: tab.id,
    snapshotTabId: tab.snapshotTabId,
    snapshotGroupId: tab.snapshotGroupId,
    title: tab.title,
    displayTitle: tab.displayTitle,
    panelTitle: tab.panelTitle,
    url: tab.url,
    pendingUrl: tab.pendingUrl,
    domain: tab.domain,
    favIconUrl: tab.favIconUrl,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    muted: Boolean(tab.muted),
    dormant: Boolean(tab.dormant),
    dormantGroupKey: tab.dormantGroupKey,
    groupId: tab.groupId,
    index: tab.index,
    windowId: tab.windowId,
    foreign: presentation.foreign,
    foreignWindowTabId: presentation.foreignWindowTabId,
    foreignWindowId: presentation.foreignWindowId,
    secondaryLabel: presentation.secondaryLabel,
    ariaStateLabel: presentation.ariaStateLabel,
    selected: !tab.dormant && !presentation.foreign && selectedTabIds.has(tab.id),
  };
}
