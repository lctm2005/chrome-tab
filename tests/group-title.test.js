import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHROME_GROUP_TITLE_MAX_LENGTH,
  chromeGroupTitle,
  chromeGroupTitleKey,
  groupTitleKey,
  legacyChromeGroupTitleKey,
  normalizeGroupTitle,
  resolveChromeGroupTitleMatch,
} from '../src/shared/group-title.js';

test('normalizes logical titles and keeps empty identity keys empty', () => {
  assert.equal(normalizeGroupTitle('  Project   Plan  '), 'Project Plan');
  assert.equal(normalizeGroupTitle('', 'Group'), 'Group');
  assert.equal(normalizeGroupTitle('', ''), 'Tabs');
  assert.equal(normalizeGroupTitle('', '   '), 'Tabs');
  assert.equal(groupTitleKey('  Project   PLAN  '), 'project plan');
  assert.equal(groupTitleKey(), '');
  assert.equal(chromeGroupTitle('', 'Group'), 'Group');
  assert.equal(chromeGroupTitleKey(), '');
  assert.equal(chromeGroupTitleKey('', 'Group'), 'group');
  assert.equal(chromeGroupTitleKey('Project'), 'project');
  assert.equal(legacyChromeGroupTitleKey(), '');
  assert.equal(legacyChromeGroupTitleKey(`${'x'.repeat(32)}A`), 'x'.repeat(32));
});

test('keeps 31 and 32-unit titles intact and gives longer titles stable identities', () => {
  const title31 = 'a'.repeat(31);
  const title32 = 'b'.repeat(32);
  const longTitle = `${'c'.repeat(32)}A`;

  assert.equal(chromeGroupTitle(title31), title31);
  assert.equal(chromeGroupTitle(title32), title32);
  assert.equal(chromeGroupTitle(longTitle), chromeGroupTitle(longTitle));
  assert.ok(chromeGroupTitle(longTitle).length <= CHROME_GROUP_TITLE_MAX_LENGTH);
  assert.match(chromeGroupTitle(longTitle), /~[0-9a-f]{8}$/);
});

test('does not collide for long ASCII or Chinese titles with the same visible prefix', () => {
  const asciiPrefix = 'x'.repeat(32);
  const chinesePrefix = '资料'.repeat(16);

  assert.notEqual(chromeGroupTitle(`${asciiPrefix}A`), chromeGroupTitle(`${asciiPrefix}B`));
  assert.notEqual(chromeGroupTitle(`${chinesePrefix}甲`), chromeGroupTitle(`${chinesePrefix}乙`));
});

test('never ends a compact title with half of an emoji surrogate pair', () => {
  const compact = chromeGroupTitle(`${'😀'.repeat(15)}a😀`);
  const malformedHigh = chromeGroupTitle(`${'x'.repeat(31)}\uD83D`);
  const malformedLow = chromeGroupTitle(`\uDE00${'x'.repeat(31)}`);

  assert.ok(compact.length <= CHROME_GROUP_TITLE_MAX_LENGTH);
  assert.doesNotMatch(compact, /[\uD800-\uDBFF]$/);
  assert.equal(malformedHigh, `${'x'.repeat(31)}\uFFFD`);
  assert.equal(malformedLow, `\uFFFD${'x'.repeat(31)}`);
});

test('repeatedly resolves one saved long title to its existing Chrome group', () => {
  const logicalTitle = `${'Research '.repeat(5)}Roadmap`;
  const group = { id: 7, title: chromeGroupTitle(logicalTitle), color: 'blue' };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const match = resolveChromeGroupTitleMatch([group], logicalTitle, [logicalTitle]);
    assert.equal(match?.group, group);
    assert.equal(match?.needsRename, false);
  }
});

test('resolves same-prefix saved titles to distinct Chrome groups', () => {
  const prefix = 'Shared project title prefix '.padEnd(32, 'x');
  const firstTitle = `${prefix}A`;
  const secondTitle = `${prefix}B`;
  const firstGroup = { id: 1, title: chromeGroupTitle(firstTitle) };
  const secondGroup = { id: 2, title: chromeGroupTitle(secondTitle) };
  const logicalTitles = [firstTitle, secondTitle];

  assert.equal(
    resolveChromeGroupTitleMatch([firstGroup, secondGroup], firstTitle, logicalTitles)?.group.id,
    1,
  );
  assert.equal(
    resolveChromeGroupTitleMatch([firstGroup, secondGroup], secondTitle, logicalTitles)?.group.id,
    2,
  );
});

test('migrates an old truncated title only when its logical owner is unambiguous', () => {
  const prefix = 'l'.repeat(32);
  const firstTitle = `${prefix}A`;
  const secondTitle = `${prefix}B`;
  const legacyGroup = { id: 4, title: prefix };

  const uniqueMatch = resolveChromeGroupTitleMatch([legacyGroup], firstTitle, [firstTitle]);
  assert.equal(uniqueMatch?.group, legacyGroup);
  assert.equal(uniqueMatch?.needsRename, true);
  assert.equal(groupTitleKey(uniqueMatch?.expectedTitle), groupTitleKey(chromeGroupTitle(firstTitle)));

  assert.equal(
    resolveChromeGroupTitleMatch([legacyGroup], firstTitle, [firstTitle, secondTitle]),
    null,
    'a shared legacy prefix cannot safely identify either logical group',
  );
});

test('refuses missing or ambiguous matches without multiplying canonical duplicates', () => {
  const shortTitle = 'Research';
  const longTitle = `${'m'.repeat(32)}A`;
  const legacyTitle = longTitle.slice(0, 32);
  const canonicalTitle = chromeGroupTitle(longTitle);

  assert.equal(resolveChromeGroupTitleMatch([], ''), null);
  assert.equal(resolveChromeGroupTitleMatch(), null);
  assert.equal(resolveChromeGroupTitleMatch([], shortTitle), null);
  assert.equal(resolveChromeGroupTitleMatch([
    { id: 1, title: canonicalTitle },
    { id: 2, title: canonicalTitle },
  ], longTitle)?.group.id, 1);
  assert.equal(resolveChromeGroupTitleMatch([
    { id: 1, title: canonicalTitle },
  ], longTitle, [longTitle, canonicalTitle]), null);
  assert.equal(resolveChromeGroupTitleMatch([], longTitle), null);
  assert.equal(resolveChromeGroupTitleMatch(null, longTitle, null), null);
  assert.equal(resolveChromeGroupTitleMatch([
    { id: 1, title: legacyTitle },
    { id: 2, title: legacyTitle },
  ], longTitle, [longTitle]), null);
  assert.equal(resolveChromeGroupTitleMatch([{}], longTitle, [longTitle]), null);
  assert.equal(resolveChromeGroupTitleMatch(
    [{ id: 3, title: legacyTitle }],
    longTitle,
    [longTitle, 'Short', `${'different'.repeat(5)} title`, null],
  )?.group.id, 3);
  assert.equal(resolveChromeGroupTitleMatch(
    [{ id: 4, title: legacyTitle }],
    longTitle,
    [longTitle, legacyTitle],
  ), null);
});
