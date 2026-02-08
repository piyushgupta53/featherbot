import { describe, expect, it } from "vitest";
import { CronJobSchema, CronScheduleSchema, CronStoreSchema } from "./types.js";

describe("CronScheduleSchema", () => {
	it("validates cron kind", () => {
		const result = CronScheduleSchema.safeParse({
			kind: "cron",
			cronExpr: "0 9 * * *",
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.kind === "cron") {
			expect(result.data.cronExpr).toBe("0 9 * * *");
		}
	});

	it("validates cron kind with timezone", () => {
		const result = CronScheduleSchema.safeParse({
			kind: "cron",
			cronExpr: "0 9 * * *",
			timezone: "America/New_York",
		});
		expect(result.success).toBe(true);
	});

	it("rejects cron kind without cronExpr", () => {
		const result = CronScheduleSchema.safeParse({ kind: "cron" });
		expect(result.success).toBe(false);
	});

	it("validates every kind", () => {
		const result = CronScheduleSchema.safeParse({
			kind: "every",
			everySeconds: 3600,
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.kind === "every") {
			expect(result.data.everySeconds).toBe(3600);
		}
	});

	it("rejects every kind with non-positive seconds", () => {
		const result = CronScheduleSchema.safeParse({
			kind: "every",
			everySeconds: 0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects every kind with non-integer seconds", () => {
		const result = CronScheduleSchema.safeParse({
			kind: "every",
			everySeconds: 1.5,
		});
		expect(result.success).toBe(false);
	});

	it("validates at kind", () => {
		const result = CronScheduleSchema.safeParse({
			kind: "at",
			at: "2026-02-09T15:00:00",
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.kind === "at") {
			expect(result.data.at).toBe("2026-02-09T15:00:00");
		}
	});

	it("rejects at kind without at field", () => {
		const result = CronScheduleSchema.safeParse({ kind: "at" });
		expect(result.success).toBe(false);
	});

	it("rejects unknown kind", () => {
		const result = CronScheduleSchema.safeParse({ kind: "unknown" });
		expect(result.success).toBe(false);
	});
});

describe("CronJobSchema", () => {
	it("parses a complete job with defaults", () => {
		const result = CronJobSchema.safeParse({
			id: "abc-123",
			name: "Morning weather",
			schedule: { kind: "cron", cronExpr: "0 9 * * *" },
			payload: { action: "agent_turn", message: "Check weather" },
			createdAt: "2026-02-08T10:00:00Z",
			updatedAt: "2026-02-08T10:00:00Z",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.enabled).toBe(true);
			expect(result.data.deleteAfterRun).toBe(false);
			expect(result.data.state.nextRunAt).toBeNull();
			expect(result.data.state.lastRunAt).toBeNull();
			expect(result.data.state.lastStatus).toBeNull();
			expect(result.data.state.lastError).toBeNull();
		}
	});

	it("parses a job with explicit values", () => {
		const result = CronJobSchema.safeParse({
			id: "abc-123",
			name: "One-time reminder",
			enabled: false,
			schedule: { kind: "at", at: "2026-03-01T09:00:00" },
			payload: { action: "agent_turn", message: "Remind me", channel: "telegram", chatId: "12345" },
			state: { nextRunAt: 1000, lastRunAt: null, lastStatus: null, lastError: null },
			createdAt: "2026-02-08T10:00:00Z",
			updatedAt: "2026-02-08T10:00:00Z",
			deleteAfterRun: true,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.enabled).toBe(false);
			expect(result.data.deleteAfterRun).toBe(true);
			expect(result.data.payload.channel).toBe("telegram");
			expect(result.data.state.nextRunAt).toBe(1000);
		}
	});
});

describe("CronStoreSchema", () => {
	it("parses empty store with defaults", () => {
		const result = CronStoreSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.version).toBe(1);
			expect(result.data.jobs).toEqual([]);
		}
	});

	it("parses store with jobs", () => {
		const result = CronStoreSchema.safeParse({
			version: 1,
			jobs: [
				{
					id: "j1",
					name: "test",
					schedule: { kind: "every", everySeconds: 60 },
					payload: { action: "agent_turn", message: "test" },
					createdAt: "2026-02-08T10:00:00Z",
					updatedAt: "2026-02-08T10:00:00Z",
				},
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.jobs).toHaveLength(1);
		}
	});
});
