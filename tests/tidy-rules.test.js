import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TIDY_RULE_PROMPTS,
  TIDY_RULES,
  normalizeTidyRuleSettings,
  renderTidyRuleTemplate,
  tidyRuleEnabled,
  tidyRulePrompt,
} from '../src/shared/tidy-rules.js';
import { mergeStoredState, STORAGE_KEY } from '../src/shared/state.js';

test('the tidy rule registry keeps script rules deterministic and prompt rules editable', () => {
  const ids = TIDY_RULES.map((rule) => rule.id);
  assert.deepEqual(ids, [
    'dedupe-tags',
    'dedupe-urls',
    'group-by-topic',
    'group-by-domain',
    'rename-tabs',
  ]);
  for (const rule of TIDY_RULES) {
    assert.ok(rule.label, rule.id);
    assert.ok(['script', 'prompt'].includes(rule.kind), rule.id);
    assert.equal(typeof rule.defaultEnabled, 'boolean', rule.id);
  }
  assert.equal(TIDY_RULES.find((rule) => rule.id === 'dedupe-tags').locked, true);
  assert.deepEqual(
    Object.keys(DEFAULT_TIDY_RULE_PROMPTS).sort(),
    ['group-by-topic', 'rename-tabs'],
  );
});

test('normalizeTidyRuleSettings merges stored overrides with defaults and drops unknown rules', () => {
  assert.deepEqual(normalizeTidyRuleSettings(null), {
    enabled: {
      'dedupe-tags': true,
      'dedupe-urls': false,
      'group-by-topic': true,
      'group-by-domain': false,
      'rename-tabs': true,
    },
    texts: {},
  });

  const stored = {
    enabled: { 'dedupe-urls': true, 'group-by-topic': false, 'made-up-rule': true },
    texts: { 'group-by-topic': '  Group by {{domains}}.  ', 'legacy-rule': 'gone' },
  };
  const normalized = normalizeTidyRuleSettings(stored);
  assert.equal(normalized.enabled['dedupe-urls'], true);
  assert.equal(normalized.enabled['group-by-topic'], false);
  assert.equal(normalized.enabled['made-up-rule'], undefined);
  assert.equal(normalized.texts['group-by-topic'], 'Group by {{domains}}.');
  assert.equal(normalized.texts['legacy-rule'], undefined);
});

test('tidyRuleEnabled resolves stored overrides and locked defaults', () => {
  const settings = normalizeTidyRuleSettings({ enabled: { 'dedupe-urls': true, 'rename-tabs': false } });
  assert.equal(tidyRuleEnabled(settings, 'dedupe-tags'), true);
  assert.equal(tidyRuleEnabled(settings, 'dedupe-urls'), true);
  assert.equal(tidyRuleEnabled(settings, 'group-by-topic'), true);
  assert.equal(tidyRuleEnabled(settings, 'rename-tabs'), false);
  assert.equal(tidyRuleEnabled(settings, 'made-up-rule'), false);
});

test('tidyRulePrompt falls back to the default template and trims stored overrides', () => {
  const settings = normalizeTidyRuleSettings({ texts: { 'rename-tabs': '  Short names only.  ' } });
  assert.equal(tidyRulePrompt(settings, 'rename-tabs'), 'Short names only.');
  assert.equal(
    tidyRulePrompt(settings, 'group-by-topic'),
    DEFAULT_TIDY_RULE_PROMPTS['group-by-topic'],
  );
  assert.equal(tidyRulePrompt(settings, 'dedupe-urls'), '');
});

test('renderTidyRuleTemplate replaces placeholders and keeps unknown tokens intact', () => {
  assert.equal(
    renderTidyRuleTemplate('Group {{domains}} with {{existingGroups}} for {{language}}.', {
      domains: 'github.com, mail.google.com',
      existingGroups: 'Docs, Plans',
      language: 'Simplified Chinese',
    }),
    'Group github.com, mail.google.com with Docs, Plans for Simplified Chinese.',
  );
  assert.equal(
    renderTidyRuleTemplate('Keep {{unknownToken}} and {{tabs}}.', { tabs: '[1]' }),
    'Keep {{unknownToken}} and [1].',
  );
  assert.equal(renderTidyRuleTemplate('', {}), '');
});

test('stored workspace state keeps tidy rule settings across the schema boundary', () => {
  const restored = mergeStoredState({
    version: 12,
    tidyRules: { enabled: { 'dedupe-urls': true }, texts: { 'rename-tabs': ' Compact names. ' } },
  });
  assert.equal(restored.tidyRules.enabled['dedupe-urls'], true);
  assert.equal(restored.tidyRules.enabled['group-by-topic'], true);
  assert.equal(restored.tidyRules.texts['rename-tabs'], 'Compact names.');

  const legacy = mergeStoredState({ version: 11 });
  assert.equal(legacy.tidyRules.enabled['dedupe-tags'], true);
  assert.deepEqual(legacy.tidyRules.texts, {});
});
