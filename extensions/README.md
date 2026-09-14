# pi-shunt

Token optimization extension for [pi](https://pi.dev) – routes I/O-heavy operations to cheaper worker models.

**Token savings: 82-94% on large file reads** (~90% average)

## What It Does

Pi-shunt intercepts large file reads and delegates them to a cheaper worker model (Gemini Flash by default), returning structured summaries instead of loading full files into the expensive frontier model's context.

It also delegates boilerplate code generation (tests, stubs, config, docs) to the worker, writing the generated code directly to disk so the frontier model never pays for the output tokens.

### Before (without shunt)
```
User asks: "What does this service do?"
Pi reads: src/Service.java (4,014 lines)
Cost: 33,684 tokens
```

### After (with shunt)
```
User asks: "What does this service do?"
Shunt blocks: "File is 4,014 lines, use shunt_read"
Pi calls: shunt_read --question "What does this service do?" --paths src/Service.java
Worker analyzes: File → Structured summary
Cost: 5,737 tokens (82% savings)
```

## How It Works

Three layers, from hard enforcement to soft guidance:

1. **Hooks** – Intercept Read and Bash tool calls, block large file reads
2. **Tools** – `shunt_read` delegates file analysis, `shunt_write` delegates code generation
3. **Worker** – Fresh pi process with Gemini Flash analyzes files and generates code

When pi tries to read a file >350 lines (configurable), shunt blocks it and suggests using `shunt_read` instead. Pi then calls that tool, which spawns a worker pi process to analyze the files and return a structured summary.

## Installation

### Option 1: Global (all projects)

```bash
# Clone to pi extensions directory
git clone https://github.com/oguzhaneren/pi-shunt.git ~/.pi/agent/extensions/pi-shunt

# Install dependencies
cd ~/.pi/agent/extensions/pi-shunt
npm install
```

### Option 2: Project-local

```bash
# In your project
git clone https://github.com/oguzhaneren/pi-shunt.git .pi/extensions/pi-shunt
cd .pi/extensions/pi-shunt
npm install
```

### Option 3: Via npm (coming soon)

```bash
pi install npm:pi-shunt
```

## Configuration

All settings use the `SHUNT_*` environment variables. pi-shunt resolves them from **four sources, highest priority first**:

1. Real environment variables (export in your shell profile)
2. `.pi/settings.json` (project) `env` block
3. `~/.pi/agent/settings.json` (global) `env` block
4. Built-in defaults

Example `~/.pi/agent/settings.json`:

```json
{
  "env": {
    "SHUNT_ENABLED": "true",
    "SHUNT_MIN_LINES": "350",
    "SHUNT_WORKER_MODEL": "gemini-2.5-flash",
    "SHUNT_WORKER_TEMPERATURE": "0.2"
  }
}
```

> **Note:** pi 0.85.x does **not** apply the settings.json `env` block to its own process (the `Settings` interface has no `env` field), so pi-shunt reads those files directly. Restart pi (or `/reload`) after editing settings.json. If a `SHUNT_*` var is exported in your shell, the extension sees it via `process.env` and it overrides settings.json.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SHUNT_ENABLED` | `true` | Enable/disable extension |
| `SHUNT_MIN_LINES` | `350` | Line count above which reads are blocked |
| `SHUNT_MAX_PAYLOAD_BYTES` | `400000` | Maximum request size |
| `SHUNT_WORKER_MODEL` | `gemini-2.5-flash` | Model to use for analysis |
| `SHUNT_WORKER_TEMPERATURE` | `0.2` | Temperature for worker model |
| `SHUNT_WORKER_INSTRUCTIONS` | _(default)_ | Custom system prompt for worker |
| `SHUNT_READ_ENABLED` | `true` | Enable/disable read interception + `shunt_read` |
| `SHUNT_WRITE_ENABLED` | `true` | Enable/disable `shunt_write` |
| `SHUNT_WRITE_INSTRUCTIONS` | _(default)_ | Custom system prompt for the write worker |
| `SHUNT_CYCLE_KEY` | `ctrl+alt+s` | Keybinding for the cycle shortcut (`modifier+key`, e.g. `ctrl+shift+s`) |

Set them wherever you like: your shell profile, or the `env` block of global or project settings.json (see above).

## Usage

### Automatic (recommended)

Just use pi normally. When it tries to read a large file, shunt intercepts:

```
You: "Explain how this service works"
Pi: I'll read the service file...
[Shunt blocks read]
Pi: I'll use shunt_read instead
[Worker analyzes file]
Pi: Based on the analysis, this service...
```

### Manual

Call `shunt_read` directly:

```
You: /shunt_read --question "What does this service do?" --paths src/Service.java
```

### Follow-up questions

Each call is independent. Ask again with the same files:

```
You: /shunt_read --question "Which methods call the database?" --paths src/Service.java
```

Re-sending files is free where it matters – they go to the worker, not the frontier model.

### Code generation (shunt_write)

For boilerplate that is predictable from existing patterns, `shunt_write` generates the code with the worker and writes it directly to a file. The generated code never enters the frontier model's context – only a summary comes back.

```
Pi: I'll write tests for UserService following the existing patterns
Pi calls: shunt_write spec="Write unit tests for UserService..." reference=tests/OrderTest.ts target=tests/UserService.test.ts
Worker generates: code matching OrderTest.ts patterns
Wrote 140 lines to tests/UserService.test.ts   [shunt_write: ... tokens]
```

Best fits: tests, mocks, fixtures, config stubs, type stubs, docstrings. `reference` is required – context-free generation fits nothing in your project. For follow-up calls, pass the file the previous call just generated as the `reference`. After writing, review the file and make surgical edits for the ~5-20% that needs judgment.

Do not use it for editing existing logic or architecture decisions – those need exact content in the frontier model's context.

## Commands

- `/shunt:config` – Show current configuration
- `/shunt:toggle` – Enable/disable **all** shunt behavior for this session (hooks + tools)
- `/shunt:toggle:read` – Enable/disable read interception + `shunt_read` only
- `/shunt:toggle:write` – Enable/disable `shunt_write` only
- `/shunt:stats` – Show session statistics
- `/shunt:stats:reset` – Reset session statistics

When a tool is disabled, calling it returns a clear "disabled" message instead of delegating to the worker. With the master toggle off, both tools refuse and the hooks let all reads pass through.

## What Doesn't Get Delegated

Shunt knows when NOT to delegate:

- **Targeted reads** – `read` with offset/limit (pi already knows what it needs)
- **Small files** – Under threshold (delegation overhead > savings)
- **Nonexistent files** – Let `read` handle the error
- **Piped commands** – `cat file | grep` (targeted read)
- **Redirections** – `cat file > out` (not reading into context)

For editing, pi still needs to read the exact content. Shunt allows targeted reads (with offset/limit) to pass through for this reason.

## Examples

### Single large file

```
/shunt_read --question "What does SpotifyUri.java do?" --paths src/main/java/SpotifyUri.java
```

- Without shunt: 33,684 tokens
- With shunt: 5,737 tokens
- **82% savings**

### Source + test pair

```
/shunt_read --question "How do these work together?" --paths src/PromotionRuleRepository.java tests/PromotionRuleRepositoryTest.java
```

- Without shunt: 75,990 tokens
- With shunt: 4,148 tokens
- **94% savings**

### Multi-file analysis

```
/shunt_read --question "How is permission checking implemented across these handlers?" --paths src/handlers/*.java
```

- Without shunt: 16,221 tokens
- With shunt: 821 tokens
- **94% savings**

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Main Pi Session (Frontier Model)                        │
│                                                          │
│  User: "What does Service.java do?"                     │
│  ↓                                                       │
│  Pi attempts: read(Service.java)                        │
│  ↓                                                       │
│  Shunt intercepts: "File too large, use shunt_read"    │
│  ↓                                                       │
│  Pi calls: shunt_read(question, paths)                 │
│  ↓                                                       │
│  ┌─────────────────────────────────────────┐           │
│  │ Worker Pi Subprocess (Gemini Flash)     │           │
│  │                                          │           │
│  │  Receives: <file>...</file> + question  │           │
│  │  Analyzes: Code structure, patterns     │           │
│  │  Returns: Structured summary            │           │
│  └─────────────────────────────────────────┘           │
│  ↓                                                       │
│  Pi receives summary (not full file)                   │
│  ↓                                                       │
│  Pi responds: "This service..."                        │
└─────────────────────────────────────────────────────────┘
```

## Benchmarks

Tested against a 162K-line Java monorepo:

| Scenario | Lines | Without Shunt | With Shunt | Savings |
|----------|-------|---------------|------------|---------|
| Single file (SpotifyUri.java) | 4,014 | 33,684 tokens | 5,737 tokens | 82% |
| Source + test pair | 7,408 | 75,990 tokens | 4,148 tokens | 94% |
| Multi-file (3 handlers) | 1,281 | 16,221 tokens | 821 tokens | 94% |

**Mean savings: 90%**

## Limitations

### Can't delegate editing

Worker summaries don't include reliable line numbers. If pi needs to make edits, it has to read the specific section directly. Shunt allows targeted reads (with offset/limit) for this reason.

### Can't delegate reasoning

Worker models find surface patterns but can miss subtle bugs. Frontier models are better at architecture decisions, debugging, and safety-critical analysis.

### Latency

Each delegation spawns a pi subprocess: 10-30 seconds typical. Acceptable for large reads, counterproductive for small ones (hence the threshold).

### Payload size limits

Request must fit in memory. Default max: 400KB. Split large batches if needed.

## Development

### Project Structure

```
extensions/
├── index.ts              # Main entry point
├── package.json          # Dependencies and metadata
├── lib/
│   ├── config.ts         # Configuration management
│   ├── utils.ts          # File utilities
│   └── worker.ts         # Worker delegation logic
├── tools/
│   └── shunt-read.ts     # Bulk read tool
└── README.md             # This file
```

### Local Development

```bash
# Install dependencies
npm install

# Test in pi
pi -e ./extensions/index.ts

# Or symlink to extensions directory
ln -s $(pwd)/extension ~/.pi/agent/extensions/pi-shunt
```

### Running Tests

```bash
# All tests (unit + integration)
npm test

# Unit tests only (no pi subprocess)
npm run test:unit

# Integration tests (needs pi)
npm run test:integration

# Token savings benchmarks
npm run test:benchmark
```

See [`tests/README.md`](../tests/README.md) for details.

## Troubleshooting

### "Failed to spawn pi"

Ensure `pi` is in your PATH:

```bash
which pi
```

If not found, add to your PATH or set `PI_BIN` environment variable:

```json
{
  "env": {
    "PI_BIN": "/path/to/pi"
  }
}
```

### Worker returns empty/wrong answers

Check worker model availability:

```bash
pi --model gemini-2.5-flash --message "test"
```

Try a different worker model:

```json
{
  "env": {
    "SHUNT_WORKER_MODEL": "gemini-2.0-flash"
  }
}
```

### File not found errors

Paths are resolved from pi's working directory. Use absolute paths or relative to cwd:

```
/shunt_read --question "..." --paths ./src/Service.java
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

MIT

## Credits

Inspired by Spotify's [shunt plugin](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt) for Claude Code. Ported to pi with love.

## Links

- [Pi Documentation](https://pi.dev/docs)
- [Original Spotify Blog Post](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90)
- [GitHub Repository](https://github.com/oguzhaneren/pi-shunt)
- [Report Issues](https://github.com/oguzhaneren/pi-shunt/issues)
