## Procedure

You MUST use TodoWrite to create a task for EACH of the steps below and complete
them in order. Do not skip steps.

### Step 0 — Resolve target

1. If user supplied a path (positional arg or `--target=`), use it. Confirm the
   path exists and resolve to a `{module}` name (the basename).
2. If no target was supplied, list candidate crates/modules under `crates/` or
   `src/` and ask the user to pick one, several, or `all`. If `all`, process
   each module sequentially (one branch per module, repeating Steps 0–6). Stop
   on the first module whose verification gate fails and surface it to the user.

### Step 1 — Load configuration

1. Read `docs/audits/audit-config.yaml` if present. If missing, use the defaults
   shown in the Configuration section above.
2. Resolve effective values: CLI flags > config file > defaults.
3. Determine `N = --auditors` (default 3, clamped to 1–4) and pick the first N
   entries from `auditors`. Assign labels `a, b, c, d` in order.
4. Announce the plan to the user verbatim:
   > Auditing `{target}` with N={N} auditors (`<list>`), judge `<judge>`, lens
   > `<lens>`. Branch `audit/{module}-{YYYY-MM-DD}`. Verification commands:
   > `<comma-separated list>`. Proceed?
5. Wait for user confirmation before continuing.

### Step 2 — Create dedicated branch

```bash
git checkout -b audit/{module}-{YYYY-MM-DD}
```
If the branch already exists, append a `-N` suffix (`-2`, `-3`, ...) until unique.
Never overwrite an existing audit branch.

### Step 3 — Parallel auditing (RED of the audit cycle)

1. For each auditor `i ∈ [0, N)`:
   - Read `skills/auditing-codebase/auditor-prompt-template.md` and substitute
     `{{TARGET}}`, `{{MODULE_NAME}}`, `{{LABEL}}` (= `a`/`b`/`c`/`d`),
     `{{LENS_SKILL}}`, `{{BRANCH}}`.
   - Dispatch via `Agent` with `subagent_type: general-purpose`,
     `model: <auditor_i>`, `run_in_background: true`, and the interpolated
     prompt.
   - Record the returned agent ID.
2. Wait for ALL agent IDs using `get_subagent_result(wait: true)` for each.
3. For each auditor:
   - Success = the file `docs/audits/{module}-{label}.md` exists, is non-empty,
     AND contains at least one `## ` heading. Failures are recorded with the
     reason (timeout, error message, empty output, missing file).
4. Build `successful_auditors` = list of labels whose file is good.
5. **Failure tolerance gate:**
   - If `len(successful_auditors) == 0`: ABORT. Tell the user and stop. The
     branch stays so the user can inspect any partial output.
   - Else: continue with survivors. Note all failures — they go in
     `Executive Summary → Failed auditors`.
6. Commit:
   ```bash
   git add docs/audits/
   git commit -m "audit: add raw audit reports for {module}"
   ```

### Step 4 — Peer-ranking (Stage 1.5)

Skip this step entirely if `len(successful_auditors) < 2` (no peers to rank).
In that case, set `aggregate_ranking = []` and continue to Step 5.

1. Read `skills/auditing-codebase/peer-ranking-prompt-template.md`.
2. Build `{{REPORTS_BLOCK}}` by concatenating every successful auditor's file
   content, prefixed by `## auditor_<label>` headings and `---` separators
   (exact format documented in the template).
3. Build `{{VALID_LABELS}}` = comma-separated `auditor_<label>` for each
   successful auditor.
4. For each successful auditor, dispatch a fresh subagent with that auditor's
   model and the interpolated peer-ranking prompt. Run them in parallel with
   `run_in_background: true`.
5. Parse each response by finding `FINAL RANKING:` and extracting the numbered
   `auditor_<label>` lines. Discard a ranking if it omits any valid label or
   includes an unknown one.
6. Compute aggregate ranking: for each label, average its position across all
   valid rankings (1-indexed). Lower = better. Build
   `{{AGGREGATE_RANKING_TABLE}}` (markdown table: Label | Average rank | Vote
   count).

### Step 5 — Judge consolidation

1. Read `skills/auditing-codebase/judge-prompt-template.md`.
2. Interpolate all placeholders EXCEPT `{{LABEL_TO_MODEL_TABLE}}` (the judge
   does not see model names). Use `{{TOTAL_COST}}` = the running sum of
   subagent costs reported so far, or `unknown` if not available.
3. Dispatch the judge subagent with `model: <judge>`. NOT in background — wait
   inline; this is the critical synthesis step.
4. Verify the judge produced `docs/audits/{module}-consolidated.md` with the
   required headings (`## Executive Summary`, `## Quick Wins`,
   `## Confirmed Findings`, `## Appendix A`, `## Appendix B`, `## Appendix C`).
   If any required section is missing, treat as judge failure: surface to user,
   leave the raw reports in place, and stop.
5. Append `## Appendix D — Label → Model mapping` to the consolidated file with
   the mapping built from `successful_auditors` + `judge`. Format:
   ```markdown
   ## Appendix D — Label → Model mapping (traceability)
   - auditor_a → sonnet
   - auditor_b → opus
   - auditor_c → gpt-5
   - judge → opus
   ```
6. Commit:
   ```bash
   git add docs/audits/{module}-consolidated.md
   git commit -m "audit: add consolidated findings for {module}"
   ```

### Step 6 — User review gate

Tell the user:
> Consolidated report saved to `docs/audits/{module}-consolidated.md`. Please
> review it (edit findings, demote severity, or remove items you reject) and
> let me know when ready to generate the remediation plan.

Wait for the user's go-ahead. If they edit the file before answering, that is
fine — the next step reads from disk.

### Step 7 — Remediation plan

1. Invoke the `writing-plans` skill. Tell it:
   - Input spec: `docs/audits/{module}-consolidated.md`
   - Output path: `docs/audits/{module}-remediation-plan.md`
   - Task ordering rule: Quick Wins first, then Critical → High → Medium → Low.
     Within a bucket, cheap effort first.
2. After `writing-plans` saves the plan, commit:
   ```bash
   git add docs/audits/{module}-remediation-plan.md
   git commit -m "audit: add remediation plan for {module}"
   ```

### Step 8 — Implementation

Invoke the `subagent-driven-development` skill with
`docs/audits/{module}-remediation-plan.md` as the plan. Each task in that plan
becomes its own subagent and its own commit, per that skill's discipline. Do
NOT inline-execute.

### Step 9 — Verification gate (HARD GATE)

1. For each command in `config.verification.must_pass`, run it from the repo
   root. Capture stdout, stderr, and exit code.
2. ALL commands must exit 0. Default commands:
   ```
   cargo build --workspace --all-targets
   cargo test --workspace --all-features
   cargo clippy --workspace --all-targets --all-features -- -D warnings
   cargo fmt --all -- --check
   ```
3. **If any command fails:**
   - STOP. Do NOT commit anything new. Do NOT attempt repair. Do NOT roll back.
   - Report to the user:
     - which command failed (verbatim)
     - the last ~50 lines of its output
     - `git diff <branch-base>..HEAD --stat` so they see what was changed
   - Hand control to the user.
4. **If every command passes:**
   - Write a verification report at `docs/audits/{module}-verification.md` with
     the command list, exit codes, and a short tail of each output.
   - Commit:
     ```bash
     git add docs/audits/{module}-verification.md
     git commit -m "audit: verification passed for {module}"
     ```
   - Tell the user: audit complete on branch `audit/{module}-{YYYY-MM-DD}`,
     merge or discard at will.