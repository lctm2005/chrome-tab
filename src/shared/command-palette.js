export function buildCommandPaletteItems({ spaces = [], spaceView = [], query = '' } = {}) {
  const needle = clean(query).toLowerCase();
  const commands = [
    { id: 'command:ask', kind: 'command', action: 'ask', icon: 'AI', title: 'Ask this Page', meta: 'Command' },
    { id: 'command:tidy', kind: 'command', action: 'tidy', icon: '✦', title: 'Tidy tab names', meta: 'Command' },
    { id: 'command:auto-group', kind: 'command', action: 'auto-group', icon: 'AG', title: 'Auto Group tabs', meta: 'Command' },
    { id: 'command:settings', kind: 'command', action: 'settings', icon: '⚙', title: 'Open Settings', meta: 'Command' },
  ];
  const spaceItems = spaces.map((space) => ({
    id: `space:${space.id}`,
    kind: 'space',
    spaceId: space.id,
    icon: clean(space.icon) || clean(space.name).slice(0, 1).toUpperCase() || 'S',
    title: clean(space.name) || 'Space',
    meta: 'Switch Space',
  }));
  const seenTabs = new Set();
  const tabItems = [];
  for (const group of spaceView || []) {
    for (const tab of group?.tabs || []) {
      const key = tabKey(tab);
      if (!key || seenTabs.has(key)) continue;
      seenTabs.add(key);
      tabItems.push({
        id: `tab:${key}`,
        kind: 'tab',
        tab,
        icon: tab.dormant ? '○' : '●',
        title: clean(tab.displayTitle || tab.title || tab.url) || 'Untitled',
        meta: [clean(group.title), tab.dormant ? 'Saved' : clean(tab.domain)].filter(Boolean).join(' · '),
      });
    }
  }

  const items = [...commands, ...spaceItems, ...tabItems];
  if (!needle) return items.slice(0, 40);
  return items
    .map((item) => ({ ...item, score: matchScore(item, needle) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map(({ score, ...item }) => item);
}

function matchScore(item, needle) {
  const title = clean(item.title).toLowerCase();
  const meta = clean(item.meta).toLowerCase();
  const url = clean(item.tab?.url).toLowerCase();
  if (title === needle) return 100;
  if (title.startsWith(needle)) return 80;
  if (title.includes(needle)) return 60;
  if (meta.includes(needle)) return 35;
  if (url.includes(needle)) return 25;
  return 0;
}

function tabKey(tab) {
  if (tab?.dormant) return clean(tab.id || tab.url);
  const id = Number(tab?.id);
  return Number.isFinite(id) ? String(id) : '';
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
