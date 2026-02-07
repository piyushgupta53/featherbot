import { randomUUID } from "node:crypto";
import type { InboundMessage, OutboundMessage } from "./types.js";

export function createInboundMessage(
	params: Omit<InboundMessage, "messageId" | "timestamp"> &
		Partial<Pick<InboundMessage, "messageId" | "timestamp">>,
): InboundMessage {
	return {
		...params,
		messageId: params.messageId ?? randomUUID(),
		timestamp: params.timestamp ?? new Date(),
	};
}

export function createOutboundMessage(
	params: Omit<OutboundMessage, "messageId"> & Partial<Pick<OutboundMessage, "messageId">>,
): OutboundMessage {
	return {
		...params,
		messageId: params.messageId ?? randomUUID(),
	};
}
