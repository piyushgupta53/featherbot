import { MessageBus } from "@featherbot/bus";
import type { InboundMessageEvent } from "@featherbot/bus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramChannel } from "./telegram.js";

// biome-ignore lint/suspicious/noExplicitAny: mock handler types
type Handler = (ctx: any) => Promise<void>;

const mockSendMessage = vi.fn();
const mockSendChatAction = vi.fn().mockResolvedValue(true);
const mockStart = vi.fn();
const mockStop = vi.fn();
const handlers: Map<string, Handler> = new Map();

vi.mock("grammy", () => ({
	Bot: vi.fn().mockImplementation(() => ({
		on: (filter: string | string[], handler: Handler) => {
			if (Array.isArray(filter)) {
				for (const f of filter) {
					handlers.set(f, handler);
				}
			} else {
				handlers.set(filter, handler);
			}
		},
		start: mockStart,
		stop: mockStop,
		api: {
			sendMessage: mockSendMessage,
			sendChatAction: mockSendChatAction,
		},
	})),
}));

const mockFetch = vi.fn();

function makeTextCtx(userId: number, chatId: number, text: string, messageId = 1) {
	return {
		from: { id: userId },
		chat: { id: chatId },
		message: { text, message_id: messageId },
	};
}

function makePhotoCtx(
	userId: number,
	chatId: number,
	photos: Array<{ file_id: string; file_size?: number }>,
	caption?: string,
	messageId = 1,
) {
	return {
		from: { id: userId },
		chat: { id: chatId },
		message: {
			photo: photos,
			caption,
			message_id: messageId,
		},
	};
}

function makeVoiceCtx(
	userId: number,
	chatId: number,
	duration: number,
	messageId = 1,
	mimeType = "audio/ogg",
) {
	return {
		from: { id: userId },
		chat: { id: chatId },
		message: {
			voice: { duration, mime_type: mimeType },
			audio: undefined,
			message_id: messageId,
		},
		getFile: vi.fn().mockResolvedValue({ file_path: "voice/file_0.oga" }),
	};
}

describe("TelegramChannel", () => {
	let bus: MessageBus;
	let channel: TelegramChannel;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		bus = new MessageBus();
		handlers.clear();
		mockSendMessage.mockReset();
		mockSendChatAction.mockReset().mockResolvedValue(true);
		mockStart.mockReset();
		mockStop.mockReset();
		mockFetch.mockReset();
		originalFetch = globalThis.fetch;
		globalThis.fetch = mockFetch;
	});

	afterEach(() => {
		bus.close();
		globalThis.fetch = originalFetch;
	});

	it("has name 'telegram'", () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		expect(channel.name).toBe("telegram");
	});

	it("publishes inbound message on text message", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = handlers.get("message:text");
		expect(handler).toBeDefined();
		await handler?.(makeTextCtx(123, 456, "Hello bot"));

		expect(events).toHaveLength(1);
		expect(events[0]?.message.channel).toBe("telegram");
		expect(events[0]?.message.senderId).toBe("telegram:123");
		expect(events[0]?.message.chatId).toBe("456");
		expect(events[0]?.message.content).toBe("Hello bot");
		expect(events[0]?.message.metadata).toEqual({ telegramMessageId: 1 });
	});

	it("publishes inbound message on photo message with largest photo", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = handlers.get("message:photo");
		expect(handler).toBeDefined();
		await handler?.(
			makePhotoCtx(
				123,
				456,
				[
					{ file_id: "small", file_size: 100 },
					{ file_id: "large", file_size: 5000 },
					{ file_id: "medium", file_size: 1000 },
				],
				"My photo",
			),
		);

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("My photo");
		expect(events[0]?.message.media).toEqual(["large"]);
	});

	it("uses empty string for photo message without caption", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = handlers.get("message:photo");
		await handler?.(makePhotoCtx(123, 456, [{ file_id: "photo1", file_size: 500 }]));

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("");
	});

	it("sends message with MarkdownV2 parse mode", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		await channel.start();

		await channel.send({
			channel: "telegram",
			chatId: "456",
			content: "Hello!",
			replyTo: null,
			media: [],
			metadata: {},
			messageId: "msg-1",
			inReplyToMessageId: null,
		});

		expect(mockSendMessage).toHaveBeenCalledWith("456", "Hello\\!", {
			parse_mode: "MarkdownV2",
		});
	});

	it("falls back to plain text when MarkdownV2 fails", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		await channel.start();

		mockSendMessage.mockRejectedValueOnce(new Error("Bad markup"));

		await channel.send({
			channel: "telegram",
			chatId: "456",
			content: "Hello!",
			replyTo: null,
			media: [],
			metadata: {},
			messageId: "msg-1",
			inReplyToMessageId: null,
		});

		expect(mockSendMessage).toHaveBeenCalledTimes(2);
		expect(mockSendMessage).toHaveBeenNthCalledWith(2, "456", "Hello!", {});
	});

	it("includes reply_to_message_id when inReplyToMessageId is set", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		await channel.start();

		await channel.send({
			channel: "telegram",
			chatId: "456",
			content: "Reply",
			replyTo: null,
			media: [],
			metadata: {},
			messageId: "msg-1",
			inReplyToMessageId: "789",
		});

		expect(mockSendMessage).toHaveBeenCalledWith("456", "Reply", {
			parse_mode: "MarkdownV2",
			reply_to_message_id: 789,
		});
	});

	it("respects access control (allowFrom)", async () => {
		channel = new TelegramChannel({
			bus,
			token: "test-token",
			allowFrom: ["telegram:100"],
		});

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = handlers.get("message:text");
		// Allowed user
		await handler?.(makeTextCtx(100, 456, "Allowed"));
		// Denied user
		await handler?.(makeTextCtx(999, 456, "Denied"));

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("Allowed");
	});

	it("handles errors in text handler without crashing", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await channel.start();

		bus.subscribe("message:inbound", () => {
			throw new Error("Bus error");
		});

		const handler = handlers.get("message:text");
		// Should not throw
		await handler?.(makeTextCtx(123, 456, "Hello"));

		consoleSpy.mockRestore();
	});

	it("handles errors in send without crashing", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await channel.start();

		// Both MarkdownV2 and plain text fail
		mockSendMessage.mockRejectedValue(new Error("Send failed"));

		await channel.send({
			channel: "telegram",
			chatId: "456",
			content: "Hello",
			replyTo: null,
			media: [],
			metadata: {},
			messageId: "msg-1",
			inReplyToMessageId: null,
		});

		expect(consoleSpy).toHaveBeenCalledWith("Telegram send error:", expect.any(Error));
		consoleSpy.mockRestore();
	});

	it("skips sending when content is empty", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		await channel.start();

		await channel.send({
			channel: "telegram",
			chatId: "456",
			content: "",
			replyTo: null,
			media: [],
			metadata: {},
			messageId: "msg-1",
			inReplyToMessageId: null,
		});

		expect(mockSendMessage).toHaveBeenCalledWith(
			"456",
			"I processed your request but didn't generate a response\\. Please try again\\.",
			{ parse_mode: "MarkdownV2" },
		);
		expect(consoleSpy).toHaveBeenCalledWith(
			"Telegram sending fallback for empty content for chat",
			"456",
		);
		consoleSpy.mockRestore();
	});

	it("sends typing indicator when inbound message is published", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });

		await channel.start();

		const handler = handlers.get("message:text");
		await handler?.(makeTextCtx(123, 456, "Hello bot"));

		expect(mockSendChatAction).toHaveBeenCalledWith("456", "typing");
	});

	it("clears typing indicator when outbound message is sent", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		await channel.start();

		// Trigger typing indicator
		const handler = handlers.get("message:text");
		await handler?.(makeTextCtx(123, 456, "Hello bot"));
		expect(mockSendChatAction).toHaveBeenCalledWith("456", "typing");

		// Send outbound — should clear the interval
		mockSendChatAction.mockClear();
		await channel.send({
			channel: "telegram",
			chatId: "456",
			content: "Response",
			replyTo: null,
			media: [],
			metadata: {},
			messageId: "msg-1",
			inReplyToMessageId: null,
		});

		// After sending, the typing interval should be cleared
		// Advance time to verify no more typing actions are sent
		await new Promise((r) => setTimeout(r, 50));
		expect(mockSendChatAction).not.toHaveBeenCalled();
	});

	it("stop() calls bot.stop()", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		await channel.start();
		await channel.stop();

		expect(mockStop).toHaveBeenCalled();
	});

	it("stop() is safe to call without start", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });
		// Should not throw
		await channel.stop();
	});

	it("transcribes voice message when transcriber is configured", async () => {
		const mockTranscriber = {
			transcribe: vi.fn().mockResolvedValue({ text: "hello from voice" }),
		};
		channel = new TelegramChannel({ bus, token: "test-token", transcriber: mockTranscriber });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		mockFetch.mockResolvedValue({
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
		});

		await channel.start();

		const handler = handlers.get("message:voice");
		expect(handler).toBeDefined();
		await handler?.(makeVoiceCtx(123, 456, 10));

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("[Voice transcription]: hello from voice");
	});

	it("sends placeholder when no transcriber is configured for voice", async () => {
		channel = new TelegramChannel({ bus, token: "test-token" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = handlers.get("message:voice");
		expect(handler).toBeDefined();
		await handler?.(makeVoiceCtx(123, 456, 10));

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe(
			"[Voice message received, but transcription is not configured]",
		);
	});

	it("sends fallback when voice transcription fails", async () => {
		const mockTranscriber = {
			transcribe: vi.fn().mockRejectedValue(new Error("API error")),
		};
		channel = new TelegramChannel({ bus, token: "test-token", transcriber: mockTranscriber });
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		mockFetch.mockResolvedValue({
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
		});

		await channel.start();

		const handler = handlers.get("message:voice");
		await handler?.(makeVoiceCtx(123, 456, 10));

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("[Voice message received, but transcription failed]");
		consoleSpy.mockRestore();
	});

	it("rejects voice message exceeding duration limit", async () => {
		const mockTranscriber = {
			transcribe: vi.fn(),
		};
		channel = new TelegramChannel({ bus, token: "test-token", transcriber: mockTranscriber });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = handlers.get("message:voice");
		await handler?.(makeVoiceCtx(123, 456, 300));

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toContain("[Voice message rejected: duration 300s");
		expect(mockTranscriber.transcribe).not.toHaveBeenCalled();
	});
});
