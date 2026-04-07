import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CONFIG_PATH = join(process.env.HOME || "", ".pi/agent/subagent-models.json");

type Role = "cheap" | "standard" | "capable";
const ROLES: Role[] = ["cheap", "standard", "capable"];

const ROLE_ICONS: Record<Role, string> = {
  cheap: "⚡",
  standard: "🔧",
  capable: "🧠",
};

interface ModelConfig {
  description: string;
  models: Record<Role, { model: string; description: string }>;
}

const DEFAULT_CONFIG: ModelConfig = {
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

function readConfig(): ModelConfig {
  if (!existsSync(CONFIG_PATH)) {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function writeConfig(config: ModelConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// --- Model picker (same pattern as plan-config) ---

async function pickModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  title: string,
  currentModel: string,
): Promise<string | null> {
  const availableModels = ctx.modelRegistry.getAvailable();
  if (availableModels.length === 0) {
    ctx.ui.notify("No models available. Check your API keys or /login.", "error");
    return null;
  }

  const items: SelectItem[] = availableModels
    .sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    })
    .map((m) => {
      const fullId = `${m.provider}/${m.id}`;
      const isCurrent = fullId === currentModel;
      return {
        value: fullId,
        label: isCurrent ? `${fullId} ✓` : fullId,
        description: m.name,
      };
    });

  const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((str: string) => theme.fg("accent", str)));
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

    const selectList = new SelectList(items, Math.min(items.length, 15), {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    });

    selectList.onSelect = (item: SelectItem) => done(item.value);
    selectList.onCancel = () => done(null);

    container.addChild(selectList);
    container.addChild(
      new Text(theme.fg("dim", "↑↓ navigate • type to filter • enter select • esc cancel"), 1, 0),
    );
    container.addChild(new DynamicBorder((str: string) => theme.fg("accent", str)));

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });

  if (!result) return null;
  return result.replace(" ✓", "");
}

export default function (pi: ExtensionAPI) {
  // --- Interactive config command (like /plan-config) ---

  pi.registerCommand("subagent-config", {
    description: "Configure subagent models interactively",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("subagent-config requires interactive mode", "error");
        return;
      }

      const config = readConfig();
      let configChanged = false;

      while (true) {
        const menuItems = ROLES.map((role) => {
          const info = config.models[role];
          return `${ROLE_ICONS[role]} ${role}: ${info.model}`;
        });

        menuItems.push(
          configChanged ? "💾 Save & exit" : "← Back",
          "🔄 Reset to defaults",
        );

        const choice = await ctx.ui.select("Subagent Model Configuration", menuItems);

        if (!choice || choice === "← Back") break;

        if (choice.startsWith("💾 Save")) {
          writeConfig(config);
          ctx.ui.notify(`Config saved to ${CONFIG_PATH}`, "info");
          break;
        }

        if (choice.startsWith("🔄 Reset")) {
          const ok = await ctx.ui.confirm("Reset?", "Reset all subagent models to defaults?");
          if (ok) {
            Object.assign(config.models, DEFAULT_CONFIG.models);
            configChanged = true;
            ctx.ui.notify("Models reset to defaults (save to persist)", "info");
          }
          continue;
        }

        // Parse selected role from the menu item
        const selectedRole = ROLES.find((r) => choice.includes(`${r}:`));
        if (!selectedRole) continue;

        const picked = await pickModel(
          pi,
          ctx,
          `Select model for ${selectedRole.toUpperCase()}`,
          config.models[selectedRole].model,
        );

        if (picked) {
          config.models[selectedRole].model = picked;
          configChanged = true;
          ctx.ui.notify(`${selectedRole} → ${picked}`, "info");
        }
      }
    },
  });

  // --- Quick-show command ---

  pi.registerCommand("subagent-models", {
    description: "Show current subagent model configuration",
    handler: async (_args, ctx) => {
      const config = readConfig();
      const theme = ctx.ui.theme;
      let output = "\n" + theme.bold("Subagent Model Configuration") + "\n\n";

      for (const role of ROLES) {
        const info = config.models[role];
        output += `${ROLE_ICONS[role]} ${theme.fg("warning", role.toUpperCase())}\n`;
        output += `  Model:   ${theme.fg("accent", info.model)}\n`;
        output += `  Purpose: ${theme.fg("muted", info.description)}\n\n`;
      }

      output += theme.fg("dim", `Config: ${CONFIG_PATH}`);
      output += theme.fg("dim", "\nUse /subagent-config to change models interactively");
      ctx.ui.notify(output, "info");
    },
  });

  // --- LLM Tools ---

  pi.registerTool({
    name: "get_subagent_models",
    label: "Get Subagent Models",
    description:
      "Get the current subagent model configuration. Returns the model mapping for cheap, standard, and capable roles.",
    parameters: Type.Object({}),
    async execute() {
      const config = readConfig();
      return {
        content: [{ type: "text", text: JSON.stringify(config.models, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "update_subagent_model",
    label: "Update Subagent Model",
    description:
      "Update the model for a specific subagent role. Use this when the user wants to experiment with different models.",
    parameters: Type.Object({
      role: StringEnum(["cheap", "standard", "capable"] as const, {
        description: "Role to update: cheap, standard, or capable",
      }),
      model: Type.String({
        description: "New model identifier (e.g., openrouter/anthropic/claude-opus-4.6)",
      }),
    }),
    async execute(toolCallId, params) {
      const { role, model } = params as { role: string; model: string };
      const config = readConfig();
      const oldModel = config.models[role as Role].model;
      config.models[role as Role].model = model;
      writeConfig(config);

      return {
        content: [{ type: "text", text: `Updated ${role} model:\n  Old: ${oldModel}\n  New: ${model}` }],
        details: {},
      };
    },
  });
}
