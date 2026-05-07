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

## Quick Start (Interactive Setup)

Inside any pi session, simply run:

```
/discord setup
```

The wizard will guide you through each step:
1. **Bot Token** (from Discord Developer Portal)
2. **Guild (Server) ID** (right-click server in Discord)
3. **Parent Channel ID** (where threads will be created)
4. **Your User ID** (only you can reply to inject messages)
5. **Auto-start preference**
6. **Intents verification** (Message Content Intent must be enabled)
7. **Connection test**

That's it! The wizard validates everything before saving.

---

## Manual Setup (If Needed)

### Step 1: Create a Discord Application & Bot

1. Go to https://discord.com/developers/applications
2. Click **"New Application"** and give it a name
3. Go to the **"Bot"** tab on the left
4. Click **"Add Bot"**
5. Under the bot name, click **"Reset Token"** and **copy it**
   - ⚠️ **Do NOT share this token** — it has full bot permissions
6. Go to **"OAuth2"** → **"URL Generator"** on the left

### Step 2: Configure Bot Permissions

In the **URL Generator**:

**Scopes:** Check `bot`

**Permissions:** Check these:
- ☑ View Channels
- ☑ Send Messages
- ☑ Create Public Threads
- ☑ Send Messages in Threads
- ☑ Manage Threads
- ☑ Read Message History

Copy the generated URL at the bottom and **open it in your browser** to invite the bot to your server.

### Step 3: Enable Privileged Intents

⚠️ **Critical step** — without this, you'll get "Disallowed Intents" error.

1. Go to your Application's **"Bot"** tab
2. Scroll down to **"Privileged Gateway Intents"**
3. Enable **both**:
   - ☑ Server Members Intent
   - ☑ Message Content Intent
4. Click **"Save Changes"** at the top

### Step 4: Get Required IDs

Enable **Developer Mode** in Discord:
- Settings → Advanced → Developer Mode

Then:
- **Guild (Server) ID**: Right-click your server name → Copy Server ID
- **Parent Channel ID**: Right-click a text channel → Copy Channel ID
- **Your User ID**: Right-click your name/avatar → Copy User ID

### Step 5: Run Setup in pi

```
/discord setup
```

Follow the prompts and paste your IDs when asked.

---

## Usage

| Command | Effect |
|---|---|
| `/discord on` | Open (or reuse) the thread for this session and start mirroring |
| `/discord off` | Archive the thread and disconnect |
| `/discord status` | Show current config / bot / thread state |
| `/discord setup` | Re-run the wizard to update config |
| `pi --discord` | Auto-start the mirror for this launch |
| `pi --discord=false` | Disable autoStart for this launch even if enabled in config |
| `!info` (in Discord thread) | Bot echoes session metadata (host, cwd, branch, model) |

## How It Works

1. **Session starts** → thread auto-created in Discord (if autoStart enabled or `/discord on`)
2. **You ask Claude** → final response auto-posted to Discord thread
3. **You reply in Discord** → message injected back to pi as user input
4. **Thread auto-named** → includes session cwd + first prompt
5. **Session ends** → thread auto-archived (history preserved)

## Anti-Spam Rules

- Only the **final assistant message** of each turn is posted
- Tool calls, results, and streaming intermediates are **NOT posted**
- Messages longer than 1900 chars are split across multiple Discord messages
- If the turn ends with only tool calls (no final text), nothing is posted

## Security

- **Config file**: `~/.pi/discord.json` stored with `chmod 600` (read/write by owner only)
- **Bot token**: Never shared, kept in your home directory
- **Message filtering**: Only your Discord user ID can inject messages (no one else)
- **Permissions**: Bot has minimal permissions (only what it needs for threads)
- **Intent**: Message Content Intent required because we forward message text to pi

## Troubleshooting

### Error: "Unknown Guild"

The bot isn't in your server OR you copied the wrong Guild ID.

**Fix:**
1. Verify the bot appears in your Discord server (left sidebar)
2. Get the correct Guild ID: Right-click server → Copy Server ID (not the bot name)
3. Try `/discord setup` again

### Error: "Disallowed Intents"

Message Content Intent isn't enabled.

**Fix:**
1. Discord Developer Portal → Your App → Bot tab
2. Scroll to "Privileged Gateway Intents"
3. Enable ☑ Message Content Intent
4. Click "Save Changes"
5. Try `/discord setup` again

### Error: "Invalid Token"

The bot token is wrong or expired.

**Fix:**
1. Generate a new token: Developer Portal → Bot → Reset Token
2. Run `/discord setup` again and paste the new token

### Thread not created / No messages in Discord

Check `/discord status`:
- If `Bot: disconnected`, run `/discord on`
- If `Config: missing`, run `/discord setup`
- If still not working, check Discord Developer Portal intents are enabled

### Replies in Discord don't reach pi

Verify the `ownerId` is correct.

**Fix:**
1. In Discord, type `!info` in the thread
2. Bot will echo your user ID
3. Make sure it matches what you entered in setup
4. If not, run `/discord setup` again with the correct ID

---

## Multiple Sessions

Each pi session gets its own thread. If you have 5 pi terminals open:

```
#channel
├── pi · project-1 · "refactor auth module"
├── pi · api-server · "debug jwt validation"
├── pi · frontend · "add dark mode"
├── pi · scripts · "migration script"
└── pi · rust-thing · "optimize query"
```

Each thread has its own message history and is independent.

---

## Config Location

Config is stored at: `~/.pi/discord.json`

Example:
```json
{
  "token": "MTI...",
  "guildId": "123456789",
  "parentChannelId": "987654321",
  "ownerId": "555555555",
  "autoStart": true,
  "threadArchiveMinutes": 60
}
```

You can edit this manually if needed (keep `chmod 600`).

---

## Questions?

- Check `/discord status` — shows connection state
- Type `!info` in a Discord thread — shows session metadata
- Run `/discord setup` again to update config

Enjoy your Discord-connected pi sessions! 🎉
