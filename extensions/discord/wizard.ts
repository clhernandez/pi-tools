import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DiscordBot } from "./bot.js";
import { loadConfig, saveConfig, CONFIG_PATH, type DiscordConfig } from "./config.js";

export async function runSetupWizard(ctx: ExtensionCommandContext): Promise<DiscordConfig | null> {
  const existing = safeLoad();

  ctx.ui.notify(
    existing
      ? `Existing config found at ${CONFIG_PATH}. Values will be used as defaults.`
      : "No Discord config found. Let's create one.",
    "info",
  );

  const token = await ctx.ui.input({
    title: "Discord bot token",
    message: "Paste the bot token from https://discord.com/developers/applications",
    default: existing?.token ?? "",
    secret: true,
  });
  if (!token) return null;

  const guildId = await ctx.ui.input({
    title: "Guild (server) ID",
    message: "Right-click your server > Copy Server ID (Developer Mode must be on)",
    default: existing?.guildId ?? "",
  });
  if (!guildId) return null;

  const parentChannelId = await ctx.ui.input({
    title: "Parent channel ID",
    message: "Threads will be created under this text channel. Right-click channel > Copy Channel ID",
    default: existing?.parentChannelId ?? "",
  });
  if (!parentChannelId) return null;

  const ownerId = await ctx.ui.input({
    title: "Your Discord user ID",
    message: "Only messages from this user will be forwarded back to pi. Right-click yourself > Copy User ID",
    default: existing?.ownerId ?? "",
  });
  if (!ownerId) return null;

  const autoStart = await ctx.ui.confirm(
    "Auto-start?",
    "Open a thread automatically every time pi starts? (you can still use /discord on/off manually)",
  );

  const candidate: DiscordConfig = {
    token,
    guildId,
    parentChannelId,
    ownerId,
    autoStart: autoStart ?? false,
    threadArchiveMinutes: existing?.threadArchiveMinutes ?? 60,
  };

  ctx.ui.setStatus("discord-wizard", "Testing connection…");
  const bot = new DiscordBot({ config: candidate, onMessage: () => {} });
  try {
    await bot.login();
  } catch (err) {
    ctx.ui.setStatus("discord-wizard", "");
    ctx.ui.notify(`Connection failed: ${(err as Error).message}`, "error");
    await bot.destroy().catch(() => undefined);
    const retry = await ctx.ui.confirm("Retry?", "Fix values and try again?");
    if (retry) return runSetupWizard(ctx);
    return null;
  }
  await bot.destroy();
  ctx.ui.setStatus("discord-wizard", "");

  saveConfig(candidate);
  ctx.ui.notify(`Config saved to ${CONFIG_PATH} (chmod 600).`, "success");
  return candidate;
}

function safeLoad(): DiscordConfig | null {
  try {
    return loadConfig();
  } catch {
    return null;
  }
}
