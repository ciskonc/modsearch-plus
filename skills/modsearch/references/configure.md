# Configuring ModSearch

English | [简体中文](configure.zh-CN.md)

Read this when the user asks how to set up modsearch, wants a key added, wants a different engine, or hits a setup-related failure. Run the commands for them instead of pasting instructions.

## The mental model

Three jobs, called roles. Each role has engines that can do it:

| Job | Engines | Configurable? |
| :-- | :-- | :-- |
| search the public web | `firecrawl`, `keenable`, `antigravity-cli`, `tavily`, `exa`, `minimax`, `glm`, `minimax-websearch` | preferred engine plus per-engine participation |
| read one URL | the preferred engine if it can fetch, then `firecrawl`, `antigravity-cli`, `local` | per-engine participation |
| search X (Twitter) | `grok-cli` | per-engine participation |

The search order is fixed at `firecrawl` then `keenable` then `antigravity-cli` then `tavily` then `exa` then `minimax` then `glm` then `minimax-websearch`, and fetch is `firecrawl` then `antigravity-cli` then `local`. Every engine participates by default. `engines.<name>.enabled: false` filters one out, availability filters what remains, and quota cooldown reorders the ready chain (see below). Firecrawl leads both chains because its keyless tier works on a bare machine, no signup, no key. Keenable comes second in search for the same reason, so a bare machine still has a keyless fallback when Firecrawl's allowance runs out. The China-market engines come last on purpose: each of their calls spends money or plan quota, so the free engines get the first attempt and these answer only when the earlier ones are missing or spent. Pinning one with `engine` puts it first without giving up the fallback.

Two facts follow from this table, and they answer most questions:

- **Page fetch works with no setup.** The `local` engine needs nothing installed and is the default last resort. It only leaves the automatic chain when the user explicitly disables it.
- **Web search works keyless on Firecrawl's free quota** (1,000 credits/month, no signup), with Keenable's keyless pool (1,000 requests/hour per IP) behind it. A configured `engine` choice takes precedence when set. The search chain does not include `local`, because `local` cannot search. If both keyless engines are rate-limited, search needs at least one keyed engine or `agy` as a fallback. Fetch still has `local` as a floor.

X is a separate corpus, not a competing search engine, so it never replaces web search. `--source` chooses corpora, `--engine` chooses the tool.

## Zero setup

modsearch runs with no config file at all: fetch has `local` as a floor, and search runs on Firecrawl's keyless free quota, then Keenable's. Search has no `local` fallback (`local` cannot search), so when both keyless engines are rate-limited it needs a keyed engine or `agy`. It looks at what is on the machine and uses the best thing available. Only create a config when the user wants to change that.

Antigravity CLI is the best free upgrade, because it synthesizes cited answers and covers both search and fetch with no key:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # the user completes a browser sign-in, then exits
```

Sign-in cannot be done non-interactively: ask the user to run `agy` once themselves.

## Config file

`~/.modsearch/config.json`, written 0600, keys masked when shown. Precedence: CLI flags > environment variables > this file > built-in defaults.

```bash
modsearch config init     # starter file, every field optional
modsearch config show     # effective config: file + env merged, each value tagged (file)/(env), keys masked, alias keys shown canonical
```

Full structure. Every field is optional, and so is the file itself:

```json
{
  "engine": "tavily",
  "cooldown": "on",
  "allowPrivateNetwork": false,
  "engines": {
    "antigravity-cli": { "bin": "agy", "model": "gemini-3.6-flash-low" },
    "tavily":          { "apiKey": "tvly-...", "baseURL": "https://gw.example.com/tavily" },
    "exa":             { "apiKey": "...", "enabled": false },
    "firecrawl":       { "apiKey": "fc-...", "keylessFetch": false },
    "keenable":        { "apiKey": "..." },
    "minimax":         { "apiKey": "sk-cp-..." },
    "minimax-websearch": { "apiKey": "sk-cp-...", "model": "MiniMax-M3.1-Flash" },
    "glm":             { "apiKey": "...", "model": "search_std" },
    "grok-cli":        { "bin": "grok" }
  }
}
```

JSON has no comments, so here is every field:

| Field | Type | Applies to | Meaning |
| :-- | :-- | :-- | :-- |
| `engine` | string | top level | Which engine searches. Empty means automatic (the best available here). One of `antigravity-cli`, `tavily`, `exa`, `firecrawl`, `keenable`, `minimax`, `minimax-websearch`, `glm`. The aliases `agy`, `antigravity`, `grok`, `http`, `direct`, `zhipu`, `bigmodel`, `minimax-search` are accepted and normalized to the canonical name. |
| `cooldown` | `"on"` / `"off"` | top level | Quota cooldown failover. On by default. Off reads and writes no state and routes exactly as before. |
| `allowPrivateNetwork` | boolean | top level | Allow the local fetcher to reach private or reserved addresses, including other VPN ranges and hosts-file accelerators. Default `false`. DNS answers in `198.18.0.0/15` already pass as fake-IP placeholders without this switch. Literal URLs in that range stay blocked while it is off. This setting never authorizes Firecrawl cloud disclosure. Literal private and reserved targets always stay off the cloud. For DNS answers, Firecrawl withholds the URL only when every address is private or reserved after the fake-IP exemption. |
| `engines` | object | top level | Per-engine settings, keyed by canonical engine name. |
| `engines.<name>.enabled` | boolean | every engine | Whether automatic routing may use this engine. Missing means enabled. Set `false` to exclude it. Setting `true` removes the override and returns to the built-in default. An explicit `--engine` still forces that engine for one run. |
| `engines.<name>.apiKey` | string | `tavily`, `exa`, `firecrawl`, `keenable`, `minimax`, `minimax-websearch`, `glm` | One API key, or multiple keys separated by commas. Whitespace and empty comma items are ignored. Authentication, rate-limit, and quota failures rotate through the keys in order. Network, 5xx, and parsing failures go directly to the next engine. Also settable via `TAVILY_API_KEY` / `EXA_API_KEY` / `FIRECRAWL_API_KEY` / `KEENABLE_API_KEY` / `MINIMAX_API_KEY` / `ZAI_API_KEY`, which win over the file. |
| `engines.<name>.baseURL` | string | `tavily`, `exa`, `firecrawl`, `keenable`, `minimax`, `minimax-websearch`, `glm` | Endpoint base replacing the official host: a compatible third-party gateway, a proxy, a self-hosted deployment. Must be a full http(s) URL. Also settable via `TAVILY_BASE_URL` / `EXA_BASE_URL` / `FIRECRAWL_BASE_URL` / `KEENABLE_BASE_URL` / `MINIMAX_BASE_URL` / `ZAI_BASE_URL`. Empty unsets it. See the endpoint section below. |
| `engines.firecrawl.keylessFetch` | boolean | `firecrawl` | Allow public-page fetch through Firecrawl without a key. Default `true` (keyless fetch is on as installed). Set `false` to keep automatic page fetch off Firecrawl's cloud; a configured key or an explicit Firecrawl engine choice still enables it. |
| `engines.<name>.bin` | string | `antigravity-cli`, `grok-cli` | Path to the engine's CLI binary. Defaults to `agy` and `grok` found on `PATH`. |
| `engines.<name>.model` | string | `antigravity-cli`, `minimax-websearch`, `glm` | Model the engine uses. `antigravity-cli` defaults to `gemini-3.6-flash-low`. `minimax-websearch` defaults to `MiniMax-M3.1-Flash`, the model MiniMax documents for its server-side web_search tool. `glm` reads it as the search engine code: `search_std` (0.01 CNY a call), `search_pro` (0.03), `search_pro_sogou` and `search_pro_quark` (0.05 each). |

`local` (the built-in fetcher) and `grok-cli` take no credentials, but both accept the shared `enabled` switch. An old file that kept `allowPrivateNetwork` under `engines.http.allowPrivateNetwork`, or as the string `"true"`/`"false"`, is read and promoted to the top-level boolean automatically.

```bash
modsearch config set engine tavily            # choose the search engine
modsearch config set engine ""                # back to automatic
modsearch config set tavily.apiKey <key>      # engine credentials
modsearch config set tavily.apiKey <key1,key2> # rotate keys in this order
modsearch config set tavily.apiKey            # no value: hidden prompt (see below)
modsearch config set tavily.baseURL <url>     # a compatible third-party endpoint
modsearch config set tavily.enabled false     # keep Tavily out of automatic failover
modsearch config set tavily.enabled true      # remove the opt-out
modsearch config set cooldown off             # turn off quota cooldown failover
modsearch config set allowPrivateNetwork true # reach reserved/private ranges
```

When the user is about to paste a key into the chat, offer the cleaner path
first: run `modsearch config set <engine>.apiKey` with no value in their
terminal, and the CLI prompts with the echo muted, so the key never enters
this conversation, argv, or their shell history (`pbpaste | modsearch config
set tavily.apiKey` pipes it too). If they paste it into the chat anyway, just
save it for them: the offer is for the users who care, not a gate.

The shared `enabled` switch applies to search, fetch, and X. Fetching uses the preferred engine when it can fetch, then the enabled engines in the built-in order. Disabling `local` removes the default fetch floor. Disabling `grok-cli` makes an X request take the documented public-web degrade path. A one-off explicit `--engine` ignores these persistent opt-outs.

A config written before roles existed (one global `provider` plus a `providers` map) is read and mapped automatically. Nothing to migrate by hand.

## Engine setup

### antigravity-cli (search + fetch, free, no key)

Install and sign in as above. Its free tier is a weekly quota shared with the Antigravity desktop app and SDK, so a heavy day can exhaust it. The error says so plainly when that happens.

```bash
modsearch config set antigravity-cli.model gemini-3.1-pro-high   # harder research questions
modsearch config set antigravity-cli.bin /custom/path/to/agy
```

### tavily (search, free tier)

1,000 credits a month, no credit card, one credit per basic search. Key from https://app.tavily.com.

```bash
modsearch config set tavily.apiKey <key>
# or environment: export TAVILY_API_KEY=<key>
```

Good insurance when the keyless quota and agy both run dry: with a key present, web search falls to Tavily on its own.

### exa (search, free monthly credit)

$10 of recurring monthly credit, about 1,400 searches, no card. Key from https://exa.ai.

```bash
modsearch config set exa.apiKey <key>
# or environment: export EXA_API_KEY=<key>
```

Exa ranks and links with highlight snippets but writes no synthesis, so its summary is mechanical and the evidence is in `items`. It sits after Tavily in the search order.

### firecrawl (search + fetch, keyless by default)

The default engine, and the reason a bare install works: Firecrawl's keyless tier grants [1,000 free credits a month with no signup](https://www.firecrawl.dev/blog/firecrawl-keyless-launch). Keyless requests omit the Authorization header and are metered per IP with daily request and credit caps (Firecrawl does not publish the daily numbers in its [rate-limit documentation](https://docs.firecrawl.dev/rate-limits#keyless-no-api-key)). A free key from https://firecrawl.dev adds a personal 1,000 credits/month and higher limits:

```bash
modsearch config set firecrawl.apiKey <key>
# or environment: export FIRECRAWL_API_KEY=<key>
modsearch config set firecrawl.keylessFetch false   # keep automatic page fetch off the cloud
```

Both roles run keyless out of the box. Fetch is where Firecrawl earns its lead: it runs a real browser in the cloud, so JavaScript-rendered pages come back with content the local engine cannot see. That also means a public URL is sent to a third party, and the result warning names that boundary on every cloud fetch. To keep automatic page fetch local-only, set `firecrawl.keylessFetch false`: search stays keyless, and fetch skips Firecrawl unless a key is configured or `-e firecrawl` selects it explicitly. A literal private or reserved target is always skipped, even with `--allow-private-network` on. Hostname DNS answers use a narrower cloud-disclosure rule. The standard Clash, Surge, and mihomo fake-IP pool `198.18.0.0/15` is treated as a placeholder, and a hostname stays off Firecrawl only when every resolved address is genuinely private or reserved. Any public answer allows the public URL through. This exception is DNS-only. The local SSRF guard still treats `198.18.0.0/15` as private, and the switch only lets that local engine reach it.

Every Firecrawl fetch spends a credit and forces a fresh crawl. modsearch sends `maxAge: 0`, which disables Firecrawl's default multi-day cache, so a fetch can never return stale content. The trade is deliberate: a credit per fetch in exchange for currency, which is the point of the tool. If you would rather trade freshness for credits, Firecrawl is not the engine to reach for.

### keenable (search, keyless by default)

Works with no key and no signup, and sits second in the search order, right after Firecrawl. Keyless requests go to Keenable's public endpoint, which allows 1,000 requests an hour per IP (shared by everyone on that IP) and at most 10 a second. A free key from https://app.keenable.ai moves the calls to the keyed endpoint: no hourly cap, 100,000 requests a month per organization.

```bash
modsearch config set keenable.apiKey <key>
# or environment: export KEENABLE_API_KEY=<key>
```

Keenable searches only, so `-u` with `-e keenable` is an error. Like Exa, it returns ranked links with snippets (and a publish date when Keenable has one) but writes no synthesis, so its summary is mechanical, a warning says so, and the evidence is in `items`.

### minimax (search, model-free, MiniMax key)

Searches MiniMax's own index without running a model: the engine posts to `/v1/coding_plan/search`, the endpoint the official MiniMax MCP server calls, and gets back ranked hits (title, link, snippet, date). Nothing rewrites the evidence, so the summary is mechanical and the sources are in `items`.

```bash
modsearch config set minimax.apiKey <key>
# or environment: export MINIMAX_API_KEY=<key>
```

The key is a MiniMax M Plan subscription key (`sk-cp-...`); a pay-as-you-go key (`sk-api-...`) works for the model side but not for this endpoint. The key belongs to one region: a mainland account works against `api.minimax.cn` (and `api.minimaxi.com`), a global account against `api.minimax.io`. A mismatch answers with an invalid-key error, so point `minimax.baseURL` at the host of the account the key came from. This endpoint is not in MiniMax's public API reference, so its shape may change; the engine reads every field loosely and fails soft rather than crashing on a missing one.

### minimax-websearch (search, runs a model, MiniMax key)

The other shape MiniMax offers: the server-side `web_search` tool, declared on an Anthropic-compatible request. MiniMax runs the search, writes an answer, and hands back the results it used. The summary is therefore a model's writing, and the items are the search results behind it.

```bash
modsearch config set minimax-websearch.apiKey <key>
modsearch config set minimax-websearch.model MiniMax-M3.1-Flash
# or environment: export MINIMAX_API_KEY=<key>
```

It costs a model call on top of the search itself (the server-side tool is billed per call, 0.03 CNY in mainland China) and takes noticeably longer than the model-free engine, so it sits last in the search order. The model defaults to `MiniMax-M3.1-Flash`, the one MiniMax documents for web_search.

### glm (search, Zhipu Web Search API)

Zhipu's Web Search API is a pure retrieval service: it returns structured results (title, summary, link, publish date, source name) with no model in the loop, which is the shape modsearch's contract expects.

```bash
modsearch config set glm.apiKey <key>
modsearch config set glm.model search_std        # search_std | search_pro | search_pro_sogou | search_pro_quark
# or environment: export ZAI_API_KEY=<key>
```

The Web Search API is billed per call against the account balance (0.01 CNY for `search_std`, 0.03 for `search_pro`, 0.05 for the Sogou and Quark engines). A coding-plan key covers model calls, not this service: an unfunded account answers 429 with code 1113, which modsearch reads as a spent quota and cools down rather than retrying. The query is capped at 70 characters by the API; a longer one is truncated, and the result says so.

### Third-party compatible endpoints (tavily, exa, firecrawl, keenable, minimax, glm)

The HTTP engines can point at any endpoint that speaks the same API as the official one: a reseller gateway, a regional proxy, a self-hosted deployment. Set `baseURL` and the engine appends its documented path to it (`/search` for tavily and exa, `/v2/search` and `/v2/scrape` for firecrawl, `/v1/search` for keyed keenable and `/v1/search/public` for keyless keenable, `/v1/coding_plan/search` for minimax, `/api/paas/v4/web_search` for glm), so a base of `https://gw.example.com/tavily` posts to `https://gw.example.com/tavily/search`.

The official bases are built into the providers: `https://api.tavily.com`, `https://api.exa.ai`, `https://api.firecrawl.dev`, `https://api.keenable.ai`, `https://api.minimax.cn`, and `https://open.bigmodel.cn`. They are not copied into `config.json`. An absent or cleared `baseURL` means to use the built-in official base, which lets a later release correct that default without a stale file overriding it. The dsh settings card follows the same rule.

```bash
modsearch config set tavily.baseURL https://gw.example.com/tavily
modsearch config set tavily.baseURL ""        # back to the official endpoint
# or per run: export TAVILY_BASE_URL=... / EXA_BASE_URL=... / FIRECRAWL_BASE_URL=... / KEENABLE_BASE_URL=... / MINIMAX_BASE_URL=... / ZAI_BASE_URL=...
```

The API key is sent to whatever host the base names. That is the point, and it is also the trust decision: only name a host you would hand that key to.

### grok-cli (X, rides a SuperGrok or X Premium subscription)

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok    # the user signs in with SuperGrok or X Premium
```

Nothing else to turn on. An X-flavored query goes to X automatically once `grok` is installed and signed in. Without it, an X question is answered from the public web, and the result says so in `warnings`.

### local (fetch, nothing to install)

The built-in direct fetcher (`http` and `direct` still work as aliases). No setup. It carries SSRF guards (private ranges, cloud metadata, per-hop redirect checks, size caps) and pins each connection to the validated IP, so DNS rebinding cannot slip past. It runs no JavaScript, so it is not a full browser sandbox: still run untrusted URLs in a sandboxed working directory.

Two proxy shapes:

1. TUN + fake-IP (Clash, Clash Verge Rev, mihomo, Surge). DNS answers in `198.18.0.0/15` are treated as fake-IP placeholders, so no switch is needed. The connection stays pinned to the checked fake IP, with the hostname kept for the Host header and TLS SNI. A literal URL such as `http://198.18.0.5/` is still blocked when `allowPrivateNetwork` is off.
2. System HTTP proxy (`http_proxy` / `https_proxy` environment variables, DNS returns real IPs). Set those env vars. The local engine then forwards through the proxy. The proxy resolves the hostname, so the socket is not pinned to a checked IP.

A split-tunnel VPN that maps public hosts into other reserved ranges, or a hosts-file accelerator such as Watt Toolkit / Steam++ that maps them to loopback, still needs the local-only waiver:

```bash
modsearch -u <url> --allow-private-network
modsearch config set allowPrivateNetwork true   # make it permanent (top-level, global)
```

## Quota cooldown failover

When an API key fails with a quota-class error, modsearch remembers that key in `~/.modsearch/state.json` (separate from `config.json`). The next run tries healthy keys in the same engine first. The engine moves to the back of the fallback chain only when every configured key is cooling. Engines without API keys keep one engine-level cooldown. This is a softened circuit breaker, not load sharing: healthy keys and engines keep the whole job, while cooling ones remain available as last attempts.

- A cooling key is never dropped. A success clears that key's cooldown at once. Old engine-level state entries still load and apply to every configured key until a successful key clears the legacy entry.
- A precise reset time in the engine's message (agy's `Resets in 94h19m9s`) is honored. A quota error without one cools for 45 minutes. A per-second rate limit is transient and never recorded.
- An explicit `-e`/`--engine` remains a hard force with no cross-engine fallback. Within a multi-key engine, healthy keys are still tried before cooling keys.
- The result's `warnings` identify the key that entered cooldown. Routing warnings name an engine only when all of its configured keys are cooling and it moves to the back.

The switch is on by default:

```bash
modsearch config set cooldown off   # disable: read and write no state, route exactly as before
modsearch config set cooldown on    # re-enable
modsearch state clear               # forget every cooldown now
```

`modsearch doctor` shows the switch and every engine or key cooling right now, with the time left.

## Troubleshooting

- `firecrawl rejected the keyless request`: anonymous access is unavailable or rate-limited. Set a free Firecrawl key, wait for the daily allowance to recover, or use another engine. Search has no `local` fallback (`local` cannot search).
- Quota errors from agy: the weekly free quota is spent. Add a keyed search engine, or wait for the reset named in the message. With cooldown on, agy is moved to the back on its own until it resets.
- `keenable's keyless pool for this IP is used up for the hour`: the shared keyless pool (1,000 requests/hour per IP) is spent. The next search engine picks up the work. Set a free Keenable key for 100,000 requests a month of your own.
- `exa is out of credits` / `firecrawl is out of credits` / `keenable is out of credits`: the current budget is spent. Another search engine picks up the work, and cooldown moves the spent one to the back until it recovers.
- `glm has no search balance` (code 1113): Zhipu's Web Search API is billed separately from the model calls, so a coding-plan key alone does not cover it. Top up at https://open.bigmodel.cn, or search with another engine. Cooldown holds the engine until then.
- `minimax rejected the API key`: a MiniMax key only works on the host of its own region. A mainland key needs `api.minimax.cn` (or `api.minimaxi.com`), a global key needs `api.minimax.io`; set `minimax.baseURL` to the matching host. The model-free search endpoint also needs an M Plan subscription key (`sk-cp-...`).
- `Blocked private network target`: SSRF guard. If the user is behind a VPN, retry with `--allow-private-network`.
- Wrong engine name in config: modsearch says so in `warnings` and uses a working engine anyway. Fix the name when the user wants that engine back.
- Timeouts: retry once with `--timeout 300000` before reporting failure.
