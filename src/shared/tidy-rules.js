/**
 * Registry of the organizing rules behind the single Tidy action.
 *
 * Two rule kinds exist:
 * - `script` rules run deterministically in the panel (duplicate Tag merging,
 *   duplicate-URL closing, domain grouping) without any provider round trip.
 * - `prompt` rules contribute an editable instruction template to the AI
 *   request. Templates may reference `{{placeholders}}` that the panel fills
 *   with script-computed facts; output-shape and completeness constraints are
 *   deliberately NOT configurable because the parsers depend on them.
 *
 * The registry is static because MV3 forbids loading external scripts.
 */
export const TIDY_RULES = Object.freeze([
  Object.freeze({
    id: 'dedupe-tags',
    kind: 'script',
    label: 'Merge duplicate Tags',
    description: 'Tags whose names normalize to the same value merge into one; saved pages are kept.',
    defaultEnabled: true,
    locked: true,
  }),
  Object.freeze({
    id: 'dedupe-urls',
    kind: 'script',
    label: 'Close duplicate tabs',
    description: 'When several open tabs share one URL, keep only the newest and close the rest.',
    defaultEnabled: false,
  }),
  Object.freeze({
    id: 'group-by-topic',
    kind: 'prompt',
    label: 'Group by topic (AI)',
    description: 'The provider clusters tabs into topic buckets. Requires configured AI.',
    defaultEnabled: true,
  }),
  Object.freeze({
    id: 'group-by-domain',
    kind: 'script',
    label: 'Group by domain (local)',
    description: 'A local rule buckets tabs by website domain. No tab metadata is sent anywhere.',
    defaultEnabled: false,
  }),
  Object.freeze({
    id: 'rename-tabs',
    kind: 'prompt',
    label: 'Rename tabs (AI)',
    description: 'The provider proposes compact panel-only names. Requires configured AI.',
    defaultEnabled: true,
  }),
]);

export const DEFAULT_TIDY_RULE_PROMPTS = Object.freeze({
  'group-by-topic': Object.freeze(
    'Group browser tabs into concise topic or work buckets. Use page titles first and treat URLs only as supporting context. Tabs about the same subject belong together even when their domains differ.',
  ),
  'rename-tabs': Object.freeze(
    'Rename browser tabs for a compact sidebar using page titles and headings first, then URLs only as supporting context. Prefer short recognizable app, project, or task names over raw domains.',
  ),
});

const TIDY_RULE_IDS = new Set(TIDY_RULES.map((rule) => rule.id));

/**
 * Merges stored rule settings with the registry defaults. Unknown rule ids and
 * unknown text keys are dropped so stale settings never resurrect rules.
 */
export function normalizeTidyRuleSettings(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const storedEnabled = source.enabled && typeof source.enabled === 'object' ? source.enabled : {};
  const storedTexts = source.texts && typeof source.texts === 'object' ? source.texts : {};
  const enabled = {};
  const texts = {};
  for (const rule of TIDY_RULES) {
    enabled[rule.id] = Object.hasOwn(storedEnabled, rule.id)
      ? storedEnabled[rule.id] === true
      : rule.defaultEnabled;
  }
  for (const [ruleId, text] of Object.entries(storedTexts)) {
    if (!TIDY_RULE_IDS.has(ruleId)) continue;
    const clean = String(text || '').trim();
    if (clean) texts[ruleId] = clean;
  }
  return { enabled, texts };
}

export function tidyRuleEnabled(settings, ruleId) {
  const normalized = normalizeTidyRuleSettings(settings);
  return normalized.enabled[ruleId] === true;
}

export function tidyRulePrompt(settings, ruleId) {
  const normalized = normalizeTidyRuleSettings(settings);
  if (Object.hasOwn(normalized.texts, ruleId)) return normalized.texts[ruleId];
  return DEFAULT_TIDY_RULE_PROMPTS[ruleId] || '';
}

/**
 * Fills `{{placeholder}}` tokens with script-computed facts. Unknown tokens
 * stay verbatim so a typo is visible to the user instead of vanishing.
 */
export function renderTidyRuleTemplate(template = '', placeholders = {}) {
  const source = String(template || '');
  if (!source) return '';
  return source.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (token, key) => {
    const value = placeholders[key];
    return value === undefined || value === null ? token : String(value);
  });
}
