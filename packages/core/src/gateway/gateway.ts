import type { GatewayOptions } from "./types.js";

export class Gateway {
	private readonly options: GatewayOptions;
	private running = false;

	constructor(options: GatewayOptions) {
		this.options = options;
	}

	get isRunning(): boolean {
		return this.running;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		this.options.adapter.start();
		await this.options.channelManager.startAll();

		if (this.options.cronService !== undefined) {
			this.options.cronService.start();
		}
		if (this.options.heartbeatService !== undefined) {
			this.options.heartbeatService.start();
		}
	}

	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;

		if (this.options.heartbeatService !== undefined) {
			this.options.heartbeatService.stop();
		}
		if (this.options.cronService !== undefined) {
			this.options.cronService.stop();
		}
		await this.options.channelManager.stopAll();
		this.options.adapter.stop();
		this.options.onStop?.();
		this.options.bus.close();
	}

	getActiveChannels(): string[] {
		return this.options.channelManager.getChannels().map((ch) => ch.name);
	}
}
