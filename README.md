<div align="center">

<img src="https://raw.githubusercontent.com/ciskonc/modsearch-plus/main/assets/banner.jpg" alt="modsearch-plus" width="720">

# modsearch-plus

**Web search, X search, and page fetch for chat apps whose models cannot search the web — free, no signup, no API key to start.**

Engines run as a chain with automatic failover: keyless engines are in place by default, keyed engines take over as quota and budget allow.

<p align="center">
  <a href="LICENSE"><img alt="GitHub license" src="https://img.shields.io/github/license/ciskonc/modsearch-plus"></a>
  <a href="https://github.com/ciskonc/modsearch-plus"><img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/ciskonc/modsearch-plus"></a>
  <a href="https://github.com/ciskonc/modsearch-plus/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/ciskonc/modsearch-plus"></a>
  <a href="https://github.com/ciskonc/modsearch-plus/graphs/contributors"><img alt="GitHub contributors" src="https://img.shields.io/github/contributors/ciskonc/modsearch-plus"></a>
  <a href="https://www.npmjs.com/package/modsearch-plus"><img alt="npm version" src="https://img.shields.io/npm/v/modsearch-plus"></a>
</p>

English | [中文](README.zh-CN.md)

</div>

---

## Introduction

modsearch-plus is a web search plugin for chat applications. It gives the model web search, X search, and page fetch behind a single engine chain that fails over automatically, and it is free to start: no signup, no API key. The repository is a fork of [liustack/modsearch](https://github.com/liustack/modsearch), based on upstream v5.10.10 with the 5.10.11 and 5.10.12 upstream changes merged in, and extends the chain with native MiniMax and GLM (Zhipu) search engines.

A chat model with no search tool can only answer from what its training data holds. News published after its cutoff and pages that are still changing are out of its reach, and topics it was never trained on are more hopeless still. Faced with those, the model guesses or admits it does not know.

Once the engine chain is wired in, search sits behind the chat itself: a question that needs the web triggers a search mid-conversation.

## Screenshot

The settings card in the DeepSeek Harness web app: pick a preferred engine, enter API keys, set a self-hosted endpoint, and tick the engines that join the failover chain.

<p align="center"><img src="https://raw.githubusercontent.com/ciskonc/modsearch-plus/main/assets/demo-dsh-settings-card.jpg" alt="Settings card" width="720"></p>

Search and fetch as the model sees them:

<p align="center">
  <img src="https://raw.githubusercontent.com/ciskonc/modsearch-plus/main/assets/demo-dsh-web-search.png" alt="Web search in DeepSeek Harness" width="420">
  <img src="https://raw.githubusercontent.com/ciskonc/modsearch-plus/main/assets/demo-codex-search.png" alt="Search in Codex" width="420">
</p>

## Engines

Engines run as a chain and fail over automatically: when one is rate-limited, out of quota, or fails authentication, the next engine takes the request. Firecrawl is the keyless default, so search works before any configuration.

| Engine | Capability | Free quota | Activation |
|---|---|---|---|
| Firecrawl | Web search + page fetch | 1,000 free credits/month | Default, keyless |
| Keenable | Web search | 1,000 requests/hour/IP | Keyless |
| You.com | Web search | 100 requests/day/IP | Keyless |
| Antigravity CLI | Web search + page fetch | Free | Install the CLI and sign in |
| Tavily | Web search | 1,000 credits/month | API key |
| Exa | Web search | $10/month of credits (about 1,400 searches, no card needed) | API key |
| MiniMax | Web search | M Plan subscription key | API key |
| GLM coding plan | Web search (MCP) | Included in the coding plan | API key |
| GLM | Web search (REST) | Pay-per-use, 0.01 CNY/request | API key with balance |
| MiniMax websearch | Web search | Pay-per-use, 0.03 CNY/request | API key |
| Grok Build | X (Twitter) search | Rides a SuperGrok or X Premium subscription | Install Grok Build and sign in |
| local | Page fetch | Free | No setup |

Keyed engines accept comma-separated multiple keys — Tavily, Exa, Firecrawl, Keenable, MiniMax, MiniMax websearch, and Zhipu — and rotate them automatically on authentication failures, rate limits, or exhausted quota. Keys live in `~/.modsearch/config.json` (permissions 0600) or in environment variables such as `TAVILY_API_KEY`. Self-hosted endpoints are set per engine, for example `modsearch config set tavily.baseURL <url>`.

## Installation

<details>
<summary>DeepSeek Harness (recommended)</summary>

```sh
dsh plugin --profile web add modsearch-plus
```

In the desktop app, enter `modsearch-plus` in the Add plugin dialog instead. On dsh releases before 0.1.6-alpha.2, the settings card lives under Settings → Plugins → Plugin config.

</details>

<details>
<summary>Other harnesses</summary>

Claude Code, Codex, Pi, and OpenCode install modsearch as a skill. The skill itself comes from the upstream project:

```sh
npx skills add liustack/modsearch
```

</details>

<details>
<summary>Build from source</summary>

```sh
git clone https://github.com/ciskonc/modsearch-plus.git
```

</details>

## Usage

There are no commands to memorize. After install, the search ability is simply there: when a question needs the web, the model searches mid-conversation, and the answer carries its sources. Aggregated content ships with an uncertainty field marking how reliable it is.

<details>
<summary>Settings card</summary>

In the DeepSeek Harness settings card you pick a preferred engine, enter API keys, set a self-hosted endpoint, and tick the engines that join the failover chain. Saving takes effect immediately, and keys already stored are never sent to the browser.

</details>

<details>
<summary>How it plugs into DSH</summary>

The engine chain becomes the search provider of DSH's native web seam — the built-in `web_search` tool runs on modsearch — while `x_search` and `read_page` are registered as raw tools the model can call directly.

</details>

## Compatibility

| Plugin version | DSH version tested | Notes |
|---|---|---|
| 5.10.15 (2026-11-20) | 0.2.2-rc.5 | Current release |
| 5.10.14 | 0.2.2-rc.5 | Settings card fix for DSH rc.5 |
| 5.10.x | DSH ≥ 0.2.x | The 5.10.x line is tested on DSH 0.2.x and later |

Non-DSH hosts (Claude Code, Codex, Pi, OpenCode) run modsearch as a skill, so the DSH column does not apply there.

## Credits

modsearch-plus is a fork of [liustack/modsearch](https://github.com/liustack/modsearch): the engine chain and the plugin itself come from upstream, and this fork adds the native MiniMax and GLM (Zhipu) engines on top. Thanks to the upstream project.

Thanks to the engine providers behind the chain: Firecrawl, Keenable, You.com, Antigravity CLI, Tavily, Exa, MiniMax, Zhipu (GLM), and Grok.

## License

MIT. Licensing information is maintained in the [repository](https://github.com/ciskonc/modsearch-plus).
