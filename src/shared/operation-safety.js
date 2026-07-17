const TIDY_TARGET_FINGERPRINT_VERSION = 2;

/**
 * Runs a storage write only while its captured window binding is current.
 *
 * The binding is deliberately checked before, but not after, `write`: once
 * the awaited write resolves, durable truth has changed even if the panel
 * moved windows while the host was replying. Callers must treat any later
 * stale-view work as post-commit recovery rather than roll the mutation back.
 */
export async function commitWindowBoundWrite({ isCurrent, write }) {
  if (!isCurrent()) return false;
  await write();
  return true;
}

/**
 * Runs a workspace mutation with an explicit durable commit boundary.
 *
 * Failures before `commit` completes are ordinary operation failures and the
 * caller's in-memory rollback is required. A literal `false` commit result is
 * the window-bound write contract for "nothing was written" and is therefore
 * handled as a pre-commit failure too. Failures after that point must not be
 * reported as if the durable mutation failed; they are returned so the UI can
 * explain that the change was saved but its local view needs refreshing.
 */
export async function runDurableCommitBoundary({
  mutate,
  commit,
  rollbackBeforeCommit,
  afterCommit,
  restoreCommittedMemory,
} = {}) {
  let value;
  try {
    value = await mutate();
    const committed = await commit(value);
    if (committed === false) {
      throw new Error('The durable commit was not applied.');
    }
  } catch (error) {
    try {
      await rollbackBeforeCommit(error);
    } catch (rollbackError) {
      throw createRollbackFailureError(error, [{
        stage: 'restoring in-memory state before the durable commit',
        error: rollbackError,
      }]);
    }
    throw error;
  }

  try {
    await afterCommit(value);
    return { value, committed: true, postCommitError: null, recoveryError: null };
  } catch (postCommitError) {
    let recoveryError = null;
    try {
      await restoreCommittedMemory(value, postCommitError);
    } catch (error) {
      recoveryError = error;
    }
    return { value, committed: true, postCommitError, recoveryError };
  }
}

/**
 * Returns true when an operation failed while compensating an earlier change.
 * The durable outcome is then uncertain, so callers must not offer an inline
 * retry that could apply the same user intent twice.
 */
export function isRollbackIntegrityFailure(error) {
  if (error === null || typeof error !== 'object') return false;
  if (error instanceof AggregateError || error.name === 'AggregateError') return true;
  return Array.isArray(error.rollbackFailures) && error.rollbackFailures.length > 0;
}

export function withoutOperationRecord(history, operationId) {
  const operations = Array.isArray(history) ? history : [];
  if (!operationId) return [...operations];
  return operations.filter((operation) => operation?.id !== operationId);
}

export function createRollbackFailureError(originalError, failures = []) {
  const rollbackFailures = Array.isArray(failures) ? failures : [];
  const originalMessage = readableMessage(originalError, 'Operation failed');
  const combined = new Error(
    `${asSentence(originalMessage)} Rollback was incomplete (${rollbackFailureSummary(rollbackFailures)}).`,
  );
  combined.cause = originalError;
  combined.rollbackFailures = rollbackFailures;
  return combined;
}

export function createRollbackAggregateError(subject, failures = [], options) {
  const rollbackFailures = Array.isArray(failures) ? failures : [];
  const combined = new AggregateError(
    rollbackFailures.map((failure) => rollbackFailureCause(failure)),
    `${readableMessage(subject, 'Operation')} rollback was incomplete (${rollbackFailureSummary(rollbackFailures)}).`,
    options,
  );
  combined.rollbackFailures = rollbackFailures;
  return combined;
}

export async function runAutoGroupUndoRollback(rollback, operations) {
  await operations.restoreMemory(rollback);
  const failures = [];
  let liveLayoutRestored = false;
  try {
    await operations.restoreLiveOrganization(rollback.live, rollback.spaceId);
    liveLayoutRestored = true;
  } catch (error) {
    failures.push({ stage: 'restoring the pre-Undo Chrome groups', error });
  }

  if (liveLayoutRestored) {
    try {
      await operations.saveState();
    } catch (error) {
      failures.push({ stage: 'saving the restored pre-Undo state', error });
    }
    try {
      await operations.refreshTabs({ reloadDormant: true });
    } catch (error) {
      failures.push({ stage: 'refreshing the restored pre-Undo view', error });
    }
  } else {
    try {
      await operations.loadTabs({ adopt: false });
      await operations.render();
    } catch (error) {
      failures.push({ stage: 'refreshing after the failed Undo rollback', error });
    }
  }

  if (failures.length > 0) {
    throw createRollbackAggregateError('Auto Group Undo', failures);
  }
}

export function isOperationUndoVisible(operation, now = Date.now(), visibleForMs = 10_000) {
  if (!operation || operation.status === 'undone') return false;
  const createdAt = Number(operation.createdAt);
  const currentTime = Number(now);
  const lifetime = Number(visibleForMs);
  if (
    !Number.isFinite(createdAt) || createdAt <= 0 ||
    !Number.isFinite(currentTime) || currentTime < createdAt ||
    !Number.isFinite(lifetime) || lifetime <= 0
  ) return false;
  return currentTime - createdAt < lifetime;
}

/**
 * Identifies the exact live rows a Tidy Names preview was based on.
 *
 * Chrome tab ids alone are not sufficient: a tab can navigate, finish loading
 * with a different title, or receive a manual panel name while the preview is
 * open. Sorting by id makes the fingerprint independent from incidental view
 * ordering while retaining the user-visible inputs that shaped the proposal.
 */
export function fingerprintTidyNameTargets(tabs = [], renamedTabs = {}, options = {}) {
  const aliases = options?.tabIdAliases && typeof options.tabIdAliases === 'object'
    ? options.tabIdAliases
    : {};
  const targets = (Array.isArray(tabs) ? tabs : [])
    .map((tab) => {
      const liveId = Number(tab?.id);
      if (!Number.isSafeInteger(liveId) || liveId <= 0) return null;
      const alias = Number(aliases[liveId]);
      const id = Number.isSafeInteger(alias) && alias > 0 ? alias : liveId;
      return {
        id,
        url: String(tab?.url || ''),
        title: cleanText(tab?.title),
        pinned: Boolean(tab?.pinned),
        currentName: cleanText(Object.hasOwn(renamedTabs || {}, liveId)
          ? renamedTabs[liveId]
          : tab?.panelTitle),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id - right.id);

  const hash = fnv1a(JSON.stringify(targets));
  return `tidy-target-v${TIDY_TARGET_FINGERPRINT_VERSION}-${hash}-${targets.length}`;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function rollbackFailureSummary(failures) {
  if (failures.length === 0) return 'rollback failure details were unavailable';
  return failures.map((failure, index) => {
    const stage = readableMessage(failure?.stage, `rollback step ${index + 1}`);
    const message = readableMessage(rollbackFailureCause(failure), 'unknown error');
    return `${stage}: ${message}`;
  }).join('; ');
}

function rollbackFailureCause(failure) {
  if (failure && typeof failure === 'object' && !(failure instanceof Error)) {
    return failure.error;
  }
  return failure;
}

function readableMessage(value, fallback) {
  const candidate = value instanceof Error ? value.message : value;
  if (typeof candidate !== 'string') return fallback;
  return candidate.replace(/\s+/g, ' ').trim() || fallback;
}

function asSentence(value) {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}
