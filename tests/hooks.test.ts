/**
 * Hook tests: the real extension is registered against a fake ExtensionAPI and
 * the captured tool_call handlers are invoked with real event shapes, so the
 * blocking logic in extensions/index.ts is what gets exercised.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isBashReadCommand } from '../extensions/lib/utils.ts';
import piShuntExtension from '../extensions/index.ts';

// ============================================================================
// isBashReadCommand parser tests
// ============================================================================

test('isBashReadCommand - cat single file', () => {
  const result = isBashReadCommand('cat file.txt');
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'file.txt');
});

test('isBashReadCommand - head single file', () => {
  const result = isBashReadCommand('head file.txt');
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'file.txt');
});

test('isBashReadCommand - tail single file', () => {
  const result = isBashReadCommand('tail -f app.log');
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'app.log');
});

test('isBashReadCommand - less single file', () => {
  const result = isBashReadCommand('less README.md');
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'README.md');
});

test('isBashReadCommand - more single file', () => {
  const result = isBashReadCommand('more package.json');
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'package.json');
});

test('isBashReadCommand - quoted path', () => {
  const result = isBashReadCommand('cat "my file.txt"');
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'my file.txt');
});

test('isBashReadCommand - single-quoted path', () => {
  const result = isBashReadCommand("cat 'file with spaces.txt'");
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'file with spaces.txt');
});

test('isBashReadCommand - flags before file', () => {
  const result = isBashReadCommand('head -n 50 file.txt');
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'file.txt');
});

test('isBashReadCommand - rejects pipes', () => {
  assert.equal(isBashReadCommand('cat file.txt | head -20').isRead, false);
});

test('isBashReadCommand - rejects output redirect', () => {
  assert.equal(isBashReadCommand('cat file.txt > out.txt').isRead, false);
});

test('isBashReadCommand - rejects append redirect', () => {
  assert.equal(isBashReadCommand('cat file.txt >> out.txt').isRead, false);
});

test('isBashReadCommand - rejects non-read commands', () => {
  assert.equal(isBashReadCommand('grep foo file.txt').isRead, false);
  assert.equal(isBashReadCommand('ls -la').isRead, false);
});

test('isBashReadCommand - rejects empty/whitespace', () => {
  assert.equal(isBashReadCommand('').isRead, false);
  assert.equal(isBashReadCommand('   ').isRead, false);
});

test('isBashReadCommand - multiple files (first wins)', () => {
  const result = isBashReadCommand('cat a.txt b.txt');
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'a.txt');
});

test('isBashReadCommand - only flags, no file', () => {
  assert.equal(isBashReadCommand('tail -f').isRead, false);
});

// ============================================================================
// Extension harness
// ============================================================================

interface Captured {
  toolCallHandlers: Array<(event: any, ctx: any) => Promise<any> | any>;
  tools: string[];
  commands: string[];
  shortcuts: string[];
}

/** Minimal ExtensionAPI stand-in that records what the extension registers. */
function fakeApi(): { api: any; captured: Captured } {
  const captured: Captured = {
    toolCallHandlers: [],
    tools: [],
    commands: [],
    shortcuts: [],
  };

  const api = {
    on(event: string, handler: (event: any, ctx: any) => any) {
      if (event === 'tool_call') captured.toolCallHandlers.push(handler);
      return () => {};
    },
    registerTool(definition: { name: string }) {
      captured.tools.push(definition.name);
      return () => {};
    },
    registerCommand(name: string) {
      captured.commands.push(name);
      return () => {};
    },
    registerShortcut(key: string) {
      captured.shortcuts.push(key);
      return () => {};
    },
  };

  return { api, captured };
}

/** Run the extension in a throwaway project directory with a given environment. */
async function withProject(
  env: Record<string, string>,
  body: (ctx: { root: string; captured: Captured; makeFile: (name: string, lines: number) => string }) => Promise<void> | void
): Promise<void> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-hooks-')));
  const originalCwd = process.cwd();
  const originalEnv: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(env)) {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  }

  const makeFile = (name: string, lines: number): string => {
    const filePath = path.join(root, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Array(lines).fill('test line').join('\n'));
    return filePath;
  };

  process.chdir(root);
  try {
    const { api, captured } = fakeApi();
    piShuntExtension(api);
    await body({ root, captured, makeFile });
  } finally {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Invoke every captured tool_call handler and return the first blocking result. */
async function callHooks(captured: Captured, event: any): Promise<any> {
  for (const handler of captured.toolCallHandlers) {
    const result = await handler(event, { hasUI: false });
    if (result) return result;
  }
  return undefined;
}

function readEvent(filePath: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'tool_call',
    toolCallId: 'call-1',
    toolName: 'read',
    input: { path: filePath, ...extra },
  };
}

function bashEvent(command: string) {
  return {
    type: 'tool_call',
    toolCallId: 'call-1',
    toolName: 'bash',
    input: { command },
  };
}

// ============================================================================
// Read hook
// ============================================================================

test('read hook blocks a file over the threshold', async () => {
  await withProject({}, async ({ captured, makeFile }) => {
    const large = makeFile('large.txt', 500);
    const result = await callHooks(captured, readEvent(large));

    assert.equal(result?.block, true);
    assert.match(result.reason, /500 lines/);
    assert.match(result.reason, /shunt_read/);
  });
});

test('read hook allows a file at the threshold', async () => {
  await withProject({}, async ({ captured, makeFile }) => {
    const atThreshold = makeFile('threshold.txt', 350);
    const result = await callHooks(captured, readEvent(atThreshold));

    assert.equal(result, undefined);
  });
});

test('read hook allows a small file', async () => {
  await withProject({}, async ({ captured, makeFile }) => {
    const small = makeFile('small.txt', 100);
    assert.equal(await callHooks(captured, readEvent(small)), undefined);
  });
});

test('read hook allows a targeted read with offset', async () => {
  await withProject({}, async ({ captured, makeFile }) => {
    const large = makeFile('large.txt', 500);
    assert.equal(await callHooks(captured, readEvent(large, { offset: 10 })), undefined);
  });
});

test('read hook allows a targeted read with limit', async () => {
  await withProject({}, async ({ captured, makeFile }) => {
    const large = makeFile('large.txt', 500);
    assert.equal(await callHooks(captured, readEvent(large, { limit: 20 })), undefined);
  });
});

test('read hook ignores a missing file', async () => {
  await withProject({}, async ({ captured, root }) => {
    assert.equal(await callHooks(captured, readEvent(path.join(root, 'nope.txt'))), undefined);
  });
});

test('read hook honors SHUNT_MIN_LINES', async () => {
  await withProject({ SHUNT_MIN_LINES: '50' }, async ({ captured, makeFile }) => {
    const medium = makeFile('medium.txt', 100);
    const result = await callHooks(captured, readEvent(medium));

    assert.equal(result?.block, true);
    assert.match(result.reason, /threshold: 50/);
  });
});

// ============================================================================
// Bash hook
// ============================================================================

test('bash hook blocks cat on a large file', async () => {
  await withProject({}, async ({ captured, makeFile }) => {
    makeFile('large.txt', 500);
    const result = await callHooks(captured, bashEvent('cat large.txt'));

    assert.equal(result?.block, true);
    assert.match(result.reason, /shunt_read/);
  });
});

test('bash hook allows cat on a small file', async () => {
  await withProject({}, async ({ captured, makeFile }) => {
    makeFile('small.txt', 100);
    assert.equal(await callHooks(captured, bashEvent('cat small.txt')), undefined);
  });
});

test('bash hook allows a piped read', async () => {
  await withProject({}, async ({ captured, makeFile }) => {
    makeFile('large.txt', 500);
    assert.equal(await callHooks(captured, bashEvent('cat large.txt | head -n 20')), undefined);
  });
});

test('bash hook ignores non-read commands', async () => {
  await withProject({}, async ({ captured, makeFile }) => {
    makeFile('large.txt', 500);
    assert.equal(await callHooks(captured, bashEvent('grep error large.txt')), undefined);
  });
});

// ============================================================================
// Toggles and registration
// ============================================================================

test('disabled extension registers nothing and blocks nothing', async () => {
  await withProject({ SHUNT_ENABLED: 'false' }, async ({ captured, makeFile }) => {
    const large = makeFile('large.txt', 500);

    assert.deepEqual(captured.tools, []);
    assert.deepEqual(captured.toolCallHandlers, []);
    assert.equal(await callHooks(captured, readEvent(large)), undefined);
  });
});

test('read interception off still registers the tools but does not block', async () => {
  await withProject({ SHUNT_READ_ENABLED: 'false' }, async ({ captured, makeFile }) => {
    const large = makeFile('large.txt', 500);

    assert.ok(captured.tools.includes('shunt_read'));
    assert.equal(await callHooks(captured, readEvent(large)), undefined);
    assert.equal(await callHooks(captured, bashEvent('cat large.txt')), undefined);
  });
});

test('an enabled extension registers both tools, commands, and the shortcut', async () => {
  await withProject({}, async ({ captured }) => {
    assert.deepEqual(captured.tools, ['shunt_read', 'shunt_write']);
    assert.ok(captured.commands.includes('shunt:stats'));
    assert.ok(captured.commands.includes('shunt:config'));
    assert.ok(captured.commands.includes('shunt:toggle'));
    assert.deepEqual(captured.shortcuts, ['ctrl+alt+s']);
  });
});
