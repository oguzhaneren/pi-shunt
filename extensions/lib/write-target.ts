/**
 * Target checks for shunt_write.
 *
 * The generated code never enters the main context, so nobody sees what a
 * write replaced. The target is therefore confined to the project, refused
 * when it is a directory or a symlink, and replaced only with explicit
 * consent: a confirmation in an interactive session, or SHUNT_WRITE_OVERWRITE
 * when running unattended.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAllowedPath, type PathPolicy } from './paths.ts';

export interface WriteTargetRequest {
  target: string;
  policy: PathPolicy;
  /** Whether dialog-capable UI is available (ctx.hasUI). */
  hasUI: boolean;
  /** SHUNT_WRITE_OVERWRITE: replace existing files without asking. */
  allowOverwrite: boolean;
  confirm: (title: string, message: string) => Promise<boolean>;
}

export type WriteTargetDecision =
  | { ok: true; path: string; replacedLines: number }
  | { ok: false; code: string; reason: string };

export async function prepareWriteTarget(
  request: WriteTargetRequest
): Promise<WriteTargetDecision> {
  const decision = resolveAllowedPath(request.target, request.policy, 'write');
  if (!decision.ok) {
    return { ok: false, code: 'path_denied', reason: decision.reason };
  }

  const target = decision.path;
  const literal = path.resolve(request.policy.roots[0], request.target.trim());

  const linkStat = lstatOrNull(literal);
  if (linkStat?.isSymbolicLink()) {
    return {
      ok: false,
      code: 'target_is_symlink',
      reason: `Target is a symlink: ${request.target}. Write to the real path instead.`,
    };
  }

  const stat = statOrNull(target);
  if (stat?.isDirectory()) {
    return {
      ok: false,
      code: 'target_is_directory',
      reason: `Target is a directory: ${request.target}.`,
    };
  }

  let replacedLines = 0;
  if (stat?.isFile() && stat.size > 0) {
    replacedLines = countLines(target);

    if (!request.allowOverwrite) {
      if (!request.hasUI) {
        return {
          ok: false,
          code: 'overwrite_refused',
          reason:
            `Target already exists (${replacedLines} lines): ${request.target}. ` +
            `shunt_write does not replace files unattended. Set SHUNT_WRITE_OVERWRITE=true ` +
            `to allow it, or choose a new path.`,
        };
      }

      const approved = await request.confirm(
        'shunt_write',
        `Overwrite ${request.target} (${replacedLines} lines) with worker output?`
      );
      if (!approved) {
        return {
          ok: false,
          code: 'overwrite_declined',
          reason: `Overwrite of ${request.target} declined.`,
        };
      }
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  return { ok: true, path: target, replacedLines };
}

/** Write through a temp file in the same directory, so a crash cannot truncate the target. */
export function writeFileAtomic(target: string, content: string): void {
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.shunt-tmp-${process.pid}`
  );

  try {
    fs.writeFileSync(temp, content, 'utf-8');
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function statOrNull(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function countLines(target: string): number {
  try {
    return fs.readFileSync(target, 'utf-8').split('\n').length;
  } catch {
    return 0;
  }
}
