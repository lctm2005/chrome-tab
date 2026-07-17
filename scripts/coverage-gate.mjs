import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUNTIME_FILES } from './release-files.mjs';

export const PRECISE_COVERAGE_SCHEMA_VERSION = 2;
export const PRECISE_COVERAGE_ENGINE = 'cdp-precise';
export const PRECISE_COVERAGE_HASH_ALGORITHM = 'sha256';
export const REQUIRED_PRECISE_COVERAGE_TARGETS = Object.freeze({
  background: 'background.js',
  workbench: 'sidepanel.js',
  sidepanel: 'sidepanel.js',
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function expectedRuntimeJavaScriptPaths(runtimeFiles = RUNTIME_FILES) {
  return [...new Set((runtimeFiles || [])
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.endsWith('.js')))]
    .sort((left, right) => left.localeCompare(right));
}

export function sha256Source(source) {
  return createHash(PRECISE_COVERAGE_HASH_ALGORITHM).update(source).digest('hex');
}

export async function hashRuntimeJavaScriptSources(
  root = repositoryRoot,
  paths = expectedRuntimeJavaScriptPaths(),
) {
  const hashes = {};
  for (const path of paths) {
    hashes[path] = sha256Source(await readFile(resolve(root, path)));
  }
  return hashes;
}

export async function verifyPreciseCoverageReport(report, options = {}) {
  const expectedPaths = options.expectedPaths || expectedRuntimeJavaScriptPaths();
  const expectedSourceHashes = options.expectedSourceHashes ||
    await hashRuntimeJavaScriptSources(options.repositoryRoot || repositoryRoot, expectedPaths);
  return assertPreciseCoverageReport(report, {
    ...options,
    expectedPaths,
    expectedSourceHashes,
  });
}

export function assertPreciseCoverageReport(report, options = {}) {
  const failures = [];
  const expectedPaths = normalizePathList(
    options.expectedPaths || expectedRuntimeJavaScriptPaths(),
    'expected runtime JavaScript scope',
    failures,
  );
  const expectedSourceHashes = normalizeHashEntries(options.expectedSourceHashes);
  const requiredTargets = options.requiredTargets || REQUIRED_PRECISE_COVERAGE_TARGETS;

  if (!isRecord(report)) {
    throw new Error('Precise coverage gate failed:\n- coverage report must be a JSON object');
  }
  if (report.schemaVersion !== PRECISE_COVERAGE_SCHEMA_VERSION) {
    failures.push(
      `schemaVersion must be ${PRECISE_COVERAGE_SCHEMA_VERSION}, received ${formatValue(report.schemaVersion)}`,
    );
  }
  if (report.engine !== PRECISE_COVERAGE_ENGINE) {
    failures.push(`engine must be ${PRECISE_COVERAGE_ENGINE}, received ${formatValue(report.engine)}`);
  }
  if (report.complete !== true) {
    failures.push('coverage report is incomplete');
  }

  const fileSummaries = validateFileSummaries(report.files, 'files', failures);
  compareExactScope([...fileSummaries.keys()], expectedPaths, 'runtime JavaScript coverage', failures);
  validateAggregate(report.totals, [...fileSummaries.values()], 'totals', failures);
  validateSourceHashes(report, expectedPaths, expectedSourceHashes, failures);
  validateTargets(report.targets, requiredTargets, failures);

  if (failures.length > 0) {
    throw new Error(`Precise coverage gate failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  }

  return {
    schemaVersion: report.schemaVersion,
    engine: report.engine,
    files: expectedPaths.length,
    targets: Object.keys(report.targets).length,
    totals: report.totals,
  };
}

function validateTargets(targets, requiredTargets, failures) {
  if (!isRecord(targets)) {
    failures.push('targets must be an object');
    return;
  }

  for (const [key, target] of Object.entries(targets)) {
    if (!isRecord(target)) {
      failures.push(`target ${key} must be an object`);
      continue;
    }
    if (target.startedBeforeExecution !== true) {
      failures.push(`target ${key} did not start precise coverage before execution`);
    }
    if (target.error) failures.push(`target ${key} reported an error: ${String(target.error)}`);
    const files = validateFileSummaries(target.files, `targets.${key}.files`, failures);
    validateAggregate(target.totals, [...files.values()], `targets.${key}.totals`, failures);
  }

  for (const [key, entryPath] of Object.entries(requiredTargets)) {
    const target = targets[key];
    if (!isRecord(target)) {
      failures.push(`required target ${key} is missing`);
      continue;
    }
    if (target.entryPath !== entryPath) {
      failures.push(
        `target ${key} entryPath must be ${entryPath}, received ${formatValue(target.entryPath)}`,
      );
    }
    if (!isRecord(target.entryFile) || target.entryFile.path !== entryPath) {
      failures.push(`target ${key} is missing entry-file coverage for ${entryPath}`);
      continue;
    }
    validateMetric(target.entryFile.lines, `targets.${key}.entryFile.lines`, failures);
    validateMetric(target.entryFile.functions, `targets.${key}.entryFile.functions`, failures);
    const matchingFile = Array.isArray(target.files)
      ? target.files.find((file) => file?.path === entryPath)
      : null;
    if (!matchingFile) {
      failures.push(`target ${key} files do not include its entry ${entryPath}`);
    } else if (
      !sameMetric(target.entryFile.lines, matchingFile.lines) ||
      !sameMetric(target.entryFile.functions, matchingFile.functions)
    ) {
      failures.push(`target ${key} entryFile does not match its ${entryPath} file summary`);
    }
  }
}

function validateSourceHashes(report, expectedPaths, expectedSourceHashes, failures) {
  if (report.sourceHashAlgorithm !== PRECISE_COVERAGE_HASH_ALGORITHM) {
    failures.push(
      `sourceHashAlgorithm must be ${PRECISE_COVERAGE_HASH_ALGORITHM}, received ` +
      formatValue(report.sourceHashAlgorithm),
    );
  }
  if (!isRecord(report.sourceHashes)) {
    failures.push('sourceHashes must be an object');
    return;
  }

  const reportedPaths = Object.keys(report.sourceHashes);
  compareExactScope(reportedPaths, expectedPaths, 'source hashes', failures);
  for (const path of expectedPaths) {
    const reportedHash = report.sourceHashes[path];
    const expectedHash = expectedSourceHashes.get(path);
    if (!/^[a-f0-9]{64}$/.test(String(reportedHash || ''))) {
      failures.push(`source hash for ${path} is not a lowercase SHA-256 digest`);
      continue;
    }
    if (!expectedHash) {
      failures.push(`expected source hash configuration is missing ${path}`);
    } else if (reportedHash !== expectedHash) {
      failures.push(`source hash mismatch for ${path}; coverage was collected from different code`);
    }
  }
}

function validateFileSummaries(files, label, failures) {
  const summaries = new Map();
  if (!Array.isArray(files)) {
    failures.push(`${label} must be an array`);
    return summaries;
  }
  for (const [index, file] of files.entries()) {
    if (!isRecord(file)) {
      failures.push(`${label}[${index}] must be an object`);
      continue;
    }
    const path = String(file.path || '').trim();
    if (!path) {
      failures.push(`${label}[${index}] is missing path`);
      continue;
    }
    if (summaries.has(path)) {
      failures.push(`${label} contains duplicate path ${path}`);
      continue;
    }
    validateMetric(file.lines, `${label}.${path}.lines`, failures);
    validateMetric(file.functions, `${label}.${path}.functions`, failures);
    summaries.set(path, file);
  }
  return summaries;
}

function validateAggregate(totals, files, label, failures) {
  if (!isRecord(totals)) {
    failures.push(`${label} must be an object`);
    return;
  }
  validateMetric(totals.lines, `${label}.lines`, failures);
  validateMetric(totals.functions, `${label}.functions`, failures);
  for (const metricName of ['lines', 'functions']) {
    if (!validCounts(totals[metricName])) continue;
    const expectedCovered = files.reduce(
      (sum, file) => sum + (validCounts(file?.[metricName]) ? file[metricName].covered : 0),
      0,
    );
    const expectedTotal = files.reduce(
      (sum, file) => sum + (validCounts(file?.[metricName]) ? file[metricName].total : 0),
      0,
    );
    if (totals[metricName].covered !== expectedCovered || totals[metricName].total !== expectedTotal) {
      failures.push(
        `${label}.${metricName} must equal the sum of file summaries ` +
        `(${expectedCovered}/${expectedTotal}), received ` +
        `${totals[metricName].covered}/${totals[metricName].total}`,
      );
    }
  }
}

function validateMetric(metric, label, failures) {
  if (!validCounts(metric)) {
    failures.push(`${label} must contain non-negative integer covered/total counts with covered <= total`);
    return;
  }
  const expectedPercent = percentage(metric.covered, metric.total);
  if (metric.percent !== expectedPercent) {
    failures.push(`${label}.percent must be ${expectedPercent}, received ${formatValue(metric.percent)}`);
  }
}

function validCounts(metric) {
  return isRecord(metric) &&
    Number.isInteger(metric.covered) && metric.covered >= 0 &&
    Number.isInteger(metric.total) && metric.total >= 0 &&
    metric.covered <= metric.total;
}

function sameMetric(left, right) {
  return validCounts(left) && validCounts(right) &&
    left.covered === right.covered &&
    left.total === right.total &&
    left.percent === right.percent;
}

function percentage(covered, total) {
  if (total === 0) return 100;
  return Number(((covered / total) * 100).toFixed(2));
}

function compareExactScope(actualPaths, expectedPaths, label, failures) {
  const actual = new Set(actualPaths);
  const expected = new Set(expectedPaths);
  const missing = expectedPaths.filter((path) => !actual.has(path));
  const unexpected = [...actual].filter((path) => !expected.has(path)).sort();
  if (missing.length > 0) failures.push(`${label} is missing: ${missing.join(', ')}`);
  if (unexpected.length > 0) failures.push(`${label} has unexpected files: ${unexpected.join(', ')}`);
}

function normalizePathList(paths, label, failures) {
  const normalized = Array.from(paths || [], (path) => String(path || '').trim());
  const duplicates = normalized.filter((path, index) => normalized.indexOf(path) !== index);
  if (duplicates.length > 0) {
    failures.push(`${label} contains duplicates: ${[...new Set(duplicates)].join(', ')}`);
  }
  return [...new Set(normalized.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeHashEntries(hashes) {
  if (hashes instanceof Map) return new Map(hashes);
  if (isRecord(hashes)) return new Map(Object.entries(hashes));
  return new Map();
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatValue(value) {
  return value === undefined ? '(missing)' : JSON.stringify(value);
}

async function main(args = process.argv.slice(2)) {
  if (args.length > 1) throw new Error('Usage: node scripts/coverage-gate.mjs [coverage-report.json]');
  const reportPath = resolve(process.cwd(), args[0] || 'coverage/e2e-extension-coverage.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const result = await verifyPreciseCoverageReport(report);
  process.stdout.write(
    `[coverage-gate] passed: ${result.files} runtime JavaScript files, ` +
    `${result.targets} targets, ${result.totals.lines.percent}% lines, ` +
    `${result.totals.functions.percent}% functions\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[coverage-gate] ${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
