import * as path from 'node:path';
import * as os from 'node:os';

/**
 * MODSEARCH_HOME redirects every modsearch data file (config.json,
 * state.json) to one directory: e2e and multi-instance runs on a machine
 * whose real USERPROFILE must stay untouched. The dsh host process sets
 * DSH_HOME for its own state, but os.homedir() only follows USERPROFILE
 * (on Windows exclusively so), so the two need separate switches.
 * Unset keeps the historical ~/.modsearch location.
 */
export function modsearchDataDir(): string {
  const env = process.env.MODSEARCH_HOME?.trim();
  return env ? env : path.join(os.homedir(), '.modsearch');
}

/**
 * One published_at shape for every engine: second-precision UTC ISO
 * ("2026-01-02T03:04:05Z"). Engines hand back millisecond ISO, naive local
 * strings ("2026/10/24 12:51:00"), date-only strings, or epoch numbers; a
 * value nobody can parse stays absent rather than half-converted. A naive
 * string is read as UTC — the engine that omits the zone is most likely
 * answering in it, and reading it as the reader's local time would make the
 * same response parse differently on every machine, which no timestamp in
 * shared evidence can afford.
 */
export function normalizePublishedAt(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  let date: Date | null = null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return undefined;
    // "2026/10/24 12:51:00" style: normalize the separators, and a stamp with
    // no zone gets a Z so Date.parse reads UTC instead of the local offset.
    const slashed = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text);
    const candidate = slashed ? text.replaceAll('/', '-').replace(' ', 'T') : text;
    const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(candidate) ? candidate : `${candidate}Z`;
    const ms = Date.parse(zoned);
    if (Number.isFinite(ms)) date = new Date(ms);
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value < 1e12 ? value * 1000 : value);
  }
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Collapse the URL spellings that are provably the same page: fragment-only
 * variants (same document scrolled), trailing-slash variants, and an explicit
 * `www.` host alias. Query strings are kept verbatim — `?tab=` or `?id=`
 * genuinely select different content, so merging them would drop evidence.
 * Regional subdomains (us.example.com) are different sites, also untouched.
 * Unparseable URLs keep their literal form as the key. Null says "no usable
 * key"; callers fall back to their raw URL.
 */
export function canonicalUrlKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.hostname.startsWith('www.')) {
      parsed.hostname = parsed.hostname.slice(4);
    }
    let pathname = parsed.pathname;
    if (pathname.length > 1) {
      pathname = pathname.replace(/\/+$/, '');
    }
    return `${parsed.hostname}${pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Keep the first item per canonical URL and drop later variants of the same
 * page. The first occurrence wins because fusion and engine output already
 * rank it: a variant that shows up later is a duplicate wearing a different
 * spelling. Items without a usable URL pass through untouched.
 */
export function dedupeUrlVariants<T extends { url?: unknown }>(items: T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const url = typeof item.url === 'string' ? item.url : '';
    const key = url !== '' ? canonicalUrlKey(url) : null;
    if (key !== null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(item);
  }
  return kept;
}
