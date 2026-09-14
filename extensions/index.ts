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
import { registerShuntWrite } from './tools/shunt-write.ts';

type ShortcutKey = Parameters<ExtensionAPI['registerShortcut']>[0];

export default function piShuntExtension(pi: ExtensionAPI) {
  // process.cwd() is the directory pi was launched from (the project dir).
  const config = loadConfig(process.cwd());
  stats.workerModel = config.workerModel;

  if (!config.enabled) {
    return;
  }

  // Register the bulk read tool
  registerShuntRead(pi, config);

  // Register the code generation tool
  registerShuntWrite(pi, config);

  // Hook: Intercept Read tool calls on large files
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'read') return;
    if (!config.enabled || !config.readEnabled) return;

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
    if (!config.enabled || !config.readEnabled) return;

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
      stats.writesDone = 0;
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
Cycle Key: ${config.cycleKey}

Toggle Status
=============
All: ${config.enabled ? 'ENABLED' : 'DISABLED'}
Read: ${config.readEnabled ? 'ENABLED' : 'DISABLED'}
Write: ${config.writeEnabled ? 'ENABLED' : 'DISABLED'}

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

  // Combined state label for toggles and cycle. Handles every flag
  // combination, including the degenerate read-off + write-off state
  // reachable only by mixing manual toggles.
  const stateLabel = () =>
    !config.enabled ? 'all off'
    : !config.readEnabled && !config.writeEnabled ? 'read off, write off'
    : config.readEnabled && config.writeEnabled ? 'all on (read on, write on)'
    : !config.readEnabled ? 'only write (read off, write on)'
    : 'only read (read on, write off)';

  // Register command to temporarily disable/enable shunt (all)
  pi.registerCommand('shunt:toggle', {
    description: 'Toggle pi-shunt (all) on/off for this session',
    handler: async (args, ctx) => {
      config.enabled = !config.enabled;
      ctx.ui.notify(`pi-shunt: ${stateLabel()}`, config.enabled ? 'info' : 'warning');
    }
  });

  // Register command to toggle the read hooks + shunt_read tool
  pi.registerCommand('shunt:toggle:read', {
    description: 'Toggle read interception + shunt_read on/off for this session',
    handler: async (args, ctx) => {
      config.readEnabled = !config.readEnabled;
      ctx.ui.notify(`pi-shunt: ${stateLabel()}`, config.readEnabled ? 'info' : 'warning');
    }
  });

  // Register command to toggle just the write tool
  pi.registerCommand('shunt:toggle:write', {
    description: 'Toggle shunt_write (code generation) on/off for this session',
    handler: async (args, ctx) => {
      config.writeEnabled = !config.writeEnabled;
      ctx.ui.notify(`pi-shunt: ${stateLabel()}`, config.writeEnabled ? 'info' : 'warning');
    }
  });

  // Cycle through toggle states in order: all on → only read → only write → all off.
  // Derives the next state from the current flags, so manual toggles in between
  // don't desync the cycle.
  const cycle = () => {
    if (!config.enabled) {
      config.enabled = true;
      config.readEnabled = true;
      config.writeEnabled = true;
    } else if (!config.readEnabled) {
      config.enabled = false;
    } else if (!config.writeEnabled) {
      config.readEnabled = false;
      config.writeEnabled = true;
    } else {
      config.writeEnabled = false;
    }
  };

  // Configurable shortcut (SHUNT_CYCLE_KEY). A bad binding must not take down
  // the extension, so register in a try/catch and log the failure.
  try {
    pi.registerShortcut(config.cycleKey as ShortcutKey, {
      description: 'Cycle pi-shunt: all on → only read → only write → all off',
      handler: async (ctx) => {
        cycle();
        ctx.ui.notify(`pi-shunt: ${stateLabel()}`, config.enabled ? 'info' : 'warning');
      }
    });
  } catch (error) {
    console.warn(
      `pi-shunt: invalid cycle key "${config.cycleKey}" (SHUNT_CYCLE_KEY), shortcut not registered: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
