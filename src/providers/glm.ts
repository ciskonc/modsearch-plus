// Zhipu GLM Web Search API (https://open.bigmodel.cn/api/paas/v4/web_search).
// In-process fetch engine, search only, in the same shape as tavily.ts.
//
// This is a pure retrieval API: no LLM runs on the search side, so the answer
// comes back as structured metadata (title, summary, link, publish date)
// rather than a written answer, and the summary modsearch reports is
// mechanical. It is billed per call (0.01-0.05 CNY depending on the search
// engine) against the account balance: a coding-plan key covers model calls,
// not this service, so an unfunded account answers 429 with code 1113.
import { ApiKeyFailureError, isQuotaFailureMessage, splitApiKeys } from '../util/apiKeys.ts';
import { redactSecrets } from '../util/redact.ts';
import { requestText } from '../util/timedRequest.ts';
import { resolveEndpoint } from './endpoint.ts';
import type { EngineOutput, EngineRequest, SearchEngine } from './index.ts';

const DEFAULT_MAX_RESULTS = 10;
/** The API accepts 1-50. */
const MAX_RESULTS_CEILING = 50;
/** The API caps the query at 70 characters. */
const MAX_QUERY_LENGTH = 70;
const GLM_DEFAULT_BASE = 'https://open.bigmodel.cn';
/** Zhipu's own search engines, cheapest first. */
export const GLM_SEARCH_ENGINES = [
  'search_std',
  'search_pro',
  'search_pro_sogou',
  'search_pro_quark',
] as const;
export type GlmSearchEngine = (typeof GLM_SEARCH_ENGINES)[number];
/** search_pro_sogou only accepts these result counts. */
const SOGOU_COUNTS = [10, 20, 30, 40, 50];

/**
 * Environment variables that may hold a Zhipu key. The first one is the name
 * the config layer binds (so `modsearch config show` reports it), the rest are
 * read here because harnesses and coding plans ship the key under their own
 * name.
 */
const GLM_KEY_ENV_NAMES = [
  'ZAI_API_KEY',
  'ZHIPUAI_API_KEY',
  'ZAI_CODING_CN_API_KEY',
  'BIGMODEL_API_KEY',
];

interface GlmSearchResult {
  title?: string;
  content?: string;
  link?: string;
  media?: string;
  publish_date?: string;
}

interface GlmResponse {
  id?: string;
  created?: number;
  request_id?: string;
  search_result?: GlmSearchResult[];
}

/** Every configured key, file first, then the environment aliases. */
function resolveApiKeys(settings: { apiKey?: string }, env: NodeJS.ProcessEnv): string[] {
  const fromSettings = splitApiKeys(settings.apiKey);
  if (fromSettings.length > 0) {
    return fromSettings;
  }
  const fromEnv: string[] = [];
  for (const name of GLM_KEY_ENV_NAMES) {
    fromEnv.push(...splitApiKeys(env[name]));
  }
  return fromEnv;
}

/** The search engine code, from the engine setting, defaulting to the cheap one. */
function resolveSearchEngine(settings: { model?: string }): GlmSearchEngine {
  const requested = settings.model?.trim();
  if (requested && (GLM_SEARCH_ENGINES as readonly string[]).includes(requested)) {
    return requested as GlmSearchEngine;
  }
  return 'search_std';
}

/** Zhipu's own error envelope, in both documented shapes. */
function errorCode(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown }; code?: unknown };
    const code = parsed?.error?.code ?? parsed?.code;
    return code === undefined || code === null ? '' : String(code);
  } catch {
    return '';
  }
}

export async function executeGlmSearch(options: EngineRequest): Promise<EngineOutput> {
  if (options.mode === 'fetch') {
    throw new Error('The glm engine does not support page fetch (-u). It searches only.');
  }
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }

  const env = process.env;
  const apiKeys = resolveApiKeys(options.settings, env);
  const apiKey = apiKeys[0];
  const apiKeySecrets = [...new Set([...apiKeys, ...(options.apiKeySecrets ?? [])])];
  if (!apiKey) {
    throw new Error(
      'The glm provider needs an API key. Set ZAI_API_KEY, or run: modsearch config set glm.apiKey <key> (Web Search API: https://open.bigmodel.cn). Note the balance is billed per search call.',
    );
  }

  const searchEngine = resolveSearchEngine(options.settings);
  const requested = options.maxResults ?? DEFAULT_MAX_RESULTS;
  let count = Math.min(Math.max(requested, 1), MAX_RESULTS_CEILING);
  if (searchEngine === 'search_pro_sogou' && !SOGOU_COUNTS.includes(count)) {
    count = SOGOU_COUNTS.reduce((best, value) =>
      Math.abs(value - count) < Math.abs(best - count) ? value : best,
    );
  }

  // The API caps the query at 70 characters. Truncating is friendlier than
  // letting the call fail, and the truncation is reported so nobody reads a
  // shortened query as the whole question.
  const fullQuery = options.query.trim();
  const searchQuery = fullQuery.slice(0, MAX_QUERY_LENGTH);
  const truncated = searchQuery.length < fullQuery.length;

  const startedAt = Date.now();
  const { response, text } = await requestText(
    'glm',
    resolveEndpoint(options.settings.baseURL, GLM_DEFAULT_BASE, '/api/paas/v4/web_search'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        search_query: searchQuery,
        search_engine: searchEngine,
        // Intent recognition rewrites the query before searching; the raw
        // query is what the caller asked for, so it is skipped.
        search_intent: false,
        count,
      }),
    },
    AbortSignal.timeout(options.timeoutMs),
    options.timeoutMs,
    [...apiKeySecrets, options.settings.baseURL],
  );

  if (!response.ok) {
    const detail = redactSecrets(text.trim(), [...apiKeySecrets, options.settings.baseURL]);
    const code = errorCode(text);
    const message = `glm returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`;
    if (response.status >= 500) {
      throw new Error(message);
    }
    // 1113 is the unfunded-account code, and the Web Search API is billed
    // separately from the model calls a coding plan covers. It is a lasting
    // limit, so the cooldown layer holds the engine instead of re-hitting it.
    if (code === '1113' || response.status === 402 || isQuotaFailureMessage(detail)) {
      throw new ApiKeyFailureError(
        `glm has no search balance (${code || `HTTP ${response.status}`}).${detail ? ` ${detail}` : ''} Top up at https://open.bigmodel.cn, or search with another engine.`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiKeyFailureError(
        `glm rejected the API key (${response.status}). Fix it: modsearch config set glm.apiKey <key>${detail ? ` (${detail})` : ''}`,
      );
    }
    // 1302 (account rate limit) and 1701 (search concurrency) are transient:
    // they belong in the fallback chain, not in the cooldown list.
    throw new Error(message);
  }

  const data = JSON.parse(text) as GlmResponse;

  const items = (data.search_result ?? []).map((r) => {
    const item: {
      title: string;
      url: string;
      snippet: string;
      source: string | undefined;
      published_at?: string;
    } = {
      title: r.title ?? '',
      url: r.link ?? '',
      // The field is the page summary text, not HTML.
      snippet: r.content ?? '',
      source: r.link ? safeHostname(r.link) : undefined,
    };
    if (r.publish_date) {
      item.published_at = r.publish_date;
    }
    return item;
  });

  const uncertainty: string[] = [];
  if (items.length === 0) {
    uncertainty.push('No results found for this query.');
  }
  if (truncated) {
    uncertainty.push(
      `The query was truncated to ${MAX_QUERY_LENGTH} characters, the limit the glm Web Search API puts on search_query.`,
    );
  }

  const result = {
    summary:
      items.length > 0
        ? `Zhipu GLM (${searchEngine}) returned ${items.length} result(s) for "${searchQuery}". Read items for the sources.`
        : '',
    items,
    uncertainty,
    warnings: [
      'The glm Web Search API returns structured search results without an LLM summary, so the summary is mechanical: read items directly for the evidence.',
    ],
  };

  return {
    result,
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { resultCount: items.length, searchEngine, requestId: data.request_id ?? null },
    },
  };
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export const glmProvider: SearchEngine = {
  name: 'glm',
  roles: ['search'],
  requirement:
    'set a Zhipu API key with search balance (modsearch config set glm.apiKey <key>; Web Search API is billed per call at https://open.bigmodel.cn)',
  isAvailable: (settings, env) => resolveApiKeys(settings, env).length > 0,
  defaultModel: 'search_std',
  execute: executeGlmSearch,
};
