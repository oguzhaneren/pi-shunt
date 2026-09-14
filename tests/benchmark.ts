/**
 * Token savings benchmarks
 * Measures main-model context tokens with vs without shunt delegation
 * Run: node tests/benchmark.ts
 */

import { delegateToWorker, delegateWriteToWorker } from '../extensions/lib/worker.ts';
import { loadConfig } from '../extensions/lib/config.ts';
import { estimateTokens } from '../extensions/lib/utils.ts';
import * as fs from 'node:fs';

interface BenchmarkCase {
  name: string;
  description: string;
  type: 'read' | 'write';
  run: () => Promise<{ withoutShunt: number; withShunt: number; savings: number }>;
}

const config = loadConfig();

const cases: BenchmarkCase[] = [
  {
    name: 'single-large-file',
    description: 'Read a 602-line file and summarize exports',
    type: 'read',
    async run() {
      const content = fs.readFileSync('tests/fixtures/websocket-handler.ts', 'utf-8');
      const withoutShunt = estimateTokens(content);

      const result = await delegateToWorker(
        [{ path: 'websocket-handler.ts', content }],
        'What are all the exported items and what do they do?',
        config
      );
      const withShunt = estimateTokens(result.text);

      return {
        withoutShunt,
        withShunt,
        savings: ((withoutShunt - withShunt) / withoutShunt) * 100
      };
    }
  },

  {
    name: 'multi-file-cross-read',
    description: 'Read three files and answer a cross-cutting question',
    type: 'read',
    async run() {
      const files = [
        { path: 'websocket-handler.ts', content: fs.readFileSync('tests/fixtures/websocket-handler.ts', 'utf-8') },
        { path: 'user-service.ts', content: fs.readFileSync('tests/fixtures/user-service.ts', 'utf-8') },
        { path: 'order-service.test.ts', content: fs.readFileSync('tests/fixtures/order-service.test.ts', 'utf-8') }
      ];
      const withoutShunt = files.reduce((sum, f) => sum + estimateTokens(f.content), 0);

      const result = await delegateToWorker(
        files,
        'Which classes and interfaces are exported across these files, and how do they relate?',
        config
      );
      const withShunt = estimateTokens(result.text);

      return {
        withoutShunt,
        withShunt,
        savings: ((withoutShunt - withShunt) / withoutShunt) * 100
      };
    }
  },

  {
    name: 'source-plus-test',
    description: 'Read source and test pair to understand coverage',
    type: 'read',
    async run() {
      const files = [
        { path: 'user-service.ts', content: fs.readFileSync('tests/fixtures/user-service.ts', 'utf-8') },
        { path: 'order-service.test.ts', content: fs.readFileSync('tests/fixtures/order-service.test.ts', 'utf-8') }
      ];
      const withoutShunt = files.reduce((sum, f) => sum + estimateTokens(f.content), 0);

      const result = await delegateToWorker(
        files,
        'What methods does UserService have, and which would be covered by tests following OrderService patterns?',
        config
      );
      const withShunt = estimateTokens(result.text);

      return {
        withoutShunt,
        withShunt,
        savings: ((withoutShunt - withShunt) / withoutShunt) * 100
      };
    }
  },

  {
    name: 'code-generation',
    description: 'Generate unit tests from reference',
    type: 'write',
    async run() {
      const userService = fs.readFileSync('tests/fixtures/user-service.ts', 'utf-8');
      const reference = {
        path: 'order-service.test.ts',
        content: fs.readFileSync('tests/fixtures/order-service.test.ts', 'utf-8')
      };

      // Without shunt: main model sees context files + generates inline
      const withoutShunt = estimateTokens(userService) + estimateTokens(reference.content);

      // With shunt: main model only sees the summary
      const result = await delegateWriteToWorker(
        'Write unit tests for UserService following OrderService test patterns',
        reference,
        config
      );
      const withShunt = estimateTokens(result.text);

      return {
        withoutShunt,
        withShunt,
        savings: ((withoutShunt - withShunt) / withoutShunt) * 100
      };
    }
  }
];

async function main() {
  console.log('Pi-Shunt Token Savings Benchmarks');
  console.log('==================================\n');
  console.log(`Worker model: ${config.workerModel}\n`);

  const results: Array<{ name: string; withoutShunt: number; withShunt: number; savings: number }> = [];

  for (const bench of cases) {
    process.stdout.write(`Running ${bench.name}... `);
    try {
      const result = await bench.run();
      results.push({ name: bench.name, ...result });
      console.log(`✓ (${result.savings.toFixed(1)}% savings)`);
    } catch (error) {
      console.log(`✗ ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\nResults');
  console.log('=======\n');
  console.log('| Benchmark | Without Shunt | With Shunt | Savings |');
  console.log('|-----------|---------------|------------|---------|');

  for (const r of results) {
    console.log(
      `| ${r.name.padEnd(25)} | ${r.withoutShunt.toLocaleString().padStart(13)} | ${r.withShunt.toLocaleString().padStart(10)} | ${r.savings.toFixed(1)}% |`
    );
  }

  const avgSavings = results.reduce((sum, r) => sum + r.savings, 0) / results.length;
  console.log(`\nAverage savings: ${avgSavings.toFixed(1)}%`);
}

main().catch(console.error);
