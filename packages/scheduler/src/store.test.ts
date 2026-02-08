import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CronJobStore } from "./store.js";
import type { CronJob } from "./types.js";

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

describe("CronJobStore", () => {
	let tmpDir: string;
	let storePath: string;
	let store: CronJobStore;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cron-store-"));
		storePath = join(tmpDir, "cron.json");
		store = new CronJobStore(storePath);
	});

	afterEach(() => {
		// Cleanup handled by OS temp cleanup
	});

	describe("load", () => {
		it("returns empty store when file does not exist", () => {
			store.load();
			expect(store.listJobs()).toEqual([]);
		});

		it("returns empty store when file has invalid JSON", () => {
			writeFileSync(storePath, "not valid json", "utf-8");
			store.load();
			expect(store.listJobs()).toEqual([]);
		});

		it("returns empty store when file has invalid schema", () => {
			writeFileSync(storePath, JSON.stringify({ version: "bad", jobs: 123 }), "utf-8");
			store.load();
			expect(store.listJobs()).toEqual([]);
		});

		it("loads valid store from file", () => {
			const data = {
				version: 1,
				jobs: [
					{
						id: "j1",
						name: "test",
						enabled: true,
						schedule: { kind: "every", everySeconds: 60 },
						payload: { action: "agent_turn", message: "test" },
						state: { nextRunAt: null, lastRunAt: null, lastStatus: null, lastError: null },
						createdAt: "2026-02-08T10:00:00Z",
						updatedAt: "2026-02-08T10:00:00Z",
						deleteAfterRun: false,
					},
				],
			};
			writeFileSync(storePath, JSON.stringify(data), "utf-8");
			store.load();
			expect(store.listJobs()).toHaveLength(1);
			expect(store.listJobs()[0]?.name).toBe("test");
		});
	});

	describe("save", () => {
		it("creates parent directory if it does not exist", () => {
			const nested = join(tmpDir, "sub", "dir", "cron.json");
			const nestedStore = new CronJobStore(nested);
			nestedStore.load();
			nestedStore.addJob(makeJob());
			expect(existsSync(nested)).toBe(true);
		});

		it("writes JSON to file", () => {
			store.load();
			store.addJob(makeJob());
			const content = readFileSync(storePath, "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed.version).toBe(1);
			expect(parsed.jobs).toHaveLength(1);
		});
	});

	describe("addJob", () => {
		it("adds a job and persists", () => {
			store.load();
			store.addJob(makeJob());
			expect(store.listJobs()).toHaveLength(1);
			expect(existsSync(storePath)).toBe(true);
		});

		it("adds multiple jobs", () => {
			store.load();
			store.addJob(makeJob({ id: "j1" }));
			store.addJob(makeJob({ id: "j2", name: "Second" }));
			expect(store.listJobs()).toHaveLength(2);
		});
	});

	describe("removeJob", () => {
		it("removes existing job and returns true", () => {
			store.load();
			store.addJob(makeJob({ id: "j1" }));
			const removed = store.removeJob("j1");
			expect(removed).toBe(true);
			expect(store.listJobs()).toHaveLength(0);
		});

		it("returns false for non-existent job", () => {
			store.load();
			const removed = store.removeJob("non-existent");
			expect(removed).toBe(false);
		});
	});

	describe("getJob", () => {
		it("returns job by ID", () => {
			store.load();
			store.addJob(makeJob({ id: "j1", name: "Found" }));
			const job = store.getJob("j1");
			expect(job).toBeDefined();
			expect(job?.name).toBe("Found");
		});

		it("returns undefined for non-existent ID", () => {
			store.load();
			expect(store.getJob("missing")).toBeUndefined();
		});
	});

	describe("updateJob", () => {
		it("merges updates into existing job", () => {
			store.load();
			store.addJob(makeJob({ id: "j1", name: "Original" }));
			store.updateJob("j1", { name: "Updated" });
			expect(store.getJob("j1")?.name).toBe("Updated");
		});

		it("does nothing for non-existent job", () => {
			store.load();
			store.updateJob("missing", { name: "nope" });
			expect(store.listJobs()).toHaveLength(0);
		});

		it("persists updates to file", () => {
			store.load();
			store.addJob(makeJob({ id: "j1" }));
			store.updateJob("j1", { enabled: false });
			const content = readFileSync(storePath, "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed.jobs[0].enabled).toBe(false);
		});
	});

	describe("listJobs", () => {
		it("returns a copy of jobs array", () => {
			store.load();
			store.addJob(makeJob({ id: "j1" }));
			const list = store.listJobs();
			list.pop();
			expect(store.listJobs()).toHaveLength(1);
		});
	});
});
