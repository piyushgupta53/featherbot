import type { TranscriptionConfig } from "../config/schema.js";

export interface TranscriptionResult {
	text: string;
	durationMs: number;
}

const ENDPOINTS: Record<string, string> = {
	groq: "https://api.groq.com/openai/v1/audio/transcriptions",
	openai: "https://api.openai.com/v1/audio/transcriptions",
};

const DEFAULT_MODELS: Record<string, string> = {
	groq: "whisper-large-v3-turbo",
	openai: "whisper-1",
};

const TIMEOUT_MS = 30_000;

export class Transcriber {
	private readonly apiKey: string;
	private readonly model: string;
	private readonly endpoint: string;

	constructor(config: TranscriptionConfig) {
		this.apiKey = config.apiKey;
		const endpoint = ENDPOINTS[config.provider];
		if (endpoint === undefined) {
			throw new Error(`Unknown transcription provider: ${config.provider}`);
		}
		this.endpoint = endpoint;
		this.model = config.model || DEFAULT_MODELS[config.provider] || "whisper-large-v3-turbo";
	}

	async transcribe(
		audioBuffer: Buffer,
		filename: string,
		mimeType: string,
	): Promise<TranscriptionResult> {
		const startMs = Date.now();

		const formData = new FormData();
		const arrayBuf = audioBuffer.buffer.slice(
			audioBuffer.byteOffset,
			audioBuffer.byteOffset + audioBuffer.byteLength,
		) as ArrayBuffer;
		formData.append("file", new Blob([arrayBuf], { type: mimeType }), filename);
		formData.append("model", this.model);
		formData.append("response_format", "json");

		const response = await fetch(this.endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: formData,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});

		if (!response.ok) {
			throw new Error(`Transcription API returned ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as { text?: string };
		const text = (data.text ?? "").trim();
		const durationMs = Date.now() - startMs;

		return { text, durationMs };
	}
}
