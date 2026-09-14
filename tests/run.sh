#!/bin/bash
# Pi-Shunt Test Suite
# Runs unit tests, integration tests, and optional benchmarks

set -e
cd "$(dirname "$0")/.."

echo "Pi-Shunt Test Suite"
echo "==================="
echo

# Check pi is available
if ! command -v pi &>/dev/null; then
  echo "⚠️  Warning: pi not found in PATH. Integration tests and benchmarks will fail."
  echo "   Install pi or skip them with: $0 --unit-only"
  echo
fi

# Parse args
RUN_UNIT=1
RUN_INTEGRATION=1
RUN_BENCHMARK=0

for arg in "$@"; do
  case "$arg" in
    --unit-only)
      RUN_INTEGRATION=0
      RUN_BENCHMARK=0
      ;;
    --benchmark)
      RUN_BENCHMARK=1
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo
      echo "Options:"
      echo "  --unit-only    Run only unit tests (no pi subprocess needed)"
      echo "  --benchmark    Also run token savings benchmarks (slow)"
      echo "  --help         Show this help"
      exit 0
      ;;
  esac
done

# Unit tests
if [ $RUN_UNIT -eq 1 ]; then
  echo "1. Unit Tests"
  echo "-------------"
  node --test tests/unit.test.ts
  echo
fi

# Integration tests
if [ $RUN_INTEGRATION -eq 1 ]; then
  echo "2. Integration Tests"
  echo "--------------------"
  node --test tests/integration.test.ts
  echo
fi

# Benchmarks
if [ $RUN_BENCHMARK -eq 1 ]; then
  echo "3. Token Savings Benchmarks"
  echo "---------------------------"
  node tests/benchmark.ts
  echo
fi

echo "✅ All tests passed"
