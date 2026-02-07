import { EventEmitter } from "node:events";
import type {
	BusErrorEvent,
	BusEvent,
	BusEventHandler,
	BusEventType,
	InboundMessageEvent,
	OutboundMessageEvent,
} from "./types.js";

export interface MessageBusOptions {
	logger?: {
		warn: (msg: string, meta?: Record<string, unknown>) => void;
	};
}

export class MessageBus {
	private readonly emitter = new EventEmitter();
	private readonly logger?: MessageBusOptions["logger"];

	constructor(options?: MessageBusOptions) {
		this.logger = options?.logger;
	}

	subscribe(type: "message:inbound", handler: BusEventHandler<InboundMessageEvent>): void;
	subscribe(type: "message:outbound", handler: BusEventHandler<OutboundMessageEvent>): void;
	subscribe(type: "bus:error", handler: BusEventHandler<BusErrorEvent>): void;
	subscribe(
		type: BusEventType,
		// biome-ignore lint/suspicious/noExplicitAny: handler type varies per overload
		handler: BusEventHandler<any>,
	): void {
		this.emitter.on(type, handler);
	}

	unsubscribe(
		type: BusEventType,
		// biome-ignore lint/suspicious/noExplicitAny: handler type varies per overload
		handler: BusEventHandler<any>,
	): void {
		this.emitter.removeListener(type, handler);
	}

	async publish(event: BusEvent): Promise<void> {
		const handlers = this.emitter.listeners(event.type) as Array<
			// biome-ignore lint/suspicious/noExplicitAny: listeners returns generic Function[]
			BusEventHandler<any>
		>;
		for (const handler of handlers) {
			try {
				await handler(event);
			} catch (err) {
				if (event.type === "bus:error") {
					this.logger?.warn("Error in bus:error handler (swallowed)", {
						error: err instanceof Error ? err.message : String(err),
					});
				} else {
					const errorEvent: BusErrorEvent = {
						type: "bus:error",
						error: err instanceof Error ? err : new Error(String(err)),
						sourceEvent: event,
						timestamp: new Date(),
					};
					await this.publish(errorEvent);
				}
			}
		}
	}

	close(): void {
		this.emitter.removeAllListeners();
	}
}
