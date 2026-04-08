# TODO

- [x] Explore project context for native subagent integration in pi-tools
- [x] Clarify packaging/install target and success criteria with user
- [x] Propose implementation approaches with recommendation
- [x] Present design for approval
- [x] Write design/spec document
- [x] Write implementation plan
- [x] Implement approved plan
- [x] Verify installation and behavior
- [x] Document review/results

## Review

- Installed/reloaded updated package: **yes** (pi update + git push/pull)
- Prompt commands verified: **yes** — implement, scout-and-plan, implement-and-review visible via get_commands from package prompts path
- Subagent packaged fallback smoke test: **yes** — subagent tool executed planner agent from package (agentSource: 'package'), returned correct output (HELLO)
- Existing model config tools still work: **yes** — get_subagent_models returned correct config
- Notes:
  - Fix initially needed: agent model references changed from `claude-sonnet-4-5` to `openrouter/anthropic/claude-sonnet-4.6` (and similar for scout) because user uses openrouter as default provider
  - 3 commits total: a7c8256 (feat: add packaged subagent extension), ee81365 (docs: align package), 8b73b11 (fix: use openrouter provider models)
  - All tests passed: prompts visible, subagent tool works with packaged fallback agents, model config preserved

## Follow-up: dynamic subagent model selection

- [x] Investigate reported issue: packaged agents hardcode provider-specific models instead of using subagent-models roles
- [x] Write failing verification showing packaged agent ignores role-based model config
- [x] Implement role-based model resolution for packaged subagents
- [x] Verify packaged agents honor cheap/standard/capable config dynamically
- [x] Document review/results for the fix

### Follow-up Review

- Root cause confirmed: `extensions/subagent/index.ts` passed `agent.model` directly to `--model`, and packaged fallback agents hardcoded provider-specific `model:` values.
- Fix applied: packaged fallback agents now declare `modelRole` (`cheap` / `standard` / `capable`) and `extensions/subagent/index.ts` resolves the concrete model dynamically from the shared subagent-models config.
- Shared config extracted to: `extensions/subagent/model-config.ts`
- Verification:
  - failing repro before fix: reviewer used `openrouter/anthropic/claude-sonnet-4.6` while capable was configured as `openrouter/openai/gpt-5.4`
  - passing repro after fix: reviewer now uses configured capable model
  - additional passing checks: scout→cheap, worker→standard, planner→capable
- Commit: `d9eeb67 fix: resolve packaged subagent models from roles`

## Follow-up: dedicated implementer role

- [x] Decide direction with user: use dedicated `implementer` role instead of overloading `cheap`
- [x] Design changes to subagent-models and packaged agents for `implementer`
- [x] Write spec for dedicated implementer role
- [x] Write implementation plan for dedicated implementer role
- [x] Implement dedicated `implementer` role end-to-end
- [x] Verify worker uses implementer role while scout stays cheap

## Follow-up Review: dedicated implementer role

- Added new role: **yes**
- Old config migrated automatically: **yes**
- Worker uses implementer role: **yes**
- Scout still uses cheap role: **yes**
- Reviewer now uses standard role: **yes**
- Planner still uses capable role: **yes**
- Notes:
  - Migration verified from an existing 3-role config: `implementer` was absent before update and present after calling `get_subagent_models`.
  - Runtime mapping verified through Pi RPC:
    - `scout` → `cheap` → `openrouter/minimax/minimax-m2.7`
    - `worker` → `implementer` → `openrouter/minimax/minimax-m2.7`
    - `reviewer` → `standard` → `openrouter/anthropic/claude-sonnet-4.6`
    - `planner` → `capable` → `openrouter/openai/gpt-5.4`
  - Implementer-role commits landed on `main` and were also exercised in a worktree during review/fix cycles.
