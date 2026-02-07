import type { z } from "zod";

/**
 * Core tool interface. All tools implement this contract.
 * Parameters use z.ZodObject for direct compatibility with Vercel AI SDK tool() helper.
 */
export interface Tool {
	readonly name: string;
	readonly description: string;
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject requires type params that vary per tool
	readonly parameters: z.ZodObject<any>;
	execute(params: Record<string, unknown>): Promise<string>;
}

export interface ToolExecutionResult {
	success: boolean;
	output: string;
}
