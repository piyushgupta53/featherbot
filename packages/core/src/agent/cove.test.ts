import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../provider/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { ChainOfVerification } from "./cove.js";

const mockProvider: LLMProvider = {
	generate: vi.fn(),
	stream: vi.fn(),
	generateStructured: vi.fn(),
};

const mockToolRegistry = {} as ToolRegistry;

describe("ChainOfVerification", () => {
	describe("hasUnverifiedClaims", () => {
		it("detects file write claims without write_file tool", () => {
			const response = "I created the file data/script.py for you.";
			const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

			const result = ChainOfVerification.hasUnverifiedClaims(response, toolCalls);

			expect(result).toBe(true);
		});

		it("detects update claims without edit_file tool", () => {
			const response = "I updated the configuration file.";
			const toolCalls = [{ name: "read_file", arguments: { path: "config.json" } }];

			const result = ChainOfVerification.hasUnverifiedClaims(response, toolCalls);

			expect(result).toBe(true);
		});

		it("passes when write_file was actually called", () => {
			const response = "I created the file data/script.py for you.";
			const toolCalls = [
				{ name: "write_file", arguments: { path: "data/script.py", content: "test" } },
			];

			const result = ChainOfVerification.hasUnverifiedClaims(response, toolCalls);

			expect(result).toBe(false);
		});

		it("passes for responses without action claims", () => {
			const response = "The weather today is sunny.";
			const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

			const result = ChainOfVerification.hasUnverifiedClaims(response, toolCalls);

			expect(result).toBe(false);
		});
	});

	describe("verify", () => {
		it("verifies successful file write claim", async () => {
			const cove = new ChainOfVerification({
				provider: mockProvider,
				toolRegistry: mockToolRegistry,
			});

			const response = "Done. I created data/test.py with the script.";
			const toolCalls = [
				{ name: "write_file", arguments: { path: "data/test.py", content: "print('hello')" } },
			];
			const toolResults = [
				{ toolName: "write_file", content: "Successfully wrote 20 characters to 'data/test.py'" },
			];

			const result = await cove.verify(response, toolCalls, toolResults);

			expect(result.hasHallucination).toBe(false);
			expect(result.verifications.every((v) => v.verified)).toBe(true);
		});

		it("detects hallucinated file write claim", async () => {
			vi.mocked(mockProvider.generate).mockResolvedValue({
				text: "I apologize, but I didn't actually create that file. Let me do it now.",
				toolCalls: [],
				toolResults: [],
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				finishReason: "stop",
			});

			const cove = new ChainOfVerification({
				provider: mockProvider,
				toolRegistry: mockToolRegistry,
			});

			const response = "Done. I created data/test.py with the script.";
			const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
			const toolResults: Array<{ toolName: string; content: string }> = [];

			const result = await cove.verify(response, toolCalls, toolResults);

			expect(result.hasHallucination).toBe(true);
			expect(result.verifications.some((v) => !v.verified)).toBe(true);
		});

		it("detects failed tool execution", async () => {
			const cove = new ChainOfVerification({
				provider: mockProvider,
				toolRegistry: mockToolRegistry,
			});

			const response = "I installed the package successfully.";
			const toolCalls = [{ name: "exec", arguments: { command: "pip install xyz" } }];
			const toolResults = [
				{
					toolName: "exec",
					content: "Command failed with exit code 1\nERROR: Could not find package",
				},
			];

			const result = await cove.verify(response, toolCalls, toolResults);

			expect(result.hasHallucination).toBe(true);
			expect(result.verifications.some((v) => !v.verified && v.claim.includes("exec"))).toBe(true);
		});

		it("passes execution claim with successful exec tool", async () => {
			const cove = new ChainOfVerification({
				provider: mockProvider,
				toolRegistry: mockToolRegistry,
			});

			const response = "I ran the command and got the results.";
			const toolCalls = [{ name: "exec", arguments: { command: "ls -la" } }];
			const toolResults = [{ toolName: "exec", content: "file1.txt\nfile2.txt" }];

			const result = await cove.verify(response, toolCalls, toolResults);

			expect(result.hasHallucination).toBe(false);
		});
	});

	describe("error detection", () => {
		it("detects various error patterns in tool results", async () => {
			const cove = new ChainOfVerification({
				provider: mockProvider,
				toolRegistry: mockToolRegistry,
			});

			const errorCases = [
				{ content: "Command failed with exit code 1", shouldDetect: true },
				{ content: "Error: File not found", shouldDetect: true },
				{ content: "Traceback (most recent call last):", shouldDetect: true },
				{ content: "No such file or directory", shouldDetect: true },
				{ content: "Permission denied", shouldDetect: true },
				{ content: "Successfully completed", shouldDetect: false },
				{ content: "Output: hello world", shouldDetect: false },
			];

			for (const { content, shouldDetect } of errorCases) {
				const response = "I did something.";
				const toolCalls = [{ name: "exec", arguments: { command: "test" } }];
				const toolResults = [{ toolName: "exec", content }];

				const result = await cove.verify(response, toolCalls, toolResults);

				if (shouldDetect) {
					expect(result.verifications.some((v) => !v.verified)).toBe(true);
				} else {
					expect(result.verifications.every((v) => v.verified)).toBe(true);
				}
			}
		});
	});

	describe("action pattern detection", () => {
		it("detects 'created' file claims", async () => {
			const cove = new ChainOfVerification({
				provider: mockProvider,
				toolRegistry: mockToolRegistry,
			});

			const patterns = [
				"I created data/file.py",
				"I wrote the file data/file.py",
				"I updated data/file.py",
				"I modified the file data/file.py",
			];

			for (const pattern of patterns) {
				const result = await cove.verify(pattern, [], []);
				expect(result.verifications.length).toBeGreaterThan(0);
				expect(result.verifications[0]?.claim).toContain("data/file.py");
			}
		});

		it("detects execution claims", async () => {
			const cove = new ChainOfVerification({
				provider: mockProvider,
				toolRegistry: mockToolRegistry,
			});

			const response = "I ran the command to check the status.";
			const result = await cove.verify(response, [], []);

			expect(result.verifications.some((v) => v.claim.toLowerCase().includes("ran"))).toBe(true);
		});

		it("detects installation claims", async () => {
			const cove = new ChainOfVerification({
				provider: mockProvider,
				toolRegistry: mockToolRegistry,
			});

			const response = "I installed the required packages.";
			const result = await cove.verify(response, [], []);

			expect(result.verifications.some((v) => v.claim.toLowerCase().includes("install"))).toBe(
				true,
			);
		});
	});
});
