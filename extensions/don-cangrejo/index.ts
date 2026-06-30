/**
 * Don Cangrejo — Session cost tracker in the macOS status bar
 *
 * Shows a $ icon in the menu bar that displays the current session cost.
 * Color changes based on spending level:
 *   - Green: < $5
 *   - Yellow: $5 - $15
 *   - Red: > $15
 *
 * Features:
 *   - Auto-names sessions with relative path (~/path/to/project)
 *   - Multi-session support via Unix socket
 *
 * Commands:
 *   /costs           — show detailed cost breakdown
 *   /costs on        — enable status bar auto-start
 *   /costs off       — disable & remove status bar
 *   /costs dismiss   — remove status bar (keeps setting)
 *   /costs refresh   — force refresh from logs
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const SWIFT_SOURCE = join(EXTENSION_DIR, "CrabOverlay.swift");
const SWIFT_BINARY = join(EXTENSION_DIR, ".build", "CrabOverlay");
const CONFIG_FILE = join(EXTENSION_DIR, ".config.json");

// ── Pi Session Parsing ─────────────────────────────────────────────

interface PiAssistantMessage {
  role: "assistant";
  model?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}

interface PiSessionEntry {
  type?: string;
  timestamp?: string;
  message?: PiAssistantMessage;
}

interface DayCost {
  date: string;
  costUsd: number;
}

interface UsageData {
  todayCost: number;
  recentDays: DayCost[];
}

function getDateInTimezone(date: Date, offsetHours: number = -6): string {
  const local = new Date(date.getTime() + offsetHours * 3600000);
  return local.toISOString().split("T")[0]!;
}

async function loadSessionUsage(sessionFile: string): Promise<UsageData> {
  const today = getDateInTimezone(new Date());
  const costsByDay = new Map<string, number>();

  try {
    const content = readFileSync(sessionFile, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry: PiSessionEntry = JSON.parse(line);
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (!msg || msg.role !== "assistant" || !msg.usage?.cost) continue;

        const timestamp = entry.timestamp;
        if (!timestamp) continue;

        const dt = new Date(timestamp);
        const date = getDateInTimezone(dt);
        const cost = msg.usage.cost.total;

        costsByDay.set(date, (costsByDay.get(date) ?? 0) + cost);
      } catch {}
    }
  } catch {}

  const todayCost = costsByDay.get(today) ?? 0;

  const days: DayCost[] = Array.from(costsByDay.entries())
    .map(([date, costUsd]) => ({ date, costUsd }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);

  return { todayCost, recentDays: days };
}

// ── Socket communication ────────────────────────────────────────────

const SOCKET_PATH = "/tmp/don-cangrejo.sock";

function socketExists(): boolean {
  try {
    return existsSync(SOCKET_PATH);
  } catch {
    return false;
  }
}

async function sendViaSocket(type: string, value?: string): Promise<boolean> {
  if (!socketExists()) return false;
  try {
    const { execSync } = await import("node:child_process");
    execSync(`"${SWIFT_BINARY}" --send-cost "${value ?? ""}"`, { timeout: 2000 });
    return true;
  } catch {
    // Socket exists but process is dead — clean up stale socket
    try { const fs = await import("node:fs"); fs.unlinkSync(SOCKET_PATH); } catch {}
    return false;
  }
}

async function sendCostToExisting(cost: string): Promise<boolean> {
  return sendViaSocket("cost", cost);
}

async function quitExisting(): Promise<boolean> {
  if (!socketExists()) return false;
  try {
    const { execSync } = await import("node:child_process");
    execSync(`"${SWIFT_BINARY}" --send-quit`, { timeout: 2000 });
    return true;
  } catch {
    try { const fs = await import("node:fs"); fs.unlinkSync(SOCKET_PATH); } catch {}
    return false;
  }
}

// ── Swift Binary ────────────────────────────────────────────────────

async function ensureBinary(): Promise<string> {
  mkdirSync(join(EXTENSION_DIR, ".build"), { recursive: true });
  if (existsSync(SWIFT_BINARY)) {
    const src = statSync(SWIFT_SOURCE);
    const bin = statSync(SWIFT_BINARY);
    if (bin.mtimeMs > src.mtimeMs) return SWIFT_BINARY;
  }
  return new Promise<string>((resolve, reject) => {
    const proc = spawn("swiftc", ["-O", "-framework", "AppKit", "-o", SWIFT_BINARY, SWIFT_SOURCE]);
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) =>
      code === 0 ? resolve(SWIFT_BINARY) : reject(new Error(`Build failed: ${stderr}`))
    );
    proc.on("error", reject);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function send(proc: ChildProcess, type: string, value?: string) {
  if (!proc.stdin?.writable) return;
  proc.stdin.write(JSON.stringify({ type, value: value ?? null }) + "\n");
}

// ── Config ──────────────────────────────────────────────────────────

interface CrabConfig {
  autoStart: boolean;
}

function loadConfig(): CrabConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch {}
  return { autoStart: false };
}

function saveConfig(config: CrabConfig) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ── Extension ───────────────────────────────────────────────────────

export default function donCangrejo(pi: ExtensionAPI) {
  let crabProcess: ChildProcess | null = null;
  let currentCost = 0;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let sessionFile: string | undefined;
  const config = loadConfig();

  async function startStatusBar(ctx: ExtensionContext) {
    if (crabProcess) return;

    // If another session already has the status bar running, just send cost via socket
    if (socketExists()) {
      // Verify the socket is actually alive by trying to send a cost update
      const costSent = await sendCostToExisting("0");
      if (costSent) {
        await refreshCost();
        refreshTimer = setInterval(() => refreshCost(), 60_000);
        ctx.ui.notify("$ Don Cangrejo — reusing existing status bar", "info");
        return;
      }
      // Socket was stale — cleaned up in sendCostToExisting, fall through to start fresh
    }

    try {
      const binary = await ensureBinary();
      crabProcess = spawn(binary, [], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      crabProcess.on("close", () => {
        crabProcess = null;
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
      });

      crabProcess.on("error", (err) => {
        ctx.ui.notify(`Status bar error: ${err.message}`, "error");
        crabProcess = null;
      });

      // Wait a moment for socket to be ready
      await new Promise((r) => setTimeout(r, 500));

      // Initial cost update
      await refreshCost();

      // Refresh every 60 seconds
      refreshTimer = setInterval(() => refreshCost(), 60_000);

      ctx.ui.notify("$ Don Cangrejo is in the status bar!", "info");
    } catch (err: any) {
      ctx.ui.notify(`Failed to start: ${err.message}`, "error");
    }
  }

  function stopStatusBar() {
    // If we own the process, kill it
    if (crabProcess) {
      send(crabProcess, "quit");
      setTimeout(() => {
        if (crabProcess && !crabProcess.killed) {
          crabProcess.kill("SIGTERM");
        }
        crabProcess = null;
      }, 500);
    }
    // If another session owns it, tell it to quit via socket
    quitExisting();
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  async function refreshCost() {
    if (!sessionFile) return { todayCost: 0, recentDays: [] };
    const usage = await loadSessionUsage(sessionFile);
    currentCost = usage.todayCost;

    // If we own the process, use stdin
    if (crabProcess) {
      send(crabProcess, "cost", String(currentCost));
    } else if (socketExists()) {
      // Another session owns it, send via socket
      await sendCostToExisting(String(currentCost));
    }

    return usage;
  }

  // Auto-name session with relative path and capture session file
  pi.on("session_start", async (_event, ctx) => {
    try {
      const home = homedir();
      const cwd = ctx.cwd;
      const relPath = relative(home, cwd);
      const displayName = relPath.startsWith("..") ? cwd : `~/${relPath}`;
      pi.setSessionName(displayName);
      sessionFile = ctx.sessionManager?.getSessionFile();
    } catch {}
  });

  // Auto-start on session
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (!config.autoStart) return;
    await new Promise((r) => setTimeout(r, 800));
    await startStatusBar(ctx);
  });

  // Update cost after each agent turn
  pi.on("agent_end", async () => {
    if (!crabProcess) return;
    await refreshCost();
  });

  // Clean shutdown
  pi.on("session_shutdown", async () => {
    stopStatusBar();
  });

  // Register command
  pi.registerCommand("costs", {
    description: "Show session costs or control the status bar",
    handler: async (args, ctx) => {
      const arg = (args || "").trim().toLowerCase();

      if (arg === "on") {
        config.autoStart = true;
        saveConfig(config);
        ctx.ui.notify("$ Status bar auto-start enabled!", "info");
        if (!crabProcess) {
          await startStatusBar(ctx);
        }
        return;
      }

      if (arg === "off") {
        config.autoStart = false;
        saveConfig(config);
        stopStatusBar();
        ctx.ui.notify("$ Status bar disabled", "info");
        return;
      }

      if (arg === "dismiss") {
        stopStatusBar();
        ctx.ui.notify("$ Status bar dismissed", "info");
        return;
      }

      if (arg === "refresh") {
        const usage = await refreshCost();
        ctx.ui.notify(`Cost refreshed: $${usage.todayCost.toFixed(2)}`, "info");
        return;
      }

      if (arg === "start" || arg === "show") {
        if (!crabProcess) {
          await startStatusBar(ctx);
        } else {
          ctx.ui.notify("Status bar is already running", "info");
        }
        return;
      }

      // Default: show cost breakdown
      const usage = await refreshCost();

      const lines: string[] = ["$ Don Cangrejo — Session Costs", ""];

      if (usage.recentDays.length === 0) {
        lines.push("  No usage data found");
      } else {
        for (const day of usage.recentDays) {
          const isToday = day.date === getDateInTimezone(new Date());
          const prefix = isToday ? "→ " : "  ";
          const label = isToday ? "Today" : day.date;
          lines.push(`${prefix}${label}: $${day.costUsd.toFixed(2)}`);
        }
      }

      lines.push("");
      lines.push("Commands: /costs on | off | dismiss | refresh | start");

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}