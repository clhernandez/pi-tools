import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DiscordBot } from "./bot.js";
import { loadConfig, saveConfig, CONFIG_PATH, type DiscordConfig } from "./config.js";

export async function runSetupWizard(ctx: ExtensionCommandContext): Promise<DiscordConfig | null> {
  const existing = safeLoad();

  ctx.ui.notify(
    "=" +
      "=".repeat(69) +
      "\n" +
      "Discord Extension Setup\n" +
      "=" +
      "=".repeat(69),
    "info",
  );

  if (existing) {
    ctx.ui.notify("Found existing config. You can update it now.", "info");
  } else {
    ctx.ui.notify(
      "Let's set up the Discord mirror!\n\n" +
        "You'll need:\n" +
        "  1. A Discord server (Create at discord.gg if needed)\n" +
        "  2. A Discord bot token (discord.com/developers/applications)\n" +
        "  3. Developer Mode enabled in Discord\n\n" +
        "Estimated time: 5 minutes",
      "info",
    );
  }

  // ===== Bot Token =====
  ctx.ui.notify(
    "\n" +
      "STEP 1: Bot Token\n" +
      "─".repeat(70) +
      "\n\n" +
      "1. Go to: https://discord.com/developers/applications\n" +
      "2. Click 'New Application'\n" +
      "3. Go to 'Bot' tab\n" +
      "4. Click 'Reset Token' and copy it\n" +
      "5. Paste it here (it will be hidden):",
    "info",
  );

  const token = await ctx.ui.input("Bot token", "Paste your bot token");
  if (!token) {
    ctx.ui.notify("Setup cancelled.", "error");
    return null;
  }

  // ===== Guild ID =====
  ctx.ui.notify(
    "\n" +
      "STEP 2: Guild (Server) ID\n" +
      "─".repeat(70) +
      "\n\n" +
      "1. Open Discord\n" +
      "2. Enable Developer Mode: Settings → Advanced → Developer Mode\n" +
      "3. Right-click your server name on the left\n" +
      "4. Click 'Copy Server ID'\n" +
      "5. Paste it here:",
    "info",
  );

  const guildId = await ctx.ui.input("Server ID", "Paste your server ID (numbers only)");
  if (!guildId) {
    ctx.ui.notify("Setup cancelled.", "error");
    return null;
  }

  // ===== Parent Channel ID =====
  ctx.ui.notify(
    "\n" +
      "STEP 3: Parent Channel ID\n" +
      "─".repeat(70) +
      "\n\n" +
      "This is the text channel where Discord threads will be created.\n\n" +
      "1. In Discord, find a text channel (e.g., #general)\n" +
      "2. Right-click the channel name\n" +
      "3. Click 'Copy Channel ID'\n" +
      "4. Paste it here:",
    "info",
  );

  const parentChannelId = await ctx.ui.input(
    "Channel ID",
    "Paste your channel ID (numbers only)",
  );
  if (!parentChannelId) {
    ctx.ui.notify("Setup cancelled.", "error");
    return null;
  }

  // ===== Owner ID =====
  ctx.ui.notify(
    "\n" +
      "STEP 4: Your Discord User ID\n" +
      "─".repeat(70) +
      "\n\n" +
      "Only YOU can reply in Discord to inject messages back to pi.\n\n" +
      "1. Right-click your name/avatar in Discord\n" +
      "2. Click 'Copy User ID'\n" +
      "3. Paste it here:",
    "info",
  );

  const ownerId = await ctx.ui.input("Your User ID", "Paste your user ID (numbers only)");
  if (!ownerId) {
    ctx.ui.notify("Setup cancelled.", "error");
    return null;
  }

  // ===== Auto-Start =====
  ctx.ui.notify(
    "\n" +
      "STEP 5: Auto-Start Preference\n" +
      "─".repeat(70) +
      "\n\n" +
      "Do you want the Discord mirror to start automatically when you launch pi?\n" +
      "(You can always use /discord on/off manually)",
    "info",
  );

  const autoStart = (await ctx.ui.confirm("Auto-start?", "Enable auto-start?")) ?? false;

  // ===== Before Bot Intents Verification =====
  ctx.ui.notify(
    "\n" +
      "STEP 6: Bot Intents Verification\n" +
      "─".repeat(70) +
      "\n\n" +
      "BEFORE we test, make sure these are enabled in Discord Developer Portal:\n\n" +
      "  1. Go to: https://discord.com/developers/applications\n" +
      "  2. Select your app → Bot tab\n" +
      "  3. Scroll to 'Privileged Gateway Intents'\n" +
      "  4. Enable BOTH:\n" +
      "     ☑ Server Members Intent\n" +
      "     ☑ Message Content Intent\n" +
      "  5. Click 'Save Changes'\n\n" +
      "Ready? We'll test the connection next.",
    "info",
  );

  const ready = await ctx.ui.confirm("Intents enabled?", "Have you enabled the intents above?");
  if (!ready) {
    ctx.ui.notify("Setup cancelled. Enable the intents and try again.", "error");
    return null;
  }

  // ===== Config Object =====
  const candidate: DiscordConfig = {
    token,
    guildId,
    parentChannelId,
    ownerId,
    autoStart,
    threadArchiveMinutes: existing?.threadArchiveMinutes ?? 60,
  };

  // ===== Connection Test =====
  ctx.ui.notify(
    "\n" +
      "TESTING CONNECTION\n" +
      "─".repeat(70),
    "info",
  );

  const bot = new DiscordBot({ config: candidate, onMessage: () => {} });
  try {
    ctx.ui.notify("Connecting to Discord...", "info");
    await bot.login();
    ctx.ui.notify("✓ Connection successful!", "success");
  } catch (err) {
    ctx.ui.notify(`✗ Connection failed: ${(err as Error).message}`, "error");
    await bot.destroy().catch(() => undefined);

    ctx.ui.notify(
      "\nCommon issues:\n" +
        "  • 'Unknown Guild': Bot not in server OR wrong Guild ID\n" +
        "  • 'Disallowed Intents': Enable Message Content Intent (see step 6)\n" +
        "  • Invalid Token: Check bot token is correct\n\n" +
        "Fix the issue and try again.",
      "error",
    );

    const retry = await ctx.ui.confirm("Retry?", "Try setup again?");
    if (retry) return runSetupWizard(ctx);
    return null;
  }
  await bot.destroy();

  // ===== Save Config =====
  saveConfig(candidate);

  ctx.ui.notify(
    "\n" +
      "✓ SETUP COMPLETE!\n" +
      "─".repeat(70) +
      "\n\n" +
      "Config saved to: " +
      CONFIG_PATH +
      "\n\n" +
      "Next steps:\n" +
      "  1. Type: /discord on\n" +
      "  2. A thread will be created in your Discord channel\n" +
      "  3. Ask me anything - responses will appear in Discord!\n" +
      "  4. Reply in Discord to continue the conversation\n",
    "success",
  );

  return candidate;
}

function safeLoad(): DiscordConfig | null {
  try {
    return loadConfig();
  } catch {
    return null;
  }
}
