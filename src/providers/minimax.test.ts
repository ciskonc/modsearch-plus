import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeMinimaxSearch, executeMinimaxWebSearch } from './minimax.ts';
import { resolveEngine } from './index.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Mock the global fetch with a JSON response, capturing the request. */
function mockFetchJson(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, requestInit: RequestInit) => {
    calls.push({ url, init: requestInit });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

describe('minimax provider', () => {
  it('resolves both engines by name and exposes execute', () => {
    const search = resolveEngine('minimax');
    expect(search.name).toBe('minimax');
    expect(search.roles).toEqual(['search']);
    expect(search.execute).toBeTypeOf('function');

    const websearch = resolveEngine('minimax-websearch');
    expect(websearch.name).toBe('minimax-websearch');
    expect(websearch.roles).toEqual(['search']);
    expect(websearch.execute).toBeTypeOf('function');
  });

  it('rejects fetch mode', async () => {
    await expect(
      executeMinimaxSearch({
        mode: 'fetch',
        url: 'https://example.com',
        timeoutMs: 1000,
        settings: { apiKey: 'mm-test' },
      }),
    ).rejects.toThrow(/does not support page fetch/);
    await expect(
      executeMinimaxWebSearch({
        mode: 'fetch',
        url: 'https://example.com',
        timeoutMs: 1000,
        settings: { apiKey: 'mm-test' },
      }),
    ).rejects.toThrow(/does not support page fetch/);
  });

  it('requires an API key', async () => {
    vi.stubEnv('MINIMAX_API_KEY', '');
    vi.stubEnv('MINIMAX_CN_API_KEY', '');
    await expect(
      executeMinimaxSearch({ mode: 'search', query: 'anything', timeoutMs: 1000, settings: {} }),
    ).rejects.toThrow(/MINIMAX_API_KEY|config set minimax.apiKey/);
  });

  it('reads a key from the plan environment alias', async () => {
    vi.stubEnv('MINIMAX_API_KEY', '');
    vi.stubEnv('MINIMAX_CN_API_KEY', 'mm-from-plan');
    const calls = mockFetchJson({ organic: [] });
    await executeMinimaxSearch({ mode: 'search', query: 'q', timeoutMs: 1000, settings: {} });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer mm-from-plan');
  });

  it('posts to the model-free search endpoint the way the official MCP server does', async () => {
    const calls = mockFetchJson({ organic: [] });
    await executeMinimaxSearch({
      mode: 'search',
      query: 'today in AI',
      timeoutMs: 1000,
      settings: { apiKey: 'mm-test' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.minimax.cn/v1/coding_plan/search');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer mm-test');
    expect(headers['MM-API-Source']).toBe('Minimax-MCP');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ q: 'today in AI' });
  });

  it('maps organic hits into the shared contract', async () => {
    mockFetchJson({
      organic: [
        {
          title: 'A',
          link: 'https://a.example.com/page',
          snippet: 'snippet a',
          date: '2026/10/24 12:51:00',
        },
        { title: 'B', link: 'not a url', snippet: 'snippet b' },
      ],
      related_searches: [{ query: 'related' }],
      base_resp: { status_code: 0, status_msg: '' },
    });

    const parsed = await executeMinimaxSearch({
      mode: 'search',
      query: 'q',
      timeoutMs: 1000,
      settings: { apiKey: 'mm-test' },
    });

    const result = parsed.result as {
      summary: string;
      items: Array<Record<string, unknown>>;
      uncertainty: string[];
    };
    expect(result.summary).toContain('2 search result(s)');
    expect(result.items).toEqual([
      {
        title: 'A',
        url: 'https://a.example.com/page',
        snippet: 'snippet a',
        source: 'a.example.com',
        published_at: '2026-10-24T12:51:00Z',
      },
      { title: 'B', url: 'not a url', snippet: 'snippet b', source: undefined },
    ]);
    expect(result.uncertainty).toEqual([]);
    expect(parsed.meta.usage).toMatchObject({ resultCount: 2 });
  });

  it('reads a failure out of a 200 response, as this endpoint reports errors', async () => {
    mockFetchJson({
      base_resp: { status_code: 1004, status_msg: 'invalid api key' },
      organic: [],
    });
    await expect(
      executeMinimaxSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'mm-test' },
      }),
    ).rejects.toThrow(/rejected the API key/i);
  });

  it('names the region rule when the host rejects the key', async () => {
    mockFetchJson({ error: 'invalid api key' }, { ok: false, status: 401 });
    await expect(
      executeMinimaxSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'mm-test' },
      }),
    ).rejects.toThrow(/api\.minimax\.cn for mainland accounts/);
  });

  it('redacts the key from error messages', async () => {
    const secret = 'mm-secret-value';
    mockFetchJson({ error: `key ${secret} rejected` }, { ok: false, status: 401 });
    let error: Error | undefined;
    try {
      await executeMinimaxSearch({
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
});

describe('minimax-websearch provider', () => {
  it('declares the versioned server tool on the Anthropic-compatible endpoint', async () => {
    const calls = mockFetchJson({ content: [] });
    await executeMinimaxWebSearch({
      mode: 'search',
      query: 'today in Shanghai',
      timeoutMs: 1000,
      settings: { apiKey: 'mm-test' },
    });
    expect(calls[0].url).toBe('https://api.minimax.cn/anthropic/v1/messages');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('mm-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'today in Shanghai' }]);
    expect(body.model).toBe('MiniMax-M3.1-Flash');
  });

  it('takes the model from the engine setting when one is configured', async () => {
    const calls = mockFetchJson({ content: [] });
    await executeMinimaxWebSearch({
      mode: 'search',
      query: 'q',
      timeoutMs: 1000,
      settings: { apiKey: 'mm-test', model: 'MiniMax-M3' },
    });
    expect(JSON.parse(calls[0].init.body as string).model).toBe('MiniMax-M3');
  });

  it('splits the answer text from the search results', async () => {
    mockFetchJson({
      content: [
        { type: 'thinking', thinking: 'considering' },
        { type: 'server_tool_use', name: 'web_search', input: { query: '上海天气' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'call_1',
          content: [
            {
              type: 'web_search_result',
              title: '上海天气',
              url: 'https://weather.example.com/sh',
              page_age: '2026/10/25 08:00:00',
              content: '阵雨 22℃',
            },
            {
              type: 'web_search_result',
              title: '无日期结果',
              url: 'https://weather.example.com/sh2',
              content: '晴',
            },
          ],
        },
        { type: 'text', text: '上海今天有阵雨。' },
      ],
      stop_reason: 'end_turn',
    });

    const parsed = await executeMinimaxWebSearch({
      mode: 'search',
      query: '上海天气',
      timeoutMs: 1000,
      settings: { apiKey: 'mm-test' },
    });

    const result = parsed.result as {
      summary: string;
      items: Array<Record<string, unknown>>;
      uncertainty: string[];
      warnings: string[];
    };
    expect(result.summary).toBe('上海今天有阵雨。');
    expect(result.items).toEqual([
      {
        title: '上海天气',
        url: 'https://weather.example.com/sh',
        snippet: '阵雨 22℃',
        source: 'weather.example.com',
        published_at: '2026-10-25T08:00:00Z',
      },
      {
        title: '无日期结果',
        url: 'https://weather.example.com/sh2',
        snippet: '晴',
        source: 'weather.example.com',
      },
    ]);
    expect(result.uncertainty).toEqual([]);
    expect(result.warnings.join(' ')).toContain('上海天气');
  });

  it('flags a truncated turn so an incomplete answer is not read as a complete one', async () => {
    mockFetchJson({
      content: [{ type: 'server_tool_use', name: 'web_search', input: { query: 'x' } }],
      stop_reason: 'pause_turn',
    });
    const parsed = await executeMinimaxWebSearch({
      mode: 'search',
      query: 'q',
      timeoutMs: 1000,
      settings: { apiKey: 'mm-test' },
    });
    const result = parsed.result as { uncertainty: string[] };
    expect(result.uncertainty.join(' ')).toMatch(/pause_turn/);
  });
});
