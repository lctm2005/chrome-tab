import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPreciseCoverageReport,
  expectedRuntimeJavaScriptPaths,
  hashRuntimeJavaScriptSources,
  sha256Source,
} from '../scripts/coverage-gate.mjs';
import { RUNTIME_FILES } from '../scripts/release-files.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePaths = ['background.js', 'sidepanel.js'];

function metric(covered = 1, total = 1) {
  return {
    covered,
    total,
    percent: total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)),
  };
}

function fileSummary(path) {
  return {
    path,
    lines: metric(),
    functions: metric(),
  };
}

function validReport(paths = fixturePaths) {
  const files = paths.map(fileSummary);
  const sourceHashes = Object.fromEntries(
    paths.map((path) => [path, sha256Source(`source:${path}`)]),
  );
  return {
    schemaVersion: 2,
    engine: 'cdp-precise',
    generatedAt: '2026-07-16T00:00:00.000Z',
    complete: true,
    sourceHashAlgorithm: 'sha256',
    sourceHashes,
    targets: {
      background: {
        entryPath: 'background.js',
        startedBeforeExecution: true,
        entryFile: fileSummary('background.js'),
        totals: { lines: metric(), functions: metric() },
        files: [fileSummary('background.js')],
      },
      workbench: {
        entryPath: 'sidepanel.js',
        startedBeforeExecution: true,
        entryFile: fileSummary('sidepanel.js'),
        totals: { lines: metric(), functions: metric() },
        files: [fileSummary('sidepanel.js')],
      },
      sidepanel: {
        entryPath: 'sidepanel.js',
        startedBeforeExecution: true,
        entryFile: fileSummary('sidepanel.js'),
        totals: { lines: metric(), functions: metric() },
        files: [fileSummary('sidepanel.js')],
      },
    },
    totals: {
      lines: metric(paths.length, paths.length),
      functions: metric(paths.length, paths.length),
    },
    files,
  };
}

function gateOptions(paths = fixturePaths) {
  return {
    expectedPaths: paths,
    expectedSourceHashes: Object.fromEntries(
      paths.map((path) => [path, sha256Source(`source:${path}`)]),
    ),
  };
}

test('derives the exact JavaScript coverage scope from the release runtime allowlist', () => {
  const expected = RUNTIME_FILES.filter((path) => path.endsWith('.js')).sort();
  assert.deepEqual(expectedRuntimeJavaScriptPaths(), expected);
  assert.deepEqual(
    expectedRuntimeJavaScriptPaths(['z.js', 'asset.css', 'z.js', 'a.js']),
    ['a.js', 'z.js'],
  );
  assert.ok(expected.includes('background.js'));
  assert.ok(expected.includes('sidepanel.js'));
  assert.ok(!expected.includes('config.local.js'));
});

test('hashes the exact source bytes used by the runtime gate', async () => {
  const source = await readFile(resolve(repositoryRoot, 'background.js'));
  assert.deepEqual(
    await hashRuntimeJavaScriptSources(repositoryRoot, ['background.js']),
    { 'background.js': sha256Source(source) },
  );
  assert.equal(
    sha256Source('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('accepts a complete, source-matched report with exact scope and early coverage', () => {
  const result = assertPreciseCoverageReport(validReport(), gateOptions());
  assert.deepEqual(result, {
    schemaVersion: 2,
    engine: 'cdp-precise',
    files: 2,
    targets: 3,
    totals: {
      lines: metric(2, 2),
      functions: metric(2, 2),
    },
  });
});

test('rejects reports from an unsupported schema or coverage engine', async (t) => {
  await t.test('schema', () => {
    const report = validReport();
    report.schemaVersion = 1;
    assert.throws(
      () => assertPreciseCoverageReport(report, gateOptions()),
      /schemaVersion must be 2/i,
    );
  });

  await t.test('engine', () => {
    const report = validReport();
    report.engine = 'best-effort';
    assert.throws(
      () => assertPreciseCoverageReport(report, gateOptions()),
      /engine must be cdp-precise/i,
    );
  });
});

test('rejects incomplete, failed, late, or missing required targets', async (t) => {
  const cases = [
    ['incomplete report', (report) => { report.complete = false; }, /report is incomplete/i],
    [
      'late background coverage',
      (report) => { report.targets.background.startedBeforeExecution = false; },
      /background did not start precise coverage before execution/i,
    ],
    [
      'late Side Panel coverage',
      (report) => { report.targets.sidepanel.startedBeforeExecution = false; },
      /sidepanel did not start precise coverage before execution/i,
    ],
    [
      'target collection error',
      (report) => { report.targets.workbench.error = 'detached'; },
      /workbench reported an error: detached/i,
    ],
    [
      'missing target',
      (report) => { delete report.targets.workbench; },
      /required target workbench is missing/i,
    ],
    [
      'missing real Side Panel target',
      (report) => { delete report.targets.sidepanel; },
      /required target sidepanel is missing/i,
    ],
    [
      'wrong entry target',
      (report) => { report.targets.workbench.entryPath = 'other.js'; },
      /entryPath must be sidepanel\.js/i,
    ],
  ];

  for (const [name, mutate, expectedError] of cases) {
    await t.test(name, () => {
      const report = validReport();
      mutate(report);
      assert.throws(() => assertPreciseCoverageReport(report, gateOptions()), expectedError);
    });
  }
});

test('rejects missing, unexpected, and duplicate runtime JavaScript coverage', async (t) => {
  await t.test('missing file', () => {
    const report = validReport();
    report.files.pop();
    assert.throws(
      () => assertPreciseCoverageReport(report, gateOptions()),
      /runtime JavaScript coverage is missing: sidepanel\.js/i,
    );
  });

  await t.test('unexpected file', () => {
    const report = validReport();
    report.files.push(fileSummary('debug-only.js'));
    assert.throws(
      () => assertPreciseCoverageReport(report, gateOptions()),
      /runtime JavaScript coverage has unexpected files: debug-only\.js/i,
    );
  });

  await t.test('duplicate file', () => {
    const report = validReport();
    report.files.push(fileSummary('background.js'));
    assert.throws(
      () => assertPreciseCoverageReport(report, gateOptions()),
      /files contains duplicate path background\.js/i,
    );
  });
});

test('rejects missing, unexpected, malformed, and stale source hashes', async (t) => {
  const cases = [
    [
      'missing hash',
      (report) => { delete report.sourceHashes['sidepanel.js']; },
      /source hashes is missing: sidepanel\.js/i,
    ],
    [
      'unexpected hash',
      (report) => { report.sourceHashes['debug-only.js'] = sha256Source('debug'); },
      /source hashes has unexpected files: debug-only\.js/i,
    ],
    [
      'malformed hash',
      (report) => { report.sourceHashes['background.js'] = 'not-a-hash'; },
      /not a lowercase SHA-256 digest/i,
    ],
    [
      'stale hash',
      (report) => { report.sourceHashes['background.js'] = sha256Source('stale'); },
      /coverage was collected from different code/i,
    ],
    [
      'wrong algorithm',
      (report) => { report.sourceHashAlgorithm = 'sha1'; },
      /sourceHashAlgorithm must be sha256/i,
    ],
  ];

  for (const [name, mutate, expectedError] of cases) {
    await t.test(name, () => {
      const report = validReport();
      mutate(report);
      assert.throws(() => assertPreciseCoverageReport(report, gateOptions()), expectedError);
    });
  }
});

test('rejects internally inconsistent coverage counts and percentages', async (t) => {
  await t.test('file percentage', () => {
    const report = validReport();
    report.files[0].lines.percent = 99;
    assert.throws(
      () => assertPreciseCoverageReport(report, gateOptions()),
      /files\.background\.js\.lines\.percent must be 100/i,
    );
  });

  await t.test('aggregate count', () => {
    const report = validReport();
    report.totals.lines = metric(1, 2);
    assert.throws(
      () => assertPreciseCoverageReport(report, gateOptions()),
      /totals\.lines must equal the sum of file summaries \(2\/2\)/i,
    );
  });
});
