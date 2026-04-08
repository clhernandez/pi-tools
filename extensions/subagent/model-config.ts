import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CONFIG_PATH = join(process.env.HOME || "", ".pi/agent/subagent-models.json");

export type Role = "cheap" | "standard" | "capable";
export const ROLES: Role[] = ["cheap", "standard", "capable"];

export interface ModelConfig {
  description: string;
  models: Record<Role, { model: string; description: string }>;
}

export const DEFAULT_CONFIG: ModelConfig = {
  description: "Model selection for subagent-driven-development skill",
  models: {
    cheap: {
      model: "openrouter/minimax/minimax-m2.7",
      description: "Mechanical implementation tasks, isolated functions, clear specs, 1-2 files",
    },
    standard: {
      model: "openrouter/anthropic/claude-sonnet-4.6",
      description: "Integration tasks, multi-file coordination, pattern matching, debugging",
    },
    capable: {
      model: "openrouter/anthropic/claude-opus-4.6",
      description: "Architecture, design, review tasks, broad codebase understanding",
    },
  },
};

export function readSubagentModelConfig(): ModelConfig {
  if (!existsSync(CONFIG_PATH)) {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

export function writeSubagentModelConfig(config: ModelConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
