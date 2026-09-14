/**
 * Utility functions for pi-shunt extension
 */

import * as fs from 'node:fs';

/**
 * Get line count of a file efficiently
 */
export function getLineCount(filePath: string): number {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Check if file exists and is readable
 */
export function isFileReadable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wrap file content in XML tags for clear boundaries
 */
export function wrapFileContent(filePath: string, content: string): string {
  return `<file path="${filePath}">\n${content}\n</file>`;
}

/**
 * Format file corpus with question for worker model
 */
export function formatWorkerMessage(files: Array<{ path: string; content: string }>, question: string): string {
  const corpus = files.map(f => wrapFileContent(f.path, f.content)).join('\n\n');
  return `${corpus}\n\nQuestion: ${question}`;
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 chars)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if bash command is a read operation
 */
export function isBashReadCommand(command: string): { isRead: boolean; filePath?: string } {
  // Skip piped commands (targeted reads)
  if (command.includes('|')) {
    return { isRead: false };
  }

  // Skip redirections (not reading into context)
  if (command.includes('>')) {
    return { isRead: false };
  }

  // Match read commands: cat, head, tail, less, more
  const readCommandPattern = /^(cat|head|tail|less|more)\s+(.+)$/;
  const match = command.trim().match(readCommandPattern);

  if (!match) {
    return { isRead: false };
  }

  // Extract file path, skipping flags
  const args = match[2].trim().split(/\s+/);
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      // Remove quotes if present
      const filePath = arg.replace(/^["']|["']$/g, '');
      return { isRead: true, filePath };
    }
  }

  return { isRead: false };
}
