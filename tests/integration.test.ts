/**
 * Integration tests - worker delegation via real pi subprocess
 * Requires: pi installed and available in PATH
 * Run: node --test tests/integration.test.ts
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { delegateToWorker, delegateWriteToWorker } from '../extensions/lib/worker.ts';
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
});
