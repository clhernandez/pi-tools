import type { ReviewType, CouncilConfig } from "./config.js";
import { queryModelsParallel } from "./openrouter.js";
import { buildStage1Prompt, buildStage2Prompt, buildStage3Prompt } from "./prompts.js";

type GetApiKeyAndHeaders = (model: object) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }>;

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

export async function runCouncil(
	content: string,
	reviewType: ReviewType,
	extraInstructions: string,
	config: CouncilConfig,
	onStageStart: (stage: 1 | 2 | 3) => void,
	getApiKeyAndHeaders: GetApiKeyAndHeaders,
): Promise<CouncilResult> {
	// Stage 1
	onStageStart(1);
	const stage1Prompt = buildStage1Prompt(content, reviewType, extraInstructions);
	const rawStage1 = await queryModelsParallel(config.models, stage1Prompt, "", config.timeout, getApiKeyAndHeaders);

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
		"",
		config.timeout,
		getApiKeyAndHeaders,
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
	const chairmanResponse = await queryModelsParallel(
		[config.chairman],
		stage3Prompt,
		"",
		config.timeout,
		getApiKeyAndHeaders,
	);
	const chairmanContent = chairmanResponse[0]?.content || "Chairman model failed to produce a synthesis.";

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
