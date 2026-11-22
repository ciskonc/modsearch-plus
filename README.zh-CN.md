<div align="center">

<img src="https://raw.githubusercontent.com/ciskonc/modsearch-plus/main/assets/banner.jpg" alt="modsearch-plus" width="720">

# modsearch-plus

**为模型没有网页搜索能力的聊天应用补上 web 搜索、X 搜索与网页抓取——免费起步，无需注册，无需 API key。**

引擎以链式运行并自动故障转移：keyless 引擎默认在位，有 key 引擎在配额与预算允许时接管。

<p align="center">
  <a href="LICENSE"><img alt="GitHub license" src="https://img.shields.io/github/license/ciskonc/modsearch-plus"></a>
  <a href="https://github.com/ciskonc/modsearch-plus"><img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/ciskonc/modsearch-plus"></a>
  <a href="https://github.com/ciskonc/modsearch-plus/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/ciskonc/modsearch-plus"></a>
  <a href="https://github.com/ciskonc/modsearch-plus/graphs/contributors"><img alt="GitHub contributors" src="https://img.shields.io/github/contributors/ciskonc/modsearch-plus"></a>
  <a href="https://www.npmjs.com/package/modsearch-plus"><img alt="npm version" src="https://img.shields.io/npm/v/modsearch-plus"></a>
</p>

[English](README.md) | 中文

</div>

---

## 简介

modsearch-plus 是面向聊天应用的网页搜索插件：为模型补上 web 搜索、X 搜索与网页抓取三项能力，背后是一条自动故障转移的引擎链，免费起步、无注册、无 API key。本仓库是 [liustack/modsearch](https://github.com/liustack/modsearch) 的 fork，基于上游 v5.10.10 并合入上游 5.10.11 与 5.10.12 的变更，在引擎链上扩展出 MiniMax 与 GLM（智谱）原生搜索引擎。

模型手里没有搜索结果时，只能拿训练数据里的东西来答。训练截止之后发布的消息和此刻还在变的网页它都够不着，遇到没学过的话题就更没辙。碰上这种情况，它要么凭记忆硬答，要么承认不知道。

引擎链接上之后，搜索能力直接挂进聊天本身：遇到需要联网的问题，模型在对话中即时搜索。

## 截图

DeepSeek Harness 网页端的设置卡片：选首选引擎、填 API key、配置自托管端点、勾选参与故障转移的引擎。

<p align="center"><img src="https://raw.githubusercontent.com/ciskonc/modsearch-plus/main/assets/demo-dsh-settings-card.jpg" alt="设置卡片" width="720"></p>

模型视角的搜索与取页效果：

<p align="center">
  <img src="https://raw.githubusercontent.com/ciskonc/modsearch-plus/main/assets/demo-dsh-web-search.png" alt="DeepSeek Harness 中的 web 搜索" width="420">
  <img src="https://raw.githubusercontent.com/ciskonc/modsearch-plus/main/assets/demo-codex-search.png" alt="Codex 中的搜索" width="420">
</p>

## 引擎

引擎按链式运行并自动故障转移：某个引擎被限流、配额耗尽或鉴权失败时，下一个引擎接管请求。Firecrawl 是 keyless 默认引擎，因此不做任何配置搜索也能工作。

| 引擎 | 能力 | 免费额度 | 启用方式 |
|---|---|---|---|
| Firecrawl | Web 搜索 + 网页抓取 | 每月 1000 免费 credits | 默认启用，keyless |
| Keenable | Web 搜索 | 1000 请求/小时/IP | Keyless |
| You.com | Web 搜索 | 100 次/天/IP | Keyless |
| Antigravity CLI | Web 搜索 + 网页抓取 | 免费 | 安装 CLI 并登录 |
| Tavily | Web 搜索 | 每月 1000 credits | API key |
| Exa | Web 搜索 | 每月 $10 额度（约 1400 次搜索，无需绑卡） | API key |
| MiniMax | Web 搜索 | M Plan 订阅密钥 | API key |
| Zhipu | Web 搜索（MCP 或 REST） | 套餐积分，或按次付费 0.01 元/次（余额计费） | API key；通道设置决定走哪条 |
| MiniMax websearch | Web 搜索 | 按次付费，0.03 元/次 | API key |
| Grok Build | X（Twitter）搜索 | 随 SuperGrok 或 X Premium 订阅 | 安装 Grok Build 并登录 |
| local | 网页抓取 | 免费 | 无需配置 |

Tavily、Exa、Firecrawl、Keenable、MiniMax、MiniMax websearch、Zhipu（智谱）支持逗号分隔多 key，在鉴权失败、限流或配额耗尽时自动轮换。密钥保存在 `~/.modsearch/config.json`（权限 0600）或环境变量（如 `TAVILY_API_KEY`）。自托管端点按引擎设置，例如 `modsearch config set tavily.baseURL <url>`。

## 安装

<details>
<summary>DeepSeek Harness（推荐）</summary>

```sh
npx -y @deepseek-ai/dsh plugin --profile web add modsearch-plus@5.11.1
```

桌面应用在 Add plugin 对话框中输入 `modsearch-plus`。0.1.6-alpha.2 之前的 dsh 版本，设置卡片位于 Settings → Plugins → Plugin config。

</details>

<details>
<summary>其他宿主</summary>

Claude Code、Codex、Pi、OpenCode 以 skill 方式安装，skill 本身来自上游项目：

```sh
npx skills add liustack/modsearch
```

</details>

<details>
<summary>从源码构建</summary>

```sh
git clone https://github.com/ciskonc/modsearch-plus.git
```

</details>

## 使用

没有命令要记。安装完成后搜索能力即在位：问题需要联网时，模型在对话中即时搜索，答案附带来源；聚合性内容带 uncertainty 字段标注可信度。

<details>
<summary>设置卡片</summary>

在 DeepSeek Harness 设置卡片中选择首选引擎、填入 API key、配置自托管端点、勾选参与故障转移的引擎。保存即生效；已保存的 key 不会发送到浏览器。

</details>

<details>
<summary>与 DSH 的集成方式</summary>

引擎链成为 DSH web seam 的 searchProvider——原生 web search 工具跑在 modsearch 上；x_search 与 read_page 注册为 raw tool，模型可直接调用。

</details>

## 兼容性

| 插件版本 | 实测 DSH | 说明 |
|---|---|---|
| 5.11.0（2026-11-21） | 0.2.2-rc.5 | 两个智谱引擎合并为单个 `zhipu` 引擎，带 `channel` 设置（`auto` / `coding` / `rest`）；设置卡片把引擎链排成可拖拽的单列。破坏性变更：`glm-coding.*` 与 `glm.*` 配置不迁移，密钥需改设 `zhipu.apiKey` |
| 5.10.15（2026-11-20） | 0.2.2-rc.5 | 包元数据改为指向本 fork；新增 `screenshots.json` |
| 5.10.14 | 0.2.2-rc.5 | DSH rc.5 设置卡片修复 |
| 5.10.x | DSH ≥ 0.2.x | 5.10.x 线在 DSH 0.2.x 及以上测试 |

非 dsh 宿主（Claude Code、Codex、Pi、OpenCode）以 skill 方式运行 modsearch，不适用 DSH 列。

## 致谢

modsearch-plus 是 [liustack/modsearch](https://github.com/liustack/modsearch) 的 fork：引擎链与插件本体来自上游，本 fork 在其上新增 MiniMax 与智谱原生引擎。感谢上游项目。

感谢链上引擎服务提供方：Firecrawl、Keenable、You.com、Antigravity CLI、Tavily、Exa、MiniMax、智谱、Grok。

## 许可证

MIT。许可信息见[仓库](https://github.com/ciskonc/modsearch-plus)。
