/**
 * Worker subprocess tests: isolation flags, environment scrubbing, timeout.
 * No real pi process and no model calls - argv and env are pure functions,
 * and the timeout is exercised with a slow node process.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildWorkerArgs, buildWorkerEnv, runWorkerProcess } from '../extensions/lib/worker.ts';
import { loadConfig } from '../extensions/lib/config.ts';

const config = loadConfig();

test('worker args isolate the subprocess from local resources', () => {
  const args = buildWorkerArgs(config, '/tmp/message.txt', undefined);

  for (const flag of [
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-mcp',
    '--no-context-files',
    '--no-approve',
    '--no-tools',
    '--no-session',
  ]) {
    assert.ok(args.includes(flag), `args include ${flag}`);
  }
});

test('worker args carry the model, mode, and message file', () => {
  const args = buildWorkerArgs(config, '/tmp/message.txt', undefined);

  assert.equal(args[args.indexOf('--model') + 1], config.workerModel);
  assert.equal(args[args.indexOf('--mode') + 1], 'json');
  assert.ok(args.includes('-p'), 'non-interactive');
  assert.equal(args[args.length - 1], '@/tmp/message.txt');
});

test('worker args use the write system prompt when one is given', () => {
  const read = buildWorkerArgs(config, '/tmp/message.txt', undefined);
  const write = buildWorkerArgs(config, '/tmp/message.txt', 'WRITE PROMPT');

  assert.equal(read[read.indexOf('--system-prompt') + 1], config.workerInstructions);
  assert.equal(write[write.indexOf('--system-prompt') + 1], 'WRITE PROMPT');
});

test('worker environment drops SHUNT_* keys', () => {
  const env = buildWorkerEnv({
    PATH: '/usr/bin',
    HOME: '/Users/test',
    ANTHROPIC_API_KEY: 'keep-me',
    SHUNT_MIN_LINES: '10',
    SHUNT_WORKER_MODEL: 'should-not-leak',
    SHUNT_ENABLED: 'true',
  });

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/Users/test');
  assert.equal(env.ANTHROPIC_API_KEY, 'keep-me', 'provider credentials still reach the worker');
  assert.ok(!('SHUNT_MIN_LINES' in env));
  assert.ok(!('SHUNT_WORKER_MODEL' in env));
  assert.ok(!('SHUNT_ENABLED' in env));
});

test('a worker that outlives the timeout is killed and reported', async () => {
  const start = performance.now();

  await assert.rejects(
    async () =>
      runWorkerProcess('node', ['-e', 'setTimeout(() => {}, 30000)'], {
        timeoutMs: 250,
        env: buildWorkerEnv(process.env as Record<string, string>),
      }),
    /timed out after 250ms/
  );

  const elapsed = performance.now() - start;
  assert.ok(elapsed < 10000, `rejected promptly, took ${Math.round(elapsed)}ms`);
});

test('timeout error names the env var that controls it', async () => {
  await assert.rejects(
    async () =>
      runWorkerProcess('node', ['-e', 'setTimeout(() => {}, 30000)'], {
        timeoutMs: 150,
        env: buildWorkerEnv(process.env as Record<string, string>),
      }),
    /SHUNT_WORKER_TIMEOUT_MS/
  );
});

test('a worker finishing inside the timeout resolves with its text', async () => {
  const event = {
    type: 'message_end',
    message: {
      role: 'assistant',
      model: 'test/fake-worker',
      content: [{ type: 'text', text: 'bullet one' }],
      usage: { input: 11, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 14 },
    },
  };
  const script = `process.stdout.write(${JSON.stringify(JSON.stringify(event) + '\n')})`;

  const result = await runWorkerProcess('node', ['-e', script], { timeoutMs: 10000 });

  assert.equal(result.text, 'bullet one');
  assert.equal(result.workerModel, 'test/fake-worker');
  assert.equal(result.usage?.input, 11);
  assert.equal(result.usage?.output, 3);
});

test('a nonzero exit is reported with stderr', async () => {
  await assert.rejects(
    async () =>
      runWorkerProcess('node', ['-e', 'process.stderr.write("boom"); process.exit(3)'], {
        timeoutMs: 10000,
      }),
    /exited with code 3.*boom/s
  );
});

test('timeout is configurable and defaults to two minutes', () => {
  assert.equal(config.workerTimeoutMs, 120000);

  const fromEnv = (() => {
    process.env.SHUNT_WORKER_TIMEOUT_MS = '5000';
    try {
      return loadConfig().workerTimeoutMs;
    } finally {
      delete process.env.SHUNT_WORKER_TIMEOUT_MS;
    }
  })();

  assert.equal(fromEnv, 5000);
});
