import type { MessageBus } from "@featherbot/bus";

export interface AudioTranscriber {
	transcribe(buffer: Buffer, filename: string, mimeType: string): Promise<{ text: string }>;
}

export interface ChannelOptions {
	bus: MessageBus;
	allowFrom?: string[];
	transcriber?: AudioTranscriber;
}

export type ChannelStatus = "stopped" | "starting" | "running" | "error";
