/**
 * Path policy tests: project-root confinement and the secrets denylist.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveAllowedPath, buildPathPolicy } from '../extensions/lib/paths.ts';

/** Real directory tree, realpath'd so macOS /var -> /private/var does not confuse comparisons. */
function makeRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-paths-')));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'env.ts'), 'export const env = {};\n');
  fs.writeFileSync(path.join(root, 'src', 'keyboard.ts'), 'export const keys = [];\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(root, 'config', 'secrets.yml'), 'token: 1\n');
  fs.writeFileSync(path.join(root, 'deploy', 'id_ed25519'), 'key\n');
  fs.writeFileSync(path.join(root, '.npmrc'), '//registry:_authToken=1\n');
  return root;
}

function policy(root: string, extra: Partial<{ allowPaths: string; denyGlobs: string }> = {}) {
  return buildPathPolicy(root, extra.allowPaths, extra.denyGlobs);
}

test('resolves a relative path inside the root', () => {
  const root = makeRoot();
  const result = resolveAllowedPath('src/index.ts', policy(root), 'read');
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.path, path.join(root, 'src', 'index.ts'));
});

test('resolves an absolute path inside the root', () => {
  const root = makeRoot();
  const target = path.join(root, 'src', 'index.ts');
  const result = resolveAllowedPath(target, policy(root), 'read');
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.path, target);
});

test('rejects traversal out of the root', () => {
  const root = makeRoot();
  const result = resolveAllowedPath('../../etc/passwd', policy(root), 'read');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /outside the project/);
});

test('rejects an absolute path outside the root', () => {
  const root = makeRoot();
  const result = resolveAllowedPath('/etc/hosts', policy(root), 'read');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /outside the project/);
});

test('rejects a symlink inside the root pointing outside it', () => {
  const root = makeRoot();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-outside-')));
  fs.writeFileSync(path.join(outside, 'loot.txt'), 'secret\n');
  fs.symlinkSync(path.join(outside, 'loot.txt'), path.join(root, 'src', 'link.txt'));

  const result = resolveAllowedPath('src/link.txt', policy(root), 'read');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /outside the project/);
});

test('rejects a write target whose parent escapes via symlink', () => {
  const root = makeRoot();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-outside-')));
  fs.symlinkSync(outside, path.join(root, 'escape'));

  const result = resolveAllowedPath('escape/generated.ts', policy(root), 'write');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /outside the project/);
});

test('rejects denylisted secret files', () => {
  const root = makeRoot();
  for (const denied of ['.env', 'config/secrets.yml', 'deploy/id_ed25519', '.npmrc']) {
    const result = resolveAllowedPath(denied, policy(root), 'read');
    assert.equal(result.ok, false, `${denied} should be denied`);
    assert.match(result.ok ? '' : result.reason, /denylist/, `${denied} reason names the denylist`);
  }
});

test('rejects secrets outside the repo by confinement, not just by name', () => {
  const root = makeRoot();
  const result = resolveAllowedPath(path.join(os.homedir(), '.ssh', 'id_ed25519'), policy(root), 'read');
  assert.equal(result.ok, false);
});

test('allows ordinary files whose names only look secret', () => {
  const root = makeRoot();
  for (const allowed of ['src/env.ts', 'src/keyboard.ts']) {
    const result = resolveAllowedPath(allowed, policy(root), 'read');
    assert.equal(result.ok, true, `${allowed} should be allowed`);
  }
});

test('honors an extra root from SHUNT_ALLOW_PATHS', () => {
  const root = makeRoot();
  const sibling = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-sibling-')));
  fs.writeFileSync(path.join(sibling, 'shared.ts'), 'export const s = 1;\n');

  const denied = resolveAllowedPath(path.join(sibling, 'shared.ts'), policy(root), 'read');
  assert.equal(denied.ok, false, 'sibling is outside the root by default');

  const allowed = resolveAllowedPath(
    path.join(sibling, 'shared.ts'),
    policy(root, { allowPaths: sibling }),
    'read'
  );
  assert.equal(allowed.ok, true, 'sibling is allowed once configured');
});

test('the denylist still applies inside an extra allowed root', () => {
  const root = makeRoot();
  const sibling = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-sibling-')));
  fs.writeFileSync(path.join(sibling, '.env'), 'SECRET=1\n');

  const result = resolveAllowedPath(
    path.join(sibling, '.env'),
    policy(root, { allowPaths: sibling }),
    'read'
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /denylist/);
});

test('SHUNT_DENY_GLOBS appends to the built-in denylist', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'src', 'private.ts'), 'export const p = 1;\n');

  const extended = policy(root, { denyGlobs: '**/private.ts' });
  const denied = resolveAllowedPath('src/private.ts', extended, 'read');
  assert.equal(denied.ok, false);

  const builtinStillDenied = resolveAllowedPath('.env', extended, 'read');
  assert.equal(builtinStillDenied.ok, false, 'extending does not replace the built-in list');
});

test('SHUNT_DENY_GLOBS cannot remove a built-in deny', () => {
  const root = makeRoot();
  // Even an attempt to "reset" the list leaves the built-ins in force.
  const result = resolveAllowedPath('.env', policy(root, { denyGlobs: '' }), 'read');
  assert.equal(result.ok, false);
});

test('resolves a write target that does not exist yet', () => {
  const root = makeRoot();
  const result = resolveAllowedPath('src/generated/user.test.ts', policy(root), 'write');
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.path, path.join(root, 'src', 'generated', 'user.test.ts'));
});

test('denies a write target that matches the denylist', () => {
  const root = makeRoot();
  const result = resolveAllowedPath('.env.production', policy(root), 'write');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /denylist/);
});

test('rejects an empty path', () => {
  const root = makeRoot();
  const result = resolveAllowedPath('   ', policy(root), 'read');
  assert.equal(result.ok, false);
});

test('matching is case-insensitive', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'deploy', 'ID_RSA'), 'key\n');
  const result = resolveAllowedPath('deploy/ID_RSA', policy(root), 'read');
  assert.equal(result.ok, false);
});
