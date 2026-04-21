# Council Extension

Runs a multi-model peer-review council on specs, plans, or code files.

**3 stages:**
1. Each model reviews the content independently
2. Models peer-evaluate each other's reviews and rank them
3. A chairman model synthesizes the top insights

## Setup

Copy the example config to `~/.pi/`:

```bash
cp extensions/council/council.example.json ~/.pi/council.json
```

Then edit `~/.pi/council.json` to pick the models you want. Any model configured in pi works — no separate API key needed.

```json
{
  "models": [
    "anthropic/claude-opus-4-6",
    "openai/gpt-5-4",
    "minimax/minimax-m2.7"
  ],
  "chairman": "google/gemini-3-pro-preview",
  "timeout": 120
}
```

| Field | Description |
|-------|-------------|
| `models` | At least 2 models for peer review. Use `provider/model-id` format. |
| `chairman` | Model that synthesizes the final result. Can be one of the council members. |
| `timeout` | Per-model timeout in seconds (default: 120). |

## Usage

```
/council          — start an interactive review session
/council results  — show full details of the last run
```
