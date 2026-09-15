# Pi-Shunt Quick Start

Get up and running in 2 minutes.

## Prerequisites

- [pi](https://pi.dev) installed and working
- Node.js 20+ (git install only; npm install handles dependencies)
- A model provider configured (Gemini, OpenAI, etc.)

## Installation

### Via npm (recommended)

```bash
pi install npm:@oguzhaneren/pi-shunt
```

### From git (for development)

```bash
# Clone to pi's global extensions directory
git clone https://github.com/oguzhaneren/pi-shunt.git ~/.pi/agent/extensions/pi-shunt

# Install dependencies
cd ~/.pi/agent/extensions/pi-shunt
npm install
```

## Verify Installation

```bash
# Quick test
cd ~/.pi/agent/extensions/pi-shunt
./extensions/test-load.sh
```

Or manually:

```bash
pi -e ~/.pi/agent/extensions/pi-shunt/extensions/index.ts
```

You should see: `pi-shunt active (threshold: 350 lines, worker: gemini-2.5-flash)`

## First Use

1. **Start pi**
   ```bash
   pi
   ```

2. **Check configuration**
   ```
   /shunt:config
   ```

3. **Try reading a large file**
   
   Create a test file:
   ```bash
   for i in {1..400}; do echo "// Line $i" >> test-large.js; done
   ```
   
   In pi session:
   ```
   You: Read test-large.js and tell me what it does
   ```
   
   You should see:
   ```
   [Shunt blocks: File is 400 lines, use shunt_read instead]
   ```

4. **Use the shunt_read tool**
   ```
   You: Use shunt_read to analyze test-large.js
   ```
   
   Worker will analyze and return a summary with token savings reported.

## Configuration (Optional)

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project):

```json
{
  "env": {
    "SHUNT_MIN_LINES": "350",
    "SHUNT_WORKER_MODEL": "gemini-2.5-flash"
  }
}
```

For npm installs, the extension is auto-loaded. For git installs, add:

```json
{
  "extensions": ["~/.pi/agent/extensions/pi-shunt"]
}
```

Restart pi to apply changes.

## Common Commands

```bash
/shunt:config     # Show configuration
/shunt:toggle     # Enable/disable temporarily
```

## Real Example

```
You: Analyze these three service files and explain how they work together

Pi: I'll use shunt_read to analyze them efficiently
    Calling shunt_read:
      question: "How do UserService, OrderService, and PaymentService work together?"
      paths: ["src/UserService.java", "src/OrderService.java", "src/PaymentService.java"]

[Worker analyzes ~3000 lines]
[Returns structured summary]

[shunt: ~12,000 input tokens → 450 output tokens | 3 files analyzed]

Pi: Based on the analysis, these services form a transaction pipeline:
    - UserService handles authentication and user data
    - OrderService coordinates order placement
    - PaymentService processes payments
    [detailed explanation follows]
```

## Next Steps

- Read [Extension Documentation](./extensions/README.md) for full features
- Check [Usage Examples](./extensions/examples/USAGE.md) for patterns
- Configure threshold and worker model to your needs
- Report issues on GitHub

## Troubleshooting

### Extension doesn't load
```bash
# Check pi version (needs 0.85.1+)
pi --version

# Check dependencies
cd ~/.pi/agent/extensions/pi-shunt/extension
npm install
```

### Shunt not blocking reads
```bash
# Verify it's enabled
# In pi session:
/shunt:config

# If disabled, toggle:
/shunt:toggle
```

### Worker fails
```bash
# Test worker model directly
pi --model gemini-2.5-flash --message "test"

# If that fails, configure a different model:
# In ~/.pi/agent/settings.json:
{
  "env": {
    "SHUNT_WORKER_MODEL": "gemini-2.0-flash"
  }
}
```

## Support

- [Full Documentation](./extensions/README.md)
- [GitHub Issues](https://github.com/oguzhaneren/pi-shunt/issues)
- [Examples](./extensions/examples/USAGE.md)
