import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DiscordBot } from "./bot.js";
import { loadConfig, saveConfig, CONFIG_PATH, type DiscordConfig } from "./config.js";

export async function runSetupWizard(ctx: ExtensionCommandContext): Promise<DiscordConfig | null> {
  const existing = safeLoad();
  ctx.ui.notify(existing ? "Updating config..." : "Setting up Discord mirror...", "info");

  const token = await ctx.ui.input("Discord bot token", "Get from https://discord.com/developers/applications");
  if (!token) return null;

  const guildId = await ctx.ui.input("Guild (server) ID", "Right-click server > Copy Server ID");
  if (!guildId) return null;

  const parentChannelId = await ctx.ui.input("Parent channel ID", "Channel for threads - Right-click > Copy Channel ID");
  if (!parentChannelId) return null;

  const ownerId = await ctx.ui.input("Your Discord user ID", "Right-click yourself > Copy User ID");
  if (!ownerId) return null;

  const autoStart = (await ctx.ui.confirm("Auto-start?", "Enable auto-start on session launch?")) ?? false;

  const candidate: DiscordConfig = {
    token,
    guildId,
    parentChannelId,
    ownerId,
    autoStart,
    threadArchiveMinutes: existing?.threadArchiveMinutes ?? 60,
  };

  const bot = new DiscordBot({ config: candidate, onMessage: () => {} });
  try {
    ctx.ui.notify("Testing connection...", "info");
    await bot.login();
  } catch (err) {
    ctx.ui.notify(`Connection failed: ${(err as Error).message}`, "error");
    await bot.destroy().catch(() => undefined);
    const retry = await ctx.ui.confirm("Retry?", "Fix values and try again?");
    if (retry) return runSetupWizard(ctx);
    return null;
  }
  await bot.destroy();

  saveConfig(candidate);
  ctx.ui.notify("Discord config saved ✓", "success");
  return candidate;
}

function safeLoad(): DiscordConfig | null {
  try {
    return loadConfig();
  } catch {
    return null;
  }
}
