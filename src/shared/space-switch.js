import {
  markDormantTabsOpenInOtherWindows,
  tabsForSpace,
} from './space-membership.js';
import {
  isRestorableSnapshotTab,
  shouldAutoCloseTab,
} from './space-snapshot.js';

export const SPACE_SWITCH_PHASES = Object.freeze({
  MATERIALIZE_TARGET: 'materialize-target',
  ACTIVATE_TARGET: 'activate-target',
  CLOSE_SOURCE: 'close-source',
});

export const SPACE_SWITCH_SKIP_REASONS = Object.freeze({
  INVALID_URL: 'invalid-url',
  UNSUPPORTED_URL: 'unsupported-url',
  FILE_ACCESS_REQUIRED: 'file-scheme-access-required',
  OPEN_IN_OTHER_WINDOW: 'open-in-other-window',
});

/**
 * Keeps the saved portion of a physical Chrome order authoritative while
 * retaining live-only entities in their current relative order. Invalid and
 * duplicate ids are ignored so callers can safely project persisted order
 * over a freshly-read browser inventory.
 */
export function orderSpaceSwitchPhysicalIds(currentIds = [], preferredIds = []) {
  const current = uniqueChromeEntityIds(currentIds);
  const currentSet = new Set(current);
  const preferred = uniqueChromeEntityIds(preferredIds)
    .filter((id) => currentSet.has(id));
  const preferredSet = new Set(preferred);
  return [
    ...preferred,
    ...current.filter((id) => !preferredSet.has(id)),
  ];
}

/**
 * Produces a side-effect-free Space switch plan.
 *
 * The execution contract is deliberately part of the result: a caller must
 * materialize and activate the target before it may close source tabs. This
 * prevents a switch from temporarily leaving Chrome without an activatable
 * tab, which can close the browser window (or the application on macOS).
 */
export function planSpaceSwitch(options) {
  const input = validateOptions(options);
  const membershipState = stateForMembership(input.state);
  const closeOptions = { fileSchemeAccess: input.fileSchemeAccess };
  const sourceClosableTabs = clone(tabsForSpace(
    input.tabs,
    membershipState,
    input.sourceSpaceId,
  ).filter((tab) => (
    shouldAutoCloseTab(tab, closeOptions) ||
    hasRecoverableSavedTarget(tab, input, closeOptions)
  )));
  const rawTargetLiveTabs = tabsForSpace(
    input.tabs,
    membershipState,
    input.targetSpaceId,
  );
  const localClaims = planLocalTargetSnapshotClaims(
    input,
    membershipState,
    rawTargetLiveTabs,
  );
  const targetLiveTabs = localClaims.tabs;
  const targetHasLiveTabs = targetLiveTabs.length > 0;
  const restoration = planSnapshotRestoration(
    input,
    membershipState,
    localClaims,
  );
  const restoreGroups = restoration.groups;
  const restoreGroupIndexes = restoration.groupIndexes;
  const skippedRows = restoration.skippedRows;
  const needsFallback = !targetHasLiveTabs && restoreGroups.length === 0;
  const materializationMode = restoreGroups.length > 0
    ? targetHasLiveTabs ? 'snapshot-partial' : 'snapshot'
    : targetHasLiveTabs ? 'existing-live-tabs' : 'fallback-tab';

  return {
    sourceSpaceId: input.sourceSpaceId,
    targetSpaceId: input.targetSpaceId,
    sourceClosableTabs,
    targetLiveTabs,
    restoreGroups,
    restoreGroupIndexes,
    skippedRows,
    reasons: countSkipReasons(skippedRows),
    needsFallback,
    executionOrder: [
      SPACE_SWITCH_PHASES.MATERIALIZE_TARGET,
      SPACE_SWITCH_PHASES.ACTIVATE_TARGET,
      SPACE_SWITCH_PHASES.CLOSE_SOURCE,
    ],
    phases: [
      {
        phase: SPACE_SWITCH_PHASES.MATERIALIZE_TARGET,
        required: restoreGroups.length > 0 || needsFallback,
        mode: materializationMode,
      },
      {
        phase: SPACE_SWITCH_PHASES.ACTIVATE_TARGET,
        required: true,
        after: SPACE_SWITCH_PHASES.MATERIALIZE_TARGET,
      },
      {
        phase: SPACE_SWITCH_PHASES.CLOSE_SOURCE,
        required: sourceClosableTabs.length > 0,
        after: SPACE_SWITCH_PHASES.ACTIVATE_TARGET,
      },
    ],
    sourceClosePrecondition: 'target-activated',
  };
}

function planSnapshotRestoration(input, state, localClaims) {
  const foreignMarkedGroups = markDormantTabsOpenInOtherWindows(
    localClaims.markedGroups,
    tabsWithLifecycleIdentity(input.foreignLiveTabs, state),
    state,
    input.targetSpaceId,
  );
  const groups = [];
  const groupIndexes = [];
  const skippedRows = [];
  const snapshotGroups = Array.isArray(input.targetSnapshot?.groups)
    ? input.targetSnapshot.groups
    : [];

  for (let groupIndex = 0; groupIndex < snapshotGroups.length; groupIndex += 1) {
    const sourceGroup = recordValue(snapshotGroups[groupIndex]);
    const sourceRows = Array.isArray(sourceGroup.tabs) ? sourceGroup.tabs : [];
    const restoredRows = [];

    for (let tabIndex = 0; tabIndex < sourceRows.length; tabIndex += 1) {
      const row = sourceRows[tabIndex];
      if (localClaims.rowKeys.has(snapshotRowKey(groupIndex, tabIndex))) continue;
      const reason = snapshotRowSkipReason(
        row,
        input.fileSchemeAccess,
        isForeignWindowMarker(foreignMarkedGroups[groupIndex]?.tabs?.[tabIndex]),
      );
      if (reason) {
        skippedRows.push(skippedSnapshotRow(sourceGroup, row, groupIndex, tabIndex, reason));
      } else {
        restoredRows.push(clone(row));
      }
    }

    if (restoredRows.length > 0) {
      const restoredGroup = clone(sourceGroup);
      restoredGroup.tabs = restoredRows;
      groups.push(restoredGroup);
      groupIndexes.push(groupIndex);
    }
  }

  return { groups, groupIndexes, skippedRows };
}

function planLocalTargetSnapshotClaims(input, state, targetLiveTabs) {
  const markedGroups = markDormantTabsOpenInOtherWindows(
    snapshotGroupsForMatching(input.targetSnapshot),
    tabsWithLifecycleIdentity(targetLiveTabs, state),
    state,
    input.targetSpaceId,
  );
  const identitiesByTabId = new Map();
  const rowKeys = new Set();
  for (let groupIndex = 0; groupIndex < markedGroups.length; groupIndex += 1) {
    const group = recordValue(markedGroups[groupIndex]);
    const rows = group.tabs;
    for (let tabIndex = 0; tabIndex < rows.length; tabIndex += 1) {
      const row = recordValue(rows[tabIndex]);
      if (!isForeignWindowMarker(row)) continue;
      identitiesByTabId.set(row.foreignWindowTabId, {
        snapshotTabId: String(row.snapshotTabId || '').trim(),
        snapshotGroupId: String(group.snapshotGroupId || row.snapshotGroupId || '').trim(),
      });
      rowKeys.add(snapshotRowKey(groupIndex, tabIndex));
    }
  }
  return {
    tabs: targetLiveTabs.map((tab) => {
      const result = clone(tab);
      const identity = identitiesByTabId.get(tab.id);
      if (!identity) return result;
      if (identity.snapshotTabId) result.snapshotTabId = identity.snapshotTabId;
      else delete result.snapshotTabId;
      if (identity.snapshotGroupId) result.snapshotGroupId = identity.snapshotGroupId;
      else delete result.snapshotGroupId;
      return result;
    }),
    markedGroups,
    rowKeys,
  };
}

function snapshotGroupsForMatching(snapshot) {
  return (Array.isArray(snapshot?.groups) ? snapshot.groups : []).map((group) => {
    const result = clone(recordValue(group));
    result.tabs = (Array.isArray(recordValue(group).tabs) ? recordValue(group).tabs : [])
      .map((row) => {
        const cleanRow = clone(recordValue(row));
        delete cleanRow.foreignWindowTabId;
        delete cleanRow.foreignWindowId;
        return cleanRow;
      });
    return result;
  });
}

function tabsWithLifecycleIdentity(liveTabs, state) {
  return liveTabs.map((tab) => {
    const binding = currentLifecycleBinding(state, tab?.id);
    if (!binding) return tab;
    return {
      ...tab,
      snapshotTabId: String(tab?.snapshotTabId || binding.snapshotTabId || '').trim(),
      snapshotGroupId: String(tab?.snapshotGroupId || binding.snapshotGroupId || '').trim(),
    };
  });
}

function snapshotRowKey(groupIndex, tabIndex) {
  return `${groupIndex}:${tabIndex}`;
}

function snapshotRowSkipReason(row, fileSchemeAccess, openInForeignWindow) {
  if (!isRestorableSnapshotTab(recordValue(row))) return invalidUrl(row?.url)
    ? SPACE_SWITCH_SKIP_REASONS.INVALID_URL
    : SPACE_SWITCH_SKIP_REASONS.UNSUPPORTED_URL;
  if (!shouldAutoCloseTab({ ...recordValue(row), pinned: false }, { fileSchemeAccess })) {
    return SPACE_SWITCH_SKIP_REASONS.FILE_ACCESS_REQUIRED;
  }
  if (openInForeignWindow) {
    return SPACE_SWITCH_SKIP_REASONS.OPEN_IN_OTHER_WINDOW;
  }
  return '';
}

function hasRecoverableSavedTarget(tab, input, closeOptions) {
  if (tab?.pinned) return false;
  const binding = currentLifecycleBinding(input.state, tab?.id);
  if (
    !binding ||
    binding.trackingMode !== 'saved-target' ||
    String(binding.spaceId || '').trim() !== input.sourceSpaceId
  ) return false;
  const snapshotTabId = String(binding.snapshotTabId || '').trim();
  if (!snapshotTabId) return false;
  const snapshotGroupId = String(binding.snapshotGroupId || '').trim();
  const candidates = [];
  for (const group of Array.isArray(input.sourceSnapshot?.groups)
    ? input.sourceSnapshot.groups
    : []) {
    const sourceGroup = recordValue(group);
    const groupSnapshotId = String(sourceGroup.snapshotGroupId || '').trim();
    for (const row of Array.isArray(sourceGroup.tabs) ? sourceGroup.tabs : []) {
      if (String(row?.snapshotTabId || '').trim() !== snapshotTabId) continue;
      const rowGroupId = String(row?.snapshotGroupId || groupSnapshotId || '').trim();
      if (snapshotGroupId && rowGroupId !== snapshotGroupId) continue;
      candidates.push(recordValue(row));
    }
  }
  return candidates.length === 1 && shouldAutoCloseTab(
    { ...candidates[0], pinned: false },
    closeOptions,
  );
}

function currentLifecycleBinding(state, tabId) {
  const binding = state?.tabLifecycle?.[tabId];
  if (!recordValueOrNull(binding)) return null;
  if (
    binding.sessionId &&
    state?.browserSessionId &&
    binding.sessionId !== state.browserSessionId
  ) return null;
  return binding;
}

function isForeignWindowMarker(tab) {
  return Number.isSafeInteger(tab?.foreignWindowTabId) && tab.foreignWindowTabId >= 0;
}

function skippedSnapshotRow(group, row, groupIndex, tabIndex, reason) {
  const { tabs: _tabs, ...groupMetadata } = group;
  return {
    reason,
    groupIndex,
    tabIndex,
    group: clone(groupMetadata),
    row: clone(row),
  };
}

function countSkipReasons(skippedRows) {
  const reasons = {};
  for (const skipped of skippedRows) {
    reasons[skipped.reason] = (reasons[skipped.reason] || 0) + 1;
  }
  return reasons;
}

function invalidUrl(value) {
  try {
    new URL(String(value || '').trim());
    return false;
  } catch {
    return true;
  }
}

function stateForMembership(state) {
  return {
    ...state,
    groupSpaces: recordValue(state.groupSpaces),
    tabSpaces: recordValue(state.tabSpaces),
  };
}

function validateOptions(options) {
  if (!recordValueOrNull(options)) throw new TypeError('Space switch options must be an object.');
  if (!Array.isArray(options.tabs)) throw new TypeError('Space switch tabs must be an array.');
  if (!recordValueOrNull(options.state)) throw new TypeError('Space switch state must be an object.');
  const sourceSpaceId = requiredSpaceId(options.sourceSpaceId, 'sourceSpaceId');
  const targetSpaceId = requiredSpaceId(options.targetSpaceId, 'targetSpaceId');
  if (sourceSpaceId === targetSpaceId) {
    throw new TypeError('Source and target Spaces must be different.');
  }
  const sourceSnapshot = validatedSnapshot(options.sourceSnapshot, 'Source');
  const targetSnapshot = validatedSnapshot(options.targetSnapshot, 'Target');
  const foreignLiveTabs = options.foreignLiveTabs ?? [];
  if (!Array.isArray(foreignLiveTabs)) {
    throw new TypeError('Foreign live tabs must be an array.');
  }
  const fileSchemeAccess = options.fileSchemeAccess ?? false;
  if (typeof fileSchemeAccess !== 'boolean') {
    throw new TypeError('fileSchemeAccess must be a boolean.');
  }
  return {
    tabs: options.tabs,
    state: options.state,
    sourceSpaceId,
    targetSpaceId,
    sourceSnapshot,
    targetSnapshot,
    foreignLiveTabs,
    fileSchemeAccess,
  };
}

function validatedSnapshot(value, label) {
  const snapshot = value ?? null;
  if (snapshot !== null && !recordValueOrNull(snapshot)) {
    throw new TypeError(`${label} snapshot must be an object or null.`);
  }
  if (snapshot?.groups != null && !Array.isArray(snapshot.groups)) {
    throw new TypeError(`${label} snapshot groups must be an array.`);
  }
  return snapshot;
}

function requiredSpaceId(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function recordValue(value) {
  return recordValueOrNull(value) ? value : {};
}

function recordValueOrNull(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function uniqueChromeEntityIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
