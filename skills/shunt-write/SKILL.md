---
name: shunt-write
description: Delegate boilerplate code generation to a cheaper worker model. Use for tests, mocks, fixtures, config, docstrings, type stubs, or any generation where over 80% is predictable from reference files.
---

# Shunt Write

Use the `shunt_write` tool:

```
shunt_write spec="<what to generate>" reference="<reference-file>" target="<output-path>"
```

- `reference` is required – pass a file whose patterns, conventions, and style the output must match. Context-free generation fits nothing in the project
- Each call is independent. To build on what was just generated, pass that file as the `reference` for the next call
- The code is written directly to `target`; only a summary comes back. Review the generated file and make surgical edits for the ~5-20% that needs judgment
- Do not use for editing existing logic or architectural decisions – those need exact content in the main context
- If `shunt_write` reports it is disabled, enable it with `/shunt:toggle:write`
