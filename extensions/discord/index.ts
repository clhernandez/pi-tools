import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { DiscordBot } from "./bot.js";
import { loadConfig, saveConfig, configExists, type DiscordConfig } from "./config.js";
import { runSetupWizard } from "./wizard.js";
import { ensureThread, renamedThreadName, collectMetadata, metadataBlock } from "./session-thread.js";
import { extractFinalAssistantText, sendAssistantMessage } from "./mirror.js";

type Subcommand = "setup" | "on" | "off" | "status";
const SUBCOMMANDS: Subcommand[] = ["setup", "on", "off", "status"];

interface State {
  config: DiscordConfig | null;
  bot: DiscordBot | null;
  threadId: string | null;
  renamedForSession: boolean;
}

export default function (pi: ExtensionAPI) {
  const state: State = {
    config: null,
    bot: null,
    threadId: null,
    renamedForSession: false,
  };

  // Try to load config at startup; missing is fine (user will run /discord setup).
  try {
    state.config = configExists() ? loadConfig() : null;
  } catch (err) {
    state.config = null;
    state.bot = null;
    console.error(`[discord] invalid config: ${(err as Error).message}`);
  }

  pi.registerFlag("discord", {
    description: "Auto-start Discord mirror for this session",
    type: "boolean",
  });

  pi.registerCommand("discord", {
    description: "Mirror this pi session to a Discord thread (setup | on | off | status)",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items = SUBCOMMANDS.map((s) => ({ value: s, label: s }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const sub = (args.trim().split(/\s+/)[0] || "status") as Subcommand;
      if (!SUBCOMMANDS.includes(sub)) {
        ctx.ui.notify(`Unknown subcommand '${sub}'. Use: ${SUBCOMMANDS.join(", ")}`, "error");
        return;
      }
      switch (sub) {
        case "setup":
          await handleSetup(ctx, state);
          break;
        case "on":
          await handleOn(pi, ctx, state);
          break;
        case "off":
          await handleOff(ctx, state);
          break;
        case "status":
          handleStatus(ctx, state);
          break;
      }
    },
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!state.bot || !state.threadId) return;
    const text = extractFinalAssistantText(event);
    if (!text) return;
    try {
      await sendAssistantMessage(state.bot, state.threadId, text);
    } catch (err) {
      ctx.ui.notify(`Discord mirror failed: ${(err as Error).message}`, "error");
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const flag = pi.getFlag("--discord");
    const autoFromFlag = flag === true;
    const autoDisabledByFlag = flag === false;
    const autoFromConfig = state.config?.autoStart === true;
    if (autoDisabledByFlag) return;
    if (!autoFromFlag && !autoFromConfig) return;
    await startMirror(pi, ctx, state);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (state.renamedForSession) return;
    if (!state.bot || !state.threadId) return;
    const prompt = (event.prompt ?? "").trim();
    if (!prompt) return;
    const meta = collectMetadata(ctx);
    try {
      await state.bot.renameThread(state.threadId, renamedThreadName(meta, prompt));
      state.renamedForSession = true;
    } catch (err) {
      state.renamedForSession = true; // don't retry
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (!state.bot) return;
    try {
      if (state.threadId) await state.bot.archiveThread(state.threadId).catch(() => undefined);
    } finally {
      await state.bot.destroy().catch(() => undefined);
      state.bot = null;
      state.threadId = null;
      state.renamedForSession = false;
    }
  });
}

async function startMirror(pi: ExtensionAPI, ctx: ExtensionContext, state: State): Promise<void> {
  if (!state.config) return; // silent: autoStart without config is a no-op
  if (state.bot && state.threadId) return; // already on
  const bot = new DiscordBot({
    config: state.config,
    onMessage: (msg) => {
      if (!state.threadId || msg.threadId !== state.threadId) return;
      if (msg.isBot) return;
      if (msg.authorId !== state.config!.ownerId) return;
      const content = msg.content.trim();
      if (!content) return;
      if (content.startsWith("!")) {
        if (content === "!info" && state.threadId && state.bot) {
          const meta = collectMetadata(ctx);
          state.bot.sendToThread(state.threadId, metadataBlock(meta)).catch(() => undefined);
        }
        return; // any ! message is handled here, never forwarded
      }
      try {
        pi.sendUserMessage(content, { deliverAs: "followUp" });
      } catch (err) {
        ctx.ui.notify(`Discord → pi inject failed: ${(err as Error).message}`, "error");
      }
    },
    onError: (err) => ctx.ui.notify(`Discord error: ${(err as Error).message}`, "error"),
  });
  try {
    await bot.login();
    const { threadId, created } = await ensureThread(pi, ctx, bot, state.config);
    state.threadId = threadId;
    state.renamedForSession = !created; // if not freshly created, already named
    state.bot = bot;
  } catch (err) {
    await bot.destroy().catch(() => undefined);
    ctx.ui.notify(`Discord auto-start failed: ${(err as Error).message}`, "error");
  }
}

async function handleSetup(ctx: ExtensionCommandContext, state: State) {
  const cfg = await runSetupWizard(ctx);
  if (cfg) state.config = cfg;
}

async function handleOn(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: State,
) {
  if (!state.config) {
    ctx.ui.notify("No config. Run /discord setup first.", "error");
    return;
  }
  if (state.bot && state.threadId) {
    ctx.ui.notify("Discord mirror already active for this session.", "info");
    return;
  }
  ctx.ui.setStatus("discord", "Connecting to Discord…");
  try {
    await startMirror(pi, ctx as unknown as ExtensionContext, state);
    if (state.threadId) {
      ctx.ui.setStatus("discord", `Thread: ${state.threadId}`);
      ctx.ui.notify(`Discord mirror active. Thread: ${state.threadId}`, "success");
    }
  } catch (err) {
    ctx.ui.setStatus("discord", "");
    ctx.ui.notify(`Failed: ${(err as Error).message}`, "error");
  }
}

async function handleOff(ctx: ExtensionCommandContext, state: State) {
  if (!state.bot) {
    ctx.ui.notify("Discord mirror is not active.", "info");
    return;
  }
  if (state.bot && state.threadId) {
    await state.bot.archiveThread(state.threadId).catch(() => undefined);
  }
  await state.bot.destroy().catch(() => undefined);
  state.bot = null;
  state.threadId = null;
  ctx.ui.setStatus("discord", "");
  ctx.ui.notify("Discord mirror stopped.", "info");
}

function handleStatus(ctx: ExtensionCommandContext, state: State) {
  const lines: string[] = [];
  lines.push(`Config: ${state.config ? "loaded" : "missing (run /discord setup)"}`);
  lines.push(`Bot: ${state.bot ? "connected" : "disconnected"}`);
  lines.push(`Thread: ${state.threadId ?? "none"}`);
  if (state.config) {
    lines.push(`AutoStart: ${state.config.autoStart}`);
    lines.push(`Guild: ${state.config.guildId}`);
    lines.push(`Parent channel: ${state.config.parentChannelId}`);
  }
  ctx.ui.notify(lines.join("\n"), "info");
}
