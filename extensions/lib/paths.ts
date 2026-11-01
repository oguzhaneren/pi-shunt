/**
 * Path policy for shunt_read and shunt_write.
 *
 * Both tools move file contents to a worker model running on a different
 * provider, so every path they touch is checked twice: it must resolve inside
 * an allowed root, and it must not match the secrets denylist.
 *
 * Symlinks are resolved before the root check, so a link inside the project
 * cannot point at a file outside it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PathPolicy {
  /** Allowed roots, realpath'd and absolute. The first is the project root. */
  roots: string[];
  /** Glob patterns that may never be sent to a worker model. */
  denyGlobs: string[];
}

export type PathDecision =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/**
 * Files that stay out of worker payloads. Patterns without a slash match the
 * basename; patterns with a slash match the path relative to its root.
 */
const BUILTIN_DENY_GLOBS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_rsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '*.ppk',
  '.npmrc',
  '.netrc',
  '.git-credentials',
  '.pgpass',
  '.htpasswd',
  '**/.ssh/**',
  '**/.aws/**',
  '**/.gnupg/**',
  '**/.kube/config',
  'credentials',
  'credentials.json',
  'service-account*.json',
  'secrets.*',
  '*secret*.yml',
  '*secret*.yaml',
  '*.kdbx',
];

/**
 * Build a policy from a project root and the optional user settings.
 *
 * `allowPaths` is colon-separated extra roots. `denyGlobs` is comma-separated
 * patterns appended to the built-in denylist; it can extend the list but never
 * shrink it.
 */
export function buildPathPolicy(
  root: string,
  allowPaths?: string,
  denyGlobs?: string
): PathPolicy {
  const roots = [root, ...splitList(allowPaths, ':')]
    .map((entry) => realpathOrSelf(path.resolve(entry)));

  return {
    roots: [...new Set(roots)],
    denyGlobs: [...BUILTIN_DENY_GLOBS, ...splitList(denyGlobs, ',')],
  };
}

/**
 * Resolve `input` against the policy. For `write`, the path need not exist yet;
 * its nearest existing ancestor is resolved instead, so a symlinked parent
 * cannot smuggle the target out of the project.
 */
export function resolveAllowedPath(
  input: string,
  policy: PathPolicy,
  intent: 'read' | 'write'
): PathDecision {
  if (!input || !input.trim()) {
    return { ok: false, reason: 'Empty path.' };
  }

  const projectRoot = policy.roots[0];
  const absolute = path.resolve(projectRoot, input.trim());
  const resolved = intent === 'write' ? realpathThroughParents(absolute) : realpathOrSelf(absolute);

  const root = policy.roots.find((candidate) => isInside(candidate, resolved));
  if (!root) {
    return {
      ok: false,
      reason:
        `Path resolves outside the project root: ${resolved}. ` +
        `shunt tools only touch files under ${projectRoot}. ` +
        `Read it with the built-in read tool, or add its directory to SHUNT_ALLOW_PATHS.`,
    };
  }

  const relative = toPosix(path.relative(root, resolved));
  const denied = policy.denyGlobs.find((pattern) => matchesGlob(pattern, relative));
  if (denied) {
    return {
      ok: false,
      reason:
        `Path matches the shunt denylist (${denied}): ${relative}. ` +
        `Files that commonly hold secrets are never sent to the worker model. ` +
        `Use the built-in read tool if you need this file.`,
    };
  }

  return { ok: true, path: resolved };
}

function splitList(value: string | undefined, separator: string): string[] {
  if (!value) return [];
  return value
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** realpath when the path exists, the path itself when it does not. */
function realpathOrSelf(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/** Resolve the nearest existing ancestor, then re-join the missing segments. */
function realpathThroughParents(target: string): string {
  const missing: string[] = [];
  let current = target;

  while (true) {
    try {
      return path.join(fs.realpathSync(current), ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/**
 * Match a glob against a relative posix path. `*` and `?` stay within a
 * segment, `**` crosses segments. A pattern without a slash matches the
 * basename, so `.env` denies `config/.env` too. Matching ignores case.
 */
export function matchesGlob(pattern: string, relativePath: string): boolean {
  const subject = pattern.includes('/') ? relativePath : basename(relativePath);
  return globToRegExp(pattern).test(subject);
}

function basename(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts[parts.length - 1];
}

function globToRegExp(pattern: string): RegExp {
  let source = '';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` also matches zero directories, so `**/.ssh/**` denies `.ssh/key`.
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${source}$`, 'i');
}
