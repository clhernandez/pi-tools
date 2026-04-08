# Native Subagent Integration Design

**Date:** 2026-04-08

## Goal
Make `pi-tools` provide Pi's subagent workflow natively when installed via `pi install git:github.com/Nachompiras/pi-tools`, including the `subagent` tool, packaged default agents, packaged workflow prompts, and skill/docs alignment.

## Context
Today `pi-tools` ships subagent model configuration and skills that reference subagent workflows, but it does not ship the actual `subagent` extension or the default agent definitions required by those workflows. Users can install the package successfully yet still lack the `subagent` tool and baseline agents. That makes the package internally inconsistent and breaks the intended "native" experience.

The official Pi example already provides the extension structure, discovery model, agent definitions, and workflow prompts. The correct implementation is to adapt that example into this package while preserving package-based installation and allowing local overrides.

## Requirements

### Functional
1. Installing `git:github.com/Nachompiras/pi-tools` must expose a working `subagent` tool after Pi reloads resources.
2. The package must ship default agents: `worker`, `reviewer`, `planner`, and `scout`.
3. The package must ship workflow prompts equivalent to the official example:
   - `/implement`
   - `/scout-and-plan`
   - `/implement-and-review`
4. Agent resolution priority must be:
   - project-local agents in `.pi/agents`
   - user agents in `~/.pi/agent/agents`
   - packaged fallback agents from `pi-tools`
5. The packaged solution must work for the officially supported installation mode: installed from git via Pi package management.
6. Existing subagent model configuration functionality must continue to work unchanged.

### Documentation / Skill Alignment
7. Skills and docs must stop claiming Pi lacks subagent support when this package provides it.
8. `subagent-driven-development` and `dispatching-parallel-agents` should describe the packaged integration coherently.
9. README should explain that the package now includes native subagent support and packaged fallback agents/prompts.

### Non-Goals
1. No redesign of the official subagent architecture beyond what is needed for package-based fallback discovery.
2. No new agent personas beyond the official baseline set.
3. No requirement to support manual symlink setup as the primary path.
4. No requirement to optimize for local development-only invocation paths in this change.

## Approaches Considered

### Option A: Literal copy of the official example
Copy the extension and supporting files nearly unchanged and rely on `~/.pi/agent/agents` for agent files.

**Pros**
- Minimal adaptation effort
- Stays close to upstream example

**Cons**
- Still requires manual agent installation or symlinks
- Does not satisfy package-native installation goal
- Leaves prompts/agents partially external

### Option B: Package-native extension with packaged fallbacks
Copy the official example into `pi-tools`, then extend discovery so package-owned agents act as fallback resources behind project and user agents.

**Pros**
- Satisfies native package installation goal
- Preserves override flexibility
- Keeps behavior close to official Pi example
- Clean migration path for users already using project or user agents

**Cons**
- Slightly more code than a direct copy
- Requires careful documentation updates

### Option C: Keep subagent external and only document it
Leave `pi-tools` as skills + model config and tell users to install a separate subagent package manually.

**Pros**
- Least code in this repository

**Cons**
- Fails the product goal entirely
- Worse user experience
- Keeps package inconsistent

## Decision
Adopt **Option B**.

`pi-tools` will embed the subagent extension and official baseline resources, then extend discovery logic so package-provided agents are only used as fallback resources after project-local and user-level overrides.

## Architecture

### Resource Layout
Add these package resources:

- `extensions/subagent/index.ts`
- `extensions/subagent/agents.ts`
- `extensions/subagent/agents/*.md`
- `prompts/implement.md`
- `prompts/scout-and-plan.md`
- `prompts/implement-and-review.md`

`package.json` will continue exposing `extensions` and `skills`, and will additionally expose `prompts`.

### Agent Discovery Model
The adapted discovery layer will resolve agents in three tiers:
1. `.pi/agents/*.md` nearest to current working directory
2. `~/.pi/agent/agents/*.md`
3. packaged fallback agents bundled with `pi-tools`

Conflict resolution is name-based. If multiple tiers define the same agent name, the higher-priority tier wins.

### Why packaged fallback belongs in the extension
Prompt templates can be discovered directly from package resources by Pi, but the `subagent` extension itself is responsible for locating and loading agent definitions. Therefore, fallback package agents must be wired into the extension's discovery implementation rather than relying on external setup.

### Prompt strategy
Reuse the official prompt templates with minimal or no semantic change so the package behavior matches Pi's documented example. They will be shipped as first-class package prompts.

### Skill alignment strategy
Update the skills that currently contradict the new capability:
- `skills/using-superpowers/SKILL.md`
- `skills/subagent-driven-development/SKILL.md`
- `skills/dispatching-parallel-agents/SKILL.md`

The changes should be minimal and precise:
- remove stale claims that Pi lacks subagent support
- describe the package-provided `subagent` integration accurately
- preserve existing workflow guidance unless it is directly contradicted by the new packaged support

## File-Level Plan

### New files
- `extensions/subagent/index.ts` — packaged subagent tool implementation adapted from the official example
- `extensions/subagent/agents.ts` — agent discovery logic with package fallback support
- `extensions/subagent/agents/worker.md` — packaged default worker agent
- `extensions/subagent/agents/reviewer.md` — packaged default reviewer agent
- `extensions/subagent/agents/planner.md` — packaged default planner agent
- `extensions/subagent/agents/scout.md` — packaged default scout agent
- `prompts/implement.md` — packaged workflow prompt
- `prompts/scout-and-plan.md` — packaged workflow prompt
- `prompts/implement-and-review.md` — packaged workflow prompt

### Modified files
- `package.json` — expose prompts in package manifest if not already declared
- `README.md` — document native subagent support and installation outcome
- `skills/using-superpowers/SKILL.md` — remove stale non-subagent guidance
- `skills/subagent-driven-development/SKILL.md` — align wording with actual package support
- `skills/dispatching-parallel-agents/SKILL.md` — align wording with actual package support
- `tasks/todo.md` — progress tracking and review section

## Verification Strategy

### Functional verification
1. Install or reload the package in Pi.
2. Confirm the `subagent` tool is present.
3. Confirm prompts are available.
4. Execute a minimal subagent task using a packaged fallback agent.
5. Confirm existing `get_subagent_models` / `update_subagent_model` functionality still exists.

### Behavioral verification
1. Confirm packaged agents are used when no project/user agent with the same name exists.
2. Confirm higher-priority agent definitions override packaged ones by code inspection and, if feasible, a targeted smoke test.
3. Confirm documentation no longer contradicts runtime behavior.

## Risks
1. **Extension path assumptions** — copied example code may assume a repository example layout. The package adaptation must replace those assumptions with package-local path resolution.
2. **Resource duplication drift** — copied official resources may drift from upstream Pi examples over time. Keeping adaptations minimal reduces maintenance burden.
3. **Over-documenting support** — docs must describe what is actually supported today, not future aspirational workflows.

## Acceptance Criteria
- After installing `pi-tools` from git and reloading Pi, users have access to:
  - `subagent` tool
  - packaged fallback agents
  - packaged prompts
- Agent precedence is project > user > package.
- Existing model config extension still works.
- Skills and README are internally consistent with the runtime.
