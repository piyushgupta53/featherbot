import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExecTool } from "./exec-tool.js";

const DEFAULT_OPTIONS = {
	timeoutSeconds: 60,
	workspaceDir: "/tmp/test-workspace",
	restrictToWorkspace: false,
};

describe("ExecTool", () => {
	it("has correct name and description", () => {
		const tool = new ExecTool(DEFAULT_OPTIONS);
		expect(tool.name).toBe("exec");
		expect(tool.description).toContain("shell command");
	});

	describe("execute", () => {
		it("runs a simple command and returns output with success status", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "echo hello world" });
			expect(result).toBe("[Command succeeded]\nhello world");
		});

		it("captures stderr in output", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "echo error >&2" });
			expect(result).toContain("[Command succeeded]");
			expect(result).toContain("error");
		});

		it("returns failed status with exit code for non-zero exit", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "exit 42" });
			expect(result).toContain("[Command failed with exit code 42]");
		});

		it("combines stdout and stderr", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({
				command: "echo out && echo err >&2",
			});
			expect(result).toContain("[Command succeeded]");
			expect(result).toContain("out");
			expect(result).toContain("err");
		});

		it("returns success status for empty output", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "true" });
			expect(result).toBe("[Command succeeded]");
		});
	});

	describe("deny patterns", () => {
		it("rejects rm -rf /", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "rm -rf /" });
			expect(result).toContain("rejected by safety filter");
		});

		it("rejects rm -rf ~", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "rm -rf ~" });
			expect(result).toContain("rejected by safety filter");
		});

		it("rejects mkfs", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "mkfs.ext4 /dev/sda1" });
			expect(result).toContain("rejected by safety filter");
		});

		it("rejects dd if=", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "dd if=/dev/zero of=/dev/sda" });
			expect(result).toContain("rejected by safety filter");
		});

		it("rejects fork bomb", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: ":() { :|:& };:" });
			expect(result).toContain("rejected by safety filter");
		});

		it("rejects shutdown", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "shutdown -h now" });
			expect(result).toContain("rejected by safety filter");
		});

		it("rejects reboot", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "reboot" });
			expect(result).toContain("rejected by safety filter");
		});

		it("rejects del /f", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({ command: "del /f /q C:\\*" });
			expect(result).toContain("rejected by safety filter");
		});
	});

	describe("timeout", () => {
		it("kills command after timeout", async () => {
			const tool = new ExecTool({ ...DEFAULT_OPTIONS, timeoutSeconds: 1 });
			const result = await tool.execute({ command: "sleep 30" });
			expect(result).toContain("timed out");
		}, 10_000);
	});

	describe("output truncation", () => {
		it("truncates output exceeding 10000 characters", async () => {
			const tool = new ExecTool(DEFAULT_OPTIONS);
			const result = await tool.execute({
				command: `python3 -c "print('x' * 15000)"`,
			});
			expect(result).toContain("[Command succeeded]");
			expect(result).toContain("... [output truncated]");
		});
	});

	describe("workspace restriction", () => {
		let tempDir: string;

		beforeEach(async () => {
			tempDir = await realpath(await mkdtemp(join(tmpdir(), "exec-tool-test-")));
		});

		afterEach(async () => {
			await rm(tempDir, { recursive: true });
		});

		it("sets cwd to workspace when restricted", async () => {
			const tool = new ExecTool({
				timeoutSeconds: 60,
				workspaceDir: tempDir,
				restrictToWorkspace: true,
			});
			const result = await tool.execute({ command: "pwd" });
			expect(result).toBe(`[Command succeeded]\n${tempDir}`);
		});

		it("uses workingDir when provided", async () => {
			const tool = new ExecTool({
				timeoutSeconds: 60,
				workspaceDir: tempDir,
				restrictToWorkspace: false,
			});
			const result = await tool.execute({ command: "pwd", workingDir: tempDir });
			expect(result).toBe(`[Command succeeded]\n${tempDir}`);
		});

		it("uses defaultCwd when no workingDir is provided", async () => {
			const tool = new ExecTool({
				timeoutSeconds: 60,
				workspaceDir: tempDir,
				restrictToWorkspace: false,
				defaultCwd: tempDir,
			});
			const result = await tool.execute({ command: "pwd" });
			expect(result).toBe(`[Command succeeded]\n${tempDir}`);
		});

		it("prefers workingDir over defaultCwd", async () => {
			const tool = new ExecTool({
				timeoutSeconds: 60,
				workspaceDir: tempDir,
				restrictToWorkspace: false,
				defaultCwd: "/tmp",
			});
			const result = await tool.execute({ command: "pwd", workingDir: tempDir });
			expect(result).toBe(`[Command succeeded]\n${tempDir}`);
		});

		it("prefers restrictToWorkspace over defaultCwd", async () => {
			const tool = new ExecTool({
				timeoutSeconds: 60,
				workspaceDir: tempDir,
				restrictToWorkspace: true,
				defaultCwd: "/tmp",
			});
			const result = await tool.execute({ command: "pwd" });
			expect(result).toBe(`[Command succeeded]\n${tempDir}`);
		});
	});
});
