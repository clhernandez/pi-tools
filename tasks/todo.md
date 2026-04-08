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
