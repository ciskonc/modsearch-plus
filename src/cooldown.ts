// The quota cooldown store. When an engine reports a quota-class failure, we
// remember it and when it may recover, so the next run fails over to another
// engine first instead of spending a call to rediscover the wall. This is a
// softened circuit breaker, not load sharing: healthy engines keep the whole
// job, a spent one is only moved to the back of the line and tried last.
//
// State lives in ~/.modsearch/state.json, apart from config.json, and is a pure
// cache: a read that fails or a file that is corrupt is treated as no state,
// silently, because nagging the user about a lost cache helps nobody. Writes go
// through a temp file and an atomic rename so a crash mid-write cannot leave a
// half-written file behind.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canonicalEngineName, cooldownEnabled, type ModsearchConfig } from './config.ts';
import { ApiKeyFailureError } from './util/apiKeys.ts';
import { modsearchDataDir } from './util/paths.ts';
import { redactSecrets } from './util/redact.ts';

export interface CooldownEntry {
  /** ISO time the engine may be worth trying again. */
  until: string;
  /** Short human reason, usually the quota message the engine returned. */
  reason: string;
  /** ISO time this cooldown was recorded. */
  observedAt: string;
}

export interface CooldownState {
  engineCooldowns: Record<string, CooldownEntry>;
  /**
   * The same file carries the engine health history (util/health.ts owns that
   * section). Cooldown writes re-write the whole file, so the load keeps every
   * section it did not clean — a cooldown record or a clear must not erase the
   * traffic-light history.
   */
  engineHealth?: unknown;
}

const KEY_COOLDOWN_SUFFIX = /^(.*)::key:(\d+)$/;

export function cooldownStateKey(engine: string, keyIndex?: number): string {
  const canonical = canonicalEngineName(engine);
  return keyIndex === undefined ? canonical : `${canonical}::key:${keyIndex}`;
}

export function parseCooldownStateKey(stateKey: string): {
  engine: string;
  keyIndex?: number;
} {
  const match = KEY_COOLDOWN_SUFFIX.exec(stateKey);
  if (!match) {
    return { engine: canonicalEngineName(stateKey) };
  }
  return {
    engine: canonicalEngineName(match[1]),
    keyIndex: Number.parseInt(match[2], 10),
  };
}

/** Resolved at call time so a faked HOME (tests) or MODSEARCH_HOME redirects the state too. */
export function currentStatePath(): string {
  return path.join(modsearchDataDir(), 'state.json');
}

/** A quota error with no reset time cools for this long before a retry. */
export const DEFAULT_COOLDOWN_MS = 45 * 60 * 1000;

/**
 * A monthly-budget quota (a spent plan or PAYGO cap) with no reset time cools
 * for a day, not 45 minutes: retrying inside the hour just re-hits the same wall.
 */
export const MONTHLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * agy refuses accounts in regions where Antigravity is not offered. That wall
 * does not lift within the hour either, and every retry still starts agy (on
 * Windows its own helpers can flash a console window, #33), so it cools for a
 * day like a spent monthly budget.
 */
const REGION_LOCKED =
  /eligibility check failed|not (?:currently )?available in your (?:location|region|country)/i;

/**
 * An agent-loop CLI that needs a one-time browser sign-in and has none: every
 * call would sit out its whole timeout waiting for a login prompt nobody can
 * answer (subprocess print mode cannot show one), so the failure is held for
 * an hour instead of re-paid every run. Antigravity times out this way when
 * its auth has lapsed.
 */
const AGENT_LOGIN_REQUIRED =
  /(?:auth|sign.?in).{0,40}(?:failed|required|expired|lapsed)|not signed in|login (?:prompt|link)/i;

export function emptyCooldownState(): CooldownState {
  return { engineCooldowns: {} };
}

export function loadCooldownState(statePath = currentStatePath()): CooldownState {
  let raw: string;
  try {
    raw = fs.readFileSync(statePath, 'utf-8');
  } catch {
    // Missing or unreadable: no state is a valid state, so stay silent.
    return emptyCooldownState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CooldownState> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.engineCooldowns !== 'object') {
      return emptyCooldownState();
    }
    const cooldowns = parsed.engineCooldowns as Record<string, unknown>;
    const clean: Record<string, CooldownEntry> = {};
    for (const [stateKey, entry] of Object.entries(cooldowns)) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as CooldownEntry).until === 'string'
      ) {
        const e = entry as CooldownEntry;
        // Fold a legacy engine key (e.g. `http`, written before the rename to
        // `local`) onto its canonical name so an old cooldown is not orphaned.
        // On a collision, keep whichever cooldown lasts longer.
        const target = parseCooldownStateKey(stateKey);
        const key = cooldownStateKey(target.engine, target.keyIndex);
        const normalized: CooldownEntry = {
          until: e.until,
          reason: typeof e.reason === 'string' ? e.reason : '',
          observedAt: typeof e.observedAt === 'string' ? e.observedAt : '',
        };
        clean[key] = clean[key] ? laterEntry(clean[key], normalized) : normalized;
      }
    }
    // Every section the cooldown layer does not own (engineHealth, written by
    // util/health.ts into the same file) travels back through the load, so a
    // cooldown write — a record, a clear — re-writes them verbatim instead of
    // silently wiping the card's traffic-light history.
    return { ...parsed, engineCooldowns: clean };
  } catch {
    // Corrupt JSON is a lost cache, not an error to raise at the user.
    return emptyCooldownState();
  }
}

/** The entry with the later `until`, so a concurrent writer's fresher cooldown wins. */
function laterEntry(existing: CooldownEntry | undefined, incoming: CooldownEntry): CooldownEntry {
  if (!existing) {
    return incoming;
  }
  const existingUntil = Date.parse(existing.until);
  const incomingUntil = Date.parse(incoming.until);
  // Prefer the incoming record on a tie or an unparseable existing `until`.
  return Number.isFinite(existingUntil) && existingUntil > incomingUntil ? existing : incoming;
}

/**
 * The health section as it stands on disk, or undefined when there is none.
 * Read raw: the cooldown loader only understands the cooldown section, and
 * this writer must not reshape what the other writer left there.
 */
function readHealthSection(statePath: string): unknown {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    const health = parsed.engineHealth;
    return health && typeof health === 'object' && !Array.isArray(health) ? health : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read-modify-write the state file under an atomic rename. Two processes writing
 * at once used to clobber each other, because each wrote its whole in-memory
 * snapshot over the file, so the second write dropped whatever the first had
 * recorded. We re-read the latest on-disk state, apply the caller's change to
 * that (set or replace one engine, or delete one), and write the union, so a
 * cooldown another process recorded meanwhile survives. Still a temp file plus
 * rename, so a crash mid-write cannot leave a partial file behind.
 */
function updateStateOnDisk(
  statePath: string,
  mutate: (state: CooldownState) => void,
): CooldownState {
  const merged = loadCooldownState(statePath);
  const before = JSON.stringify(merged);
  mutate(merged);
  if (JSON.stringify(merged) === before) {
    // Nothing changed (e.g. clearing an engine that was not cooling), so skip
    // the write entirely: the success path stays free of disk writes.
    return merged;
  }
  // Same directory as the config file, which holds key material: created 0700.
  // An existing directory keeps its mode (a deliberate user choice), and the
  // files inside carry their own 0600.
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // best effort on platforms without chmod
    }
  }
  const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmp = path.join(dir, `.state.${unique}.tmp`);
  // The file also carries the health records (the traffic lights the settings
  // card renders). This writer owns the cooldown section only, so the health
  // section rides along untouched: writing back just the cooldowns would
  // wipe every engine's last known outcome on every run.
  const payload: Record<string, unknown> = { engineCooldowns: merged.engineCooldowns };
  const health = readHealthSection(statePath);
  if (health !== undefined) {
    payload.engineHealth = health;
  }
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, statePath);
  try {
    fs.chmodSync(statePath, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
  return merged;
}

/** The active cooldown entry for an engine, or undefined if it is not cooling now. */
export function coolingEntry(
  state: CooldownState,
  engine: string,
  now: Date,
  keyIndex?: number,
): CooldownEntry | undefined {
  const active = (stateKey: string): CooldownEntry | undefined => {
    const entry = state.engineCooldowns[stateKey];
    if (!entry) {
      return undefined;
    }
    const until = Date.parse(entry.until);
    return Number.isFinite(until) && until > now.getTime() ? entry : undefined;
  };
  const entry = active(cooldownStateKey(engine, keyIndex));
  if (entry || keyIndex === undefined) {
    return entry;
  }
  // A state file written before per-key cooldown existed applies to every key.
  return active(cooldownStateKey(engine));
}

/** The representative entry when every configured key for an engine is cooling. */
export function coolingEngineEntry(
  state: CooldownState,
  engine: string,
  keyCount: number,
  now: Date,
): CooldownEntry | undefined {
  if (keyCount <= 0) {
    return coolingEntry(state, engine, now);
  }
  let representative: CooldownEntry | undefined;
  for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
    const entry = coolingEntry(state, engine, now, keyIndex);
    if (!entry) {
      return undefined;
    }
    representative = laterEntry(representative, entry);
  }
  return representative;
}

export function isEngineCooling(
  state: CooldownState,
  engine: string,
  now: Date,
  keyIndex?: number,
): boolean {
  return coolingEntry(state, engine, now, keyIndex) !== undefined;
}

/** Parse an agy-style "Resets in 94h19m9s" clause to milliseconds, or null. */
export function parseResetDuration(message: string): number | null {
  const match = /Resets? in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i.exec(message);
  if (!match || (!match[1] && !match[2] && !match[3])) {
    return null;
  }
  const hours = Number.parseInt(match[1] ?? '0', 10);
  const minutes = Number.parseInt(match[2] ?? '0', 10);
  const seconds = Number.parseInt(match[3] ?? '0', 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Decide whether an engine failure is the quota class worth remembering, and
 * when the engine should recover. A per-second rate limit is transient, not a
 * spent budget, so it returns null and never touches the store. A quota error
 * with a reset clause recovers precisely, one without recovers after the
 * default TTL. A region lock is not a quota but is just as lasting, so it is
 * held for a day.
 */
export function classifyQuota(error: unknown, now: Date): Date | null {
  const message = error instanceof Error ? error.message : String(error);
  if (REGION_LOCKED.test(message)) {
    return new Date(now.getTime() + MONTHLY_COOLDOWN_MS);
  }
  // A pending sign-in holds the engine for an hour: the failure costs the full
  // attempt timeout, and the user has to sign in themselves either way.
  if (AGENT_LOGIN_REQUIRED.test(message)) {
    return new Date(now.getTime() + 60 * 60_000);
  }
  const looksRateLimited = /rate.?limit|too many requests|\b429\b/i.test(message);
  // Tavily's monthly plan cap (432) and PAYGO cap (433) are a spent monthly
  // budget carried in the status code, not a per-second blip.
  const monthlyQuota = /\bhttp 43[23]\b/i.test(message);
  const looksQuota =
    monthlyQuota ||
    /quota|out of credit|insufficient (?:balance|credit)|credits? (?:exhausted|used up)|balance|Resets? in/i.test(
      message,
    );
  if (looksRateLimited && !looksQuota) {
    return null;
  }
  if (!looksQuota) {
    return null;
  }
  // The vendor may say when the spent credit comes back (Firecrawl answers
  // with `resets_at`). That is better than any guess: a cooldown that ends
  // before the reset only buys another refused request.
  const statedResetAt =
    error instanceof ApiKeyFailureError && typeof error.resetAt === 'number'
      ? error.resetAt
      : undefined;
  if (statedResetAt !== undefined && statedResetAt > now.getTime()) {
    return new Date(statedResetAt);
  }
  const resetMs = parseResetDuration(message);
  const fallbackMs = monthlyQuota ? MONTHLY_COOLDOWN_MS : DEFAULT_COOLDOWN_MS;
  return new Date(now.getTime() + (resetMs ?? fallbackMs));
}

/**
 * Record a cooldown when the error is quota class. Mutates the in-memory state
 * and persists it. Returns the new entry, or null when the error is not quota
 * class (and nothing is written).
 */
export function recordQuotaCooldown(
  state: CooldownState,
  engine: string,
  error: unknown,
  now: Date,
  statePath: string,
  onPersistError?: (persistError: unknown) => void,
  keyIndex?: number,
): CooldownEntry | null {
  const until = classifyQuota(error, now);
  if (!until) {
    return null;
  }
  // Redact before truncating: a cut placed inside a secret would hide it from
  // the exact-match scrub, and doctor renders this reason back to humans. The
  // cut lands on a word boundary with an ellipsis, so a truncated cause still
  // reads as a sentence instead of half a JSON object.
  const full = redactSecrets(error instanceof Error ? error.message : String(error));
  const reason = full.length > 600 ? `${full.slice(0, 600)}…` : full;
  const entry: CooldownEntry = {
    until: until.toISOString(),
    reason,
    observedAt: now.toISOString(),
  };
  const stateKey = cooldownStateKey(engine, keyIndex);
  // Merge against the latest on-disk state so a concurrent writer's record for
  // another engine is not lost. The same engine keeps whichever cooldown lasts
  // longer, so a shorter later write cannot shorten a live cooldown.
  try {
    const merged = updateStateOnDisk(statePath, (disk) => {
      disk.engineCooldowns[stateKey] = laterEntry(disk.engineCooldowns[stateKey], entry);
    });
    const persisted = merged.engineCooldowns[stateKey];
    state.engineCooldowns[stateKey] = persisted;
    return persisted;
  } catch (persistError) {
    // The store is a pure cache: a read-only dir, a full disk, or a Windows
    // rename lock must never break failover. Keep the cooldown for this run
    // in memory and report the miss instead of throwing.
    state.engineCooldowns[stateKey] = entry;
    onPersistError?.(persistError);
    return entry;
  }
}

/**
 * Clear one engine's cooldown, in memory and on disk. The disk delete always
 * runs against the latest on-disk state: this run's snapshot may predate a
 * cooldown another process recorded meanwhile, and an engine that just
 * answered has earned the clear regardless of who recorded it.
 */
export function clearEngineCooldown(
  state: CooldownState,
  engine: string,
  statePath: string,
  onPersistError?: (persistError: unknown) => void,
  keyIndex?: number,
): boolean {
  const stateKey = cooldownStateKey(engine, keyIndex);
  const legacyKey = cooldownStateKey(engine);
  const keysToDelete = keyIndex === undefined ? [stateKey] : [stateKey, legacyKey];
  const hadInMemory = keysToDelete.some((key) => key in state.engineCooldowns);
  for (const key of keysToDelete) {
    delete state.engineCooldowns[key];
  }
  try {
    // Remove only this engine on disk, preserving any other process's records.
    // updateStateOnDisk skips the write when the engine was not on disk either.
    updateStateOnDisk(statePath, (disk) => {
      for (const key of keysToDelete) {
        delete disk.engineCooldowns[key];
      }
    });
    return hadInMemory;
  } catch (persistError) {
    onPersistError?.(persistError);
    return hadInMemory;
  }
}

/**
 * Wipe all cooldown state by deleting the file. Used by `modsearch state clear`.
 * Unlike the in-run cache writes, this is an explicit user command, so a delete
 * that fails must surface as an error, not print success over a file still there.
 */
export function clearAllCooldowns(statePath = currentStatePath()): void {
  // Only the cooldown section goes. The file also holds engineHealth — the
  // card's traffic-light history — and deleting the whole file used to take
  // that history with it, which "clear the cooldowns" never promised.
  updateStateOnDisk(statePath, (disk) => {
    disk.engineCooldowns = {};
  });
}

/**
 * One run's view of the cooldown store: a state snapshot and clock for routing
 * to order by, plus record/clear side effects for the run to report outcomes.
 * The router reads `state`/`now`, search.ts calls `record` on a failure and
 * `clear` on a success.
 */
export interface CooldownController {
  readonly state: CooldownState;
  readonly now: Date;
  /** Notices about cooldown persistence failing; the run merges them into warnings. */
  readonly warnings: string[];
  record(engine: string, error: unknown, keyIndex?: number): CooldownEntry | null;
  clear(engine: string, keyIndex?: number): void;
}

/**
 * Build a controller for a run, or undefined when the switch is off. Off means
 * off: no state file is read here and none is written, so routing is byte-for-
 * byte what it was before cooldowns existed. On, the state is read once and the
 * side effects persist against the same path and clock.
 */
export function buildCooldownController(
  config: ModsearchConfig,
  opts: { now?: Date; statePath?: string } = {},
): CooldownController | undefined {
  if (!cooldownEnabled(config)) {
    return undefined;
  }
  const statePath = opts.statePath ?? currentStatePath();
  const now = opts.now ?? new Date();
  const state = loadCooldownState(statePath);
  const warnings: string[] = [];
  const persistNote = (persistError: unknown) => {
    const message = persistError instanceof Error ? persistError.message : String(persistError);
    warnings.push(
      `Cooldown state could not be saved (${message}); failover still works, but the next run will rediscover this quota wall.`,
    );
  };
  return {
    state,
    now,
    warnings,
    record: (engine, error, keyIndex) =>
      recordQuotaCooldown(state, engine, error, now, statePath, persistNote, keyIndex),
    clear: (engine, keyIndex) => {
      clearEngineCooldown(state, engine, statePath, persistNote, keyIndex);
    },
  };
}
