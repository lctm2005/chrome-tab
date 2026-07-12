export const CUSTOM_AI_PROVIDER_ID = 'openai-compatible';

export const AI_PROVIDER_CATALOG = [
  {
    id: 'z-ai',
    label: 'Z.ai / GLM',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    editableBaseUrl: false,
    models: [
      { id: 'glm-5.2', label: 'GLM-5.2' },
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
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview' },
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
  const provider = settings.provider
    ? providerById(settings.provider)
    : providerForBaseUrl(settings.baseUrl) || customProvider();
  return provider.requiresApiKey !== false;
}

export function normalizeAIProviderSettings(settings = {}) {
  const detectedProvider = settings.provider
    ? providerById(settings.provider)
    : providerForBaseUrl(settings.baseUrl) || customProvider();
  const provider = detectedProvider || customProvider();
  const model = normalizedProviderModel(provider, settings.model);

  if (provider.id === CUSTOM_AI_PROVIDER_ID) {
    return {
      ...settings,
      provider: CUSTOM_AI_PROVIDER_ID,
      baseUrl: normalizeProviderUrl(settings.baseUrl),
      model,
    };
  }

  return {
    ...settings,
    provider: provider.id,
    baseUrl: provider.baseUrl,
    model,
  };
}

function normalizedProviderModel(provider, model) {
  const value = String(model || '').trim();
  if (!provider.models.length) return value;
  if (provider.models.some((item) => item.id === value)) return value;
  return provider.models[0].id;
}

function customProvider() {
  return AI_PROVIDER_CATALOG.find((provider) => provider.id === CUSTOM_AI_PROVIDER_ID);
}

function normalizeProviderUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}
