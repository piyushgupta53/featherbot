import { createInboundMessage } from "@featherbot/bus";
import type { OutboundMessage } from "@featherbot/bus";
import { type WASocket, makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { BaseChannel } from "./base.js";
import type { ChannelOptions } from "./types.js";
import { extractWhatsAppText } from "./whatsapp-message.js";

export interface WhatsAppChannelOptions extends ChannelOptions {
	authDir: string;
}

export class WhatsAppChannel extends BaseChannel {
	readonly name = "whatsapp";

	private sock: WASocket | undefined;
	private readonly authDir: string;
	private reconnecting = false;

	constructor(options: WhatsAppChannelOptions) {
		super(options);
		this.authDir = options.authDir;
	}

	async start(): Promise<void> {
		await this.connect();
	}

	private async connect(): Promise<void> {
		const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

		this.sock = makeWASocket({
			auth: state,
			browser: ["FeatherBot", "cli", "0.1.0"],
			printQRInTerminal: true,
			syncFullHistory: false,
			markOnlineOnConnect: false,
		});

		this.sock.ev.on("creds.update", saveCreds);

		this.sock.ev.on("connection.update", (update) => {
			const { connection, lastDisconnect } = update;

			if (connection === "open") {
				console.log("WhatsApp: connected");
				this.reconnecting = false;
			}

			if (connection === "close") {
				const error = lastDisconnect?.error;
				// biome-ignore lint/suspicious/noExplicitAny: Boom error shape
				const statusCode = (error as any)?.output?.statusCode;
				const isLoggedOut = statusCode === 401;

				if (isLoggedOut) {
					console.log("WhatsApp: logged out, not reconnecting");
					this.sock = undefined;
				} else if (!this.reconnecting) {
					this.reconnecting = true;
					console.log("WhatsApp: connection closed, reconnecting in 5s...");
					setTimeout(() => {
						this.connect().catch((err) => {
							console.error("WhatsApp reconnect error:", err);
							this.reconnecting = false;
						});
					}, 5000);
				}
			}
		});

		this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
			if (type !== "notify") return;

			for (const msg of messages) {
				try {
					if (msg.key.fromMe) continue;

					const remoteJid = msg.key.remoteJid;
					if (remoteJid === undefined || remoteJid === null) continue;
					if (remoteJid === "status@broadcast") continue;
					if (remoteJid.endsWith("@g.us")) continue;

					const text = extractWhatsAppText(msg.message);
					if (text === null) continue;

					const phone = remoteJid.split("@")[0] ?? remoteJid;
					const senderId = `whatsapp:${phone}`;

					const inbound = createInboundMessage({
						channel: "whatsapp",
						senderId,
						chatId: remoteJid,
						content: text,
						media: [],
						metadata: { whatsappMessageId: msg.key.id ?? "" },
					});

					await this.publishInbound(inbound);
				} catch (err) {
					console.error("WhatsApp message handler error:", err);
				}
			}
		});
	}

	async send(message: OutboundMessage): Promise<void> {
		if (this.sock === undefined) return;

		try {
			await this.sock.sendMessage(message.chatId, { text: message.content });
		} catch (err) {
			console.error("WhatsApp send error:", err);
		}
	}

	async stop(): Promise<void> {
		if (this.sock !== undefined) {
			this.sock.end(undefined);
			this.sock = undefined;
		}
	}
}
