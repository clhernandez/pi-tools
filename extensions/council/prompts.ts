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
