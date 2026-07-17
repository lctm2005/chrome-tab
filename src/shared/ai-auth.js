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
    : [
      {
        apply: () => operations.clearAuth(),
        rollback: () => operations.restoreAuth(previousAuth),
      },
      {
        apply: () => operations.persistSettings(),
        rollback: () => operations.restoreSettings(previousSettings),
      },
    ];
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

function isLoopbackHostname(value) {
  const hostname = String(value).toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1') return true;
  const octets = hostname.split('.').map(Number);
  return octets.length === 4 && octets[0] === 127 && octets.every((octet) => (
    Number.isInteger(octet) && octet >= 0 && octet <= 255
  ));
}
