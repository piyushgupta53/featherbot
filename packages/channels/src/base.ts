import type { InboundMessage, MessageBus, OutboundMessage } from "@featherbot/bus";
import type { AudioTranscriber, ChannelOptions } from "./types.js";

export abstract class BaseChannel {
	abstract readonly name: string;

	protected readonly bus: MessageBus;
	protected readonly transcriber: AudioTranscriber | undefined;
	private readonly allowFrom: string[];

	constructor(options: ChannelOptions) {
		this.bus = options.bus;
		this.allowFrom = options.allowFrom ?? [];
		this.transcriber = options.transcriber;
	}

	abstract start(): Promise<void>;
	abstract stop(): Promise<void>;
	abstract send(message: OutboundMessage): Promise<void>;

	isAllowed(senderId: string): boolean {
		if (this.allowFrom.length === 0) {
			return true;
		}
		return this.allowFrom.includes(senderId);
	}

	protected async publishInbound(message: InboundMessage): Promise<void> {
		if (!this.isAllowed(message.senderId)) {
			return;
		}
		await this.bus.publish({
			type: "message:inbound",
			message,
			timestamp: new Date(),
		});
	}
}
