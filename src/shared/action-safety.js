import { normalizeAIProviderSettings } from './ai-providers.js';
import {
  mergeShortcuts,
  normalizeShortcut,
  SHORTCUT_ACTIONS,
} from './shortcuts.js';

const ARC_IMPORT_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const SETTINGS_BASELINE_VERSION = 1;
const RENAME_TARGET_REVIEW_VERSION = 1;

export const EDITABLE_SHORTCUT_IDS = Object.freeze(
  SHORTCUT_ACTIONS
    .map((action) => action.id)
    .filter((actionId) => actionId !== 'togglePanel'),
);

export function resolveOperationUndoTarget(history = [], expectedOperationId = '') {
  const operationId = cleanText(expectedOperationId);
  if (!operationId) return { status: 'missing', operation: null };
  const matches = (Array.isArray(history) ? history : [])
    .filter((operation) => cleanText(operation?.id) === operationId);
  if (matches.length === 0) return { status: 'missing', operation: null };
  if (matches.length > 1) return { status: 'ambiguous', operation: null };
  const [operation] = matches;
  if (operation.status === 'undone') return { status: 'undone', operation };
  if (operation.status !== 'applied') return { status: 'unavailable', operation };
  return { status: 'ready', operation };
}

export function normalizeArcImportToken(value) {
  const token = cleanText(value);
  return ARC_IMPORT_TOKEN_PATTERN.test(token) ? token : '';
}

export function arcImportRecordIdentity(record = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return '';
  const spaceIds = uniqueStrings(record.spaceIds).sort();
  if (spaceIds.length === 0) return '';
  const storedFingerprints = record.afterFingerprints &&
    typeof record.afterFingerprints === 'object' &&
    !Array.isArray(record.afterFingerprints)
    ? record.afterFingerprints
    : {};
  const afterFingerprints = spaceIds.map((spaceId) => [
    spaceId,
    cleanText(storedFingerprints[spaceId]),
  ]);
  return JSON.stringify({
    token: normalizeArcImportToken(record.token),
    importedAt: finiteNumber(record.importedAt),
    spaceIds,
    afterFingerprints,
  });
}

export function sameArcImportRecord(left, right) {
  const leftIdentity = arcImportRecordIdentity(left);
  return Boolean(leftIdentity && leftIdentity === arcImportRecordIdentity(right));
}

export function captureSettingsBaseline(settings = {}) {
  const value = objectValue(settings);
  const ai = normalizeEditableAI(value.ai);
  const shortcuts = mergeShortcuts(value.shortcuts);
  return {
    version: SETTINGS_BASELINE_VERSION,
    aiScope: editableAIScope(ai),
    language: ai.language,
    theme: cleanText(value.theme) || 'purple',
    shortcuts: Object.fromEntries(EDITABLE_SHORTCUT_IDS.map((actionId) => [
      actionId,
      normalizeShortcut(shortcuts[actionId]),
    ])),
    auth: aiAuthTarget(ai),
  };
}

export function mergeConcurrentSettings({ baseline, draft, latest } = {}) {
  const currentValue = objectValue(latest);
  const current = captureSettingsBaseline(currentValue);
  const hasValidBaseline = validSettingsBaseline(baseline);
  const before = hasValidBaseline
    ? normalizeSettingsBaseline(baseline)
    : current;
  const submitted = hasValidBaseline ? captureSettingsBaseline(draft) : current;
  const conflicts = hasValidBaseline ? [] : ['baseline'];
  const userChanged = [];

  const aiScope = mergeConcurrentField(
    'ai',
    before.aiScope,
    submitted.aiScope,
    current.aiScope,
    conflicts,
    userChanged,
  );
  const language = mergeConcurrentField(
    'language',
    before.language,
    submitted.language,
    current.language,
    conflicts,
    userChanged,
  );
  const theme = mergeConcurrentField(
    'theme',
    before.theme,
    submitted.theme,
    current.theme,
    conflicts,
    userChanged,
  );
  const currentShortcuts = mergeShortcuts(currentValue.shortcuts);
  for (const actionId of EDITABLE_SHORTCUT_IDS) {
    currentShortcuts[actionId] = mergeConcurrentField(
      `shortcut:${actionId}`,
      before.shortcuts[actionId],
      submitted.shortcuts[actionId],
      current.shortcuts[actionId],
      conflicts,
      userChanged,
    );
  }

  return {
    conflicts,
    userChanged,
    settings: {
      ai: {
        ...objectValue(currentValue.ai),
        ...aiScope,
        language,
      },
      theme,
      shortcuts: currentShortcuts,
    },
  };
}

export function canPreserveUnconfiguredSettingsAI(settings = {}, userChanged = []) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.hasOwn(settings, 'ai')) {
    return false;
  }
  const normalized = normalizeEditableAI(settings);
  const changedFields = new Set(Array.isArray(userChanged) ? userChanged : []);
  return !changedFields.has('ai') &&
    !normalized.baseUrl &&
    !normalized.model &&
    !normalized.apiKey;
}

export function captureAIAuthTarget(ai = {}) {
  return aiAuthTarget(normalizeEditableAI(ai));
}

export function sameAIAuthTarget(expected, currentAI) {
  const target = normalizeAIAuthTarget(expected);
  return Boolean(
    target.apiKey &&
    valuesEqual(target, captureAIAuthTarget(currentAI)),
  );
}

/**
 * Captures the user-visible target of an open rename dialog.
 *
 * A rename is intentionally a compare-and-set operation: another panel may
 * rename the same Space or tab while this dialog is still open. The later
 * submission must not silently overwrite that newer name. Space reviews also
 * retain the icon because a Space rename updates both fields. Tab reviews bind
 * the stable Chrome row and its explicit panel name, while ignoring ordinary
 * page-title changes that do not conflict with a manual rename.
 */
export function renameTargetReviewFingerprint(kind, target = {}, options = {}) {
  if (kind === 'space') {
    const id = cleanText(target?.id);
    if (!id) return '';
    return JSON.stringify({
      version: RENAME_TARGET_REVIEW_VERSION,
      kind,
      id,
      name: cleanText(target?.name),
      icon: cleanText(target?.icon),
    });
  }

  if (kind !== 'tab') return '';
  const id = Number(target?.id);
  if (!Number.isSafeInteger(id) || id < 0) return '';
  const renamedTabs = objectValue(options?.renamedTabs);
  const panelTitle = cleanText(Object.hasOwn(renamedTabs, id)
    ? renamedTabs[id]
    : target?.panelTitle);
  return JSON.stringify({
    version: RENAME_TARGET_REVIEW_VERSION,
    kind,
    id,
    url: String(target?.url || ''),
    snapshotTabId: cleanText(target?.snapshotTabId),
    sessionId: cleanText(target?.sessionId),
    pinned: Boolean(target?.pinned),
    panelTitle,
  });
}

export function reviewedRenameTargetIsCurrent(
  reviewedFingerprint,
  kind,
  target = {},
  options = {},
) {
  const currentFingerprint = renameTargetReviewFingerprint(kind, target, options);
  return Boolean(
    typeof reviewedFingerprint === 'string' &&
    reviewedFingerprint &&
    currentFingerprint &&
    reviewedFingerprint === currentFingerprint
  );
}

function normalizeEditableAI(ai = {}) {
  const normalized = normalizeAIProviderSettings(objectValue(ai));
  return {
    ...normalized,
    provider: cleanText(normalized.provider),
    baseUrl: cleanText(normalized.baseUrl),
    model: cleanText(normalized.model),
    thinking: normalized.thinking === 'enabled' ? 'enabled' : 'disabled',
    apiKey: cleanText(normalized.apiKey),
    language: cleanText(normalized.language) || 'zh-CN',
  };
}

function editableAIScope(ai) {
  return {
    provider: ai.provider,
    baseUrl: ai.baseUrl,
    model: ai.model,
    thinking: ai.thinking,
    apiKey: ai.apiKey,
  };
}

function aiAuthTarget(ai) {
  return {
    provider: ai.provider,
    baseUrl: ai.baseUrl,
    apiKey: ai.apiKey,
  };
}

function normalizeAIAuthTarget(value) {
  const target = objectValue(value);
  return aiAuthTarget(normalizeEditableAI(target));
}

function validSettingsBaseline(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) &&
    value.version === SETTINGS_BASELINE_VERSION &&
    value.aiScope && typeof value.aiScope === 'object' &&
    value.shortcuts && typeof value.shortcuts === 'object',
  );
}

function normalizeSettingsBaseline(value) {
  const aiScope = editableAIScope(normalizeEditableAI(value.aiScope));
  const shortcuts = mergeShortcuts(value.shortcuts);
  return {
    version: SETTINGS_BASELINE_VERSION,
    aiScope,
    language: cleanText(value.language) || 'zh-CN',
    theme: cleanText(value.theme) || 'purple',
    shortcuts: Object.fromEntries(EDITABLE_SHORTCUT_IDS.map((actionId) => [
      actionId,
      normalizeShortcut(shortcuts[actionId]),
    ])),
    auth: normalizeAIAuthTarget(value.auth),
  };
}

function mergeConcurrentField(
  key,
  before,
  submitted,
  current,
  conflicts,
  userChanged,
) {
  const changedByUser = !valuesEqual(submitted, before);
  const changedElsewhere = !valuesEqual(current, before);
  if (changedByUser) userChanged.push(key);
  if (changedByUser && changedElsewhere) {
    conflicts.push(key);
    return cloneValue(current);
  }
  return cloneValue(changedByUser ? submitted : current);
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneValue(value) {
  return value && typeof value === 'object' ? structuredClone(value) : value;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(cleanText)
    .filter(Boolean))];
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanText(value) {
  return String(value || '').trim();
}
