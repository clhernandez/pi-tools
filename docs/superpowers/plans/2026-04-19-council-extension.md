# Council Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/council` pi extension that sends a spec/plan/code file to a configurable panel of LLMs via OpenRouter, runs a 3-stage review pipeline (independent review → anonymous peer ranking → chairman synthesis), and shows a compact result with expandable detail.

**Architecture:** Five focused modules — `config.ts` loads and validates `~/.pi/council.json`, `openrouter.ts` is a thin HTTP client over `node:https`, `prompts.ts` holds all prompt templates, `council.ts` orchestrates the 3 stages, and `index.ts` wires everything into two slash commands with TUI interactions.

**Tech Stack:** TypeScript, pi ExtensionAPI, `node:https` (no external deps), OpenRouter API (OpenAI-compatible chat completions)

**Spec:** `docs/superpowers/specs/2026-04-19-council-extension-design.md`

---

## File Map

| File | Create/Modify | Responsibility |
|------|--------------|----------------|
| `extensions/council/config.ts` | Create | Types + load/validate `~/.pi/council.json` |
| `extensions/council/openrouter.ts` | Create | HTTP client — single query + parallel queries |
| `extensions/council/prompts.ts` | Create | Prompt templates for all stages and review types |
| `extensions/council/council.ts` | Create | 3-stage pipeline orchestration + ranking parser |
| `extensions/council/index.ts` | Create | `/council` + `/council results` commands, state, TUI |

---

## Task 1: `config.ts` — Types and config loading

**Files:**
- Create: `extensions/council/config.ts`

- [ ] **Step 1: Create `extensions/council/config.ts`**

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ReviewType = "spec" | "plan" | "code";

export interface CouncilConfig {
	apiKey: string;
	models: string[];
	chairman: string;
	timeout: number;
}

export interface CouncilConfigFile {
	apiKey?: string;
	models?: string[];
	chairman?: string;
	timeout?: number;
}

export type ConfigLoadResult =
	| { ok: true; config: CouncilConfig }
	| { ok: false; error: string };

const CONFIG_PATH = path.join(os.homedir(), ".pi", "council.json");

export function loadConfig(): ConfigLoadResult {
	let raw: CouncilConfigFile = {};

	if (fs.existsSync(CONFIG_PATH)) {
		try {
			raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as CouncilConfigFile;
		} catch {
			return { ok: false, error: `Failed to parse ${CONFIG_PATH}: invalid JSON` };
		}
	}

	const apiKey = raw.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
	if (!apiKey) {
		return {
			ok: false,
			error: `Council not configured. Create ${CONFIG_PATH} with your OpenRouter API key and model list.\n\nExample:\n{\n  "apiKey": "sk-or-...",\n  "models": ["anthropic/claude-sonnet-4-5", "openai/gpt-4o", "google/gemini-2.5-pro"],\n  "chairman": "anthropic/claude-sonnet-4-5"\n}`,
		};
	}

	const models = raw.models ?? [];
	if (models.length < 2) {
		return { ok: false, error: "Council requires at least 2 models for peer review. Add more models to ~/.pi/council.json" };
	}

	return {
		ok: true,
		config: {
			apiKey,
			models,
			chairman: raw.chairman ?? models[0],
			timeout: raw.timeout ?? 120,
		},
	};
}
```

- [ ] **Step 2: Commit**

```bash
cd extensions/council
git add config.ts
git commit -m "feat(council): add config types and loader"
```

---

## Task 2: `openrouter.ts` — HTTP client

**Files:**
- Create: `extensions/council/openrouter.ts`

- [ ] **Step 1: Create `extensions/council/openrouter.ts`**

```typescript
import * as https from "node:https";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ModelResponse {
	model: string;
	content: string;
	error?: string;
}

function httpsPost(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const req = https.request(
			{
				hostname: parsed.hostname,
				path: parsed.pathname,
				method: "POST",
				headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
				res.on("error", reject);
			},
		);
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
		});
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

export async function queryModel(
	model: string,
	prompt: string,
	apiKey: string,
	timeoutMs: number,
): Promise<ModelResponse> {
	const body = JSON.stringify({
		model,
		messages: [{ role: "user", content: prompt }],
	});

	try {
		const raw = await httpsPost(
			OPENROUTER_URL,
			body,
			{ Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://github.com/pi-tools", "X-Title": "pi-council" },
			timeoutMs * 1000,
		);

		const json = JSON.parse(raw) as {
			choices?: Array<{ message?: { content?: string } }>;
			error?: { message?: string };
		};

		if (json.error) {
			return { model, content: "", error: json.error.message ?? "Unknown API error" };
		}

		const content = json.choices?.[0]?.message?.content ?? "";
		return { model, content };
	} catch (err) {
		return { model, content: "", error: err instanceof Error ? err.message : String(err) };
	}
}

export async function queryModelsParallel(
	models: string[],
	prompt: string,
	apiKey: string,
	timeoutMs: number,
): Promise<ModelResponse[]> {
	return Promise.all(models.map((m) => queryModel(m, prompt, apiKey, timeoutMs)));
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/council/openrouter.ts
git commit -m "feat(council): add OpenRouter HTTP client"
```

---

## Task 3: `prompts.ts` — Prompt templates

**Files:**
- Create: `extensions/council/prompts.ts`

- [ ] **Step 1: Create `extensions/council/prompts.ts`**

```typescript
import type { ReviewType } from "./config.js";

const REVIEW_CRITERIA: Record<ReviewType, string> = {
	spec: `- **Completeness**: Are there missing requirements or ambiguities?
- **Internal consistency**: Do any sections contradict each other?
- **Technical feasibility**: Is this implementable as described?
- **Risks and blind spots**: What could go wrong that isn't addressed?
- **Concrete improvement suggestions**: What specific changes would make this spec stronger?`,

	plan: `- **Spec coverage**: Do the steps cover everything described in the spec?
- **Ordering**: Are dependencies correctly sequenced? Any steps that must come before others but don't?
- **Granularity**: Are any steps too large and should be split into smaller ones?
- **Testing and verification**: Are there missing testing or validation steps?
- **Risk per step**: Which steps are highest risk and why?`,

	code: `- **Correctness**: Are there bugs, edge cases not handled, or logic errors?
- **Patterns and best practices**: Does the code follow idiomatic patterns for the language/framework?
- **Performance and scalability**: Are there obvious bottlenecks or scalability concerns?
- **Maintainability**: Is the code clear, well-named, and easy to modify later?
- **Security**: Are there any security concerns (if applicable)?`,
};

export function buildStage1Prompt(
	content: string,
	reviewType: ReviewType,
	extraInstructions: string,
): string {
	const criteria = REVIEW_CRITERIA[reviewType];
	const extra = extraInstructions.trim() ? `\n\nAdditional focus areas from the requester:\n${extraInstructions.trim()}` : "";

	return `You are a senior engineer performing a thorough ${reviewType} review. Be direct, specific, and constructive.

Evaluate the following ${reviewType} on these criteria:
${criteria}${extra}

Structure your review with clear sections for each criterion. Be concrete — cite specific parts of the document when raising issues. End with a brief summary of the most critical findings.

---

${content}`;
}

export function buildStage2Prompt(
	anonymizedReviews: Array<{ label: string; content: string }>,
	reviewType: ReviewType,
): string {
	const reviewsText = anonymizedReviews
		.map(({ label, content }) => `## ${label}\n\n${content}`)
		.join("\n\n---\n\n");

	return `You are evaluating the quality of ${reviewType} reviews written by other engineers. Your goal is to identify which reviews are most useful and thorough.

For each review below, briefly assess:
- Depth and specificity (does it cite concrete issues or is it vague?)
- Coverage (does it catch important problems others might miss?)
- Actionability (are the suggestions concrete and implementable?)

After evaluating each review, output a final ranking from most useful to least useful using EXACTLY this format:

FINAL RANKING:
1. [Label of most useful review]
2. [Label of second most useful]
3. [Continue for all reviews]

---

${reviewsText}`;
}

export function buildStage3Prompt(
	originalContent: string,
	reviewType: ReviewType,
	reviews: Array<{ model: string; content: string }>,
	rankings: Array<{ model: string; rankedLabels: string[]; labelToModel: Record<string, string> }>,
): string {
	const reviewsText = reviews
		.map(({ model, content }) => `## Review by ${model}\n\n${content}`)
		.join("\n\n---\n\n");

	const rankingsText = rankings
		.map(({ model, rankedLabels, labelToModel }) => {
			const named = rankedLabels.map((label, i) => `${i + 1}. ${labelToModel[label] ?? label}`).join("\n");
			return `### ${model}'s ranking:\n${named}`;
		})
		.join("\n\n");

	return `You are the chairman of a ${reviewType} review council. Multiple engineers have independently reviewed the same ${reviewType} and then ranked each other's reviews. Your job is to synthesize their feedback into a single, actionable verdict.

Produce a synthesis that covers:
1. **Consensus points** — Issues or strengths that multiple reviewers identified
2. **Discrepancies** — Where reviewers disagreed, and which position is better supported
3. **Verdict** — A prioritized list of actionable recommendations (most critical first)

Be direct and concrete. The goal is to give the author a clear picture of what to fix or improve.

---

## Original ${reviewType}

${originalContent}

---

## Individual Reviews

${reviewsText}

---

## Peer Rankings

${rankingsText}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/council/prompts.ts
git commit -m "feat(council): add prompt templates for all stages and review types"
```

---

## Task 4: `council.ts` — 3-stage orchestration

**Files:**
- Create: `extensions/council/council.ts`

- [ ] **Step 1: Create `extensions/council/council.ts`**

```typescript
import type { ReviewType, CouncilConfig } from "./config.js";
import { queryModelsParallel, type ModelResponse } from "./openrouter.js";
import { buildStage1Prompt, buildStage2Prompt, buildStage3Prompt } from "./prompts.js";

export interface Stage1Result {
	model: string;
	content: string;
	failed: boolean;
}

export interface Stage2Result {
	reviewerModel: string;
	evaluationText: string;
	ranking: string[]; // ordered labels, e.g. ["Review B", "Review A", "Review C"]
}

export interface AggregateRanking {
	model: string;
	averageRank: number;
	voteCount: number;
}

export interface Stage3Result {
	chairmanModel: string;
	synthesis: string;
}

export interface CouncilResult {
	stage1: Stage1Result[];
	stage2: Stage2Result[];
	stage3: Stage3Result;
	aggregateRankings: AggregateRanking[];
	labelToModel: Record<string, string>;
	modelToLabel: Record<string, string>;
	failedModels: string[];
}

// Parse "FINAL RANKING:\n1. Review C\n2. Review A\n..." from model output
function parseRanking(text: string, validLabels: string[]): string[] {
	const section = text.split(/FINAL RANKING:/i)[1] ?? "";

	// Primary: numbered list "1. Review C"
	const numbered = [...section.matchAll(/\d+\.\s*(Review\s+[A-Z])/gi)].map((m) => m[1].trim());
	if (numbered.length > 0) {
		return numbered.filter((l) => validLabels.includes(l));
	}

	// Fallback: any "Review X" mentions in order
	const mentions = [...section.matchAll(/Review\s+([A-Z])/gi)].map((m) => `Review ${m[1].toUpperCase()}`);
	const seen = new Set<string>();
	return mentions.filter((l) => {
		if (seen.has(l) || !validLabels.includes(l)) return false;
		seen.add(l);
		return true;
	});
}

function computeAggregateRankings(
	stage2: Stage2Result[],
	labelToModel: Record<string, string>,
): AggregateRanking[] {
	const scores: Record<string, number[]> = {};

	for (const { ranking } of stage2) {
		ranking.forEach((label, idx) => {
			const model = labelToModel[label];
			if (!model) return;
			if (!scores[model]) scores[model] = [];
			scores[model].push(idx + 1); // 1-indexed rank
		});
	}

	return Object.entries(scores)
		.map(([model, ranks]) => ({
			model,
			averageRank: ranks.reduce((a, b) => a + b, 0) / ranks.length,
			voteCount: ranks.length,
		}))
		.sort((a, b) => a.averageRank - b.averageRank);
}

export async function runCouncil(
	content: string,
	reviewType: ReviewType,
	extraInstructions: string,
	config: CouncilConfig,
	onStageStart: (stage: 1 | 2 | 3) => void,
): Promise<CouncilResult> {
	// Stage 1
	onStageStart(1);
	const stage1Prompt = buildStage1Prompt(content, reviewType, extraInstructions);
	const rawStage1 = await queryModelsParallel(config.models, stage1Prompt, config.apiKey, config.timeout);

	const failedModels = rawStage1.filter((r) => r.error).map((r) => r.model);
	const successfulStage1 = rawStage1.filter((r) => !r.error && r.content.trim().length > 0);

	if (successfulStage1.length === 0) {
		throw new Error(`All council models failed in Stage 1.\n${rawStage1.map((r) => `${r.model}: ${r.error}`).join("\n")}`);
	}

	// Build label mapping
	const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
	const labelToModel: Record<string, string> = {};
	const modelToLabel: Record<string, string> = {};
	successfulStage1.forEach((r, i) => {
		const label = `Review ${labels[i]}`;
		labelToModel[label] = r.model;
		modelToLabel[r.model] = label;
	});

	const stage1Results: Stage1Result[] = rawStage1.map((r) => ({
		model: r.model,
		content: r.content,
		failed: !!r.error,
	}));

	// Stage 2
	onStageStart(2);
	const anonymizedReviews = successfulStage1.map((r) => ({
		label: modelToLabel[r.model],
		content: r.content,
	}));
	const stage2Prompt = buildStage2Prompt(anonymizedReviews, reviewType);
	const rawStage2 = await queryModelsParallel(
		successfulStage1.map((r) => r.model),
		stage2Prompt,
		config.apiKey,
		config.timeout,
	);

	const validLabels = Object.keys(labelToModel);
	const stage2Results: Stage2Result[] = rawStage2
		.filter((r) => !r.error && r.content.trim().length > 0)
		.map((r) => ({
			reviewerModel: r.model,
			evaluationText: r.content,
			ranking: parseRanking(r.content, validLabels),
		}));

	const aggregateRankings = computeAggregateRankings(stage2Results, labelToModel);

	// Stage 3
	onStageStart(3);
	const reviewsForChairman = successfulStage1.map((r) => ({ model: r.model, content: r.content }));
	const rankingsForChairman = stage2Results.map((r) => ({
		model: r.reviewerModel,
		rankedLabels: r.ranking,
		labelToModel,
	}));
	const stage3Prompt = buildStage3Prompt(content, reviewType, reviewsForChairman, rankingsForChairman);
	const chairmanResponse = await queryModelsParallel([config.chairman], stage3Prompt, config.apiKey, config.timeout);
	const chairmanContent = chairmanResponse[0]?.content ?? "Chairman model failed to produce a synthesis.";

	return {
		stage1: stage1Results,
		stage2: stage2Results,
		stage3: { chairmanModel: config.chairman, synthesis: chairmanContent },
		aggregateRankings,
		labelToModel,
		modelToLabel,
		failedModels,
	};
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/council/council.ts
git commit -m "feat(council): add 3-stage orchestration and ranking parser"
```

---

## Task 5: `index.ts` — Commands, TUI, state

**Files:**
- Create: `extensions/council/index.ts`

- [ ] **Step 1: Create `extensions/council/index.ts`**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, type ReviewType } from "./config.js";
import { runCouncil, type CouncilResult } from "./council.js";

// In-memory store for the last council result (for /council results)
let lastResult: CouncilResult | null = null;

const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
	spec: "Spec",
	plan: "Plan",
	code: "Code",
};

function formatCompactResult(result: CouncilResult): string {
	const lines: string[] = [];

	lines.push("## 🏛️ Council Synthesis\n");
	lines.push(result.stage3.synthesis);
	lines.push("");

	if (result.aggregateRankings.length > 0) {
		lines.push("---\n");
		lines.push("📊 **Council Rankings** (peer-evaluated, lower avg = more useful review):\n");
		result.aggregateRankings.forEach((r, i) => {
			lines.push(`${i + 1}. \`${r.model}\` — avg rank: ${r.averageRank.toFixed(1)} (${r.voteCount} votes)`);
		});
	}

	if (result.failedModels.length > 0) {
		lines.push("");
		lines.push(`⚠️ Models excluded due to errors: ${result.failedModels.join(", ")}`);
	}

	lines.push("");
	lines.push("_Run `/council results` for full details (individual reviews, peer evaluations)_");

	return lines.join("\n");
}

function formatFullResult(result: CouncilResult): string {
	const lines: string[] = [];

	lines.push("# 🏛️ Council Full Results\n");

	lines.push("## Stage 1 — Individual Reviews\n");
	for (const r of result.stage1) {
		if (r.failed) {
			lines.push(`### ❌ ${r.model} (failed)\n`);
			continue;
		}
		lines.push(`### ${r.model}\n`);
		lines.push(r.content);
		lines.push("");
	}

	lines.push("---\n");
	lines.push("## Stage 2 — Peer Evaluations\n");
	for (const r of result.stage2) {
		lines.push(`### Evaluation by ${r.reviewerModel}\n`);
		lines.push(r.evaluationText);
		lines.push("");
		if (r.ranking.length > 0) {
			const namedRanking = r.ranking
				.map((label, i) => `${i + 1}. ${result.labelToModel[label] ?? label}`)
				.join("\n");
			lines.push(`**Parsed ranking:**\n${namedRanking}`);
		}
		lines.push("");
	}

	lines.push("---\n");
	lines.push("## Stage 3 — Chairman Synthesis\n");
	lines.push(`_Chairman: ${result.stage3.chairmanModel}_\n`);
	lines.push(result.stage3.synthesis);

	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	// /council results — show full detail of last run
	pi.registerCommand("council results", {
		description: "Show full details of the last council review",
		handler: async (_args, ctx) => {
			if (!lastResult) {
				ctx.ui.notify("No council results available. Run /council first.", "warning");
				return;
			}
			await pi.sendMessage(formatFullResult(lastResult), { deliverAs: "followUp" });
		},
	});

	// /council — interactive review launcher
	pi.registerCommand("council", {
		description: "Run a council review on a spec, plan, or code file",
		handler: async (_args, ctx) => {
			// Check config first
			const configResult = loadConfig();
			if (!configResult.ok) {
				ctx.ui.notify(configResult.error, "warning");
				return;
			}
			const config = configResult.config;

			// Step 1: Review type
			const reviewTypeChoice = await ctx.ui.select("What do you want to review?", [
				{ label: "Spec", value: "spec" },
				{ label: "Plan", value: "plan" },
				{ label: "Code", value: "code" },
			]);
			if (!reviewTypeChoice) return;
			const reviewType = reviewTypeChoice as ReviewType;

			// Step 2: File path
			const filePath = await ctx.ui.input(`Path to the ${REVIEW_TYPE_LABELS[reviewType]} file:`);
			if (!filePath?.trim()) return;

			const resolvedPath = path.resolve(ctx.cwd, filePath.trim());
			if (!fs.existsSync(resolvedPath)) {
				ctx.ui.notify(`File not found: ${resolvedPath}`, "warning");
				return;
			}

			const content = fs.readFileSync(resolvedPath, "utf-8").trim();
			if (!content) {
				ctx.ui.notify("File is empty.", "warning");
				return;
			}

			// Step 3: Extra instructions
			const extraInstructions = (await ctx.ui.input("Additional instructions (Enter to skip):")) ?? "";

			// Run the council
			ctx.ui.setStatus(`🏛️ Council: Stage 1 — Models reviewing independently... (${config.models.length} models)`);

			try {
				const result = await runCouncil(
					content,
					reviewType,
					extraInstructions,
					config,
					(stage) => {
						const labels: Record<number, string> = {
							1: `🏛️ Council: Stage 1 — Models reviewing independently... (${config.models.length} models)`,
							2: "🏛️ Council: Stage 2 — Peer evaluation in progress...",
							3: "🏛️ Council: Stage 3 — Chairman synthesizing...",
						};
						ctx.ui.setStatus(labels[stage] ?? "🏛️ Council running...");
					},
				);

				ctx.ui.setStatus("");
				lastResult = result;

				await pi.sendMessage(formatCompactResult(result), { deliverAs: "followUp" });
			} catch (err) {
				ctx.ui.setStatus("");
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/council/index.ts
git commit -m "feat(council): add /council and /council results commands with TUI"
```

---

## Task 6: Wire up and smoke-test

**Files:**
- No new files — verify the extension loads in pi

- [ ] **Step 1: Verify extension discovery location**

Check where existing project extensions are linked:
```bash
ls -la .pi/extensions/ 2>/dev/null || echo "No .pi/extensions dir"
ls -la ~/.pi/agent/extensions/ 2>/dev/null || echo "No global extensions dir"
```

- [ ] **Step 2: Link the extension to the discovery location**

If the project uses `.pi/extensions/` (symlink from project root):
```bash
ln -sf ../../extensions/council .pi/extensions/council
```

If using global extensions:
```bash
ln -sf /Users/nacho/Documents/GitHub/pi-tools/extensions/council ~/.pi/agent/extensions/council
```

- [ ] **Step 3: Create `~/.pi/council.json` for testing**

```bash
cat > ~/.pi/council.json << 'EOF'
{
  "apiKey": "YOUR_OPENROUTER_API_KEY",
  "models": [
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-4o",
    "google/gemini-2.5-pro"
  ],
  "chairman": "anthropic/claude-sonnet-4-5",
  "timeout": 120
}
EOF
```

- [ ] **Step 4: Reload pi and verify the command appears**

In pi, run:
```
/reload
```

Then confirm `/council` appears in the command list via `/` tab or:
```
/council
```
Expected: interactive selector appears asking "What do you want to review?"

- [ ] **Step 5: Smoke test against this spec file**

In pi:
```
/council
```
- Choose: `Spec`
- Path: `docs/superpowers/specs/2026-04-19-council-extension-design.md`
- Instructions: (Enter to skip)

Expected: Status bar cycles through stages 1→2→3, then a message appears in the chat with the chairman's synthesis and the rankings table.

- [ ] **Step 6: Test `/council results`**

```
/council results
```

Expected: Full detail appears in chat — all individual reviews (Stage 1), peer evaluations with parsed rankings (Stage 2), and the full chairman synthesis (Stage 3).

- [ ] **Step 7: Test error paths**

**Missing config:**
```bash
mv ~/.pi/council.json ~/.pi/council.json.bak
```
Run `/council` → expected: warning notify with setup instructions.

**File not found:**
```bash
mv ~/.pi/council.json.bak ~/.pi/council.json
```
Run `/council`, choose Spec, enter `nonexistent.md` → expected: warning notify "File not found: ...".

**No prior results:**
Fresh pi session → run `/council results` immediately → expected: warning "No council results available. Run /council first."

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "feat(council): complete council extension — /council and /council results"
```
