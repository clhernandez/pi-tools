# Auditing Codebase Skill — Design Spec

**Date:** 2026-05-21
**Status:** Approved by user, ready for implementation planning
**Type:** New skill (`auditing-codebase`)

## 1. Problem Statement

Today the workflow to audit a Rust codebase is manual and fragile:

1. The user invokes a review skill (`rust-review` or `improve-codebase-architecture`) against models A, B, C separately.
2. Once each model finishes, the user asks it to persist its findings to `docs/audits/{module}-{a|b|c}.md`.
3. The user manually switches to a "judge" model, feeds it the 3–4 reports, and asks it to filter false positives against the actual code, producing a consolidated document.
4. The user invokes `writing-plans` on the consolidated findings.
5. The user invokes `subagent-driven-development` to execute the plan.
6. The user verifies — by hand — that nothing in the existing functionality is broken (tests pass, clippy clean).

The process works but it is **error-prone, slow, and not reproducible**. There is no enforced verification gate, no failure tolerance, no anonymization to remove model bias from the judge, and no traceable git history of the audit lifecycle.

## 2. Goal

Build a skill called **`auditing-codebase`** that orchestrates the full audit lifecycle end-to-end with:

- Parallel multi-model auditing (1–4 auditors, default 3)
- Anonymous peer-ranking of audit reports (inspired by the `council/` extension)
- A judge that classifies findings against the actual source code
- Prioritized output with quick wins highlighted
- Automatic invocation of `writing-plans` and `subagent-driven-development`
- A hard verification gate (build / test / clippy / fmt) before declaring done
- Full work isolated on a dedicated branch with checkpoint commits

The skill must be **composable** — it reuses existing skills (`dispatching-parallel-agents`, `writing-plans`, `subagent-driven-development`, `verification-before-completion`) rather than reimplementing them. The lens (`rust-review`, `improve-codebase-architecture`, `rust-perf`, etc.) is **configurable**, so the skill is reusable across any audit perspective.

## 3. Non-Goals

- **No auto-rollback.** If verification fails, the skill stops and reports; the user decides what to do with the branch.
- **No auto-repair loop.** The skill does not attempt to fix failed verification on its own — that would risk hiding real problems.
- **No worktrees.** Work happens on a branch in the current repo so the user can see changes in their normal git tooling.
- **No support for non-Rust languages in this iteration.** Verification commands are Rust-centric. Future work can generalize.
- **No new extension.** This is a skill, not an extension. We do not reimplement the `council/` extension's OpenRouter integration — we use pi's subagent dispatch (`Agent` tool with the `model` parameter).

## 4. User Experience

### Invocation

```
/auditing-codebase                              # scan workspace + prompt for target
/auditing-codebase crates/striper-pedront       # audit a specific path
/auditing-codebase crates/foo --auditors=4      # override number of auditors
/auditing-codebase crates/foo --lens=rust-perf  # override the lens skill
```

### Flow from the user's perspective

1. Skill resolves the target (path arg or interactive scan).
2. Skill creates branch `audit/{module}-{YYYY-MM-DD}` and switches to it.
3. Skill loads `docs/audits/audit-config.yaml` (or applies defaults) and reports the plan (which auditors, which judge, which lens, how many findings to expect).
4. Skill dispatches N auditor subagents in parallel.
5. Skill runs a peer-ranking stage (each auditor evaluates the others' reports anonymously).
6. Skill dispatches a judge subagent that reads the reports, runs the peer ranking, **and reads the actual source code** to verify findings.
7. Skill presents the consolidated report and pauses for user review.
8. Skill invokes `writing-plans` on the consolidated findings.
9. Skill invokes `subagent-driven-development` to execute the plan.
10. Skill runs the verification gate.
11. Skill commits the verification evidence and tells the user the audit is complete; user merges the branch when ready.

## 5. Architecture

### 5.1 High-level flow

```
0. Setup
   ├─ Resolve target (arg OR scan + prompt)
   ├─ Load docs/audits/audit-config.yaml (or defaults)
   └─ Create branch: audit/{module}-{YYYY-MM-DD}
                ↓
1. Parallel Audit (N auditors, default 3, range 1–4)
   ├─ Dispatch N subagents in parallel via Agent(run_in_background: true)
   ├─ Each subagent: model=<auditor_N>, applies <lens skill> to target
   ├─ Each writes docs/audits/{module}-{a|b|c|d}.md
   ├─ Failure tolerance: continue if ≥1 auditor succeeds
   └─ COMMIT: "audit: add raw audit reports for {module}"
                ↓
1.5 Peer Ranking (NEW, inspired by council/)
    ├─ Each successful auditor evaluates the other reports anonymously
    │   (sees only labels: auditor_a, auditor_b, …)
    ├─ Each returns a ranking from most to least useful
    ├─ Skill computes aggregate ranking (average position)
    └─ Result stored in memory; surfaces in the consolidated doc
                ↓
2. Judge Consolidation
   ├─ Dispatch judge subagent with model=<judge>
   ├─ Inputs: anonymized reports + peer rankings + read access to source code
   ├─ Judge classifies each finding:
   │     Confirmed | False positive | Duplicate | Out of scope | Disputed
   ├─ Judge prioritizes by severity (critical/high/medium/low) and impact
   ├─ Judge marks Quick Wins (high impact, low effort)
   ├─ Output: docs/audits/{module}-consolidated.md
   └─ COMMIT: "audit: add consolidated findings for {module}"
                ↓
3. User Review Gate
   └─ Present summary; user reviews and may edit the consolidated doc
                ↓
4. Remediation Plan
   ├─ Invoke writing-plans skill with the consolidated findings
   ├─ Plan tasks ordered: Quick Wins → Critical → High → Medium → Low
   ├─ Output: docs/audits/{module}-remediation-plan.md
   └─ COMMIT: "audit: add remediation plan for {module}"
                ↓
5. Implementation
   └─ Invoke subagent-driven-development skill on the plan
       (each task → its own subagent → its own commit)
                ↓
6. Verification Gate (HARD GATE)
   ├─ Run every command in config.verification.must_pass
   ├─ ALL must pass to proceed
   ├─ If any fails:
   │     STOP. Report what failed + summary of changes since base.
   │     No auto-rollback. No auto-repair. Hand control to user.
   └─ If all pass:
        COMMIT: "audit: verification passed for {module}"
        (commit body includes captured command outputs)
```

### 5.2 Anonymization model (from `council/`)

Reports are persisted with neutral labels: `{module}-a.md`, `{module}-b.md`, `{module}-c.md`. A label→model mapping is kept in the consolidated doc's appendix for traceability, but **prompts sent to peer reviewers and to the judge never include model names**. This removes brand bias ("opus is always better") from the synthesis.

### 5.3 Failure tolerance

- If 1+ auditors fail (timeout, API error, empty output) the skill continues with the survivors and notes the failure in the executive summary.
- If 0 auditors succeed, the skill aborts before peer ranking with a clear error.
- If the judge fails, the skill aborts after raw reports — the raw `.md` files remain on the branch so the user can salvage manually.

### 5.4 Cost tracking

Where the subagent dispatch surfaces cost (model output tokens, USD), aggregate it across all stages and report a total in the executive summary. This is a best-effort field — if pi does not surface cost for a given model, mark it as `unknown`.

## 6. Configuration

### 6.1 File

`docs/audits/audit-config.yaml` (optional; defaults apply if missing):

```yaml
auditors:
  - sonnet
  - opus
  - gpt-5
judge: opus
lens: rust-review                  # default skill applied by each auditor
verification:
  must_pass:
    - cargo build --workspace --all-targets
    - cargo test --workspace --all-features
    - cargo clippy --workspace --all-targets --all-features -- -D warnings
    - cargo fmt --all -- --check
```

### 6.2 CLI flags (override config)

| Flag | Description | Default |
|---|---|---|
| `--auditors=N` | Number of auditors (1–4) | 3 |
| `--lens=<skill>` | Skill applied by auditors | `rust-review` |
| `--target=<path>` | Audit target (path) | from positional arg or prompt |

### 6.3 Defaults if no config file

```yaml
auditors: [sonnet, opus, gpt-5]   # picked first 3
judge: opus
lens: rust-review
verification.must_pass: [build, test, clippy, fmt — as listed above]
```

## 7. Artifacts Produced

```
docs/audits/
├── audit-config.yaml                       (optional, persistent, may pre-exist)
├── {module}-a.md                           (raw report, auditor 1)
├── {module}-b.md                           (raw report, auditor 2)
├── {module}-c.md                           (raw report, auditor 3)
├── {module}-consolidated.md                (judge output)
└── {module}-remediation-plan.md            (writing-plans output)
```

### 7.1 Raw report format (each auditor)

Defined by the lens skill (`rust-review`, etc.). The skill does not impose a schema beyond requiring the file to land at the expected path. Auditor prompt template tells each auditor to:

1. Run the lens skill against the target.
2. Write findings to `docs/audits/{module}-{label}.md`.
3. Structure findings with location (`path:line`), evidence (code excerpt), severity hint, and suggested remediation.

### 7.2 Consolidated report format (judge)

```markdown
# Audit Consolidation: {module}
Date: YYYY-MM-DD | Lens: {lens} | Branch: audit/{module}-{YYYY-MM-DD}

## Executive Summary
- Total raw findings: N
- Confirmed: X | False positives: Y | Duplicates merged: Z | Disputed: W
- Severity breakdown: critical=A, high=B, medium=C, low=D
- Quick wins identified: K
- Peer-ranking aggregate: auditor_a=1.3, auditor_b=2.0, auditor_c=2.7
- Total cost: $X.XX (or "unknown" if not available)
- Failed auditors: none | [list with reason]

## Quick Wins (high impact, low effort) — DO FIRST
1. [QW-001] …

## Confirmed Findings (by severity)
### Critical
- **[F-001] {title}**
  - Location: `path/to/file.rs:L42-L58`
  - Reported by: auditor_a, auditor_b (consensus 2/3)
  - Evidence: ```rust … ```
  - Impact: …
  - Suggested remediation: …

### High / Medium / Low
…

## Appendix A — False Positives (discarded)
- [FP-001] reported by auditor_c — reason judge rejected: …

## Appendix B — Disputed (needs human decision)
- [D-001] auditor_a says X, auditor_b says Y. Judge could not reconcile because …

## Appendix C — Out of Scope (noted for future)
- [OOS-001] real issue but outside `{module}`. Location: …

## Appendix D — Label → Model mapping (traceability)
- auditor_a → sonnet
- auditor_b → opus
- auditor_c → gpt-5
- judge → opus
```

## 8. Reuse of Existing Skills

| Stage | Skill reused | Notes |
|---|---|---|
| 1 (parallel audit) | `dispatching-parallel-agents` | Pattern for `run_in_background: true` |
| 1 (per auditor) | `rust-review` / `improve-codebase-architecture` / etc. | The configured lens |
| 4 (plan) | `writing-plans` | Standard plan format |
| 5 (implement) | `subagent-driven-development` | Per-task subagent + commit |
| 6 (gate) | `verification-before-completion` | Evidence-before-claims discipline |

## 9. Skill File Layout

```
skills/auditing-codebase/
├── SKILL.md                          (main reference, < 500 words core + flowchart)
├── audit-config.example.yaml         (copy-paste template)
├── auditor-prompt-template.md        (heavy reference: prompt for each auditor subagent)
├── peer-ranking-prompt-template.md   (heavy reference: prompt for stage 1.5)
└── judge-prompt-template.md          (heavy reference: prompt for the judge)
```

Templates live in separate files because they are heavy reference (50–100+ lines each) and only load when the skill actually dispatches that subagent. SKILL.md stays lean for fast discovery and reading.

## 10. Frontmatter (tentative)

```yaml
name: auditing-codebase
description: Use when auditing a Rust codebase, module, or workspace with multiple AI auditors and a judge - produces a consolidated, prioritized remediation plan with verified implementation on a dedicated branch
```

(Per `writing-skills` guidance: description states triggering conditions only, not the workflow.)

## 11. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| One auditor hallucinates findings | Judge verifies each finding against actual code; peer ranking deprioritizes vague reports |
| Auditors all use the same model family and agree on the same blind spot | Config defaults span families (Anthropic + OpenAI + xAI/Google); user can configure further |
| Judge hallucinates a "confirmation" without reading the code | Judge prompt is explicit: every Confirmed finding must include a code evidence excerpt copied from the file. If missing, skill flags the finding as `Disputed`. |
| Verification gate masks a real regression by passing despite a flaky test | Out of scope for this skill — covered by project test discipline. Skill reports exact commands and outputs so the user can inspect. |
| Branch piles up between audits | Branch name includes date; user is responsible for merging or deleting. Skill never deletes branches. |
| Subagent dispatch fails for one model | Failure-tolerant: skill proceeds with survivors and notes the failure in the executive summary |
| `cargo` not on PATH | Skill runs verification commands as configured; if a command fails to execute, treat as failed verification with a clear error message |

## 12. Open Decisions Carried Forward

None. All decisions made during brainstorming. Implementation plan will be created by invoking `writing-plans` next.

## 13. Acceptance Criteria

The skill is complete when:

1. SKILL.md exists at `skills/auditing-codebase/SKILL.md` with valid frontmatter and word count <500 in the core sections.
2. Template files exist for auditor, peer ranking, and judge prompts.
3. `audit-config.example.yaml` exists and is documented in SKILL.md.
4. Running the skill on a small test target (e.g. a single crate) produces:
   - A new branch `audit/{module}-{YYYY-MM-DD}`
   - N raw reports + consolidated + remediation plan files in `docs/audits/`
   - Five expected commits on the branch
   - Verification gate executed with all configured commands
5. Failure tolerance verified: skill continues with N-1 auditors when one is intentionally configured with an invalid model name.
6. Per `writing-skills` TDD discipline: each behavioral requirement of the skill has been validated with a subagent pressure scenario before declaring the skill done.
