// Browser half of the modsearch dsh plugin: the settings card.
//
// dsh web users have no terminal, so `modsearch config set` is out of reach
// there and an engine key had no way in. dsh renders no generic form from a
// settings schema, so this card is contributed through a slot rather than
// declared as one: `plugins.bundle.config`, dispatched by the bundle's
// profile package name on the Plugins page (the old `settings.plugin.item`
// Settings seat was removed in the same release that retired the scoped
// client ctx.inject contract this file used to wait on). It reads and
// writes the plugin's own route, which owns ~/.modsearch/config.json: the
// browser never sees an API key, and never sends a blank one back over a
// stored one.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so no build step and no
// imports from dsh client packages: the same zero-dependency stance as the
// host half.
window.__ModuleLoader__.load({
  id: 'modsearch-plus',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // The engines the card offers, in the order the docs introduce them. The
    // host half carries the same list; both sides name what they show.
    var ENGINES = [
      'antigravity-cli',
      'tavily',
      'exa',
      'firecrawl',
      'keenable',
      'youcom',
      'minimax',
      'minimax-websearch',
      'zhipu',
      'grok-cli',
      'local',
    ];

    // Engines that search with no key and no signup.
    var KEYLESS_ENGINES = ['firecrawl', 'keenable', 'youcom'];

    // The chain is a row of search engines, so the page fetcher is not in it.
    // `local` reads a URL it is handed and searches for nothing, and a tickbox
    // among these would invite a decision that changes no search.
    var CHAIN_ENGINES = ENGINES.filter((name) => name !== 'local');

    // The Plugins page dispatches a bundle's configuration by the bundle's
    // profile package name (pkg.name). The profile installs this fork as
    // `@ciskonc/modsearch` today, and the pending rename moves it to
    // `modsearch-plus`, so the card registers under both: the one the page
    // dispatches renders, the other never matches and stays inert.
    var PACKAGE_NAME = 'modsearch-plus';
    var PROFILE_PACKAGE_NAME = '@ciskonc/modsearch';

    // Two short label sets rather than a locale bundle: the card has a couple
    // of dozen strings, and a bundle would be more machinery than the thing it
    // labels.
    var TEXT = {
      en: {
        trafficGreen: 'last call succeeded',
        trafficRed: 'last call failed',
        trafficGrey: 'never called',
        aiSection: 'AI permissions',
        allowEngines: 'Allow the AI to pin engines for a search',
        allowParallel: 'Allow the AI to run parallel multi-engine searches',
        aiHint:
          'Off by default. Pinned engines cost only what you would spend yourself; a parallel run bills every whitelisted engine, so the two are separate switches.',
        chainSection: 'Chain order & health',
        chainHint:
          'Drag arrows to reorder the chain (top tried first). The dot is the last real call: green succeeded, red failed, grey never called. Each row carries two ticks: the first joins the parallel set, the second keeps the engine in the failover chain.',
        probe: 'Test now',
        probeConfirm:
          'Run one real search on every enabled engine to refresh the lights? Each engine is really called and may bill (paid engines included).',
        probing: 'Probing…',
        parallel: 'P',
        parallelTick: 'P',
        failoverTick: 'failover',
        zhipuMode: 'Zhipu channel',
        zhipuModeAuto: 'Auto (plan credits first, then balance)',
        zhipuModeCoding: 'Coding-plan credits (MCP)',
        zhipuModeRest: 'Account balance (REST API)',
        dragHandle: 'Drag to reorder',
        moveUp: 'Move up',
        moveDown: 'Move down',
        title: 'Search engine (ModSearch)',
        subtitle: 'Search engine provider configuration.',
        // The heading on the Plugins page, which already names the plugin.
        section: 'Engine settings',
        automatic: 'Automatic (chain order decides)',
        // The keyless default is stated in the list, where an engine is chosen.
        keylessSuffix: ' (keyless free tier)',
        pickToConfigure: 'Pick an engine above to configure its key and endpoint.',
        engine: 'Preferred engine',
        apiKey: 'API key',
        apiKeyHint:
          'Separate multiple keys with commas. ModSearch rotates to the next key after authentication, rate-limit, or quota failures.',
        baseUrl: 'Base URL',
        model: 'Model',
        stored: 'stored, leave empty to keep it',
        unset: 'not set',
        endpointFallback: 'Built-in official endpoint, leave blank to use it',
        modelFallback: 'engine default',
        save: 'Save',
        saving: 'saving...',
        saved: 'saved',
        loading: 'loading...',
        discard: 'Discard',
        cliNote: 'This engine runs a local command-line tool: no key, no endpoint.',
        localNote: 'The built-in fetcher reads pages directly: no key, no endpoint.',
        youcomNote:
          "Runs on You.com's keyless free tier (100 searches a day per IP): no key, no endpoint.",
        envNote:
          'This key comes from an environment variable, which overrides the config file. Clear the variable to let a saved key take effect.',
        autoTitle: 'Automatic engine chain',
        autoHint: 'Two ticks per engine: parallel set and failover chain. Only engines ready here are listed.',
        autoUnknown: 'Engine status is unavailable right now, so every engine is listed.',
        autoEmpty: 'No engine is ready on this machine yet.',
        // Two engine-specific asides, each rendered by a branch of its own so
        // either can be dropped without touching the rest of the card.
        socialOnly: 'X search only',
        keylessTier: 'Runs on the keyless free tier by default. Add a key to raise the quota.',
        noKey: 'no key configured',
        loadFailed: 'load failed',
        saveFailed: 'save failed',
        retry: 'Retry',
      },
      zh: {
        // 不叫「网页搜索」：dsh 自带一张「网页搜索（DeepSeek 搜索提供方）」卡片，
        // 同一份列表里两个开头一样的名字谁也认不出来。这个名字与同门插件的
        // 「视觉引擎（ModLens）」成对。
        title: '搜索引擎（ModSearch）',
        subtitle: '搜索引擎提供商配置。',
        trafficGreen: '上次调用成功',
        trafficRed: '上次调用失败',
        trafficGrey: '从未调用',
        aiSection: 'AI 权限',
        allowEngines: '允许 AI 指定搜索引擎',
        allowParallel: '允许 AI 并行调用多个搜索引擎',
        aiHint:
          '默认关闭。指定渠道只花你自己点名才会花的钱；并行会真实调用白名单里的每个引擎，所以两者分开控制。',
        chainSection: '链序与健康',
        chainHint:
          '箭头调整顺序（越靠上越先尝试）。圆点是最近一次真实调用的结果：绿=成功，红=失败，灰=从未调用。每行两个勾：左边是参与并行，右边是参与故障转移。',
        probe: '立即测试',
        probeConfirm:
          '对每个已启用的引擎各执行一次真实搜索来刷新状态灯？每个引擎都会被真实调用，付费引擎会产生实际费用。',
        probing: '测试中…',
        parallel: '并',
        parallelTick: '并',
        failoverTick: '故障转移',
        zhipuMode: '智谱通道',
        zhipuModeAuto: '自动（先套餐积分，后余额）',
        zhipuModeCoding: '编程套餐积分（MCP）',
        zhipuModeRest: '账户余额（REST API）',
        dragHandle: '拖动排序',
        moveUp: '上移',
        moveUp: '上移',
        moveDown: '下移',
        section: '引擎设置',
        automatic: '自动（按故障转移顺序）',
        keylessSuffix: '（免注册免费）',
        pickToConfigure: '在上面选一个引擎，才能配置它的密钥和地址。',
        engine: '首选引擎',
        apiKey: 'API 密钥',
        apiKeyHint: '多个密钥用英文逗号分隔。鉴权、限流或配额失败时会自动轮换到下一个密钥。',
        baseUrl: '接口地址',
        model: '模型',
        stored: '已保存，留空即不改动',
        unset: '未设置',
        endpointFallback: '内置官方地址，留空即可使用',
        modelFallback: '使用该引擎默认值',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        loading: '加载中…',
        discard: '放弃修改',
        cliNote: '该引擎走本机命令行工具，无需密钥和接口地址。',
        localNote: '内置抓取器直连读取网页，无需密钥和接口地址。',
        youcomNote: '走 You.com 免注册免费额度（每个 IP 每天 100 次），无需密钥和接口地址。',
        envNote: '该密钥来自环境变量，环境变量优先于配置文件。清掉变量后保存的密钥才会生效。',
        autoTitle: '自动引擎链',
        autoHint: '每行两个勾：左边参与并行，右边参与故障转移。这里只列出本机已就绪的引擎。',
        autoUnknown: '暂时读不到引擎状态，所以列出全部引擎。',
        autoEmpty: '本机暂无就绪的引擎。',
        socialOnly: '仅 X 搜索',
        keylessTier: '默认使用免注册的免费额度，填入密钥可提高配额。',
        noKey: '未配置密钥',
        loadFailed: '加载失败',
        saveFailed: '保存失败',
        retry: '重试',
      },
    };

    // The copy this card speaks. `active` is dsh's own interface language,
    // when its locale service was there to say. Asked first because the page
    // language is not an answer: the built index.html freezes
    // `<html lang="zh-CN">` and never rewrites it, so a user set to English
    // would still read a Chinese card. Absent the service (older hosts,
    // profiles that ship no locale) the page then the browser decide.
    function labels(active) {
      var lang = (
        active ||
        document.documentElement.lang ||
        navigator.language ||
        'en'
      ).toLowerCase();
      return lang.indexOf('zh') === 0 ? TEXT.zh : TEXT.en;
    }

    // What the footer says when a request fails. Whatever the server said
    // travels untranslated ('unknown engine: x', a path error): that is the
    // diagnosis, and mapping it to error codes would buy a translation table
    // with a much larger contact surface than this card is worth. Only the
    // silent case, where there is no detail to show, gets a localized line.
    function noteFrom(error, fallback) {
      // An Error whose message is empty is the no-detail case, not a thing to
      // stringify: String(error) on it reads 'Error'.
      var detail =
        error && typeof error.message === 'string' ? error.message : error ? String(error) : '';
      return detail || fallback;
    }

    /** Whether this engine has a key and an endpoint to configure at all. */
    function keyed(summary, engine) {
      return engine !== '' && (summary.keyed || []).indexOf(engine) >= 0;
    }

    /** Whether a run reads this engine's `model` setting. */
    function modelled(summary, engine) {
      return engine !== '' && (summary.models || []).indexOf(engine) >= 0;
    }

    // The next draft when the engine changes or a summary arrives. The fields
    // belong to the newly selected engine, so switching engines can never copy
    // one engine's endpoint onto another.
    function nextDraft(summary, engine, keepEnabled) {
      // engine '' is its own answer: not pinned, availability decides. There
      // is then no single engine whose key belongs in these fields, so they
      // stay empty and the card says how to get them back.
      var current = summary.engines?.[engine] || { baseURL: '', model: '' };
      return {
        engine: engine,
        apiKey: '',
        baseURL: current.baseURL || '',
        model: current.model || '',
        // The zhipu engine's billing-channel mode. It lives at the draft top
        // level because there is exactly one engine with a channel; the row's
        // select writes it straight to the host rather than through a save.
        channel: channelOf(summary),
        enabled: Object.assign(
          {},
          keepEnabled ||
            Object.fromEntries(
              ENGINES.map((name) => [name, summary.engines?.[name]?.enabled !== false]),
            ),
        ),
        // The AI permission switches and the parallel set, seeded from the
        // file the way the engine fields are.
        ai: Object.assign(
          {},
          {
            allowEngines: summary.ai?.allowEngines === true,
            allowParallel: summary.ai?.allowParallel === true,
          },
        ),
        order: chainEngines(summary).slice(),
        parallel: Object.fromEntries(
          CHAIN_ENGINES.map((name) => [name, summary.engines?.[name]?.parallel === true]),
        ),
      };
    }

    /**
     * Select a preferred engine, and make that preference usable where the user
     * can see it happen.
     *
     * Only an engine with a checkbox on screen gets switched on here. Ticking a
     * hidden one would be a change nobody asked for and nobody can see, and the
     * save that followed would delete an `enabled: false` the user never knew
     * was there. An engine with no row keeps whatever the file says: the
     * preference still travels, and the router says plainly when a pinned
     * engine is switched off.
     */
    function selectEngine(summary, draft, engine) {
      var next = nextDraft(summary, engine, draft.enabled);
      if (engine !== '' && chainEngines(summary).indexOf(engine) >= 0) {
        next.enabled[engine] = true;
      }
      return next;
    }

    /**
     * The zhipu engine's billing-channel mode, read from the summary. Only
     * three values are meaningful; anything else is the built-in auto.
     */
    function channelOf(summary) {
      const stored = summary.engines?.zhipu?.channel;
      return stored === 'coding' || stored === 'rest' ? stored : 'auto';
    }

    /** Change automatic participation, clearing an impossible preference. */
    function toggleEngine(draft, engine, enabled) {
      var next = Object.assign({}, draft, { enabled: Object.assign({}, draft.enabled) });
      next.enabled[engine] = enabled;
      if (!enabled && next.engine === engine) {
        next.engine = '';
      }
      return next;
    }

    // What one save is actually about. The pin travels only when the select
    // moved; the engine fields only when they were edited, and only the fields
    // that engine actually has. A save that always carried everything would
    // pin an engine nobody chose and write the values the card loaded back
    // over whatever the file holds now.
    function savePayload(summary, draft) {
      var payload = {};
      var enabled = {};
      // Only the engines the chain actually rendered. An engine with no
      // checkbox had no way to change, so naming it here could only carry an
      // edit the card made to itself.
      chainEngines(summary).forEach((name) => {
        var before = summary.engines?.[name]?.enabled !== false;
        var after = draft.enabled?.[name] !== false;
        if (after !== before) {
          enabled[name] = after;
        }
      });
      if (Object.keys(enabled).length > 0) {
        payload.enabled = enabled;
      }
      // AI permissions: carried only when one moved, and only the ones that
      // moved.
      var ai = {};
      if ((draft.ai?.allowEngines === true) !== (summary.ai?.allowEngines === true)) {
        ai.allowEngines = draft.ai?.allowEngines === true;
      }
      if ((draft.ai?.allowParallel === true) !== (summary.ai?.allowParallel === true)) {
        ai.allowParallel = draft.ai?.allowParallel === true;
      }
      if (Object.keys(ai).length > 0) {
        payload.ai = ai;
      }
      // The ordering: carried only when the visible order moved. The payload
      // is the whole chain, not just the rows on screen: the host numbers the
      // engines it is given from 1, so sending only the visible ones would
      // renumber the chain and drop the priorities of the engines that are
      // not ready here — and the user would find their saved arrangement
      // quietly rewritten by the next drag.
      var order = Array.isArray(draft.order) ? draft.order : [];
      var before = chainEngines(summary);
      var moved = order.length === before.length && order.every((name, i2) => name === before[i2]) ? false : true;
      if (moved && order.length > 0) {
        payload.order = mergeOrder(summary, order);
      }
      // Parallel participation: only the engines whose flag moved.
      var parallel = {};
      CHAIN_ENGINES.forEach((name) => {
        var wasIn = summary.engines?.[name]?.parallel === true;
        var isIn = draft.parallel?.[name] === true;
        if (isIn !== wasIn) {
          parallel[name] = isIn;
        }
      });
      if (Object.keys(parallel).length > 0) {
        payload.parallel = parallel;
      }
      // The zhipu channel rides as its own field: it belongs to the zhipu
      // engine, not to whichever engine happens to be the preferred one, so it
      // must not ride along with `target`.
      if (draft.channel !== undefined && draft.channel !== channelOf(summary)) {
        payload.channel = draft.channel;
      }
      if (draft.engine !== summary.engine) {
        payload.engine = draft.engine;
      }
      var pristine = nextDraft(summary, draft.engine);
      var canKey = keyed(summary, draft.engine);
      var canModel = modelled(summary, draft.engine);
      var edited =
        (canKey && (draft.apiKey !== '' || draft.baseURL !== pristine.baseURL)) ||
        (canModel && draft.model !== pristine.model);
      if (draft.engine !== '' && edited) {
        payload.target = draft.engine;
        if (canKey) {
          payload.apiKey = draft.apiKey;
          payload.baseURL = draft.baseURL;
        }
        if (canModel) {
          payload.model = draft.model;
        }
      }
      return payload;
    }

    /**
     * The engines the preference list offers. `local` is not one of them: it
     * fetches a URL it is handed, so pinning it as the search engine pins
     * something that searches nothing.
     *
     * It stays listed while the config file still names it, because the select
     * has to show what is configured. Dropping the option there would leave
     * some other engine sitting in the box as if it were the preference, which
     * is the card lying about the file it edits.
     */
    function preferable(summary, draft) {
      if (summary.engine === 'local' || draft.engine === 'local') {
        return ENGINES;
      }
      return CHAIN_ENGINES;
    }

    /**
     * The engines the chain offers a checkbox for: the ones doctor found ready
     * on this machine. An engine that cannot run here is not a decision the
     * user has to make, and a row saying so is a row they cannot act on.
     *
     * `readiness` absent means the probe never answered, which is not a verdict
     * that nothing works here. Every search engine stays listed then, because
     * the checkbox is the only way back on and the card must not take it away
     * over a fact it does not know.
     *
     * This list is also what a save is allowed to say about `enabled`: what was
     * never on screen was never edited.
     */
    /**
     * The whole chain, in the order a run walks it: the doctor's candidate
     * list is that order (the pinned engine first, then the rest by the
     * priority the config holds), including the engines that are not ready
     * on this machine yet.
     *
     * The priority the host sends with every engine is not the order to
     * draw: a pinned engine sits first whatever its number says, so a list
     * sorted by number would show an order a run does not take. The chain
     * order is the one thing both the card and the run agree on.
     */
    function chainOrder(summary) {
      var probes = Array.isArray(summary.readiness) ? summary.readiness : null;
      if (probes === null) {
        return CHAIN_ENGINES.slice();
      }
      var seen = {};
      var order = [];
      probes.forEach(function (entry) {
        var name = canonicalChainName(entry && entry.engine);
        if (!name || seen[name] || CHAIN_ENGINES.indexOf(name) < 0) {
          return;
        }
        seen[name] = true;
        order.push(name);
      });
      // Engines the doctor did not mention still belong to the chain.
      CHAIN_ENGINES.forEach(function (name) {
        if (!seen[name]) {
          order.push(name);
        }
      });
      return order;
    }

    /**
     * The engines the chain actually offers on this machine: the ready ones,
     * in the chain order.
     */
    function chainEngines(summary) {
      var probes = Array.isArray(summary.readiness) ? summary.readiness : null;
      if (probes === null) {
        return chainOrder(summary);
      }
      var ready = {};
      probes.forEach(function (entry) {
        if (entry && entry.ready === true) {
          ready[canonicalChainName(entry.engine)] = true;
        }
      });
      return chainOrder(summary).filter(function (name) {
        return ready[name] === true;
      });
    }

    /** The engine name the card knows an entry by, alias folded. */
    function canonicalChainName(name) {
      return typeof name === 'string' ? name.trim().toLowerCase() : '';
    }

    /**
     * The whole chain order to save: the engines on screen in the order the
     * user just set, with the engines that are not on screen (not ready here)
     * keeping the slots they already held.
     *
     * Sending only the visible ones would renumber the chain from 1 and
     * leave every hidden engine without a priority — a save of a drag would
     * quietly drop the slots of the engines the user cannot see.
     */
    function mergeOrder(summary, visibleOrder) {
      var full = chainOrder(summary);
      var visible = Array.isArray(visibleOrder) ? visibleOrder : [];
      var shown = {};
      visible.forEach(function (name) {
        shown[name] = true;
      });
      var slots = [];
      full.forEach(function (name, index) {
        if (shown[name]) {
          slots.push(index);
        }
      });
      var merged = full.slice();
      slots.forEach(function (slot, index) {
        if (visible[index] !== undefined) {
          merged[slot] = visible[index];
        }
      });
      return merged;
    }

    /**
     * How to render the API key field so the characters are hidden.
     *
     * A real password input makes Safari's iCloud Keychain offer to enable
     * autofill for the site and then pop its bubble on every focus, for a
     * field that is always empty: the key lives in the config file and the
     * host never sends it here, only whether one is stored. `autocomplete`
     * cannot turn that off, because WebKit ignores it on password fields on
     * purpose. Masking with text-security gets the same hidden characters
     * without ever being a password field, and it also keeps a key meant for
     * one machine out of a synced keychain.
     *
     * Feature-detected rather than assumed. Where the property is missing the
     * field stays a password input: the nuisance is worth more than the
     * alternative, which is somebody's API key rendered in clear text while
     * they type it.
     *
     * This is a trade, and the cost falls on people who are not in the room. A
     * password input carries a protected state into the accessibility tree,
     * and screen readers stop reading characters back because of it. Masking
     * is only paint: VoiceOver and NVDA will read this key aloud, and ARIA has
     * no equivalent to restore. Accepted here because the field is empty in
     * normal use, so what a screen reader can read back is what the user is
     * typing at that moment, not a stored secret.
     */
    function supportsTextSecurity() {
      // A throwing `supports` counts as no support. The spec says the two
      // argument form returns false for an unknown property rather than
      // throwing, but this runs inside render, where an exception takes the
      // whole settings surface down instead of costing one field.
      try {
        return (
          typeof CSS === 'object' &&
          CSS !== null &&
          typeof CSS.supports === 'function' &&
          CSS.supports('-webkit-text-security', 'disc') === true
        );
      } catch {
        return false;
      }
    }

    function secretFieldProps() {
      if (!supportsTextSecurity()) {
        return { type: 'password' };
      }
      return {
        type: 'text',
        autoComplete: 'off',
        autoCorrect: 'off',
        autoCapitalize: 'off',
        spellCheck: false,
        style: { WebkitTextSecurity: 'disc' },
      };
    }

    // Native <select> popups honor color-scheme, not inherit color. WebView2
    // still paints that popup as light unless a scheme is declared, so the
    // control must set one and give each option its own background.
    function parseCssColor(value) {
      if (typeof value !== 'string') {
        return null;
      }
      const s = value.trim();
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
      if (hex) {
        const h = hex[1];
        if (h.length === 3) {
          return [
            parseInt(h.charAt(0) + h.charAt(0), 16),
            parseInt(h.charAt(1) + h.charAt(1), 16),
            parseInt(h.charAt(2) + h.charAt(2), 16),
          ];
        }
        return [
          parseInt(h.slice(0, 2), 16),
          parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16),
        ];
      }
      const rgb =
        /^rgba?\(\s*([0-9]*\.?[0-9]+)(?:\s*,\s*|\s+)([0-9]*\.?[0-9]+)(?:\s*,\s*|\s+)([0-9]*\.?[0-9]+)/i.exec(
          s,
        );
      if (!rgb) {
        return null;
      }
      return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }

    function cardThemeIsDark() {
      if (typeof getComputedStyle === 'function') {
        try {
          const target = document.body || document.documentElement;
          const rgb = parseCssColor(getComputedStyle(target).color);
          if (rgb) {
            const luminance =
              0.2126 * (rgb[0] / 255) + 0.7152 * (rgb[1] / 255) + 0.0722 * (rgb[2] / 255);
            return luminance > 0.5;
          }
        } catch {
          // Unreadable computed color is not a theme answer.
        }
      }
      const media =
        typeof matchMedia === 'function'
          ? matchMedia
          : typeof window.matchMedia === 'function'
            ? window.matchMedia
            : null;
      if (typeof media === 'function') {
        try {
          if (media('(prefers-color-scheme: dark)').matches === true) {
            return true;
          }
        } catch {
          // A throwing matchMedia is not a theme answer.
        }
      }
      return false;
    }

    // `localeRef` is a { current } handle on dsh's locale service, not the
    // service itself: it is optional and may land after the card is built, so
    // it is read at render time rather than captured here. Absent, both
    // helpers below hand back nothing and labels() takes its old path.
    function ConfigCard(react, ui, localeRef) {
      var h = react.createElement;
      // Cut on a word boundary with an ellipsis, so a truncated error still
      // reads as a sentence — a hard slice used to leave half a JSON object
      // in the traffic light's aria-label.
      var clipText = function (text, limit) {
        var s = String(text == null ? '' : text);
        if (s.length <= limit) return s;
        var cut = s.slice(0, limit);
        var lastSpace = cut.lastIndexOf(' ');
        return (lastSpace > Math.floor(limit * 0.6) ? cut.slice(0, lastSpace) : cut) + '…';
      };
      var Input = ui.Input;

      // Built once per card so useSyncExternalStore is not handed a new
      // subscribe on every render, which would resubscribe every render.
      var subscribeLocale = (onChange) => {
        var locale = localeRef?.current;
        return locale ? locale.subscribe(onChange) : () => {};
      };
      var readLocale = () => {
        var locale = localeRef?.current;
        return locale ? locale.getSnapshot().active : '';
      };

      // The chrome is the native plugin card's, value for value (border,
      // layer backgrounds, 12px radius, header row with a rotating chevron,
      // footer with discard ghost + save primary), so this card reads as a
      // sibling of the built-in ones rather than a lodger.
      var chevron = (open) =>
        h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            style: {
              color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
              flex: 'none',
              transition: 'transform .16s',
              transform: open ? 'rotate(180deg)' : 'none',
            },
          },
          h('path', {
            d: 'M4 6l4 4 4-4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        );

      // `view` is the Plugins page's question (dsh 0.1.6-alpha.2 on): 'page'
      // for the form on the bundle's page, 'summary' for a one-liner.
      // Settings on older hosts passes none and gets the collapsible card.
      return function ModsearchCard(props) {
        var view = props ? props.view : undefined;
        // Subscribed, not sampled: the language is a live setting, and a card
        // sitting open while the user switches has to follow. getSnapshot and
        // subscribe are the pair dsh documents as useSyncExternalStore-safe.
        // That hook is React 18 and up; where it is missing the language is
        // read once per render instead, which still follows a switch as soon
        // as anything re-renders the card. The branch is on a closure
        // constant, so hook order never varies within one card.
        var t = labels(
          typeof react.useSyncExternalStore === 'function'
            ? react.useSyncExternalStore(subscribeLocale, readLocale)
            : readLocale(),
        );
        var openState = react.useState(false);
        var summaryState = react.useState(null);
        var draftState = react.useState(null);
        var noteState = react.useState('');
        // The probe button's in-flight text; '' means idle.
        var probeState = react.useState('');
        var probeValue = probeState[0];
        var setProbe = probeState[1];
        // The page already heads the form with the plugin's title, so the form
        // is open from the start there: a collapsed block under that title
        // would ask for the same click twice.
        var open = view === 'page' || openState[0];
        var summary = summaryState[0];
        var draft = draftState[0];
        var note = noteState[0];

        var load = react.useCallback(() => {
          // doctor: the offline self-check saying which engines are set up
          // here. Paid once per expand, cached host-side.
          fetch('/modsearch/config?doctor=1')
            .then((r) =>
              r.json().then((body) => {
                if (!r.ok) {
                  throw new Error(body.error || '');
                }
                return body;
              }),
            )
            .then((next) => {
              summaryState[1](next);
              draftState[1](nextDraft(next, next.engine));
              noteState[1]('');
            })
            .catch((error) => {
              noteState[1](noteFrom(error, t.loadFailed));
            });
        }, []);

        react.useEffect(() => {
          if (open && summary === null) {
            load();
          }
        }, [open, summary, load]);

        // Readiness after a save, which is the only moment it can have changed
        // under this card: the key just written is exactly what makes an engine
        // ready. Only the readiness list is replaced, so the fields keep their
        // saved values and nothing on screen blinks back to a loading state.
        // A probe that fails leaves the previous answer and the saved note
        // alone: the save landed, and a failed follow-up is not its news.
        var refreshReadiness = react.useCallback((saved) => {
          fetch('/modsearch/config?doctor=1')
            .then((r) => (r.ok ? r.json() : null))
            .then((fresh) => {
              if (fresh && Array.isArray(fresh.readiness)) {
                var merged = Object.assign({}, saved, { readiness: fresh.readiness });
                summaryState[1](merged);
                // The chain order comes from the doctor's list, so the rows on
                // screen have to follow the fresh one: a save that reordered
                // the chain is only visible once the new order is read back.
                // The draft order is rebuilt from it, or the card would keep
                // showing the order the save replaced.
                draftState[1](function (draft) {
                  if (!draft) {
                    return draft;
                  }
                  return Object.assign({}, draft, {
                    order: chainEngines(merged).slice(),
                  });
                });
              }
            })
            .catch(() => {});
        }, []);

        if (view === 'summary') {
          return t.subtitle;
        }

        // A row wrapping ONE control is a label, which names that control. A
        // row wrapping a set of them must not be: the label would become the
        // first control's accessible name and swallow the whole section's
        // prose. Those rows are a named group instead.
        var fieldRow = (label, control, key, groupName) =>
          h(
            groupName ? 'div' : 'label',
            {
              key: key,
              role: groupName ? 'group' : undefined,
              'aria-label': groupName || undefined,
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '12px 0',
                borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
              },
            },
            h(
              'div',
              { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, inherit)' } },
              label,
            ),
            control,
          );

        var hint = (text, key) =>
          fieldRow(
            '',
            h(
              'div',
              {
                style: {
                  fontSize: '13px',
                  color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                },
              },
              text,
            ),
            key,
          );

        var body = null;
        if (open) {
          if (summary === null || draft === null) {
            // Before a summary exists, the only thing that writes a note is a
            // load that failed. The collapsible card retries on its next
            // expand, but the page never collapses, so a retry is offered
            // where the failure is shown.
            body = h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 0',
                  color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                  fontSize: '13px',
                },
              },
              h('span', { role: 'status', style: { marginRight: 'auto' } }, note || t.loading),
              note
                ? h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        noteState[1]('');
                        load();
                      },
                      style: {
                        appearance: 'none',
                        font: 'inherit',
                        fontSize: '13px',
                        lineHeight: 1.5,
                        cursor: 'pointer',
                        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                        borderRadius: '8px',
                        padding: '5px 14px',
                        background: 'none',
                        color: 'var(--dsw-alias-label-secondary, inherit)',
                      },
                    },
                    t.retry,
                  )
                : null,
            );
          } else {
            const canKey = keyed(summary, draft.engine);
            const canModel = modelled(summary, draft.engine);
            const current = summary.engines?.[draft.engine] || { hasKey: false, keySource: null };
            const pristine = nextDraft(summary, draft.engine);
            // Availability and permission are separate. Doctor says whether an
            // engine can run here, and only those get a row. The checkbox says
            // whether automatic routing may use it. An unchecked engine keeps
            // its row: unticking it is not a reason to take the tickbox away,
            // and dsh web users have no terminal to undo that with.
            const chain = chainEngines(summary);
            // The same list savePayload measures, so the buttons can never
            // light up over a change no save would carry.
            // The ordering as the card shows it, which is what a save would
            // carry; a stable order that matches the file's own is no change.
            const order = Array.isArray(draft.order) ? draft.order : chain;
            const orderMoved =
              chain.length === order.length
                ? order.some((name, index) => name !== chain[index])
                : true;
            const dirty =
              draft.engine !== summary.engine ||
              (canKey && (draft.apiKey !== '' || draft.baseURL !== pristine.baseURL)) ||
              (canModel && draft.model !== pristine.model) ||
              chain.some(
                (name) =>
                  (draft.enabled?.[name] !== false) !==
                  (summary.engines?.[name]?.enabled !== false),
              ) ||
              (draft.ai?.allowEngines === true) !== (summary.ai?.allowEngines === true) ||
              (draft.ai?.allowParallel === true) !== (summary.ai?.allowParallel === true) ||
              orderMoved ||
              chain.some(
                (name) =>
                  (draft.parallel?.[name] === true) !==
                  (summary.engines?.[name]?.parallel === true),
              ) ||
              (draft.channel !== undefined && draft.channel !== channelOf(summary));

            const set = (key, value) => {
              var next = Object.assign({}, draft);
              next[key] = value;
              draftState[1](next);
              noteState[1]('');
            };

            const inputProps = (key, placeholder) => ({
              value: draft[key],
              placeholder: placeholder,
              onChange: (event) => {
                set(key, event.target.value);
              },
            });
            const textField = (label, key, placeholder) =>
              fieldRow(
                label,
                h(Input, Object.assign(inputProps(key, placeholder), { type: 'text' })),
                key,
              );
            // Its own function rather than a `type` string the caller has to
            // spell right. A sentinel compared with `===` fails open: one
            // typo, or a later edit passing 'text', and the key renders in
            // clear text with every test still green.
            const secretField = (label, key, placeholder) =>
              fieldRow(
                label,
                h(Input, Object.assign(inputProps(key, placeholder), secretFieldProps())),
                key,
              );

            const chainNote = !Array.isArray(summary.readiness)
              ? t.autoUnknown
              : chain.length === 0
                ? t.autoEmpty
                : '';
            // One row per engine: [up] [down] [light] name [P] [x]. The arrows
            // are the drag ordering expressed with keys a keyboard can press;
            // the light is the last real call's outcome, not a guess; P joins
            // the parallel set; the checkbox is the failover participation it
            // always was.
            // The chain is a single column: priority reads top to bottom, the
            // number says which row is which, and the handle is the only place
            // a drag starts. Keyboard users keep the arrow buttons; everything
            // else in the row (ticks, selects) stays click-through because the
            // drag arm is the handle alone.
            const move = (name, delta) => {
              const current = Array.isArray(draft.order) ? draft.order.slice() : chain.slice();
              const at = current.indexOf(name);
              const to = at + delta;
              if (at < 0 || to < 0 || to >= current.length) {
                return;
              }
              current.splice(to, 0, current.splice(at, 1)[0]);
              set('order', current);
            };
            const reorderTo = (name, toIndex) => {
              const current = Array.isArray(draft.order) ? draft.order.slice() : chain.slice();
              const at = current.indexOf(name);
              const to = Math.max(0, Math.min(current.length - 1, toIndex));
              if (at < 0 || at === to) {
                return;
              }
              current.splice(to, 0, current.splice(at, 1)[0]);
              set('order', current);
            };
            const arrowButton = (name, position, delta, label, glyph) =>
              h(
                'button',
                {
                  type: 'button',
                  'aria-label': `${name} ${label}`,
                  title: label,
                  disabled: delta < 0 ? position === 0 : position === order.length - 1,
                  onClick: () => move(name, delta),
                  style: {
                    appearance: 'none', font: 'inherit', fontSize: '10px', lineHeight: '12px',
                    cursor: 'pointer', border: 'none', background: 'none',
                    color: 'var(--dsw-alias-label-secondary, inherit)', padding: '0 2px',
                    opacity:
                      (delta < 0 ? position === 0 : position === order.length - 1) ? 0.3 : 1,
                  },
                },
                glyph,
              );
            const statusRows = order.map((name, position) => {
              const checked = draft.enabled?.[name] !== false;
              const inParallel = draft.parallel?.[name] === true;
              const record = summary.health?.[name];
              const color = record
                ? record.ok
                  ? '#34a853'
                  : '#ea4335'
                : 'rgba(127,127,127,0.45)';
              const light =
                (record
                  ? record.ok
                    ? t.trafficGreen
                    : `${t.trafficRed}${record.error ? `: ${clipText(record.error, 140)}` : ''}`
                  : t.trafficGrey) + (record?.at ? ` · ${record.at}` : '');
              // An engine that eats a key and has none reads as ready to the
              // eye — the row sits in the chain like every configured one. The
              // badge names the gap: this engine will fail over away until a
              // key is set. Keyless engines (and the CLI tools, which take no
              // key) never wear it.
              const missingKey =
                KEYLESS_ENGINES.indexOf(name) < 0 &&
                name !== 'local' &&
                name !== 'antigravity-cli' &&
                name !== 'grok-cli' &&
                summary.engines?.[name]?.hasKey !== true;
              // Both ticks carry a visible label: a bare box beside another
              // box reads as a duplicate, and "which one is which" is exactly
              // the thing the row has to answer.
              const box = (checked2, label, onChange, keyName, visible) =>
                h(
                  'label',
                  {
                    style: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                    },
                  },
                  h('input', {
                    type: 'checkbox',
                    checked: checked2,
                    'aria-label': `${name} ${label}`,
                    key: keyName,
                    onChange,
                  }),
                  visible ? h('span', null, visible) : null,
                );
              // The zhipu engine's billing-channel select: auto/coding/rest,
              // written to the draft so the save carries it like the fields
              // above. `off` is gone — that is the failover tick's job now.
              const zhipuMode =
                name === 'zhipu'
                  ? h(
                      'select',
                      {
                        value: channelOf(summary),
                        'aria-label': `${name} ${t.zhipuMode}`,
                        title: t.zhipuMode,
                        onChange: (event) => {
                          const value = event.target.value;
                          draftState[1](Object.assign({}, draft, { channel: value }));
                          noteState[1]('');
                        },
                        style: {
                          appearance: 'none',
                          font: 'inherit',
                          fontSize: '12px',
                          lineHeight: 1.5,
                          cursor: 'pointer',
                          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                          borderRadius: '8px',
                          padding: '3px 8px',
                          background: 'transparent',
                          color: 'var(--dsw-alias-label-secondary, inherit)',
                          colorScheme: cardThemeIsDark() ? 'dark' : 'light',
                          maxWidth: '200px',
                        },
                      },
                      [
                        { value: 'auto', label: t.zhipuModeAuto },
                        { value: 'coding', label: t.zhipuModeCoding },
                        { value: 'rest', label: t.zhipuModeRest },
                      ].map((option) =>
                        h(
                          'option',
                          {
                            key: option.value,
                            value: option.value,
                            style: {
                              color: cardThemeIsDark() ? '#f2f2f2' : '#23262a',
                              background: cardThemeIsDark() ? '#23262a' : '#f2f2f2',
                            },
                          },
                          option.label,
                        ),
                      ),
                    )
                  : null;
              return h(
                'div',
                {
                  key: name,
                  draggable: true,
                  onDragStart: (event) => {
                    event.dataTransfer.setData('text/modsearch-engine', name);
                    event.dataTransfer.effectAllowed = 'move';
                  },
                  onDragOver: (event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  },
                  onDrop: (event) => {
                    event.preventDefault();
                    const dragged = event.dataTransfer.getData('text/modsearch-engine');
                    if (dragged) {
                      reorderTo(dragged, position);
                    }
                  },
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    minHeight: '32px',
                    padding: '4px 10px',
                    border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                    borderRadius: '8px',
                    background: checked
                      ? 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.08))'
                      : 'transparent',
                    fontSize: '13px',
                  },
                },
                // The drag handle owns the grab cursor and the drag semantics;
                // the row itself stays a plain container so a click on a tick
                // never turns into a drag.
                h(
                  'span',
                  {
                    draggable: true,
                    title: t.dragHandle,
                    'aria-hidden': true,
                    onDragStart: (event) => {
                      event.dataTransfer.setData('text/modsearch-engine', name);
                      event.dataTransfer.effectAllowed = 'move';
                    },
                    style: {
                      cursor: 'grab',
                      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                      flex: 'none',
                      userSelect: 'none',
                      fontSize: '14px',
                      letterSpacing: '1px',
                      width: '18px',
                      textAlign: 'center',
                    },
                  },
                  '≡',
                ),
                h(
                  'span',
                  {
                    style: {
                      flex: 'none',
                      width: '18px',
                      textAlign: 'center',
                      fontSize: '12px',
                      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                    },
                  },
                  position + 1,
                ),
                h(
                  'span',
                  { style: { display: 'inline-flex', flexDirection: 'column', gap: '0', flex: 'none' } },
                  arrowButton(name, position, -1, t.moveUp, '▲'),
                  arrowButton(name, position, 1, t.moveDown, '▼'),
                ),
                h('span', {
                  title: light,
                  'aria-label': `${name}: ${light}`,
                  role: 'img',
                  style: {
                    width: '10px', height: '10px', borderRadius: '50%', flex: 'none',
                    background: color, display: 'inline-block',
                  },
                }),
                h(
                  'span',
                  { style: { flex: 'none', minWidth: '130px', display: 'inline-flex', alignItems: 'center', gap: '6px' } },
                  name,
                  missingKey
                    ? h(
                        'span',
                        {
                          title: t.noKey,
                          style: {
                            flex: 'none',
                            fontSize: '10px',
                            lineHeight: '14px',
                            padding: '0 5px',
                            borderRadius: '6px',
                            border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                            color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                          },
                        },
                        t.noKey,
                      )
                    : null,
                ),
                // The channel select rides on the row's right side with the
                // ticks: one row, one decision about Zhipu.
                zhipuMode,
                h('span', { style: { flex: 1 } }),
                // grok-cli takes the failover tick too: switching it off is
                // how the user keeps X requests on the documented degrade
                // path. It gets no parallel tick (it searches X, not the web)
                // and the aside says why it is different.
                name === 'grok-cli'
                  ? null
                  : box(
                      inParallel,
                      t.parallel,
                      () => {
                        draftState[1](
                          Object.assign({}, draft, {
                            parallel: Object.assign({}, draft.parallel, { [name]: !inParallel }),
                          }),
                        );
                        noteState[1]('');
                      },
                      `${name}-parallel`,
                      t.parallelTick,
                    ),
                h(
                  'label',
                  { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' } },
                  box(
                    checked,
                    t.failoverTick,
                    (event) => {
                      draftState[1](toggleEngine(draft, name, event.target.checked));
                      noteState[1]('');
                    },
                    `${name}-failover`,
                    t.failoverTick,
                  ),
                  name === 'grok-cli'
                    ? h(
                        'span',
                        {
                          style: {
                            color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                            fontSize: '12px',
                          },
                        },
                        t.socialOnly,
                      )
                    : null,
                ),
              );
            });

            const darkCard = cardThemeIsDark();
            const optionPaint = darkCard
              ? { color: '#f2f2f2', background: '#23262a' }
              : { color: '#23262a', background: '#f2f2f2' };
            body = h(
              'div',
              null,
              fieldRow(
                t.engine,
                h(
                  'select',
                  {
                    value: draft.engine,
                    onChange: (event) => {
                      draftState[1](selectEngine(summary, draft, event.target.value));
                      noteState[1]('');
                    },
                    style: {
                      appearance: 'none',
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                      background: 'transparent',
                      color: 'inherit',
                      font: 'inherit',
                      fontSize: '13px',
                      colorScheme: darkCard ? 'dark' : 'light',
                    },
                  },
                  [h('option', { key: '', value: '', style: optionPaint }, t.automatic)].concat(
                    preferable(summary, draft).map((name) =>
                      h(
                        'option',
                        { key: name, value: name, style: optionPaint },
                        KEYLESS_ENGINES.indexOf(name) >= 0 ? `${name}${t.keylessSuffix}` : name,
                      ),
                    ),
                  ),
                ),
                'engine',
              ),
              draft.engine === ''
                ? hint(t.pickToConfigure, 'unpinned')
                : canKey
                  ? secretField(t.apiKey, 'apiKey', current.hasKey ? t.stored : t.unset)
                  : hint(
                      draft.engine === 'local'
                        ? t.localNote
                        : draft.engine === 'youcom'
                          ? t.youcomNote
                          : t.cliNote,
                      'keyless',
                    ),
              canKey ? hint(t.apiKeyHint, 'api-key-rotation') : null,
              // The keyless engines ask for no signup at all. Silence here
              // reads as a key being required, which is the one thing these
              // engines do not need.
              // A keyless engine with no key field (youcom) has its own note above.
              canKey && KEYLESS_ENGINES.indexOf(draft.engine) >= 0 && !current.hasKey
                ? hint(t.keylessTier, 'keyless-tier')
                : null,
              canKey ? textField(t.baseUrl, 'baseURL', t.endpointFallback) : null,
              // Where the key is coming from, said once: a save cannot beat an
              // environment variable, and silence here would read as the save
              // having done nothing.
              canKey && current.keySource === 'env' ? hint(t.envNote, 'envnote') : null,
              canModel ? textField(t.model, 'model', t.modelFallback) : null,

              // One control for the two Zhipu engines: which channel GLM
            // search may use. It drives the same failover flags the rows
            // below carry, so a save travels through the existing channel.
            fieldRow(
                h(
                  'span',
                  null,
                  t.autoTitle,
                  h(
                    'span',
                    {
                      style: {
                        color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                        fontWeight: 400,
                        marginLeft: '8px',
                      },
                    },
                    t.autoHint,
                  ),
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      paddingTop: '2px',
                    },
                  },
                  statusRows.length > 0
                    ? h(
                        'div',
                        {
                          key: 'engines',
                          // One column: priority reads top to bottom, and the
                          // row number says which row is which.
                          style: { display: 'flex', flexDirection: 'column', gap: '6px' },
                        },
                        statusRows,
                      )
                    : null,
                  chainNote
                    ? h(
                        'div',
                        {
                          key: 'note',
                          style: {
                            fontSize: '13px',
                            color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                          },
                        },
                        chainNote,
                      )
                    : null,
                ),
                'status',
                t.autoTitle,
              ),
              fieldRow(
                h(
                  'span',
                  null,
                  t.chainSection,
                  h(
                    'span',
                    {
                      style: {
                        color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                        fontWeight: 400,
                        marginLeft: '8px',
                      },
                    },
                    t.chainHint,
                  ),
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
                  h(
                    'button',
                    {
                      type: 'button',
                      disabled: probeValue === t.probing,
                      onClick: () => {
                        if (!window.confirm(t.probeConfirm)) {
                          return;
                        }
                        setProbe(t.probing);
                        const engines = order.filter((name) => draft.enabled?.[name] !== false);
                        fetch('/modsearch/probe', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ engines }),
                        })
                          .then((r) =>
                            r.json().then((body) => {
                              if (!r.ok) {
                                throw new Error(body.error || '');
                              }
                              return body;
                            }),
                          )
                          .then((body) => {
                            setProbe('');
                            summaryState[1](
                              Object.assign({}, summary, { health: body.health ?? {} }),
                            );
                          })
                          .catch((error) => {
                            setProbe('');
                            noteState[1](noteFrom(error, t.saveFailed));
                          });
                      },
                      style: {
                        appearance: 'none',
                        font: 'inherit',
                        fontSize: '13px',
                        lineHeight: 1.5,
                        cursor: 'pointer',
                        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                        borderRadius: '8px',
                        padding: '5px 14px',
                        background: 'none',
                        color: 'var(--dsw-alias-label-secondary, inherit)',
                      },
                    },
                    (probeValue || t.probe),
                  ),
                ),
                'probe',
                t.probe,
              ),
              fieldRow(
                h(
                  'span',
                  null,
                  t.aiSection,
                  h(
                    'span',
                    {
                      style: {
                        color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                        fontWeight: 400,
                        marginLeft: '8px',
                      },
                    },
                    t.aiHint,
                  ),
                ),
                h(
                  'div',
                  {
                    role: 'group',
                    'aria-label': t.aiSection,
                    style: { display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '2px' },
                  },
                  h(
                    'label',
                    { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' } },
                    h('input', {
                      type: 'checkbox',
                      checked: draft.ai?.allowEngines === true,
                      onChange: (event) => {
                        draftState[1](
                          Object.assign({}, draft, {
                            ai: Object.assign({}, draft.ai, { allowEngines: event.target.checked }),
                          }),
                        );
                        noteState[1]('');
                      },
                    }),
                    h('span', null, t.allowEngines),
                  ),
                  h(
                    'label',
                    { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' } },
                    h('input', {
                      type: 'checkbox',
                      checked: draft.ai?.allowParallel === true,
                      onChange: (event) => {
                        draftState[1](
                          Object.assign({}, draft, {
                            ai: Object.assign({}, draft.ai, { allowParallel: event.target.checked }),
                          }),
                        );
                        noteState[1]('');
                      },
                    }),
                    h('span', null, t.allowParallel),
                  ),
                ),
                'ai-permissions',
                t.aiSection,
              ),
              h(
                'div',
                {
                  key: 'footer',
                  style: {
                    borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 0 4px',
                  },
                },
                h(
                  'span',
                  {
                    role: 'status',
                    style: {
                      marginRight: 'auto',
                      fontSize: '12px',
                      color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                    },
                  },
                  note,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: !dirty || note === t.saving,
                    onClick: () => {
                      draftState[1](nextDraft(summary, summary.engine));
                      noteState[1]('');
                    },
                    style: {
                      appearance: 'none',
                      font: 'inherit',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      cursor: dirty ? 'pointer' : 'default',
                      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
                      borderRadius: '8px',
                      padding: '5px 14px',
                      background: 'none',
                      color: 'var(--dsw-alias-label-secondary, inherit)',
                      opacity: dirty ? 1 : 0.4,
                    },
                  },
                  t.discard,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: !dirty || note === t.saving,
                    onClick: () => {
                      noteState[1](t.saving);
                      fetch('/modsearch/config', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(savePayload(summary, draft)),
                      })
                        .then((r) =>
                          r.json().then((payload) => {
                            if (!r.ok) {
                              throw new Error(payload.error || '');
                            }
                            return payload;
                          }),
                        )
                        .then((next) => {
                          // The save response carries no doctor run, so the
                          // statuses already on screen stand until the fresh
                          // probe below answers.
                          next.readiness = summary.readiness;
                          summaryState[1](next);
                          // The order the user just set stays on screen: the
                          // answer holds the old readiness, and rebuilding the
                          // draft from it would put the arrangement the save
                          // replaced back on screen. The fresh chain that
                          // follows tells the card the order a run takes now.
                          draftState[1](function (previous) {
                            var nextDraftValue = nextDraft(next, next.engine);
                            if (!previous || !Array.isArray(previous.order)) {
                              return nextDraftValue;
                            }
                            return Object.assign({}, nextDraftValue, {
                              order: previous.order,
                            });
                          });
                          noteState[1](t.saved);
                          refreshReadiness(next);
                        })
                        .catch((error) => {
                          noteState[1](noteFrom(error, t.saveFailed));
                        });
                    },
                    style: {
                      appearance: 'none',
                      font: 'inherit',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      cursor: dirty ? 'pointer' : 'default',
                      border: '1px solid transparent',
                      borderRadius: '8px',
                      padding: '5px 14px',
                      background: 'var(--dsw-alias-label-primary, currentColor)',
                      color: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
                      opacity: dirty ? 1 : 0.4,
                    },
                  },
                  t.save,
                ),
              ),
            );
          }
        }

        if (view === 'page') {
          // Sized like the page's own section headings, so the form reads as
          // one more section of the bundle's page.
          return h(
            'div',
            null,
            h(
              'h4',
              {
                style: { margin: '0 0 4px', fontSize: '14px', lineHeight: '20px', fontWeight: 500 },
              },
              t.section,
            ),
            body,
          );
        }

        return h(
          'div',
          {
            style: {
              border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
              background: open
                ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))'
                : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
              borderRadius: '12px',
              transition: 'border-color .16s, background .16s',
            },
          },
          h(
            'button',
            {
              type: 'button',
              'aria-expanded': open,
              onClick: () => {
                openState[1](!open);
              },
              style: {
                appearance: 'none',
                width: '100%',
                font: 'inherit',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                background: 'none',
                border: 0,
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '14px', fontWeight: 600 } }, t.title),
              h(
                'div',
                {
                  style: {
                    color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
                    fontSize: '13px',
                    lineHeight: 1.5,
                  },
                },
                t.subtitle,
              ),
            ),
            chevron(open),
          ),
          open ? h('div', { style: { margin: '0 16px', paddingBottom: '8px' } }, body) : null,
        );
      };
    }

    function registerCard(ctx) {
      // The restricted client ctx (dsh 0.2.2-rc.5 on) attaches this module's
      // declared services as plain properties — see exports.inject below.
      // The old scoped contract, ctx.inject(['slots'], callback), is gone on
      // this ctx: a card waiting on it never registers and never errors,
      // which is exactly what the upgraded host showed.
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
        return;
      }

      // The card and its route live and die together: with the host route
      // off (settingsCard: false, or no web profile) a card would only
      // render an error, which is not what turning a feature off means. Any
      // response at all proves the route exists; only a 404 or a network
      // failure reads as absent.
      fetch('/modsearch/config')
        .then((response) => {
          if (response.status === 404) {
            return;
          }
          try {
            mountCard(ctx);
          } catch (error) {
            console.error(`[modsearch] settings card skipped: ${error}`);
          }
        })
        .catch(() => {});
    }

    function mountCard(ctx) {
      var react;
      try {
        react = require('react');
      } catch (error) {
        console.error(`[modsearch] settings card skipped: ${error}`);
        return;
      }
      var ui = require('@deepseek-ai/dsh-client-ui-primitives');
      // The locale service arrives with the declared inject; the handle keeps
      // the card's render-time read shape. Absent (a host without the
      // service) the card falls back to the page language.
      var localeRef = { current: ctx.locale || null };
      var Card = ConfigCard(react, ui, localeRef);
      // slots.inject waits until a slot is declared, so registration rides
      // the Plugins page's own seat. The Settings one is gone with the same
      // release that retired the scoped ctx.inject contract.
      ctx.slots.inject('plugins.bundle.config', function* () {
        yield ctx.slots.register(
          { name: 'plugins.bundle.config', key: PROFILE_PACKAGE_NAME },
          Card,
        );
        yield ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME }, Card);
      });
    }

    function apply(ctx) {
      registerCard(ctx);
    }

    exports.apply = apply;
    // Exposed for the repo's tests only; not part of the plugin contract.
    exports.__card = {
      nextDraft: nextDraft,
      selectEngine: selectEngine,
      toggleEngine: toggleEngine,
      savePayload: savePayload,
      secretFieldProps: secretFieldProps,
      ConfigCard: ConfigCard,
    };
    // Declared services, attached to ctx as plain properties by the loader
    // (restricted client ctx contract). `slots` is the registration surface;
    // `locale` feeds the live interface language, and every host that renders
    // the Plugins page ships both.
    exports.inject = ['slots', 'locale'];
    return module.exports;
  },
});
