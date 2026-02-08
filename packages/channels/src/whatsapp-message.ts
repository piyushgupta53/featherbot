import type { proto } from "@whiskeysockets/baileys";

/**
 * Extracts readable text from a Baileys message content object.
 * Returns null if the message type is not supported (caller should skip the message).
 */
export function extractWhatsAppText(message: proto.IMessage | null | undefined): string | null {
	if (message === null || message === undefined) {
		return null;
	}

	if (message.conversation) {
		return message.conversation;
	}

	if (message.extendedTextMessage?.text) {
		return message.extendedTextMessage.text;
	}

	if (message.imageMessage !== null && message.imageMessage !== undefined) {
		const caption = message.imageMessage.caption;
		return caption ? `[Image] ${caption}` : "[Image]";
	}

	if (message.videoMessage !== null && message.videoMessage !== undefined) {
		const caption = message.videoMessage.caption;
		return caption ? `[Video] ${caption}` : "[Video]";
	}

	if (message.documentMessage !== null && message.documentMessage !== undefined) {
		const caption = message.documentMessage.caption;
		return caption ? `[Document] ${caption}` : "[Document]";
	}

	if (message.audioMessage !== null && message.audioMessage !== undefined) {
		return "[Voice Message]";
	}

	return null;
}
