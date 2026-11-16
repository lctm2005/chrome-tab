import {
  normalizeAIProviderSettings,
  providerRequiresApiKey,
} from './ai-providers.js';

export function aiAuthScope(settings = {}) {
  const normalized = normalizeAIProviderSettings(settings);
  return {
    provider: normalized.provider,
    baseUrl: normalized.baseUrl,
  };
}

export function createScopedAIAuth(settings = {}) {
  const apiKey = providerRequiresApiKey(settings)
    ? String(settings?.apiKey || '').trim()
    : '';
  if (!apiKey) return null;
  return {
    apiKey,
    ...aiAuthScope(settings),
  };
}

export function scopedAIKey(auth, settings = {}) {
  if (!auth || typeof auth !== 'object') return '';
  const apiKey = String(auth.apiKey || '').trim();
  if (!apiKey) return '';
  const scope = aiAuthScope(settings);
  if (String(auth.provider || '') !== scope.provider) return '';
  if (String(auth.baseUrl || '') !== scope.baseUrl) return '';
  return apiKey;
}

/**
 * Recovers a stored key whose endpoint scope drifted from the current
 * settings, for example when a provider catalog renames a base URL. A key for
 * the same provider is still the user's key: it is returned with `drifted`
 * so the caller can rewrite the stored scope instead of losing the secret.
 * Keys bound to another provider stay invisible rather than being adopted.
 */
export function reconcileScopedAIKey(auth, settings = {}) {
  const strict = scopedAIKey(auth, settings);
  if (strict) return { apiKey: strict, drifted: false };
  if (!auth || typeof auth !== 'object') return null;
  const apiKey = String(auth.apiKey || '').trim();
  if (!apiKey) return null;
  const scope = aiAuthScope(settings);
  if (String(auth.provider || '') !== scope.provider) return null;
  return { apiKey, drifted: true };
}

export function assertSafeAIAuthTransport(settings = {}) {
  const apiKey = String(settings?.apiKey || '').trim();
  if (!apiKey || !providerRequiresApiKey(settings)) return true;
  const { baseUrl } = aiAuthScope(settings);
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Enter a valid http(s) AI Base URL.');
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return true;
  throw new Error('API keys require HTTPS unless the AI endpoint is on localhost.');
}

export async function persistScopedAIConfiguration(settings, operations) {
  const auth = createScopedAIAuth(settings);
  const [previousSettings, previousAuth] = await Promise.all([
    operations.readSettings(),
    operations.readAuth(),
  ]);
  const steps = auth
    ? [
      {
        apply: () => operations.persistSettings(),
        rollback: () => operations.restoreSettings(previousSettings),
      },
      {
        apply: () => operations.persistAuth(auth),
        rollback: () => operations.restoreAuth(previousAuth),
      },
    ]
    : clearStepsFor(settings, operations, previousAuth, previousSettings);
  const attempted = [];
  try {
    for (const step of steps) {
      attempted.push(step);
      await step.apply();
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const step of attempted.reverse()) {
      try {
        await step.rollback();
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        `${error instanceof Error ? error.message : String(error)} AI configuration rollback was incomplete.`,
        { cause: error },
      );
    }
    throw error;
  }
  return auth;
}

/**
 * Builds the steps for saving settings without a key. A stored key is only
 * cleared when the current settings still resolve to the same scope, meaning
 * the user saw this exact key in the form and removed it. A secret saved for
 * a different (or unreadable) scope survives, because the form could not have
 * been showing it and clearing it would silently destroy recoverable data.
 */
function clearStepsFor(settings, operations, previousAuth, previousSettings) {
  const extract = typeof operations?.authFromSnapshot === 'function'
    ? operations.authFromSnapshot
    : (snapshot) => snapshot;
  const candidate = extract(previousAuth);
  const scoped = candidate && typeof candidate === 'object'
    ? createScopedAIAuth(candidate)
    : null;
  const scope = aiAuthScope(settings);
  const ownsStoredKey = !scoped || (
    scoped.provider === scope.provider &&
    scoped.baseUrl === scope.baseUrl
  );
  const clearStep = {
    apply: () => operations.clearAuth(),
    rollback: () => operations.restoreAuth(previousAuth),
  };
  const settingsStep = {
    apply: () => operations.persistSettings(),
    rollback: () => operations.restoreSettings(previousSettings),
  };
  return ownsStoredKey ? [clearStep, settingsStep] : [settingsStep];
}

function isLoopbackHostname(value) {
  const hostname = String(value).toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1') return true;
  const octets = hostname.split('.').map(Number);
  return octets.length === 4 && octets[0] === 127 && octets.every((octet) => (
    Number.isInteger(octet) && octet >= 0 && octet <= 255
  ));
}
