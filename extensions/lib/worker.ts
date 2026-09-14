/**
 * Worker model delegation for pi-shunt extension
 *
 * Spawns a fresh pi process with the worker model to analyze files.
 * Runs in JSON mode (`pi -p --mode json`) so we get real token usage
 * from the model response, not estimates.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ShuntConfig } from './config.ts';
import { formatWorkerMessage, estimateTokens } from './utils.ts';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  contextTokens: number;
}

export interface WorkerResult {
  text: string;
  /** Real model usage when available, else estimates. */
  usage?: TokenUsage;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  workerModel?: string;
}

interface UsageEvent {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}

interface MessageEvent {
  type: string;
  message?: {
    role?: string;
    model?: string;
    content?: Array<{ type: string; text?: string }>;
    usage?: UsageEvent;
    errorMessage?: string;
  };
}

/**
 * Delegate file reading to a cheaper worker model by spawning a pi subprocess
 */
export async function delegateToWorker(
  files: Array<{ path: string; content: string }>,
  question: string,
  config: ShuntConfig,
  signal?: AbortSignal
): Promise<WorkerResult> {
  const message = formatWorkerMessage(files, question);

  // Check payload size
  if (message.length > config.maxPayloadBytes) {
    throw new Error(
      `Request size ${message.length} bytes exceeds limit ${config.maxPayloadBytes} bytes. ` +
      `Send fewer or smaller files.`
    );
  }

  // Write message to temp file
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pi-shunt-'));
  const messagePath = path.join(tmpDir, 'message.txt');
  await fs.promises.writeFile(messagePath, message, 'utf-8');

  try {
    const result = await spawnPi(config, messagePath, signal);
    return toWorkerResult(result, message);
  } finally {
    // Cleanup
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Delegate code generation to a cheaper worker model by spawning a pi
 * subprocess. The reference file provides patterns the output must match.
 * Uses the write-mode system prompt (config.writeInstructions).
 */
export async function delegateWriteToWorker(
  spec: string,
  reference: { path: string; content: string },
  config: ShuntConfig,
  signal?: AbortSignal
): Promise<WorkerResult> {
  const message =
    `Spec: ${spec}\n\n` +
    `Reference file to match patterns from (${reference.path}):\n${reference.content}`;

  // Check payload size
  if (message.length > config.maxPayloadBytes) {
    throw new Error(
      `Request size ${message.length} bytes exceeds limit ${config.maxPayloadBytes} bytes. ` +
      `Use a smaller reference file or shorter spec.`
    );
  }

  // Write message to temp file
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pi-shunt-'));
  const messagePath = path.join(tmpDir, 'message.txt');
  await fs.promises.writeFile(messagePath, message, 'utf-8');

  try {
    const result = await spawnPi(config, messagePath, signal, config.writeInstructions);
    return toWorkerResult(result, message);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

/** Convert a raw spawn result to a WorkerResult, falling back to estimates. */
function toWorkerResult(result: SpawnResult, message: string): WorkerResult {
  if (result.usage) {
    const usage = result.usage;
    return {
      text: result.text,
      usage,
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.input + usage.output,
      workerModel: result.workerModel,
    };
  }

  const inputTokens = estimateTokens(message);
  const outputTokens = estimateTokens(result.text);
  return {
    text: result.text,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    workerModel: result.workerModel,
  };
}

interface SpawnResult {
  text: string;
  usage?: TokenUsage;
  workerModel?: string;
}

/**
 * Spawn a pi subprocess in JSON mode and parse the JSONL event stream.
 *
 * Event shape (mirrors examples/extensions/subagent):
 *   {"type":"message_end","message":{"role":"assistant","content":[...],
 *    "usage":{"input":N,"output":N,"cacheRead":N,"cacheWrite":N,"totalTokens":N},...}}
 */
async function spawnPi(
  config: ShuntConfig,
  messagePath: string,
  signal?: AbortSignal,
  systemPrompt?: string
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '--mode', 'json',
      '-p',
      '--no-session',
      '--model', config.workerModel,
      '--system-prompt', systemPrompt ?? config.workerInstructions,
      '--no-tools',
      // '@' prefix makes pi read the message file as the user message
      // (without it, pi treats the path as literal text).
      `@${messagePath}`,
    ];

    const proc = spawn('pi', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });

    let buffer = '';
    let stderr = '';
    let lastText = '';
    let usage: TokenUsage | undefined;
    let workerModel: string | undefined;
    let errorMessage: string | undefined;

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: MessageEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      if (event.type === 'message_end' && event.message) {
        const msg = event.message;
        if (msg.role === 'assistant') {
          if (msg.model) workerModel = msg.model;

          // Content is an array of parts; collect the text.
          const text = (msg.content ?? [])
            .filter((part) => part.type === 'text' && part.text)
            .map((part) => part.text)
            .join('');
          if (text) lastText = text;

          if (msg.usage) {
            usage = {
              input: msg.usage.input ?? 0,
              output: msg.usage.output ?? 0,
              cacheRead: msg.usage.cacheRead ?? 0,
              cacheWrite: msg.usage.cacheWrite ?? 0,
              contextTokens: msg.usage.totalTokens ?? 0,
            };
          }

          if (msg.errorMessage) errorMessage = msg.errorMessage;
        }
      }
    };

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) processLine(line);
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn pi: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (buffer.trim()) processLine(buffer);

      if (errorMessage) {
        reject(new Error(`Worker model reported: ${errorMessage}${stderr ? ` (${stderr.trim()})` : ''}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`pi exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      if (!lastText) {
        // JSON mode produced no assistant text — surface the raw tail for debugging.
        reject(new Error(`Worker returned no text. Raw output: ${stderr.trim().slice(0, 500)}`));
        return;
      }

      resolve({ text: lastText.trim(), usage, workerModel });
    });
  });
}
