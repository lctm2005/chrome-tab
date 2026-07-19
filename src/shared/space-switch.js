import { tabsForSpace } from './space-membership.js';
import { shouldAutoCloseTab } from './space-snapshot.js';

export const SPACE_SWITCH_PHASES = Object.freeze({
  MATERIALIZE_TARGET: 'materialize-target',
  ACTIVATE_TARGET: 'activate-target',
  CLOSE_SOURCE: 'close-source',
});

/**
 * Keeps the saved portion of a physical Chrome order authoritative while
 * retaining live-only entities in their current relative order.
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
 * A switch deliberately does not restore or activate any saved Tag or
 * TagGroup in the destination Space. The caller must first prepare and
 * activate one temporary New Tab, then it may safely close source tabs without
 * allowing Chrome to close the window (or the application on macOS).
 */
export function planSpaceSwitch(options) {
  const input = validateOptions(options);
  const membershipState = stateForMembership(input.state);
  const closeOptions = { fileSchemeAccess: input.fileSchemeAccess };
  const sourceClosableTabs = structuredClone(tabsForSpace(
    input.tabs,
    membershipState,
    input.sourceSpaceId,
  ).filter((tab) => (
    shouldAutoCloseTab(tab, closeOptions) ||
    hasRecoverableSavedTarget(tab, input, closeOptions)
  )));

  return {
    sourceSpaceId: input.sourceSpaceId,
    targetSpaceId: input.targetSpaceId,
    sourceClosableTabs,
    targetLiveTabs: [],
    restoreGroups: [],
    restoreGroupIndexes: [],
    skippedRows: [],
    reasons: {},
    needsFallback: true,
    executionOrder: [
      SPACE_SWITCH_PHASES.MATERIALIZE_TARGET,
      SPACE_SWITCH_PHASES.ACTIVATE_TARGET,
      SPACE_SWITCH_PHASES.CLOSE_SOURCE,
    ],
    phases: [
      {
        phase: SPACE_SWITCH_PHASES.MATERIALIZE_TARGET,
        required: true,
        mode: 'fallback-tab',
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
  validatedSnapshot(options.targetSnapshot, 'Target');
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
