/**
 * Unit tests for pure logic (config, utils)
 * Run: node --test tests/unit.test.ts
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { stripFences, estimateTokens, getLineCount, isFileReadable } from '../extensions/lib/utils.ts';
import { loadConfig } from '../extensions/lib/config.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('utils', () => {
  describe('stripFences', () => {
    it('strips a wrapping fence pair', () => {
      assert.equal(stripFences('```ts\nconst a = 1;\n```'), 'const a = 1;');
    });

    it('strips when content spans multiple lines', () => {
      assert.equal(stripFences('```\nline1\nline2\n```'), 'line1\nline2');
    });

    it('leaves plain code alone', () => {
      const plain = 'const a = 1;\nconst b = 2;';
      assert.equal(stripFences(plain), plain);
    });

    it('leaves a lone opening fence alone', () => {
      assert.equal(stripFences('```ts\nconst a = 1;\n'), '```ts\nconst a = 1;');
    });

    it('preserves embedded fences', () => {
      const md = 'const a = 1;\n```ts\ndoc line\n```\nconst b = 2;';
      assert.equal(stripFences(md), md);
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~1 token per 4 chars', () => {
      assert.equal(estimateTokens('1234'), 1);
      assert.equal(estimateTokens('12345'), 2);
      assert.equal(estimateTokens(''), 0);
    });
  });

  describe('getLineCount', () => {
    it('returns 0 for nonexistent file', () => {
      assert.equal(getLineCount('/nonexistent/file.txt'), 0);
    });

    it('counts lines in a real file', () => {
      const tmp = path.join(os.tmpdir(), `shunt-test-${Date.now()}.txt`);
      fs.writeFileSync(tmp, 'line1\nline2\nline3');
      try {
        assert.equal(getLineCount(tmp), 3);
      } finally {
        fs.unlinkSync(tmp);
      }
    });
  });

  describe('isFileReadable', () => {
    it('returns false for nonexistent file', () => {
      assert.equal(isFileReadable('/nonexistent/file.txt'), false);
    });

    it('returns true for a readable file', () => {
      const tmp = path.join(os.tmpdir(), `shunt-test-${Date.now()}.txt`);
      fs.writeFileSync(tmp, 'content');
      try {
        assert.equal(isFileReadable(tmp), true);
      } finally {
        fs.unlinkSync(tmp);
      }
    });
  });
});

describe('config', () => {
  it('loads sane defaults', () => {
    const config = loadConfig();
    assert.equal(config.enabled, true);
    assert.ok(config.minLines >= 1, 'minLines is positive');
    assert.ok(config.workerModel.length > 0, 'workerModel is set');
    assert.equal(config.readEnabled, true);
    assert.equal(config.writeEnabled, true);
    assert.ok(config.cycleKey.length > 0, 'cycleKey is set');
  });

  it('respects SHUNT_MIN_LINES env var', () => {
    const old = process.env.SHUNT_MIN_LINES;
    process.env.SHUNT_MIN_LINES = '500';
    try {
      const config = loadConfig();
      assert.equal(config.minLines, 500);
    } finally {
      if (old === undefined) delete process.env.SHUNT_MIN_LINES;
      else process.env.SHUNT_MIN_LINES = old;
    }
  });

  it('respects SHUNT_ENABLED=false', () => {
    const old = process.env.SHUNT_ENABLED;
    process.env.SHUNT_ENABLED = 'false';
    try {
      const config = loadConfig();
      assert.equal(config.enabled, false);
    } finally {
      if (old === undefined) delete process.env.SHUNT_ENABLED;
      else process.env.SHUNT_ENABLED = old;
    }
  });
});
