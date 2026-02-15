import { MessageBus, createInboundMessage } from "@featherbot/bus";
import type { InboundMessage, OutboundMessageEvent } from "@featherbot/bus";
import type { AgentLoopResult } from "@featherbot/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProcessor } from "./adapter.js";
import { BusAdapter } from "./adapter.js";
import { BATCHED_FINISH_REASON } from "./session-queue.js";

function makeMockAgent(result: Partial<AgentLoopResult> = {}): AgentProcessor {
	return {
		processMessage: vi
			.fn<(inbound: InboundMessage) => Promise<AgentLoopResult>>()
			.mockResolvedValue({
				text: result.text ?? "mock response",
				usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				steps: result.steps ?? 1,
				finishReason: result.finishReason ?? "stop",
				toolCalls: result.toolCalls ?? [],
				toolResults: result.toolResults ?? [],
			}),
	};
}

describe("BusAdapter", () => {
	let bus: MessageBus;

	afterEach(() => {
		bus.close();
	});

	it("routes inbound message through agent and publishes outbound", async () => {
		bus = new MessageBus();
		const agent = makeMockAgent({ text: "Hello back!" });
		const adapter = new BusAdapter({ bus, agentLoop: agent });
		adapter.start();

		const outboundEvents: OutboundMessageEvent[] = [];
		bus.subscribe("message:outbound", (event) => {
			outboundEvents.push(event);
		});

		const inbound = createInboundMessage({
			channel: "terminal",
			senderId: "user-1",
			chatId: "chat-1",
			content: "Hello",
			media: [],
			metadata: {},
		});

		await bus.publish({ type: "message:inbound", message: inbound, timestamp: new Date() });

		expect(agent.processMessage).toHaveBeenCalledOnce();
		expect(agent.processMessage).toHaveBeenCalledWith(inbound);
		expect(outboundEvents).toHaveLength(1);
		expect(outboundEvents[0]?.message.content).toBe("Hello back!");
		expect(outboundEvents[0]?.message.channel).toBe("terminal");
		expect(outboundEvents[0]?.message.chatId).toBe("chat-1");
		expect(outboundEvents[0]?.message.inReplyToMessageId).toBe(inbound.messageId);

		adapter.stop();
	});

	it("publishes fallback error outbound when agent throws", async () => {
		bus = new MessageBus();
		const agent: AgentProcessor = {
			processMessage: vi.fn().mockRejectedValue(new Error("LLM failed")),
		};
		const adapter = new BusAdapter({ bus, agentLoop: agent });
		adapter.start();

		const outboundEvents: OutboundMessageEvent[] = [];
		bus.subscribe("message:outbound", (event) => {
			outboundEvents.push(event);
		});

		const inbound = createInboundMessage({
			channel: "telegram",
			senderId: "user-2",
			chatId: "chat-2",
			content: "Hi",
			media: [],
			metadata: {},
		});

		await bus.publish({ type: "message:inbound", message: inbound, timestamp: new Date() });

		expect(outboundEvents).toHaveLength(1);
		expect(outboundEvents[0]?.message.content).toBe("Error: LLM failed");
		expect(outboundEvents[0]?.message.channel).toBe("telegram");
		expect(outboundEvents[0]?.message.metadata).toEqual({ error: true });

		adapter.stop();
	});

	it("suppresses outbound when agent returns BATCHED_FINISH_REASON", async () => {
		bus = new MessageBus();
		const agent = makeMockAgent({ finishReason: BATCHED_FINISH_REASON });
		const adapter = new BusAdapter({ bus, agentLoop: agent });
		adapter.start();

		const outboundEvents: OutboundMessageEvent[] = [];
		bus.subscribe("message:outbound", (event) => {
			outboundEvents.push(event);
		});

		const inbound = createInboundMessage({
			channel: "terminal",
			senderId: "user-1",
			chatId: "chat-1",
			content: "batched msg",
			media: [],
			metadata: {},
		});

		await bus.publish({ type: "message:inbound", message: inbound, timestamp: new Date() });

		expect(agent.processMessage).toHaveBeenCalledOnce();
		expect(outboundEvents).toHaveLength(0);

		adapter.stop();
	});

	it("preserves inReplyToMessageId from inbound message", async () => {
		bus = new MessageBus();
		const agent = makeMockAgent({ text: "reply" });
		const adapter = new BusAdapter({ bus, agentLoop: agent });
		adapter.start();

		const outboundEvents: OutboundMessageEvent[] = [];
		bus.subscribe("message:outbound", (event) => {
			outboundEvents.push(event);
		});

		const inbound = createInboundMessage({
			channel: "telegram",
			senderId: "user-1",
			chatId: "chat-1",
			content: "hello",
			media: [],
			metadata: {},
		});

		await bus.publish({ type: "message:inbound", message: inbound, timestamp: new Date() });

		expect(outboundEvents[0]?.message.inReplyToMessageId).toBe(inbound.messageId);
		expect(outboundEvents[0]?.message.channel).toBe("telegram");

		adapter.stop();
	});

	it("includes error metadata in fallback message", async () => {
		bus = new MessageBus();
		const agent: AgentProcessor = {
			processMessage: vi.fn().mockRejectedValue(new Error("timeout")),
		};
		const adapter = new BusAdapter({ bus, agentLoop: agent });
		adapter.start();

		const outboundEvents: OutboundMessageEvent[] = [];
		bus.subscribe("message:outbound", (event) => {
			outboundEvents.push(event);
		});

		const inbound = createInboundMessage({
			channel: "terminal",
			senderId: "user-1",
			chatId: "chat-1",
			content: "hi",
			media: [],
			metadata: {},
		});

		await bus.publish({ type: "message:inbound", message: inbound, timestamp: new Date() });

		expect(outboundEvents[0]?.message.content).toBe("Error: timeout");
		expect(outboundEvents[0]?.message.metadata).toEqual({ error: true });
		expect(outboundEvents[0]?.message.inReplyToMessageId).toBe(inbound.messageId);

		adapter.stop();
	});

	it("handles non-Error throws gracefully", async () => {
		bus = new MessageBus();
		const agent: AgentProcessor = {
			processMessage: vi.fn().mockRejectedValue("string error"),
		};
		const adapter = new BusAdapter({ bus, agentLoop: agent });
		adapter.start();

		const outboundEvents: OutboundMessageEvent[] = [];
		bus.subscribe("message:outbound", (event) => {
			outboundEvents.push(event);
		});

		const inbound = createInboundMessage({
			channel: "terminal",
			senderId: "user-1",
			chatId: "chat-1",
			content: "hi",
			media: [],
			metadata: {},
		});

		await bus.publish({ type: "message:inbound", message: inbound, timestamp: new Date() });

		expect(outboundEvents[0]?.message.content).toBe("Error: string error");

		adapter.stop();
	});

	it("substitutes fallback when agent returns empty text", async () => {
		bus = new MessageBus();
		const agent = makeMockAgent({ text: "" });
		const adapter = new BusAdapter({ bus, agentLoop: agent });
		adapter.start();

		const outboundEvents: OutboundMessageEvent[] = [];
		bus.subscribe("message:outbound", (event) => {
			outboundEvents.push(event);
		});

		const inbound = createInboundMessage({
			channel: "terminal",
			senderId: "user-1",
			chatId: "chat-1",
			content: "Hello",
			media: [],
			metadata: {},
		});

		await bus.publish({ type: "message:inbound", message: inbound, timestamp: new Date() });

		expect(outboundEvents).toHaveLength(1);
		expect(outboundEvents[0]?.message.content).toBe(
			"I couldn't generate a response. Please try again.",
		);

		adapter.stop();
	});

	it("substitutes fallback when agent returns whitespace-only text", async () => {
		bus = new MessageBus();
		const agent = makeMockAgent({ text: "   \n  " });
		const adapter = new BusAdapter({ bus, agentLoop: agent });
		adapter.start();

		const outboundEvents: OutboundMessageEvent[] = [];
		bus.subscribe("message:outbound", (event) => {
			outboundEvents.push(event);
		});

		const inbound = createInboundMessage({
			channel: "terminal",
			senderId: "user-1",
			chatId: "chat-1",
			content: "Hello",
			media: [],
			metadata: {},
		});

		await bus.publish({ type: "message:inbound", message: inbound, timestamp: new Date() });

		expect(outboundEvents).toHaveLength(1);
		expect(outboundEvents[0]?.message.content).toBe(
			"I couldn't generate a response. Please try again.",
		);

		adapter.stop();
	});

	it("stop() unsubscribes from bus", async () => {
		bus = new MessageBus();
		const agent = makeMockAgent();
		const adapter = new BusAdapter({ bus, agentLoop: agent });
		adapter.start();
		adapter.stop();

		const inbound = createInboundMessage({
			channel: "terminal",
			senderId: "user-1",
			chatId: "chat-1",
			content: "Hello",
			media: [],
			metadata: {},
		});

		await bus.publish({ type: "message:inbound", message: inbound, timestamp: new Date() });

		expect(agent.processMessage).not.toHaveBeenCalled();
	});
});
