# Pi-Shunt Usage Examples

## Basic Usage

### Automatic Interception

Just use pi normally. Shunt intercepts large file reads automatically:

```
You: Explain how the UserService works

Pi: I'll read UserService.java...
[Shunt intercepts - file is 850 lines]

Pi: I'll use shunt_read to analyze this efficiently
Calling: shunt_read
  question: "What does UserService.java do and how is it structured?"
  paths: ["src/main/java/UserService.java"]

[Worker analyzes file]

Pi: Based on the analysis, UserService is a Spring service that...
```

### Manual Tool Call

Call `shunt_read` directly:

```
You: Use shunt_read to analyze UserService.java and OrderService.java together, focusing on how they interact

Pi: Calling shunt_read...
```

## Common Patterns

### Single File Analysis

```
Question: What does this file do?
Files: src/Service.java (4,014 lines)

/shunt_read --question "What does this service do?" --paths src/Service.java

Result: Structured summary with:
- Main responsibilities
- Key methods
- Dependencies
- Design patterns used

Savings: 33,684 → 5,737 tokens (82%)
```

### Source + Test Analysis

```
Question: How do the implementation and tests work together?
Files: 
- src/PromotionRuleRepository.java
- tests/PromotionRuleRepositoryTest.java

/shunt_read --question "Explain the implementation and test coverage" --paths src/PromotionRuleRepository.java tests/PromotionRuleRepositoryTest.java

Result: Summary covering:
- Repository responsibilities
- Test coverage areas
- Tested edge cases
- Missing test scenarios

Savings: 75,990 → 4,148 tokens (94%)
```

### Multi-File Cross-Cutting Analysis

```
Question: How is error handling implemented across these components?
Files: Multiple handler files

/shunt_read --question "Analyze the error handling patterns across these handlers" --paths src/handlers/*.java

Result: Analysis of:
- Common error handling approaches
- Differences between handlers
- Missing error cases
- Recommended patterns

Savings: 16,221 → 821 tokens (94%)
```

### Follow-up Questions

Ask multiple questions about the same files:

```
# First question
/shunt_read --question "What does this service do?" --paths src/Service.java

# Follow-up (re-sends file to worker, not frontier model)
/shunt_read --question "Which methods handle database operations?" --paths src/Service.java

# Another follow-up
/shunt_read --question "What are the potential thread safety issues?" --paths src/Service.java
```

Each call is independent. Re-sending files is free where it matters – they go to the worker model, not your expensive frontier model.

## Advanced Patterns

### Preparing for Edits

1. Use shunt_read to understand the file
2. Ask pi to make specific edits
3. Pi uses targeted reads (with offset/limit) for exact content

```
You: First, use shunt_read to understand UserService.java's structure

Pi: [Calls shunt_read, gets summary]

You: Now add logging to the updateUser method

Pi: [Makes targeted read of just that method with offset/limit]
Pi: [Makes the edit]
```

### Comparing Implementations

```
/shunt_read --question "Compare the authentication approaches in these two services" --paths src/ServiceA.java src/ServiceB.java
```

### Finding Patterns

```
/shunt_read --question "Find all API endpoints and their HTTP methods" --paths src/controllers/*.java
```

### Understanding Large Config Files

```
/shunt_read --question "Explain the deployment configuration" --paths config/deployment.yaml
```

## Configuration Examples

These `env` blocks go in `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project). pi-shunt reads them directly (pi 0.85.x ignores the `env` block for its own process). Priority: shell env > project settings > global settings > defaults. Restart pi after editing.

### Conservative (higher threshold, larger batches)

```json
{
  "env": {
    "SHUNT_MIN_LINES": "500",
    "SHUNT_MAX_PAYLOAD_BYTES": "800000"
  }
}
```

Use when:
- You have a very large codebase
- Frontier model context is very expensive
- Files tend to be very long

### Aggressive (lower threshold, faster delegation)

```json
{
  "env": {
    "SHUNT_MIN_LINES": "200",
    "SHUNT_WORKER_MODEL": "gemini-2.5-flash"
  }
}
```

Use when:
- Token costs are a major concern
- Most analysis tasks are straightforward
- Worker model quality is sufficient

### Custom Worker Instructions

```json
{
  "env": {
    "SHUNT_WORKER_INSTRUCTIONS": "You are analyzing Python code. Focus on type hints, docstrings, and async patterns. Output as structured bullets with function names and line numbers."
  }
}
```

### Temporarily Disable

```
/shunt:toggle
```

Re-run to enable again. Or set `SHUNT_ENABLED=false` in settings.

## What NOT to Do

### ❌ Don't use shunt for debugging

```
# Bad - worker won't catch subtle bugs
/shunt_read --question "Why is this code causing a race condition?"

# Good - let frontier model reason about it
You: Read this file and find the race condition
Pi: [Reads directly with full context and reasoning]
```

### ❌ Don't use shunt for architecture decisions

```
# Bad - needs deep reasoning
/shunt_read --question "Should we refactor this to use microservices?"

# Good - discuss with frontier model
You: Review this service and suggest architectural improvements
```

### ❌ Don't use shunt when you need exact line numbers for edits

```
# Bad - worker summaries lack precise line numbers
/shunt_read --question "What's on line 342?"

# Good - targeted read
You: Read lines 340-350 of UserService.java
```

The hook allows targeted reads (with offset/limit) to pass through for exactly this reason.

## Tips

1. **Ask specific questions** – "What does this do?" vs "List all methods that call the database"
2. **Group related files** – Analyze source + test together for better context
3. **Use follow-ups** – Re-send files for new questions, it's free to the frontier model
4. **Disable for debugging** – Use `/shunt:toggle` when you need deep reasoning
5. **Check config** – Run `/shunt:config` to see current settings
6. **Monitor savings** – Watch the token counts in shunt_read responses

## Troubleshooting

### Shunt isn't blocking reads

Check if enabled:
```
/shunt:config
```

### Worker returns generic answers

Try more specific questions:
```
# Vague
--question "Explain this code"

# Specific  
--question "List all methods that handle user authentication and their responsibilities"
```

### File not found

Use paths relative to pi's working directory:
```
# If pi is in /project
--paths src/Service.java

# Or use absolute paths
--paths /full/path/to/Service.java
```

### Payload too large

Split into smaller batches:
```
# Instead of all files at once
--paths src/handlers/*.java

# Split them
--paths src/handlers/Auth*.java
--paths src/handlers/User*.java
```
