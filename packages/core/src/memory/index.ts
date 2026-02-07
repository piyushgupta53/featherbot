import { FileMemoryStore } from "./file-store.js";
import type { MemoryStore } from "./types.js";

export function createMemoryStore(workspacePath: string): MemoryStore {
	return new FileMemoryStore(workspacePath);
}

export { FileMemoryStore };
export type { MemoryStore };
