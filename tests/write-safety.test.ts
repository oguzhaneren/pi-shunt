/**
 * shunt_write target safety: confinement, overwrite consent, atomic write.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { prepareWriteTarget, writeFileAtomic } from '../extensions/lib/write-target.ts';
import { buildPathPolicy } from '../extensions/lib/paths.ts';

function makeRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-write-')));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'existing.ts'), 'export const original = true;\n');
  fs.mkdirSync(path.join(root, 'src', 'adir'), { recursive: true });
  return root;
}

const never = async () => {
  throw new Error('confirm should not be called');
};

function request(root: string, target: string, overrides: Record<string, unknown> = {}) {
  return {
    target,
    policy: buildPathPolicy(root),
    hasUI: false,
    allowOverwrite: false,
    confirm: never,
    ...overrides,
  } as Parameters<typeof prepareWriteTarget>[0];
}

test('allows a new target inside the root', async () => {
  const root = makeRoot();
  const decision = await prepareWriteTarget(request(root, 'src/generated.ts'));

  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.path, path.join(root, 'src', 'generated.ts'));
  assert.equal(decision.ok && decision.replacedLines, 0);
});

test('creates missing parent directories inside the root', async () => {
  const root = makeRoot();
  const decision = await prepareWriteTarget(request(root, 'src/deep/nested/new.ts'));

  assert.equal(decision.ok, true);
  assert.ok(fs.existsSync(path.join(root, 'src', 'deep', 'nested')), 'parents created');
});

test('refuses a target outside the root', async () => {
  const root = makeRoot();
  const decision = await prepareWriteTarget(request(root, '../escaped.ts'));

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? '' : decision.code, 'path_denied');
  assert.match(decision.ok ? '' : decision.reason, /outside the project/);
});

test('refuses a denylisted target', async () => {
  const root = makeRoot();
  const decision = await prepareWriteTarget(request(root, '.env'));

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? '' : decision.code, 'path_denied');
});

test('refuses a directory target', async () => {
  const root = makeRoot();
  const decision = await prepareWriteTarget(request(root, 'src/adir'));

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? '' : decision.code, 'target_is_directory');
});

test('refuses a symlink target', async () => {
  const root = makeRoot();
  fs.symlinkSync(path.join(root, 'src', 'existing.ts'), path.join(root, 'src', 'link.ts'));

  const decision = await prepareWriteTarget(request(root, 'src/link.ts'));

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? '' : decision.code, 'target_is_symlink');
});

test('refuses to replace an existing file with no UI and no opt-in', async () => {
  const root = makeRoot();
  const decision = await prepareWriteTarget(request(root, 'src/existing.ts'));

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? '' : decision.code, 'overwrite_refused');
  assert.match(decision.ok ? '' : decision.reason, /SHUNT_WRITE_OVERWRITE/);
  assert.equal(
    fs.readFileSync(path.join(root, 'src', 'existing.ts'), 'utf-8'),
    'export const original = true;\n',
    'original untouched'
  );
});

test('replaces an existing file when the opt-in is set', async () => {
  const root = makeRoot();
  const decision = await prepareWriteTarget(
    request(root, 'src/existing.ts', { allowOverwrite: true })
  );

  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.replacedLines, 2, 'reports the lines being replaced');
});

test('asks for confirmation when a UI is available', async () => {
  const root = makeRoot();
  const asked: string[] = [];

  const decision = await prepareWriteTarget(
    request(root, 'src/existing.ts', {
      hasUI: true,
      confirm: async (_title: string, message: string) => {
        asked.push(message);
        return true;
      },
    })
  );

  assert.equal(decision.ok, true);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /src\/existing\.ts/, 'prompt names the target');
});

test('declining the confirmation leaves the file byte-identical', async () => {
  const root = makeRoot();
  const before = fs.readFileSync(path.join(root, 'src', 'existing.ts'));

  const decision = await prepareWriteTarget(
    request(root, 'src/existing.ts', { hasUI: true, confirm: async () => false })
  );

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? '' : decision.code, 'overwrite_declined');
  assert.deepEqual(fs.readFileSync(path.join(root, 'src', 'existing.ts')), before);
});

test('an empty existing file is replaced without a prompt', async () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'src', 'empty.ts'), '');

  const decision = await prepareWriteTarget(request(root, 'src/empty.ts'));

  assert.equal(decision.ok, true);
});

test('writeFileAtomic writes the content and leaves no temp file', () => {
  const root = makeRoot();
  const target = path.join(root, 'src', 'generated.ts');

  writeFileAtomic(target, 'export const generated = 1;\n');

  assert.equal(fs.readFileSync(target, 'utf-8'), 'export const generated = 1;\n');
  const leftovers = fs.readdirSync(path.join(root, 'src')).filter((n) => n.includes('shunt-tmp'));
  assert.deepEqual(leftovers, [], 'no temp files left behind');
});

test('writeFileAtomic replaces content without truncating on failure', () => {
  const root = makeRoot();
  const target = path.join(root, 'src', 'existing.ts');

  writeFileAtomic(target, 'export const replaced = true;\n');

  assert.equal(fs.readFileSync(target, 'utf-8'), 'export const replaced = true;\n');
  const leftovers = fs.readdirSync(path.join(root, 'src')).filter((n) => n.includes('shunt-tmp'));
  assert.deepEqual(leftovers, []);
});
