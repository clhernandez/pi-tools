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
