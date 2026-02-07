export interface MemoryStore {
	getMemoryContext(): Promise<string>;
	getRecentMemories(days?: number): Promise<string>;
	getMemoryFilePath(): string;
	getDailyNotePath(date?: Date): string;
}
