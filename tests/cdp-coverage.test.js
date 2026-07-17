import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCoverageTargetUrl,
  compressLineNumbers,
  createCoverageTargetUrlTracker,
  extensionRelativeScriptPath,
  summarizeLocalIstanbulCoverage,
  summarizeLocalPreciseCoverage,
} from '../scripts/cdp-coverage.mjs';

test('classifies empty and about URLs as transitional coverage targets', () => {
  const expected = 'chrome-extension://extension-id/sidepanel.html';
  assert.equal(classifyCoverageTargetUrl('', expected), 'pending');
  assert.equal(classifyCoverageTargetUrl('about:blank', expected), 'pending');
  assert.equal(classifyCoverageTargetUrl('about:blank#loading', expected), 'pending');
  assert.equal(classifyCoverageTargetUrl('about:srcdoc', expected), 'pending');
  assert.equal(classifyCoverageTargetUrl(expected, expected), 'match');
  assert.equal(classifyCoverageTargetUrl(`${expected}?layout=workbench`, expected), 'other');
  assert.equal(classifyCoverageTargetUrl('https://example.test/', expected), 'other');
});

test('tracks a Side Panel whose attached target URL is initially empty until later confirmation', () => {
  const expected = 'chrome-extension://extension-id/sidepanel.html';
  const tracker = createCoverageTargetUrlTracker(expected, {
    ignoredTargetIds: ['existing-blank'],
  });

  assert.deepEqual(tracker.attached({
    targetId: 'existing-blank',
    type: 'page',
    url: 'about:blank',
  }), { action: 'ignore', targetId: 'existing-blank' });
  assert.deepEqual(tracker.attached({
    targetId: 'panel-target',
    type: 'page',
    url: '',
  }), {
    action: 'instrument',
    targetId: 'panel-target',
    status: 'pending',
  });
  assert.deepEqual(tracker.observed('panel-target', 'about:blank'), {
    action: 'wait',
    targetId: 'panel-target',
    status: 'pending',
  });
  assert.deepEqual(tracker.attached({
    targetId: 'panel-target',
    type: 'page',
    url: 'about:blank',
  }), { action: 'ignore', targetId: 'panel-target' });
  assert.deepEqual(tracker.observed('panel-target', expected, 'other'), {
    action: 'confirm',
    targetId: 'panel-target',
    status: 'match',
  });
  assert.deepEqual(tracker.claim('panel-target'), {
    claimed: true,
    targetId: 'panel-target',
    rejectTargetIds: [],
  });
  assert.deepEqual(tracker.snapshot(), {
    closed: false,
    claimedTargetId: 'panel-target',
    candidates: [{
      targetId: 'panel-target',
      targetType: 'other',
      url: expected,
      status: 'match',
    }],
  });
});

test('rejects unrelated transitional targets and releases losing candidates after a claim', () => {
  const expected = 'chrome-extension://extension-id/sidepanel.html';
  const tracker = createCoverageTargetUrlTracker(expected);

  assert.equal(tracker.attached({
    targetId: 'unrelated',
    type: 'page',
    url: 'about:blank',
  }).action, 'instrument');
  assert.deepEqual(tracker.observed('unrelated', 'https://example.test/'), {
    action: 'reject',
    targetId: 'unrelated',
    status: 'other',
  });
  assert.equal(tracker.snapshot().candidates.length, 0);

  assert.equal(tracker.attached({ targetId: 'candidate-a', type: 'page', url: '' }).action, 'instrument');
  assert.equal(tracker.attached({ targetId: 'candidate-b', type: 'other', url: expected }).action, 'instrument');
  assert.deepEqual(tracker.claim('candidate-b'), {
    claimed: true,
    targetId: 'candidate-b',
    rejectTargetIds: ['candidate-a'],
  });
  assert.deepEqual(tracker.attached({
    targetId: 'late-worker',
    type: 'service_worker',
    url: expected,
  }), { action: 'ignore', targetId: 'late-worker' });
  assert.deepEqual(tracker.close(), []);
  assert.deepEqual(tracker.observed('candidate-b', expected), {
    action: 'ignore',
    targetId: 'candidate-b',
  });
});

test('compresses uncovered lines into deterministic inclusive ranges', () => {
  assert.deepEqual(compressLineNumbers([7, 3, 4, 4, 9, 10, 11, 0, 'bad']), [
    [3, 4],
    [7, 7],
    [9, 11],
  ]);
});

test('maps only JavaScript files from the active extension origin', () => {
  assert.equal(
    extensionRelativeScriptPath(
      'chrome-extension://abcdefghijklmnop/src/shared/ai.js?cache=1#fragment',
      'abcdefghijklmnop',
    ),
    'src/shared/ai.js',
  );
  assert.equal(extensionRelativeScriptPath('chrome-extension://other/background.js', 'abcdefghijklmnop'), '');
  assert.equal(extensionRelativeScriptPath('chrome-extension://abcdefghijklmnop/sidepanel.html', 'abcdefghijklmnop'), '');
  assert.equal(extensionRelativeScriptPath('VM123', 'abcdefghijklmnop'), '');
  assert.equal(extensionRelativeScriptPath('chrome-extension://abcdefghijklmnop/src/%2e%2e%2fsecret.js', 'abcdefghijklmnop'), '');
});

test('summarizes precise line and function coverage without counting comments or script roots', () => {
  const source = [
    '// fixture',
    'function used() {',
    '  return 1;',
    '}',
    'function missed() {',
    '  return 2;',
    '}',
    'used();',
    '/* trailing comment */',
    '',
  ].join('\n');
  const usedStart = source.indexOf('function used');
  const usedEnd = source.indexOf('\nfunction missed');
  const missedStart = source.indexOf('function missed');
  const missedEnd = source.indexOf('\nused();');

  const summary = summarizeLocalPreciseCoverage([{
    path: 'fixture.js',
    source,
    functions: [
      {
        functionName: '',
        ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
      },
      {
        functionName: 'used',
        ranges: [{ startOffset: usedStart, endOffset: usedEnd, count: 1 }],
      },
      {
        functionName: 'missed',
        ranges: [{ startOffset: missedStart, endOffset: missedEnd, count: 0 }],
      },
    ],
  }]);

  assert.deepEqual(summary.totals, {
    lines: { covered: 4, total: 7, percent: 57.14 },
    functions: { covered: 1, total: 2, percent: 50 },
  });
  assert.deepEqual(summary.files[0].lines.uncovered, [5, 6, 7]);
  assert.deepEqual(summary.files[0].functions.uncovered, [{ name: 'missed', line: 5 }]);
  assert.deepEqual(summary.files[0].functions.details, [
    {
      id: `${usedStart}:${usedEnd}`,
      name: 'used',
      line: 2,
      covered: true,
    },
    {
      id: `${missedStart}:${missedEnd}`,
      name: 'missed',
      line: 5,
      covered: false,
    },
  ]);
});

test('merges shared-module coverage from separate targets as a union', () => {
  const source = 'const callback = () => 1;\ncallback();\n';
  const callbackStart = source.indexOf('() =>');
  const callbackEnd = source.indexOf(';', callbackStart) + 1;
  const record = (count) => ({
    path: 'src/shared/example.js',
    source,
    functions: [
      {
        functionName: '',
        ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
      },
      {
        functionName: 'callback',
        ranges: [{ startOffset: callbackStart, endOffset: callbackEnd, count }],
      },
    ],
  });

  const summary = summarizeLocalPreciseCoverage([record(0), record(2)]);

  assert.deepEqual(summary.totals.functions, { covered: 1, total: 1, percent: 100 });
  assert.deepEqual(summary.files[0].functions.uncovered, []);
});

test('rejects merging coverage gathered from mismatched source snapshots', () => {
  assert.throws(() => summarizeLocalPreciseCoverage([
    { path: 'same.js', source: 'one();', functions: [] },
    { path: 'same.js', source: 'two();', functions: [] },
  ]), /different source snapshots/i);
});

test('uses the source AST for fixed statement and branch denominators and unions Chrome targets', async () => {
  const source = [
    'export function choose(value) {',
    "  if (value) return 'yes';",
    "  return 'no';",
    '}',
    'choose(globalThis.fixtureValue);',
  ].join('\n');
  const record = (uncoveredRange) => ({
    path: 'fixture.js',
    source,
    functions: [
      {
        functionName: '',
        ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
        isBlockCoverage: true,
      },
      {
        functionName: 'choose',
        ranges: [
          { startOffset: 7, endOffset: 75, count: 1 },
          { ...uncoveredRange, count: 0 },
        ],
        isBlockCoverage: true,
      },
    ],
  });

  const trueOnly = await summarizeLocalIstanbulCoverage([
    record({ startOffset: 58, endOffset: 74 }),
  ]);
  assert.deepEqual(trueOnly.totals, {
    statements: { covered: 3, total: 4, percent: 75 },
    branches: { covered: 1, total: 2, percent: 50 },
    functions: { covered: 1, total: 1, percent: 100 },
    lines: { covered: 2, total: 3, percent: 66.67 },
  });
  assert.deepEqual(trueOnly.files[0].uncovered.lines, [3]);
  assert.deepEqual(trueOnly.files[0].uncovered.functions, []);
  assert.deepEqual(
    trueOnly.files[0].uncovered.branches.map(({ type, line, index }) => ({ type, line, index })),
    [{ type: 'if', line: 2, index: 1 }],
  );

  const union = await summarizeLocalIstanbulCoverage([
    record({ startOffset: 58, endOffset: 74 }),
    record({ startOffset: 45, endOffset: 58 }),
  ]);
  for (const metric of Object.values(union.totals)) {
    assert.equal(metric.covered, metric.total);
    assert.equal(metric.percent, 100);
  }
  assert.deepEqual(union.files[0].uncovered, {
    lines: [],
    statements: [],
    functions: [],
    branches: [],
  });
});

test('AST coverage reports lazily nested functions even when V8 omits their function records', async () => {
  const source = [
    'function outer() {',
    '  return () => 1;',
    '}',
    'void outer;',
  ].join('\n');
  const summary = await summarizeLocalIstanbulCoverage([{
    path: 'lazy.js',
    source,
    functions: [{
      functionName: '',
      ranges: [
        { startOffset: 0, endOffset: source.length, count: 1 },
        { startOffset: 0, endOffset: source.indexOf('\nvoid'), count: 0 },
      ],
      isBlockCoverage: true,
    }],
  }]);

  assert.deepEqual(summary.files[0].functions, { covered: 0, total: 2, percent: 0 });
  assert.deepEqual(
    summary.files[0].uncovered.functions.map(({ name, line }) => ({ name, line })),
    [
      { name: 'outer', line: 1 },
      { name: '(anonymous_1)', line: 2 },
    ],
  );
});
