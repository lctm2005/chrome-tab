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
