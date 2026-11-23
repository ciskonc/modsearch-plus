// MiniMax search, two shapes, two engines.
//
// 1. `minimax` — the model-free search endpoint (`/v1/coding_plan/search`).
//    This is the endpoint the official MiniMax MCP server calls, so the
//    results are plain search hits (title, link, snippet, date) with no model
//    in the loop: fast, cheap, and nothing rewrites the evidence.
//
// 2. `minimax-websearch` — MiniMax's server-side `web_search` tool, run
//    through the Anthropic-compatible Messages API. The model performs the
//    search and writes an answer with citations, so this engine returns a
//    written summary plus the search results it used. It costs a model call
//    on top of the search itself, and takes noticeably longer.
//
// Docs: https://platform.minimax.cn/docs/guides/server-tools
// The model-free endpoint is not in the public API reference; it is the
// endpoint of https://github.com/MiniMax-AI/MiniMax-Coding-Plan-MCP
import { ApiKeyFailureError, isQuotaFailureMessage, splitApiKeys } from '../util/apiKeys.ts';
import { normalizePublishedAt } from '../util/paths.ts';
import { redactSecrets } from '../util/redact.ts';
import { requestText } from '../util/timedRequest.ts';
import { resolveEndpoint } from './endpoint.ts';
import type { EngineOutput, EngineRequest, SearchEngine } from './index.ts';

const MINIMAX_DEFAULT_BASE = 'https://api.minimax.cn';
const DEFAULT_MAX_RESULTS = 10;
/** MiniMax's current flagship, the model its own docs use for web_search. */
const DEFAULT_MODEL = 'MiniMax-M3.1-Flash';
/** Enough for a cited answer without paying for a long essay. */
const DEFAULT_MAX_TOKENS = 4096;
/**
 * Environment variables that may hold a MiniMax key. The first is the name
 * the config layer binds; the rest are read here because M Plan and coding
 * plan harnesses ship the key under their own name. A key is bound to the
 * region of the account it came from, so the host has to match too.
 */
const MINIMAX_KEY_ENV_NAMES = ['MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY'];

interface MinimaxOrganic {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

interface MinimaxSearchResponse {
  organic?: MinimaxOrganic[];
  related_searches?: Array<{ query?: string }>;
  base_resp?: { status_code?: number; status_msg?: string };
}

/** One content block of an Anthropic-style message. */
interface MinimaxContentBlock {
  type?: string;
  text?: string;
  input?: { query?: string };
  content?: Array<{
    type?: string;
    title?: string;
    url?: string;
    page_age?: string;
    content?: string;
  }>;
}

interface MinimaxMessageResponse {
  content?: MinimaxContentBlock[];
  stop_reason?: string;
}

/** Every configured key, file first, then the environment aliases. */
function resolveApiKeys(settings: { apiKey?: string }, env: NodeJS.ProcessEnv): string[] {
  const fromSettings = splitApiKeys(settings.apiKey);
  if (fromSettings.length > 0) {
    return fromSettings;
  }
  const fromEnv: string[] = [];
  for (const name of MINIMAX_KEY_ENV_NAMES) {
    fromEnv.push(...splitApiKeys(env[name]));
  }
  return fromEnv;
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * The model-free search path. Mirrors what the official MCP server posts:
 * `{"q": query}` with a Bearer key and the `MM-API-Source` marker.
 */
export async function executeMinimaxSearch(options: EngineRequest): Promise<EngineOutput> {
  if (options.mode === 'fetch') {
    throw new Error('The minimax engine does not support page fetch (-u). It searches only.');
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
      'The minimax provider needs an API key. Set MINIMAX_API_KEY, or run: modsearch config set minimax.apiKey <key> (M Plan subscription key: https://platform.minimax.cn/docs/m-plan/quickstart).',
    );
  }

  const startedAt = Date.now();
  const { response, text } = await requestText(
    'minimax',
    resolveEndpoint(options.settings.baseURL, MINIMAX_DEFAULT_BASE, '/v1/coding_plan/search'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        // The marker the official MCP server sends; it tells MiniMax the call
        // comes from the coding-plan tooling.
        'MM-API-Source': 'Minimax-MCP',
      },
      body: JSON.stringify({ q: options.query.trim() }),
    },
    AbortSignal.timeout(options.timeoutMs),
    options.timeoutMs,
    [...apiKeySecrets, options.settings.baseURL],
  );

  if (!response.ok) {
    const detail = redactSecrets(text.trim(), [...apiKeySecrets, options.settings.baseURL]);
    const message = `minimax returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`;
    if (response.status >= 500) {
      throw new Error(message);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiKeyFailureError(
        `minimax rejected the API key (${response.status}). A key only works on the host of its own region: api.minimax.cn for mainland accounts, api.minimax.io for global ones.${detail ? ` (${detail})` : ''}`,
      );
    }
    if (isQuotaFailureMessage(detail)) {
      throw new ApiKeyFailureError(
        `minimax ran out of quota (HTTP ${response.status}).${detail ? ` ${detail}` : ''} Check the plan balance at https://platform.minimax.cn, or search with another engine.`,
      );
    }
    throw new Error(message);
  }

  const data = JSON.parse(text) as MinimaxSearchResponse;

  // This endpoint reports failures inside a 200 response: the MCP server reads
  // base_resp.status_code rather than the HTTP status.
  const statusCode = data.base_resp?.status_code;
  if (statusCode !== undefined && statusCode !== 0) {
    const statusMessage = data.base_resp?.status_msg ?? '';
    const detail = redactSecrets(statusMessage, [...apiKeySecrets, options.settings.baseURL]);
    if (statusCode === 1004) {
      throw new ApiKeyFailureError(
        `minimax rejected the API key (status ${statusCode}). Check the key and the host region: api.minimax.cn for mainland accounts, api.minimax.io for global ones.${detail ? ` (${detail})` : ''}`,
      );
    }
    if (statusCode === 2038) {
      throw new ApiKeyFailureError(
        `minimax requires a verified account (status ${statusCode}). Finish the real-name verification at https://platform.minimax.cn.${detail ? ` (${detail})` : ''}`,
      );
    }
    throw new Error(`minimax search failed (status ${statusCode}).${detail ? ` ${detail}` : ''}`);
  }

  const all = data.organic ?? [];
  const items = all.slice(0, options.maxResults ?? DEFAULT_MAX_RESULTS).map((r) => {
    const item: {
      title: string;
      url: string;
      snippet: string;
      source: string | undefined;
      published_at?: string;
    } = {
      title: r.title ?? '',
      url: r.link ?? '',
      snippet: r.snippet ?? '',
      source: r.link ? safeHostname(r.link) : undefined,
    };
    const published = normalizePublishedAt(r.date);
    if (published) {
      item.published_at = published;
    }
    return item;
  });

  const result = {
    summary:
      items.length > 0
        ? `MiniMax returned ${items.length} search result(s) for "${options.query.trim()}". Read items for the sources.`
        : '',
    items,
    uncertainty: items.length === 0 ? ['No results found for this query.'] : [],
    warnings: [
      'MiniMax search returns raw search hits without an LLM summary, so the summary is mechanical: read items directly for the evidence.',
    ],
  };

  return {
    result,
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: {
        resultCount: items.length,
        relatedSearches: (data.related_searches ?? []).length,
      },
    },
  };
}

/**
 * The server-side web_search tool, run through the Anthropic-compatible
 * Messages API. The model searches and writes the answer; the search results
 * it used come back as their own content block.
 */
export async function executeMinimaxWebSearch(options: EngineRequest): Promise<EngineOutput> {
  if (options.mode === 'fetch') {
    throw new Error(
      'The minimax-websearch engine does not support page fetch (-u). It searches only.',
    );
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
      'The minimax-websearch provider needs an API key. Set MINIMAX_API_KEY, or run: modsearch config set minimax-websearch.apiKey <key>.',
    );
  }

  const model = options.settings.model?.trim() || options.model || DEFAULT_MODEL;
  const startedAt = Date.now();
  const { response, text } = await requestText(
    'minimax-websearch',
    resolveEndpoint(options.settings.baseURL, MINIMAX_DEFAULT_BASE, '/anthropic/v1/messages'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: [{ role: 'user', content: options.query.trim() }],
        // The Anthropic-compatible endpoint wants the versioned tool type.
        // The OpenAI-compatible one uses the bare "web_search" instead.
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      }),
    },
    AbortSignal.timeout(options.timeoutMs),
    options.timeoutMs,
    [...apiKeySecrets, options.settings.baseURL],
  );

  if (!response.ok) {
    const detail = redactSecrets(text.trim(), [...apiKeySecrets, options.settings.baseURL]);
    const message = `minimax-websearch returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`;
    if (response.status >= 500) {
      throw new Error(message);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiKeyFailureError(
        `minimax rejected the API key (${response.status}). A key only works on the host of its own region: api.minimax.cn for mainland accounts, api.minimax.io for global ones.${detail ? ` (${detail})` : ''}`,
      );
    }
    if (isQuotaFailureMessage(detail)) {
      throw new ApiKeyFailureError(
        `minimax ran out of quota (HTTP ${response.status}).${detail ? ` ${detail}` : ''} Check the plan balance at https://platform.minimax.cn, or search with another engine.`,
      );
    }
    throw new Error(message);
  }

  const data = JSON.parse(text) as MinimaxMessageResponse;
  const blocks = data.content ?? [];

  const items: Array<{
    title: string;
    url: string;
    snippet: string;
    source: string | undefined;
    published_at?: string;
  }> = [];
  const texts: string[] = [];
  const queries: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      texts.push(block.text);
    }
    if (block.type === 'server_tool_use' && block.input?.query) {
      queries.push(block.input.query);
    }
    if (block.type === 'web_search_tool_result') {
      for (const entry of block.content ?? []) {
        const item: {
          title: string;
          url: string;
          snippet: string;
          source: string | undefined;
          published_at?: string;
        } = {
          title: entry.title ?? '',
          url: entry.url ?? '',
          snippet: entry.content ?? '',
          source: entry.url ? safeHostname(entry.url) : undefined,
        };
        // page_age is optional: MiniMax omits it on some results.
        const published = normalizePublishedAt(entry.page_age);
        if (published) {
          item.published_at = published;
        }
        items.push(item);
      }
    }
  }

  const limit = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const keptItems = items.slice(0, limit);
  const summary = texts.join('\n\n').trim();
  const uncertainty: string[] = [];
  if (keptItems.length === 0) {
    uncertainty.push('The model answered without returning search results, so no source links are attached.');
  }
  if (data.stop_reason === 'pause_turn') {
    uncertainty.push(
      'MiniMax stopped at its search limit (pause_turn), so the answer may be incomplete: raise the model turn budget or ask a narrower question.',
    );
  }

  const result = {
    summary,
    items: keptItems,
    uncertainty,
    warnings: [
      'minimax-websearch runs a model with the server-side web_search tool, so the summary is written by that model: check the items for the underlying sources.',
      ...(queries.length > 0 ? [`The model searched for: ${queries.join('; ')}`] : []),
    ],
  };

  return {
    result,
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { resultCount: keptItems.length, model, searches: queries.length },
    },
  };
}

export const minimaxProvider: SearchEngine = {
  name: 'minimax',
  roles: ['search'],
  requirement:
    'set a MiniMax key (M Plan subscription key: modsearch config set minimax.apiKey <key>, https://platform.minimax.cn)',
  isAvailable: (settings, env) => resolveApiKeys(settings, env).length > 0,
  execute: executeMinimaxSearch,
};

export const minimaxWebSearchProvider: SearchEngine = {
  name: 'minimax-websearch',
  roles: ['search'],
  requirement:
    'set a MiniMax key (modsearch config set minimax-websearch.apiKey <key>); runs a model call with the server-side web_search tool, so it costs a model call plus the search',
  isAvailable: (settings, env) => resolveApiKeys(settings, env).length > 0,
  defaultModel: DEFAULT_MODEL,
  execute: executeMinimaxWebSearch,
};
