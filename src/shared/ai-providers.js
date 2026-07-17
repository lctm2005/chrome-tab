export const CUSTOM_AI_PROVIDER_ID = 'openai-compatible';

export const AI_PROVIDER_CATALOG = [
  {
    id: 'z-ai',
    label: 'Z.ai / GLM',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    editableBaseUrl: false,
    models: [
      {
        id: 'glm-5.2',
        label: 'GLM-5.2',
        documentationUrl: 'https://docs.z.ai/guides/llm/glm-5.2',
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    editableBaseUrl: false,
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    editableBaseUrl: false,
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    editableBaseUrl: false,
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    editableBaseUrl: false,
    requiresApiKey: false,
    models: [],
  },
  {
    id: CUSTOM_AI_PROVIDER_ID,
    label: 'Custom OpenAI-compatible',
    baseUrl: '',
    editableBaseUrl: true,
    models: [],
  },
];

export function providerById(id) {
  return AI_PROVIDER_CATALOG.find((provider) => provider.id === id) || customProvider();
}

export function providerForBaseUrl(baseUrl) {
  const normalized = normalizeProviderUrl(baseUrl);
  if (!normalized) return null;
  return AI_PROVIDER_CATALOG
    .filter((provider) => provider.id !== CUSTOM_AI_PROVIDER_ID)
    .find((provider) => normalizeProviderUrl(provider.baseUrl) === normalized) || null;
}

export function providerRequiresApiKey(settings = {}) {
  const value = settings && typeof settings === 'object' ? settings : {};
  const provider = value.provider
    ? providerById(value.provider)
    : providerForBaseUrl(value.baseUrl) || customProvider();
  return provider.requiresApiKey !== false;
}

export function providerSupportsThinking(settings = {}) {
  const value = settings && typeof settings === 'object' ? settings : {};
  const provider = value.provider
    ? providerById(value.provider)
    : providerForBaseUrl(value.baseUrl) || customProvider();
  const model = String(value.model || '').trim().toLowerCase();
  if (provider.id === 'deepseek') return /^deepseek-v4(?:-|$)/.test(model);
  if (provider.id === 'z-ai') return supportsGlmThinking(model);
  if (provider.id !== CUSTOM_AI_PROVIDER_ID) return false;
  return /^deepseek-v4(?:-|$)/.test(model) || supportsGlmThinking(model);
}

export function normalizeAIProviderSettings(settings = {}) {
  const value = settings && typeof settings === 'object' ? settings : {};
  const provider = value.provider
    ? providerById(value.provider)
    : providerForBaseUrl(value.baseUrl) || customProvider();
  const model = normalizedProviderModel(provider, value.model);

  if (provider.id === CUSTOM_AI_PROVIDER_ID) {
    return {
      ...value,
      provider: CUSTOM_AI_PROVIDER_ID,
      baseUrl: normalizeProviderUrl(value.baseUrl),
      model,
    };
  }

  return {
    ...value,
    provider: provider.id,
    baseUrl: provider.baseUrl,
    model,
  };
}

function normalizedProviderModel(provider, model) {
  const value = String(model || '').trim();
  // Keep built-in Z.ai users on the current flagship when the catalog advances.
  if (provider.id === 'z-ai' && value.toLowerCase() === 'glm-5.1') {
    return provider.models[0]?.id || '';
  }
  if (value) return value;
  return provider.models[0]?.id || '';
}

function supportsGlmThinking(model) {
  if (/^glm-5(?:[.\-]|$)/.test(model)) return true;
  const match = model.match(/^glm-4\.(\d+)(?:[.\-]|$)/);
  return Boolean(match && Number(match[1]) >= 5);
}

function customProvider() {
  return AI_PROVIDER_CATALOG.find((provider) => provider.id === CUSTOM_AI_PROVIDER_ID);
}

function normalizeProviderUrl(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');
  if (!normalized) return '';
  try {
    return new URL(normalized).toString().replace(/\/+$/, '');
  } catch {
    return normalized;
  }
}
