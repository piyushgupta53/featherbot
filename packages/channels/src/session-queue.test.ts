import { createInboundMessage } from "@featherbot/bus";
import type { InboundMessage } from "@featherbot/bus";
import type { AgentLoopResult } from "@featherbot/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProcessor } from "./adapter.js";
import { BATCHED_FINISH_REASON, SessionQueue } from "./session-queue.js";

function makeResult(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
	return {
		text: overrides.text ?? "response",
		usage: overrides.usage ?? {
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
		},
		steps: overrides.steps ?? 1,
		finishReason: overrides.finishReason ?? "stop",
		toolCalls: overrides.toolCalls ?? [],
		toolResults: overrides.toolResults ?? [],
	};
}

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
	return createInboundMessage({
		channel: overrides.channel ?? "telegram",
		senderId: overrides.senderId ?? "user-1",
		chatId: overrides.chatId ?? "chat-1",
		content: overrides.content ?? "hello",
		media: overrides.media ?? [],
		metadata: overrides.metadata ?? {},
	});
}

function makeMockAgent(): AgentProcessor & {
	processMessage: ReturnType<typeof vi.fn>;
} {
	return {
		processMessage: vi
			.fn<(inbound: InboundMessage) => Promise<AgentLoopResult>>()
			.mockResolvedValue(makeResult()),
	};
}

describe("SessionQueue", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("single message", () => {
		it("passes through after debounce", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			const promise = queue.processMessage(makeMessage({ content: "hi" }));
			await vi.advanceTimersByTimeAsync(500);
			const result = await promise;

			expect(agent.processMessage).toHaveBeenCalledOnce();
			expect(result.text).toBe("response");
			expect(result.finishReason).toBe("stop");
			queue.dispose();
		});

		it("does not call agent before debounce fires", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			queue.processMessage(makeMessage());
			await vi.advanceTimersByTimeAsync(200);

			expect(agent.processMessage).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(300);
			expect(agent.processMessage).toHaveBeenCalledOnce();
			queue.dispose();
		});

		it("single message is not modified (no merge)", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 100 });
			const msg = makeMessage({ content: "only one" });

			const promise = queue.processMessage(msg);
			await vi.advanceTimersByTimeAsync(100);
			await promise;

			expect(agent.processMessage).toHaveBeenCalledWith(msg);
			queue.dispose();
		});
	});

	describe("batching", () => {
		it("3 rapid messages produce 1 agent call", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			const p1 = queue.processMessage(makeMessage({ content: "a" }));
			const p2 = queue.processMessage(makeMessage({ content: "b" }));
			const p3 = queue.processMessage(makeMessage({ content: "c" }));

			await vi.advanceTimersByTimeAsync(500);
			await Promise.all([p1, p2, p3]);

			expect(agent.processMessage).toHaveBeenCalledOnce();
			queue.dispose();
		});

		it("last caller gets real result, earlier callers get batched sentinel", async () => {
			const realResult = makeResult({ text: "combined answer" });
			const agent = makeMockAgent();
			agent.processMessage.mockResolvedValue(realResult);
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			const p1 = queue.processMessage(makeMessage({ content: "a" }));
			const p2 = queue.processMessage(makeMessage({ content: "b" }));
			const p3 = queue.processMessage(makeMessage({ content: "c" }));

			await vi.advanceTimersByTimeAsync(500);
			const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

			expect(r1.finishReason).toBe(BATCHED_FINISH_REASON);
			expect(r2.finishReason).toBe(BATCHED_FINISH_REASON);
			expect(r3.text).toBe("combined answer");
			expect(r3.finishReason).toBe("stop");
			queue.dispose();
		});

		it("merged content joins with newline", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			const p1 = queue.processMessage(makeMessage({ content: "check calendar" }));
			const p2 = queue.processMessage(makeMessage({ content: "actually wait" }));
			const p3 = queue.processMessage(makeMessage({ content: "check tomorrow" }));

			await vi.advanceTimersByTimeAsync(500);
			await Promise.all([p1, p2, p3]);

			const call = agent.processMessage.mock.calls[0]?.[0] as InboundMessage;
			expect(call.content).toBe("check calendar\nactually wait\ncheck tomorrow");
			queue.dispose();
		});

		it("merged media is deduplicated", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			const p1 = queue.processMessage(
				makeMessage({ content: "a", media: ["img1.jpg", "img2.jpg"] }),
			);
			const p2 = queue.processMessage(
				makeMessage({ content: "b", media: ["img2.jpg", "img3.jpg"] }),
			);

			await vi.advanceTimersByTimeAsync(500);
			await Promise.all([p1, p2]);

			const call = agent.processMessage.mock.calls[0]?.[0] as InboundMessage;
			expect(call.media).toEqual(["img1.jpg", "img2.jpg", "img3.jpg"]);
			queue.dispose();
		});

		it("merged metadata combines all entries (later overrides earlier)", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			const p1 = queue.processMessage(
				makeMessage({ content: "a", metadata: { key1: "v1", shared: "first" } }),
			);
			const p2 = queue.processMessage(
				makeMessage({ content: "b", metadata: { key2: "v2", shared: "second" } }),
			);

			await vi.advanceTimersByTimeAsync(500);
			await Promise.all([p1, p2]);

			const call = agent.processMessage.mock.calls[0]?.[0] as InboundMessage;
			expect(call.metadata).toEqual({
				key1: "v1",
				key2: "v2",
				shared: "second",
			});
			queue.dispose();
		});

		it("uses last message's messageId and timestamp", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			const msg1 = makeMessage({ content: "a" });
			const msg2 = makeMessage({ content: "b" });

			const p1 = queue.processMessage(msg1);
			const p2 = queue.processMessage(msg2);

			await vi.advanceTimersByTimeAsync(500);
			await Promise.all([p1, p2]);

			const call = agent.processMessage.mock.calls[0]?.[0] as InboundMessage;
			expect(call.messageId).toBe(msg2.messageId);
			queue.dispose();
		});
	});

	describe("debounce reset", () => {
		it("timer resets on each new message", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			queue.processMessage(makeMessage({ content: "a" }));
			await vi.advanceTimersByTimeAsync(400);
			expect(agent.processMessage).not.toHaveBeenCalled();

			// Reset the timer
			queue.processMessage(makeMessage({ content: "b" }));
			await vi.advanceTimersByTimeAsync(400);
			expect(agent.processMessage).not.toHaveBeenCalled();

			// Now the full 500ms passes from last message
			await vi.advanceTimersByTimeAsync(100);
			expect(agent.processMessage).toHaveBeenCalledOnce();
			queue.dispose();
		});
	});

	describe("serialization", () => {
		it("messages during processing queue for next batch", async () => {
			const agent = makeMockAgent();
			let resolveProcessing!: (value: AgentLoopResult) => void;
			agent.processMessage.mockImplementationOnce(
				() =>
					new Promise<AgentLoopResult>((resolve) => {
						resolveProcessing = resolve;
					}),
			);

			const queue = new SessionQueue(agent, { debounceMs: 200 });

			// First message — starts debounce
			const p1 = queue.processMessage(makeMessage({ content: "first" }));
			await vi.advanceTimersByTimeAsync(200);
			// Now processing first batch

			// Messages arrive during processing — no timer, just queued
			const p2 = queue.processMessage(makeMessage({ content: "second" }));
			const p3 = queue.processMessage(makeMessage({ content: "third" }));

			// Complete first processing
			resolveProcessing(makeResult({ text: "first answer" }));
			await p1;

			// New debounce cycle starts for queued messages
			expect(agent.processMessage).toHaveBeenCalledOnce();

			await vi.advanceTimersByTimeAsync(200);
			await Promise.all([p2, p3]);

			expect(agent.processMessage).toHaveBeenCalledTimes(2);

			// Second call merged the two queued messages
			const secondCall = agent.processMessage.mock.calls[1]?.[0] as InboundMessage;
			expect(secondCall.content).toBe("second\nthird");
			queue.dispose();
		});
	});

	describe("session isolation", () => {
		it("different sessions are independent", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			const pA = queue.processMessage(makeMessage({ chatId: "chat-A", content: "msg-A" }));
			const pB = queue.processMessage(makeMessage({ chatId: "chat-B", content: "msg-B" }));

			await vi.advanceTimersByTimeAsync(500);
			await Promise.all([pA, pB]);

			expect(agent.processMessage).toHaveBeenCalledTimes(2);

			const callA = agent.processMessage.mock.calls[0]?.[0] as InboundMessage;
			const callB = agent.processMessage.mock.calls[1]?.[0] as InboundMessage;
			expect(callA.content).toBe("msg-A");
			expect(callB.content).toBe("msg-B");
			queue.dispose();
		});

		it("batching is per-session", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 500 });

			const p1 = queue.processMessage(makeMessage({ chatId: "chat-A", content: "a1" }));
			const p2 = queue.processMessage(makeMessage({ chatId: "chat-A", content: "a2" }));
			const p3 = queue.processMessage(makeMessage({ chatId: "chat-B", content: "b1" }));

			await vi.advanceTimersByTimeAsync(500);
			await Promise.all([p1, p2, p3]);

			expect(agent.processMessage).toHaveBeenCalledTimes(2);

			const callA = agent.processMessage.mock.calls[0]?.[0] as InboundMessage;
			expect(callA.content).toBe("a1\na2");
			expect(callA.chatId).toBe("chat-A");

			const callB = agent.processMessage.mock.calls[1]?.[0] as InboundMessage;
			expect(callB.content).toBe("b1");
			expect(callB.chatId).toBe("chat-B");
			queue.dispose();
		});
	});

	describe("error handling", () => {
		it("all batch promises reject on error", async () => {
			const agent = makeMockAgent();
			agent.processMessage.mockRejectedValue(new Error("LLM down"));
			const queue = new SessionQueue(agent, { debounceMs: 200 });

			const p1 = queue.processMessage(makeMessage({ content: "a" })).catch((e) => e);
			const p2 = queue.processMessage(makeMessage({ content: "b" })).catch((e) => e);

			await vi.advanceTimersByTimeAsync(200);

			const e1 = await p1;
			const e2 = await p2;
			expect(e1).toBeInstanceOf(Error);
			expect((e1 as Error).message).toBe("LLM down");
			expect(e2).toBeInstanceOf(Error);
			expect((e2 as Error).message).toBe("LLM down");
			queue.dispose();
		});

		it("one session error does not affect another", async () => {
			const agent = makeMockAgent();
			agent.processMessage
				.mockRejectedValueOnce(new Error("fail"))
				.mockResolvedValueOnce(makeResult({ text: "ok" }));

			const queue = new SessionQueue(agent, { debounceMs: 200 });

			const pA = queue
				.processMessage(makeMessage({ chatId: "chat-A", content: "a" }))
				.catch((e) => e);
			const pB = queue.processMessage(makeMessage({ chatId: "chat-B", content: "b" }));

			await vi.advanceTimersByTimeAsync(200);

			const eA = await pA;
			expect(eA).toBeInstanceOf(Error);
			expect((eA as Error).message).toBe("fail");
			const resultB = await pB;
			expect(resultB.text).toBe("ok");
			queue.dispose();
		});

		it("next batch works after error", async () => {
			const agent = makeMockAgent();
			agent.processMessage
				.mockRejectedValueOnce(new Error("temporary"))
				.mockResolvedValueOnce(makeResult({ text: "recovered" }));

			const queue = new SessionQueue(agent, { debounceMs: 200 });

			const p1 = queue.processMessage(makeMessage({ content: "a" })).catch((e) => e);
			await vi.advanceTimersByTimeAsync(200);
			const e1 = await p1;
			expect(e1).toBeInstanceOf(Error);
			expect((e1 as Error).message).toBe("temporary");

			const p2 = queue.processMessage(makeMessage({ content: "b" }));
			await vi.advanceTimersByTimeAsync(200);
			const result = await p2;
			expect(result.text).toBe("recovered");
			queue.dispose();
		});
	});

	describe("dispose", () => {
		it("rejects all pending promises", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 1000 });

			const p1 = queue.processMessage(makeMessage({ content: "a" })).catch((e) => e);
			const p2 = queue.processMessage(makeMessage({ content: "b" })).catch((e) => e);

			queue.dispose();

			const e1 = await p1;
			const e2 = await p2;
			expect(e1).toBeInstanceOf(Error);
			expect((e1 as Error).message).toBe("SessionQueue disposed");
			expect(e2).toBeInstanceOf(Error);
			expect((e2 as Error).message).toBe("SessionQueue disposed");
		});

		it("clears timers on dispose", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 1000 });

			queue.processMessage(makeMessage({ content: "a" })).catch(() => {});
			queue.dispose();

			await vi.advanceTimersByTimeAsync(2000);
			expect(agent.processMessage).not.toHaveBeenCalled();
		});

		it("rejects new messages after dispose", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 100 });
			queue.dispose();

			await expect(queue.processMessage(makeMessage({ content: "late" }))).rejects.toThrow(
				"SessionQueue is disposed",
			);
		});
	});

	describe("edge cases", () => {
		it("debounceMs=0 still works", async () => {
			const agent = makeMockAgent();
			const queue = new SessionQueue(agent, { debounceMs: 0 });

			const promise = queue.processMessage(makeMessage({ content: "instant" }));
			await vi.advanceTimersByTimeAsync(0);
			const result = await promise;

			expect(agent.processMessage).toHaveBeenCalledOnce();
			expect(result.finishReason).toBe("stop");
			queue.dispose();
		});
	});
});
