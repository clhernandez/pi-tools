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
