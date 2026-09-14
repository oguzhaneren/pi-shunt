# Contributing to Pi-Shunt

Thanks for your interest in contributing to pi-shunt!

## Development Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   cd extensions
   npm install
   ```
3. Test locally:
   ```bash
   pi -e ./extensions/index.ts
   ```

## Project Structure

- `extensions/` – Pi extension source code
  - `index.ts` – Main entry point, registers hooks and tools
  - `lib/` – Core logic (config, worker delegation, utilities)
  - `tools/` – Tool implementations (shunt_read, etc.)
- `shunt/` – Original Claude Code plugin (reference only)

## Coding Standards

- **Simple over clever** – This project follows the "ponytail" philosophy: laziest solution that works
- TypeScript strict mode
- No external dependencies unless absolutely necessary
- Prefer standard library over npm packages

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Add tests if applicable
4. Update documentation (README.md, inline comments)
5. Submit PR with clear description

## Testing

```bash
# Manual testing
pi -e ./extensions/index.ts

# Test with large files
pi -e ./extensions/index.ts
# Then in pi session:
# Try reading a large file (>350 lines)
# Verify hook blocks it
# Try shunt_read tool
```

Automated tests coming soon.

## Areas for Contribution

### High Priority
- [ ] Automated tests (hook interception, worker delegation)
- [ ] Benchmark suite (measure actual token savings)
- [ ] Error handling improvements
- [ ] Better worker output parsing

### Future Features
- [ ] Code generation tool (shunt_write)
- [ ] Streaming responses for large files
- [ ] Caching layer for repeated reads
- [ ] Custom worker instructions per file type
- [ ] Usage analytics dashboard

### Documentation
- [ ] Video walkthrough
- [ ] More examples
- [ ] Troubleshooting guide expansion
- [ ] Migration guide from Claude Code shunt

## Reporting Bugs

Open an issue with:
- Pi version (`pi --version`)
- Extension version (from `package.json`)
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs/errors

## Questions?

Open a discussion or issue on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
