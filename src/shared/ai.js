export function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
  return trimmed.replace(/\/chat\/completions$/, '');
}

export function getOriginPattern(baseUrl) {
  const url = new URL(normalizeBaseUrl(baseUrl));
  return `${url.protocol}//${url.host}/*`;
}

export function getZaiFallbackBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized === 'https://api.z.ai/api/paas/v4') {
    return 'https://api.z.ai/api/coding/paas/v4';
  }
  return '';
}

export function buildChatCompletionRequest(settings, messages) {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey || ''}`,
  };
  const body = {
    model: settings.model,
    messages,
    stream: false,
    temperature: Number(settings.temperature ?? 0.6),
    max_tokens: Number(settings.maxTokens ?? 2048),
  };

  if (settings.model === 'glm-5.1' || String(settings.model || '').startsWith('glm-5')) {
    body.thinking = {
      type: settings.thinking === 'enabled' ? 'enabled' : 'disabled',
    };
  }

  return {
    url: `${baseUrl}/chat/completions`,
    method: 'POST',
    headers,
    body,
  };
}

export function extractAssistantText(payload) {
  const choice = payload?.choices?.[0];
  return choice?.message?.content || choice?.delta?.content || '';
}

export function languageInstruction(language) {
  if (language === 'zh-CN') return 'Respond in Simplified Chinese.';
  if (language === 'en') return 'Respond in English.';
  if (language === 'auto') return 'Respond in the same language as the user question or the page content.';
  return `Respond in ${language}.`;
}

export function formatAIError(error) {
  const message = String(error?.message || error || '').trim();
  if (/insufficient|balance|quota|余额不足|账户余额/i.test(message)) {
    return 'AI provider rejected the request: insufficient balance. Update the BYOK account or API key in Settings.';
  }
  if (/401|403|unauthorized|forbidden|api key|invalid key/i.test(message)) {
    return 'AI provider rejected the request: check the BYOK API key and model settings.';
  }
  return message || 'AI request failed.';
}

export function createPrompt(kind, context = {}) {
  const instruction = languageInstruction(context.language || 'auto');
  if (kind === 'summarize-page') {
    return [
      {
        role: 'system',
        content: `You summarize browser pages for a compact tab sidebar. Be specific, concise, and action-oriented. ${instruction}`,
      },
      {
        role: 'user',
        content: `Title: ${context.title || 'Untitled'}\nURL: ${context.url || ''}\n\nPage text:\n${context.text || ''}\n\nReturn: 5 bullets, key entities, and suggested next action.`,
      },
    ];
  }

  if (kind === 'tidy-tabs') {
    return [
      {
        role: 'system',
        content: 'Group browser tabs into concise work buckets. Return only JSON: [{"title":"Group","tabIds":[1,2],"color":"blue"}].',
      },
      {
        role: 'user',
        content: JSON.stringify(context.tabs || []),
      },
    ];
  }

  return [
    {
      role: 'system',
      content: `You are an AI assistant embedded in a browser tab sidebar. Keep answers concise and useful. ${instruction}`,
    },
    {
      role: 'user',
      content: context.prompt || '',
    },
  ];
}

export function parseTidyGroups(text) {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((group) => ({
        title: String(group.title || 'Tabs').slice(0, 32),
        color: normalizeGroupColor(group.color),
        tabIds: Array.isArray(group.tabIds)
          ? group.tabIds.map((id) => Number(id)).filter(Number.isFinite)
          : [],
      }))
      .filter((group) => group.tabIds.length > 0);
  } catch {
    return [];
  }
}

function normalizeGroupColor(color) {
  const allowed = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
  return allowed.has(color) ? color : 'blue';
}
