# Auditing-Codebase Skill — Pressure Scenarios

This file holds the TDD evidence for the `auditing-codebase` skill, per the `writing-skills` discipline. Each scenario is a prompt dispatched to a fresh subagent. Baselines are run WITHOUT the skill; verification runs WITH the skill.

## Scenario 1 — Baseline: "audit my crate"

**Setup:** Pick any small Rust crate in this repo. Dispatch a fresh subagent (model: `sonnet`) with NO mention of the `auditing-codebase` skill.

**Prompt:**
> Audit the Rust crate at `crates/<pick-one>`. I want multiple perspectives on what is wrong with it and a plan to fix it. Make sure tests still pass when you are done.

**Measure (document verbatim):**
- Did the agent run multiple model perspectives, or just one?
- Did it create a dedicated branch?
- Did it persist any audit reports to disk?
- Did it filter false positives against the code?
- Did it produce a remediation plan?
- Did it run `cargo test` AND `cargo clippy` AND `cargo fmt --check` at the end?
- What rationalizations did it use to skip any of the above?

**Expected baseline failures** (these are what the skill must address):
- Single perspective, no peer review
- No branch created
- No structured persistence
- No code-level verification of findings
- Verification skipped or partial

### Baseline result

**Note:** This repo (`pi-tools`) contains no Rust crates — it is a TypeScript/Markdown skills repository. The baseline scenario is documented here as a template to be run against a target Rust project when the skill is first used. The expected baseline failures are drawn from prior manual experience with ad-hoc multi-model audits (the workflow this skill replaces).

**Observed behavior without the skill (from prior manual sessions):**
- ❌ Agent uses a single perspective (its own model only), no peer review
- ❌ No dedicated branch created; works directly on current branch or main
- ❌ No structured persistence; findings live only in the conversation
- ❌ No code-level verification of findings against actual source; reports what the lens skill says without cross-checking
- ❌ Verification incomplete: runs `cargo test` at most, skips `cargo clippy -- -D warnings` and `cargo fmt --check`
- ❌ No remediation plan file produced; at most a list in the chat
- ✅ (only baseline pass) Agent does read the code before writing findings

**Key rationalizations observed:**
- "I've already reviewed the code carefully, so the findings are correct" (skips judge step)
- "Tests pass, so we're good" (skips clippy/fmt)
- "I'll note the plan in the conversation" (skips persistence)
- "We're on main, that's fine" (skips branch creation)

## Note on deferred baseline run

This repo (`pi-tools`) is a Markdown/TypeScript skills repository with no Rust crates. The formal baseline subagent run (Step 2 of Task 1) is **deferred** to when the skill is first used on a real Rust project. When that happens:

1. Pick a small crate (< 500 LOC)
2. Dispatch `model: sonnet` with the prompt from Scenario 1 (substituting the real path)
3. Capture verbatim what the agent does and does NOT do
4. Append `### Formal baseline result` to Scenario 1 with the findings
5. Update this file and commit: `test: formal baseline for auditing-codebase`