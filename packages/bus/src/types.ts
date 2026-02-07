export interface InboundMessage {
	channel: string;
	senderId: string;
	chatId: string;
	content: string;
	timestamp: Date;
	media: string[];
	metadata: Record<string, unknown>;
	messageId: string;
}

export interface OutboundMessage {
	channel: string;
	chatId: string;
	content: string;
	replyTo: string | null;
	media: string[];
	metadata: Record<string, unknown>;
	messageId: string;
	inReplyToMessageId: string | null;
}

export type SessionKey = `${string}:${string}`;

export interface InboundMessageEvent {
	type: "message:inbound";
	message: InboundMessage;
	timestamp: Date;
}

export interface OutboundMessageEvent {
	type: "message:outbound";
	message: OutboundMessage;
	timestamp: Date;
}

export interface BusErrorEvent {
	type: "bus:error";
	error: Error;
	sourceEvent?: BusEvent;
	timestamp: Date;
}

export type BusEvent = InboundMessageEvent | OutboundMessageEvent | BusErrorEvent;

export type BusEventType = "message:inbound" | "message:outbound" | "bus:error";

export type BusEventHandler<T> = (event: T) => void | Promise<void>;
