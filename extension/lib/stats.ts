/**
 * Session-wide statistics for pi-shunt.
 *
 * A single shared module instance — hooks in index.ts and the shunt_read
 * tool both import it, so events accumulate in one place.
 *
 * Scope: per extension instance. Stats reset when pi reloads extensions
 * (/reload), switches sessions, or restarts.
 */

import * as fs from 'node:fs';

export interface ShuntStats {
  mainModel?: string;      // provider/id, captured at session_start
  workerModel: string;     // configured worker model
  readsIntercepted: number;
  readsPassed: number;
  bashIntercepted: number;
  /** Tokens kept OUT of the main model's context (blocked files + worker corpora). */
  rawTokens: number;
  /** Tokens of summaries that DID enter the main model's context. */
  compressedTokens: number;
  workerInput: number;     // real usage from worker model responses
  workerOutput: number;
  workerCalls: number;
  totalLatencyMs: number;
  cacheHits: number;       // calls where usage.cacheRead > 0
  errors: number;          // worker failures + estimate fallbacks
}

/** Paths already counted toward rawTokens, to avoid double counting. */
export const countedPaths = new Set<string>();

export const stats: ShuntStats = {
  readsIntercepted: 0,
  readsPassed: 0,
  bashIntercepted: 0,
  rawTokens: 0,
  compressedTokens: 0,
  workerInput: 0,
  workerOutput: 0,
  workerCalls: 0,
  totalLatencyMs: 0,
  cacheHits: 0,
  errors: 0,
  workerModel: '',
};

/** Estimate tokens for a file path (bytes ≈ ASCII chars, chars/4). */
export function fileTokenEstimate(filePath: string): number {
  try {
    const { size } = fs.statSync(filePath);
    return Math.ceil(size / 4);
  } catch {
    return 0;
  }
}

/** Count a file's tokens toward rawTokens once per path. */
export function recordRawFile(filePath: string, tokens: number): void {
  if (tokens <= 0 || countedPaths.has(filePath)) return;
  countedPaths.add(filePath);
  stats.rawTokens += tokens;
}

export function formatStats(s: ShuntStats): string {
  const saved = s.rawTokens - s.compressedTokens;
  const reduction =
    s.rawTokens > 0 ? ((saved / s.rawTokens) * 100).toFixed(1) : '—';
  const avgLatency =
    s.workerCalls > 0 ? `${Math.round(s.totalLatencyMs / s.workerCalls)}ms` : '—';
  const fmt = (n: number) => n.toLocaleString();

  const pad = (label: string) => label.padEnd(18);
  const line = (label: string, value: string) => `${pad(label)}${value}`;

  const blocks: string[] = [];

  blocks.push(
    line('Main model:', s.mainModel ?? '—'),
    line('Worker model:', s.workerModel || '—')
  );

  blocks.push(
    '',
    line('Reads intercepted:', fmt(s.readsIntercepted)),
    line('Reads passed:', fmt(s.readsPassed)),
    line('Bash intercepted:', fmt(s.bashIntercepted))
  );

  blocks.push(
    '',
    line('Raw content:', `${fmt(s.rawTokens)} tokens`),
    line('Compressed:', `${fmt(s.compressedTokens)} tokens`),
    line('Tokens saved:', `${fmt(saved)}`),
    '',
    line('Reduction:', `${reduction}%`)
  );

  blocks.push(
    '',
    line('Worker input:', `${fmt(s.workerInput)} tokens`),
    line('Worker output:', `${fmt(s.workerOutput)} tokens`),
    '',
    line('Worker calls:', fmt(s.workerCalls)),
    line('Cache hits:', fmt(s.cacheHits)),
    line('Avg latency:', avgLatency),
    '',
    line('Errors/fallbacks:', fmt(s.errors))
  );

  return blocks.join('\n');
}
