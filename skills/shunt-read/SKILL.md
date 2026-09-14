---
name: shunt-read
description: Delegate bulk file reading to a cheaper worker model. Use when you need to read files over 350 lines, answer questions across 3+ files, or summarize large diffs without loading content into the main context.
---

# Shunt Read

Use the `shunt_read` tool:

```
shunt_read question="<specific question>" paths=["<file1>", "<file2>", ...]
```

- Ask specific questions – the worker returns structured summaries, not raw content
- Each call is independent. To ask a follow-up, call again with the same paths – the corpus goes to the worker, never into your context, so re-sending costs you nothing
- Verify specific line numbers or exact values before using them in edits (the worker summarizes; it does not return exact content)
- If `shunt_read` reports it is disabled, enable it with `/shunt:toggle:read`
