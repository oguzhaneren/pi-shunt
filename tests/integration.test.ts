/**
 * Integration tests - worker delegation via real pi subprocess
 * Requires: pi installed and available in PATH
 * Run: node --test tests/integration.test.ts
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { delegateToWorker, delegateWriteToWorker } from '../extensions/lib/worker.ts';
import { estimateTokens } from '../extensions/lib/utils.ts';
import { loadConfig } from '../extensions/lib/config.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('worker delegation', () => {
  const config = loadConfig();
  
  it('delegateToWorker returns structured summary', async () => {
    const files = [{
      path: 'tests/fixtures/user-service.ts',
      content: fs.readFileSync('tests/fixtures/user-service.ts', 'utf-8')
    }];
    
    const result = await delegateToWorker(
      files,
      'List the exported class and its methods',
      config
    );

    assert.ok(result.text.length > 0, 'returned non-empty text');
    assert.ok(result.inputTokens > 0, 'reported input tokens');
    assert.ok(result.outputTokens > 0, 'reported output tokens');
    assert.ok(result.text.includes('UserService') || result.text.includes('export'), 'mentions exports');
  });

  it('delegateToWorker handles multiple files', async () => {
    const files = [
      {
        path: 'tests/fixtures/user-service.ts',
        content: fs.readFileSync('tests/fixtures/user-service.ts', 'utf-8')
      },
      {
        path: 'tests/fixtures/order-service.test.ts',
        content: fs.readFileSync('tests/fixtures/order-service.test.ts', 'utf-8')
      }
    ];

    const result = await delegateToWorker(
      files,
      'What testing patterns are shown in the test file?',
      config
    );

    assert.ok(result.text.length > 0);
    assert.ok(result.totalTokens > 0);
  });

  it('delegateWriteToWorker generates code', async () => {
    const reference = {
      path: 'tests/fixtures/order-service.test.ts',
      content: fs.readFileSync('tests/fixtures/order-service.test.ts', 'utf-8')
    };

    const result = await delegateWriteToWorker(
      'Write a simple test stub with one describe block',
      reference,
      config
    );

    assert.ok(result.text.length > 0, 'generated code');
    assert.ok(result.text.includes('describe') || result.text.includes('test'), 'looks like a test');
    assert.ok(result.inputTokens > 0);
    assert.ok(result.outputTokens > 0);
  });

  it('rejects oversized payload', async () => {
    const huge = 'x'.repeat(config.maxPayloadBytes + 1);
    const files = [{ path: 'huge.txt', content: huge }];

    await assert.rejects(
      async () => delegateToWorker(files, 'question', config),
      /exceeds limit/
    );
  });

  it('worker input tracks the corpus, not the local context files', async () => {
    // A worker that loads AGENTS.md/CLAUDE.md, skills and extensions reports far
    // more input than the corpus explains. Run from a directory with a fat
    // AGENTS.md to catch that regression.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-context-'));
    fs.writeFileSync(
      path.join(dir, 'AGENTS.md'),
      ('# Project rules\n\n' + 'Follow this rule carefully in every case. '.repeat(400))
    );

    const content = fs.readFileSync('tests/fixtures/user-service.ts', 'utf-8');
    const files = [{ path: 'tests/fixtures/user-service.ts', content }];
    const question = 'List the exported class and its methods';

    const originalCwd = process.cwd();
    process.chdir(dir);
    let result;
    try {
      result = await delegateToWorker(files, question, config);
    } finally {
      process.chdir(originalCwd);
    }

    assert.ok(result.usage, 'worker reported real usage');
    const corpusEstimate = estimateTokens(content) + estimateTokens(question);
    assert.ok(
      result.usage!.input < corpusEstimate * 3,
      `worker input ${result.usage!.input} should track corpus estimate ${corpusEstimate}, ` +
      `not the local AGENTS.md`
    );
  });

  it('kills a worker that outlives the timeout', async () => {
    const files = [{
      path: 'tests/fixtures/user-service.ts',
      content: fs.readFileSync('tests/fixtures/user-service.ts', 'utf-8')
    }];

    await assert.rejects(
      async () => delegateToWorker(files, 'Summarize', { ...config, workerTimeoutMs: 50 }),
      /timed out after 50ms/
    );
  });
});
