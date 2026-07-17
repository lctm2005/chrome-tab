import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUNTIME_FILES } from './release-files.mjs';

const repositoryRoot = normalize(dirname(dirname(fileURLToPath(import.meta.url))));
const metricFields = Object.freeze({
  lines: ['LF', 'LH'],
  branches: ['BRF', 'BRH'],
  functions: ['FNF', 'FNH'],
});

export function runtimeJavaScriptForSuite(suite) {
  if (suite === 'background') return ['background.js'];
  if (suite === 'shared') {
    return RUNTIME_FILES
      .filter((path) => path.startsWith('src/shared/') && path.endsWith('.js'))
      .sort();
  }
  throw new Error(`Unknown Node coverage suite: ${suite}.`);
}

export function parseLcovReport(source, options = {}) {
  const cwd = normalize(options.cwd || repositoryRoot);
  const files = [];
  let record = null;

  const finishRecord = () => {
    if (!record) return;
    if (!record.path) throw new Error('LCOV record is missing an SF source path.');
    for (const [metric, [foundKey, hitKey]] of Object.entries(metricFields)) {
      const found = requiredCount(record.summary, foundKey, record.path);
      const hit = requiredCount(record.summary, hitKey, record.path);
      if (hit > found) {
        throw new Error(`LCOV ${metric} hits exceed the denominator for ${record.path}.`);
      }
      const observed = observedMetric(record, metric);
      if (observed.total !== found || observed.covered !== hit) {
        throw new Error(
          `LCOV ${metric} summary is inconsistent for ${record.path}: ` +
          `summary ${hit}/${found}, records ${observed.covered}/${observed.total}.`,
        );
      }
      record.coverage[metric] = observed;
    }
    files.push({ path: record.path, coverage: record.coverage });
    record = null;
  };

  for (const rawLine of String(source || '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line === 'TN:') continue;
    if (line.startsWith('SF:')) {
      finishRecord();
      const sourcePath = line.slice(3);
      record = {
        path: normalizeCoveragePath(sourcePath, cwd),
        summary: new Map(),
        lines: [],
        branches: [],
        functions: [],
        coverage: {},
      };
      continue;
    }
    if (line === 'end_of_record') {
      finishRecord();
      continue;
    }
    if (!record) continue;

    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (['LF', 'LH', 'BRF', 'BRH', 'FNF', 'FNH'].includes(key)) {
      if (record.summary.has(key)) {
        throw new Error(`LCOV record repeats ${key} for ${record.path}.`);
      }
      record.summary.set(key, value);
    } else if (key === 'DA') {
      const [, count] = value.split(',');
      record.lines.push(coverageHit(count));
    } else if (key === 'BRDA') {
      const parts = value.split(',');
      record.branches.push(coverageHit(parts[3]));
    } else if (key === 'FNDA') {
      const separatorIndex = value.indexOf(',');
      record.functions.push(coverageHit(separatorIndex < 0 ? '' : value.slice(0, separatorIndex)));
    }
  }
  finishRecord();
  if (!files.length) throw new Error('LCOV report contains no source records.');
  return files;
}

export function verifyExactLcovCoverage(source, expectedFiles, options = {}) {
  const files = parseLcovReport(source, options);
  const expected = [...new Set((expectedFiles || []).map(normalizeExpectedPath))].sort();
  if (!expected.length) throw new Error('Node coverage gate has no expected files.');

  const actual = files.map((file) => file.path);
  const duplicates = actual.filter((path, index) => actual.indexOf(path) !== index);
  if (duplicates.length) {
    throw new Error(`Node coverage report repeats files: ${[...new Set(duplicates)].sort().join(', ')}.`);
  }
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((path) => !actualSet.has(path));
  const unexpected = actual.filter((path) => !expectedSet.has(path)).sort();
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      unexpected.length ? `unexpected: ${unexpected.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Node coverage scope mismatch (${details}).`);
  }

  for (const file of files) {
    for (const [metric, counts] of Object.entries(file.coverage)) {
      if (counts.covered !== counts.total) {
        throw new Error(
          `${file.path} does not have exact 100% ${metric} coverage ` +
          `(${counts.covered}/${counts.total}).`,
        );
      }
    }
  }

  return {
    files: files.length,
    coverage: aggregateCoverage(files),
  };
}

export async function runNodeCoverageSuite(suite, options = {}) {
  const cwd = normalize(options.cwd || repositoryRoot);
  const expectedFiles = runtimeJavaScriptForSuite(suite);
  const testFiles = suite === 'background'
    ? ['tests/background.test.js']
    : (await readdir(`${cwd}/tests`))
      .filter((name) => name.endsWith('.test.js'))
      .sort()
      .map((name) => `tests/${name}`);
  const include = suite === 'background' ? 'background.js' : 'src/shared/*.js';
  const args = [
    '--test-reporter=lcov',
    '--experimental-test-coverage',
    `--test-coverage-include=${include}`,
    '--test-coverage-lines=100',
    '--test-coverage-branches=100',
    '--test-coverage-functions=100',
    '--test',
    ...testFiles,
  ];
  const result = await spawnAndCapture(process.execPath, args, cwd);
  if (result.code !== 0) {
    const diagnostic = [result.stderr.trim(), tail(result.stdout, 80)].filter(Boolean).join('\n');
    throw new Error(`Node ${suite} coverage run failed with exit code ${result.code}.${diagnostic ? `\n${diagnostic}` : ''}`);
  }
  return verifyExactLcovCoverage(result.stdout, expectedFiles, { cwd });
}

function observedMetric(record, metric) {
  const entries = record[metric];
  return {
    covered: entries.filter(Boolean).length,
    total: entries.length,
    percent: entries.length ? Number(((entries.filter(Boolean).length / entries.length) * 100).toFixed(2)) : 100,
  };
}

function aggregateCoverage(files) {
  return Object.fromEntries(Object.keys(metricFields).map((metric) => {
    const total = files.reduce((sum, file) => sum + file.coverage[metric].total, 0);
    const covered = files.reduce((sum, file) => sum + file.coverage[metric].covered, 0);
    return [metric, {
      covered,
      total,
      percent: total ? Number(((covered / total) * 100).toFixed(2)) : 100,
    }];
  }));
}

function normalizeCoveragePath(path, cwd) {
  const sourcePath = String(path || '').trim();
  if (!sourcePath) return '';
  const normalized = normalize(sourcePath);
  const local = isAbsolute(normalized) ? relative(cwd, normalized) : normalized;
  return normalizeExpectedPath(local);
}

function normalizeExpectedPath(path) {
  return String(path || '').replaceAll('\\', '/').replace(/^\.\//u, '');
}

function requiredCount(summary, key, path) {
  const raw = summary.get(key);
  if (!/^\d+$/u.test(String(raw ?? ''))) {
    throw new Error(`LCOV record has an invalid or missing ${key} count for ${path}.`);
  }
  return Number(raw);
}

function coverageHit(value) {
  if (value === '-' || value === '') return false;
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) throw new Error(`LCOV contains an invalid hit count: ${value}.`);
  return count > 0;
}

function spawnAndCapture(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function tail(value, lines) {
  return String(value || '').split(/\r?\n/u).slice(-lines).join('\n').trim();
}

async function main() {
  const suites = process.argv.slice(2);
  if (!suites.length || suites.some((suite) => !['shared', 'background'].includes(suite))) {
    throw new Error('Usage: node scripts/node-coverage-gate.mjs <shared|background> [...].');
  }
  for (const suite of suites) {
    const result = await runNodeCoverageSuite(suite);
    const summary = Object.entries(result.coverage)
      .map(([metric, counts]) => `${metric}=${counts.covered}/${counts.total}`)
      .join(' ');
    process.stdout.write(`[coverage] ${suite}: ${result.files} files, ${summary}\n`);
  }
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
