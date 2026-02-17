import type {
	BusEventHandler,
	InboundMessage,
	InboundMessageEvent,
	MessageBus,
} from "@featherbot/bus";
import { createOutboundMessage } from "@featherbot/bus";
import type { AgentLoopResult } from "@featherbot/core";
import { BATCHED_FINISH_REASON } from "./session-queue.js";

export interface AgentProcessor {
	processMessage(inbound: InboundMessage): Promise<AgentLoopResult>;
}

export interface BusAdapterOptions {
	bus: MessageBus;
	agentLoop: AgentProcessor;
}

export class BusAdapter {
	private readonly bus: MessageBus;
	private readonly agentLoop: AgentProcessor;
	private handler: BusEventHandler<InboundMessageEvent> | undefined;

	constructor(options: BusAdapterOptions) {
		this.bus = options.bus;
		this.agentLoop = options.agentLoop;
	}

	start(): void {
		this.handler = async (event: InboundMessageEvent) => {
			const { message } = event;
			const chatId = message.chatId;
			try {
				console.log(
					`[adapter] Processing message from ${message.channel}:${chatId}: "${message.content.slice(0, 50)}..."`,
				);
				const result = await this.agentLoop.processMessage(message);
				console.log(
					`[adapter] Got result for ${message.channel}:${chatId} - finishReason: ${result.finishReason}, text length: ${result.text.length}`,
				);
				if (result.finishReason === BATCHED_FINISH_REASON) {
					console.log(`[adapter] Skipping batched message for ${message.channel}:${chatId}`);
					// Still publish an outbound so the channel can clear typing indicators
					await this.bus.publish({
						type: "message:outbound",
						message: createOutboundMessage({
							channel: message.channel,
							chatId: message.chatId,
							content: "",
							replyTo: null,
							media: [],
							metadata: { batched: true },
							inReplyToMessageId: null,
						}),
						timestamp: new Date(),
					});
					return;
				}
				const content = result.text.trim() || "I couldn't generate a response. Please try again.";
				console.log(
					`[adapter] Sending response to ${message.channel}:${chatId}: "${content.slice(0, 100)}..."`,
				);
				const outbound = createOutboundMessage({
					channel: message.channel,
					chatId: message.chatId,
					content,
					replyTo: null,
					media: [],
					metadata: {},
					inReplyToMessageId: message.messageId,
				});
				await this.bus.publish({
					type: "message:outbound",
					message: outbound,
					timestamp: new Date(),
				});
			} catch (err) {
				const errorText = err instanceof Error ? err.message : String(err);
				console.error(
					`[adapter] Error processing message from ${message.channel}:${chatId}: ${errorText}`,
				);
				const fallback = createOutboundMessage({
					channel: message.channel,
					chatId: message.chatId,
					content: `Error: ${errorText}`,
					replyTo: null,
					media: [],
					metadata: { error: true },
					inReplyToMessageId: message.messageId,
				});
				await this.bus.publish({
					type: "message:outbound",
					message: fallback,
					timestamp: new Date(),
				});
				console.log(`[adapter] Sent error response to ${message.channel}:${chatId}`);
			}
		};
		this.bus.subscribe("message:inbound", this.handler);
	}

	stop(): void {
		if (this.handler !== undefined) {
			this.bus.unsubscribe("message:inbound", this.handler);
			this.handler = undefined;
		}
	}
}
