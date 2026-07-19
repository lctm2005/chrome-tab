import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AST_UNION_COVERAGE_ENGINE,
  AST_UNION_COVERAGE_SCHEMA_VERSION,
  assertAstCoverageThresholds,
  createAstCoverageUnion,
  parseAstCoverageUnionArguments,
  reportAstCoverageUnionCliError,
  runAstCoverageUnionCli,
  runAstCoverageUnionCliIfMain,
} from '../scripts/e2e-coverage-union.mjs';
import { sha256Source } from '../scripts/coverage-gate.mjs';

const sourceHash = sha256Source('sidepanel source');
const unionScriptUrl = new URL('../scripts/e2e-coverage-union.mjs', import.meta.url);
const unionScriptPath = fileURLToPath(unionScriptUrl);

function metric(covered, total) {
  return {
    covered,
    total,
    percent: total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)),
  };
}

function uncoveredEntry(id, details = {}) {
  return { id, ...details };
}

function coverageFile(path, uncovered) {
  const totals = {
    statements: 4,
    branches: 4,
    functions: 2,
    lines: 4,
  };
  return {
    path,
    coverage: {
      statements: metric(totals.statements - uncovered.statements.length, totals.statements),
      branches: metric(totals.branches - uncovered.branches.length, totals.branches),
      functions: metric(totals.functions - uncovered.functions.length, totals.functions),
      lines: metric(totals.lines - uncovered.lines.length, totals.lines),
    },
    uncovered,
  };
}

function extensionReport(overrides = {}) {
  const file = coverageFile('sidepanel.js', {
    statements: [uncoveredEntry('statement:1', { location: { start: { line: 2 } } })],
    branches: [
      uncoveredEntry('branch:1:0', { type: 'if', line: 4 }),
      uncoveredEntry('branch:3:1', { type: 'cond-expr', line: 8 }),
    ],
    functions: [uncoveredEntry('function:1', { name: 'missed', line: 6 })],
    lines: [3],
  });
  return {
    schemaVersion: 2,
    engine: 'cdp-precise',
    generatedAt: '2026-07-16T01:00:00.000Z',
    complete: true,
    sourceHashAlgorithm: 'sha256',
    sourceHashes: { 'sidepanel.js': sourceHash },
    targets: { workbench: { startedBeforeExecution: true } },
    files: [file],
    ...overrides,
  };
}

function previewReport(overrides = {}) {
  const file = coverageFile('sidepanel.js', {
    statements: [uncoveredEntry('statement:2', { location: { start: { line: 5 } } })],
    branches: [uncoveredEntry('branch:3:1', { type: 'cond-expr', line: 8 })],
    functions: [uncoveredEntry('function:1', { name: 'missed', line: 6 })],
    lines: [4],
  });
  return {
    schemaVersion: 2,
    engine: 'cdp-precise',
    generatedAt: '2026-07-16T02:00:00.000Z',
    complete: true,
    startedBeforeExecution: true,
    sourceHashAlgorithm: 'sha256',
    sourceHashes: { 'sidepanel.js': sourceHash },
    files: [file],
    ...overrides,
  };
}

test('unions extension and preview AST coverage by intersecting stable uncovered IDs', () => {
  const report = createAstCoverageUnion(extensionReport(), previewReport(), {
    generatedAt: '2026-07-16T03:00:00.000Z',
    expectedSourceHashes: { 'sidepanel.js': sourceHash },
  });

  assert.equal(report.schemaVersion, AST_UNION_COVERAGE_SCHEMA_VERSION);
  assert.equal(report.engine, AST_UNION_COVERAGE_ENGINE);
  assert.equal(report.complete, true);
  assert.equal(report.generatedAt, '2026-07-16T03:00:00.000Z');
  assert.deepEqual(report.sourceHashes, { 'sidepanel.js': sourceHash });
  assert.deepEqual(report.coverage, {
    statements: metric(4, 4),
    branches: metric(3, 4),
    functions: metric(1, 2),
    lines: metric(4, 4),
  });
  assert.deepEqual(report.files[0].uncovered, {
    lines: [],
    statements: [],
    branches: [uncoveredEntry('branch:3:1', { type: 'cond-expr', line: 8 })],
    functions: [uncoveredEntry('function:1', { name: 'missed', line: 6 })],
  });
  assert.deepEqual(report.files[0].inputs.extension, extensionReport().files[0].coverage);
  assert.deepEqual(report.files[0].inputs.preview, previewReport().files[0].coverage);
});

test('aggregates selected files into exact per-file and total AST metrics', () => {
  const extension = extensionReport();
  const preview = previewReport();
  const secondHash = sha256Source('shared module source');
  extension.sourceHashes['src/shared/example.js'] = secondHash;
  preview.sourceHashes['src/shared/example.js'] = secondHash;
  extension.files.push(coverageFile('src/shared/example.js', {
    statements: [], branches: [], functions: [], lines: [],
  }));
  preview.files.push(coverageFile('src/shared/example.js', {
    statements: [], branches: [], functions: [], lines: [],
  }));

  const report = createAstCoverageUnion(extension, preview, {
    paths: ['sidepanel.js', 'src/shared/example.js'],
  });
  assert.deepEqual(report.files.map(({ path }) => path), [
    'sidepanel.js',
    'src/shared/example.js',
  ]);
  assert.deepEqual(report.coverage, {
    statements: metric(8, 8),
    branches: metric(7, 8),
    functions: metric(3, 4),
    lines: metric(8, 8),
  });
});

test('rejects incompatible precise-coverage inputs before calculating a union', async (t) => {
  const cases = [
    [
      'schema',
      () => [extensionReport({ schemaVersion: 1 }), previewReport()],
      /extension schemaVersion must be 2/i,
    ],
    [
      'missing schema',
      () => {
        const extension = extensionReport();
        delete extension.schemaVersion;
        return [extension, previewReport()];
      },
      /received \(missing\)/i,
    ],
    [
      'non-object input',
      () => [null, previewReport()],
      /extension report must be a JSON object/i,
    ],
    [
      'engine',
      () => [extensionReport(), previewReport({ engine: 'best-effort' })],
      /preview engine must be cdp-precise/i,
    ],
    [
      'incomplete',
      () => [extensionReport({ complete: false }), previewReport()],
      /extension coverage report is incomplete/i,
    ],
    [
      'late extension collection',
      () => {
        const extension = extensionReport();
        extension.targets.workbench.startedBeforeExecution = false;
        return [extension, previewReport()];
      },
      /extension precise coverage did not start before execution/i,
    ],
    [
      'late preview collection',
      () => [extensionReport(), previewReport({ startedBeforeExecution: false })],
      /preview precise coverage did not start before execution/i,
    ],
    [
      'target error',
      () => {
        const extension = extensionReport();
        extension.targets.workbench.error = 'detached';
        return [extension, previewReport()];
      },
      /extension coverage target reported an error: detached/i,
    ],
    [
      'hash algorithm',
      () => [extensionReport(), previewReport({ sourceHashAlgorithm: 'sha1' })],
      /preview sourceHashAlgorithm must be sha256/i,
    ],
    [
      'files is not an array',
      () => [extensionReport({ files: null }), previewReport()],
      /extension files must be an array/i,
    ],
    [
      'file missing path',
      () => {
        const extension = extensionReport();
        delete extension.files[0].path;
        return [extension, previewReport()];
      },
      /extension files\[0\] is missing path/i,
    ],
    [
      'duplicate file path',
      () => {
        const extension = extensionReport();
        extension.files.push(extension.files[0]);
        return [extension, previewReport()];
      },
      /extension files contains duplicate path sidepanel\.js/i,
    ],
    [
      'preview missing selected file',
      () => [extensionReport(), previewReport({ files: [] })],
      /preview report is missing AST coverage for sidepanel\.js/i,
    ],
    [
      'malformed hash',
      () => {
        const extension = extensionReport();
        extension.sourceHashes['sidepanel.js'] = 'not-a-hash';
        return [extension, previewReport()];
      },
      /extension source hash for sidepanel\.js is not a lowercase SHA-256 digest/i,
    ],
    [
      'different sidepanel source',
      () => {
        const preview = previewReport();
        preview.sourceHashes['sidepanel.js'] = sha256Source('different source');
        return [extensionReport(), preview];
      },
      /sidepanel\.js source SHA-256 differs/i,
    ],
    [
      'stale repository source',
      () => [extensionReport(), previewReport(), { expectedSourceHashes: {
        'sidepanel.js': sha256Source('new repository source'),
      } }],
      /does not match the expected repository source/i,
    ],
    [
      'different AST denominator',
      () => {
        const preview = previewReport();
        preview.files[0].coverage.branches = metric(3, 5);
        preview.files[0].uncovered.branches.push(uncoveredEntry('branch:4:0'));
        return [extensionReport(), preview];
      },
      /branches AST total differs.*\(4 !== 5\)/i,
    ],
    [
      'missing file AST metrics',
      () => {
        const extension = extensionReport();
        delete extension.files[0].coverage;
        return [extension, previewReport()];
      },
      /extension sidepanel\.js is missing AST coverage metrics/i,
    ],
    [
      'missing file uncovered object',
      () => {
        const extension = extensionReport();
        delete extension.files[0].uncovered;
        return [extension, previewReport()];
      },
      /extension sidepanel\.js is missing AST uncovered details/i,
    ],
    [
      'invalid metric',
      () => {
        const extension = extensionReport();
        extension.files[0].coverage.statements.percent = 99;
        return [extension, previewReport()];
      },
      /extension sidepanel\.js statements must contain valid covered\/total\/percent values/i,
    ],
    [
      'coverage and uncovered disagree',
      () => {
        const extension = extensionReport();
        extension.files[0].coverage.statements = metric(2, 4);
        return [extension, previewReport()];
      },
      /statements counts disagree with uncovered details/i,
    ],
    [
      'missing uncovered detail',
      () => {
        const preview = previewReport();
        delete preview.files[0].uncovered.functions;
        return [extensionReport(), preview];
      },
      /uncovered\.functions must be an array/i,
    ],
    [
      'invalid stable ID',
      () => {
        const preview = previewReport();
        preview.files[0].uncovered.statements[0].id = 'line:5';
        return [extensionReport(), preview];
      },
      /uncovered\.statements\[0\] has no valid stable ID/i,
    ],
    [
      'missing stable ID',
      () => {
        const preview = previewReport();
        delete preview.files[0].uncovered.statements[0].id;
        return [extensionReport(), preview];
      },
      /uncovered\.statements\[0\] has no valid stable ID/i,
    ],
    [
      'invalid uncovered line',
      () => {
        const preview = previewReport();
        preview.files[0].uncovered.lines[0] = 0;
        return [extensionReport(), preview];
      },
      /uncovered\.lines\[0\] has no valid stable ID/i,
    ],
    [
      'duplicate stable ID',
      () => {
        const preview = previewReport();
        preview.files[0].uncovered.functions.push(uncoveredEntry('function:1'));
        preview.files[0].coverage.functions = metric(0, 2);
        return [extensionReport(), preview];
      },
      /uncovered\.functions contains duplicate ID function:1/i,
    ],
  ];

  for (const [name, build, expectedError] of cases) {
    await t.test(name, () => {
      const [extension, preview, options] = build();
      assert.throws(
        () => createAstCoverageUnion(extension, preview, options),
        expectedError,
      );
    });
  }
});

test('rejects missing or duplicate selected paths and accepts expected hashes supplied as a Map', () => {
  assert.throws(
    () => createAstCoverageUnion(extensionReport(), previewReport(), { paths: [] }),
    /at least one AST coverage path is required/i,
  );
  assert.throws(
    () => createAstCoverageUnion(extensionReport(), previewReport(), { paths: [null] }),
    /at least one AST coverage path is required/i,
  );
  assert.throws(
    () => createAstCoverageUnion(extensionReport(), previewReport(), {
      paths: ['sidepanel.js', 'sidepanel.js'],
    }),
    /selected coverage paths contain duplicates: sidepanel\.js/i,
  );
  assert.equal(
    createAstCoverageUnion(extensionReport(), previewReport(), {
      expectedSourceHashes: new Map([['sidepanel.js', sourceHash]]),
    }).files[0].sourceHash,
    sourceHash,
  );
  assert.doesNotThrow(() => createAstCoverageUnion(extensionReport(), previewReport(), {
    expectedSourceHashes: new Map(),
  }));
  assert.doesNotThrow(() => createAstCoverageUnion(extensionReport(), previewReport(), {
    expectedSourceHashes: {},
  }));
});

test('preserves common uncovered details, null input timestamps, and zero-sized metrics', () => {
  const extension = extensionReport();
  const preview = previewReport();
  preview.files[0] = structuredClone(extension.files[0]);
  delete extension.generatedAt;
  delete preview.generatedAt;
  for (const report of [extension, preview]) {
    report.files[0].coverage.statements = metric(0, 0);
    report.files[0].uncovered.statements = [];
  }
  const union = createAstCoverageUnion(extension, preview);
  assert.deepEqual(union.coverage.statements, metric(0, 0));
  assert.deepEqual(union.files[0].uncovered.lines, [3]);
  assert.deepEqual(union.files[0].uncovered.functions, [
    uncoveredEntry('function:1', { name: 'missed', line: 6 }),
  ]);
  assert.equal(union.inputs.extension.generatedAt, null);
  assert.equal(union.inputs.preview.generatedAt, null);
  assert.throws(
    () => assertAstCoverageThresholds(union, {
      statements: 100,
      branches: 0,
      functions: 0,
      lines: 100,
    }, { perFile: false }),
    /sidepanel\.js:line:3/i,
  );
});

test('uses exact 100% thresholds by default and reports concrete uncovered IDs', () => {
  const report = createAstCoverageUnion(extensionReport(), previewReport());
  assert.throws(
    () => assertAstCoverageThresholds(report),
    (error) => {
      assert.match(error.message, /total branches coverage is 75% \(3\/4\), below 100%/i);
      assert.match(error.message, /sidepanel\.js:branch:3:1/i);
      assert.match(error.message, /total functions coverage is 50% \(1\/2\), below 100%/i);
      assert.match(error.message, /sidepanel\.js:function:1/i);
      assert.match(error.message, /sidepanel\.js branches coverage is 75%/i);
      return true;
    },
  );

  assert.deepEqual(
    assertAstCoverageThresholds(report, {
      statements: 100,
      branches: 75,
      functions: 50,
      lines: 100,
    }),
    {
      files: 1,
      thresholds: {
        statements: 100,
        branches: 75,
        functions: 50,
        lines: 100,
      },
      coverage: report.coverage,
    },
  );
  assert.throws(
    () => assertAstCoverageThresholds(report, { statements: 100 }),
    /branches coverage threshold must be between 0 and 100/i,
  );
  assert.throws(
    () => assertAstCoverageThresholds(report, null),
    /coverage thresholds must be a number or metric object/i,
  );
});

test('threshold gate rejects union totals or uncovered details that disagree with file results', async (t) => {
  await t.test('aggregate mismatch', () => {
    const report = createAstCoverageUnion(extensionReport(), previewReport());
    report.coverage.lines = metric(3, 4);
    assert.throws(
      () => assertAstCoverageThresholds(report, 0),
      /union total lines must equal file summaries \(4\/4\), received 3\/4/i,
    );
  });

  await t.test('uncovered mismatch', () => {
    const report = createAstCoverageUnion(extensionReport(), previewReport());
    report.files[0].uncovered.functions = [];
    assert.throws(
      () => assertAstCoverageThresholds(report, 0),
      /sidepanel\.js functions metric disagrees with uncovered details/i,
    );
  });

  const malformedCases = [
    ['non-object', null, /union report must be an object/i],
    ['schema', { ...createAstCoverageUnion(extensionReport(), previewReport()), schemaVersion: 0 }, /union schemaVersion must be 1/i],
    ['engine', { ...createAstCoverageUnion(extensionReport(), previewReport()), engine: 'other' }, /union engine must be cdp-precise-ast-union/i],
    ['incomplete', { ...createAstCoverageUnion(extensionReport(), previewReport()), complete: false }, /union report is incomplete/i],
    ['no files', { ...createAstCoverageUnion(extensionReport(), previewReport()), files: [] }, /union report has no files/i],
  ];
  for (const [name, report, expectedError] of malformedCases) {
    await t.test(name, () => {
      assert.throws(() => assertAstCoverageThresholds(report, 0), expectedError);
    });
  }

  await t.test('invalid aggregate metric', () => {
    const report = createAstCoverageUnion(extensionReport(), previewReport());
    report.coverage.statements.percent = -1;
    assert.throws(
      () => assertAstCoverageThresholds(report, 0),
      /union total statements metric is invalid/i,
    );
  });

  await t.test('invalid file shape and duplicate path', () => {
    const report = createAstCoverageUnion(extensionReport(), previewReport());
    const duplicate = structuredClone(report.files[0]);
    report.files.push(duplicate);
    report.files.push(structuredClone(duplicate));
    report.files[0].path = '';
    report.files[0].coverage.branches.percent = -1;
    delete report.files[0].uncovered.lines;
    report.files[0].uncovered.functions = [];
    assert.throws(
      () => assertAstCoverageThresholds(report, 0),
      (error) => {
        assert.match(error.message, /union file is missing path/i);
        assert.match(error.message, /\(unknown file\) branches metric is invalid/i);
        assert.match(error.message, /\(unknown file\) uncovered\.lines must be an array/i);
        assert.match(error.message, /\(unknown file\) functions metric disagrees with uncovered details/i);
        assert.match(error.message, /union files contains duplicate path sidepanel\.js/i);
        return true;
      },
    );
  });
});

test('threshold failures cap concrete uncovered examples at five entries', () => {
  const extension = extensionReport();
  const preview = previewReport();
  const missed = Array.from({ length: 5 }, (_, index) => uncoveredEntry(`statement:${index}`));
  for (const report of [extension, preview]) {
    report.files[0].coverage.statements = metric(1, 6);
    report.files[0].uncovered.statements = structuredClone(missed);
  }
  const union = createAstCoverageUnion(extension, preview);
  assert.throws(
    () => assertAstCoverageThresholds(union),
    (error) => {
      assert.match(error.message, /sidepanel\.js:statement:4/i);
      assert.doesNotMatch(error.message, /statement:5/i);
      return true;
    },
  );
});

test('parses exact-100 CLI defaults and per-metric threshold overrides', () => {
  assert.deepEqual(parseAstCoverageUnionArguments([]), {
    extension: 'coverage/e2e-extension-coverage.json',
    preview: 'coverage/e2e-preview-coverage.json',
    output: 'coverage/e2e-union-coverage.json',
    paths: ['sidepanel.js'],
    thresholds: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  });
  assert.deepEqual(parseAstCoverageUnionArguments([
    'extension.json',
    'preview.json',
    '--output', 'union.json',
    '--file', 'sidepanel.js',
    '--file', 'src/shared/example.js',
    '--min', '90',
    '--min-branches', '95.5',
  ]), {
    extension: 'extension.json',
    preview: 'preview.json',
    output: 'union.json',
    paths: ['sidepanel.js', 'src/shared/example.js'],
    thresholds: {
      statements: 90,
      branches: 95.5,
      functions: 90,
      lines: 90,
    },
  });
  assert.throws(
    () => parseAstCoverageUnionArguments(['--min-unknown', '90']),
    /unknown coverage metric option/i,
  );
  assert.throws(
    () => parseAstCoverageUnionArguments(['--min', '101']),
    /must be a number between 0 and 100/i,
  );
  assert.throws(
    () => parseAstCoverageUnionArguments(['--wat']),
    /unknown option: --wat/i,
  );
  assert.throws(
    () => parseAstCoverageUnionArguments(['one', 'two', 'three']),
    /expected at most extension and preview report paths/i,
  );
  assert.throws(
    () => parseAstCoverageUnionArguments(['--output', '--min', '90']),
    /--output requires a value/i,
  );
});

test('package scripts collect fresh Preview coverage and enforce explicit product union floors', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    packageJson.scripts['e2e:coverage:preview'],
    'E2E_COVERAGE=1 E2E_COVERAGE_OUTPUT=coverage/e2e-preview-coverage.json ' +
      'node --experimental-websocket scripts/e2e-smoke.mjs',
  );
  assert.equal(
    packageJson.scripts['verify:coverage:e2e:union'],
    'node scripts/e2e-coverage-union.mjs ' +
      '--min-statements 84.65 --min-branches 62.18 ' +
      '--min-functions 82.66 --min-lines 86.55',
  );
});

test('CLI writes the union artifact and applies configured thresholds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-tabs-coverage-union-'));
  try {
    const path = 'fixture.js';
    const source = 'export const covered = true;\n';
    const hash = sha256Source(source);
    const remap = (report) => {
      report.files[0].path = path;
      report.sourceHashes = { [path]: hash };
      return report;
    };
    await Promise.all([
      writeFile(join(directory, path), source),
      writeFile(join(directory, 'extension.json'), JSON.stringify(remap(extensionReport()))),
      writeFile(join(directory, 'preview.json'), JSON.stringify(remap(previewReport()))),
    ]);
    const messages = [];
    const result = await runAstCoverageUnionCli([
      'extension.json',
      'preview.json',
      '--file', path,
      '--output', 'reports/union.json',
      '--min', '50',
      '--min-statements', '100',
      '--min-lines', '100',
    ], {
      cwd: directory,
      writeOutput: (message) => messages.push(message),
    });

    assert.equal(result.outputPath, join(directory, 'reports/union.json'));
    assert.deepEqual(
      JSON.parse(await readFile(result.outputPath, 'utf8')),
      result.report,
    );
    assert.match(messages.join(''), /wrote .*reports\/union\.json/i);
    assert.match(
      messages.join(''),
      /passed: 1 file\(s\), statements 100%, branches 75%, functions 50%, lines 100%/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI defaults to the process cwd/output stream and formats caught errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-tabs-coverage-union-defaults-'));
  const previousCwd = process.cwd();
  const previousWrite = process.stdout.write;
  try {
    const source = 'export const covered = true;\n';
    const hash = sha256Source(source);
    const remap = (report) => {
      report.files[0].path = 'fixture.js';
      report.sourceHashes = { 'fixture.js': hash };
      return report;
    };
    await Promise.all([
      writeFile(join(directory, 'fixture.js'), source),
      writeFile(join(directory, 'extension.json'), JSON.stringify(remap(extensionReport()))),
      writeFile(join(directory, 'preview.json'), JSON.stringify(remap(previewReport()))),
    ]);
    const messages = [];
    process.chdir(directory);
    process.stdout.write = (message) => {
      messages.push(String(message));
      return true;
    };
    await runAstCoverageUnionCli([
      'extension.json', 'preview.json', '--file', 'fixture.js', '--min', '50',
    ]);
    assert.match(messages.join(''), /e2e-coverage-union.*passed/i);
  } finally {
    process.stdout.write = previousWrite;
    process.chdir(previousCwd);
    await rm(directory, { recursive: true, force: true });
  }

  const errors = [];
  const exitCodes = [];
  reportAstCoverageUnionCliError(new Error('broken report'), {
    writeError: (message) => errors.push(message),
    setExitCode: (value) => exitCodes.push(value),
  });
  reportAstCoverageUnionCliError('plain failure', {
    writeError: (message) => errors.push(message),
    setExitCode: (value) => exitCodes.push(value),
  });
  assert.deepEqual(exitCodes, [1, 1]);
  assert.match(errors[0], /broken report/i);
  assert.match(errors[1], /plain failure/i);

  const previousErrorWrite = process.stderr.write;
  const previousExitCode = process.exitCode;
  try {
    process.stderr.write = (message) => {
      errors.push(String(message));
      return true;
    };
    process.exitCode = undefined;
    reportAstCoverageUnionCliError(new Error('default handlers'));
    assert.equal(process.exitCode, 1);
    assert.match(errors.at(-1), /default handlers/i);
  } finally {
    process.stderr.write = previousErrorWrite;
    process.exitCode = previousExitCode;
  }
});

test('direct-execution adapter runs only for its own script and reports rejected CLI work', async () => {
  assert.equal(
    await runAstCoverageUnionCliIfMain(unionScriptUrl.href, []),
    null,
  );
  assert.equal(
    await runAstCoverageUnionCliIfMain(unionScriptUrl.href, ['node', '/tmp/not-this-script.js']),
    null,
  );

  const directory = await mkdtemp(join(tmpdir(), 'space-tabs-coverage-union-main-'));
  try {
    const source = 'export const covered = true;\n';
    const hash = sha256Source(source);
    const makeFullReport = (report) => {
      report.files[0].path = 'fixture.js';
      report.sourceHashes = { 'fixture.js': hash };
      for (const metricName of ['statements', 'branches', 'functions', 'lines']) {
        const total = report.files[0].coverage[metricName].total;
        report.files[0].coverage[metricName] = metric(total, total);
        report.files[0].uncovered[metricName] = [];
      }
      return report;
    };
    await Promise.all([
      writeFile(join(directory, 'fixture.js'), source),
      writeFile(join(directory, 'extension.json'), JSON.stringify(makeFullReport(extensionReport()))),
      writeFile(join(directory, 'preview.json'), JSON.stringify(makeFullReport(previewReport()))),
    ]);
    const output = [];
    const success = await runAstCoverageUnionCliIfMain(unionScriptUrl.href, [
      'node', unionScriptPath,
      'extension.json', 'preview.json', '--file', 'fixture.js', '--output', 'union.json',
    ], {
      cwd: directory,
      writeOutput: (message) => output.push(message),
    });
    assert.equal(success.report.coverage.branches.percent, 100);
    assert.match(output.join(''), /passed: 1 file/i);

    const errors = [];
    const exitCodes = [];
    const failure = await runAstCoverageUnionCliIfMain(unionScriptUrl.href, [
      'node', unionScriptPath, 'missing-extension.json', 'missing-preview.json',
    ], {
      cwd: directory,
      writeError: (message) => errors.push(message),
      setExitCode: (value) => exitCodes.push(value),
    });
    assert.equal(failure, null);
    assert.deepEqual(exitCodes, [1]);
    assert.match(errors.join(''), /ENOENT/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
