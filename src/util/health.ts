// The per-engine health record. Every real search attempt lands here, so the
// settings card can show a traffic light per engine without probing: green is
// the last real call that succeeded, red is the last one that failed, grey is
// an engine this machine never called. This is an observation log, not a
// circuit breaker — cooldown (see cooldown.ts) still owns routing; health only
// reports.
//
// Same store and same failure posture as the cooldown state: one
// ~/.modsearch/state.json, a corrupt or unreadable file reads as no history,
// and writes go through a temp file and an atomic rename.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canonicalEngineName } from '../config.ts';
import { redactSecrets } from './redact.ts';

export interface HealthEntry {
  /** Whether the last real call through this engine succeeded. */
  ok: boolean;
  /** Present when ok is false: the redacted failure message. */
  error?: string;
  /** ISO time of that call. */
  at: string;
  /** Wall-clock seconds the attempt took, when it ran. */
  durationSeconds?: number;
}

export interface HealthState {
  engineHealth: Record<string, HealthEntry>;
}

export function healthStatePath(): string {
  return path.join(os.homedir(), '.modsearch', 'state.json');
}

function readStateFile(filePath: string): { engineCooldowns?: unknown; engineHealth?: unknown } {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** The last known real-call outcome per engine, corrupt file reads as empty. */
export function loadHealthState(filePath = healthStatePath()): HealthState {
  const raw = readStateFile(filePath);
  const health = raw.engineHealth;
  const engineHealth: Record<string, HealthEntry> = {};
  if (health && typeof health === 'object' && !Array.isArray(health)) {
    for (const [engine, entry] of Object.entries(health as Record<string, unknown>)) {
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        if (typeof record.ok === 'boolean' && typeof record.at === 'string') {
          engineHealth[canonicalEngineName(engine)] = {
            ok: record.ok,
            ...(typeof record.error === 'string' ? { error: record.error } : {}),
            at: record.at,
            ...(typeof record.durationSeconds === 'number'
              ? { durationSeconds: record.durationSeconds }
              : {}),
          };
        }
      }
    }
  }
  return { engineHealth };
}

/** Merge one attempt into the store, preserving the cooldown section. */
export function recordHealth(
  engine: string,
  outcome: { ok: boolean; error?: string; durationSeconds?: number },
  filePath = healthStatePath(),
): void {
  const key = canonicalEngineName(engine);
  let cooldowns: unknown;
  try {
    cooldowns = readStateFile(filePath).engineCooldowns;
  } catch {
    cooldowns = undefined;
  }
  const entry: HealthEntry = {
    ok: outcome.ok,
    ...(outcome.ok ? {} : { error: redactSecrets(outcome.error ?? '', []) || undefined }),
    at: new Date().toISOString(),
    ...(outcome.durationSeconds === undefined ? {} : { durationSeconds: outcome.durationSeconds }),
  };
  const state: Record<string, unknown> = { engineHealth: { [key]: entry } };
  if (cooldowns !== undefined) {
    state.engineCooldowns = cooldowns;
  }
  writeStateFile(filePath, state);
}

function writeStateFile(filePath: string, state: unknown): void {
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const tmp = path.join(dir, `.state.${unique}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    try {
      fs.renameSync(tmp, filePath);
    } catch (error) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // the rename failure is the error worth reporting
      }
      throw error;
    }
  } catch {
    // Health is observational: a write that fails (readonly disk, race with
    // another run) must never fail the search that produced the outcome.
  }
}
