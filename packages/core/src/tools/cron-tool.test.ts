import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronService } from "@featherbot/scheduler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronTool } from "./cron-tool.js";

describe("CronTool", () => {
	let tmpDir: string;
	let service: CronService;
	let tool: CronTool;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));
		tmpDir = mkdtempSync(join(tmpdir(), "cron-tool-"));
		service = new CronService({
			storePath: join(tmpDir, "cron.json"),
			onJobFire: async () => {},
		});
		service.start();
		tool = new CronTool(service);
	});

	afterEach(() => {
		service.stop();
		vi.useRealTimers();
	});

	describe("add action", () => {
		it("creates a job with cronExpr", async () => {
			const result = await tool.execute({
				action: "add",
				name: "Morning weather",
				message: "Check weather",
				cronExpr: "0 9 * * *",
			});
			expect(result).toContain("Job created");
			expect(result).toContain("Morning weather");
			expect(service.listJobs()).toHaveLength(1);
			const job = service.listJobs()[0];
			expect(job?.schedule.kind).toBe("cron");
		});

		it("creates a job with everySeconds", async () => {
			const result = await tool.execute({
				action: "add",
				name: "Frequent check",
				message: "Check something",
				everySeconds: 300,
			});
			expect(result).toContain("Job created");
			expect(service.listJobs()).toHaveLength(1);
			const job = service.listJobs()[0];
			expect(job?.schedule.kind).toBe("every");
		});

		it("creates a one-time job with at", async () => {
			const result = await tool.execute({
				action: "add",
				name: "Reminder",
				message: "Do the thing",
				at: "2026-02-09T15:00:00Z",
			});
			expect(result).toContain("Job created");
			const job = service.listJobs()[0];
			expect(job?.schedule.kind).toBe("at");
			expect(job?.deleteAfterRun).toBe(true);
		});

		it("rejects when no schedule type provided", async () => {
			const result = await tool.execute({
				action: "add",
				name: "Bad job",
				message: "No schedule",
			});
			expect(result).toContain("Error");
			expect(result).toContain("exactly one");
		});

		it("rejects when multiple schedule types provided", async () => {
			const result = await tool.execute({
				action: "add",
				name: "Bad job",
				message: "Two schedules",
				cronExpr: "0 9 * * *",
				everySeconds: 300,
			});
			expect(result).toContain("Error");
			expect(result).toContain("exactly one");
		});

		it("rejects when name is missing", async () => {
			const result = await tool.execute({
				action: "add",
				message: "No name",
				cronExpr: "0 9 * * *",
			});
			expect(result).toContain("Error");
		});

		it("rejects when message is missing", async () => {
			const result = await tool.execute({
				action: "add",
				name: "No message",
				cronExpr: "0 9 * * *",
			});
			expect(result).toContain("Error");
		});
	});

	describe("list action", () => {
		it("returns 'No scheduled jobs' when empty", async () => {
			const result = await tool.execute({ action: "list" });
			expect(result).toBe("No scheduled jobs.");
		});

		it("returns formatted list with jobs", async () => {
			await tool.execute({
				action: "add",
				name: "Weather",
				message: "Check weather",
				cronExpr: "0 9 * * *",
			});
			const result = await tool.execute({ action: "list" });
			expect(result).toContain("Weather");
			expect(result).toContain("Schedule:");
			expect(result).toContain("enabled");
		});
	});

	describe("remove action", () => {
		it("removes existing job", async () => {
			await tool.execute({
				action: "add",
				name: "To remove",
				message: "test",
				everySeconds: 60,
			});
			const jobId = service.listJobs()[0]?.id;
			const result = await tool.execute({ action: "remove", jobId });
			expect(result).toContain("removed");
			expect(service.listJobs()).toHaveLength(0);
		});

		it("returns not found for non-existent job", async () => {
			const result = await tool.execute({
				action: "remove",
				jobId: "non-existent",
			});
			expect(result).toContain("not found");
		});

		it("returns error when jobId missing", async () => {
			const result = await tool.execute({ action: "remove" });
			expect(result).toContain("Error");
		});
	});

	describe("enable/disable actions", () => {
		it("disables a job", async () => {
			await tool.execute({
				action: "add",
				name: "Toggle me",
				message: "test",
				everySeconds: 60,
			});
			const jobId = service.listJobs()[0]?.id;
			const result = await tool.execute({ action: "disable", jobId });
			expect(result).toContain("disabled");
			expect(service.getJob(jobId as string)?.enabled).toBe(false);
		});

		it("enables a job", async () => {
			await tool.execute({
				action: "add",
				name: "Toggle me",
				message: "test",
				everySeconds: 60,
			});
			const jobId = service.listJobs()[0]?.id;
			await tool.execute({ action: "disable", jobId });
			const result = await tool.execute({ action: "enable", jobId });
			expect(result).toContain("enabled");
			expect(service.getJob(jobId as string)?.enabled).toBe(true);
		});

		it("returns not found for non-existent job", async () => {
			const result = await tool.execute({
				action: "enable",
				jobId: "missing",
			});
			expect(result).toContain("not found");
		});
	});

	describe("context injection", () => {
		it("injects channel and chatId into job payload", async () => {
			tool.setContext("telegram", "12345");
			await tool.execute({
				action: "add",
				name: "Contextual",
				message: "test",
				everySeconds: 60,
			});
			const job = service.listJobs()[0];
			expect(job?.payload.channel).toBe("telegram");
			expect(job?.payload.chatId).toBe("12345");
		});

		it("uses undefined context when not set", async () => {
			await tool.execute({
				action: "add",
				name: "No context",
				message: "test",
				everySeconds: 60,
			});
			const job = service.listJobs()[0];
			expect(job?.payload.channel).toBeUndefined();
			expect(job?.payload.chatId).toBeUndefined();
		});
	});
});
