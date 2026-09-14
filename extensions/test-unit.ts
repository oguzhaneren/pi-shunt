/**
 * Unit self-check for the pure logic introduced in v0.2.1.
 * Run: node extensions/test-unit.ts
 */

import { strict as assert } from 'node:assert';
import { stripFences } from './lib/utils.ts';

// Strips a wrapping fence pair
assert.equal(
  stripFences('```ts\nconst a = 1;\n```'),
  'const a = 1;'
);

// Strips when content spans multiple lines
assert.equal(
  stripFences('```\nline1\nline2\n```'),
  'line1\nline2'
);

// Leaves plain code alone
const plain = 'const a = 1;\nconst b = 2;';
assert.equal(stripFences(plain), plain);

// Leaves a lone opening fence alone (not a pair)
assert.equal(stripFences('```ts\nconst a = 1;\n'), '```ts\nconst a = 1;');

// Preserves embedded fences (generated markdown where a fence isn't first/last)
const md = 'const a = 1;\n```ts\ndoc line\n```\nconst b = 2;';
assert.equal(stripFences(md), md);

console.log('test-unit: all assertions passed');
