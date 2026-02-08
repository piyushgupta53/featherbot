import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
import type { CronJob, CronSchedule } from "./types.js";

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
	return {
		id: "job-1",
		name: "Test job",
		enabled: true,
		schedule: { kind: "every", everySeconds: 60 },
		payload: { action: "agent_turn", message: "do something" },
		state: { nextRunAt: null, lastRunAt: null, lastStatus: null, lastError: null },
		createdAt: "2026-02-08T10:00:00Z",
		updatedAt: "2026-02-08T10:00:00Z",
		deleteAfterRun: false,
		...overrides,
	};
}

describe("CronService", () => {
	let tmpDir: string;
	let storePath: string;

	beforeEach(() => {
		vi.useFakeTimers();
		tmpDir = mkdtempSync(join(tmpdir(), "cron-service-"));
		storePath = join(tmpDir, "cron.json");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("computeNextRun", () => {
		it("computes next run for every kind", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));
			const schedule: CronSchedule = { kind: "every", everySeconds: 300 };
			const next = service.computeNextRun(schedule);
			expect(next).toBe(Date.now() + 300_000);
		});

		it("computes next run for cron kind", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));
			const schedule: CronSchedule = {
				kind: "cron",
				cronExpr: "0 11 * * *",
				timezone: "UTC",
			};
			const next = service.computeNextRun(schedule);
			expect(next).not.toBeNull();
			if (next !== null) {
				const nextDate = new Date(next);
				expect(nextDate.getUTCHours()).toBe(11);
				expect(nextDate.getUTCMinutes()).toBe(0);
			}
		});

		it("returns null for invalid cron expression", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			const schedule: CronSchedule = { kind: "cron", cronExpr: "invalid" };
			const next = service.computeNextRun(schedule);
			expect(next).toBeNull();
		});

		it("computes next run for at kind with future date", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));
			const schedule: CronSchedule = { kind: "at", at: "2026-02-09T15:00:00Z" };
			const next = service.computeNextRun(schedule);
			expect(next).toBe(new Date("2026-02-09T15:00:00Z").getTime());
		});

		it("returns null for at kind with past date", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));
			const schedule: CronSchedule = { kind: "at", at: "2026-02-07T10:00:00Z" };
			const next = service.computeNextRun(schedule);
			expect(next).toBeNull();
		});

		it("returns null for at kind with invalid date", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			const schedule: CronSchedule = { kind: "at", at: "not-a-date" };
			const next = service.computeNextRun(schedule);
			expect(next).toBeNull();
		});
	});

	describe("start/stop", () => {
		it("starts and stops without error", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			service.start();
			service.stop();
		});
	});

	describe("job management", () => {
		it("adds and lists jobs", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			service.start();
			service.addJob(makeJob({ id: "j1" }));
			service.addJob(makeJob({ id: "j2", name: "Second" }));
			expect(service.listJobs()).toHaveLength(2);
			service.stop();
		});

		it("removes a job", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			service.start();
			service.addJob(makeJob({ id: "j1" }));
			const removed = service.removeJob("j1");
			expect(removed).toBe(true);
			expect(service.listJobs()).toHaveLength(0);
			service.stop();
		});

		it("gets a job by ID", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			service.start();
			service.addJob(makeJob({ id: "j1", name: "Found" }));
			expect(service.getJob("j1")?.name).toBe("Found");
			service.stop();
		});

		it("enables and disables a job", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			service.start();
			service.addJob(makeJob({ id: "j1" }));
			service.enableJob("j1", false);
			expect(service.getJob("j1")?.enabled).toBe(false);
			service.enableJob("j1", true);
			expect(service.getJob("j1")?.enabled).toBe(true);
			service.stop();
		});

		it("returns false when enabling non-existent job", () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			service.start();
			expect(service.enableJob("missing", true)).toBe(false);
			service.stop();
		});
	});

	describe("timer firing", () => {
		it("fires callback for due jobs", async () => {
			const fired: string[] = [];
			const service = new CronService({
				storePath,
				onJobFire: async (job) => {
					fired.push(job.id);
				},
			});
			vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));
			service.start();
			service.addJob(
				makeJob({
					id: "j1",
					schedule: { kind: "every", everySeconds: 10 },
				}),
			);

			await vi.advanceTimersByTimeAsync(11_000);
			expect(fired).toContain("j1");
			service.stop();
		});

		it("removes deleteAfterRun jobs after firing", async () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {},
			});
			vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));
			service.start();
			service.addJob(
				makeJob({
					id: "j1",
					schedule: { kind: "at", at: "2026-02-08T10:00:05Z" },
					deleteAfterRun: true,
				}),
			);

			expect(service.listJobs()).toHaveLength(1);
			await vi.advanceTimersByTimeAsync(6_000);
			expect(service.listJobs()).toHaveLength(0);
			service.stop();
		});

		it("sets lastStatus to error when callback throws", async () => {
			const service = new CronService({
				storePath,
				onJobFire: async () => {
					throw new Error("boom");
				},
			});
			vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));
			service.start();
			service.addJob(
				makeJob({
					id: "j1",
					schedule: { kind: "every", everySeconds: 5 },
				}),
			);

			await vi.advanceTimersByTimeAsync(6_000);
			const job = service.getJob("j1");
			expect(job?.state.lastStatus).toBe("error");
			expect(job?.state.lastError).toBe("boom");
			service.stop();
		});

		it("does not fire disabled jobs", async () => {
			const fired: string[] = [];
			const service = new CronService({
				storePath,
				onJobFire: async (job) => {
					fired.push(job.id);
				},
			});
			vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));
			service.start();
			service.addJob(
				makeJob({
					id: "j1",
					enabled: false,
					schedule: { kind: "every", everySeconds: 5 },
				}),
			);

			await vi.advanceTimersByTimeAsync(10_000);
			expect(fired).toHaveLength(0);
			service.stop();
		});
	});
});
