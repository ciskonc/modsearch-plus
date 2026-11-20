import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeZhipuSearch, resolveChannel, zhipuProvider } from './zhipu.ts';
import { resolveEngine } from './index.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** Queue one canned response per fetch call, capturing every request. */
function mockFetchSequence(responses: Array<Record<string, unknown> & { headers?: Record<string, string> }>) {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fn = vi.fn(async (url: string, requestInit: RequestInit) => {
    calls.push({ url, init: requestInit });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const body = JSON.stringify(next.body ?? next);
    return {
      ok: next.ok !== false,
      status: (next.status as number) ?? 200,
      statusText: (next.statusText as string) ?? 'OK',
      headers: new Headers(next.headers ?? {}),
      text: async () => body,
      json: async () => JSON.parse(body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const INIT_RESPONSE = {
  body: {
    jsonrpc: '2.0',
    id: 1,
    result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-web-search-prime' } },
  },
  headers: { 'mcp-session-id': 'session-abc' },
};

const MCP_CALL_RESPONSE = {
  body: {
    jsonrpc: '2.0',
    id: 2,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            JSON.stringify([
              { title: 'MCP hit', link: 'https://example.com/a', content: 'mcp snippet' },
            ]),
          ),
        },
      ],
    },
  },
};

const REST_RESPONSE = {
  body: {
    id: 'rest-1',
    request_id: 'req-rest',
    search_result: [
      { title: 'REST hit', link: 'https://example.com/b', content: 'rest snippet' },
    ],
  },
};

function searchRequest(settings: Record<string, unknown> = {}) {
  return {
    mode: 'search' as const,
    query: 'who watches the code',
    timeoutMs: 5000,
    settings: { apiKey: 'zai-test', ...settings },
  };
}

describe('the zhipu provider', () => {
  it('resolves by name and exposes execute instead of buildInvocation', () => {
    const engine = resolveEngine('zhipu');
    expect(engine.name).toBe('zhipu');
    expect(engine.roles).toEqual(['search']);
    expect(engine.execute).toBeTypeOf('function');
    expect(engine.buildInvocation).toBeUndefined();
  });

  it('is the only engine carrying a channel mode', () => {
    expect(resolveChannel({})).toBe('auto');
    expect(resolveChannel({ channel: 'coding' })).toBe('coding');
    expect(resolveChannel({ channel: 'rest' })).toBe('rest');
    // An unknown value is not a mode; the engine falls back to auto.
    expect(resolveChannel({ channel: 'balance' })).toBe('auto');
  });

  it('rejects fetch mode', async () => {
    await expect(
      executeZhipuSearch({
        mode: 'fetch',
        url: 'https://example.com',
        timeoutMs: 1000,
        settings: { apiKey: 'zai-test' },
      }),
    ).rejects.toThrow(/does not support page fetch/);
  });

  it('asks for a key before it calls anything', async () => {
    await expect(
      executeZhipuSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: {},
      }),
    ).rejects.toThrow(/needs an API key/);
  });
});

describe('the zhipu channel setting picks the transport', () => {
  it('coding searches through the plan MCP and nothing else', async () => {
    const calls = mockFetchSequence([INIT_RESPONSE, MCP_CALL_RESPONSE]);
    const output = await executeZhipuSearch(searchRequest({ channel: 'coding' }));
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/api/mcp/web_search_prime/mcp');
    const mcp = output.result as { items?: Array<{ title?: string }>; warnings?: string[] };
    expect(mcp.items?.[0]?.title).toBe('MCP hit');
    expect(mcp.warnings?.join(' ')).toContain('plan credits');
  });

  it('rest searches through the balance-billed API and nothing else', async () => {
    const calls = mockFetchSequence([REST_RESPONSE]);
    const output = await executeZhipuSearch(searchRequest({ channel: 'rest' }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/paas/v4/web_search');
    const rest = output.result as { items?: Array<{ title?: string }>; warnings?: string[] };
    expect(rest.items?.[0]?.title).toBe('REST hit');
    expect(rest.warnings?.join(' ')).toContain('account balance');
  });

  it('auto tries the plan first and stops there when it answers', async () => {
    const calls = mockFetchSequence([INIT_RESPONSE, MCP_CALL_RESPONSE]);
    const output = await executeZhipuSearch(searchRequest({ channel: 'auto' }));
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/api/mcp/web_search_prime/mcp');
    const mcp = output.result as { items?: Array<{ title?: string }> };
    expect(mcp.items?.[0]?.title).toBe('MCP hit');
  });

  it('auto falls back to the balance API when the plan channel fails', async () => {
    const calls = mockFetchSequence([
      { ok: false, status: 401, statusText: 'Unauthorized', body: { error: 'plan key required' } },
      REST_RESPONSE,
    ]);
    const output = await executeZhipuSearch(searchRequest({ channel: 'auto' }));
    // The plan attempt, then the balance attempt: two calls, two transports.
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/api/mcp/web_search_prime/mcp');
    expect(calls[1].url).toContain('/api/paas/v4/web_search');
    const items = (output.result as { items?: Array<{ title?: string }> }).items;
    expect(items?.[0]?.title).toBe('REST hit');
  });

  it('auto reports both failures when neither channel answers', async () => {
    mockFetchSequence([
      { ok: false, status: 401, statusText: 'Unauthorized', body: { error: 'plan key required' } },
      { ok: false, status: 429, statusText: 'Too Many Requests', body: { error: { code: '1113' } } },
    ]);
    await expect(executeZhipuSearch(searchRequest({ channel: 'auto' }))).rejects.toThrow(
      /coding-plan channel also failed/,
    );
  });
});

describe('the zhipu key comes from the file or from the environment', () => {
  it('reads the vendor spellings when the bound name is empty', async () => {
    vi.stubEnv('ZAI_API_KEY', 'zai-from-env');
    const calls = mockFetchSequence([REST_RESPONSE]);
    await executeZhipuSearch({
      mode: 'search',
      query: 'q',
      timeoutMs: 5000,
      settings: { channel: 'rest' },
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer zai-from-env');
  });

  it('prefers the file key over the environment', async () => {
    vi.stubEnv('ZAI_API_KEY', 'zai-from-env');
    const calls = mockFetchSequence([REST_RESPONSE]);
    await executeZhipuSearch(searchRequest({ channel: 'rest' }));
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer zai-test');
  });
});

describe('the zhipu provider reports its own readiness', () => {
  it('is available with a key in the file or the environment', () => {
    expect(zhipuProvider.isAvailable({ apiKey: 'k' }, {}, 'search')).toBe(true);
    expect(zhipuProvider.isAvailable({}, { ZHIPU_API_KEY: 'k' }, 'search')).toBe(true);
    expect(zhipuProvider.isAvailable({}, { ZAI_API_KEY: 'k' }, 'search')).toBe(true);
    expect(zhipuProvider.isAvailable({}, {}, 'search')).toBe(false);
  });
});
