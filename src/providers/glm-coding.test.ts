import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeGlmCodingSearch } from './glm-coding.ts';
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
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(next.headers ?? {}),
      text: async () => body,
      json: async () => JSON.parse(body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const INIT_RESPONSE = {
  jsonrpc: '2.0',
  id: 1,
  result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mcp-web-search-prime' } },
  headers: { 'mcp-session-id': 'session-abc' },
};

describe('glm-coding provider', () => {
  it('resolves by name and exposes execute instead of buildInvocation', () => {
    const engine = resolveEngine('glm-coding');
    expect(engine.name).toBe('glm-coding');
    expect(engine.roles).toEqual(['search']);
    expect(engine.execute).toBeTypeOf('function');
    expect(engine.buildInvocation).toBeUndefined();
  });

  it('rejects fetch mode', async () => {
    await expect(
      executeGlmCodingSearch({
        mode: 'fetch',
        url: 'https://example.com',
        timeoutMs: 1000,
        settings: { apiKey: 'zai-test' },
      }),
    ).rejects.toThrow(/does not support page fetch/);
  });

  it('requires an API key', async () => {
    vi.stubEnv('ZAI_API_KEY', '');
    vi.stubEnv('ZHIPUAI_API_KEY', '');
    vi.stubEnv('ZAI_CODING_CN_API_KEY', '');
    vi.stubEnv('BIGMODEL_API_KEY', '');
    await expect(
      executeGlmCodingSearch({ mode: 'search', query: 'anything', timeoutMs: 1000, settings: {} }),
    ).rejects.toThrow(/ZAI_API_KEY|config set glm-coding.apiKey/);
  });

  it('initializes the MCP session, then calls web_search_prime with the session id', async () => {
    const calls = mockFetchSequence([
      INIT_RESPONSE,
      {
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [
            {
              type: 'text',
              // Double-encoded: a JSON string wrapping the escaped array.
              text: JSON.stringify(
                JSON.stringify([
                  {
                    title: 'A',
                    link: 'https://a.example.com/page',
                    content: 'summary a',
                    refer: 'ref_1',
                    publish_date: '2026-11-11',
                  },
                  { title: 'B', link: 'not a url', content: 'summary b' },
                ]),
              ),
            },
          ],
        },
      },
    ]);

    const parsed = await executeGlmCodingSearch({
      mode: 'search',
      query: 'GLM-5.3 Flash 发布',
      maxResults: 5,
      timeoutMs: 5000,
      settings: { apiKey: 'zai-plan' },
    });

    expect(calls).toHaveLength(2);
    // First POST opens the session at the documented endpoint.
    expect(calls[0].url).toBe('https://open.bigmodel.cn/api/mcp/web_search_prime/mcp');
    expect(calls[0].init.method).toBe('POST');
    const initHeaders = calls[0].init.headers as Record<string, string>;
    expect(initHeaders.authorization).toBe('Bearer zai-plan');
    expect(JSON.parse(calls[0].init.body as string).method).toBe('initialize');
    // Second POST carries the session id the initialize handed back.
    const callHeaders = calls[1].init.headers as Record<string, string>;
    expect(callHeaders['mcp-session-id']).toBe('session-abc');
    const callBody = JSON.parse(calls[1].init.body as string);
    expect(callBody.method).toBe('tools/call');
    expect(callBody.params.name).toBe('web_search_prime');
    expect(callBody.params.arguments.search_query).toBe('GLM-5.3 Flash 发布');

    const result = parsed.result as { summary: string; items: Array<Record<string, unknown>> };
    expect(result.summary).toContain('coding-plan search returned 2 result(s)');
    expect(result.items).toEqual([
      {
        title: 'A',
        url: 'https://a.example.com/page',
        snippet: 'summary a',
        source: 'a.example.com',
        refer: 'ref_1',
        published_at: '2026-11-11',
      },
      { title: 'B', url: 'not a url', snippet: 'summary b', source: undefined },
    ]);
    expect(parsed.meta.usage).toEqual({ resultCount: 2 });
  });

  it('maps a JSON-RPC auth error to a key failure the cooldown layer reads', async () => {
    mockFetchSequence([
      INIT_RESPONSE,
      { jsonrpc: '2.0', id: 2, error: { code: -32603, message: 'unauthorized key' } },
    ]);
    await expect(
      executeGlmCodingSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'zai-test' },
      }),
    ).rejects.toThrow(/MCP error/);
  });

  it('reads the plain {code,msg,success:false} failure shape behind HTTP 200', async () => {
    mockFetchSequence([
      INIT_RESPONSE,
      { code: 401, msg: '令牌已过期或验证不正确', success: false },
    ]);
    await expect(
      executeGlmCodingSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'zai-test' },
      }),
    ).rejects.toThrow(/rejected the API key/);
  });

  it('truncates an over-limit query and says so', async () => {
    const calls = mockFetchSequence([INIT_RESPONSE, { jsonrpc: '2.0', id: 2, result: { content: [] } }]);
    const parsed = await executeGlmCodingSearch({
      mode: 'search',
      query: 'x'.repeat(120),
      timeoutMs: 1000,
      settings: { apiKey: 'zai-test' },
    });
    const body = JSON.parse(calls[1].init.body as string);
    expect((body.params.arguments.search_query as string).length).toBe(70);
    const result = parsed.result as { uncertainty: string[] };
    expect(result.uncertainty.join(' ')).toMatch(/truncated to 70 characters/);
  });

  it('redacts the key from error messages', async () => {
    const secret = 'zai-secret-value';
    mockFetchSequence([INIT_RESPONSE, { code: 500, msg: `key ${secret} exploded`, success: false }]);
    let error: Error | undefined;
    try {
      await executeGlmCodingSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: secret },
      });
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).not.toContain(secret);
  });

  it('posts to a configured baseURL', async () => {
    const calls = mockFetchSequence([
      INIT_RESPONSE,
      { jsonrpc: '2.0', id: 2, result: { content: [] } },
    ]);
    await executeGlmCodingSearch({
      mode: 'search',
      query: 'q',
      timeoutMs: 1000,
      settings: { apiKey: 'zai-test', baseURL: 'https://gw.example.com' },
    });
    expect(calls[0].url).toBe('https://gw.example.com/api/mcp/web_search_prime/mcp');
  });
});
