import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLcovReport,
  runtimeJavaScriptForSuite,
  verifyExactLcovCoverage,
} from '../scripts/node-coverage-gate.mjs';
import { RUNTIME_FILES } from '../scripts/release-files.mjs';

const completeReport = `TN:
SF:src/shared/one.js
FN:1,one
FNDA:1,one
FNF:1
FNH:1
DA:1,1
DA:2,3
LF:2
LH:2
BRDA:1,0,0,1
BRDA:1,0,1,2
BRF:2
BRH:2
end_of_record
SF:src/shared/empty-branches.js
FN:1,two
FNDA:4,two
FNF:1
FNH:1
DA:1,1
LF:1
LH:1
BRF:0
BRH:0
end_of_record
`;

test('shared Node coverage scope is derived from every released shared runtime module', () => {
  assert.deepEqual(
    runtimeJavaScriptForSuite('shared'),
    RUNTIME_FILES.filter((path) => path.startsWith('src/shared/') && path.endsWith('.js')).sort(),
  );
  assert.deepEqual(runtimeJavaScriptForSuite('background'), ['background.js']);
  assert.throws(() => runtimeJavaScriptForSuite('unknown'), /Unknown Node coverage suite/u);
});

test('parses LCOV records and verifies exact file, line, branch, and function coverage', () => {
  assert.deepEqual(parseLcovReport(completeReport), [
    {
      path: 'src/shared/one.js',
      coverage: {
        lines: { covered: 2, total: 2, percent: 100 },
        branches: { covered: 2, total: 2, percent: 100 },
        functions: { covered: 1, total: 1, percent: 100 },
      },
    },
    {
      path: 'src/shared/empty-branches.js',
      coverage: {
        lines: { covered: 1, total: 1, percent: 100 },
        branches: { covered: 0, total: 0, percent: 100 },
        functions: { covered: 1, total: 1, percent: 100 },
      },
    },
  ]);
  assert.deepEqual(
    verifyExactLcovCoverage(completeReport, [
      'src/shared/empty-branches.js',
      './src/shared/one.js',
      'src/shared/one.js',
    ]),
    {
      files: 2,
      coverage: {
        lines: { covered: 3, total: 3, percent: 100 },
        branches: { covered: 2, total: 2, percent: 100 },
        functions: { covered: 2, total: 2, percent: 100 },
      },
    },
  );
});

test('normalizes absolute and Windows-style source paths to repository-relative paths', () => {
  const cwd = '/repo';
  const absolute = completeReport
    .replace('SF:src/shared/one.js', 'SF:/repo/src/shared/one.js')
    .replace('SF:src/shared/empty-branches.js', 'SF:src\\shared\\empty-branches.js');
  assert.deepEqual(
    parseLcovReport(absolute, { cwd }).map((file) => file.path),
    ['src/shared/one.js', 'src/shared/empty-branches.js'],
  );
});

test('rejects missing, unexpected, duplicate, and empty Node coverage scopes', async (t) => {
  await t.test('missing', () => {
    assert.throws(
      () => verifyExactLcovCoverage(completeReport, [
        'src/shared/one.js',
        'src/shared/empty-branches.js',
        'src/shared/missing.js',
      ]),
      /missing: src\/shared\/missing\.js/u,
    );
  });
  await t.test('unexpected', () => {
    assert.throws(
      () => verifyExactLcovCoverage(completeReport, ['src/shared/one.js']),
      /unexpected: src\/shared\/empty-branches\.js/u,
    );
  });
  await t.test('duplicate', () => {
    assert.throws(
      () => verifyExactLcovCoverage(`${completeReport}${completeReport}`, [
        'src/shared/one.js',
        'src/shared/empty-branches.js',
      ]),
      /repeats files/u,
    );
  });
  await t.test('empty expected', () => {
    assert.throws(() => verifyExactLcovCoverage(completeReport, []), /no expected files/u);
  });
  await t.test('empty report', () => {
    assert.throws(() => parseLcovReport('TN:\n'), /no source records/u);
  });
});

test('rejects uncovered metrics and malformed or inconsistent LCOV summaries', async (t) => {
  await t.test('uncovered line', () => {
    const report = completeReport.replace('DA:2,3', 'DA:2,0').replace('LH:2', 'LH:1');
    assert.throws(
      () => verifyExactLcovCoverage(report, ['src/shared/one.js', 'src/shared/empty-branches.js']),
      /one\.js does not have exact 100% lines coverage \(1\/2\)/u,
    );
  });
  await t.test('uncovered branch', () => {
    const report = completeReport.replace('BRDA:1,0,1,2', 'BRDA:1,0,1,-').replace('BRH:2', 'BRH:1');
    assert.throws(
      () => verifyExactLcovCoverage(report, ['src/shared/one.js', 'src/shared/empty-branches.js']),
      /one\.js does not have exact 100% branches coverage/u,
    );
  });
  await t.test('uncovered function', () => {
    const report = completeReport.replace('FNDA:1,one', 'FNDA:0,one').replace('FNH:1', 'FNH:0');
    assert.throws(
      () => verifyExactLcovCoverage(report, ['src/shared/one.js', 'src/shared/empty-branches.js']),
      /one\.js does not have exact 100% functions coverage/u,
    );
  });
  await t.test('summary mismatch', () => {
    assert.throws(() => parseLcovReport(completeReport.replace('LH:2', 'LH:1')), /summary is inconsistent/u);
  });
  await t.test('missing summary', () => {
    assert.throws(() => parseLcovReport(completeReport.replace('LF:2\n', '')), /missing LF/u);
  });
  await t.test('duplicate summary', () => {
    assert.throws(() => parseLcovReport(completeReport.replace('LF:2', 'LF:2\nLF:2')), /repeats LF/u);
  });
  await t.test('hit exceeds total', () => {
    assert.throws(() => parseLcovReport(completeReport.replace('LF:2', 'LF:1')), /hits exceed/u);
  });
  await t.test('invalid hit count', () => {
    assert.throws(() => parseLcovReport(completeReport.replace('DA:2,3', 'DA:2,nope')), /invalid hit count/u);
  });
  await t.test('missing source path', () => {
    assert.throws(() => parseLcovReport('SF:\nLF:0\nLH:0\nBRF:0\nBRH:0\nFNF:0\nFNH:0\nend_of_record\n'), /missing an SF/u);
  });
});
