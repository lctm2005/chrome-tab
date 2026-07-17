export function buildCommandPaletteItems({ spaces = [], spaceView = [], query = '' } = {}) {
  const needle = clean(query).toLowerCase();
  const availableSpaces = Array.isArray(spaces) ? spaces : [];
  const availableGroups = Array.isArray(spaceView) ? spaceView : [];
  const spaceNames = new Map(availableSpaces.map((space) => [
    clean(space?.id),
    clean(space?.name) || 'Space',
  ]));
  const commands = [
    { id: 'command:ask', kind: 'command', action: 'ask', icon: 'AI', title: 'Ask this Page', meta: 'Command' },
    { id: 'command:tidy', kind: 'command', action: 'tidy', icon: '✦', title: 'Tidy tab names', meta: 'Command' },
    { id: 'command:auto-group', kind: 'command', action: 'auto-group', icon: 'AG', title: 'Auto Group tabs', meta: 'Command' },
    { id: 'command:settings', kind: 'command', action: 'settings', icon: '⚙', title: 'Open Settings', meta: 'Command' },
  ];
  const spaceItems = availableSpaces.map((space) => ({
    id: `space:${space.id}`,
    kind: 'space',
    spaceId: space.id,
    icon: clean(space.icon) || clean(space.name).slice(0, 1).toUpperCase() || 'S',
    title: clean(space.name) || 'Space',
    meta: 'Switch Space',
  }));
  const seenTabs = new Set();
  const usedItemIds = new Set();
  const tabItems = [];
  for (const group of availableGroups) {
    for (const tab of group?.tabs || []) {
      const key = tabKey(tab);
      const spaceId = clean(tab?.spaceId || group?.spaceId);
      const rowKey = `${spaceId}\u0000${key}`;
      if (!key || seenTabs.has(rowKey)) continue;
      seenTabs.add(rowKey);
      const baseItemId = `tab:${key}`;
      const itemId = usedItemIds.has(baseItemId) && spaceId
        ? `${baseItemId}:${spaceId}`
        : baseItemId;
      usedItemIds.add(itemId);
      tabItems.push({
        id: itemId,
        kind: 'tab',
        spaceId,
        tab,
        icon: tab.dormant ? '○' : '●',
        title: clean(tab.displayTitle || tab.title || tab.url) || 'Untitled',
        meta: [
          spaceNames.get(spaceId),
          clean(group.title),
          tab.dormant ? 'Saved' : clean(tab.domain),
        ].filter(Boolean).join(' · '),
      });
    }
  }

  const items = [...commands, ...spaceItems, ...tabItems];
  if (!needle) return items.slice(0, 40);
  return items
    .map((item) => ({ ...item, score: matchScore(item, needle) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (
      b.score - a.score || Number(Boolean(a.tab?.dormant)) - Number(Boolean(b.tab?.dormant))
    ))
    .slice(0, 40)
    .map(({ score, ...item }) => item);
}

function matchScore(item, needle) {
  const title = clean(item.title).toLowerCase();
  const pageTitle = clean(item.tab?.title).toLowerCase();
  const meta = clean(item.meta).toLowerCase();
  const url = clean(item.tab?.url).toLowerCase();
  if (title === needle || pageTitle === needle) return 100;
  if (title.startsWith(needle) || pageTitle.startsWith(needle)) return 80;
  if (title.includes(needle) || pageTitle.includes(needle)) return 60;
  if (matchesOrderedTitleWords(title, needle) || matchesOrderedTitleWords(pageTitle, needle)) return 55;
  if (meta.includes(needle)) return 35;
  if (url.includes(needle)) return 25;
  return 0;
}

function matchesOrderedTitleWords(title, needle) {
  const queryWords = needle.split(' ').filter(Boolean);
  if (queryWords.length < 2) return false;
  const titleWords = title.split(' ').filter(Boolean);
  let titleIndex = 0;
  for (const queryWord of queryWords) {
    while (titleIndex < titleWords.length && !titleWords[titleIndex].startsWith(queryWord)) {
      titleIndex += 1;
    }
    if (titleIndex >= titleWords.length) return false;
    titleIndex += 1;
  }
  return true;
}

function tabKey(tab) {
  if (tab?.dormant) return clean(tab.snapshotTabId || tab.id || tab.url);
  const id = Number(tab?.id);
  return Number.isFinite(id) ? String(id) : '';
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
