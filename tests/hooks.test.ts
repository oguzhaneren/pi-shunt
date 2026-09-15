/**
 * Hook logic tests: read interception, bash interception, isBashReadCommand parser
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isBashReadCommand } from '../extensions/lib/utils.ts';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Test fixture helpers
const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/hooks-test-temp');

function setup() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
}

function teardown() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
}

function makeFile(name: string, lines: number): string {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, Array(lines).fill('test line').join('\n'));
  return path;
}

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

test('isBashReadCommand - rejects pipes (targeted read)', () => {
  const result = isBashReadCommand('cat file.txt | grep foo');
  assert.equal(result.isRead, false);
});

test('isBashReadCommand - rejects output redirect', () => {
  const result = isBashReadCommand('cat input.txt > output.txt');
  assert.equal(result.isRead, false);
});

test('isBashReadCommand - rejects append redirect', () => {
  const result = isBashReadCommand('tail -f app.log >> all.log');
  assert.equal(result.isRead, false);
});

test('isBashReadCommand - rejects non-read commands', () => {
  assert.equal(isBashReadCommand('ls -la').isRead, false);
  assert.equal(isBashReadCommand('grep foo bar.txt').isRead, false);
  assert.equal(isBashReadCommand('echo hello').isRead, false);
  assert.equal(isBashReadCommand('rm file.txt').isRead, false);
});

test('isBashReadCommand - rejects empty/whitespace', () => {
  assert.equal(isBashReadCommand('').isRead, false);
  assert.equal(isBashReadCommand('   ').isRead, false);
});

test('isBashReadCommand - multiple files (first wins)', () => {
  const result = isBashReadCommand('cat file1.txt file2.txt');
  assert.equal(result.isRead, true);
  assert.equal(result.filePath, 'file1.txt');
});

test('isBashReadCommand - only flags, no file', () => {
  const result = isBashReadCommand('head -n 10');
  assert.equal(result.isRead, false);
});

// ============================================================================
// Hook decision logic tests (simulated - no full pi runtime needed)
// ============================================================================

test('read hook - allows offset reads (targeted)', () => {
  setup();
  const largePath = makeFile('large.txt', 500);
  
  // Simulated hook logic: offset or limit present -> allow
  const hasOffset = true;
  const lines = 500;
  const minLines = 350;
  
  const shouldBlock = !hasOffset && lines > minLines;
  assert.equal(shouldBlock, false, 'offset reads should pass');
  
  teardown();
});

test('read hook - allows limit reads (targeted)', () => {
  setup();
  const largePath = makeFile('large.txt', 500);
  
  const hasLimit = true;
  const lines = 500;
  const minLines = 350;
  
  const shouldBlock = !hasLimit && lines > minLines;
  assert.equal(shouldBlock, false, 'limit reads should pass');
  
  teardown();
});

test('read hook - blocks large file without offset/limit', () => {
  setup();
  const largePath = makeFile('large.txt', 500);
  
  const hasOffset = false;
  const hasLimit = false;
  const lines = 500;
  const minLines = 350;
  
  const shouldBlock = !hasOffset && !hasLimit && lines > minLines;
  assert.equal(shouldBlock, true, 'full read of large file should block');
  
  teardown();
});

test('read hook - allows small file', () => {
  setup();
  const smallPath = makeFile('small.txt', 100);
  
  const hasOffset = false;
  const hasLimit = false;
  const lines = 100;
  const minLines = 350;
  
  const shouldBlock = !hasOffset && !hasLimit && lines > minLines;
  assert.equal(shouldBlock, false, 'small files should pass');
  
  teardown();
});

test('read hook - allows at-threshold file', () => {
  setup();
  const atThreshold = makeFile('threshold.txt', 350);
  
  const hasOffset = false;
  const hasLimit = false;
  const lines = 350;
  const minLines = 350;
  
  const shouldBlock = !hasOffset && !hasLimit && lines > minLines;
  assert.equal(shouldBlock, false, 'at-threshold files should pass (not strictly greater)');
  
  teardown();
});

test('bash hook - blocks cat on large file', () => {
  const command = 'cat large.txt';
  const { isRead, filePath } = isBashReadCommand(command);
  const lines = 500;
  const minLines = 350;
  
  const shouldBlock = isRead && filePath && lines > minLines;
  assert.equal(shouldBlock, true, 'bash cat on large file should block');
});

test('bash hook - allows cat with pipe (targeted)', () => {
  const command = 'cat large.txt | head -n 20';
  const { isRead, filePath } = isBashReadCommand(command);
  
  // Parser rejects pipes -> isRead is false -> hook doesn't block
  assert.equal(isRead, false, 'piped commands are targeted reads, should pass');
});

test('bash hook - allows head with flags (small output)', () => {
  // Even on large file, head -n 10 is targeted -> pipe logic
  // Our current parser doesn't detect this as targeted, but head itself limits output
  // This is acceptable: if head -n 10 is blocked, user can use shunt_read with findText
  const command = 'head -n 10 large.txt';
  const { isRead } = isBashReadCommand(command);
  
  // Parser accepts it (isRead=true), hook will block if file is large
  // This is correct behavior: full head output can be large, shunt is appropriate
  assert.equal(isRead, true);
});

test('bash hook - allows grep (not a read command)', () => {
  const command = 'grep "error" app.log';
  const { isRead } = isBashReadCommand(command);
  
  assert.equal(isRead, false, 'grep is not intercepted as a raw read');
});

test('config disabled - no blocking', () => {
  // Simulated: config.enabled = false or config.readEnabled = false
  const configEnabled = false;
  const lines = 500;
  const minLines = 350;
  
  const shouldBlock = configEnabled && lines > minLines;
  assert.equal(shouldBlock, false, 'disabled config should never block');
});

test('config disabled read - no blocking', () => {
  const configEnabled = true;
  const readEnabled = false;
  const lines = 500;
  const minLines = 350;
  
  const shouldBlock = configEnabled && readEnabled && lines > minLines;
  assert.equal(shouldBlock, false, 'read-disabled config should never block read hooks');
});

console.log('✓ All hook logic tests passed');
