---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Dispatching Parallel Agents with tmux

## Overview

You delegate tasks to specialized agents with isolated context using **tmux** for robust parallel execution. tmux provides clean process isolation, real-time monitoring, and reliable communication between agents.

**Why tmux?**
- Complete context isolation per agent (no pollution between sessions)
- Real-time visibility into each agent's progress
- Detached/reattach capability - agents keep running even if you disconnect
- Clean process management - no zombie processes or orphaned shells
- Can switch between agent views with `Ctrl+b, 0-9` or `select-window`

## Quick Start

```bash
# Create a new tmux session with multiple windows for parallel agents
tmux new-session -d -s agents -n "agent-1" "pi 'Fix bug in auth module'"
tmux split-window -h -t agents:agent-1 "pi 'Fix bug in payment module'"
tmux split-window -v -t agents:agent-1 "pi 'Fix bug in notifications module'"

# Watch all agents work
tmux attach-session -t agents

# Or layout them in a grid
tmux select-layout -t agents tiled

# Detach and come back later: Ctrl+b, d
# Reattach: tmux attach -t agents
```

## When to Use

**Use when:**
- 3+ test files failing with different root causes
- Multiple subsystems broken independently
- Each problem can be understood without context from others
- No shared state between investigations
- Want to monitor progress in real-time

**Don't use when:**
- Failures are related (fix one might fix others)
- Need to understand full system state
- Agents would interfere with each other

## The Pattern

### 1. Identify Independent Domains

Group failures by what's broken:
- File A tests: Tool approval flow
- File B tests: Batch completion behavior
- File C tests: Abort functionality

### 2. Create Focused Agent Tasks

Each agent gets:
- **Specific scope:** One test file or subsystem
- **Clear goal:** Make these tests pass
- **Constraints:** Don't change other code
- **Expected output:** Summary of what you found and fixed

### 3. Launch with tmux

```bash
# Method A: Named windows (recommended for monitoring)
tmux new-session -d -s fix-session -n "auth-fix" "pi 'Fix auth failures in test/auth.test.ts'"
tmux new-window -t fix-session -n "payment-fix" "pi 'Fix payment in test/payment.test.ts'"
tmux new-window -t fix-session -n "core-fix" "pi 'Fix core in test/core.test.ts'"

# Attach to watch all
tmux attach -t fix-session
# Navigate: Ctrl+b, n (next) or Ctrl+b, 0-9 (direct)

# Method B: Detached with output logging
tmux new-session -d -s agents "pi 'task description'" \; pipe-pane -t agents:0 "cat > /tmp/agent-1.log"
tmux new-session -d -s agents2 "pi 'task description'" \; pipe-pane -t agents2:0 "cat > /tmp/agent-2.log"

# Method C: Horizontal split layout
tmux new-session -d -s parallel "pi 'pi-agent-1'" \; split-window -h "pi 'pi-agent-2'" \; split-window -v "pi 'pi-agent-3'"
tmux attach -t parallel
```

### 4. Monitor Progress

```bash
# List all agent sessions
tmux list-sessions

# Capture output from a session
tmux capture-pane -t session:window -p > output.txt

# Send command to running session
tmux send-keys -t session:window "status" Enter

# Check if agent is still running
tmux list-panes -t session:window
```

### 5. Review and Integrate

When agents complete:
```bash
# Capture final output from each
tmux capture-pane -t session:0 -p > agent-1-result.txt
tmux capture-pane -t session:1 -p > agent-2-result.txt

# Kill session when done
tmux kill-session -t session
```

## Agent Prompt Structure

Good agent prompts are:
1. **Focused** - One clear problem domain
2. **Self-contained** - All context needed to understand the problem
3. **Specific about output** - What should the agent return?

```markdown
Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1. "should abort tool with partial output capture" - expects 'interrupted at' in message
2. "should handle mixed completed and aborted tools" - fast tool aborted instead of completed
3. "should properly track pendingToolCount" - expects 3 results but gets 0

These are timing/race condition issues. Your task:

1. Read the test file and understand what each test verifies
2. Identify root cause - timing issues or actual bugs?
3. Fix by:
   - Replacing arbitrary timeouts with event-based waiting
   - Fixing bugs in abort implementation if found
   - Adjusting test expectations if testing changed behavior

Do NOT just increase timeouts - find the real issue.

Return: Summary of what you found and what you fixed.
```

## Common Mistakes

**❌ Background processes (`&`):** Can orphan, hard to monitor
**✅ tmux sessions:** Clean, observable, reliable

**❌ Too broad:** "Fix all the tests" - agent gets lost
**✅ Specific:** "Fix agent-tool-abort.test.ts" - focused scope

**❌ No context:** "Fix the race condition" - agent doesn't know where
**✅ Context:** Paste the error messages and test names

**❌ No constraints:** Agent might refactor everything
**✅ Constraints:** "Do NOT change production code" or "Fix tests only"

**❌ Vague output:** "Fix it" - you don't know what changed
**✅ Specific:** "Return summary of root cause and changes"

## tmux Cheat Sheet

| Action | Command |
|--------|---------|
| Create session | `tmux new -s name` |
| Detach | `Ctrl+b, d` |
| Reattach | `tmux attach -t name` |
| Split horizontal | `Ctrl+b, "` |
| Split vertical | `Ctrl+b, %` |
| Next window | `Ctrl+b, n` |
| Previous window | `Ctrl+b, p` |
| Go to window 0-9 | `Ctrl+b, 0-9` |
| List sessions | `tmux ls` |
| Kill session | `tmux kill-session -t name` |
| Kill all | `tmux kill-server` |
| Send keys | `tmux send-keys -t s:w "cmd" Enter` |
| Capture pane | `tmux capture-pane -t s:w -p` |
| Select layout | `tmux select-layout tiled` |

## When NOT to Use

**Related failures:** Fixing one might fix others - investigate together first
**Need full context:** Understanding requires seeing entire system
**Exploratory debugging:** You don't know what's broken yet
**Shared state:** Agents would interfere (editing same files, using same resources)

## Real-World Impact

Using tmux instead of background processes:
- **Reliability:** Agents don't die on disconnect
- **Visibility:** Watch all agents in real-time
- **Control:** Send commands, capture output, kill if needed
- **Isolation:** Each agent has pristine shell environment

## Key Benefits

1. **Parallelization** - Multiple investigations happen simultaneously
2. **Focus** - Each agent has narrow scope, less context to track
3. **Independence** - Agents don't interfere with each other
4. **Speed** - 3 problems solved in time of 1
5. **Robustness** - tmux handles disconnections gracefully
