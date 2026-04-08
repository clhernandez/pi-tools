---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Dispatching Parallel Agents

Delegate independent tasks to specialized subagents running concurrently, using the native `subagent` extension built into pi.

**Why parallel:** Independent tasks don't need to be sequential. Run them simultaneously, get results faster, keep each agent focused on a narrow scope.

**Core principle:** Use the `subagent` extension's `tasks: [...]` mode for true parallel execution with live streaming, usage tracking, and abort support — no external tools needed.

## When to Use

**Use when:**
- 2+ tasks are clearly independent (different files, different subsystems)
- No task needs output from another to start
- No shared state between agents (no same-file edits)
- You want live progress from all agents simultaneously

**Don't use when:**
- Tasks share files (causes conflicts)
- Task B depends on Task A's output
- You need to understand full system state first
- You're still debugging (explore root cause first, then parallelize fixes)

## The Pattern

### 1. Assess Independence

Group tasks by file scope:
- Task A: `src/auth/` only → independent
- Task B: `src/payments/` only → independent
- Task C: `src/config.ts` (shared) → sequential dependency

### 2. Dispatch via Subagent Extension

```
# Parallel mode: tasks array, all run concurrently (max 4 at once, max 8 total)
subagent(tasks: [
  { agent: "worker", task: "Fix 3 failing tests in src/auth.test.ts: [paste test names + errors]" },
  { agent: "worker", task: "Fix 3 failing tests in src/payments.test.ts: [paste test names + errors]" },
  { agent: "worker", task: "Fix 3 failing tests in src/notifications.test.ts: [paste test names + errors]" }
])
```

Live output streams from all agents simultaneously. You see tool calls and progress as they happen.

### 3. Chain Mode for Sequential Pipelines

When tasks need to pass output forward, use `chain` mode with `{previous}` placeholder:

```
subagent(chain: [
  { agent: "scout",    task: "Find all authentication code and summarize" },
  { agent: "planner",  task: "Based on this recon: {previous} — create an implementation plan" },
  { agent: "worker",   task: "Execute this plan: {previous}" }
])
```

### 4. Single Agent for One Task

```
subagent(agent: "worker", task: "Fix the race condition in src/queue.ts")
```

## Writing Focused Agent Tasks

Good parallel tasks are:

1. **Scoped** — one file or subsystem, not "fix everything"
2. **Self-contained** — all context needed to understand the problem
3. **Specific about output** — what should the agent return?

```markdown
Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1. "should abort tool with partial output" - expects 'interrupted at' in message
2. "should handle mixed completed and aborted tools" - fast tool aborted instead of completed
3. "should properly track pendingToolCount" - expects 3 results but gets 0

These are timing/race condition issues. Your task:
1. Read the test file and understand what each test verifies
2. Identify root cause — timing or actual bugs?
3. Fix by replacing arbitrary timeouts with event-based waiting
4. Do NOT just increase timeouts

Return: Summary of root cause and what you fixed.
```

## Available Agents

Default agents from `~/.pi/agent/agents/`:

| Agent | Purpose | Tools |
|-------|---------|-------|
| `scout` | Fast codebase recon, returns compressed context | read, grep, find, ls, bash |
| `planner` | Creates implementation plans | read, grep, find, ls |
| `reviewer` | Code review (read-only) | read, grep, find, ls, bash |
| `worker` | General-purpose implementation | all default |

Project-local agents: `.pi/agents/*.md` (requires `agentScope: "project"` or `"both"`).

## Output and Streaming

**During execution (parallel):**
```
⏳ parallel 1/3 done, 2 running
  ─── worker ⏳ → edit src/auth.test.ts
  ─── worker ✓  Fixed 3 tests
  ─── worker ⏳ → read src/notifications.ts
```

**After completion:**
```
✓ parallel 3/3 tasks
  ─── worker ✓  Fixed timing issue in abort test
  ─── worker ✓  Fixed payment race condition
  ─── worker ✓  Fixed notification flush order
Total: 9 turns ↑3.6k ↓2.4k $0.0072
```

Press `Ctrl+O` to expand and see full output per agent.

## Concurrency Limits

- Max 4 agents run concurrently
- Max 8 tasks per batch
- Split larger batches: run first 8, then next 8

## When Tasks Share Files (Fallback: tmux)

If you need true parallel execution but tasks may touch shared files (e.g., debugging sessions where you're not sure of scope), use tmux sessions as a fallback to keep agents fully isolated with separate worktrees:

```bash
# Each agent in its own window, working from a separate git worktree
tmux new-session -d -s agents -n "auth-fix" "pi 'Fix auth in test/auth.test.ts'"
tmux new-window -t agents -n "payment-fix" "pi 'Fix payment in test/payment.test.ts'"
tmux attach -t agents
# Navigate: Ctrl+b n (next window), Ctrl+b 0-9 (direct)
```

**Prefer the subagent extension** over tmux unless you need worktree isolation.

## Common Mistakes

**❌ Parallel tasks that edit the same file** → merge conflicts, corrupted output
**✅ Verify file scope is disjoint before dispatching in parallel**

**❌ Too broad:** "Fix all the tests" → agent gets lost
**✅ Specific:** "Fix auth.test.ts" → focused scope

**❌ No context:** "Fix the race condition" → agent doesn't know where
**✅ Context:** Paste the error messages and test names

**❌ No constraints:** Agent might refactor everything
**✅ Constraints:** "Do NOT change production code" or "Fix tests only"

**❌ Vague output:** "Fix it" → you don't know what changed
**✅ Specific:** "Return summary of root cause and changes"
