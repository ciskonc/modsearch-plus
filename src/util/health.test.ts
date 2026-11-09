import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadHealthState, recordHealth } from './health.ts';

const tempDirs: string[] = [];

function tempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-health-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('the health record', () => {
  it('keeps one entry per engine, not just the last one called', () => {
    // The card lights a row per engine, so a store that kept only the engine
    // of the most recent call would grey every other row — the exact opposite
    // of what the traffic lights are for.
    const file = tempStatePath();
    recordHealth('minimax', { ok: true, durationSeconds: 0.8 }, file);
    recordHealth('glm', { ok: false, error: 'glm has no search balance (1113)' }, file);
    recordHealth('keenable', { ok: true, durationSeconds: 0.9 }, file);

    const state = loadHealthState(file);
    expect(Object.keys(state.engineHealth).sort()).toEqual(['glm', 'keenable', 'minimax']);
    expect(state.engineHealth.minimax.ok).toBe(true);
    expect(state.engineHealth.glm.ok).toBe(false);
    expect(state.engineHealth.glm.error).toContain('1113');
    expect(state.engineHealth.keenable.ok).toBe(true);
  });

  it('replaces only the engine it was told about', () => {
    const file = tempStatePath();
    recordHealth('minimax', { ok: true, durationSeconds: 1 }, file);
    const firstAt = loadHealthState(file).engineHealth.minimax.at;
    recordHealth('glm', { ok: false, error: 'boom' }, file);
    expect(loadHealthState(file).engineHealth.minimax.at).toBe(firstAt);
  });

  it('keeps the cooldown section the store already had', () => {
    const file = tempStatePath();
    fs.writeFileSync(
      file,
      JSON.stringify({
        engineCooldowns: {
          'glm::key:0': { until: '2026-11-01T00:00:00.000Z', reason: 'spent', observedAt: 'x' },
        },
      }),
    );
    recordHealth('minimax', { ok: true }, file);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(raw.engineCooldowns as object)).toEqual(['glm::key:0']);
    expect((raw.engineHealth as Record<string, { ok: boolean }>).minimax.ok).toBe(true);
  });

  it('reads a missing or corrupt store as no history instead of failing', () => {
    const missing = tempStatePath();
    expect(loadHealthState(missing).engineHealth).toEqual({});
    const corrupt = tempStatePath();
    fs.writeFileSync(corrupt, '{not json');
    expect(loadHealthState(corrupt).engineHealth).toEqual({});
  });
});
