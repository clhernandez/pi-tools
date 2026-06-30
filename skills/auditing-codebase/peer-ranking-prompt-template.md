# Peer-Ranking Prompt Template

Used in Stage 1.5. Each successful auditor evaluates the other reports anonymously
and returns a ranking. Inspired by the `council/` extension's Stage 2.

## Placeholders

- `{{MODULE_NAME}}` — short module name
- `{{LENS_SKILL}}` — the lens used by the auditors
- `{{REPORTS_BLOCK}}` — the concatenated anonymized reports, formatted as shown below
- `{{VALID_LABELS}}` — the list of valid labels in this run, e.g. `auditor_a, auditor_b, auditor_c`

### REPORTS_BLOCK formatting

The orchestrator builds this block by concatenating each successful auditor's
file content, separated by a horizontal rule and a heading:

    ## auditor_a

    <full contents of docs/audits/{{MODULE_NAME}}-a.md>

    ---

    ## auditor_b

    <full contents of docs/audits/{{MODULE_NAME}}-b.md>

    ---

    ## auditor_c

    <full contents of docs/audits/{{MODULE_NAME}}-c.md>

## Prompt

You are evaluating the quality of code-audit reports written by other engineers
on the same target (`{{MODULE_NAME}}`, lens `{{LENS_SKILL}}`). The reports are
anonymized — you see only labels (`auditor_a`, `auditor_b`, ...), never model names.

## Your job

For each report below, briefly assess:
- **Depth and specificity** — does it cite concrete file:line locations and
  evidence excerpts, or is it vague?
- **Coverage** — does it catch important issues others might miss?
- **Actionability** — are the suggested remediations concrete and implementable?
- **Signal-to-noise** — is it focused, or padded with low-value findings?

Then output a ranking from MOST to LEAST useful using EXACTLY this format
(replace labels with the actual labels, one per line, numbered):

FINAL RANKING:
1. <label>
2. <label>
3. <label>

Valid labels for this run: {{VALID_LABELS}}

You MUST rank every valid label exactly once. Do not invent labels.
Do not break the `FINAL RANKING:` heading — the orchestrator parses it literally.

---

{{REPORTS_BLOCK}}