# Council Extension — Design Spec

**Date:** 2026-04-19
**Status:** Approved
**Inspired by:** [karpathy/llm-council](https://github.com/karpathy/llm-council)

## Overview

A pi extension that implements a "council of models" — multiple LLMs independently review a document (spec, plan, or code), anonymously evaluate each other's reviews, and a chairman model synthesizes the final feedback. Uses OpenRouter as a single gateway to access any model.

## Activation

Manual command: `/council`

Interactive flow:
1. `ctx.ui.select()` — Choose review type: `Spec | Plan | Code`
2. `ctx.ui.input()` — Path to the file to review
3. `ctx.ui.input()` — Optional additional instructions (enter to skip)

## Architecture

### File Structure

```
extensions/council/
├── index.ts           # Entry point — /council command, /council results, UI, state
├── openrouter.ts      # OpenRouter HTTP client (parallel queries)
├── council.ts         # 3-stage orchestration (review → peer eval → synthesis)
├── prompts.ts         # Prompt templates per review type
└── config.ts          # Types, config loading, defaults
```

No `package.json` needed — uses `node:https` for HTTP calls, no external dependencies.

### Configuration

File: `~/.pi/council.json`

```json
{
  "apiKey": "sk-or-...",
  "models": [
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o",
    "google/gemini-2.5-pro"
  ],
  "chairman": "anthropic/claude-sonnet-4",
  "timeout": 120
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `apiKey` | Yes* | — | OpenRouter API key. Also accepts env var `OPENROUTER_API_KEY` (file takes priority) |
| `models` | Yes | — | List of OpenRouter model identifiers. Minimum 2 |
| `chairman` | No | First model in list | Model that synthesizes the final answer |
| `timeout` | No | 120 | Seconds per model request |

*If neither the file field nor the env var is set, the command shows setup instructions.

### First-Use Experience

If `~/.pi/council.json` doesn't exist or is missing the API key, `/council` shows:
> "Council not configured. Create ~/.pi/council.json with your OpenRouter API key and model list."

If fewer than 2 models are configured:
> "Council requires at least 2 models for peer review."

## 3-Stage Pipeline

### Stage 1 — Independent Reviews

Each council model receives the document content and produces an independent review. All models are queried in parallel via `Promise.all`.

**Input per model:**
- Document content (read from file)
- Review type (spec/plan/code)
- Optional user instructions

**Output per model:** Structured review text covering type-specific criteria.

**Error handling:** If a model fails, it's silently excluded. If ALL fail, show error with details.

### Stage 2 — Anonymous Peer Evaluation

Each model receives ALL Stage 1 reviews, anonymized as "Review A", "Review B", etc. The label-to-model mapping is tracked internally.

**Each model must produce:**
1. Evaluation of each review (strengths, gaps)
2. A `FINAL RANKING:` section — numbered list from most to least useful

**Ranking parsing:**
- Primary: regex for numbered list format (`1. Review C`)
- Fallback: extract any `Review [A-Z]` patterns in order

**Aggregate scoring:** Average rank position across all peer evaluations. Lower is better.

### Stage 3 — Chairman Synthesis

The chairman model receives:
- Original document
- All reviews (de-anonymized, with model names)
- All rankings and aggregate scores

**Output:** A synthesis covering:
- Consensus points across reviewers
- Relevant discrepancies and which position is stronger
- Prioritized, actionable recommendations (verdict)

### Timing

- 3 stages execute sequentially
- Within each stage, model calls are parallel
- Timeout: configurable per-model (default 120s)

## Review Type Prompts

### Spec Review
- Completeness: missing requirements, ambiguities
- Internal consistency: contradictions between sections
- Technical feasibility: is it implementable as described
- Risks and blind spots
- Concrete improvement suggestions

### Plan Review
- Coverage: do steps cover everything in the spec
- Ordering: dependencies correctly sequenced
- Granularity: steps that are too large and should be split
- Missing testing/verification steps
- Risk estimation per step

### Code Review
- Correctness and potential bugs
- Language patterns and best practices
- Performance and scalability
- Maintainability and clarity
- Security (if applicable)

### Peer Evaluation (Stage 2 — same for all types)
- Depth and usefulness of each anonymous review
- Points other reviewers missed
- Strict numbered final ranking

### Chairman Synthesis (Stage 3 — same for all types)
- Consensus points
- Discrepancies and which position is stronger
- Prioritized actionable recommendations

## User Interface (TUI)

### Progress Indicators

`ctx.ui.setStatus()` updated per stage:
- `"🏛️ Council: Stage 1 — Models reviewing independently..."`
- `"🏛️ Council: Stage 2 — Peer evaluation in progress..."`
- `"🏛️ Council: Stage 3 — Chairman synthesizing..."`

Status cleared on completion.

### Compact Result (default view)

Injected into chat via `pi.sendMessage()`:

1. Chairman's synthesis (the actionable result)
2. Aggregate ranking table:
   ```
   📊 Council Rankings:
   1. anthropic/claude-sonnet-4 (avg: 1.3)
   2. openai/gpt-4o (avg: 1.8)
   3. google/gemini-2.5-pro (avg: 2.5)
   ```
3. Hint: `"Run /council results for full details"`

### Expanded Results (`/council results`)

Shows the complete output from all 3 stages:
- Stage 1: Each model's full review, labeled with model name
- Stage 2: Each model's peer evaluation + parsed rankings
- Stage 3: Full chairman synthesis

Results stored in extension memory (reconstructed via `pi.appendEntry()` + `session_start` handler).

### Error States

| Condition | Behavior |
|-----------|----------|
| No config file / no API key | `ctx.ui.notify()` with setup instructions |
| < 2 models configured | `ctx.ui.notify()` with minimum requirement |
| All models fail in a stage | Error message with failure details |
| Some models fail | Continue with remaining models, note exclusions |
| File not found | `ctx.ui.notify()` with path error |

## State Management

- Latest council results stored in memory for `/council results`
- Persisted via `pi.appendEntry("council", data)` for session restoration
- Reconstructed in `session_start` event handler from `ctx.sessionManager.getBranch()`

## Commands

| Command | Description |
|---------|-------------|
| `/council` | Start a new council review (interactive) |
| `/council results` | Show full details of the last council review |
