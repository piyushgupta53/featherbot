import { describe, expect, it, vi } from "vitest";
import { MessageBus } from "./bus.js";
import type {
	BusErrorEvent,
	InboundMessage,
	InboundMessageEvent,
	OutboundMessage,
	OutboundMessageEvent,
} from "./types.js";

function createInboundEvent(): InboundMessageEvent {
	const message: InboundMessage = {
		channel: "telegram",
		senderId: "user-1",
		chatId: "chat-1",
		content: "hello",
		timestamp: new Date(),
		media: [],
		metadata: {},
		messageId: "msg-1",
	};
	return { type: "message:inbound", message, timestamp: new Date() };
}

function createOutboundEvent(): OutboundMessageEvent {
	const message: OutboundMessage = {
		channel: "telegram",
		chatId: "chat-1",
		content: "hi there",
		replyTo: null,
		media: [],
		metadata: {},
		messageId: "msg-2",
		inReplyToMessageId: "msg-1",
	};
	return { type: "message:outbound", message, timestamp: new Date() };
}

describe("MessageBus", () => {
	it("calls subscribed handler for inbound event", async () => {
		const bus = new MessageBus();
		const handler = vi.fn();
		const event = createInboundEvent();

		bus.subscribe("message:inbound", handler);
		await bus.publish(event);

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(event);
	});

	it("calls subscribed handler for outbound event", async () => {
		const bus = new MessageBus();
		const handler = vi.fn();
		const event = createOutboundEvent();

		bus.subscribe("message:outbound", handler);
		await bus.publish(event);

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(event);
	});

	it("calls multiple handlers in subscription order", async () => {
		const bus = new MessageBus();
		const order: number[] = [];

		bus.subscribe("message:inbound", () => {
			order.push(1);
		});
		bus.subscribe("message:inbound", () => {
			order.push(2);
		});
		bus.subscribe("message:inbound", () => {
			order.push(3);
		});

		await bus.publish(createInboundEvent());

		expect(order).toEqual([1, 2, 3]);
	});

	it("does not call handlers for different event types", async () => {
		const bus = new MessageBus();
		const inboundHandler = vi.fn();
		const outboundHandler = vi.fn();

		bus.subscribe("message:inbound", inboundHandler);
		bus.subscribe("message:outbound", outboundHandler);

		await bus.publish(createInboundEvent());

		expect(inboundHandler).toHaveBeenCalledOnce();
		expect(outboundHandler).not.toHaveBeenCalled();
	});

	it("awaits async handlers serially", async () => {
		const bus = new MessageBus();
		const order: number[] = [];

		bus.subscribe("message:inbound", async () => {
			await new Promise((r) => setTimeout(r, 50));
			order.push(1);
		});
		bus.subscribe("message:inbound", () => {
			order.push(2);
		});

		await bus.publish(createInboundEvent());

		expect(order).toEqual([1, 2]);
	});

	it("emits bus:error when handler throws", async () => {
		const bus = new MessageBus();
		const handlerError = new Error("handler failed");
		const errorHandler = vi.fn();
		const inboundEvent = createInboundEvent();

		bus.subscribe("message:inbound", () => {
			throw handlerError;
		});
		bus.subscribe("bus:error", errorHandler);

		await bus.publish(inboundEvent);

		expect(errorHandler).toHaveBeenCalledOnce();
		const errorEvent = errorHandler.mock.calls[0]?.[0] as BusErrorEvent;
		expect(errorEvent.type).toBe("bus:error");
		expect(errorEvent.error).toBe(handlerError);
		expect(errorEvent.sourceEvent).toBe(inboundEvent);
	});

	it("does not recurse when bus:error handler throws", async () => {
		const warnFn = vi.fn();
		const bus = new MessageBus({ logger: { warn: warnFn } });

		bus.subscribe("message:inbound", () => {
			throw new Error("inbound fail");
		});
		bus.subscribe("bus:error", () => {
			throw new Error("error handler fail");
		});

		await bus.publish(createInboundEvent());

		expect(warnFn).toHaveBeenCalledOnce();
		expect(warnFn.mock.calls[0]?.[0]).toBe("Error in bus:error handler (swallowed)");
	});

	it("removes handler on unsubscribe", async () => {
		const bus = new MessageBus();
		const handler = vi.fn();

		bus.subscribe("message:inbound", handler);
		bus.unsubscribe("message:inbound", handler);

		await bus.publish(createInboundEvent());

		expect(handler).not.toHaveBeenCalled();
	});

	it("removes all handlers on close", async () => {
		const bus = new MessageBus();
		const inboundHandler = vi.fn();
		const outboundHandler = vi.fn();
		const errorHandler = vi.fn();

		bus.subscribe("message:inbound", inboundHandler);
		bus.subscribe("message:outbound", outboundHandler);
		bus.subscribe("bus:error", errorHandler);

		bus.close();

		await bus.publish(createInboundEvent());
		await bus.publish(createOutboundEvent());

		expect(inboundHandler).not.toHaveBeenCalled();
		expect(outboundHandler).not.toHaveBeenCalled();
		expect(errorHandler).not.toHaveBeenCalled();
	});

	it("resolves without error when no subscribers", async () => {
		const bus = new MessageBus();
		await expect(bus.publish(createInboundEvent())).resolves.toBeUndefined();
	});
});
