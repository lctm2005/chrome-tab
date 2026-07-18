import { chromeGroupTitle } from './group-title.js';
import {
  askSessionKeyAfterTabReplacement,
  rebindAskSessionsForTabReplacement,
} from './ask-session.js';
import {
  isRestorableSnapshotTab,
  sanitizeSpaceSnapshot,
} from './space-snapshot.js';

const IDENTITY_VERSION = 1;
const MAX_LIFECYCLE_ID_LENGTH = 128;
const EVENT_TYPES = new Set([
  'created', 'removed', 'updated', 'moved', 'attached', 'detached', 'replaced',
  'group-updated', 'group-removed',
]);

/**
 * Adds stable, local-only identities to a snapshot without mutating the input.
 * Existing valid identities win once; missing or repeated identities are
 * replaced with values from idFactory (or a deterministic local fallback).
 */
export function ensureSnapshotLifecycleIds(snapshot, idFactory) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return snapshot;

  const usedGroupIds = new Set();
  const usedTabIds = new Set();
  let tabIndex = 0;
  const groups = arrayValue(snapshot.groups).map((group, groupIndex) => {
    const sourceGroup = recordValue(group);
    const snapshotGroupId = uniqueLifecycleId({
      current: sourceGroup.snapshotGroupId,
      kind: 'group',
      index: groupIndex,
      used: usedGroupIds,
      idFactory,
    });
    const tabs = arrayValue(sourceGroup.tabs).map((tab) => {
      const sourceTab = recordValue(tab);
      const snapshotTabId = uniqueLifecycleId({
        current: sourceTab.snapshotTabId,
        kind: 'tab',
        index: tabIndex,
        used: usedTabIds,
        idFactory,
      });
      tabIndex += 1;
      return { ...sourceTab, snapshotTabId };
    });
    return { ...sourceGroup, snapshotGroupId, tabs };
  });

  const existingVersion = Number(snapshot.identityVersion);
  return {
    ...snapshot,
    identityVersion: Number.isSafeInteger(existingVersion) && existingVersion > 0
      ? existingVersion
      : IDENTITY_VERSION,
    groups,
  };
}

/**
 * Adds identities before legacy URL de-duplication runs. Portable backups omit
 * local identities, so sanitizing first would collapse intentional same-URL
 * rows before they can receive distinct durable identities.
 */
export function sanitizeSnapshotWithLifecycleIds(snapshot, idFactory) {
  return sanitizeSpaceSnapshot(ensureSnapshotLifecycleIds(snapshot, idFactory));
}

/**
 * Resolves a live group's durable identity after its rows have been rebound to
 * a stored snapshot. A single row-derived identity is more authoritative than
 * the identity carried by a stale pre-rebind view (for example immediately
 * after Auto Group Undo recreates Chrome groups).
 */
export function resolveViewSnapshotGroupId(
  currentSnapshotGroupId,
  boundSnapshotGroupIds,
  idFactory,
  claimedSnapshotGroupIds = new Set(),
) {
  const reboundSnapshotGroupId = boundSnapshotGroupIds.size === 1
    ? boundSnapshotGroupIds.values().next().value
    : '';
  return claimViewSnapshotLifecycleId(
    reboundSnapshotGroupId || currentSnapshotGroupId,
    claimedSnapshotGroupIds,
    idFactory,
  );
}

export function claimViewSnapshotLifecycleId(
  preferredSnapshotId,
  claimedSnapshotIds,
  idFactory,
) {
  let snapshotId = preferredSnapshotId;
  while (!snapshotId || claimedSnapshotIds.has(snapshotId)) snapshotId = idFactory();
  claimedSnapshotIds.add(snapshotId);
  return snapshotId;
}

/**
 * Binds every live tab in a Space view to at most one stable snapshot row.
 * Stable bindings are preferred over URL matching so navigation and duplicate
 * URLs cannot silently change a tab's identity.
 */
export function bindLiveTabsToSnapshot(view, snapshot, existingBindings = {}) {
  const candidates = snapshotCandidates(snapshot);
  const consumed = new Set();
  const bindings = {};

  const entries = liveViewEntries(view).flatMap(({ group, tab }) => {
    const tabId = chromeEntityId(tab.id);
    if (tabId === null) return [];
    const existing = recordValue(existingBindings?.[tabId]);
    const stableId = normalizedLifecycleId(tab.snapshotTabId) ||
      normalizedLifecycleId(existing.snapshotTabId);
    return [{ group, tab, tabId, existing, stableId }];
  });
  const stableEntries = entries.filter((entry) => entry.stableId);
  const unboundEntries = entries.filter((entry) => !entry.stableId);

  // Reserve every explicit stable row before URL fallback runs. A newly
  // created or replacement tab can appear earlier in Chrome order than a
  // surviving duplicate; processing the view in one pass would let that
  // unbound tab steal the survivor's durable identity.
  for (const { group, tab, tabId, existing } of [...stableEntries, ...unboundEntries]) {
    const match = findBindingCandidate({ group, tab, existing, candidates, consumed });
    if (!match) continue;
    consumed.add(match.key);
    bindings[tabId] = lifecycleBinding({ group, tab, existing, match, snapshot });
  }

  return bindings;
}

/**
 * Rebinds durable lifecycle references after two Tags become one. Snapshot
 * identities and physical Chrome group ids are independent, so callers can
 * apply either replacement set without reconstructing any other binding data.
 */
export function remapTabLifecycleGroupReferences(
  bindings = {},
  { snapshotGroupIds = {}, chromeGroupIds = {} } = {},
) {
  return Object.fromEntries(Object.entries(bindings || {}).map(([tabId, binding]) => {
    const next = { ...binding };
    const snapshotGroupId = String(binding?.snapshotGroupId || '').trim();
    const chromeGroupId = String(binding?.groupId ?? '');
    if (Object.hasOwn(snapshotGroupIds, snapshotGroupId)) {
      next.snapshotGroupId = snapshotGroupIds[snapshotGroupId];
    }
    if (Object.hasOwn(chromeGroupIds, chromeGroupId)) {
      next.groupId = Number(chromeGroupIds[chromeGroupId]);
    }
    return [tabId, next];
  }));
}

/**
 * Applies one enriched Chrome tab lifecycle event to durable workspace state.
 * The reducer is deterministic and replay-safe; callers persist/ack events.
 */
export function reduceTabLifecycleEvent({ state, event, now = 0 } = {}) {
  if (!isRecord(state) || !isRecord(event) || !EVENT_TYPES.has(event.type)) return state;
  if (eventSessionIsStale(state, event)) return state;

  if (event.type === 'created') return reduceCreated(state, event, now);
  if (event.type === 'removed') return reduceRemoved(state, event, now);
  if (event.type === 'updated') return reduceUpdated(state, event, now);
  if (event.type === 'moved') return reduceMoved(state, event, now);
  if (event.type === 'attached') return reduceAttached(state, event);
  if (event.type === 'detached') return reduceDetached(state, event);
  if (event.type === 'group-updated') return reduceGroupUpdated(state, event, now);
  if (event.type === 'group-removed') return reduceGroupRemoved(state, event);
  return reduceReplaced(state, event, now);
}

function reduceCreated(state, event, now) {
  const tabId = chromeEntityId(event.tabId ?? event.tab?.id);
  const spaceId = cleanText(event.spaceId) || cleanText(event.targetGroup?.spaceId);
  if (tabId === null || !spaceId || !spaceExists(state, spaceId)) return state;

  const existingBinding = lifecycleBindingForEvent(state, event, tabId);
  if (existingBinding && !bindingSessionIsStale(state, existingBinding)) return state;

  const eventTab = recordValue(event.tab);
  const groupId = chromeGroupId(event.groupId ?? eventTab.groupId);
  const targetGroup = recordValue(event.targetGroup);
  const snapshotGroupId = normalizedLifecycleId(targetGroup.snapshotGroupId) ||
    createdLifecycleId('group', event, tabId);
  const snapshotTabId = createdLifecycleId('tab', event, tabId);
  const url = cleanText(event.url) || cleanText(eventTab.url);
  const title = cleanText(event.title) || cleanText(eventTab.title) || url;
  const binding = {
    tabId,
    snapshotTabId,
    snapshotGroupId,
    spaceId,
    url,
    title,
    panelTitle: '',
    windowId: chromeEntityId(event.windowId ?? eventTab.windowId),
    groupId,
    index: nonNegativeIndex(event.index ?? eventTab.index),
    pinned: eventTab.pinned === true,
    provisional: true,
    trackingMode: 'live',
    sessionId: cleanText(event.sessionId),
  };
  let next = cloneLiveMetadataState(state);
  if (groupId >= 0) {
    next.groupSpaces[groupId] = spaceId;
    delete next.tabSpaces[tabId];
  } else {
    next.tabSpaces[tabId] = spaceId;
  }
  if (!binding.pinned && isRestorableSnapshotTab({ url })) {
    next = upsertBoundSnapshotRow(next, binding, { title, url }, targetGroup, now);
    binding.provisional = !boundSnapshotRowLocation(next.spaceSnapshots, binding);
  }
  next.tabLifecycle[tabId] = binding;
  return next;
}

function reduceRemoved(state, event, now) {
  const tabId = chromeEntityId(event.tabId);
  if (tabId === null) return state;
  const binding = lifecycleBindingForEvent(state, event, tabId);
  if (binding && bindingSessionIsStale(state, binding)) return state;
  let next = cloneLiveMetadataState(state);
  if (binding && !event.isWindowClosing && !removalIsSuppressed(event)) {
    next = removeBoundSnapshotRow(next, binding, now);
  }
  return removeLiveTabMetadata(next, tabId);
}

function reduceUpdated(state, event, now) {
  const tabId = chromeEntityId(event.tabId);
  if (tabId === null) return state;
  const originalBinding = lifecycleBindingForEvent(state, event, tabId);
  if (!originalBinding || bindingSessionIsStale(state, originalBinding)) return state;

  let next = cloneLiveMetadataState(state);
  const changeInfo = recordValue(event.changeInfo);
  const eventTab = recordValue(event.tab);
  const binding = { ...originalBinding, tabId };
  const hasUrlChange = hasOwn(changeInfo, 'url') || hasOwn(event, 'url');
  const hasTitleChange = hasOwn(changeInfo, 'title') || hasOwn(event, 'title');
  const hasPinnedChange = hasOwn(changeInfo, 'pinned') || hasOwn(event, 'pinned');
  const deferGroupMembership = event.deferGroupMembership === true;
  const preserveGroupForWindowClose = event.preserveGroupForWindowClose === true &&
    hasOwn(changeInfo, 'groupId') &&
    Number(changeInfo.groupId) === -1;
  const nextUrl = hasOwn(changeInfo, 'url') ? changeInfo.url
    : hasOwn(event, 'url') ? event.url
    : eventTab.url;
  const nextTitle = hasOwn(changeInfo, 'title') ? changeInfo.title
    : hasOwn(event, 'title') ? event.title
    : eventTab.title;
  if (hasUrlChange) binding.url = cleanText(nextUrl);
  if (hasTitleChange) binding.title = cleanText(nextTitle);
  if (hasPinnedChange) {
    binding.pinned = Boolean(hasOwn(changeInfo, 'pinned') ? changeInfo.pinned : event.pinned);
  }
  if (hasOwn(event, 'trackingMode')) binding.trackingMode = normalizeTrackingMode(event.trackingMode);

  const nextGroupId = deferGroupMembership || preserveGroupForWindowClose ? binding.groupId
    : hasOwn(changeInfo, 'groupId') ? changeInfo.groupId
    : hasOwn(event, 'groupId') ? event.groupId
    : eventTab.groupId;
  const hasImplicitGroupChange = hasOwn(eventTab, 'groupId') &&
    chromeGroupId(eventTab.groupId) !== chromeGroupId(originalBinding.groupId);
  const hasGroupChange = !deferGroupMembership && !preserveGroupForWindowClose && (
    hasOwn(changeInfo, 'groupId') || hasOwn(event, 'groupId') || hasImplicitGroupChange
  );
  if (nextGroupId !== undefined) binding.groupId = nextGroupId;

  const targetGroup = preserveGroupForWindowClose ? {} : recordValue(event.targetGroup);
  const targetSpaceId = cleanText(targetGroup.spaceId);
  const targetSnapshotGroupId = validLifecycleId(targetGroup.snapshotGroupId)
    ? targetGroup.snapshotGroupId.trim()
    : '';
  let groupTargetResolved = Boolean(
    targetSpaceId &&
    targetSnapshotGroupId &&
    targetSpaceId === binding.spaceId &&
    targetSnapshotGroupId === binding.snapshotGroupId
  );
  if (
    targetSpaceId &&
    targetSnapshotGroupId &&
    (targetSpaceId !== binding.spaceId || targetSnapshotGroupId !== binding.snapshotGroupId)
  ) {
    const hasStoredRow = Boolean(boundSnapshotRowLocation(next.spaceSnapshots, binding));
    if (!hasStoredRow && binding.provisional === true) {
      binding.spaceId = targetSpaceId;
      binding.snapshotGroupId = targetSnapshotGroupId;
      groupTargetResolved = true;
    } else if (hasStoredRow) {
      const movement = moveBoundSnapshotRow(next, binding, {
        ...targetGroup,
        spaceId: targetSpaceId,
        snapshotGroupId: targetSnapshotGroupId,
      }, now);
      next = movement.state;
      if (movement.moved) {
        binding.spaceId = targetSpaceId;
        binding.snapshotGroupId = targetSnapshotGroupId;
        groupTargetResolved = true;
      }
    }
  }

  if (hasGroupChange) {
    // A side-panel Move first checkpoints a live tab into a virtual Tag and
    // then Chrome reports the earlier ungroup operation asynchronously. Keep
    // that virtual membership only when it still names the exact resolved
    // stable snapshot group; a genuine native ungroup must continue clearing
    // stale local grouping.
    let preservedVirtualGroupKey = '';
    if (groupTargetResolved && chromeEntityId(binding.groupId) === null) {
      const candidateKey = cleanText(next.tabGroups[tabId]);
      const candidate = recordValue(next.virtualGroups)[candidateKey];
      if (
        candidateKey &&
        cleanText(candidate?.spaceId) === binding.spaceId &&
        cleanText(candidate?.snapshotGroupId) === binding.snapshotGroupId
      ) {
        preservedVirtualGroupKey = candidateKey;
      }
    }
    delete next.tabGroups[tabId];
    if (chromeEntityId(binding.groupId) === null) {
      if (binding.spaceId) next.tabSpaces[tabId] = binding.spaceId;
      if (preservedVirtualGroupKey) next.tabGroups[tabId] = preservedVirtualGroupKey;
    } else if (
      groupTargetResolved ||
      cleanText(state.groupSpaces?.[binding.groupId]) === binding.spaceId
    ) {
      if (groupTargetResolved && binding.spaceId) {
        next.groupSpaces[binding.groupId] = binding.spaceId;
      }
      delete next.tabSpaces[tabId];
    } else if (binding.spaceId) {
      next.tabSpaces[tabId] = binding.spaceId;
    }
  }
  const shouldMutateSnapshot = (
    !preserveGroupForWindowClose || hasUrlChange || hasTitleChange || hasPinnedChange
  ) && (
    binding.trackingMode !== 'saved-target' || event.commitSavedTarget === true
  );
  if (shouldMutateSnapshot) {
    if (!binding.pinned && isRestorableSnapshotTab({ url: binding.url })) {
      next = upsertBoundSnapshotRow(next, binding, {
        url: binding.url,
        ...(binding.title ? { title: binding.title } : {}),
      }, targetGroup, now);
      binding.provisional = !boundSnapshotRowLocation(next.spaceSnapshots, binding);
    } else {
      next = removeBoundSnapshotRow(next, binding, now);
      binding.provisional = true;
    }
  }
  const orderedSnapshotGroupIds = uniqueNonEmptyStrings(targetGroup.orderedSnapshotGroupIds);
  const orderedSnapshot = next.spaceSnapshots?.[binding.spaceId];
  if (orderedSnapshotGroupIds.length > 0 && orderedSnapshot) {
    const snapshot = cloneSnapshot(orderedSnapshot);
    snapshot.groups = reorderSnapshotGroupSubset(snapshot.groups, orderedSnapshotGroupIds);
    next = setSpaceSnapshot(next, binding.spaceId, withSnapshotTimestamp(snapshot, now));
  }
  const orderedGroupIds = uniqueChromeTabIds(targetGroup.orderedGroupIds);
  if (orderedGroupIds.length > 0 && binding.spaceId) {
    const orderedKeys = orderedGroupIds.map((id) => `group:${id}`);
    next.groupOrder[binding.spaceId] = reorderLiveGroupOrder(
      next.groupOrder[binding.spaceId],
      orderedKeys,
    );
  }
  const orderedTabIds = uniqueChromeTabIds(targetGroup.orderedTabIds);
  const targetChromeGroupId = chromeEntityId(binding.groupId);
  if (groupTargetResolved && targetChromeGroupId !== null && binding.spaceId) {
    const targetGroupKey = `group:${targetChromeGroupId}`;
    next.tabLifecycle[tabId] = binding;
    next = reconcilePhysicalGroupMembers(next, {
      currentTabId: tabId,
      groupId: targetChromeGroupId,
      targetGroup,
      orderedTabIds,
      now,
    });
    next.tabOrder = removeTabOrderId(next.tabOrder, tabId);
    for (const peerTabId of orderedTabIds) {
      if (peerTabId !== tabId) next.tabOrder = removeTabOrderId(next.tabOrder, peerTabId);
    }
    for (const [spaceId, groups] of Object.entries(next.tabOrder)) {
      if (spaceId !== binding.spaceId) delete groups[targetGroupKey];
    }
    if (orderedTabIds.length > 0) {
      if (!isRecord(next.tabOrder[binding.spaceId])) next.tabOrder[binding.spaceId] = {};
      next.tabOrder[binding.spaceId][targetGroupKey] = orderedTabIds;
      next = reorderBoundSnapshotRows(next, binding, orderedTabIds, now);
    }
  }
  next.tabLifecycle[tabId] = binding;
  return next;
}

function reduceMoved(state, event, now) {
  const tabId = chromeEntityId(event.tabId);
  if (tabId === null) return state;
  const binding = lifecycleBindingForEvent(state, event, tabId);
  if (!binding || bindingSessionIsStale(state, binding)) return state;
  const toIndex = Number(event.toIndex ?? event.moveInfo?.toIndex);
  const windowId = chromeEntityId(event.windowId ?? event.moveInfo?.windowId);
  if (!Number.isSafeInteger(toIndex) || toIndex < 0) return state;

  let next = cloneLiveMetadataState(state);
  next.tabLifecycle[tabId] = {
    ...binding,
    tabId,
    index: toIndex,
    ...(windowId === null ? {} : { windowId }),
  };
  const orderedTabIds = uniqueChromeTabIds(event.orderedTabIds);
  const spaceId = cleanText(event.spaceId) || cleanText(binding.spaceId);
  const groupKey = cleanText(event.groupKey);
  if (orderedTabIds.length > 0 && spaceId && groupKey) {
    if (!isRecord(next.tabOrder[spaceId])) next.tabOrder[spaceId] = {};
    next.tabOrder[spaceId][groupKey] = orderedTabIds;
    next = reorderBoundSnapshotRows(next, binding, orderedTabIds, now);
  }
  return next;
}

function reduceAttached(state, event) {
  const tabId = chromeEntityId(event.tabId);
  if (tabId === null) return state;
  const binding = lifecycleBindingForEvent(state, event, tabId);
  if (!binding || bindingSessionIsStale(state, binding)) return state;
  const nextWindowId = chromeEntityId(event.newWindowId ?? event.attachInfo?.newWindowId);
  if (nextWindowId === null) return state;
  const next = cloneLiveMetadataState(state);
  const updated = { ...binding, tabId, windowId: nextWindowId };
  delete updated.detachedFromWindowId;
  if (Number.isSafeInteger(Number(event.newPosition ?? event.attachInfo?.newPosition))) {
    updated.index = Number(event.newPosition ?? event.attachInfo?.newPosition);
  }
  next.tabLifecycle[tabId] = updated;
  return next;
}

function reduceDetached(state, event) {
  const tabId = chromeEntityId(event.tabId);
  if (tabId === null) return state;
  const binding = lifecycleBindingForEvent(state, event, tabId);
  if (!binding || bindingSessionIsStale(state, binding)) return state;
  const oldWindowId = chromeEntityId(event.oldWindowId ?? event.detachInfo?.oldWindowId);
  const next = cloneLiveMetadataState(state);
  next.tabLifecycle[tabId] = {
    ...binding,
    tabId,
    windowId: null,
    ...(oldWindowId === null ? {} : { detachedFromWindowId: oldWindowId }),
  };
  return next;
}

function reduceGroupUpdated(state, event, now) {
  const groupId = chromeEntityId(event.groupId ?? event.group?.id);
  const spaceId = cleanText(event.spaceId);
  const snapshotGroupId = normalizedLifecycleId(event.snapshotGroupId);
  if (groupId === null || !spaceId || !snapshotGroupId || !spaceExists(state, spaceId)) return state;

  const storedSnapshot = state.spaceSnapshots?.[spaceId];
  const groupIndex = arrayValue(storedSnapshot?.groups).findIndex((group) => (
    group?.snapshotGroupId === snapshotGroupId
  ));
  if (groupIndex < 0) return state;

  let next = cloneLiveMetadataState(state);
  next.groupSpaces[groupId] = spaceId;
  const snapshot = cloneSnapshot(storedSnapshot);
  const current = snapshot.groups[groupIndex];
  const chromeGroup = recordValue(event.group);
  const physicalTitle = cleanText(chromeGroup.title);
  const title = hasOwn(chromeGroup, 'title')
    ? (
      physicalTitle === '' || cleanText(current.title) === '' ||
      chromeGroupTitle(current.title, current.title) !== physicalTitle
    )
      ? physicalTitle
      : current.title
    : current.title;
  snapshot.groups[groupIndex] = {
    ...current,
    title,
    ...(cleanText(chromeGroup.color) ? { color: cleanText(chromeGroup.color) } : {}),
    ...(hasOwn(chromeGroup, 'collapsed') ? { collapsed: Boolean(chromeGroup.collapsed) } : {}),
  };

  // onUpdated reports metadata changes, not a user-visible group move. The
  // physical Chrome order included by the background worker can lag a panel
  // drag that deliberately changed only the logical folder order, so only a
  // created/moved (or legacy source-less) event may project ordering here.
  const mayProjectPhysicalOrder = event.source !== 'updated';
  const orderedSnapshotGroupIds = mayProjectPhysicalOrder
    ? uniqueNonEmptyStrings(event.orderedSnapshotGroupIds)
    : [];
  if (orderedSnapshotGroupIds.length > 0) {
    snapshot.groups = reorderSnapshotGroupSubset(snapshot.groups, orderedSnapshotGroupIds);
  }
  next = setSpaceSnapshot(next, spaceId, withSnapshotTimestamp(snapshot, now));
  const groupKey = `group:${groupId}`;
  if (hasOwn(chromeGroup, 'collapsed')) next.collapsedGroups[groupKey] = Boolean(chromeGroup.collapsed);
  const orderedGroupIds = mayProjectPhysicalOrder
    ? uniqueChromeTabIds(event.orderedGroupIds)
    : [];
  if (orderedGroupIds.length > 0) {
    const orderedKeys = orderedGroupIds.map((id) => `group:${id}`);
    next.groupOrder[spaceId] = reorderLiveGroupOrder(next.groupOrder[spaceId], orderedKeys);
  }
  return next;
}

function reduceGroupRemoved(state, event) {
  const groupId = chromeEntityId(event.groupId ?? event.group?.id);
  if (groupId === null) return state;
  const next = cloneLiveMetadataState(state);
  delete next.groupSpaces[groupId];
  const groupKey = `group:${groupId}`;
  delete next.collapsedGroups[groupKey];
  for (const spaceId of Object.keys(next.groupOrder)) {
    next.groupOrder[spaceId] = arrayValue(next.groupOrder[spaceId]).filter((key) => key !== groupKey);
  }
  for (const groups of Object.values(next.tabOrder)) delete groups[groupKey];
  return next;
}

function reduceReplaced(state, event, now) {
  const removedTabId = chromeEntityId(event.removedTabId);
  const addedTabId = chromeEntityId(event.addedTabId);
  if (removedTabId === null || addedTabId === null || removedTabId === addedTabId) return state;
  const binding = lifecycleBindingForEvent(state, event, removedTabId);
  if (binding && bindingSessionIsStale(state, binding)) return state;

  let next = cloneLiveMetadataState(state);
  if (binding) {
    delete next.tabLifecycle[removedTabId];
    const tab = recordValue(event.tab);
    const nextBinding = {
      ...binding,
      tabId: addedTabId,
      ...(hasOwn(tab, 'windowId') ? { windowId: tab.windowId } : {}),
      ...(hasOwn(tab, 'groupId') ? { groupId: tab.groupId } : {}),
      ...(hasOwn(tab, 'url') ? { url: cleanText(tab.url) } : {}),
      ...(hasOwn(tab, 'title') ? { title: cleanText(tab.title) } : {}),
    };
    if (nextBinding.trackingMode !== 'saved-target' && (hasOwn(tab, 'url') || hasOwn(tab, 'title'))) {
      if (isRestorableSnapshotTab({ url: nextBinding.url })) {
        next = updateBoundSnapshotRow(next, binding, {
          ...(hasOwn(tab, 'url') ? { url: nextBinding.url } : {}),
          ...(hasOwn(tab, 'title') && nextBinding.title ? { title: nextBinding.title } : {}),
        }, now);
      }
    }
    next.tabLifecycle[addedTabId] = nextBinding;
  }
  next = transferRecordKey(next, 'tabSpaces', removedTabId, addedTabId);
  next = transferRecordKey(next, 'renamedTabs', removedTabId, addedTabId);
  next = transferRecordKey(next, 'tabGroups', removedTabId, addedTabId);
  next.ephemeralTabIds = replaceNumericId(next.ephemeralTabIds, removedTabId, addedTabId);
  next.tabOrder = replaceTabOrderId(next.tabOrder, removedTabId, addedTabId);
  if (isRecord(state.askSessions)) {
    const rebound = rebindAskSessionsForTabReplacement(
      state.askSessions,
      removedTabId,
      addedTabId,
    );
    next.askSessions = rebound.sessions;
    next.activeAskSessionKey = rebound.keyMap[state.activeAskSessionKey] ||
      askSessionKeyAfterTabReplacement(state.activeAskSessionKey, removedTabId, addedTabId);
  } else if (typeof state.activeAskSessionKey === 'string') {
    next.activeAskSessionKey = askSessionKeyAfterTabReplacement(
      state.activeAskSessionKey,
      removedTabId,
      addedTabId,
    );
  }
  if (Array.isArray(state.operationHistory)) {
    next.operationHistory = replaceOperationHistoryTabId(
      state.operationHistory,
      removedTabId,
      addedTabId,
    );
  }
  return next;
}

function replaceOperationHistoryTabId(history, removedTabId, addedTabId) {
  return history.map((operation) => {
    if (!isRecord(operation)) return operation;
    const before = recordValue(operation.before);
    const after = recordValue(operation.after);
    if (operation.type === 'tidy-names') {
      return {
        ...operation,
        before: {
          ...before,
          renamedTabs: replaceRecordId(before.renamedTabs, removedTabId, addedTabId),
          live: replaceLiveOrganizationTabId(before.live, removedTabId, addedTabId),
          ...(hasOwn(before, 'snapshotGroupReferences') ? {
            snapshotGroupReferences: replaceSnapshotGroupReferenceTabId(
              before.snapshotGroupReferences,
              removedTabId,
              addedTabId,
            ),
          } : {}),
        },
        after: {
          ...after,
          renamedTabs: replaceRecordId(after.renamedTabs, removedTabId, addedTabId),
          tabIdAliases: replaceTabIdAlias(after.tabIdAliases, removedTabId, addedTabId),
        },
      };
    }
    if (operation.type === 'auto-group') {
      return {
        ...operation,
        before: {
          ...before,
          live: replaceLiveOrganizationTabId(before.live, removedTabId, addedTabId),
          ...(hasOwn(before, 'snapshotGroupReferences') ? {
            snapshotGroupReferences: replaceSnapshotGroupReferenceTabId(
              before.snapshotGroupReferences,
              removedTabId,
              addedTabId,
            ),
          } : {}),
        },
        after: {
          ...after,
          tabIdAliases: replaceTabIdAlias(after.tabIdAliases, removedTabId, addedTabId),
        },
      };
    }
    if (operation.type === 'restore-backup') {
      return {
        ...operation,
        before: {
          ...before,
          liveOwnership: replaceLiveOwnershipTabId(
            before.liveOwnership,
            removedTabId,
            addedTabId,
          ),
        },
      };
    }
    return operation;
  });
}

function replaceRecordId(value, removedTabId, addedTabId) {
  const record = { ...recordValue(value) };
  if (hasOwn(record, removedTabId)) record[addedTabId] = record[removedTabId];
  delete record[removedTabId];
  return record;
}

function replaceTabIdAlias(value, removedTabId, addedTabId) {
  const aliases = { ...recordValue(value) };
  const priorAlias = chromeEntityId(aliases[removedTabId]);
  delete aliases[removedTabId];
  aliases[addedTabId] = priorAlias ?? removedTabId;
  return aliases;
}

function replaceLiveOrganizationTabId(value, removedTabId, addedTabId) {
  const live = recordValue(value);
  return {
    ...live,
    tabs: arrayValue(live.tabs).map((record) => (
      Number(record?.tabId) === removedTabId
        ? { ...record, tabId: addedTabId }
        : record
    )),
    groups: arrayValue(live.groups).map((group) => ({
      ...recordValue(group),
      tabIds: replaceNumericId(group?.tabIds, removedTabId, addedTabId),
    })),
    ungroupedTabIds: replaceNumericId(live.ungroupedTabIds, removedTabId, addedTabId),
  };
}

function replaceSnapshotGroupReferenceTabId(value, removedTabId, addedTabId) {
  const references = recordValue(value);
  return {
    ...references,
    tabLifecycle: replaceRecordId(
      references.tabLifecycle,
      removedTabId,
      addedTabId,
    ),
    recentlyOpenedDormantTabs: arrayValue(references.recentlyOpenedDormantTabs)
      .map((record) => (
        Number(record?.tabId) === removedTabId
          ? { ...record, tabId: addedTabId }
          : record
      )),
  };
}

function replaceLiveOwnershipTabId(value, removedTabId, addedTabId) {
  const ownership = recordValue(value);
  return {
    ...ownership,
    tabs: arrayValue(ownership.tabs).map((record) => (
      Number(record?.id) === removedTabId ? { ...record, id: addedTabId } : record
    )),
    lifecycle: arrayValue(ownership.lifecycle).map((record) => (
      Number(record?.id) === removedTabId
        ? {
          ...record,
          id: addedTabId,
          binding: isRecord(record?.binding)
            ? { ...record.binding, tabId: addedTabId }
            : record?.binding,
        }
        : record
    )),
  };
}

function uniqueLifecycleId({ current, kind, index, used, idFactory }) {
  const normalizedCurrent = normalizedLifecycleId(current);
  if (normalizedCurrent && !used.has(normalizedCurrent)) {
    used.add(normalizedCurrent);
    return normalizedCurrent;
  }

  const proposed = typeof idFactory === 'function'
    ? normalizedLifecycleId(idFactory(kind, index, current))
    : '';
  let candidate = proposed && !used.has(proposed) ? proposed : `${kind}-${index + 1}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${kind}-${index + 1}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function normalizedLifecycleId(value) {
  if (!validLifecycleId(value)) return '';
  return value.trim();
}

function createdLifecycleId(kind, event, tabId) {
  const prefix = `${kind}:`;
  const eventId = normalizedLifecycleId(event?.eventId);
  const seed = eventId || `${tabId}`;
  return `${prefix}${seed.slice(0, MAX_LIFECYCLE_ID_LENGTH - prefix.length)}`;
}

function validLifecycleId(value) {
  if (typeof value !== 'string') return false;
  const id = value.trim();
  return Boolean(id) &&
    id.length <= MAX_LIFECYCLE_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) &&
    !['__proto__', 'prototype', 'constructor'].includes(id);
}

function snapshotCandidates(snapshot) {
  const candidates = [];
  for (const [groupIndex, group] of arrayValue(snapshot?.groups).entries()) {
    const snapshotGroupId = normalizedLifecycleId(group?.snapshotGroupId);
    for (const [tabIndex, tab] of arrayValue(group?.tabs).entries()) {
      const snapshotTabId = normalizedLifecycleId(tab?.snapshotTabId);
      if (!snapshotTabId) continue;
      candidates.push({
        key: `${groupIndex}:${tabIndex}:${snapshotTabId}`,
        group,
        tab,
        snapshotGroupId,
        snapshotTabId,
        groupKey: snapshotGroupMatchKey(group),
        url: cleanText(tab?.url),
        panelTitle: panelTitle(tab),
      });
    }
  }
  return candidates;
}

function liveViewEntries(view) {
  return arrayValue(view).flatMap((group) => (
    arrayValue(group?.tabs).map((tab) => ({ group: recordValue(group), tab: recordValue(tab) }))
  ));
}

function findBindingCandidate({ group, tab, existing, candidates, consumed }) {
  const available = (predicate) => candidates.find((candidate) => !consumed.has(candidate.key) && predicate(candidate));
  const stableId = normalizedLifecycleId(tab.snapshotTabId) || normalizedLifecycleId(existing.snapshotTabId);
  if (stableId) {
    const stable = available((candidate) => candidate.snapshotTabId === stableId);
    if (stable) return stable;
    // A durable identity may be temporarily absent while a tab moves between
    // Spaces. Rebinding it by URL to a different durable row would steal that
    // saved row's identity; URL fallback is only for live tabs with no identity.
    return null;
  }

  const url = cleanText(tab.url);
  if (!url) return null;
  const requestedGroupId = normalizedLifecycleId(group.snapshotGroupId) || normalizedLifecycleId(existing.snapshotGroupId);
  const groupKey = snapshotGroupMatchKey(group);
  const requestedPanelTitle = panelTitle(tab) || cleanText(existing.panelTitle);
  const sameGroup = (candidate) => requestedGroupId
    ? candidate.snapshotGroupId === requestedGroupId
    : candidate.groupKey === groupKey;
  const sameUrl = (candidate) => candidate.url === url;
  const samePanelTitle = (candidate) => Boolean(
    requestedPanelTitle && candidate.panelTitle === requestedPanelTitle
  );

  return available((candidate) => sameGroup(candidate) && sameUrl(candidate) && samePanelTitle(candidate)) ||
    available((candidate) => sameGroup(candidate) && sameUrl(candidate)) ||
    available((candidate) => sameUrl(candidate) && samePanelTitle(candidate)) ||
    available(sameUrl) ||
    null;
}

function lifecycleBinding({ group, tab, existing, match, snapshot }) {
  const tabId = Number(tab.id);
  const explicitSpaceId = cleanText(tab.spaceId) || cleanText(group.spaceId) || cleanText(snapshot?.spaceId);
  const windowId = chromeEntityId(tab.windowId);
  const chromeGroupId = chromeEntityId(tab.groupId);
  return {
    ...existing,
    tabId,
    snapshotTabId: match.snapshotTabId,
    snapshotGroupId: match.snapshotGroupId,
    spaceId: explicitSpaceId || cleanText(existing.spaceId),
    url: cleanText(tab.url),
    title: cleanText(tab.title) || cleanText(match.tab.title) || cleanText(tab.url),
    panelTitle: panelTitle(tab) || cleanText(existing.panelTitle) || match.panelTitle,
    windowId: windowId === null ? existing.windowId ?? null : windowId,
    groupId: chromeGroupId === null ? existing.groupId ?? -1 : chromeGroupId,
    index: nonNegativeIndex(tab.index ?? existing.index),
    pinned: typeof tab.pinned === 'boolean' ? tab.pinned : existing.pinned === true,
    trackingMode: normalizeTrackingMode(tab.trackingMode ?? existing.trackingMode),
    sessionId: cleanText(tab.sessionId) || cleanText(existing.sessionId) || cleanText(snapshot?.sessionId),
  };
}

function snapshotGroupMatchKey(group) {
  return `${cleanText(group?.title) || 'Ungrouped'}\n${cleanText(group?.color) || 'grey'}`;
}

function panelTitle(tab) {
  return cleanText(tab?.panelTitle);
}

function lifecycleBindingForEvent(state, event, tabId) {
  const eventBinding = recordValue(event.binding);
  if (Object.keys(eventBinding).length > 0) return eventBinding;
  return isRecord(state.tabLifecycle?.[tabId]) ? state.tabLifecycle[tabId] : null;
}

function eventSessionIsStale(state, event) {
  const currentSessionId = cleanText(state.browserSessionId);
  const eventSessionId = cleanText(event.sessionId);
  return Boolean(currentSessionId && eventSessionId && currentSessionId !== eventSessionId);
}

function bindingSessionIsStale(state, binding) {
  const currentSessionId = cleanText(state.browserSessionId);
  const bindingSessionId = cleanText(binding.sessionId);
  return Boolean(currentSessionId && bindingSessionId && currentSessionId !== bindingSessionId);
}

function removalIsSuppressed(event) {
  return event.suppressed === true || event.disposition === 'panel-managed';
}

function cloneLiveMetadataState(state) {
  return {
    ...state,
    tabLifecycle: { ...recordValue(state.tabLifecycle) },
    groupSpaces: { ...recordValue(state.groupSpaces) },
    tabSpaces: { ...recordValue(state.tabSpaces) },
    renamedTabs: { ...recordValue(state.renamedTabs) },
    tabGroups: { ...recordValue(state.tabGroups) },
    ephemeralTabIds: arrayValue(state.ephemeralTabIds).slice(),
    collapsedGroups: { ...recordValue(state.collapsedGroups) },
    groupOrder: Object.fromEntries(Object.entries(recordValue(state.groupOrder)).map(([spaceId, keys]) => [
      spaceId,
      arrayValue(keys).slice(),
    ])),
    tabOrder: cloneTabOrder(state.tabOrder),
  };
}

function cloneTabOrder(tabOrder) {
  return Object.fromEntries(Object.entries(recordValue(tabOrder)).map(([spaceId, groups]) => [
    spaceId,
    Object.fromEntries(Object.entries(recordValue(groups)).map(([groupId, ids]) => [
      groupId,
      arrayValue(ids).slice(),
    ])),
  ]));
}

function removeLiveTabMetadata(state, tabId) {
  delete state.tabLifecycle[tabId];
  delete state.tabSpaces[tabId];
  delete state.renamedTabs[tabId];
  delete state.tabGroups[tabId];
  state.ephemeralTabIds = arrayValue(state.ephemeralTabIds).filter((id) => Number(id) !== tabId);
  state.tabOrder = removeTabOrderId(state.tabOrder, tabId);
  return state;
}

function removeBoundSnapshotRow(state, binding, now) {
  const location = boundSnapshotRowLocation(state.spaceSnapshots, binding);
  if (!location) return state;
  const snapshot = cloneSnapshot(location.snapshot);
  const group = snapshot.groups[location.groupIndex];
  group.tabs.splice(location.tabIndex, 1);
  if (!snapshotGroupPersists(snapshot, group)) snapshot.groups.splice(location.groupIndex, 1);
  return setSpaceSnapshot(state, location.spaceId, withSnapshotTimestamp(snapshot, now));
}

function updateBoundSnapshotRow(state, binding, replacement, now) {
  const location = boundSnapshotRowLocation(state.spaceSnapshots, binding);
  if (!location) return state;
  const snapshot = cloneSnapshot(location.snapshot);
  const current = snapshot.groups[location.groupIndex].tabs[location.tabIndex];
  snapshot.groups[location.groupIndex].tabs[location.tabIndex] = { ...current, ...replacement };
  return setSpaceSnapshot(state, location.spaceId, withSnapshotTimestamp(snapshot, now));
}

function upsertBoundSnapshotRow(state, binding, replacement, targetGroup, now) {
  const location = boundSnapshotRowLocation(state.spaceSnapshots, binding);
  if (location) return updateBoundSnapshotRow(state, binding, replacement, now);
  if (binding?.provisional !== true) return state;

  const spaceId = cleanText(binding?.spaceId);
  const snapshotGroupId = normalizedLifecycleId(binding?.snapshotGroupId);
  const snapshotTabId = normalizedLifecycleId(binding?.snapshotTabId);
  if (!spaceId || !snapshotGroupId || !snapshotTabId) return state;
  if (snapshotTabIdentityExists(state.spaceSnapshots, snapshotTabId)) return state;

  const storedSnapshot = state.spaceSnapshots?.[spaceId];
  const snapshot = storedSnapshot
    ? cloneSnapshot(storedSnapshot)
    : { version: 1, identityVersion: IDENTITY_VERSION, updatedAt: finiteNow(now), groups: [] };
  let destination = snapshot.groups.find((group) => group.snapshotGroupId === snapshotGroupId);
  if (!destination) {
    const group = recordValue(targetGroup);
    const grouped = chromeGroupId(binding.groupId) >= 0;
    const title = cleanText(group.title) || (grouped ? 'Tabs' : 'Ungrouped');
    const color = cleanText(group.color) || (grouped ? 'blue' : 'grey');
    destination = {
      snapshotGroupId,
      title,
      color,
      collapsed: Boolean(group.collapsed),
      ...(title === 'Ungrouped' && color === 'grey' ? { restorable: true } : {}),
      tabs: [],
    };
    snapshot.groups.push(destination);
  }
  destination.tabs.push({
    snapshotTabId,
    title: cleanText(replacement?.title) || cleanText(binding.title) || cleanText(replacement?.url),
    url: cleanText(replacement?.url),
    ...(cleanText(binding.panelTitle) ? { panelTitle: cleanText(binding.panelTitle) } : {}),
  });
  return setSpaceSnapshot(state, spaceId, withSnapshotTimestamp(snapshot, now));
}

function snapshotTabIdentityExists(spaceSnapshots, snapshotTabId) {
  return Object.values(recordValue(spaceSnapshots)).some((snapshot) => (
    arrayValue(snapshot?.groups).some((group) => (
      arrayValue(group?.tabs).some((tab) => tab?.snapshotTabId === snapshotTabId)
    ))
  ));
}

function moveBoundSnapshotRow(state, binding, targetGroup, now) {
  const location = boundSnapshotRowLocation(state.spaceSnapshots, binding);
  const sourceSnapshot = cloneSnapshot(location.snapshot);
  const [row] = sourceSnapshot.groups[location.groupIndex].tabs.splice(location.tabIndex, 1);
  if (!snapshotGroupPersists(sourceSnapshot, sourceSnapshot.groups[location.groupIndex])) {
    sourceSnapshot.groups.splice(location.groupIndex, 1);
  }

  let next = setSpaceSnapshot(state, location.spaceId, withSnapshotTimestamp(sourceSnapshot, now));
  const storedTarget = next.spaceSnapshots?.[targetGroup.spaceId];
  const targetSnapshot = storedTarget
    ? cloneSnapshot(storedTarget)
    : { version: 1, identityVersion: IDENTITY_VERSION, updatedAt: finiteNow(now), groups: [] };
  // A prior interrupted move can leave the same durable row in both Spaces.
  // The live binding identifies the source row as current, so reconcile any
  // target ghost before inserting it instead of making the Move impossible to
  // retry. Stable identities are authoritative even when URL/title changed.
  targetSnapshot.groups = targetSnapshot.groups
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter((tab) => tab.snapshotTabId !== row.snapshotTabId),
    }))
    .filter((group) => snapshotGroupPersists(targetSnapshot, group));
  let destination = targetSnapshot.groups.find((group) => (
    group.snapshotGroupId === targetGroup.snapshotGroupId
  ));
  if (!destination) {
    const title = cleanText(targetGroup.title) || 'Ungrouped';
    const color = cleanText(targetGroup.color) || 'grey';
    destination = {
      snapshotGroupId: targetGroup.snapshotGroupId,
      title,
      color,
      collapsed: Boolean(targetGroup.collapsed),
      ...(title === 'Ungrouped' && color === 'grey' ? { restorable: true } : {}),
      tabs: [],
    };
    targetSnapshot.groups.push(destination);
  }
  destination.tabs.push(row);
  next = setSpaceSnapshot(next, targetGroup.spaceId, withSnapshotTimestamp(targetSnapshot, now));
  return { state: next, moved: true };
}

function reconcilePhysicalGroupMembers(
  state,
  { currentTabId, groupId, targetGroup, orderedTabIds, now },
) {
  let next = state;
  for (const peerTabId of orderedTabIds) {
    if (peerTabId === currentTabId) continue;
    const originalPeer = next.tabLifecycle?.[peerTabId];
    if (!isRecord(originalPeer) || bindingSessionIsStale(next, originalPeer)) continue;
    const peer = { ...originalPeer, tabId: peerTabId, groupId };
    let resolved = peer.spaceId === targetGroup.spaceId &&
      peer.snapshotGroupId === targetGroup.snapshotGroupId;
    if (!resolved) {
      const hasStoredRow = Boolean(boundSnapshotRowLocation(next.spaceSnapshots, peer));
      if (!hasStoredRow && peer.provisional === true) {
        resolved = true;
      } else if (hasStoredRow) {
        const movement = moveBoundSnapshotRow(next, peer, targetGroup, now);
        next = movement.state;
        resolved = movement.moved;
      }
    }
    if (!resolved) continue;
    peer.spaceId = targetGroup.spaceId;
    peer.snapshotGroupId = targetGroup.snapshotGroupId;
    next.groupSpaces[groupId] = targetGroup.spaceId;
    delete next.tabSpaces[peerTabId];
    delete next.tabGroups[peerTabId];
    next.tabLifecycle[peerTabId] = peer;
  }
  return next;
}

function reorderBoundSnapshotRows(state, binding, orderedTabIds, now) {
  const snapshot = state.spaceSnapshots?.[binding.spaceId];
  const snapshotGroupId = normalizedLifecycleId(binding.snapshotGroupId);
  if (!snapshot || !snapshotGroupId) return state;
  const cloned = cloneSnapshot(snapshot);
  const group = cloned.groups.find((candidate) => candidate.snapshotGroupId === snapshotGroupId);
  if (!group) return state;
  const orderedSnapshotIds = orderedTabIds
    .map((tabId) => state.tabLifecycle?.[tabId]?.snapshotTabId)
    .filter((snapshotTabId) => typeof snapshotTabId === 'string');
  const rank = new Map(orderedSnapshotIds.map((snapshotTabId, index) => [snapshotTabId, index]));
  const reorderedLiveRows = group.tabs
    .filter((row) => rank.has(row.snapshotTabId))
    .sort((left, right) => rank.get(left.snapshotTabId) - rank.get(right.snapshotTabId));
  let liveIndex = 0;
  group.tabs = group.tabs.map((row) => (
    rank.has(row.snapshotTabId) ? reorderedLiveRows[liveIndex++] : row
  ));
  return setSpaceSnapshot(state, binding.spaceId, withSnapshotTimestamp(cloned, now));
}

function boundSnapshotRowLocation(spaceSnapshots, binding) {
  const snapshotTabId = normalizedLifecycleId(binding?.snapshotTabId);
  if (!snapshotTabId) return null;
  const requestedSpaceId = cleanText(binding?.spaceId);
  const entries = requestedSpaceId
    ? [[requestedSpaceId, spaceSnapshots?.[requestedSpaceId]]]
    : Object.entries(recordValue(spaceSnapshots));
  const matches = [];
  for (const [spaceId, snapshot] of entries) {
    for (const [groupIndex, group] of arrayValue(snapshot?.groups).entries()) {
      for (const [tabIndex, tab] of arrayValue(group?.tabs).entries()) {
        if (tab?.snapshotTabId === snapshotTabId) {
          matches.push({ spaceId, snapshot, groupIndex, tabIndex });
        }
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function setSpaceSnapshot(state, spaceId, snapshot) {
  const spaceSnapshots = { ...recordValue(state.spaceSnapshots) };
  if (arrayValue(snapshot?.groups).length === 0) {
    delete spaceSnapshots[spaceId];
  } else {
    spaceSnapshots[spaceId] = snapshot;
  }
  return {
    ...state,
    spaceSnapshots,
  };
}

function cloneSnapshot(snapshot) {
  return {
    ...recordValue(snapshot),
    groups: arrayValue(snapshot?.groups).map((group) => ({
      ...recordValue(group),
      tabs: arrayValue(group?.tabs).map((tab) => ({ ...recordValue(tab) })),
    })),
  };
}

function withSnapshotTimestamp(snapshot, now) {
  return { ...snapshot, updatedAt: finiteNow(now) };
}

function finiteNow(now) {
  return Number.isFinite(Number(now)) ? Number(now) : 0;
}

function snapshotGroupPersists(snapshot, group) {
  return arrayValue(group?.tabs).length > 0 || Boolean(
    snapshot?.preserveGroups && !isUngroupedGroup(group)
  );
}

function isUngroupedGroup(group) {
  return (cleanText(group?.title) || 'Ungrouped') === 'Ungrouped' &&
    (cleanText(group?.color) || 'grey') === 'grey';
}

function transferRecordKey(state, key, fromId, toId) {
  const record = { ...recordValue(state[key]) };
  if (hasOwn(record, fromId)) record[toId] = record[fromId];
  delete record[fromId];
  return { ...state, [key]: record };
}

function replaceNumericId(values, fromId, toId) {
  return [...new Set(arrayValue(values).map((value) => (
    Number(value) === fromId ? toId : value
  )))];
}

function uniqueChromeTabIds(values) {
  const ids = [];
  const seen = new Set();
  for (const value of arrayValue(values)) {
    const id = chromeEntityId(value);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function uniqueNonEmptyStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of arrayValue(values)) {
    const normalized = cleanText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function reorderSnapshotGroupSubset(groups, orderedSnapshotGroupIds) {
  const byId = new Map(arrayValue(groups).map((group) => [group?.snapshotGroupId, group]));
  const ordered = orderedSnapshotGroupIds.map((id) => byId.get(id)).filter(Boolean);
  const orderedIds = new Set(ordered.map((group) => group.snapshotGroupId));
  let cursor = 0;
  return arrayValue(groups).map((group) => (
    orderedIds.has(group?.snapshotGroupId) ? ordered[cursor++] : group
  ));
}

function reorderLiveGroupOrder(groupOrder, orderedKeys) {
  const current = arrayValue(groupOrder);
  const currentSet = new Set(current);
  if (!orderedKeys.every((key) => currentSet.has(key))) {
    const orderedSet = new Set(orderedKeys);
    return [...orderedKeys, ...current.filter((key) => !orderedSet.has(key))];
  }
  const orderedSet = new Set(orderedKeys);
  let cursor = 0;
  return current.map((key) => orderedSet.has(key) ? orderedKeys[cursor++] : key);
}

function removeTabOrderId(tabOrder, tabId) {
  return Object.fromEntries(Object.entries(recordValue(tabOrder)).map(([spaceId, groups]) => [
    spaceId,
    Object.fromEntries(Object.entries(recordValue(groups)).map(([groupId, ids]) => [
      groupId,
      arrayValue(ids).filter((id) => Number(id) !== tabId),
    ])),
  ]));
}

function replaceTabOrderId(tabOrder, fromId, toId) {
  return Object.fromEntries(Object.entries(recordValue(tabOrder)).map(([spaceId, groups]) => [
    spaceId,
    Object.fromEntries(Object.entries(recordValue(groups)).map(([groupId, ids]) => [
      groupId,
      [...new Set(arrayValue(ids).map((id) => Number(id) === fromId ? toId : id))],
    ])),
  ]));
}

function normalizeTrackingMode(value) {
  return value === 'saved-target' ? 'saved-target' : 'live';
}

function chromeEntityId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

function chromeGroupId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= -1 ? id : -1;
}

function nonNegativeIndex(value) {
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 ? index : 0;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function recordValue(value) {
  return isRecord(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function spaceExists(state, spaceId) {
  const spaces = arrayValue(state?.spaces);
  return spaces.length === 0 || spaces.some((space) => cleanText(space?.id) === spaceId);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
