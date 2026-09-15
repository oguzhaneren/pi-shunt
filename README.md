# Pi-Shunt

**Cut your pi token usage by ~90% on large file reads and code generation**

Port of Spotify's [shunt plugin](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt) from Claude Code to [pi](https://pi.dev).

Token optimization extension that routes I/O-heavy operations to cheaper worker models – read delegation saves input tokens, write delegation saves output tokens.

---

## Quick Start

```bash
# Install from npm (recommended)
pi install npm:@oguzhaneren/pi-shunt

# Start pi – shunt is active immediately
pi
```

That's it! Shunt automatically intercepts large file reads and routes them to a cheaper worker model.

---

## What It Does

- **Intercepts** `read` tool calls on files >350 lines
- **Intercepts** `bash` cat/head/tail on large files  
- **Delegates** to Gemini Flash (or your chosen worker model)
- **Returns** structured summaries instead of full file content
- **Saves 82-97% of tokens** on large file reads
- **Delegates boilerplate code generation** (tests, stubs, config, docs) to the worker, writing directly to disk

### Before (without shunt)
```
User: "What does Service.java do?"
Pi reads: 4,014 lines → 33,684 tokens
```

### After (with shunt)
```
User: "What does Service.java do?"
Shunt blocks: "File is 4,014 lines, use shunt_read"
Pi calls: shunt_read --question "What does this service do?" --paths Service.java
Worker analyzes: File → Structured summary (5,737 tokens)
Savings: 82%
```

---

## How It Works

Three layers, from hard enforcement to soft guidance:

1. **Hooks** – Intercept Read and Bash tool calls, block large file reads
2. **Tools** – `shunt_read` delegates file analysis, `shunt_write` delegates code generation
3. **Worker** – Fresh pi subprocess with cheaper model analyzes files and generates code

When pi tries to read a file >350 lines (configurable), shunt blocks it and suggests using `shunt_read` instead. Pi then calls that tool, which spawns a worker pi process to analyze the files and return a structured summary.

### Architecture

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

**Code generation** follows the same pattern:

```
Pi calls: shunt_write(spec, reference, target)
↓
Worker Pi Subprocess (write mode)
  Receives: spec + reference file patterns
  Generates: code matching the reference
  Writes: directly to target file on disk
↓
Pi receives: "Wrote 140 lines to UserService.test.ts [shunt: ... tokens]"
(Generated code never enters the main model's context)
```

---

## Installation

### Option 1: Via npm (recommended)

```bash
pi install npm:@oguzhaneren/pi-shunt
```

Dependencies install automatically; updates arrive via `pi update`.

### Option 2: Global from git (all projects)

```bash
# Clone to pi extensions directory
git clone https://github.com/oguzhaneren/pi-shunt.git ~/.pi/agent/extensions/pi-shunt

# Install dependencies
cd ~/.pi/agent/extensions/pi-shunt
npm install
```

### Option 3: Project-local from git

```bash
# In your project
git clone https://github.com/oguzhaneren/pi-shunt.git .pi/extensions/pi-shunt
cd .pi/extensions/pi-shunt
npm install
```

---

## Configuration

All settings use `SHUNT_*` environment variables. Pi-shunt resolves them from **four sources, highest priority first**:

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

> **Note:** pi 0.85.x does **not** apply the settings.json `env` block to its own process, so pi-shunt reads those files directly. Restart pi (or `/reload`) after editing settings.json. If a `SHUNT_*` var is exported in your shell, the extension sees it via `process.env` and it overrides settings.json.

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
| `SHUNT_CYCLE_KEY` | `ctrl+alt+s` | Keybinding for the cycle shortcut |

---

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
/shunt_read --question "What does this service do?" --paths src/Service.java
```

### Follow-up questions

Each call is independent. Ask again with the same files:

```
/shunt_read --question "Which methods call the database?" --paths src/Service.java
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

**Best fits:** tests, mocks, fixtures, config stubs, type stubs, docstrings.

**Requirements:**
- `reference` is required – context-free generation fits nothing in your project
- For follow-up calls, pass the file the previous call just generated as the `reference`
- Review the file after writing and make surgical edits for the ~5-20% that needs judgment

**Do not use for:** editing existing logic or architecture decisions – those need exact content in the frontier model's context.

---

## Commands

| Command | Effect |
|---------|--------|
| `/shunt:config` | Show current configuration (toggles, cycle key, env vars) |
| `/shunt:toggle` | Enable/disable **all** shunt behavior (hooks + tools) |
| `/shunt:toggle:read` | Enable/disable read interception + `shunt_read` only |
| `/shunt:toggle:write` | Enable/disable `shunt_write` only |
| `/shunt:stats` | Show session statistics (reads intercepted, tokens saved, etc.) |
| `/shunt:stats:reset` | Reset session statistics |

When a tool is disabled, calling it returns a clear "disabled" message instead of delegating to the worker. With the master toggle off, both tools refuse and the hooks let all reads pass through.

All toggles report the resulting state, e.g. `/shunt:toggle:read` off while write is on reports `only write (read off, write on)`. Possible states: `all on`, `only read`, `only write`, `all off`.

### Cycle shortcut

`ctrl+alt+s` cycles through all four states: **all on → only read → only write → all off**. No reload needed – toggles apply to the next call. Rebind via `SHUNT_CYCLE_KEY`.

---

## What Doesn't Get Delegated

Shunt knows when **NOT** to delegate:

- **Targeted reads** – `read` with offset/limit (pi already knows what it needs)
- **Small files** – Under threshold (delegation overhead > savings)
- **Nonexistent files** – Let `read` handle the error
- **Piped commands** – `cat file | grep` (targeted read)
- **Redirections** – `cat file > out` (not reading into context)

For editing, pi still needs to read the exact content. Shunt allows targeted reads (with offset/limit) to pass through for this reason.

---

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

---

## Benchmarks

### This repo's test fixtures (worker: `qwen3.8-125b`)

| Scenario | Without Shunt | With Shunt | Savings |
|----------|---------------|------------|---------|
| Single large file (602 lines) | 12,006 tokens | 379 tokens | **96.8%** |
| Multi-file cross-read (3 files) | 12,687 tokens | 384 tokens | **97.0%** |
| Source + test pair | 681 tokens | 424 tokens | 38-70%* |
| Code generation | 681 tokens | 404 tokens | ~41%* |

Large file reads consistently save **96-97%**. The small-pair numbers swing run to run because worker answer verbosity dominates on tiny corpora.

*Run your own:* `npm run test:benchmark`

---

## Limitations

### Can't delegate editing

Worker summaries don't include reliable line numbers. If pi needs to make edits, it has to read the specific section directly. Shunt allows targeted reads (with offset/limit) for this reason.

### Can't delegate reasoning

Worker models find surface patterns but can miss subtle bugs. Frontier models are better at architecture decisions, debugging, and safety-critical analysis.

### Latency

Each delegation spawns a pi subprocess: 10-30 seconds typical. Acceptable for large reads, counterproductive for small ones (hence the threshold).

### Payload size limits

Request must fit in memory. Default max: 400KB. Split large batches if needed.

---

## Development

### Project Structure

```
pi-shunt/
├── extensions/              # Pi extension source code
│   ├── index.ts           # Main entry point (hooks, toggles, cycle)
│   ├── lib/               # Core logic (config, worker, stats, utils)
│   ├── tools/             # shunt_read + shunt_write tools
│   └── README.md          # Extension documentation
├── tests/                  # Unit tests, integration tests, benchmarks
│   ├── unit.test.ts       # Pure logic tests (no pi needed)
│   ├── integration.test.ts # Worker delegation tests (needs pi)
│   ├── benchmark.ts       # Token savings measurements
│   ├── fixtures/          # Test files (602-line websocket-handler, etc.)
│   └── README.md          # Test suite documentation
├── skills/                 # Pi skills (shunt-read, shunt-write)
├── shunt/                 # Original Claude Code plugin (reference)
└── README.md              # This file
```

### Local Development

```bash
# Install dependencies
npm install

# Typecheck + tests
npm run typecheck
npm test

# Test locally
pi -e ./extensions/index.ts

# Or symlink
ln -s $(pwd)/extensions ~/.pi/agent/extensions/pi-shunt
```

### Running Tests

```bash
# All tests (unit + integration, needs pi in PATH)
npm test

# Unit tests only (no pi needed)
npm run test:unit

# Integration tests (needs pi)
npm run test:integration

# Token savings benchmarks
npm run test:benchmark
```

See [`tests/README.md`](./tests/README.md) for details.

---

## Troubleshooting

### "Failed to spawn pi"

Ensure `pi` is in your PATH:

```bash
which pi
```

If not found, install it:

```bash
npm install -g @earendil-works/pi-coding-agent
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

**Thinking-only responses:** reasoning models sometimes answer with a thinking block and no text (the model has "decided to inspect the repo" but shunt workers run with `--no-tools`). The error now reports this explicitly, e.g. `Worker returned no text. Worker only reasoned: "..."`. Write-mode instructions include "you have no tools, always output code" to prevent it; a custom worker model may need a similar nudge – set `SHUNT_WRITE_INSTRUCTIONS` / `SHUNT_WORKER_INSTRUCTIONS`.

### File not found errors

Paths are resolved from pi's working directory. Use absolute paths or relative to cwd:

```
/shunt_read --question "..." --paths ./src/Service.java
```

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

MIT

---

## Credits

- Original shunt concept: [Spotify](https://github.com/spotify/portal-ai-plugins)
- Blog post: [Portal by Spotify: Cut My Claude Code Token Usage by 90%](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90)

---

## Links

- [Pi Documentation](https://pi.dev/docs)
- [Pi Extensions Guide](https://pi.dev/docs/extensions)
- [GitHub Repository](https://github.com/oguzhaneren/pi-shunt)
- [Report Issues](https://github.com/oguzhaneren/pi-shunt/issues)
