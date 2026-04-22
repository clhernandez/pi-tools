import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ReviewType = "spec" | "plan" | "code";

export interface CouncilConfig {
	models: string[];
	chairman: string;
	timeout: number;
}

export interface CouncilConfigFile {
	models?: string[];
	chairman?: string;
	timeout?: number;
}

export type ConfigLoadResult =
	| { ok: true; config: CouncilConfig }
	| { ok: false; error: string };

export const CONFIG_PATH = path.join(os.homedir(), ".pi", "council.json");

export function saveConfig(config: CouncilConfig): void {
	const dir = path.dirname(CONFIG_PATH);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function loadConfig(): ConfigLoadResult {
	let raw: CouncilConfigFile = {};

	if (fs.existsSync(CONFIG_PATH)) {
		try {
			raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as CouncilConfigFile;
		} catch {
			return { ok: false, error: `Failed to parse ${CONFIG_PATH}: invalid JSON` };
		}
	}

	const models = raw.models ?? [];
	if (models.length < 2) {
		return { ok: false, error: "Council requires at least 2 models for peer review. Add more models to ~/.pi/council.json" };
	}

	return {
		ok: true,
		config: {
			models,
			chairman: raw.chairman ?? models[0],
			timeout: raw.timeout ?? 120,
		},
	};
}
