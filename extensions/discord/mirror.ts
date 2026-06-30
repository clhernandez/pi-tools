import type { AgentEndEvent } from "@mariozechner/pi-coding-agent";
import { chunkMessage, type DiscordBot } from "./bot.js";

export function extractFinalAssistantText(event: AgentEndEvent): string | null {
  const messages = event.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const parts = Array.isArray(m.content) ? m.content : [];
    const text = parts
      .filter((p): p is { type: "text"; text: string } => p && (p as { type: string }).type === "text")
      .map((p) => p.text)
      .join("")
      .trim();
    if (text.length > 0) return text;
    return null;
  }
  return null;
}

export async function sendAssistantMessage(bot: DiscordBot, threadId: string, text: string): Promise<void> {
  const chunks = chunkMessage(text);
  for (const chunk of chunks) {
    await bot.sendToThread(threadId, chunk);
  }
}
