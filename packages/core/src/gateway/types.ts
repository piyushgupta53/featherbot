export interface GatewayAdapter {
	start(): void;
	stop(): void;
}

export interface GatewayChannelManager {
	startAll(): Promise<void>;
	stopAll(): Promise<void>;
	getChannels(): Array<{ name: string }>;
}

export interface GatewayBus {
	close(): void;
}

export interface GatewayCronService {
	start(): void;
	stop(): void;
}

export interface GatewayHeartbeatService {
	start(): void;
	stop(): void;
}

export interface GatewayOptions {
	bus: GatewayBus;
	adapter: GatewayAdapter;
	channelManager: GatewayChannelManager;
	cronService?: GatewayCronService;
	heartbeatService?: GatewayHeartbeatService;
	onStop?: () => void;
}
