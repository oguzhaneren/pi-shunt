/**
 * Configuration management for pi-shunt extension
 *
 * Config sources, highest priority first:
 *   1. Real environment variables (process.env) — e.g. `SHUNT_MIN_LINES=500 pi`
 *   2. Project settings.json (.pi/settings.json) `env` block
 *   3. Global settings.json (~/.pi/agent/settings.json) `env` block
 *   4. Defaults
 *
 * pi 0.85.x does not apply the settings.json `env` block to its own process,
 * so we read those files directly here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ShuntConfig {
  enabled: boolean;
  minLines: number;
  maxPayloadBytes: number;
  workerModel: string;
  workerTemperature: number;
  workerInstructions: string;
  /** Runtime toggle for read interception + shunt_read (/shunt:toggle:read). */
  readEnabled: boolean;
  /** Runtime toggle for the shunt_write tool (/shunt:toggle:write). */
  writeEnabled: boolean;
  /** System prompt used by the write worker (code generation). */
  writeInstructions: string;
  /** Keybinding for the cycle shortcut (SHUNT_CYCLE_KEY). */
  cycleKey: string;
}

const DEFAULT_WORKER_INSTRUCTIONS = `You are a precise code analyst. Read the provided files and answer the question concisely.

Output structured bullets only. No greetings, no prose, no preambles, no summaries.

Lead every bullet with the exact name, type, or line number. Use nested bullets for details.

Skip anything the caller did not ask for.`;

const DEFAULT_WRITE_INSTRUCTIONS = `You generate code files based on a spec and reference files.

Match the existing patterns, conventions, naming, and style of the reference code exactly.

Output only the code — no explanations, no preambles, no markdown fences unless the spec asks for them.

If the spec is ambiguous, make reasonable choices that match the patterns in the reference.`;

export interface ConfigSource {
  enabled: string | undefined;
  readEnabled: string | undefined;
  minLines: string | undefined;
  maxPayloadBytes: string | undefined;
  workerModel: string | undefined;
  workerTemperature: string | undefined;
  workerInstructions: string | undefined;
  writeEnabled: string | undefined;
  writeInstructions: string | undefined;
  cycleKey: string | undefined;
}

/** Read the `env` block from a settings.json file, if present. */
function readSettingsEnv(filePath: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { env?: Record<string, string> };
    return typeof parsed.env === 'object' && parsed.env !== null ? parsed.env : {};
  } catch {
    return {};
  }
}

/** Pick the SHUNT_* values out of a settings env block. */
function pickShuntEnv(env: Record<string, string>): ConfigSource {
  return {
    enabled: env.SHUNT_ENABLED,
    readEnabled: env.SHUNT_READ_ENABLED,
    minLines: env.SHUNT_MIN_LINES,
    maxPayloadBytes: env.SHUNT_MAX_PAYLOAD_BYTES,
    workerModel: env.SHUNT_WORKER_MODEL,
    workerTemperature: env.SHUNT_WORKER_TEMPERATURE,
    workerInstructions: env.SHUNT_WORKER_INSTRUCTIONS,
    writeEnabled: env.SHUNT_WRITE_ENABLED,
    writeInstructions: env.SHUNT_WRITE_INSTRUCTIONS,
    cycleKey: env.SHUNT_CYCLE_KEY,
  };
}

/** Merge two config sources; `higher` wins for defined values. */
function mergeSource(higher: ConfigSource, lower: ConfigSource): ConfigSource {
  return {
    enabled: higher.enabled ?? lower.enabled,
    readEnabled: higher.readEnabled ?? lower.readEnabled,
    minLines: higher.minLines ?? lower.minLines,
    maxPayloadBytes: higher.maxPayloadBytes ?? lower.maxPayloadBytes,
    workerModel: higher.workerModel ?? lower.workerModel,
    workerTemperature: higher.workerTemperature ?? lower.workerTemperature,
    workerInstructions: higher.workerInstructions ?? lower.workerInstructions,
    writeEnabled: higher.writeEnabled ?? lower.writeEnabled,
    writeInstructions: higher.writeInstructions ?? lower.writeInstructions,
    cycleKey: higher.cycleKey ?? lower.cycleKey,
  };
}

export function loadConfig(cwd = process.cwd()): ShuntConfig {
  // 1. Real environment variables.
  const processEnv: ConfigSource = {
    enabled: process.env.SHUNT_ENABLED,
    readEnabled: process.env.SHUNT_READ_ENABLED,
    minLines: process.env.SHUNT_MIN_LINES,
    maxPayloadBytes: process.env.SHUNT_MAX_PAYLOAD_BYTES,
    workerModel: process.env.SHUNT_WORKER_MODEL,
    workerTemperature: process.env.SHUNT_WORKER_TEMPERATURE,
    workerInstructions: process.env.SHUNT_WORKER_INSTRUCTIONS,
    writeEnabled: process.env.SHUNT_WRITE_ENABLED,
    writeInstructions: process.env.SHUNT_WRITE_INSTRUCTIONS,
    cycleKey: process.env.SHUNT_CYCLE_KEY,
  };

  // 2. Project settings.json.
  const projectSettings = readSettingsEnv(path.join(cwd, '.pi', 'settings.json'));

  // 3. Global settings.json.
  const globalSettings = readSettingsEnv(path.join(os.homedir(), '.pi', 'agent', 'settings.json'));

  const merged = mergeSource(
    processEnv,
    mergeSource(pickShuntEnv(projectSettings), pickShuntEnv(globalSettings))
  );

  const yes = (v: string | undefined) => v === 'true' || v === '1' || v === 'yes';

  const minLines = parseInt(merged.minLines ?? '350', 10);
  const maxPayloadBytes = parseInt(merged.maxPayloadBytes ?? '400000', 10);
  const temperature = parseFloat(merged.workerTemperature ?? '0.2');

  return {
    enabled: merged.enabled === undefined ? true : yes(merged.enabled),
    minLines: Number.isNaN(minLines) ? 350 : minLines,
    maxPayloadBytes: Number.isNaN(maxPayloadBytes) ? 400000 : maxPayloadBytes,
    workerModel: merged.workerModel ?? 'gemini-2.5-flash',
    workerTemperature: Number.isNaN(temperature) ? 0.2 : temperature,
    workerInstructions: merged.workerInstructions ?? DEFAULT_WORKER_INSTRUCTIONS,
    writeEnabled: merged.writeEnabled === undefined ? true : yes(merged.writeEnabled),
    writeInstructions: merged.writeInstructions ?? DEFAULT_WRITE_INSTRUCTIONS,
    readEnabled: merged.readEnabled === undefined ? true : yes(merged.readEnabled),
    cycleKey: merged.cycleKey ?? 'ctrl+alt+s',
  };
}
