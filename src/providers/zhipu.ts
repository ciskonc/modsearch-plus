// Zhipu (智谱) web search, one engine over two billing channels.
//
// The vendor sells the same search two ways: the coding plan carries a
// plan-exclusive remote MCP endpoint whose calls draw down plan credits, and
// the account balance bills a Web Search REST API per call. Until 5.10.x these
// were two engines (glm-coding, glm) that sat in the chain as each other's
// fallback; they are one engine now, and the choice lives in the engine's
// `channel` setting:
//
//   'auto'   (default) try the plan MCP first, fall back to the REST API when
//            the plan channel fails — the old two-engine degradation, inside
//            one engine, so the chain spends one slot on Zhipu.
//   'coding' plan MCP only; a plan-less key answers with the MCP error.
//   'rest'   REST API only; billed per call (0.01 CNY from search_std) against
//            the account balance.
//
// Both transports search only (no page fetch) and return structured hits with
// no model in the loop, so summaries are mechanical. A coding-plan key is NOT
// valid for the REST API: an unfunded account answers 429 with code 1113.
import { ApiKeyFailureError, isQuotaFailureMessage, splitApiKeys } from '../util/apiKeys.ts';
import { redactSecrets } from '../util/redact.ts';
import { requestText } from '../util/timedRequest.ts';
import { resolveEndpoint } from './endpoint.ts';
import type { EngineOutput, EngineRequest, SearchEngine } from './index.ts';

export type ZhipuChannel = 'auto' | 'coding' | 'rest';
const CHANNELS: readonly ZhipuChannel[] = ['auto', 'coding', 'rest'];

/** The channel setting a run uses, defaulting to auto. */
export function resolveChannel(settings: { channel?: string }): ZhipuChannel {
  const requested = settings.channel?.trim().toLowerCase();
  return (CHANNELS as readonly string[]).includes(requested ?? '') ? (requested as ZhipuChannel) : 'auto';
}

/** The REST API's default base; the MCP server shares it. */
const DEFAULT_BASE = 'https://open.bigmodel.cn';
const MCP_PATH = '/api/mcp/web_search_prime/mcp';
const MCP_TOOL = 'web_search_prime';
/** Same query cap the REST API documents; the MCP schema repeats it. */
const MAX_QUERY_LENGTH = 70;
const DEFAULT_MAX_RESULTS = 10;
const REST_MAX_RESULTS = 10;
/** The REST API accepts 1-50. */
const REST_RESULTS_CEILING = 50;
/** Zhipu's own search engines, cheapest first. */
export const ZHIPU_SEARCH_ENGINES = [
  'search_std',
  'search_pro',
  'search_pro_sogou',
  'search_pro_quark',
] as const;
export type ZhipuSearchEngine = (typeof ZHIPU_SEARCH_ENGINES)[number];
/** search_pro_sogou only accepts these result counts. */
const SOGOU_COUNTS = [10, 20, 30, 40, 50];

/**
 * Environment variables that may hold a Zhipu key. ZHIPU_API_KEY is the name
 * the config layer binds (so `modsearch config show` reports it); the rest are
 * read here because harnesses and coding plans ship the key under their own
 * name.
 */
const ZHIPU_KEY_ENV_NAMES = [
  'ZHIPU_API_KEY',
  'ZAI_API_KEY',
  'ZHIPUAI_API_KEY',
  'ZAI_CODING_CN_API_KEY',
  'BIGMODEL_API_KEY',
];

/** Every configured key, file first, then the environment aliases. */
function resolveApiKeys(settings: { apiKey?: string }, env: NodeJS.ProcessEnv): string[] {
  const fromSettings = splitApiKeys(settings.apiKey);
  if (fromSettings.length > 0) {
    return fromSettings;
  }
  const fromEnv: string[] = [];
  for (const name of ZHIPU_KEY_ENV_NAMES) {
    fromEnv.push(...splitApiKeys(env[name]));
  }
  return fromEnv;
}

function safeHostname(url: string): undefined | string {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** The REST search engine code, from the engine setting, defaulting to the cheap one. */
function resolveSearchEngine(settings: { model?: string }): ZhipuSearchEngine {
  const requested = settings.model?.trim();
  if (requested && (ZHIPU_SEARCH_ENGINES as readonly string[]).includes(requested)) {
    return requested as ZhipuSearchEngine;
  }
  return 'search_std';
}

/** Zhipu's own REST error envelope, in both documented shapes. */
function restErrorCode(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown }; code?: unknown };
    const code = parsed?.error?.code ?? parsed?.code;
    return code === undefined || code === null ? '' : String(code);
  } catch {
    return '';
  }
}

// --- REST transport (the account-balance Web Search API) --------------------

interface RestHit {
  title?: string;
  content?: string;
  link?: string;
  publish_date?: string;
}

interface RestResponse {
  search_result?: RestHit[];
  request_id?: string;
}

async function searchRest(options: EngineRequest, apiKey: string, apiKeySecrets: string[]): Promise<EngineOutput> {
  const searchEngine = resolveSearchEngine(options.settings);
  const requested = options.maxResults ?? REST_MAX_RESULTS;
  let count = Math.min(Math.max(requested, 1), REST_RESULTS_CEILING);
  if (searchEngine === 'search_pro_sogou' && !SOGOU_COUNTS.includes(count)) {
    count = SOGOU_COUNTS.reduce((best, value) =>
      Math.abs(value - count) < Math.abs(best - count) ? value : best,
    );
  }

  const fullQuery = options.query?.trim() ?? '';
  const searchQuery = fullQuery.slice(0, MAX_QUERY_LENGTH);
  const truncated = searchQuery.length < fullQuery.length;

  const startedAt = Date.now();
  const { response, text } = await requestText(
    'zhipu',
    resolveEndpoint(options.settings.baseURL, DEFAULT_BASE, '/api/paas/v4/web_search'),
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
    const code = restErrorCode(text);
    const message = `zhipu (REST) returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`;
    if (response.status >= 500) {
      throw new Error(message);
    }
    // 1113 is the unfunded-account code, and the Web Search API is billed
    // separately from the model calls a coding plan covers. It is a lasting
    // limit, so the cooldown layer holds the engine instead of re-hitting it.
    if (code === '1113' || response.status === 402 || isQuotaFailureMessage(detail)) {
      throw new ApiKeyFailureError(
        `zhipu (REST) has no search balance (${code || `HTTP ${response.status}`}).${detail ? ` ${detail}` : ''} Top up at https://open.bigmodel.cn, or set the engine's channel to the coding plan.`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiKeyFailureError(
        `zhipu (REST) rejected the API key (${response.status}). Fix it: modsearch config set zhipu.apiKey <key>${detail ? ` (${detail})` : ''}`,
      );
    }
    // 1302 (account rate limit) and 1701 (search concurrency) are transient:
    // they belong in the fallback chain, not in the cooldown list.
    throw new Error(message);
  }

  const data = JSON.parse(text) as RestResponse;
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
      `The query was truncated to ${MAX_QUERY_LENGTH} characters, the limit the Zhipu REST API puts on search_query.`,
    );
  }

  return {
    result: {
      summary:
        items.length > 0
          ? `Zhipu REST (${searchEngine}) returned ${items.length} result(s) for "${searchQuery}". Read items for the sources.`
          : '',
      items,
      uncertainty,
      warnings: [
        'The Zhipu REST API returns structured search results without an LLM summary, so the summary is mechanical: read items directly for the evidence. It bills the account balance per call.',
      ],
    },
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { resultCount: items.length, searchEngine, channel: 'rest', requestId: data.request_id ?? null },
    },
  };
}

// --- MCP transport (the coding-plan endpoint) -------------------------------

interface McpProbeResult {
  title?: string;
  link?: string;
  content?: string;
  refer?: string;
  publish_date?: string;
}

/** One JSON-RPC POST; streamable HTTP may answer as plain JSON or as SSE. */
async function rpc(
  url: string,
  body: unknown,
  apiKey: string,
  secrets: readonly string[],
  timeoutMs: number,
  sessionId?: string,
): Promise<{ status: number; sessionId?: string; payload: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${apiKey}`,
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  const { response, text } = await requestText(
    'zhipu',
    url,
    { method: 'POST', headers, body: JSON.stringify(body) },
    AbortSignal.timeout(timeoutMs),
    timeoutMs,
    [...secrets, url],
  );
  if (!response.ok) {
    const detail = redactSecrets(text.trim(), [...secrets, url]);
    throw new Error(`zhipu (coding plan) returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`);
  }
  let payloadText = text;
  if (text.includes('data:')) {
    const line = text.split('\n').find((candidate) => candidate.startsWith('data:'));
    payloadText = line ? line.slice(5).trim() : text;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadText) as Record<string, unknown>;
  } catch {
    throw new Error(`zhipu (coding plan) produced no JSON-RPC payload: ${payloadText.slice(0, 120)}`);
  }
  return { status: response.status, sessionId: response.headers.get('mcp-session-id') ?? undefined, payload };
}

/**
 * The MCP server reports failures in two shapes: a JSON-RPC error object, or
 * a plain {code,msg,success:false} body behind HTTP 200. Auth and quota get
 * mapped to key failures so cooldown holds the engine instead of re-hitting.
 */
function failFromPayload(payload: Record<string, unknown>, secrets: readonly string[]): Error {
  const error = payload.error as { code?: unknown; message?: unknown } | undefined;
  if (error) {
    const message = redactSecrets(String(error.message ?? ''), secrets);
    if (isQuotaFailureMessage(message) || message.includes('1113')) {
      return new ApiKeyFailureError(`zhipu (coding plan) ran out of plan quota: ${message}`);
    }
    return new Error(`zhipu (coding plan) MCP error ${String(error.code ?? '')}: ${message}`);
  }
  if (payload.success === false && payload.code !== undefined) {
    const message = redactSecrets(String(payload.msg ?? ''), secrets);
    const code = String(payload.code);
    if (code === '401' || code === '1001') {
      return new ApiKeyFailureError(
        `zhipu (coding plan) rejected the API key (code ${code}). The coding-plan MCP only accepts a plan key.`,
      );
    }
    if (isQuotaFailureMessage(message)) {
      return new ApiKeyFailureError(`zhipu (coding plan) ran out of plan quota (code ${code}): ${message}`);
    }
    return new Error(`zhipu (coding plan) MCP failure (code ${code}): ${message}`);
  }
  return new Error('zhipu (coding plan) MCP returned an unrecognized payload');
}

async function searchMcp(options: EngineRequest, apiKey: string, apiKeySecrets: string[]): Promise<EngineOutput> {
  const endpoint = resolveEndpoint(options.settings.baseURL, DEFAULT_BASE, MCP_PATH);
  const startedAt = Date.now();

  // 1. initialize: opens the session whose id every later call must carry.
  const init = await rpc(
    endpoint,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'modsearch', version: '1.0.0' },
      },
    },
    apiKey,
    apiKeySecrets,
    options.timeoutMs,
  );
  if (init.payload.error) {
    throw failFromPayload(init.payload, apiKeySecrets);
  }
  const sessionId = init.sessionId;

  // 2. tools/call against web_search_prime.
  const fullQuery = options.query?.trim() ?? '';
  const searchQuery = fullQuery.slice(0, MAX_QUERY_LENGTH);
  const truncated = searchQuery.length < fullQuery.length;
  const call = await rpc(
    endpoint,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: MCP_TOOL,
        arguments: { search_query: searchQuery, content_size: 'medium' },
      },
    },
    apiKey,
    apiKeySecrets,
    options.timeoutMs,
    sessionId,
  );
  if (call.payload.error) {
    throw failFromPayload(call.payload, apiKeySecrets);
  }
  if (call.payload.success === false) {
    throw failFromPayload(call.payload, apiKeySecrets);
  }

  // 3. result.content[0].text is a JSON string wrapping an escaped JSON array.
  const result = call.payload.result as { content?: Array<{ type?: string; text?: string }> } | undefined;
  const firstText = result?.content?.find((block) => block.type === 'text')?.text ?? '';
  let rows: McpProbeResult[] = [];
  try {
    const unwrapped = JSON.parse(firstText) as unknown;
    const arrayText = typeof unwrapped === 'string' ? (JSON.parse(unwrapped) as unknown) : unwrapped;
    if (Array.isArray(arrayText)) {
      rows = arrayText as McpProbeResult[];
    }
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows)) {
    rows = [];
  }

  const items = rows.slice(0, options.maxResults ?? DEFAULT_MAX_RESULTS).map((row) => {
    const item: {
      title: string;
      url: string;
      snippet: string;
      source: string | undefined;
      refer?: string;
      published_at?: string;
    } = {
      title: row.title ?? '',
      url: row.link ?? '',
      snippet: row.content ?? '',
      source: row.link ? safeHostname(row.link) : undefined,
    };
    if (row.refer) {
      item.refer = row.refer;
    }
    if (row.publish_date) {
      item.published_at = row.publish_date;
    }
    return item;
  });

  const uncertainty: string[] = [];
  if (items.length === 0) {
    uncertainty.push('No results found for this query.');
  }
  if (truncated) {
    uncertainty.push(
      `The query was truncated to ${MAX_QUERY_LENGTH} characters, the limit the Zhipu search schema puts on search_query.`,
    );
  }

  return {
    result: {
      summary:
        items.length > 0
          ? `Zhipu coding-plan search returned ${items.length} result(s) for "${searchQuery}". Read items for the sources.`
          : '',
      items,
      uncertainty,
      warnings: [
        'Zhipu coding-plan search goes through the plan-exclusive MCP and draws down plan credits, not the account balance.',
      ],
    },
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { resultCount: items.length, channel: 'coding' },
    },
  };
}

// --- The one engine ----------------------------------------------------------

export async function executeZhipuSearch(options: EngineRequest): Promise<EngineOutput> {
  if (options.mode === 'fetch') {
    throw new Error('The zhipu engine does not support page fetch (-u). It searches only.');
  }
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }

  const apiKeys = resolveApiKeys(options.settings, process.env);
  const apiKey = apiKeys[0];
  const apiKeySecrets = [...new Set([...apiKeys, ...(options.apiKeySecrets ?? [])])];
  if (!apiKey) {
    throw new Error(
      'The zhipu provider needs an API key. Set ZHIPU_API_KEY (or ZAI_API_KEY), or run: modsearch config set zhipu.apiKey <key> (https://open.bigmodel.cn). The channel setting picks the coding-plan MCP or the balance-billed REST API; auto tries the plan first.',
    );
  }

  const channel = resolveChannel(options.settings);
  if (channel === 'rest') {
    return searchRest(options, apiKey, apiKeySecrets);
  }
  if (channel === 'coding') {
    return searchMcp(options, apiKey, apiKeySecrets);
  }
  // auto: plan credits first, the balance-billed REST API when the plan
  // channel fails for any reason. Both failing reports the REST error — the
  // balance channel is the one that should work on a funded account — with
  // the plan failure riding along for the diagnosis.
  try {
    return await searchMcp(options, apiKey, apiKeySecrets);
  } catch (planError) {
    try {
      return await searchRest(options, apiKey, apiKeySecrets);
    } catch (restError) {
      const planNote = planError instanceof Error ? planError.message : String(planError);
      const restMessage = restError instanceof Error ? restError.message : String(restError);
      throw new Error(`${restMessage} (coding-plan channel also failed: ${planNote})`);
    }
  }
}

export const zhipuProvider: SearchEngine = {
  name: 'zhipu',
  roles: ['search'],
  requirement:
    'set a Zhipu API key (modsearch config set zhipu.apiKey <key>; ZHIPU_API_KEY or ZAI_API_KEY). The channel setting picks the coding-plan MCP (plan credits) or the REST API (balance, billed per call); auto tries the plan first and falls back to REST',
  isAvailable: (settings, env) => resolveApiKeys(settings, env).length > 0,
  defaultModel: 'search_std',
  execute: executeZhipuSearch,
};
