/**
 * Pi-Shunt Extension
 * 
 * Routes I/O-heavy operations to cheaper worker models to save tokens.
 * 
 * - Intercepts Read tool calls on files >350 lines
 * - Intercepts Bash cat/head/tail on large files  
 * - Delegates to Gemini Flash (or configured worker model)
 * - Saves 80-94% of tokens on large file reads
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadConfig } from './lib/config.ts';
import { getLineCount, isBashReadCommand } from './lib/utils.ts';
import { formatStats, fileTokenEstimate, recordRawFile, stats, countedPaths } from './lib/stats.ts';
import { registerShuntRead } from './tools/shunt-read.ts';

export default function piShuntExtension(pi: ExtensionAPI) {
  // process.cwd() is the directory pi was launched from (the project dir).
  const config = loadConfig(process.cwd());
  stats.workerModel = config.workerModel;

  if (!config.enabled) {
    return;
  }

  // Register the bulk read tool
  registerShuntRead(pi, config);

  // Hook: Intercept Read tool calls on large files
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'read') return;

    const filePath = event.input.path as string | undefined;
    const offset = event.input.offset as number | undefined;
    const limit = event.input.limit as number | undefined;

    // Allow targeted reads (user already knows what they need)
    if (offset !== undefined || limit !== undefined) {
      stats.readsPassed++;
      return;
    }

    // Allow if no file path
    if (!filePath) {
      return;
    }

    // Check file size
    const lines = getLineCount(filePath);
    if (lines === 0) {
      // File doesn't exist or is empty - let Read handle it
      return;
    }

    if (lines > config.minLines) {
      stats.readsIntercepted++;
      recordRawFile(filePath, fileTokenEstimate(filePath));
      return {
        block: true,
        reason: `File is ${lines} lines (threshold: ${config.minLines}). Use the shunt_read tool to delegate this read to a worker model instead of reading it directly. If you need exact content for editing, re-read with an offset/limit for just the section you need.`
      };
    }

    stats.readsPassed++;
  });

  // Hook: Intercept Bash read commands on large files
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'bash') return;

    const command = event.input.command as string | undefined;
    if (!command) return;

    const { isRead, filePath } = isBashReadCommand(command);
    if (!isRead || !filePath) return;

    // Check file size
    const lines = getLineCount(filePath);
    if (lines > config.minLines) {
      stats.bashIntercepted++;
      recordRawFile(filePath, fileTokenEstimate(filePath));
      return {
        block: true,
        reason: `File is ${lines} lines (threshold: ${config.minLines}). Use the shunt_read tool to delegate this read to a worker model instead of cat/head/tail.`
      };
    }
  });

  // Notify on session start, capture the active main model for stats
  pi.on('session_start', (event, ctx) => {
    if (ctx.model?.provider && ctx.model.id) {
      stats.mainModel = `${ctx.model.provider}/${ctx.model.id}`;
    }

    if (!ctx.hasUI) return;
    
    ctx.ui.notify(
      `pi-shunt active (threshold: ${config.minLines} lines, worker: ${config.workerModel})`,
      'info'
    );
  });

  // Register command to show session statistics
  pi.registerCommand('shunt:stats', {
    description: 'Show pi-shunt session statistics',
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatStats(stats), 'info');
    }
  });

  // Register command to reset session statistics
  pi.registerCommand('shunt:stats:reset', {
    description: 'Reset pi-shunt session statistics',
    handler: async (_args, ctx) => {
      stats.readsIntercepted = 0;
      stats.readsPassed = 0;
      stats.bashIntercepted = 0;
      stats.rawTokens = 0;
      stats.compressedTokens = 0;
      stats.workerInput = 0;
      stats.workerOutput = 0;
      stats.workerCalls = 0;
      stats.totalLatencyMs = 0;
      stats.cacheHits = 0;
      stats.errors = 0;
      stats.mainModel = undefined;
      countedPaths.clear();
      ctx.ui.notify('pi-shunt stats reset', 'info');
    }
  });

  // Register command to check configuration
  pi.registerCommand('shunt:config', {
    description: 'Show pi-shunt configuration',
    handler: async (args, ctx) => {
      const status = `
pi-shunt Configuration
=====================
Enabled: ${config.enabled}
Min Lines Threshold: ${config.minLines}
Max Payload Bytes: ${config.maxPayloadBytes}
Worker Model: ${config.workerModel}
Worker Temperature: ${config.workerTemperature}

Config sources (highest priority wins)
======================================
1. shell environment (SHUNT_* exported in your shell profile)
2. .pi/settings.json env block (project)
3. ~/.pi/agent/settings.json env block (global)
4. built-in defaults

Note: pi 0.85.x ignores the settings.json env block for its own process,
so pi-shunt reads it directly from those files. A restart (/reload) is
needed after editing settings.json.
      `.trim();

      ctx.ui.notify(status, 'info');
    }
  });

  // Register command to temporarily disable/enable shunt
  pi.registerCommand('shunt:toggle', {
    description: 'Toggle pi-shunt on/off for this session',
    handler: async (args, ctx) => {
      config.enabled = !config.enabled;
      ctx.ui.notify(
        `pi-shunt ${config.enabled ? 'enabled' : 'disabled'}`,
        config.enabled ? 'info' : 'warning'
      );
    }
  });
}
