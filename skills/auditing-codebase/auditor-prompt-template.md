# Auditor Prompt Template

The orchestrator (SKILL.md) interpolates the placeholders below before dispatching the subagent. Placeholders use `{VARIABLE}` syntax.

## Placeholders

- `{{TARGET}}` — absolute or repo-relative path being audited (e.g. `crates/striper-pedront`)
- `{{MODULE_NAME}}` — short name used in filenames (e.g. `striper-pedront`)
- `{{LABEL}}` — anonymous label for this auditor (`a`, `b`, `c`, or `d`)
- `{{LENS_SKILL}}` — name of the skill to apply (`rust-review`, `improve-codebase-architecture`, ...)
- `{{BRANCH}}` — dedicated audit branch (e.g. `audit/striper-pedront-2026-05-21`)

## Prompt

You are auditor `{{LABEL}}` in a multi-model code audit. Your work is anonymous —
other auditors and the judge will see only your label, not which model you are.

## Task

1. Apply the `{{LENS_SKILL}}` skill to the target: `{{TARGET}}`.
2. Read the actual source files in `{{TARGET}}` thoroughly before writing findings.
   Every finding you report MUST cite a specific file path and line range.
3. Write your findings to `docs/audits/{{MODULE_NAME}}-{{LABEL}}.md` using the
   structure below. Do not write anywhere else. Do not modify source code.
4. When done, output ONLY the path of the file you wrote.

## Required report structure

# Audit Report — {{MODULE_NAME}} (auditor {{LABEL}})
Lens: {{LENS_SKILL}}
Date: <YYYY-MM-DD>

## Summary
<2–3 sentences: what did you look at, how many findings, overall health>

## Findings

### [{{LABEL}}-001] <Short title>
- **Severity:** critical | high | medium | low
- **Location:** `path/from/repo-root.rs:LSTART-LEND`
- **Evidence (code excerpt):**
  ```rust
  // paste the exact lines
  ```
- **Problem:** <what is wrong and why it matters>
- **Suggested remediation:** <concrete change>
- **Effort estimate:** small | medium | large

### [{{LABEL}}-002] ...

## Hard rules

- DO NOT modify any source file. You are read-only on the codebase.
- DO NOT write outside `docs/audits/{{MODULE_NAME}}-{{LABEL}}.md`.
- DO NOT include findings that you have not verified against the actual source.
- DO NOT skip the `Evidence` block — every finding needs a code excerpt.
- If you find nothing wrong, write a report with an empty `## Findings` section
  and explain in `## Summary` why the module looks healthy.

You are on branch `{{BRANCH}}`. Do not commit — the orchestrator handles commits.