# Pi-Shunt

**Cut your pi token usage by ~90% on large file reads**

Port of Spotify's [shunt plugin](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt) from Claude Code to [pi](https://pi.dev).

## Quick Start

```bash
# Install globally
git clone https://github.com/oguzhaneren/pi-shunt.git ~/.pi/agent/extensions/pi-shunt
cd ~/.pi/agent/extensions/pi-shunt
npm install

# Start pi
pi
```

That's it! Shunt automatically intercepts large file reads and routes them to Gemini Flash.

## What It Does

- Intercepts `read` tool calls on files >350 lines
- Intercepts `bash` cat/head/tail on large files
- Delegates to Gemini Flash (or your chosen worker model)
- Returns structured summaries instead of full file content
- **Saves 82-94% of tokens** on large file operations

## Documentation

- [Extension Documentation](./extensions/README.md) – Full usage guide
- [Implementation Plan](./IMPLEMENTATION_PLAN.md) – Architecture details
- [Original Blog Post](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90) – Spotify's approach

## Example

**Before (without shunt):**
```
User: "What does Service.java do?"
Pi reads: 4,014 lines → 33,684 tokens
```

**After (with shunt):**
```
User: "What does Service.java do?"
Shunt: Blocks read, suggests shunt_read
Pi calls: shunt_read with question
Worker: Analyzes → returns summary (5,737 tokens)
Savings: 82%
```

## Configuration

Add to `~/.pi/agent/settings.json`:

```json
{
  "env": {
    "SHUNT_MIN_LINES": "350",
    "SHUNT_WORKER_MODEL": "gemini-2.5-flash"
  }
}
```

See [Configuration](./extensions/README.md#configuration) for all options.

## Project Structure

```
pi-shunt/
├── extensions/              # Pi extension source code
│   ├── index.ts           # Main entry point
│   ├── package.json       # Extension dependencies
│   ├── lib/               # Core logic
│   ├── tools/             # Shunt tools
│   └── README.md          # Extension documentation
├── shunt/                 # Original Claude Code plugin (reference)
└── README.md              # This file
```

## Development

```bash
# Install dependencies
cd extension
npm install

# Test locally
pi -e ./extensions/index.ts

# Or symlink
ln -s $(pwd)/extension ~/.pi/agent/extensions/pi-shunt
```

## License

MIT

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Credits

- Original shunt concept: [Spotify](https://github.com/spotify/portal-ai-plugins)
- Blog post: [Portal by Spotify: Cut My Claude Code Token Usage by 90%](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90)

## Links

- [Pi Documentation](https://pi.dev/docs)
- [Pi Extensions Guide](https://pi.dev/docs/extensions)
- [GitHub Repository](https://github.com/oguzhaneren/pi-shunt)
- [Report Issues](https://github.com/oguzhaneren/pi-shunt/issues)
