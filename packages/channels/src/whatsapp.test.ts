import { MessageBus } from "@featherbot/bus";
import type { InboundMessageEvent } from "@featherbot/bus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppChannel } from "./whatsapp.js";

// biome-ignore lint/suspicious/noExplicitAny: mock handler types
type Handler = (...args: any[]) => void;

const { mockSendMessage, mockEnd, evHandlers, mockSaveCreds, mockDownloadMedia } = vi.hoisted(
	() => ({
		mockSendMessage: vi.fn(),
		mockEnd: vi.fn(),
		evHandlers: new Map<string, Handler>(),
		mockSaveCreds: vi.fn(),
		mockDownloadMedia: vi.fn(),
	}),
);

vi.mock("@whiskeysockets/baileys", () => ({
	useMultiFileAuthState: vi.fn().mockResolvedValue({
		state: { creds: {}, keys: {} },
		saveCreds: mockSaveCreds,
	}),
	makeWASocket: vi.fn().mockImplementation(() => ({
		ev: {
			on: (event: string, handler: Handler) => {
				evHandlers.set(event, handler);
			},
		},
		sendMessage: mockSendMessage,
		end: mockEnd,
	})),
	downloadMediaMessage: mockDownloadMedia,
}));

function makeMessage(
	remoteJid: string,
	// biome-ignore lint/suspicious/noExplicitAny: flexible message content for tests
	message: any,
	fromMe = false,
	id = "msg-123",
) {
	return {
		key: { remoteJid, fromMe, id },
		message,
	};
}

describe("WhatsAppChannel", () => {
	let bus: MessageBus;
	let channel: WhatsAppChannel;

	beforeEach(() => {
		bus = new MessageBus();
		evHandlers.clear();
		mockSendMessage.mockReset();
		mockEnd.mockReset();
		mockSaveCreds.mockReset();
		mockDownloadMedia.mockReset();
	});

	afterEach(() => {
		bus.close();
	});

	it("has name 'whatsapp'", () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });
		expect(channel.name).toBe("whatsapp");
	});

	it("publishes inbound message on text message (conversation)", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		expect(handler).toBeDefined();
		await handler?.({
			messages: [makeMessage("1234567890@s.whatsapp.net", { conversation: "Hello" })],
			type: "notify",
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.message.channel).toBe("whatsapp");
		expect(events[0]?.message.content).toBe("Hello");
		expect(events[0]?.message.metadata).toEqual({ whatsappMessageId: "msg-123" });
	});

	it("publishes inbound message on extended text (reply)", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [
				makeMessage("1234567890@s.whatsapp.net", {
					extendedTextMessage: { text: "Reply to you" },
				}),
			],
			type: "notify",
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("Reply to you");
	});

	it("skips fromMe messages", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [makeMessage("1234567890@s.whatsapp.net", { conversation: "My own msg" }, true)],
			type: "notify",
		});

		expect(events).toHaveLength(0);
	});

	it("skips status@broadcast messages", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [makeMessage("status@broadcast", { conversation: "Status update" })],
			type: "notify",
		});

		expect(events).toHaveLength(0);
	});

	it("skips group messages (@g.us JID)", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [makeMessage("120363000000000000@g.us", { conversation: "Group msg" })],
			type: "notify",
		});

		expect(events).toHaveLength(0);
	});

	it("strips JID domain for senderId (phone number only)", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [makeMessage("919876543210@s.whatsapp.net", { conversation: "Hi" })],
			type: "notify",
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.message.senderId).toBe("whatsapp:919876543210");
	});

	it("uses full JID for chatId", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [makeMessage("919876543210@s.whatsapp.net", { conversation: "Hi" })],
			type: "notify",
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.message.chatId).toBe("919876543210@s.whatsapp.net");
	});

	it("sends outbound message via sock.sendMessage", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });
		await channel.start();

		await channel.send({
			channel: "whatsapp",
			chatId: "1234567890@s.whatsapp.net",
			content: "Hello from bot",
			replyTo: null,
			media: [],
			metadata: {},
			messageId: "msg-1",
			inReplyToMessageId: null,
		});

		expect(mockSendMessage).toHaveBeenCalledWith("1234567890@s.whatsapp.net", {
			text: "Hello from bot",
		});
	});

	it("respects allowFrom access control", async () => {
		channel = new WhatsAppChannel({
			bus,
			authDir: "/tmp/wa-auth",
			allowFrom: ["whatsapp:100"],
		});

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		// Allowed user
		await handler?.({
			messages: [makeMessage("100@s.whatsapp.net", { conversation: "Allowed" })],
			type: "notify",
		});
		// Denied user
		await handler?.({
			messages: [makeMessage("999@s.whatsapp.net", { conversation: "Denied" })],
			type: "notify",
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("Allowed");
	});

	it("handles errors in message handler without crashing", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await channel.start();

		bus.subscribe("message:inbound", () => {
			throw new Error("Bus error");
		});

		const handler = evHandlers.get("messages.upsert");
		// Should not throw
		await handler?.({
			messages: [makeMessage("1234567890@s.whatsapp.net", { conversation: "Hello" })],
			type: "notify",
		});

		consoleSpy.mockRestore();
	});

	it("handles errors in send without crashing", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await channel.start();
		mockSendMessage.mockRejectedValueOnce(new Error("Send failed"));

		await channel.send({
			channel: "whatsapp",
			chatId: "1234567890@s.whatsapp.net",
			content: "Hello",
			replyTo: null,
			media: [],
			metadata: {},
			messageId: "msg-1",
			inReplyToMessageId: null,
		});

		expect(consoleSpy).toHaveBeenCalledWith("WhatsApp send error:", expect.any(Error));
		consoleSpy.mockRestore();
	});

	it("stop() calls sock.end()", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });
		await channel.start();
		await channel.stop();

		expect(mockEnd).toHaveBeenCalled();
	});

	it("stop() is safe to call without start", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });
		// Should not throw
		await channel.stop();
	});

	it("skips non-notify message types", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [makeMessage("1234567890@s.whatsapp.net", { conversation: "Append msg" })],
			type: "append",
		});

		expect(events).toHaveLength(0);
	});

	it("transcribes audio message when transcriber is configured", async () => {
		const mockTranscriber = {
			transcribe: vi.fn().mockResolvedValue({ text: "hello from voice" }),
		};
		channel = new WhatsAppChannel({
			bus,
			authDir: "/tmp/wa-auth",
			transcriber: mockTranscriber,
		});

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		mockDownloadMedia.mockResolvedValue(Buffer.from("audio-data"));

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [
				makeMessage("1234567890@s.whatsapp.net", {
					audioMessage: { seconds: 5, mimetype: "audio/ogg; codecs=opus" },
				}),
			],
			type: "notify",
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("[Voice transcription]: hello from voice");
	});

	it("falls back to placeholder when no transcriber for audio", async () => {
		channel = new WhatsAppChannel({ bus, authDir: "/tmp/wa-auth" });

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [
				makeMessage("1234567890@s.whatsapp.net", {
					audioMessage: { seconds: 5, mimetype: "audio/ogg" },
				}),
			],
			type: "notify",
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("[Voice Message]");
	});

	it("falls back to placeholder when audio transcription fails", async () => {
		const mockTranscriber = {
			transcribe: vi.fn().mockRejectedValue(new Error("API error")),
		};
		channel = new WhatsAppChannel({
			bus,
			authDir: "/tmp/wa-auth",
			transcriber: mockTranscriber,
		});
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		mockDownloadMedia.mockResolvedValue(Buffer.from("audio-data"));

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [
				makeMessage("1234567890@s.whatsapp.net", {
					audioMessage: { seconds: 5, mimetype: "audio/ogg" },
				}),
			],
			type: "notify",
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toBe("[Voice Message]");
		consoleSpy.mockRestore();
	});

	it("rejects audio message exceeding duration limit", async () => {
		const mockTranscriber = {
			transcribe: vi.fn(),
		};
		channel = new WhatsAppChannel({
			bus,
			authDir: "/tmp/wa-auth",
			transcriber: mockTranscriber,
		});

		const events: InboundMessageEvent[] = [];
		bus.subscribe("message:inbound", (event) => {
			events.push(event);
		});

		await channel.start();

		const handler = evHandlers.get("messages.upsert");
		await handler?.({
			messages: [
				makeMessage("1234567890@s.whatsapp.net", {
					audioMessage: { seconds: 300, mimetype: "audio/ogg" },
				}),
			],
			type: "notify",
		});

		expect(events).toHaveLength(1);
		expect(events[0]?.message.content).toContain("[Voice message rejected: duration 300s");
		expect(mockTranscriber.transcribe).not.toHaveBeenCalled();
	});
});
