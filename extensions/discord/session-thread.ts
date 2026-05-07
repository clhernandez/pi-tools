import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { DiscordBot, SessionMetadata } from "./bot.js";
import type { DiscordConfig } from "./config.js";

export const DISCORD_THREAD_ENTRY = "discord-thread";

export interface ThreadEntryData {
  threadId: string;
  sessionFile: string | null;
  createdAt: number;
}

export function loadPersistedThreadId(ctx: ExtensionContext): string | null {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "custom" && e.customType === DISCORD_THREAD_ENTRY) {
      const data = e.data as ThreadEntryData | undefined;
      if (data?.threadId) return data.threadId;
    }
  }
  return null;
}

export function persistThreadId(pi: ExtensionAPI, ctx: ExtensionContext, threadId: string): void {
  const data: ThreadEntryData = {
    threadId,
    sessionFile: ctx.sessionManager.getSessionFile() ?? null,
    createdAt: Date.now(),
  };
  pi.appendEntry(DISCORD_THREAD_ENTRY, data);
}

export interface SessionMetadataExt extends SessionMetadata {
  basename: string;
  sessionFile: string | null;
}

export function collectMetadata(ctx: ExtensionContext): SessionMetadataExt {
  const model = ctx.model
    ? `${ctx.model.provider}/${ctx.model.id}`
    : "unknown";
  return {
    host: os.hostname(),
    cwd: ctx.cwd,
    basename: path.basename(ctx.cwd) || ctx.cwd,
    branch: readGitBranch(ctx.cwd),
    model,
    sessionFile: ctx.sessionManager.getSessionFile() ?? null,
  };
}

function readGitBranch(cwd: string): string | null {
  try {
    const out = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

export function initialThreadName(meta: SessionMetadataExt): string {
  const time = new Date().toTimeString().slice(0, 5);
  return `pi · ${meta.basename} · ${time}`;
}

export function renamedThreadName(meta: SessionMetadataExt, firstPrompt: string): string {
  const clean = firstPrompt.replace(/\s+/g, " ").trim();
  const truncated = clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
  return `pi · ${meta.basename} · ${truncated}`;
}

export function metadataBlock(meta: SessionMetadataExt): string {
  const lines: string[] = [];
  lines.push("**pi session**");
  lines.push(`🖥️  Host: \`${meta.host}\``);
  lines.push(`📁 Cwd: \`${meta.cwd}\``);
  if (meta.branch) lines.push(`🌿 Branch: \`${meta.branch}\``);
  lines.push(`🤖 Model: \`${meta.model}\``);
  if (meta.sessionFile) lines.push(`🆔 Session: \`${path.basename(meta.sessionFile)}\``);
  return lines.join("\n");
}

export interface EnsureThreadResult {
  threadId: string;
  created: boolean;
}

export async function ensureThread(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  bot: DiscordBot,
  config: DiscordConfig,
): Promise<EnsureThreadResult> {
  const existing = loadPersistedThreadId(ctx);
  if (existing) {
    await bot.unarchiveThread(existing).catch(() => undefined);
    return { threadId: existing, created: false };
  }
  const meta = collectMetadata(ctx);
  const threadId = await bot.createThread(initialThreadName(meta), config.threadArchiveMinutes);
  const msgId = await bot.sendToThread(threadId, metadataBlock(meta));
  await bot.pinMessage(threadId, msgId).catch(() => undefined);
  persistThreadId(pi, ctx, threadId);
  
  // Send embed to parent channel (new session notification)
  await bot.sendSessionStartEmbed(threadId, {
    host: meta.host,
    cwd: meta.cwd,
    branch: meta.branch,
    model: meta.model,
  }).catch(() => undefined);
  
  return { threadId, created: true };
}
