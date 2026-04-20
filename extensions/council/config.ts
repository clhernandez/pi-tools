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
