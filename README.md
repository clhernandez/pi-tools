# Nacho's Pi Superpowers

A pi package with my personal toolkit: brainstorming workflows, systematic debugging, Rust review/perf, subagent-driven development, and more.

## Installation

```bash
pi install git:github.com/Nachompiras/pi-tools
```

Or try it without installing:

```bash
pi -e git:github.com/Nachompiras/pi-tools
```

To update:

```bash
pi update
```

## Dependencies

This package requires [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) for subagent-driven workflows:

```bash
pi install npm:@tintinweb/pi-subagents
```

## Custom Agent Setup

Several skills reference custom agent types (`worker`, `reviewer`, `planner`, `scout`). These are defined in the `agents/` directory and need to be copied to your global agents folder:

```bash
cp agents/*.md ~/.pi/agent/agents/
```

This makes the agents available in all your projects. You can also copy them to a specific project:

```bash
mkdir -p .pi/agents
cp agents/*.md .pi/agents/
```

| Agent | Purpose | Model |
|-------|---------|-------|
| `worker` | General-purpose implementation with full tools | inherits parent |
| `reviewer` | Code review, quality and security analysis (read-only) | sonnet |
| `planner` | Implementation planning from context and requirements (read-only) | inherits parent |
| `scout` | Fast codebase recon for handoff to other agents (read-only) | haiku |

These agents work alongside the built-in types from `@tintinweb/pi-subagents`:

| Built-in | Purpose |
|----------|---------|
| `general-purpose` | Full capabilities, inherits parent's system prompt |
| `Explore` | Fast codebase exploration (read-only, haiku) |
| `Plan` | Software architect for planning (read-only) |

## What's Included

### Extensions

| Extension | Description |
|-----------|-------------|
| **image-label** | Detects dragged image paths, replaces with `[Image N]` labels |
| **plan-mode** | Read-only exploration mode with plan step tracking |

### Skills

| Skill | Description |
|-------|-------------|
| **brainstorming** | Creative work - explores intent, requirements and design before implementation |
| **systematic-debugging** | Use for any bug, test failure, or unexpected behavior - find root cause first |
| **rust-review** | Review Rust code for clippy warnings, idiomatic patterns, error handling, performance |
| **rust-perf** | Deep performance audit and optimization for Rust projects |
| **test-driven-development** | Use before implementing features or bugfixes |
| **writing-plans** | Create detailed implementation plans from specs |
| **requesting-code-review** | Use when completing tasks or before merging |
| **receiving-code-review** | Use when receiving code review feedback |
| **verification-before-completion** | Use before claiming work is complete |
| **frontend-design** | Create distinctive frontend interfaces with high design quality |
| **subagent-driven-development** | Execute plans with parallel subagents and two-stage review |
| **dispatching-parallel-agents** | Use when facing 2+ independent tasks |
| **executing-plans** | Execute multi-step tasks with review checkpoints |
| **finishing-a-development-branch** | Complete development work - guides merge, PR, or cleanup |
| **using-git-worktrees** | Feature work isolation from current workspace |
| **writing-skills** | Create new skills or edit existing ones |
| **find-skills** | Discover and install agent skills |
| **using-superpowers** | Establish how to find and use skills |

### Prompt Templates

| Prompt | Description |
|--------|-------------|
| `/implement` | Scout → Planner → Worker pipeline |
| `/scout-and-plan` | Scout → Planner (no implementation) |
| `/implement-and-review` | Worker → Reviewer → Worker feedback loop |

## Author

[Nacho](https://github.com/nacho)

## License

MIT
