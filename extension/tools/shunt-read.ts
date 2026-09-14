/**
 * Bulk file reader tool - delegates large file reads to worker model
 */

import * as fs from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { ShuntConfig } from '../lib/config.ts';
import { delegateToWorker } from '../lib/worker.ts';
import { isFileReadable, estimateTokens } from '../lib/utils.ts';
import { recordRawFile, stats } from '../lib/stats.ts';

export function registerShuntRead(pi: ExtensionAPI, config: ShuntConfig) {
  pi.registerTool({
    name: 'shunt_read',
    label: 'Shunt Read',
    description: 'Read and analyze multiple large files efficiently using a worker model. Use when blocked from reading large files directly.',
    promptSnippet: 'Delegate bulk file reading to a cheaper worker model for analysis',
    promptGuidelines: [
      'Use shunt_read when you need to read files >350 lines',
      'Use shunt_read when analyzing 3+ files together',
      'Ask specific questions - worker provides structured summaries',
      'Verify exact line numbers before making edits'
    ],
    parameters: Type.Object({
      question: Type.String({ 
        description: 'Specific question to answer about the files'
      }),
      paths: Type.Array(Type.String(), { 
        description: 'File paths to read and analyze',
        minItems: 1
      })
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { question, paths } = params;

      // Validate files
      const files: Array<{ path: string; content: string }> = [];
      for (const filePath of paths) {
        if (!isFileReadable(filePath)) {
          return {
            content: [{
              type: 'text',
              text: `Error: File not found or unreadable: ${filePath}`
            }],
            details: { error: 'file_not_found' },
            isError: true
          };
        }

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          files.push({ path: filePath, content });
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error reading ${filePath}: ${error instanceof Error ? error.message : String(error)}`
            }],
            details: { error: 'read_failed' },
            isError: true
          };
        }
      }

      // Delegate to worker
      const start = performance.now();
      try {
        const result = await delegateToWorker(files, question, config, signal);
        const latencyMs = performance.now() - start;

        // Accumulate stats
        stats.workerCalls++;
        stats.totalLatencyMs += latencyMs;
        for (const f of files) {
          recordRawFile(f.path, estimateTokens(f.content));
        }
        stats.compressedTokens += estimateTokens(result.text);
        if (result.usage) {
          stats.workerInput += result.usage.input;
          stats.workerOutput += result.usage.output;
          if (result.usage.cacheRead > 0) stats.cacheHits++;
        } else {
          // No usage reported by provider — counted as a fallback.
          stats.errors++;
        }

        // Report token usage: input, output, total.
        const statsLine =
          `[shunt: ${result.inputTokens.toLocaleString()} in + ${result.outputTokens.toLocaleString()} out` +
          ` = ${result.totalTokens.toLocaleString()} total tokens | ${files.length} file${files.length > 1 ? 's' : ''}` +
          `${result.workerModel ? ` | ${result.workerModel.split('/').pop()}` : ''}]`;

        return {
          content: [
            { type: 'text', text: result.text },
            { type: 'text', text: `\n\n${statsLine}` }
          ],
          details: {
            files: paths,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.totalTokens,
            usage: result.usage,
            latencyMs: Math.round(latencyMs),
            workerModel: result.workerModel ?? config.workerModel
          }
        };
      } catch (error) {
        stats.errors++;
        return {
          content: [{
            type: 'text',
            text: `Worker delegation failed: ${error instanceof Error ? error.message : String(error)}`
          }],
          details: { error: 'delegation_failed' },
          isError: true
        };
      }
    }
  });
}
