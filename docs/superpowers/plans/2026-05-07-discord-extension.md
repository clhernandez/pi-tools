# Discord Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pi extension `/discord` that mirrors final assistant messages to a dedicated Discord thread per pi session, and allows the session owner to reply from Discord (injecting the message as user input). Non-invasive: anti-spam (only final assistant messages, no tool calls / streaming), opt-in per session or via auto-start.

**Architecture:** Extension at `extensions/discord/` using `discord.js` v14. Each pi session owns a thread inside a configurable parent channel. The mapping `sessionFile → threadId` is persisted via `pi.appendEntry` so it survives `/reload` and `/resume`. Config lives in `~/.pi/discord.json` (chmod 600). Owner is identified by a single Discord user ID; non-owner messages in the thread are ignored. The `agent_end` hook mirrors the last assistant message to the thread. A `messageCreate` listener (filtered by `threadId + ownerId + !bot`) calls `pi.sendUserMessage` to inject the reply back into the session (`"steer"` while streaming, `"followUp"` when idle — though we only fire when idle in practice, since messages only leave pi at `agent_end`).

**Tech Stack:** TypeScript, `discord.js` ^14, pi extension API (`@mariozechner/pi-coding-agent`), `@sinclair/typebox` for config schema. Node built-ins (`node:fs`, `node:path`, `node:os`). No test runner (per user decision).

---

## File Structure

```
extensions/discord/
├── package.json        # discord.js dep, pi.extensions entry
├── README.md           # bot setup guide (Discord Developer Portal steps), permissions, OAuth URL
├── index.ts            # entry point: default export, registers commands + hooks
├── config.ts           # load/save ~/.pi/discord.json, schema, chmod 600
├── bot.ts              # DiscordBot class: login, thread create/archive/unarchive, send, listen
├── mirror.ts           # agent_end handler → extract last assistant message → send to Discord
├── session-thread.ts   # session ↔ thread mapping: appendEntry persistence, reconstruction, metadata
└── wizard.ts           # /discord setup interactive flow
```

Root changes:
- `package.json` — no change needed; `pi.extensions` already points at `./extensions` which is scanned recursively.
- `.gitignore` — already updated for `.worktrees`.

Responsibilities:
- **index.ts** — thin glue: reads config, boots `DiscordBot` lazily, registers `/discord` command family, wires hooks (`session_start`, `agent_end`, `session_shutdown`, `input` for RPC source detection if needed). Holds the single `DiscordBot` instance and `SessionThread` state for the current pi session.
- **config.ts** — pure I/O + validation. No Discord knowledge.
- **bot.ts** — pure Discord wrapper. No pi knowledge. Takes callbacks for incoming messages.
- **mirror.ts** — pure message formatting (pi assistant message → Discord embed/text chunks). Handles 2000-char limit.
- **session-thread.ts** — persistence + metadata. Knows about `appendEntry`, knows how to build thread name and pinned metadata block.
- **wizard.ts** — interactive setup only.

---

### Task 1: Scaffolding

**Files:**
- Create: `extensions/discord/package.json`
- Create: `extensions/discord/index.ts`
- Create: `extensions/discord/README.md` (stub — filled in Task 13)

- [ ] **Step 1.1: Create `extensions/discord/package.json`**

```json
{
  "name": "@nacho/pi-discord-extension",
  "version": "0.1.0",
  "private": true,
  "description": "Mirror pi sessions to Discord threads",
  "dependencies": {
    "discord.js": "^14.16.3"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  },
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

- [ ] **Step 1.2: Install `discord.js` in the extension directory**

Run:

```bash
cd extensions/discord && npm install --omit=dev
```

Expected: `node_modules/discord.js` present, no peer dep warnings that block install. discord.js may warn about optional `bufferutil`/`utf-8-validate` — that is fine.

- [ ] **Step 1.3: Create minimal `extensions/discord/index.ts`**

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("discord", {
    description: "Mirror this pi session to a Discord thread",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Discord extension loaded (scaffolding).", "info");
    },
  });
}
```

- [ ] **Step 1.4: Create stub `extensions/discord/README.md`**

```markdown
# Discord Extension

Mirror pi sessions to Discord threads. See implementation plan for details.
Setup instructions will be added in the final task.
```

- [ ] **Step 1.5: Smoke test — load the extension in pi**

Run:

```bash
cd /Users/francisco/Documents/github/pi-tools/.worktrees/discord-extension
pi -e ./extensions/discord/index.ts -p "say hello"
```

Expected: pi runs without error loading the extension. The `/discord` command is registered (can be inspected with `/help` in interactive mode, but print mode just needs to boot cleanly).

If the extension fails to load, inspect the error: most likely a missing dep, a typo, or a TypeScript issue. Fix before moving on — a broken scaffold blocks every subsequent task.

- [ ] **Step 1.6: Commit**

```bash
git add extensions/discord/
git commit -m "feat(discord): scaffold extension with stub /discord command"
```

---

### Task 2: Config loader

**Files:**
- Create: `extensions/discord/config.ts`

The config file lives at `~/.pi/discord.json`. It contains the bot token, so we `chmod 600` on every write. We validate with typebox for forward compatibility (extra fields are ignored, missing required fields produce a clear error).

- [ ] **Step 2.1: Create `extensions/discord/config.ts`**

```typescript
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
    // Fill defaults for optional fields
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
  // Explicit chmod in case the file already existed with looser perms.
  fs.chmodSync(CONFIG_PATH, 0o600);
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}
```

- [ ] **Step 2.2: Sanity-check the import path**

The extension loads via jiti (no compile step), so TypeScript imports of `@sinclair/typebox` and `@sinclair/typebox/value` must resolve from the repo's `node_modules`. Confirm:

```bash
ls /Users/francisco/Documents/github/pi-tools/node_modules/@sinclair/typebox/value 2>/dev/null && echo OK
```

Expected: `OK`. If not, add `@sinclair/typebox` to `extensions/discord/package.json` peerDependencies fallback by promoting it to `dependencies` and `npm install` in `extensions/discord`. (typebox is a peer dep of pi itself, so it should already be present.)

- [ ] **Step 2.3: Commit**

```bash
git add extensions/discord/config.ts
git commit -m "feat(discord): config loader with typebox schema and chmod 600"
```

---

### Task 3: Discord bot wrapper

**Files:**
- Create: `extensions/discord/bot.ts`

This is the only file that touches `discord.js`. It exposes a small async-friendly API to the rest of the extension. Consumers pass callbacks; they do NOT import `discord.js` types.

- [ ] **Step 3.1: Create `extensions/discord/bot.ts`**

```typescript
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  ChannelType,
  type TextChannel,
  type ThreadChannel,
  type Message,
} from "discord.js";
import type { DiscordConfig } from "./config.js";

export interface IncomingMessage {
  threadId: string;
  authorId: string;
  authorUsername: string;
  content: string;
  isBot: boolean;
}

export interface BotOptions {
  config: DiscordConfig;
  onMessage: (msg: IncomingMessage) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

/**
 * Thin wrapper around discord.js. One instance per pi process.
 * Owns the websocket connection and knows how to open, write to,
 * and archive a thread inside the configured parent channel.
 */
export class DiscordBot {
  private client: Client;
  private readyPromise: Promise<void>;
  private opts: BotOptions;
  private parentChannel: TextChannel | null = null;

  constructor(opts: BotOptions) {
    this.opts = opts;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.client.once(Events.ClientReady, () => resolve());
      this.client.once(Events.Error, reject);
    });

    this.client.on(Events.MessageCreate, (message: Message) => {
      if (!message.channel.isThread()) return;
      void this.opts.onMessage({
        threadId: message.channelId,
        authorId: message.author.id,
        authorUsername: message.author.username,
        content: message.content,
        isBot: message.author.bot,
      });
    });

    this.client.on(Events.Error, (err) => {
      this.opts.onError?.(err);
    });
  }

  async login(): Promise<void> {
    await this.client.login(this.opts.config.token);
    await this.readyPromise;
    const guild = await this.client.guilds.fetch(this.opts.config.guildId);
    const channel = await guild.channels.fetch(this.opts.config.parentChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error(
        `parentChannelId ${this.opts.config.parentChannelId} is not a text channel in guild ${this.opts.config.guildId}`,
      );
    }
    this.parentChannel = channel as TextChannel;
  }

  async destroy(): Promise<void> {
    await this.client.destroy();
  }

  /** Create a new public thread under the configured parent channel. */
  async createThread(name: string, autoArchiveMinutes: 60 | 1440 | 4320 | 10080): Promise<string> {
    if (!this.parentChannel) throw new Error("Bot not logged in");
    const thread = await this.parentChannel.threads.create({
      name: name.slice(0, 100), // Discord thread name limit
      autoArchiveDuration: autoArchiveMinutes,
      type: ChannelType.PublicThread,
      reason: "pi session mirror",
    });
    return thread.id;
  }

  async renameThread(threadId: string, newName: string): Promise<void> {
    const thread = await this.fetchThread(threadId);
    if (thread) await thread.setName(newName.slice(0, 100));
  }

  async archiveThread(threadId: string): Promise<void> {
    const thread = await this.fetchThread(threadId);
    if (thread && !thread.archived) await thread.setArchived(true, "pi session ended");
  }

  async unarchiveThread(threadId: string): Promise<void> {
    const thread = await this.fetchThread(threadId);
    if (thread && thread.archived) await thread.setArchived(false, "pi session resumed");
  }

  /** Send a message to a thread. Returns the Discord message id. */
  async sendToThread(threadId: string, content: string): Promise<string> {
    const thread = await this.fetchThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    if (thread.archived) await thread.setArchived(false, "pi resumed mirroring");
    const msg = await thread.send({ content: content.slice(0, 2000) });
    return msg.id;
  }

  async pinMessage(threadId: string, messageId: string): Promise<void> {
    const thread = await this.fetchThread(threadId);
    if (!thread) return;
    const msg = await thread.messages.fetch(messageId).catch(() => null);
    if (msg) await msg.pin().catch(() => undefined);
  }

  private async fetchThread(threadId: string): Promise<ThreadChannel | null> {
    try {
      const channel = await this.client.channels.fetch(threadId);
      if (channel && channel.isThread()) return channel;
    } catch {
      // fall through
    }
    return null;
  }
}

/**
 * Split a long message into chunks under Discord's 2000-char limit.
 * Tries to break at newlines; falls back to hard slice.
 */
export function chunkMessage(text: string, max = 1900): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max; // no decent newline; hard cut
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
```

- [ ] **Step 3.2: Smoke test the import**

No live bot test here (needs a real token). Just confirm it compiles/loads via pi:

```bash
cd /Users/francisco/Documents/github/pi-tools/.worktrees/discord-extension
pi -e ./extensions/discord/index.ts -p "hello"
```

Expected: loads cleanly. `bot.ts` is imported lazily in later tasks — it is not wired into `index.ts` yet, so this step just ensures syntax is correct. You can run `node --check` equivalent by loading:

```bash
node -e "import('./extensions/discord/bot.ts').catch(e => { console.error(e); process.exit(1); })" 2>&1 | head -20
```

Note: this last command will fail because Node cannot directly import `.ts`, so skip it — pi's jiti loader handles TS. The real validation is the `pi -e` run above and then Task 5 when it is wired up.

- [ ] **Step 3.3: Commit**

```bash
git add extensions/discord/bot.ts extensions/discord/package.json extensions/discord/package-lock.json extensions/discord/node_modules 2>/dev/null; git add extensions/discord/bot.ts
git commit -m "feat(discord): discord.js bot wrapper with thread lifecycle"
```

Note: `extensions/discord/node_modules` should NOT be committed. Make sure the add does not pull it in (the 2>/dev/null swallows missing-path errors; the second `git add` is the canonical one). If needed, add `extensions/*/node_modules` to the project `.gitignore` before committing:

```bash
grep -q "extensions/\*/node_modules" .gitignore || printf "\nextensions/*/node_modules\n" >> .gitignore
git add .gitignore
```

---

### Task 4: Setup wizard

**Files:**
- Create: `extensions/discord/wizard.ts`

`/discord setup` walks the user through creating the config. It uses `ctx.ui.input`, `ctx.ui.confirm`, `ctx.ui.notify`. It attempts a live login + channel fetch before saving, so broken configs never get persisted.

- [ ] **Step 4.1: Create `extensions/discord/wizard.ts`**

```typescript
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
```

- [ ] **Step 4.2: Commit**

```bash
git add extensions/discord/wizard.ts
git commit -m "feat(discord): /discord setup interactive wizard"
```

---

### Task 5: /discord command router (setup / on / off / status)

**Files:**
- Modify: `extensions/discord/index.ts`

`/discord` with no args prints help. Subcommands: `setup`, `on`, `off`, `status`. Implement a single dispatcher so argument autocomplete can list them.

At this stage we only wire `setup` and stubbed `on|off|status` that report state. Full thread lifecycle arrives in Task 6, mirroring in Task 7.

- [ ] **Step 5.1: Replace `extensions/discord/index.ts` with the dispatcher**

```typescript
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { DiscordBot } from "./bot.js";
import { loadConfig, configExists, type DiscordConfig } from "./config.js";
import { runSetupWizard } from "./wizard.js";

type Subcommand = "setup" | "on" | "off" | "status";
const SUBCOMMANDS: Subcommand[] = ["setup", "on", "off", "status"];

interface State {
  config: DiscordConfig | null;
  bot: DiscordBot | null;
  threadId: string | null;
}

export default function (pi: ExtensionAPI) {
  const state: State = { config: null, bot: null, threadId: null };

  // Try to load config at startup; missing is fine (user will run /discord setup).
  try {
    state.config = configExists() ? loadConfig() : null;
  } catch (err) {
    // Defer notification to the first command invocation since ctx.ui is not yet available here.
    state.config = null;
    state.bot = null;
    console.error(`[discord] invalid config: ${(err as Error).message}`);
  }

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
          await handleOn(ctx, state);
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
}

async function handleSetup(ctx: ExtensionCommandContext, state: State) {
  const cfg = await runSetupWizard(ctx);
  if (cfg) state.config = cfg;
}

async function handleOn(ctx: ExtensionCommandContext, state: State) {
  if (!state.config) {
    ctx.ui.notify("No config. Run /discord setup first.", "error");
    return;
  }
  if (state.bot && state.threadId) {
    ctx.ui.notify("Discord mirror already active for this session.", "info");
    return;
  }
  ctx.ui.setStatus("discord", "Connecting to Discord…");
  const bot = new DiscordBot({
    config: state.config,
    onMessage: () => {
      // Wired in Task 8.
    },
    onError: (err) => ctx.ui.notify(`Discord error: ${(err as Error).message}`, "error"),
  });
  try {
    await bot.login();
  } catch (err) {
    ctx.ui.setStatus("discord", "");
    ctx.ui.notify(`Login failed: ${(err as Error).message}`, "error");
    await bot.destroy().catch(() => undefined);
    return;
  }
  state.bot = bot;
  // Thread creation comes in Task 6.
  ctx.ui.setStatus("discord", "Connected (no thread yet).");
  ctx.ui.notify("Discord connected. Thread creation wiring comes next.", "success");
}

async function handleOff(ctx: ExtensionCommandContext, state: State) {
  if (!state.bot) {
    ctx.ui.notify("Discord mirror is not active.", "info");
    return;
  }
  // Thread archive wiring lands in Task 6.
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
```

- [ ] **Step 5.2: Smoke test (no live Discord yet)**

```bash
cd /Users/francisco/Documents/github/pi-tools/.worktrees/discord-extension
pi -e ./extensions/discord/index.ts
```

In the interactive session run:
- `/discord` → should print status (config missing, bot disconnected)
- `/discord foo` → error
- `/discord setup` → starts the wizard (Ctrl+C out, do not complete yet unless you have a bot ready)

- [ ] **Step 5.3: Commit**

```bash
git add extensions/discord/index.ts
git commit -m "feat(discord): /discord setup|on|off|status command router"
```

---

### Task 6: Session ↔ thread mapping + metadata

**Files:**
- Create: `extensions/discord/session-thread.ts`
- Modify: `extensions/discord/index.ts`

When `/discord on` (or autoStart) fires, we create a thread for this pi session. The mapping `sessionFile → threadId` is persisted with `pi.appendEntry` so `/reload` and `/resume` reconnect to the same thread instead of creating a new one. The first message in the thread is a pinned metadata block so the user can always identify the session at a glance.

- [ ] **Step 6.1: Create `extensions/discord/session-thread.ts`**

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { DiscordBot } from "./bot.js";
import type { DiscordConfig } from "./config.js";

export const DISCORD_THREAD_ENTRY = "discord-thread";

export interface ThreadEntryData {
  threadId: string;
  sessionFile: string | null;
  createdAt: number;
}

/** Restore a previously-persisted threadId for this session, if any. */
export function loadPersistedThreadId(ctx: ExtensionContext): string | null {
  const entries = ctx.sessionManager.getEntries();
  // Walk in reverse: most recent wins in case /discord on was called more than once.
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

export interface SessionMetadata {
  host: string;
  cwd: string;
  basename: string;
  branch: string | null;
  model: string;
  sessionFile: string | null;
}

export function collectMetadata(ctx: ExtensionContext): SessionMetadata {
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

/** Placeholder thread name used at creation time. Task 10 renames it after the first prompt. */
export function initialThreadName(meta: SessionMetadata): string {
  const time = new Date().toTimeString().slice(0, 5); // HH:MM
  return `pi · ${meta.basename} · ${time}`;
}

export function renamedThreadName(meta: SessionMetadata, firstPrompt: string): string {
  const clean = firstPrompt.replace(/\s+/g, " ").trim();
  const truncated = clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
  return `pi · ${meta.basename} · ${truncated}`;
}

export function metadataBlock(meta: SessionMetadata): string {
  const lines: string[] = [];
  lines.push("**pi session**");
  lines.push(`🖥️  Host: \`${meta.host}\``);
  lines.push(`📁 Cwd: \`${meta.cwd}\``);
  if (meta.branch) lines.push(`🌿 Branch: \`${meta.branch}\``);
  lines.push(`🤖 Model: \`${meta.model}\``);
  if (meta.sessionFile) lines.push(`🆔 Session: \`${path.basename(meta.sessionFile)}\``);
  return lines.join("\n");
}

/**
 * Ensure a thread exists for this session.
 *  - If one is persisted, reuse it (unarchive if needed).
 *  - Otherwise create a new one, post the metadata block, pin it, and persist the id.
 */
export async function ensureThread(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  bot: DiscordBot,
  config: DiscordConfig,
): Promise<string> {
  const existing = loadPersistedThreadId(ctx);
  if (existing) {
    await bot.unarchiveThread(existing).catch(() => undefined);
    return existing;
  }
  const meta = collectMetadata(ctx);
  const threadId = await bot.createThread(initialThreadName(meta), config.threadArchiveMinutes);
  const msgId = await bot.sendToThread(threadId, metadataBlock(meta));
  await bot.pinMessage(threadId, msgId).catch(() => undefined);
  persistThreadId(pi, ctx, threadId);
  return threadId;
}
```

- [ ] **Step 6.2: Wire `ensureThread` into `/discord on` in `index.ts`**

Replace `handleOn` and `handleOff` in `index.ts`:

```typescript
import { ensureThread } from "./session-thread.js";

// ... inside handleOn, after successful bot.login():

  try {
    const threadId = await ensureThread(pi, ctx, bot, state.config);
    state.threadId = threadId;
  } catch (err) {
    ctx.ui.setStatus("discord", "");
    ctx.ui.notify(`Thread setup failed: ${(err as Error).message}`, "error");
    await bot.destroy().catch(() => undefined);
    return;
  }
  state.bot = bot;
  ctx.ui.setStatus("discord", `Thread: ${state.threadId}`);
  ctx.ui.notify(`Discord mirror active. Thread id: ${state.threadId}`, "success");
```

And in `handleOff`, archive before destroy:

```typescript
  if (state.bot && state.threadId) {
    await state.bot.archiveThread(state.threadId).catch(() => undefined);
  }
  await state.bot?.destroy().catch(() => undefined);
  state.bot = null;
  state.threadId = null;
```

To make `pi` accessible inside `handleOn/handleOff`, change the default export to capture `pi` in the closure and pass it in. Concrete rewrite of `handleOn` signature:

```typescript
async function handleOn(pi: ExtensionAPI, ctx: ExtensionCommandContext, state: State) { ... }
// and at the call site:
case "on": await handleOn(pi, ctx, state); break;
```

Do the same for `handleOff` (needs nothing from `pi`, but keep the signature consistent if you prefer).

- [ ] **Step 6.3: Live smoke test (requires bot + config)**

Run `/discord setup` (complete it with real values), then `/discord on`. Expected:
- A new public thread appears in the configured parent channel named `pi · <cwd> · HH:MM`.
- The first (pinned) message contains the metadata block.
- `/discord status` reports the thread id.
- Close and reopen pi in the same session (`/resume`): `/discord on` reuses the same thread (no duplicate).

- [ ] **Step 6.4: Commit**

```bash
git add extensions/discord/session-thread.ts extensions/discord/index.ts
git commit -m "feat(discord): session↔thread mapping, metadata, persistence across reloads"
```

---

### Task 7: Mirror assistant → Discord (agent_end hook)

**Files:**
- Create: `extensions/discord/mirror.ts`
- Modify: `extensions/discord/index.ts`

We listen to `agent_end`. From `event.messages` we extract the last assistant message and send it to the thread. Tool calls, tool results, streaming updates, and intermediate assistant turns are NOT mirrored. This is the anti-spam guarantee.

- [ ] **Step 7.1: Create `extensions/discord/mirror.ts`**

```typescript
import type { AgentEndEvent } from "@mariozechner/pi-coding-agent";
import { chunkMessage, type DiscordBot } from "./bot.js";

/**
 * Extract the final assistant text from an agent_end event.
 * Concatenates all text blocks of the last assistant message.
 * Returns null if there is no assistant text (e.g., the turn ended with only tool calls that the model never summarized).
 */
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
    return null; // latest assistant had no text — do not mirror
  }
  return null;
}

export async function sendAssistantMessage(bot: DiscordBot, threadId: string, text: string): Promise<void> {
  const chunks = chunkMessage(text);
  for (const chunk of chunks) {
    await bot.sendToThread(threadId, chunk);
  }
}
```

- [ ] **Step 7.2: Wire `agent_end` in `index.ts`**

Add inside the default export, after commands are registered:

```typescript
import { extractFinalAssistantText, sendAssistantMessage } from "./mirror.js";

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
```

- [ ] **Step 7.3: Live smoke test**

1. `/discord on`
2. Ask pi any question (e.g. "what is 2+2").
3. Expected: after pi finishes answering, the final reply appears in the thread. Tool calls do NOT appear.
4. Ask something that triggers tool use (e.g. "ls the extensions folder"). Expected: only the final summary appears in Discord, not the tool calls/results.

- [ ] **Step 7.4: Commit**

```bash
git add extensions/discord/mirror.ts extensions/discord/index.ts
git commit -m "feat(discord): mirror final assistant message to thread on agent_end"
```

---

### Task 8: Mirror Discord → session (messageCreate → sendUserMessage)

**Files:**
- Modify: `extensions/discord/index.ts`

The bot's `onMessage` callback receives every message in every thread (the gateway delivers all of them). We filter by:
1. `threadId === state.threadId` (wrong thread → discard)
2. `isBot === false` (our own messages → discard)
3. `authorId === state.config.ownerId` (anyone else wrote in the thread → discard)
4. `content` is not empty and does not start with `!` (reserved for Task 11 `!info`)

If all pass, we call `pi.sendUserMessage(content, { deliverAs: "followUp" })`. We use `"followUp"` because in practice a reply from Discord only arrives after pi is idle (we only send to Discord at `agent_end`). If the user does somehow type while streaming, `"followUp"` also works — it waits for the current turn to finish.

- [ ] **Step 8.1: Replace the placeholder `onMessage` in `handleOn`**

Inside `handleOn` where the `DiscordBot` is constructed, replace `onMessage: () => {}` with a real handler that closes over `pi`, `state`, and `ctx`:

```typescript
  const bot = new DiscordBot({
    config: state.config,
    onMessage: (msg) => {
      if (!state.threadId || msg.threadId !== state.threadId) return;
      if (msg.isBot) return;
      if (msg.authorId !== state.config!.ownerId) return;
      const content = msg.content.trim();
      if (!content) return;
      if (content.startsWith("!")) return; // reserved for bot-side commands (Task 11)
      try {
        pi.sendUserMessage(content, { deliverAs: "followUp" });
      } catch (err) {
        ctx.ui.notify(`Discord → pi inject failed: ${(err as Error).message}`, "error");
      }
    },
    onError: (err) => ctx.ui.notify(`Discord error: ${(err as Error).message}`, "error"),
  });
```

Note `state.config!` is safe here because `handleOn` already bailed out when `state.config` is null.

- [ ] **Step 8.2: Live smoke test (round-trip)**

1. `/discord on`
2. Ask pi something that prompts a question in its reply (e.g., "should I use vitest or jest for testing?" where it needs clarification).
3. The assistant's reply with the question appears in the Discord thread.
4. Reply in the Discord thread with your answer.
5. Expected: pi receives the answer as a new user message, continues the conversation, and the next final reply appears in Discord.
6. Have someone else (or another Discord account) post in the thread. Expected: completely ignored — no message injected into pi.

- [ ] **Step 8.3: Commit**

```bash
git add extensions/discord/index.ts
git commit -m "feat(discord): forward owner messages from Discord thread into pi session"
```

---

### Task 9: Auto-start (flag + config)

**Files:**
- Modify: `extensions/discord/index.ts`

Two ways to enable auto-start:
1. `config.autoStart === true` (persistent)
2. `pi --discord` flag (one-shot override)

`--discord=false` can force-disable even if config says true. We hook `session_start` and internally call the same logic as `/discord on`.

- [ ] **Step 9.1: Register the flag and hook `session_start`**

In `index.ts`, before `pi.registerCommand("discord", ...)`:

```typescript
  pi.registerFlag("discord", {
    description: "Auto-start Discord mirror for this session (overrides config.autoStart)",
    type: "boolean",
  });
```

Refactor so `/discord on` delegates to a shared `startMirror(ctx)` function. Define it once in the module:

```typescript
  async function startMirror(ctx: ExtensionContext): Promise<void> {
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
        if (content.startsWith("!")) return; // reserved; `!info` handled in Task 11
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
      const threadId = await ensureThread(pi, ctx, bot, state.config);
      state.bot = bot;
      state.threadId = threadId;
      ctx.ui.setStatus("discord", `Thread: ${threadId}`);
    } catch (err) {
      await bot.destroy().catch(() => undefined);
      ctx.ui.notify(`Discord auto-start failed: ${(err as Error).message}`, "error");
    }
  }
```

Move the duplicated logic out of `handleOn` into `startMirror`; `handleOn` becomes a thin wrapper that notifies on success/failure. Then wire the `session_start` hook:

```typescript
  pi.on("session_start", async (_event, ctx) => {
    const flag = pi.getFlag("--discord");
    const autoFromFlag = flag === true;
    const autoDisabledByFlag = flag === false;
    const autoFromConfig = state.config?.autoStart === true;
    if (autoDisabledByFlag) return;
    if (!autoFromFlag && !autoFromConfig) return;
    await startMirror(ctx);
  });
```

- [ ] **Step 9.2: Live smoke test**

1. Set `autoStart: true` in `~/.pi/discord.json`. Launch pi → the thread auto-opens (or reuses existing).
2. Set `autoStart: false`. Launch `pi --discord` → auto-opens just this time.
3. `pi --discord=false` with `autoStart: true` → does NOT open.

- [ ] **Step 9.3: Commit**

```bash
git add extensions/discord/index.ts
git commit -m "feat(discord): autoStart config + --discord CLI flag"
```

---

### Task 10: Rename thread with first prompt

**Files:**
- Modify: `extensions/discord/index.ts`

A thread created via `autoStart` has no prompt yet, so its initial name is `pi · <basename> · HH:MM`. As soon as the user types their first prompt, rename the thread to include a snippet. This is a one-shot: subsequent prompts do not rename.

We store a flag in module state (`state.renamedForSession`). Restoring across reloads: if we loaded a persisted threadId, we assume the rename already happened (the thread will have whatever name Discord has for it) and set `renamedForSession = true`.

- [ ] **Step 10.1: Add rename state and hook `before_agent_start`**

In `index.ts`, extend `State`:

```typescript
interface State {
  config: DiscordConfig | null;
  bot: DiscordBot | null;
  threadId: string | null;
  renamedForSession: boolean;
}
// and initialize:
const state: State = { config: null, bot: null, threadId: null, renamedForSession: false };
```

In `startMirror`, after a reused thread is returned by `ensureThread`, set `renamedForSession = true` iff it was reused (not freshly created). Easiest: have `ensureThread` return a `{ threadId, created: boolean }` tuple.

Refactor `ensureThread` (in `session-thread.ts`) to return `{ threadId: string; created: boolean }`. Update caller in `startMirror`:

```typescript
const { threadId, created } = await ensureThread(pi, ctx, bot, state.config);
state.threadId = threadId;
state.renamedForSession = !created;
```

Add the hook:

```typescript
import { renamedThreadName, collectMetadata } from "./session-thread.js";

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
      // Non-fatal; leave the initial name.
      ctx.ui.notify(`Discord rename failed: ${(err as Error).message}`, "error");
      state.renamedForSession = true; // do not retry every turn
    }
  });
```

- [ ] **Step 10.2: Live smoke test**

1. Fresh session (delete the `custom` entry or start a new session). `pi --discord`.
2. Expected: thread appears with name `pi · <basename> · HH:MM`.
3. Type "help me refactor the auth module". Expected: thread renames to `pi · <basename> · help me refactor the auth module`.
4. Type something else. Expected: thread name does NOT change again.

- [ ] **Step 10.3: Commit**

```bash
git add extensions/discord/index.ts extensions/discord/session-thread.ts
git commit -m "feat(discord): rename thread to include first prompt of the session"
```

---

### Task 11: `!info` command in the thread

**Files:**
- Modify: `extensions/discord/index.ts`

Allow the owner to type `!info` in the thread and get the metadata block echoed back. Useful when reopening Discord after hours away and you need to remember which thread is which.

- [ ] **Step 11.1: Handle `!info` inside the message callback**

In the `onMessage` handler (the closure inside `startMirror`):

```typescript
      if (content.startsWith("!")) {
        if (content === "!info" && state.threadId && state.bot) {
          const meta = collectMetadata(ctx);
          state.bot.sendToThread(state.threadId, metadataBlock(meta)).catch(() => undefined);
        }
        return; // any `!` message is handled here, never forwarded to pi
      }
```

Make sure `metadataBlock` is imported from `./session-thread.js`.

- [ ] **Step 11.2: Live smoke test**

1. In the Discord thread, type `!info`.
2. Expected: bot replies with the metadata block (host, cwd, branch, model, session).
3. Expected: pi session does NOT receive `!info` as a user message.

- [ ] **Step 11.3: Commit**

```bash
git add extensions/discord/index.ts
git commit -m "feat(discord): !info command echoes session metadata in the thread"
```

---

### Task 12: Graceful shutdown

**Files:**
- Modify: `extensions/discord/index.ts`

On `session_shutdown` (Ctrl+C, Ctrl+D, SIGHUP, SIGTERM, `/new` from an active session, etc.) we archive the thread and disconnect the gateway. Archiving is cheap: the thread's history stays intact and can be unarchived on next `/discord on`.

- [ ] **Step 12.1: Hook `session_shutdown`**

In `index.ts`, add after the other hooks:

```typescript
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
```

- [ ] **Step 12.2: Live smoke test**

1. `/discord on`. Confirm thread open in Discord.
2. Exit pi with Ctrl+D.
3. Expected: thread is archived in Discord (appears under the channel's archived section).
4. Relaunch pi with `pi --discord` on the same session (`/resume`). Expected: same thread is unarchived and reused.

- [ ] **Step 12.3: Commit**

```bash
git add extensions/discord/index.ts
git commit -m "feat(discord): archive thread and disconnect gateway on session_shutdown"
```

---

### Task 13: README (setup guide)

**Files:**
- Modify: `extensions/discord/README.md`

Complete the README so a colleague can set this up in ~5 minutes.

- [ ] **Step 13.1: Replace the stub `README.md`**

```markdown
# /discord — pi session mirror to Discord

Mirror the final assistant messages of a pi session to a dedicated Discord thread,
and reply from Discord to inject messages back into pi.

Designed to be **non-invasive**: only final answers are mirrored — no tool calls,
no streaming intermediates. Perfect for following along / answering the occasional
question without spam.

## Features

- One **thread per pi session** inside a fixed parent channel
- **Only the session owner** can inject messages from Discord (by Discord user id)
- Persists `sessionFile → threadId` across `/reload` and `/resume`
- Archives the thread on shutdown, unarchives on resume
- `/discord status` shows what's wired up; `!info` inside a thread shows session metadata
- Opt-in per session (`/discord on`) or auto-start via config / `pi --discord` flag

## 1. Create a Discord bot

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Open the **Bot** tab.
3. Click **Reset Token** and copy the token. **Do not share it.** You will paste it into the setup wizard.
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**.
5. Open the **OAuth2 → URL Generator** tab.
6. Scopes: `bot`.
7. Bot Permissions: `View Channels`, `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Manage Threads`, `Read Message History`.
8. Visit the generated URL and invite the bot to your server.

## 2. Find the required IDs

Enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click to copy IDs.

- **Guild (server) ID** — right-click server name → Copy Server ID.
- **Parent channel ID** — right-click the text channel where threads should be created → Copy Channel ID.
- **Your user ID** — right-click your own name → Copy User ID. Only this user's messages are forwarded to pi.

## 3. Run the setup wizard

Inside any pi session:

```
/discord setup
```

You'll be asked for the four values above plus an `autoStart` preference. The wizard
validates the connection before saving. Config is written to `~/.pi/discord.json`
with mode `600`.

## 4. Use it

| Command | Effect |
|---|---|
| `/discord on` | Open (or reuse) the thread for this session and start mirroring |
| `/discord off` | Archive the thread and disconnect |
| `/discord status` | Show current config / bot / thread state |
| `/discord setup` | Re-run the wizard to update config |
| `pi --discord` | Auto-start the mirror for this launch |
| `pi --discord=false` | Disable autoStart for this launch even if enabled in config |
| `!info` (typed in the thread) | Bot echoes session metadata (host, cwd, branch, model) |

## Anti-spam rules

- Only the **final assistant message** of each agent turn is posted to Discord.
- Tool calls, tool results, and streaming intermediates are NOT posted.
- Messages longer than 1900 chars are split into multiple Discord messages.
- If the assistant turn ends with only tool calls (no final text), nothing is posted.

## Security notes

- `~/.pi/discord.json` contains the bot token. The extension writes it with `chmod 600`. Keep it that way.
- The bot token lets anyone act as the bot in all servers it's invited to. Only invite the bot to servers you control.
- Messages from any user other than the configured `ownerId` in the thread are silently dropped. There is no command that lets other users inject prompts.
- The bot needs Message Content Intent because we forward message content to pi. If you are not comfortable granting this, do not use this extension.

## Multiple concurrent sessions

Every pi process opens its own websocket to Discord's gateway using the same bot token.
Discord allows this; each process filters `messageCreate` by its own `threadId`.
If you have 5 pi sessions running, you'll get 5 threads in the parent channel, each
named after the cwd + the first prompt of the session.

## Troubleshooting

- **"parentChannelId ... is not a text channel"** — make sure the ID points at a plain text channel, not a voice/forum/category.
- **No messages arrive in Discord** — check `/discord status`. If `Bot: disconnected`, run `/discord on`. If still failing, check token and intent settings.
- **Replies from Discord don't reach pi** — confirm `ownerId` matches YOUR Discord user id (not the bot's). Use `!info` in the thread and cross-check.
- **Thread reuse broke** — session persistence uses `pi.appendEntry` data. If you lost the session file or started a brand-new session, a new thread will be created.
```

- [ ] **Step 13.2: Commit**

```bash
git add extensions/discord/README.md
git commit -m "docs(discord): full setup guide and usage reference"
```

---

### Task 14: Final polish and integration check

**Files:**
- Modify: `README.md` (root)
- Modify: `.gitignore` (if not already done in Task 3)

- [ ] **Step 14.1: Verify `.gitignore` excludes `extensions/*/node_modules`**

```bash
grep -q "extensions/\*/node_modules" .gitignore || printf "\nextensions/*/node_modules\n" >> .gitignore
git status
```

Expected: `extensions/discord/node_modules` is not listed as untracked.

If it was already committed by accident in an earlier task, remove it:

```bash
git rm -r --cached extensions/discord/node_modules
git commit -m "chore: drop accidentally committed discord node_modules"
```

- [ ] **Step 14.2: Add a one-line mention in the root `README.md`**

Locate a reasonable place in the existing root README (e.g., near the top-level features list or a new `## Extensions` section) and add:

```markdown
- **`/discord`** — mirror pi sessions to Discord threads (per-session thread, owner-only replies, opt-in). See [`extensions/discord/README.md`](extensions/discord/README.md).
```

- [ ] **Step 14.3: Full end-to-end rehearsal**

On a fresh session:
1. `/discord setup` — complete wizard.
2. Set `autoStart: true` in `~/.pi/discord.json`, relaunch pi.
3. Confirm thread auto-opens with correct name and pinned metadata.
4. Send a prompt. Confirm thread renames, and the final reply appears in Discord.
5. Reply in Discord. Confirm pi receives it.
6. Ctrl+D. Confirm thread is archived.
7. `pi` again (no flag, autoStart still on). Confirm same thread is reused and unarchived.
8. `/discord off`. Confirm thread archived, bot disconnected.
9. `/discord status`. Confirm state resets cleanly.
10. `!info` in the thread after reconnecting. Confirm metadata posted.

- [ ] **Step 14.4: Commit integration changes**

```bash
git add README.md .gitignore
git commit -m "docs: link /discord extension from root README"
```

- [ ] **Step 14.5: Push branch**

```bash
git push -u origin feature/discord-extension
```

---

## Appendix: Known limitations (intentional, not bugs)

- **One thread per session, not per message**. If you want different topics in different threads, start different pi sessions.
- **Owner filter is a single user id**. No role-based or group-based access. If you need a team, add members to your server and give the parent channel appropriate permissions — but only the configured owner can inject messages.
- **No end-to-end encryption**. Messages are plaintext in Discord. Don't paste secrets in your prompts.
- **The bot token is shared across all pi processes on your machine**. If someone reads `~/.pi/discord.json`, they can impersonate the bot. Keep the file `chmod 600` and don't sync it.
- **Thread creation rate limit**: Discord allows ~50 threads per 5 minutes per guild. Not a concern for human use; mentioned for completeness.

