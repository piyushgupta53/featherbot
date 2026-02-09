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
			try {
				const result = await this.agentLoop.processMessage(message);
				if (result.finishReason === BATCHED_FINISH_REASON) return;
				const outbound = createOutboundMessage({
					channel: message.channel,
					chatId: message.chatId,
					content: result.text,
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
