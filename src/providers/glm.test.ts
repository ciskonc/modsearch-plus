import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeGlmSearch } from './glm.ts';
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

describe('glm provider', () => {
  it('resolves by name and exposes execute instead of buildInvocation', () => {
    const engine = resolveEngine('glm');
    expect(engine.name).toBe('glm');
    expect(engine.roles).toEqual(['search']);
    expect(engine.execute).toBeTypeOf('function');
    expect(engine.buildInvocation).toBeUndefined();
  });

  it('rejects fetch mode', async () => {
    await expect(
      executeGlmSearch({
        mode: 'fetch',
        url: 'https://example.com',
        timeoutMs: 1000,
        settings: {},
      }),
    ).rejects.toThrow(/does not support page fetch/);
  });

  it('requires an API key', async () => {
    vi.stubEnv('ZAI_API_KEY', '');
    vi.stubEnv('ZHIPUAI_API_KEY', '');
    vi.stubEnv('ZAI_CODING_CN_API_KEY', '');
    vi.stubEnv('BIGMODEL_API_KEY', '');
    await expect(
      executeGlmSearch({ mode: 'search', query: 'anything', timeoutMs: 1000, settings: {} }),
    ).rejects.toThrow(/ZAI_API_KEY|config set glm.apiKey/);
  });

  it('reads a key from the environment aliases when the file has none', async () => {
    vi.stubEnv('ZAI_API_KEY', '');
    vi.stubEnv('ZHIPUAI_API_KEY', '');
    vi.stubEnv('ZAI_CODING_CN_API_KEY', 'zai-from-plan');
    vi.stubEnv('BIGMODEL_API_KEY', '');
    const calls = mockFetchJson({ search_result: [] });
    await executeGlmSearch({ mode: 'search', query: 'q', timeoutMs: 1000, settings: {} });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer zai-from-plan');
  });

  it('posts to the documented endpoint with the documented body', async () => {
    const calls = mockFetchJson({ search_result: [] });
    await executeGlmSearch({
      mode: 'search',
      query: 'v4 contract',
      maxResults: 3,
      timeoutMs: 1000,
      settings: { apiKey: 'zai-test' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://open.bigmodel.cn/api/paas/v4/web_search');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer zai-test');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      search_query: 'v4 contract',
      search_engine: 'search_std',
      search_intent: false,
      count: 3,
    });
  });

  it('honors a configured search engine and caps the result count', async () => {
    const calls = mockFetchJson({ search_result: [] });
    await executeGlmSearch({
      mode: 'search',
      query: 'q',
      maxResults: 200,
      timeoutMs: 1000,
      settings: { apiKey: 'zai-test', model: 'search_pro' },
    });
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      search_engine: 'search_pro',
      count: 50,
    });
  });

  it('snaps the count to an allowed value for search_pro_sogou', async () => {
    const calls = mockFetchJson({ search_result: [] });
    await executeGlmSearch({
      mode: 'search',
      query: 'q',
      maxResults: 7,
      timeoutMs: 1000,
      settings: { apiKey: 'zai-test', model: 'search_pro_sogou' },
    });
    expect(JSON.parse(calls[0].init.body as string).count).toBe(10);
  });

  it('truncates a query longer than the API limit and says so', async () => {
    const calls = mockFetchJson({ search_result: [] });
    const long = 'x'.repeat(120);
    const parsed = await executeGlmSearch({
      mode: 'search',
      query: long,
      timeoutMs: 1000,
      settings: { apiKey: 'zai-test' },
    });
    expect((JSON.parse(calls[0].init.body as string).search_query as string).length).toBe(70);
    const result = parsed.result as { uncertainty: string[] };
    expect(result.uncertainty.join(' ')).toMatch(/truncated to 70 characters/);
  });

  it('maps the documented result fields into the shared contract', async () => {
    mockFetchJson({
      id: '20251025abc',
      created: 1748261757,
      request_id: 'req-1',
      search_intent: [{ query: 'q', intent: 'SEARCH_ALL', keywords: 'q' }],
      search_result: [
        {
          title: 'A',
          content: 'summary a',
          link: 'https://a.example.com/page',
          media: 'Example',
          icon: 'https://a.example.com/i.png',
          refer: 'ref_1',
          publish_date: '2025-10-25',
        },
        { title: 'B', content: 'summary b', link: 'not a url' },
      ],
    });

    const parsed = await executeGlmSearch({
      mode: 'search',
      query: 'q',
      timeoutMs: 1000,
      settings: { apiKey: 'zai-test' },
    });

    const result = parsed.result as {
      summary: string;
      items: Array<Record<string, unknown>>;
      uncertainty: string[];
    };
    expect(result.summary).toContain('search_std');
    expect(result.items).toEqual([
      {
        title: 'A',
        url: 'https://a.example.com/page',
        snippet: 'summary a',
        source: 'a.example.com',
        published_at: '2025-10-25',
      },
      { title: 'B', url: 'not a url', snippet: 'summary b', source: undefined },
    ]);
    expect(result.uncertainty).toEqual([]);
    expect(parsed.meta.usage).toMatchObject({ resultCount: 2, searchEngine: 'search_std' });
  });

  it('reports an unfunded account as a quota failure the cooldown layer reads', async () => {
    // The Web Search API is billed separately from the model calls a coding
    // plan covers, so this is the failure a plan key actually produces.
    mockFetchJson(
      { error: { code: '1113', message: '余额不足或无可用资源包,请充值。' } },
      { ok: false, status: 429 },
    );
    await expect(
      executeGlmSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'zai-test' },
      }),
    ).rejects.toThrow(/no search balance/i);
  });

  it('treats a rejected key as a key failure', async () => {
    mockFetchJson({ error: { code: '1000', message: '身份验证失败' } }, { ok: false, status: 401 });
    await expect(
      executeGlmSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'zai-test' },
      }),
    ).rejects.toThrow(/rejected the API key/i);
  });

  it('treats a rate limit as transient rather than a spent quota', async () => {
    mockFetchJson({ error: { code: '1302', message: '账户达到速率限制' } }, { ok: false, status: 429 });
    await expect(
      executeGlmSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'zai-test' },
      }),
    ).rejects.not.toThrow(/no search balance/i);
  });

  it('redacts every configured key from the error message', async () => {
    const secret = 'zai-secret-value';
    mockFetchJson({ error: { code: '1000', message: `key ${secret} rejected` } }, { ok: false, status: 401 });
    let error: Error | undefined;
    try {
      await executeGlmSearch({
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
    const calls = mockFetchJson({ search_result: [] });
    await executeGlmSearch({
      mode: 'search',
      query: 'q',
      timeoutMs: 1000,
      settings: { apiKey: 'zai-test', baseURL: 'https://gw.example.com/glm/' },
    });
    expect(calls[0].url).toBe('https://gw.example.com/glm/api/paas/v4/web_search');
  });
});
