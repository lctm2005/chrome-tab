import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PRECISE_COVERAGE_ENGINE,
  PRECISE_COVERAGE_HASH_ALGORITHM,
  PRECISE_COVERAGE_SCHEMA_VERSION,
} from './coverage-gate.mjs';

export const AST_UNION_COVERAGE_SCHEMA_VERSION = 1;
export const AST_UNION_COVERAGE_ENGINE = 'cdp-precise-ast-union';
export const AST_COVERAGE_METRICS = Object.freeze([
  'statements',
  'branches',
  'functions',
  'lines',
]);
export const DEFAULT_AST_UNION_PATHS = Object.freeze(['sidepanel.js']);

const defaultCoveragePaths = Object.freeze({
  extension: 'coverage/e2e-extension-coverage.json',
  preview: 'coverage/e2e-preview-coverage.json',
  output: 'coverage/e2e-union-coverage.json',
});

export function createAstCoverageUnion(extensionReport, previewReport, options = {}) {
  const failures = [];
  const paths = normalizeSelectedPaths(options.paths || DEFAULT_AST_UNION_PATHS, failures);

  validatePreciseInput(extensionReport, 'extension', failures, {
    startedBeforeExecution: extensionReport?.targets?.workbench?.startedBeforeExecution,
    targetError: extensionReport?.targets?.workbench?.error,
  });
  validatePreciseInput(previewReport, 'preview', failures, {
    startedBeforeExecution: previewReport?.startedBeforeExecution,
  });

  const extensionFiles = indexCoverageFiles(extensionReport?.files, 'extension', failures);
  const previewFiles = indexCoverageFiles(previewReport?.files, 'preview', failures);
  const files = [];

  for (const path of paths) {
    const extensionFile = extensionFiles.get(path);
    const previewFile = previewFiles.get(path);
    if (!extensionFile) failures.push(`extension report is missing AST coverage for ${path}`);
    if (!previewFile) failures.push(`preview report is missing AST coverage for ${path}`);

    const extensionHash = validateSourceHash(extensionReport, 'extension', path, failures);
    const previewHash = validateSourceHash(previewReport, 'preview', path, failures);
    if (extensionHash && previewHash && extensionHash !== previewHash) {
      failures.push(
        `${path} source SHA-256 differs between extension and preview reports ` +
        `(${extensionHash} !== ${previewHash})`,
      );
    }
    const expectedHash = normalizeExpectedHash(options.expectedSourceHashes, path);
    if (expectedHash && extensionHash && extensionHash !== expectedHash) {
      failures.push(`${path} source SHA-256 does not match the expected repository source`);
    }

    if (!extensionFile || !previewFile) continue;
    const extensionCoverage = validateAstFile(extensionFile, 'extension', path, failures);
    const previewCoverage = validateAstFile(previewFile, 'preview', path, failures);
    if (!extensionCoverage || !previewCoverage) continue;

    for (const metricName of AST_COVERAGE_METRICS) {
      const extensionTotal = extensionCoverage.metrics[metricName].total;
      const previewTotal = previewCoverage.metrics[metricName].total;
      if (extensionTotal !== previewTotal) {
        failures.push(
          `${path} ${metricName} AST total differs between extension and preview reports ` +
          `(${extensionTotal} !== ${previewTotal})`,
        );
      }
    }

    if (AST_COVERAGE_METRICS.some((metricName) => (
      extensionCoverage.metrics[metricName].total !== previewCoverage.metrics[metricName].total
    ))) continue;

    const uncovered = intersectUncovered(extensionCoverage.uncovered, previewCoverage.uncovered);
    const coverage = Object.fromEntries(AST_COVERAGE_METRICS.map((metricName) => {
      const total = extensionCoverage.metrics[metricName].total;
      const uncoveredCount = uncovered[metricName].length;
      return [metricName, metric(total - uncoveredCount, total)];
    }));
    files.push({
      path,
      sourceHash: extensionHash || previewHash,
      coverage,
      uncovered: {
        lines: uncovered.lines.map(({ line }) => line),
        statements: uncovered.statements.map(({ value }) => value),
        branches: uncovered.branches.map(({ value }) => value),
        functions: uncovered.functions.map(({ value }) => value),
      },
      inputs: {
        extension: extensionCoverage.metrics,
        preview: previewCoverage.metrics,
      },
    });
  }

  if (failures.length > 0) {
    throw new Error(
      `AST coverage union failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
    );
  }

  return {
    schemaVersion: AST_UNION_COVERAGE_SCHEMA_VERSION,
    engine: AST_UNION_COVERAGE_ENGINE,
    generatedAt: options.generatedAt || new Date().toISOString(),
    complete: true,
    sourceHashAlgorithm: PRECISE_COVERAGE_HASH_ALGORITHM,
    sourceHashes: Object.fromEntries(files.map((file) => [file.path, file.sourceHash])),
    inputs: {
      extension: inputMetadata(extensionReport),
      preview: inputMetadata(previewReport),
    },
    coverage: aggregateCoverage(files),
    files,
  };
}

export function assertAstCoverageThresholds(report, thresholds = 100, options = {}) {
  const normalizedThresholds = normalizeThresholds(thresholds);
  const failures = [];
  validateUnionReportShape(report, failures);
  if (failures.length > 0) {
    throw new Error(
      `AST coverage threshold gate failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
    );
  }

  const scopes = [
    ['total', report.coverage, report.files],
    ...((options.perFile ?? true)
      ? report.files.map((file) => [file.path, file.coverage, [file]])
      : []),
  ];
  for (const [scope, coverage, files] of scopes) {
    for (const metricName of AST_COVERAGE_METRICS) {
      const metricValue = coverage[metricName];
      const minimum = normalizedThresholds[metricName];
      const actual = rawPercentage(metricValue.covered, metricValue.total);
      if (actual + Number.EPSILON >= minimum) continue;
      const examples = uncoveredExamples(files, metricName);
      failures.push(
        `${scope} ${metricName} coverage is ${formatPercentage(actual)}% ` +
        `(${metricValue.covered}/${metricValue.total}), below ${minimum}%; ` +
        `still uncovered: ${examples}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `AST coverage threshold gate failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
    );
  }

  return {
    files: report.files.length,
    thresholds: normalizedThresholds,
    coverage: report.coverage,
  };
}

export function parseAstCoverageUnionArguments(args = []) {
  const positional = [];
  const paths = [];
  let output = defaultCoveragePaths.output;
  let commonMinimum = 100;
  const metricMinimums = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    if (argument === '--output') output = requiredOptionValue(args, ++index, argument);
    else if (argument === '--file') paths.push(requiredOptionValue(args, ++index, argument));
    else if (argument === '--min') commonMinimum = parseThreshold(requiredOptionValue(args, ++index, argument), argument);
    else if (argument.startsWith('--min-')) {
      const metricName = argument.slice('--min-'.length);
      if (!AST_COVERAGE_METRICS.includes(metricName)) {
        throw new Error(`Unknown coverage metric option: ${argument}`);
      }
      metricMinimums[metricName] = parseThreshold(requiredOptionValue(args, ++index, argument), argument);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (positional.length > 2) throw new Error('Expected at most extension and preview report paths.');

  return {
    extension: positional[0] || defaultCoveragePaths.extension,
    preview: positional[1] || defaultCoveragePaths.preview,
    output,
    paths: paths.length > 0 ? paths : [...DEFAULT_AST_UNION_PATHS],
    thresholds: Object.fromEntries(AST_COVERAGE_METRICS.map((metricName) => [
      metricName,
      metricMinimums[metricName] ?? commonMinimum,
    ])),
  };
}

function validatePreciseInput(report, label, failures, execution = {}) {
  if (!isRecord(report)) {
    failures.push(`${label} report must be a JSON object`);
    return;
  }
  if (report.schemaVersion !== PRECISE_COVERAGE_SCHEMA_VERSION) {
    failures.push(
      `${label} schemaVersion must be ${PRECISE_COVERAGE_SCHEMA_VERSION}, ` +
      `received ${formatValue(report.schemaVersion)}`,
    );
  }
  if (report.engine !== PRECISE_COVERAGE_ENGINE) {
    failures.push(
      `${label} engine must be ${PRECISE_COVERAGE_ENGINE}, received ${formatValue(report.engine)}`,
    );
  }
  if (report.complete !== true) failures.push(`${label} coverage report is incomplete`);
  if (execution.startedBeforeExecution !== true) {
    failures.push(`${label} precise coverage did not start before execution`);
  }
  if (execution.targetError) {
    failures.push(`${label} coverage target reported an error: ${String(execution.targetError)}`);
  }
  if (report.sourceHashAlgorithm !== PRECISE_COVERAGE_HASH_ALGORITHM) {
    failures.push(
      `${label} sourceHashAlgorithm must be ${PRECISE_COVERAGE_HASH_ALGORITHM}, ` +
      `received ${formatValue(report.sourceHashAlgorithm)}`,
    );
  }
}

function indexCoverageFiles(files, label, failures) {
  const indexed = new Map();
  if (!Array.isArray(files)) {
    failures.push(`${label} files must be an array`);
    return indexed;
  }
  for (const [index, file] of files.entries()) {
    const path = String(file?.path || '').trim();
    if (!path) {
      failures.push(`${label} files[${index}] is missing path`);
      continue;
    }
    if (indexed.has(path)) {
      failures.push(`${label} files contains duplicate path ${path}`);
      continue;
    }
    indexed.set(path, file);
  }
  return indexed;
}

function validateSourceHash(report, label, path, failures) {
  const hash = report?.sourceHashes?.[path];
  if (!/^[a-f0-9]{64}$/.test(String(hash || ''))) {
    failures.push(`${label} source hash for ${path} is not a lowercase SHA-256 digest`);
    return '';
  }
  return hash;
}

function validateAstFile(file, label, path, failures) {
  if (!isRecord(file.coverage)) {
    failures.push(`${label} ${path} is missing AST coverage metrics`);
    return null;
  }
  if (!isRecord(file.uncovered)) {
    failures.push(`${label} ${path} is missing AST uncovered details`);
    return null;
  }

  const metrics = {};
  const uncovered = {};
  for (const metricName of AST_COVERAGE_METRICS) {
    const metricValue = file.coverage[metricName];
    if (!validMetric(metricValue)) {
      failures.push(
        `${label} ${path} ${metricName} must contain valid covered/total/percent values`,
      );
      continue;
    }
    metrics[metricName] = {
      covered: metricValue.covered,
      total: metricValue.total,
      percent: metricValue.percent,
    };
    const entries = normalizeUncoveredEntries(file.uncovered[metricName], metricName, label, path, failures);
    uncovered[metricName] = entries;
    if (metricValue.covered + entries.length !== metricValue.total) {
      failures.push(
        `${label} ${path} ${metricName} counts disagree with uncovered details ` +
        `(${metricValue.covered} covered + ${entries.length} uncovered !== ${metricValue.total} total)`,
      );
    }
  }
  if (AST_COVERAGE_METRICS.some((metricName) => !metrics[metricName] || !uncovered[metricName])) {
    return null;
  }
  return { metrics, uncovered };
}

function normalizeUncoveredEntries(entries, metricName, label, path, failures) {
  if (!Array.isArray(entries)) {
    failures.push(`${label} ${path} uncovered.${metricName} must be an array`);
    return [];
  }
  const normalized = [];
  const seen = new Set();
  for (const [index, value] of entries.entries()) {
    let id = '';
    if (metricName === 'lines') {
      if (Number.isInteger(value) && value > 0) id = `line:${value}`;
    } else if (isRecord(value) && validStableId(value.id, metricName)) {
      id = value.id;
    }
    if (!id) {
      failures.push(
        `${label} ${path} uncovered.${metricName}[${index}] has no valid stable ID`,
      );
      continue;
    }
    if (seen.has(id)) {
      failures.push(`${label} ${path} uncovered.${metricName} contains duplicate ID ${id}`);
      continue;
    }
    seen.add(id);
    normalized.push(metricName === 'lines'
      ? { id, line: value, value }
      : { id, value });
  }
  normalized.sort((left, right) => compareStableIds(left.id, right.id));
  return normalized;
}

function validStableId(id, metricName) {
  const patterns = {
    statements: /^statement:\d+$/,
    branches: /^branch:\d+:\d+$/,
    functions: /^function:\d+$/,
  };
  return patterns[metricName]?.test(String(id || '')) || false;
}

function intersectUncovered(extensionUncovered, previewUncovered) {
  return Object.fromEntries(AST_COVERAGE_METRICS.map((metricName) => {
    const previewIds = new Set(previewUncovered[metricName].map(({ id }) => id));
    return [
      metricName,
      extensionUncovered[metricName].filter(({ id }) => previewIds.has(id)),
    ];
  }));
}

function aggregateCoverage(files) {
  return Object.fromEntries(AST_COVERAGE_METRICS.map((metricName) => {
    const covered = files.reduce((sum, file) => sum + file.coverage[metricName].covered, 0);
    const total = files.reduce((sum, file) => sum + file.coverage[metricName].total, 0);
    return [metricName, metric(covered, total)];
  }));
}

function inputMetadata(report) {
  return {
    schemaVersion: report.schemaVersion,
    engine: report.engine,
    generatedAt: report.generatedAt || null,
  };
}

function validateUnionReportShape(report, failures) {
  if (!isRecord(report)) {
    failures.push('union report must be an object');
    return;
  }
  if (report.schemaVersion !== AST_UNION_COVERAGE_SCHEMA_VERSION) {
    failures.push(`union schemaVersion must be ${AST_UNION_COVERAGE_SCHEMA_VERSION}`);
  }
  if (report.engine !== AST_UNION_COVERAGE_ENGINE) {
    failures.push(`union engine must be ${AST_UNION_COVERAGE_ENGINE}`);
  }
  if (report.complete !== true) failures.push('union report is incomplete');
  if (!Array.isArray(report.files) || report.files.length === 0) {
    failures.push('union report has no files');
    return;
  }
  const seenPaths = new Set();
  for (const metricName of AST_COVERAGE_METRICS) {
    if (!validMetric(report.coverage?.[metricName])) {
      failures.push(`union total ${metricName} metric is invalid`);
    }
  }
  for (const file of report.files) {
    const path = String(file?.path || '').trim();
    if (!path) failures.push('union file is missing path');
    else if (seenPaths.has(path)) failures.push(`union files contains duplicate path ${path}`);
    else seenPaths.add(path);
    for (const metricName of AST_COVERAGE_METRICS) {
      if (!validMetric(file?.coverage?.[metricName])) {
        failures.push(`${path || '(unknown file)'} ${metricName} metric is invalid`);
        continue;
      }
      const uncovered = file?.uncovered?.[metricName];
      if (!Array.isArray(uncovered)) {
        failures.push(`${path || '(unknown file)'} uncovered.${metricName} must be an array`);
      } else if (file.coverage[metricName].covered + uncovered.length !== file.coverage[metricName].total) {
        failures.push(`${path || '(unknown file)'} ${metricName} metric disagrees with uncovered details`);
      }
    }
  }
  for (const metricName of AST_COVERAGE_METRICS) {
    if (!validMetric(report.coverage?.[metricName])) continue;
    const covered = report.files.reduce(
      (sum, file) => sum + (validMetric(file?.coverage?.[metricName])
        ? file.coverage[metricName].covered
        : 0),
      0,
    );
    const total = report.files.reduce(
      (sum, file) => sum + (validMetric(file?.coverage?.[metricName])
        ? file.coverage[metricName].total
        : 0),
      0,
    );
    if (report.coverage[metricName].covered !== covered || report.coverage[metricName].total !== total) {
      failures.push(
        `union total ${metricName} must equal file summaries ` +
        `(${covered}/${total}), received ` +
        `${report.coverage[metricName].covered}/${report.coverage[metricName].total}`,
      );
    }
  }
}

function normalizeSelectedPaths(paths, failures) {
  const normalized = Array.from(paths, (path) => String(path || '').trim()).filter(Boolean);
  if (normalized.length === 0) failures.push('at least one AST coverage path is required');
  const duplicates = normalized.filter((path, index) => normalized.indexOf(path) !== index);
  if (duplicates.length > 0) {
    failures.push(`selected coverage paths contain duplicates: ${[...new Set(duplicates)].join(', ')}`);
  }
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

function normalizeExpectedHash(hashes, path) {
  if (hashes instanceof Map) return hashes.get(path) || '';
  if (isRecord(hashes)) return hashes[path] || '';
  return '';
}

function normalizeThresholds(thresholds) {
  const configured = typeof thresholds === 'number'
    ? Object.fromEntries(AST_COVERAGE_METRICS.map((metricName) => [metricName, thresholds]))
    : thresholds;
  if (!isRecord(configured)) throw new Error('Coverage thresholds must be a number or metric object.');
  return Object.fromEntries(AST_COVERAGE_METRICS.map((metricName) => {
    const value = configured[metricName];
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`${metricName} coverage threshold must be between 0 and 100.`);
    }
    return [metricName, value];
  }));
}

function uncoveredExamples(files, metricName) {
  const examples = [];
  for (const file of files) {
    const values = file.uncovered[metricName];
    for (const value of values) {
      const id = metricName === 'lines' ? `line:${value}` : value.id;
      examples.push(`${file.path}:${id}`);
      if (examples.length === 5) return examples.join(', ');
    }
  }
  return examples.join(', ');
}

function validMetric(value) {
  return isRecord(value) &&
    Number.isInteger(value.covered) && value.covered >= 0 &&
    Number.isInteger(value.total) && value.total >= value.covered &&
    value.percent === percentage(value.covered, value.total);
}

function metric(covered, total) {
  return { covered, total, percent: percentage(covered, total) };
}

function percentage(covered, total) {
  return Number(formatPercentage(rawPercentage(covered, total)));
}

function rawPercentage(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
}

function formatPercentage(value) {
  return Number(value.toFixed(2)).toString();
}

function compareStableIds(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function parseThreshold(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${option} must be a number between 0 and 100.`);
  }
  return parsed;
}

function requiredOptionValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatValue(value) {
  return value === undefined ? '(missing)' : JSON.stringify(value);
}

export async function runAstCoverageUnionCli(args = [], options = {}) {
  const cwd = options.cwd || process.cwd();
  const writeOutput = options.writeOutput || ((value) => process.stdout.write(value));
  const configured = parseAstCoverageUnionArguments(args);
  const [extensionReport, previewReport] = await Promise.all([
    readFile(resolve(cwd, configured.extension), 'utf8').then(JSON.parse),
    readFile(resolve(cwd, configured.preview), 'utf8').then(JSON.parse),
  ]);
  const expectedSourceHashes = {};
  for (const path of configured.paths) {
    const source = await readFile(resolve(cwd, path));
    expectedSourceHashes[path] = createHash(PRECISE_COVERAGE_HASH_ALGORITHM)
      .update(source)
      .digest('hex');
  }
  const report = createAstCoverageUnion(extensionReport, previewReport, {
    paths: configured.paths,
    expectedSourceHashes,
  });
  const outputPath = resolve(cwd, configured.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeOutput(`[e2e-coverage-union] wrote ${outputPath}\n`);

  const result = assertAstCoverageThresholds(report, configured.thresholds);
  writeOutput(
    `[e2e-coverage-union] passed: ${result.files} file(s), ` +
    AST_COVERAGE_METRICS.map((metricName) => (
      `${metricName} ${result.coverage[metricName].percent}%`
    )).join(', ') + '\n',
  );
  return { report, outputPath, result };
}

export function reportAstCoverageUnionCliError(error, options = {}) {
  const writeError = options.writeError || ((value) => process.stderr.write(value));
  const setExitCode = options.setExitCode || ((value) => { process.exitCode = value; });
  writeError(`[e2e-coverage-union] ${error?.message || String(error)}\n`);
  setExitCode(1);
}

export async function runAstCoverageUnionCliIfMain(importMetaUrl, argv = process.argv, options = {}) {
  if (!argv[1] || resolve(argv[1]) !== fileURLToPath(importMetaUrl)) return null;
  try {
    return await runAstCoverageUnionCli(argv.slice(2), options);
  } catch (error) {
    reportAstCoverageUnionCliError(error, options);
    return null;
  }
}

void runAstCoverageUnionCliIfMain(import.meta.url);
