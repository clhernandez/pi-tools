import type { ReviewType, CouncilConfig } from "./config.js";
import { queryModelsParallel, type GetApiKeyAndHeaders, type ProgressEvent } from "./openrouter.js";
import { buildStage1Prompt, buildStage2Prompt, buildStage3Prompt } from "./prompts.js";

export type { ProgressEvent } from "./openrouter.js";

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
	const section = text.split(/FINAL RANKING:/i)[1] ?? text;

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

export interface RunCouncilHooks {
	onStageStart: (stage: 1 | 2 | 3, models: string[]) => void;
	onProgress?: (stage: 1 | 2 | 3, event: ProgressEvent) => void;
	getApiKeyAndHeaders: GetApiKeyAndHeaders;
	signal?: AbortSignal;
}

export async function runCouncil(
	content: string,
	reviewType: ReviewType,
	extraInstructions: string,
	config: CouncilConfig,
	hooks: RunCouncilHooks,
): Promise<CouncilResult> {
	const { onStageStart, onProgress, getApiKeyAndHeaders, signal } = hooks;

	// Stage 1
	onStageStart(1, config.models);
	const stage1Prompt = buildStage1Prompt(content, reviewType, extraInstructions);
	const rawStage1 = await queryModelsParallel(
		config.models,
		stage1Prompt,
		config.timeout,
		getApiKeyAndHeaders,
		(e) => onProgress?.(1, e),
		signal,
	);

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

	// Stage 2 — each model evaluates only the OTHER models' reviews (not its own)
	const stage2Models = successfulStage1.map((r) => r.model);
	onStageStart(2, stage2Models);

	const allAnonymizedReviews = successfulStage1.map((r) => ({
		model: r.model,
		label: modelToLabel[r.model],
		content: r.content,
	}));

	const rawStage2 = await Promise.all(
		successfulStage1.map(async (reviewer) => {
			// Exclude the reviewer's own review
			const peersReviews = allAnonymizedReviews
				.filter((r) => r.model !== reviewer.model)
				.map((r) => ({ label: r.label, content: r.content }));
			const prompt = buildStage2Prompt(peersReviews, reviewType);
			onProgress?.(2, { type: "start", model: reviewer.model });
			const results = await queryModelsParallel(
				[reviewer.model],
				prompt,
				config.timeout,
				getApiKeyAndHeaders,
				undefined,
				signal,
			);
			const r = results[0];
			onProgress?.(2, { type: "done", model: reviewer.model, ok: !r.error, error: r.error });
			return r;
		}),
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
	onStageStart(3, [config.chairman]);
	const reviewsForChairman = successfulStage1.map((r) => ({ model: r.model, content: r.content }));
	const rankingsForChairman = stage2Results.map((r) => ({
		model: r.reviewerModel,
		rankedLabels: r.ranking,
		labelToModel,
	}));
	const stage3Prompt = buildStage3Prompt(content, reviewType, reviewsForChairman, rankingsForChairman);
	const chairmanResponse = await queryModelsParallel(
		[config.chairman],
		stage3Prompt,
		config.timeout,
		getApiKeyAndHeaders,
		(e) => onProgress?.(3, e),
		signal,
	);
	const chairmanRaw = chairmanResponse[0];
	const chairmanContent = chairmanRaw?.content?.trim()
		? chairmanRaw.content
		: `⚠️ Chairman model (${config.chairman}) failed to produce a synthesis.${
				chairmanRaw?.error ? `\n\n**Error:** \`${chairmanRaw.error}\`` : ""
			}`;

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
