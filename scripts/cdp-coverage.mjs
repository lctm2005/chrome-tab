import { parse } from 'acorn';
import { convert } from 'ast-v8-to-istanbul';
import istanbulCoverage from 'istanbul-lib-coverage';

const { createCoverageMap, createFileCoverage } = istanbulCoverage;

const DEFAULT_IGNORED_AUTO_ATTACH_TARGET_TYPES = new Set([
  'browser',
  'service_worker',
  'tab',
]);

export function classifyCoverageTargetUrl(value, expectedUrl) {
  const url = String(value || '').trim();
  const expected = String(expectedUrl || '').trim();
  if (expected && url === expected) return 'match';
  if (!url || /^about:(?:blank|srcdoc)(?:[?#].*)?$/i.test(url)) return 'pending';
  return 'other';
}

/**
 * Tracks auto-attached DevTools targets without assuming that the first
 * TargetInfo already contains its final URL. Chrome may report a newly-created
 * page as an empty URL or about:blank before navigation commits. Callers must
 * instrument `pending` candidates before resuming them, then feed later
 * Target.targetInfoChanged or Runtime location observations back into this
 * tracker.
 */
export function createCoverageTargetUrlTracker(expectedUrl, options = {}) {
  const expected = String(expectedUrl || '').trim();
  if (!expected) throw new TypeError('Coverage target tracker requires an expected URL.');
  const ignoredTargetIds = new Set(
    [...(options.ignoredTargetIds || [])].map(String).filter(Boolean),
  );
  const ignoredTargetTypes = new Set(
    options.ignoredTargetTypes || DEFAULT_IGNORED_AUTO_ATTACH_TARGET_TYPES,
  );
  const candidates = new Map();
  let claimedTargetId = '';
  let closed = false;

  function attached(targetInfo = {}) {
    const targetId = String(targetInfo?.targetId || '');
    const targetType = String(targetInfo?.type || '');
    if (
      closed || !targetId || claimedTargetId || ignoredTargetIds.has(targetId) ||
      ignoredTargetTypes.has(targetType) || candidates.has(targetId)
    ) {
      return { action: 'ignore', targetId };
    }
    const status = classifyCoverageTargetUrl(targetInfo?.url, expected);
    if (status === 'other') return { action: 'ignore', targetId };
    candidates.set(targetId, {
      targetId,
      targetType,
      url: String(targetInfo?.url || ''),
      status,
    });
    return { action: 'instrument', targetId, status };
  }

  function observed(targetIdValue, urlValue, targetTypeValue = '') {
    const targetId = String(targetIdValue || '');
    const candidate = candidates.get(targetId);
    if (closed || !candidate) return { action: 'ignore', targetId };
    const status = classifyCoverageTargetUrl(urlValue, expected);
    candidate.url = String(urlValue || '');
    candidate.status = status;
    if (targetTypeValue) candidate.targetType = String(targetTypeValue);
    if (claimedTargetId && claimedTargetId !== targetId) {
      candidates.delete(targetId);
      return { action: 'reject', targetId, status };
    }
    if (status === 'match') return { action: 'confirm', targetId, status };
    if (status === 'pending') return { action: 'wait', targetId, status };
    candidates.delete(targetId);
    return { action: 'reject', targetId, status };
  }

  function claim(targetIdValue) {
    const targetId = String(targetIdValue || '');
    if (closed || claimedTargetId || !candidates.has(targetId)) {
      return { claimed: false, targetId, rejectTargetIds: [] };
    }
    claimedTargetId = targetId;
    const rejectTargetIds = [...candidates.keys()].filter((id) => id !== targetId);
    for (const id of rejectTargetIds) candidates.delete(id);
    return { claimed: true, targetId, rejectTargetIds };
  }

  function remove(targetIdValue) {
    const targetId = String(targetIdValue || '');
    if (!targetId || targetId === claimedTargetId) return false;
    return candidates.delete(targetId);
  }

  function close() {
    closed = true;
    const pendingTargetIds = [...candidates.keys()].filter((id) => id !== claimedTargetId);
    for (const id of pendingTargetIds) candidates.delete(id);
    return pendingTargetIds;
  }

  function snapshot() {
    return {
      closed,
      claimedTargetId,
      candidates: [...candidates.values()].map((candidate) => ({ ...candidate })),
    };
  }

  return {
    attached,
    observed,
    claim,
    remove,
    close,
    snapshot,
  };
}

function percentage(covered, total) {
  if (total === 0) return 100;
  return Number(((covered / total) * 100).toFixed(2));
}

export function extensionRelativeScriptPath(scriptUrl, extensionId) {
  try {
    const url = new URL(String(scriptUrl || ''));
    if (url.protocol !== 'chrome-extension:' || url.hostname !== extensionId) return '';
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relativePath.endsWith('.js')) return '';
    const segments = relativePath.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
    return relativePath;
  } catch {
    return '';
  }
}

export function compressLineNumbers(lines = []) {
  const sorted = [...new Set((lines || [])
    .map(Number)
    .filter((line) => Number.isInteger(line) && line > 0))]
    .sort((left, right) => left - right);
  const ranges = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return ranges;
}

export function summarizeLocalPreciseCoverage(records = []) {
  const merged = mergeLocalRecords(records);
  const files = [...merged.values()]
    .map(({ path, source, functions }) => summarizeFile(path, source, [...functions.values()]))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    totals: aggregateFileSummaries(files),
    files,
  };
}

export async function summarizeLocalIstanbulCoverage(records = []) {
  const grouped = groupLocalRecords(records);
  const files = [];
  for (const { path, source, scripts } of grouped.values()) {
    const ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      ranges: true,
      allowHashBang: true,
    });
    const coverageMap = createCoverageMap({});
    for (const [index, functions] of scripts.entries()) {
      const converted = await convert({
        ast,
        code: source,
        wrapperLength: 0,
        coverage: {
          scriptId: `${path}:${index}`,
          url: `file:///${path.split('/').map(encodeURIComponent).join('/')}`,
          functions,
        },
      });
      coverageMap.merge(converted);
    }
    const coveragePath = coverageMap.files()[0];
    const data = coveragePath ? coverageMap.fileCoverageFor(coveragePath).toJSON() : null;
    if (!data) continue;
    const fileCoverage = createFileCoverage(data);
    const summary = fileCoverage.toSummary();
    files.push({
      path,
      statements: istanbulMetric(summary.statements),
      branches: istanbulMetric(summary.branches),
      functions: istanbulMetric(summary.functions),
      lines: istanbulMetric(summary.lines),
      uncovered: istanbulUncovered(fileCoverage),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    totals: aggregateIstanbulSummaries(files),
    files,
  };
}

function groupLocalRecords(records) {
  const files = new Map();
  for (const record of records || []) {
    const path = String(record?.path || '').trim();
    const source = String(record?.source ?? '');
    if (!path || !Array.isArray(record?.functions)) continue;
    if (!files.has(path)) files.set(path, { path, source, scripts: [] });
    const file = files.get(path);
    if (file.source !== source) {
      throw new Error(`Cannot merge CDP coverage for different source snapshots: ${path}`);
    }
    file.scripts.push(record.functions);
  }
  return files;
}

function istanbulMetric(metric) {
  return {
    covered: metric.covered,
    total: metric.total,
    percent: percentage(metric.covered, metric.total),
  };
}

function aggregateIstanbulSummaries(files) {
  const totals = {};
  for (const metricName of ['statements', 'branches', 'functions', 'lines']) {
    const covered = files.reduce((sum, file) => sum + file[metricName].covered, 0);
    const total = files.reduce((sum, file) => sum + file[metricName].total, 0);
    totals[metricName] = { covered, total, percent: percentage(covered, total) };
  }
  return totals;
}

function istanbulUncovered(fileCoverage) {
  const data = fileCoverage.toJSON();
  const statements = Object.entries(data.s)
    .filter(([, count]) => count === 0)
    .map(([id]) => ({ id: `statement:${id}`, location: data.statementMap[id] }));
  const functions = Object.entries(data.f)
    .filter(([, count]) => count === 0)
    .map(([id]) => ({
      id: `function:${id}`,
      name: data.fnMap[id].name || '(anonymous)',
      line: data.fnMap[id].loc.start.line,
      location: data.fnMap[id].loc,
    }));
  const branches = Object.entries(data.b).flatMap(([id, counts]) => (
    counts.flatMap((count, index) => count === 0
      ? [{
          id: `branch:${id}:${index}`,
          type: data.branchMap[id].type,
          line: data.branchMap[id].loc.start.line,
          index,
          location: data.branchMap[id].locations[index],
        }]
      : [])
  ));
  return {
    lines: fileCoverage.getUncoveredLines().map(Number),
    statements,
    functions,
    branches,
  };
}

function mergeLocalRecords(records) {
  const files = new Map();
  for (const record of records || []) {
    const path = String(record?.path || '').trim();
    const source = String(record?.source ?? '');
    if (!path || !Array.isArray(record?.functions)) continue;
    if (!files.has(path)) files.set(path, { path, source, functions: new Map() });
    const file = files.get(path);
    if (file.source !== source) {
      throw new Error(`Cannot merge CDP coverage for different source snapshots: ${path}`);
    }
    for (const entry of record.functions) {
      const ranges = Array.isArray(entry?.ranges) ? entry.ranges : [];
      if (!ranges.length) continue;
      const root = ranges[0];
      const key = `${entry.functionName || ''}\0${root.startOffset}\0${root.endOffset}`;
      if (!file.functions.has(key)) {
        file.functions.set(key, {
          functionName: entry.functionName || '',
          isBlockCoverage: entry.isBlockCoverage === true,
          ranges: new Map(),
        });
      }
      const mergedFunction = file.functions.get(key);
      for (const range of ranges) {
        if (!Number.isInteger(range?.startOffset) || !Number.isInteger(range?.endOffset)) continue;
        const rangeKey = `${range.startOffset}:${range.endOffset}`;
        const current = mergedFunction.ranges.get(rangeKey);
        if (current) current.count += Number(range.count) || 0;
        else {
          mergedFunction.ranges.set(rangeKey, {
            startOffset: range.startOffset,
            endOffset: range.endOffset,
            count: Number(range.count) || 0,
          });
        }
      }
    }
  }

  for (const file of files.values()) {
    for (const entry of file.functions.values()) {
      entry.ranges = [...entry.ranges.values()]
        .sort((left, right) => left.startOffset - right.startOffset || right.endOffset - left.endOffset);
    }
  }
  return files;
}

function summarizeFile(path, source, functions) {
  const lineStarts = sourceLineStarts(source);
  const probeOffsets = executableLineProbeOffsets(source);
  const ranges = functions.flatMap((entry) => entry.ranges || []);
  const lineCoverage = coverageAtSortedOffsets(
    [...probeOffsets.entries()].map(([line, offset]) => ({ line, offset })),
    ranges,
  );
  const uncoveredLines = lineCoverage
    .filter((entry) => !entry.covered)
    .map((entry) => entry.line);
  const coveredLines = lineCoverage.length - uncoveredLines.length;

  const userFunctions = functions.filter((entry) => {
    const root = entry.ranges?.[0];
    return root && !(
      !entry.functionName &&
      root.startOffset === 0 &&
      root.endOffset >= source.length
    );
  });
  const uncoveredFunctions = userFunctions
    .filter((entry) => (entry.ranges?.[0]?.count || 0) === 0)
    .map((entry) => ({
      name: entry.functionName || '(anonymous)',
      line: offsetToLine(lineStarts, entry.ranges[0].startOffset),
    }));
  const functionDetails = userFunctions.map((entry) => {
    const root = entry.ranges[0];
    return {
      id: `${root.startOffset}:${root.endOffset}`,
      name: entry.functionName || '(anonymous)',
      line: offsetToLine(lineStarts, root.startOffset),
      covered: (root.count || 0) > 0,
    };
  });
  const coveredFunctions = userFunctions.length - uncoveredFunctions.length;

  return {
    path,
    lines: {
      covered: coveredLines,
      total: lineCoverage.length,
      percent: percentage(coveredLines, lineCoverage.length),
      uncovered: uncoveredLines,
    },
    functions: {
      covered: coveredFunctions,
      total: userFunctions.length,
      percent: percentage(coveredFunctions, userFunctions.length),
      uncovered: uncoveredFunctions,
      details: functionDetails,
    },
  };
}

function aggregateFileSummaries(files) {
  const lines = files.reduce((sum, file) => sum + file.lines.total, 0);
  const coveredLines = files.reduce((sum, file) => sum + file.lines.covered, 0);
  const functions = files.reduce((sum, file) => sum + file.functions.total, 0);
  const coveredFunctions = files.reduce((sum, file) => sum + file.functions.covered, 0);
  return {
    lines: {
      covered: coveredLines,
      total: lines,
      percent: percentage(coveredLines, lines),
    },
    functions: {
      covered: coveredFunctions,
      total: functions,
      percent: percentage(coveredFunctions, functions),
    },
  };
}

function sourceLineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function offsetToLine(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}

function executableLineProbeOffsets(source) {
  const probes = new Map();
  let line = 1;
  let state = 'code';
  let escaped = false;

  const mark = (offset, character) => {
    if (!/\s/.test(character) && !probes.has(line)) probes.set(line, offset);
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '\n') {
      line += 1;
      if (state === 'line-comment') state = 'code';
      escaped = false;
      continue;
    }
    if (state === 'line-comment') continue;
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }
    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      mark(index, character);
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (
        (state === 'single-quote' && character === "'") ||
        (state === 'double-quote' && character === '"') ||
        (state === 'template' && character === '`')
      ) state = 'code';
      continue;
    }
    if (character === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
      continue;
    }
    mark(index, character);
    if (character === "'") state = 'single-quote';
    else if (character === '"') state = 'double-quote';
    else if (character === '`') state = 'template';
  }
  return probes;
}

function coverageAtSortedOffsets(probes, ranges) {
  const sortedProbes = [...probes].sort((left, right) => left.offset - right.offset);
  const sortedRanges = ranges
    .filter((range) => range.endOffset > range.startOffset)
    .map((range, index) => ({
      ...range,
      length: range.endOffset - range.startOffset,
      index,
    }))
    .sort((left, right) => left.startOffset - right.startOffset || right.endOffset - left.endOffset);
  const active = [];
  let rangeIndex = 0;
  const results = [];

  for (const probe of sortedProbes) {
    while (rangeIndex < sortedRanges.length && sortedRanges[rangeIndex].startOffset <= probe.offset) {
      active.push(sortedRanges[rangeIndex]);
      rangeIndex += 1;
    }
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].endOffset <= probe.offset) active.splice(index, 1);
    }
    let selected = null;
    for (const range of active) {
      if (
        probe.offset < range.endOffset &&
        (!selected || range.length < selected.length ||
          (range.length === selected.length && range.count < selected.count))
      ) selected = range;
    }
    results.push({ line: probe.line, covered: Boolean(selected && selected.count > 0) });
  }
  return results;
}
