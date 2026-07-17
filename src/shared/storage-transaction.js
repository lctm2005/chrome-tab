export async function persistStoragePair(first, second) {
  const [firstBefore, secondBefore] = await Promise.all([
    readStep(first),
    readStep(second),
  ]);
  const attempted = [];
  try {
    attempted.push({ step: first, before: firstBefore });
    await writeStep(first);
    attempted.push({ step: second, before: secondBefore });
    await writeStep(second);
  } catch (error) {
    const rollbackErrors = [];
    for (const item of attempted.reverse()) {
      try {
        await restoreStep(item.step, item.before);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `${errorMessage(error)}. Storage rollback also failed.`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Persists one storage key with compensation for an ambiguous failed write.
 *
 * A browser storage Promise can reject after the host has already applied the
 * value. Restoring the previously observed key makes a reported failure an
 * actual no-op from the user's perspective.
 */
export async function persistStorageStep(step) {
  const before = await readStep(step);
  try {
    await writeStep(step);
  } catch (error) {
    try {
      await restoreStep(step, before);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `${errorMessage(error)}. Storage rollback also failed.`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function readStep(step) {
  const stored = await step.get();
  return {
    present: Object.prototype.hasOwnProperty.call(stored || {}, step.key),
    value: stored?.[step.key],
  };
}

function writeStep(step) {
  return step.set({ [step.key]: step.value });
}

function restoreStep(step, before) {
  return before.present
    ? step.set({ [step.key]: before.value })
    : step.remove(step.key);
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}
