export function shouldAutoCloseTab(tab = {}) {
  return !tab.pinned;
}

export function buildSpaceSnapshot({ view = [], now = Date.now() } = {}) {
  return {
    version: 1,
    updatedAt: now,
    groups: view
      .map((group) => ({
        title: group.title || 'Ungrouped',
        color: group.color || 'grey',
        collapsed: Boolean(group.collapsed),
        tabs: (group.tabs || [])
          .filter(shouldAutoCloseTab)
          .map((tab) => ({
            title: tab.displayTitle || tab.title || tab.url || 'Untitled',
            url: tab.url,
          })),
      }))
      .filter((group) => group.tabs.length > 0),
  };
}

export function snapshotTabCount(snapshot = {}) {
  return (snapshot.groups || []).reduce((sum, group) => sum + (group.tabs || []).length, 0);
}

export function isUngroupedSnapshotGroup(group = {}) {
  return group.title === 'Ungrouped' && (group.color || 'grey') === 'grey';
}
