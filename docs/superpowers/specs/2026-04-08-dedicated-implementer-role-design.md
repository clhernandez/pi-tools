# Dedicated Implementer Role Design

**Date:** 2026-04-08

## Goal
Introduce a dedicated `implementer` subagent-model role so packaged coding agents can be configured independently from `cheap`, while preserving backward compatibility for existing `subagent-models` configs.

## Problem
Today the runtime supports only three roles in the subagent model config:
- `cheap`
- `standard`
- `capable`

After the native subagent integration, packaged agents map as follows:
- `scout` → `cheap`
- `worker` → `standard`
- `planner` → `capable`
- `reviewer` → `capable`

This couples implementation work to `standard`, even though the desired behavior is for coding work to be configurable separately and default to a cheaper model such as Minimax. Reusing `cheap` for `worker` would blur responsibilities between scouting and implementation. A dedicated `implementer` role solves that cleanly.

## Requirements

### Functional
1. Add a fourth model role: `implementer`.
2. Default `implementer` to the same model as `cheap`: `openrouter/minimax/minimax-m2.7`.
3. Packaged fallback agents must map as follows:
   - `scout` → `cheap`
   - `worker` → `implementer`
   - `planner` → `capable`
   - `reviewer` → `standard`
4. Existing `~/.pi/agent/subagent-models.json` files that do not yet include `implementer` must continue to work.
5. On read, missing `implementer` config must be filled automatically using the current `cheap` model and a matching description.
6. Interactive config and LLM tools must expose `implementer` as a first-class configurable role.

### Documentation
7. README must describe the new role in the model config section.
8. Any docs that enumerate the roles should be updated from `cheap/standard/capable` to `cheap/implementer/standard/capable` where appropriate.

### Non-Goals
1. No change to the native subagent workflow shape.
2. No change to project/user agent override precedence.
3. No automatic complexity-based switching between `implementer` and `standard` in this change.

## Approaches Considered

### Option A: Reuse `cheap` for `worker`
Pros: minimal code changes.
Cons: scouting and implementation become coupled under one role, which reduces control and makes semantics muddy.

### Option B: Add dedicated `implementer` role
Pros: clean separation of concerns, future-proof, explicit control for coding agents.
Cons: requires config migration and doc/tool updates.

## Decision
Adopt **Option B**.

## Architecture

### Config shape
The model config will become:
- `cheap`
- `implementer`
- `standard`
- `capable`

`implementer` defaults to the same model as `cheap`, but remains independently configurable afterward.

### Backward compatibility
When reading config:
- if the file is missing, write a full config with all four roles
- if the file exists but lacks `implementer`, synthesize it from `cheap` and return/write the upgraded config

This gives seamless migration without user intervention.

### Packaged agent mapping
Update packaged agents so:
- `worker.md` uses `modelRole: implementer`
- `scout.md` stays `cheap`
- `planner.md` stays `capable`
- `reviewer.md` uses `standard`

### UI/tools surface
Update:
- `/subagent-config`
- `/subagent-models`
- `get_subagent_models`
- `update_subagent_model`

so they all understand and expose `implementer`.

## Files to Modify
- `extensions/subagent/model-config.ts`
- `extensions/subagent-models.ts`
- `extensions/subagent/agents.ts` (role union)
- `extensions/subagent/agents/worker.md`
- `README.md`
- optionally `skills/subagent-driven-development/SKILL.md` if role list wording is explicit

## Verification Strategy
1. Verify old 3-role config upgrades automatically to include `implementer`.
2. Verify `worker` resolves to `implementer` model.
3. Verify `scout` still resolves to `cheap` model.
4. Verify config commands/tools show `implementer`.

## Acceptance Criteria
- `implementer` exists as a first-class role in config, commands, and tools.
- `worker` uses `implementer`, not `standard`.
- `reviewer` uses `standard`.
- Existing configs without `implementer` still work and are upgraded automatically.
- `scout` remains mapped to `cheap`.
