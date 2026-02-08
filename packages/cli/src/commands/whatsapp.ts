import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "@featherbot/core";
import { makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import type { Command } from "commander";

export function registerWhatsApp(cmd: Command): void {
	const whatsappCmd = cmd.command("whatsapp").description("WhatsApp channel management");

	whatsappCmd
		.command("login")
		.description("Pair your WhatsApp account via QR code")
		.action(async () => {
			const config = loadConfig();
			const rawAuthDir = config.channels.whatsapp.authDir;
			const authDir = rawAuthDir.startsWith("~")
				? join(homedir(), rawAuthDir.slice(1))
				: resolve(rawAuthDir);

			console.log("WhatsApp Login");
			console.log(`Auth directory: ${authDir}`);
			console.log("Scan the QR code with your phone to link this device.\n");

			const { state, saveCreds } = await useMultiFileAuthState(authDir);

			const sock = makeWASocket({
				auth: state,
				browser: ["FeatherBot", "cli", "0.1.0"],
				printQRInTerminal: true,
				syncFullHistory: false,
				markOnlineOnConnect: false,
			});

			sock.ev.on("creds.update", saveCreds);

			await new Promise<void>((onResolve, reject) => {
				sock.ev.on("connection.update", (update) => {
					const { connection, lastDisconnect } = update;

					if (connection === "open") {
						console.log("\nWhatsApp: successfully connected!");
						console.log("You can now start the gateway with: featherbot gateway");
						sock.end(undefined);
						onResolve();
					}

					if (connection === "close") {
						const error = lastDisconnect?.error;
						// biome-ignore lint/suspicious/noExplicitAny: Boom error shape
						const statusCode = (error as any)?.output?.statusCode;

						if (statusCode === 401) {
							reject(new Error("WhatsApp: logged out. Please try again."));
						} else {
							reject(new Error(`WhatsApp: connection closed (status ${statusCode ?? "unknown"})`));
						}
					}
				});
			});
		});
}
