/**
 * Code generation tool - delegates boilerplate generation to the worker model
 * and writes the result directly to a target file, so the generated code
 * never enters the main model's context (saves output tokens).
 *
 * Mirrors Spotify's shunt code-write script: spec + reference -> worker,
 * code written to disk, only a summary returned.
 */

import * as fs from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { ShuntConfig } from '../lib/config.ts';
import { delegateWriteToWorker } from '../lib/worker.ts';
import { isFileReadable, stripFences } from '../lib/utils.ts';
import { stats } from '../lib/stats.ts';

export function registerShuntWrite(pi: ExtensionAPI, config: ShuntConfig) {
  pi.registerTool({
    name: 'shunt_write',
    label: 'Shunt Write',
    description: 'Generate code (tests, boilerplate, config stubs, type stubs, docstrings) with a worker model, writing directly to a target file. Use when >80% of the code is predictable from a reference file. The generated code never enters the main context - only a summary comes back.',
    promptSnippet: 'Delegate boilerplate code generation to a cheaper worker model',
    promptGuidelines: [
      'Use shunt_write for tests, mocks, fixtures, config stubs, docstrings, type stubs - anything predictable from reference patterns',
      'Pass a reference file whose patterns the output must match. For follow-up calls, reference the file the previous call just generated',
      'After writing, review the generated file and make surgical edits for the ~5-20% that needs judgment',
      'Do not use for editing existing logic or architectural decisions - those need exact content in context'
    ],
    parameters: Type.Object({
      spec: Type.String({
        description: 'What to generate, e.g. "Write unit tests for UserService following the OrderService test patterns"'
      }),
      reference: Type.String({
        description: 'Path to a file whose patterns, conventions, naming, and style the generated code must match. Required - context-free generation fits nothing in the project.'
      }),
      target: Type.String({
        description: 'Output path to write the generated code to'
      })
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { spec, reference, target } = params;

      if (!config.enabled || !config.writeEnabled) {
        return {
          content: [{ type: 'text', text: 'shunt_write is disabled. Enable it with /shunt:toggle:write.' }],
          details: { error: 'write_disabled' },
          isError: true
        };
      }

      if (!isFileReadable(reference)) {
        return {
          content: [{ type: 'text', text: `Error: reference file not found or unreadable: ${reference}` }],
          details: { error: 'reference_not_found' },
          isError: true
        };
      }

      const start = performance.now();
      try {
        const refContent = fs.readFileSync(reference, 'utf-8');
        const result = await delegateWriteToWorker(
          spec,
          { path: reference, content: refContent },
          config,
          signal
        );
        const latencyMs = performance.now() - start;

        const code = stripFences(result.text);
        if (!code) {
          stats.errors++;
          return {
            content: [{ type: 'text', text: 'Worker returned no code.' }],
            details: { error: 'empty_output' },
            isError: true
          };
        }

        fs.writeFileSync(target, code, 'utf-8');
        const lines = code.split('\n').length;

        stats.writesDone++;
        stats.workerCalls++;
        stats.totalLatencyMs += latencyMs;
        if (result.usage) {
          stats.workerInput += result.usage.input;
          stats.workerOutput += result.usage.output;
          if (result.usage.cacheRead > 0) stats.cacheHits++;
        } else {
          // No usage reported by provider — counted as a fallback.
          stats.errors++;
        }

        const statsLine =
          `[shunt_write: ${result.inputTokens.toLocaleString()} in + ${result.outputTokens.toLocaleString()} out` +
          ` = ${result.totalTokens.toLocaleString()} total tokens | ${lines} lines written to ${target}` +
          `${result.workerModel ? ` | ${result.workerModel.split('/').pop()}` : ''}]`;

        return {
          content: [
            { type: 'text', text: `Wrote ${lines} lines to ${target}. Review the file - make surgical edits for anything needing judgment.` },
            { type: 'text', text: `\n\n${statsLine}` }
          ],
          details: {
            target,
            linesWritten: lines,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.totalTokens,
            latencyMs: Math.round(latencyMs),
            workerModel: result.workerModel ?? config.workerModel
          }
        };
      } catch (error) {
        stats.errors++;
        return {
          content: [{ type: 'text', text: `Worker delegation failed: ${error instanceof Error ? error.message : String(error)}` }],
          details: { error: 'delegation_failed' },
          isError: true
        };
      }
    }
  });
}
