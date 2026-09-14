# Pi-Shunt Test Suite

Automated tests and benchmarks for pi-shunt.

## Quick Start

```bash
# Run all tests (unit + integration)
npm test

# Unit tests only (no pi subprocess needed)
npm run test:unit

# Integration tests (needs pi in PATH)
npm run test:integration

# Token savings benchmarks (slow, needs pi)
npm run test:benchmark
```

Or use the test runner directly:

```bash
# All tests
bash tests/run.sh

# Unit tests only
bash tests/run.sh --unit-only

# Include benchmarks
bash tests/run.sh --benchmark
```

## Test Structure

### Unit Tests (`unit.test.ts`)

Pure logic tests for:
- `stripFences()` – markdown fence removal
- `estimateTokens()` – token approximation
- `getLineCount()` – line counting
- `isFileReadable()` – file access checks
- `loadConfig()` – configuration loading from env/settings

**No dependencies:** Runs without pi installed.

### Integration Tests (`integration.test.ts`)

Worker delegation tests via real pi subprocess:
- `delegateToWorker()` – bulk file reading
- `delegateWriteToWorker()` – code generation
- Payload size validation
- Multi-file handling

**Requires:** `pi` available in PATH.

### Benchmarks (`benchmark.ts`)

Token savings measurements on realistic scenarios:

| Benchmark | Description | Expected Savings |
|-----------|-------------|------------------|
| `single-large-file` | Read 602-line file, summarize exports | ~82% |
| `multi-file-cross-read` | Read 3 files, answer cross-cutting question | ~94% |
| `source-plus-test` | Read source + test pair | ~94% |
| `code-generation` | Generate tests from reference | High (output tokens) |

**Requires:** `pi` available in PATH.  
**Runtime:** ~30-60 seconds depending on worker model latency.

## Fixtures

Test fixtures in `tests/fixtures/`:

- `websocket-handler.ts` (47KB, 602 lines) – Large file for read benchmarks
- `user-service.ts` (1KB) – Service implementation
- `order-service.test.ts` (1.6KB) – Reference test file for code generation

## CI/CD

For CI environments:

```bash
# Fast check (unit tests only)
npm run test:unit

# Full validation (needs pi installed in CI)
npm test

# With benchmarks (optional, slow)
bash tests/run.sh --benchmark
```

## Interpreting Results

### Unit Tests
All should pass. Failures indicate logic bugs.

### Integration Tests
- **Failures:** Worker model unavailable, pi not installed, or API changes
- **Slow (>30s per test):** Normal for cold starts or slow models

### Benchmarks
- **Savings <50%:** Check worker model (should be cheap, e.g. Gemini Flash)
- **Savings >95%:** Excellent compression from the worker
- **Average ~90%:** Matches Spotify's reported benchmark

**Observed baseline** (first runs, `mlplatform/qwen3.8-125b`): single-file 96.8%, multi-file 97.0%, source+test 38-70%, code-gen 41% (after the write-instructions fix). Large-file reads consistently land 96-97%; the short-pair cases vary run to run because the worker's answer verbosity swings (±200 tokens), which dominates on small inputs.

## Troubleshooting

### `pi` not found

Integration tests and benchmarks need `pi` in PATH:

```bash
which pi
# If not found:
npm install -g @earendil-works/pi-coding-agent
```

### Worker returns no text

Check `SHUNT_WORKER_MODEL` is valid:

```bash
pi --list-models | grep -i flash
```

### Tests timeout

Increase Node.js timeout for slow workers:

```bash
node --test --test-timeout=60000 tests/integration.test.ts
```
