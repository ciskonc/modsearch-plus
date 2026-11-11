// Zhipu GLM Coding Plan search, over the plan-exclusive remote MCP server.
//
// The Coding Plan's search entitlement lives on a different endpoint than the
// pay-per-call Web Search REST API (glm.ts): POST /api/mcp/web_search_prime/mcp,
// a streamable-HTTP MCP server whose only tool is web_search_prime. Calls draw
// down the plan's credits instead of the account balance, so this engine works
// on a plan key that the REST API rejects with 429 / code 1113.
//
// Wire format (verified live 2026-11-11):
//   1. POST initialize  -> 200, result.ok, and an mcp-session-id header
//   2. POST tools/call  with {name:"web_search_prime", arguments:{search_query}}
//      -> 200, result.content[0].text is a JSON string holding an escaped JSON
//      array of {title, link, content, refer, ...}
// The official docs name the tool `webSearchPrime`; the server actually
// registers `web_search_prime`. Failures may come back either as JSON-RPC
// errors or as plain {code,msg,success:false} bodies with HTTP 200.
import { ApiKeyFailureError, isQuotaFailureMessage, splitApiKeys } from '../util/apiKeys.ts';
import { redactSecrets } from '../util/redact.ts';
import { requestText } from '../util/timedRequest.ts';
import { resolveEndpoint } from './endpoint.ts';
import type { EngineOutput, EngineRequest, SearchEngine } from './index.ts';

const GLM_MCP_DEFAULT_BASE = 'https://open.bigmodel.cn';
const MCP_PATH = '/api/mcp/web_search_prime/mcp';
const MCP_TOOL = 'web_search_prime';
/** Same query cap the REST API documents; the MCP schema repeats it. */
const MAX_QUERY_LENGTH = 70;
const DEFAULT_MAX_RESULTS = 10;

const GLM_KEY_ENV_NAMES = [
  'ZAI_API_KEY',
  'ZHIPUAI_API_KEY',
  'ZAI_CODING_CN_API_KEY',
  'BIGMODEL_API_KEY',
];

interface McpProbeResult {
  title?: string;
  link?: string;
  content?: string;
  refer?: string;
  publish_date?: string;
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

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
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
    'glm-coding',
    url,
    { method: 'POST', headers, body: JSON.stringify(body) },
    AbortSignal.timeout(timeoutMs),
    timeoutMs,
    [...secrets, url],
  );
  if (!response.ok) {
    const detail = redactSecrets(text.trim(), [...secrets, url]);
    throw new Error(`glm-coding returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`);
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
    throw new Error(`glm-coding produced no JSON-RPC payload: ${payloadText.slice(0, 120)}`);
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
      return new ApiKeyFailureError(`glm-coding ran out of plan quota: ${message}`);
    }
    return new Error(`glm-coding MCP error ${String(error.code ?? '')}: ${message}`);
  }
  if (payload.success === false && payload.code !== undefined) {
    const message = redactSecrets(String(payload.msg ?? ''), secrets);
    const code = String(payload.code);
    if (code === '401' || code === '1001') {
      return new ApiKeyFailureError(
        `glm-coding rejected the API key (code ${code}). The coding-plan MCP only accepts a plan key.`,
      );
    }
    if (isQuotaFailureMessage(message)) {
      return new ApiKeyFailureError(`glm-coding ran out of plan quota (code ${code}): ${message}`);
    }
    return new Error(`glm-coding MCP failure (code ${code}): ${message}`);
  }
  return new Error('glm-coding MCP returned an unrecognized payload');
}

export async function executeGlmCodingSearch(options: EngineRequest): Promise<EngineOutput> {
  if (options.mode === 'fetch') {
    throw new Error('The glm-coding engine does not support page fetch (-u). It searches only.');
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
      'The glm-coding provider needs a Zhipu coding-plan key. Set ZAI_API_KEY, or run: modsearch config set glm-coding.apiKey <key>. This engine draws down plan credits, not the account balance.',
    );
  }

  const endpoint = resolveEndpoint(options.settings.baseURL, GLM_MCP_DEFAULT_BASE, MCP_PATH);
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
  const fullQuery = options.query.trim();
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
      `The query was truncated to ${MAX_QUERY_LENGTH} characters, the limit the glm search schema puts on search_query.`,
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
        'glm-coding searches through the coding-plan exclusive MCP and draws down plan credits, not the account balance.',
      ],
    },
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { resultCount: items.length },
    },
  };
}

export const glmCodingProvider: SearchEngine = {
  name: 'glm-coding',
  roles: ['search'],
  requirement:
    'set a Zhipu coding-plan key (modsearch config set glm-coding.apiKey <key>); searches through the plan-exclusive MCP and draws down plan credits',
  isAvailable: (settings, env) => resolveApiKeys(settings, env).length > 0,
  defaultModel: 'web_search_prime',
  execute: executeGlmCodingSearch,
};
