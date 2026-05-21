---
name: auditing-codebase
description: Use when auditing a Rust codebase, module, or workspace with multiple AI auditors and a judge - produces a consolidated, prioritized remediation plan with verified implementation on a dedicated branch
---

# Auditing Codebase

## Overview

Orchestrates an end-to-end multi-model code audit on a dedicated git branch:
parallel auditors → anonymous peer-ranking → judge that verifies findings against
the source code → prioritized consolidated report → remediation plan → verified
implementation. The lens (`rust-review`, `improve-codebase-architecture`,
`rust-perf`, ...) is configurable; the skill itself is lens-agnostic.

**Core principle:** *Multiple independent perspectives, anonymized peer ranking,
and a judge that proves every Confirmed finding against the actual code —
delivered on a branch the user can inspect, reject, or merge at their leisure.*

## When to Use

- Auditing a Rust crate, module, or workspace before a refactor or release
- Wanting cross-model consensus on what is wrong with a piece of code
- Needing a reproducible audit trail (raw reports + consolidated + plan + commits) in git
- Wanting findings prioritized by severity and quick-win surfaced

**Do NOT use:**
- For single-file ad hoc reviews — just invoke the lens skill directly
- For non-Rust codebases (in this iteration; verification commands are Rust-centric)
- When you cannot afford the time/cost of N parallel model calls

## Configuration

Looks for `docs/audits/audit-config.yaml` in the repo root. If missing, applies
these defaults:

```yaml
auditors: [sonnet, opus, gpt-5]   # uses first N where N = --auditors flag (default 3)
judge: opus
lens: rust-review
verification:
  must_pass:
    - cargo build --workspace --all-targets
    - cargo test --workspace --all-features
    - cargo clippy --workspace --all-targets --all-features -- -D warnings
    - cargo fmt --all -- --check
```

A template lives at `skills/auditing-codebase/audit-config.example.yaml`.

### CLI flags (override config)

| Flag | Range | Default |
|---|---|---|
| `--auditors=N` | 1–4 | 3 |
| `--lens=<skill>` | any installed skill | `rust-review` |
| `--target=<path>` | repo-relative path | positional arg or interactive prompt |

## Artifacts Produced

```
docs/audits/
  {module}-a.md                       raw report, auditor a
  {module}-b.md                       raw report, auditor b
  {module}-c.md                       raw report, auditor c (if N≥3)
  {module}-d.md                       raw report, auditor d (if N=4)
  {module}-consolidated.md            judge output
  {module}-remediation-plan.md        writing-plans output
```

Branch: `audit/{module}-{YYYY-MM-DD}` (always; never worktrees).

Commits (in order on the audit branch):
1. `audit: add raw audit reports for {module}`
2. `audit: add consolidated findings for {module}`
3. `audit: add remediation plan for {module}`
4. *(one or more commits from subagent-driven-development, per task)*
5. `audit: verification passed for {module}` — only if the gate passes
