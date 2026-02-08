import { describe, expect, it } from "vitest";
import { extractWhatsAppText } from "./whatsapp-message.js";

describe("extractWhatsAppText", () => {
	it("returns null for null message", () => {
		expect(extractWhatsAppText(null)).toBeNull();
	});

	it("returns null for undefined message", () => {
		expect(extractWhatsAppText(undefined)).toBeNull();
	});

	it("extracts plain conversation text", () => {
		expect(extractWhatsAppText({ conversation: "Hello world" })).toBe("Hello world");
	});

	it("extracts extended text message (reply/link preview)", () => {
		expect(
			extractWhatsAppText({
				extendedTextMessage: { text: "Check this link" },
			}),
		).toBe("Check this link");
	});

	it("extracts image message with caption", () => {
		expect(
			extractWhatsAppText({
				imageMessage: { caption: "My photo" },
			}),
		).toBe("[Image] My photo");
	});

	it("extracts image message without caption", () => {
		expect(
			extractWhatsAppText({
				imageMessage: {},
			}),
		).toBe("[Image]");
	});

	it("extracts video message with caption", () => {
		expect(
			extractWhatsAppText({
				videoMessage: { caption: "Cool video" },
			}),
		).toBe("[Video] Cool video");
	});

	it("extracts video message without caption", () => {
		expect(
			extractWhatsAppText({
				videoMessage: {},
			}),
		).toBe("[Video]");
	});

	it("extracts document message with caption", () => {
		expect(
			extractWhatsAppText({
				documentMessage: { caption: "Report.pdf" },
			}),
		).toBe("[Document] Report.pdf");
	});

	it("extracts document message without caption", () => {
		expect(
			extractWhatsAppText({
				documentMessage: {},
			}),
		).toBe("[Document]");
	});

	it("extracts audio message as [Voice Message]", () => {
		expect(
			extractWhatsAppText({
				audioMessage: {},
			}),
		).toBe("[Voice Message]");
	});

	it("returns null for unknown message type", () => {
		expect(extractWhatsAppText({})).toBeNull();
	});

	it("returns null for unsupported message type (sticker)", () => {
		expect(
			extractWhatsAppText({
				stickerMessage: {},
			}),
		).toBeNull();
	});
});
