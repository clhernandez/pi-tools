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

  async createThread(name: string, autoArchiveMinutes: 60 | 1440 | 4320 | 10080): Promise<string> {
    if (!this.parentChannel) throw new Error("Bot not logged in");
    const thread = await this.parentChannel.threads.create({
      name: name.slice(0, 100),
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

export function chunkMessage(text: string, max = 1900): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
