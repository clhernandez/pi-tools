import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".pi");
export const CONFIG_PATH = path.join(CONFIG_DIR, "discord.json");

export const DiscordConfigSchema = Type.Object({
  token: Type.String({ minLength: 1, description: "Discord bot token" }),
  guildId: Type.String({ minLength: 1, description: "Discord guild (server) id" }),
  parentChannelId: Type.String({ minLength: 1, description: "Channel where threads are created" }),
  ownerId: Type.String({ minLength: 1, description: "Your Discord user id" }),
  autoStart: Type.Boolean({ default: false, description: "Auto-open thread on session_start" }),
  threadArchiveMinutes: Type.Union(
    [Type.Literal(60), Type.Literal(1440), Type.Literal(4320), Type.Literal(10080)],
    { default: 60, description: "Discord auto-archive duration in minutes" },
  ),
});

export type DiscordConfig = Static<typeof DiscordConfigSchema>;

export function loadConfig(): DiscordConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const withDefaults = Value.Default(DiscordConfigSchema, raw);
    if (!Value.Check(DiscordConfigSchema, withDefaults)) {
      const errors = [...Value.Errors(DiscordConfigSchema, withDefaults)].map((e) => `${e.path}: ${e.message}`);
      throw new Error(`Invalid ${CONFIG_PATH}:\n  ${errors.join("\n  ")}`);
    }
    return withDefaults as DiscordConfig;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`${CONFIG_PATH} is not valid JSON: ${err.message}`);
    }
    throw err;
  }
}

export function saveConfig(config: DiscordConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.chmodSync(CONFIG_PATH, 0o600);
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}
