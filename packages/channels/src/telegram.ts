import { createInboundMessage } from "@featherbot/bus";
import type { OutboundMessage } from "@featherbot/bus";
import { Bot } from "grammy";
import type { PhotoSize } from "grammy/types";
import { BaseChannel } from "./base.js";
import { escapeTelegramMarkdown, truncateForTelegram } from "./telegram-format.js";
import type { ChannelOptions } from "./types.js";

const MAX_VOICE_DURATION_SECONDS = 120;

export interface TelegramChannelOptions extends ChannelOptions {
	token: string;
}

const TYPING_INTERVAL_MS = 4000;

export class TelegramChannel extends BaseChannel {
	readonly name = "telegram";

	private bot: Bot | undefined;
	private readonly token: string;
	private readonly typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

	constructor(options: TelegramChannelOptions) {
		super(options);
		this.token = options.token;
	}

	private startTypingIndicator(chatId: string): void {
		if (this.bot === undefined || this.typingIntervals.has(chatId)) return;
		const send = () => {
			this.bot?.api.sendChatAction(chatId, "typing").catch(() => {});
		};
		send();
		this.typingIntervals.set(chatId, setInterval(send, TYPING_INTERVAL_MS));
	}

	private clearTypingIndicator(chatId: string): void {
		const interval = this.typingIntervals.get(chatId);
		if (interval !== undefined) {
			clearInterval(interval);
			this.typingIntervals.delete(chatId);
		}
	}

	async start(): Promise<void> {
		this.bot = new Bot(this.token);

		this.bot.on("message:text", async (ctx) => {
			try {
				const senderId = `telegram:${ctx.from.id}`;
				const chatId = String(ctx.chat.id);
				const inbound = createInboundMessage({
					channel: "telegram",
					senderId,
					chatId,
					content: ctx.message.text,
					media: [],
					metadata: { telegramMessageId: ctx.message.message_id },
				});
				await this.publishInbound(inbound);
				this.startTypingIndicator(chatId);
			} catch (err) {
				console.error("Telegram text handler error:", err);
			}
		});

		this.bot.on("message:photo", async (ctx) => {
			try {
				const senderId = `telegram:${ctx.from.id}`;
				const chatId = String(ctx.chat.id);
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
					chatId,
					content: ctx.message.caption ?? "",
					media,
					metadata: { telegramMessageId: ctx.message.message_id },
				});
				await this.publishInbound(inbound);
				this.startTypingIndicator(chatId);
			} catch (err) {
				console.error("Telegram photo handler error:", err);
			}
		});

		this.bot.on(["message:voice", "message:audio"], async (ctx) => {
			try {
				const senderId = `telegram:${ctx.from.id}`;
				const chatId = String(ctx.chat.id);
				const voice = ctx.message.voice ?? ctx.message.audio;

				const duration = voice?.duration ?? 0;
				if (duration > MAX_VOICE_DURATION_SECONDS) {
					const inbound = createInboundMessage({
						channel: "telegram",
						senderId,
						chatId,
						content: `[Voice message rejected: duration ${duration}s exceeds ${MAX_VOICE_DURATION_SECONDS}s limit]`,
						media: [],
						metadata: { telegramMessageId: ctx.message.message_id },
					});
					await this.publishInbound(inbound);
					this.startTypingIndicator(chatId);
					return;
				}

				if (this.transcriber === undefined) {
					const inbound = createInboundMessage({
						channel: "telegram",
						senderId,
						chatId,
						content: "[Voice message received, but transcription is not configured]",
						media: [],
						metadata: { telegramMessageId: ctx.message.message_id },
					});
					await this.publishInbound(inbound);
					this.startTypingIndicator(chatId);
					return;
				}

				try {
					const file = await ctx.getFile();
					const fileUrl = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
					const response = await fetch(fileUrl);
					const arrayBuffer = await response.arrayBuffer();
					const buffer = Buffer.from(arrayBuffer);

					const filename = file.file_path ?? "voice.ogg";
					const mimeType = voice?.mime_type ?? "audio/ogg";

					const result = await this.transcriber.transcribe(buffer, filename, mimeType);

					const inbound = createInboundMessage({
						channel: "telegram",
						senderId,
						chatId,
						content: `[Voice transcription]: ${result.text}`,
						media: [],
						metadata: { telegramMessageId: ctx.message.message_id },
					});
					await this.publishInbound(inbound);
					this.startTypingIndicator(chatId);
				} catch (transcribeErr) {
					console.error("Telegram voice transcription error:", transcribeErr);
					const inbound = createInboundMessage({
						channel: "telegram",
						senderId,
						chatId,
						content: "[Voice message received, but transcription failed]",
						media: [],
						metadata: { telegramMessageId: ctx.message.message_id },
					});
					await this.publishInbound(inbound);
					this.startTypingIndicator(chatId);
				}
			} catch (err) {
				console.error("Telegram voice handler error:", err);
			}
		});

		this.bot.start();
	}

	async send(message: OutboundMessage): Promise<void> {
		if (this.bot === undefined) return;

		const chatId = message.chatId;
		this.clearTypingIndicator(chatId);

		if (!message.content.trim()) {
			console.warn("Telegram send skipped: empty content for chat", chatId);
			return;
		}

		const text = truncateForTelegram(message.content);
		const escaped = escapeTelegramMarkdown(text);

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
				await this.bot.api.sendMessage(chatId, text, plainOptions);
			} catch (err) {
				console.error("Telegram send error:", err);
			}
		}
	}

	async stop(): Promise<void> {
		for (const [chatId] of this.typingIntervals) {
			this.clearTypingIndicator(chatId);
		}
		if (this.bot !== undefined) {
			await this.bot.stop();
			this.bot = undefined;
		}
	}
}
