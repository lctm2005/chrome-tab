export function createFolderTree(groupsToRender = [], options = {}) {
  const activeSpaceId = String(options.activeSpaceId || '');
  const root = [];
  const folders = new Map();
  const folderPathKeys = folderPathKeysForGroups(groupsToRender);

  function ensureFolder(path) {
    const pathId = folderPathId(path);
    const existing = folders.get(pathId);
    if (existing) return existing;

    const parentPath = path.slice(0, -1);
    const parent = parentPath.length ? ensureFolder(parentPath) : null;
    const folder = {
      type: 'folder',
      key: folderKey(path, activeSpaceId),
      title: path.at(-1),
      path,
      children: [],
    };
    folders.set(pathId, folder);
    (parent ? parent.children : root).push(folder);
    return folder;
  }

  for (const group of groupsToRender) {
    const parts = folderTitleParts(group.title);
    if (parts.length > 0 && folderPathKeys.has(folderPathId(parts))) {
      ensureFolder(parts).children.push({ type: 'folder-tabs', group });
      continue;
    }

    if (parts.length <= 1) {
      root.push({ type: 'group', group });
      continue;
    }

    const folder = ensureFolder(parts.slice(0, -1));
    folder.children.push({
      type: 'group',
      group: {
        ...group,
        displayTitle: parts.at(-1),
      },
    });
  }

  return root;
}

function folderPathKeysForGroups(groupsToRender) {
  const keys = new Set();
  for (const group of groupsToRender) {
    const parts = folderTitleParts(group.title);
    for (let index = 1; index < parts.length; index += 1) {
      keys.add(folderPathId(parts.slice(0, index)));
    }
  }
  return keys;
}

export function folderTitleParts(title) {
  return String(title || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function movedGroupTitleForFolderDrop(groupTitle, sourceContext = {}, targetPath = []) {
  const groupPath = folderTitleParts(groupTitle);
  const sourcePath = Array.isArray(sourceContext?.path) ? sourceContext.path : [];
  const leafTitle = groupPath.at(-1) || 'Group';
  const relativePath = sourceContext?.type === 'folder'
    ? groupPath.slice(Math.max(0, sourcePath.length - 1))
    : [leafTitle];
  const nestedPath = [
    ...targetPath,
    ...(relativePath.length ? relativePath : [leafTitle]),
  ];
  return uniqueAdjacentPathParts(nestedPath).join(' / ');
}

export function renamedFolderGroupTitle(group, sourcePath = [], nextLeafTitle = '') {
  const currentPath = folderTitleParts(group?.title || group?.displayTitle || 'Group');
  const source = Array.isArray(sourcePath) ? sourcePath : [];
  const targetPath = [...source.slice(0, -1), nextLeafTitle];
  const suffix = pathStartsWith(currentPath, source)
    ? currentPath.slice(source.length)
    : currentPath.slice(-1);
  return uniqueAdjacentPathParts([...targetPath, ...suffix]).join(' / ');
}

function folderKey(parts, activeSpaceId) {
  return `folder:${activeSpaceId}:${parts.join('/')}`;
}

function folderPathId(parts) {
  return parts.join('/');
}

function uniqueAdjacentPathParts(parts) {
  const compact = parts.map((part) => String(part || '').trim()).filter(Boolean);
  return compact.filter((part, index) => index === 0 || part !== compact[index - 1]);
}

function pathStartsWith(path, prefix) {
  if (!prefix?.length || path.length < prefix.length) return false;
  return prefix.every((part, index) => path[index] === part);
}
