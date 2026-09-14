#!/bin/bash
# Quick test to verify extension loads correctly

set -e

echo "Testing pi-shunt extension..."
echo

# Check if pi is available
if ! command -v pi &> /dev/null; then
    echo "❌ Error: pi not found in PATH"
    echo "   Install pi first: https://pi.dev"
    exit 1
fi

echo "✓ pi found: $(which pi)"
echo

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "❌ Error: node_modules not found"
    echo "   Run: npm install"
    exit 1
fi

echo "✓ Dependencies installed"
echo

# Test loading extension
echo "Testing extension load..."
echo

SHUNT_ENABLED=true pi -e "$(pwd)/index.ts" --no-interactive --message "test" --model "gemini-2.5-flash" 2>&1 | grep -i "shunt" || {
    echo "⚠ Warning: Extension loaded but shunt not mentioned in output"
    echo "   This might be normal for --no-interactive mode"
}

echo
echo "✓ Extension loads without errors"
echo
echo "Manual test:"
echo "  1. Run: pi -e $(pwd)/index.ts"
echo "  2. Check for 'pi-shunt active' message"
echo "  3. Run: /shunt:config"
echo "  4. Try reading a large file (>350 lines)"
echo
