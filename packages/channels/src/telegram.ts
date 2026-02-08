import { createInboundMessage } from "@featherbot/bus";
import type { OutboundMessage } from "@featherbot/bus";
import { Bot } from "grammy";
import type { PhotoSize } from "grammy/types";
import { BaseChannel } from "./base.js";
import { escapeTelegramMarkdown } from "./telegram-format.js";
import type { ChannelOptions } from "./types.js";

export interface TelegramChannelOptions extends ChannelOptions {
	token: string;
}

export class TelegramChannel extends BaseChannel {
	readonly name = "telegram";

	private bot: Bot | undefined;
	private readonly token: string;

	constructor(options: TelegramChannelOptions) {
		super(options);
		this.token = options.token;
	}

	async start(): Promise<void> {
		this.bot = new Bot(this.token);

		this.bot.on("message:text", async (ctx) => {
			try {
				const senderId = `telegram:${ctx.from.id}`;
				const inbound = createInboundMessage({
					channel: "telegram",
					senderId,
					chatId: String(ctx.chat.id),
					content: ctx.message.text,
					media: [],
					metadata: { telegramMessageId: ctx.message.message_id },
				});
				await this.publishInbound(inbound);
			} catch (err) {
				console.error("Telegram text handler error:", err);
			}
		});

		this.bot.on("message:photo", async (ctx) => {
			try {
				const senderId = `telegram:${ctx.from.id}`;
				const photos = ctx.message.photo;
				const largest = photos.reduce<PhotoSize | undefined>((max, p) => {
					if (max === undefined) return p;
					return p.file_size !== undefined &&
						max.file_size !== undefined &&
						p.file_size > max.file_size
						? p
						: max;
				}, undefined);
				const media = largest !== undefined ? [largest.file_id] : [];
				const inbound = createInboundMessage({
					channel: "telegram",
					senderId,
					chatId: String(ctx.chat.id),
					content: ctx.message.caption ?? "",
					media,
					metadata: { telegramMessageId: ctx.message.message_id },
				});
				await this.publishInbound(inbound);
			} catch (err) {
				console.error("Telegram photo handler error:", err);
			}
		});

		this.bot.start();
	}

	async send(message: OutboundMessage): Promise<void> {
		if (this.bot === undefined) return;

		const chatId = message.chatId;
		const escaped = escapeTelegramMarkdown(message.content);

		// biome-ignore lint/suspicious/noExplicitAny: grammy sendMessage options
		const options: any = { parse_mode: "MarkdownV2" };
		if (message.inReplyToMessageId !== null) {
			options.reply_to_message_id = Number(message.inReplyToMessageId);
		}

		try {
			await this.bot.api.sendMessage(chatId, escaped, options);
		} catch {
			// Fallback to plain text if MarkdownV2 fails
			// biome-ignore lint/suspicious/noExplicitAny: grammy sendMessage options
			const plainOptions: any = {};
			if (message.inReplyToMessageId !== null) {
				plainOptions.reply_to_message_id = Number(message.inReplyToMessageId);
			}
			try {
				await this.bot.api.sendMessage(chatId, message.content, plainOptions);
			} catch (err) {
				console.error("Telegram send error:", err);
			}
		}
	}

	async stop(): Promise<void> {
		if (this.bot !== undefined) {
			await this.bot.stop();
			this.bot = undefined;
		}
	}
}
