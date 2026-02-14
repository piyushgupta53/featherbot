import { randomUUID } from "node:crypto";
import type { CronService } from "@featherbot/scheduler";
import { z } from "zod";
import type { Tool } from "./types.js";

export class CronTool implements Tool {
	readonly name = "cron";
	readonly description =
		"Manage scheduled tasks. When a job fires, the 'message' is processed through the full agent loop with all tools available (web search, web fetch, etc.) and the result is automatically sent to the user — no manual intervention needed. Use action 'add' with name, message, and a schedule (cronExpr, everySeconds, or at) to create a job. Use 'list' to view jobs, 'remove' with jobId to delete. Listing does NOT create — you must use 'add' to create.";
	readonly parameters = z.object({
		action: z
			.enum(["add", "list", "remove", "enable", "disable"])
			.describe("The action to perform"),
		name: z.string().optional().describe("Human-readable name for the job (required for add)"),
		message: z.string().optional().describe("Task instruction or reminder text (required for add)"),
		jobId: z.string().optional().describe("Job ID (required for remove, enable, disable)"),
		everySeconds: z
			.number()
			.int()
			.positive()
			.optional()
			.describe("Interval in seconds for recurring jobs"),
		cronExpr: z.string().optional().describe("Standard 5-field cron expression (e.g. '0 9 * * *')"),
		timezone: z
			.string()
			.optional()
			.describe(
				"IANA timezone (e.g. 'Asia/Kolkata'). Auto-applied from user profile if not specified.",
			),
		at: z
			.string()
			.optional()
			.describe(
				"ISO 8601 date-time for a one-time job. Bare timestamps (no Z/offset) are interpreted in the user's timezone.",
			),
		relativeMinutes: z
			.number()
			.positive()
			.optional()
			.describe(
				"Minutes from now for a one-time reminder (e.g. 5). The system computes the exact time — do NOT calculate timestamps yourself.",
			),
	});

	private readonly service: CronService;
	private channel: string | undefined;
	private chatId: string | undefined;
	private timezone: string | undefined;

	constructor(service: CronService) {
		this.service = service;
	}

	setContext(channel: string, chatId: string, timezone?: string): void {
		this.channel = channel;
		this.chatId = chatId;
		this.timezone = timezone;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const p = params as z.infer<typeof this.parameters>;
		try {
			switch (p.action) {
				case "add":
					return this.addJob(p);
				case "list":
					return this.listJobs();
				case "remove":
					return this.removeJob(p);
				case "enable":
					return this.toggleJob(p, true);
				case "disable":
					return this.toggleJob(p, false);
				default:
					return "Error: Unknown action";
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `Error: ${message}`;
		}
	}

	private addJob(p: z.infer<typeof this.parameters>): string {
		if (p.name === undefined || p.message === undefined) {
			return "Error: 'name' and 'message' are required for add action";
		}

		const scheduleCount = [p.everySeconds, p.cronExpr, p.at, p.relativeMinutes].filter(
			(v) => v !== undefined,
		).length;
		if (scheduleCount === 0) {
			return "Error: Provide exactly one of 'everySeconds', 'cronExpr', 'at', or 'relativeMinutes'";
		}
		if (scheduleCount > 1) {
			return "Error: Provide exactly one of 'everySeconds', 'cronExpr', 'at', or 'relativeMinutes'";
		}

		let schedule:
			| { kind: "cron"; cronExpr: string; timezone?: string }
			| { kind: "every"; everySeconds: number }
			| { kind: "at"; at: string };
		if (p.cronExpr !== undefined) {
			const tz = p.timezone ?? this.timezone;
			if (!tz) {
				console.log("[metrics] cron_timezone_fallback_no_user_timezone");
			}
			schedule = { kind: "cron", cronExpr: p.cronExpr, timezone: tz };
		} else if (p.everySeconds !== undefined) {
			schedule = { kind: "every", everySeconds: p.everySeconds };
		} else if (p.relativeMinutes !== undefined) {
			const target = new Date(Date.now() + p.relativeMinutes * 60_000);
			schedule = { kind: "at", at: target.toISOString() };
		} else {
			let atValue = p.at as string;
			if (this.timezone && !atValue.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(atValue)) {
				atValue = this.localToUtc(atValue, this.timezone);
			}
			schedule = { kind: "at", at: atValue };
		}

		const now = new Date().toISOString();
		const id = randomUUID();
		const deleteAfterRun = schedule.kind === "at";

		this.service.addJob({
			id,
			name: p.name,
			enabled: true,
			schedule,
			payload: {
				action: "agent_turn",
				message: p.message,
				channel: this.channel,
				chatId: this.chatId,
			},
			state: {
				nextRunAt: null,
				lastRunAt: null,
				lastStatus: null,
				lastError: null,
			},
			createdAt: now,
			updatedAt: now,
			deleteAfterRun,
		});

		const job = this.service.getJob(id);
		const nextRun = job?.state.nextRunAt ? this.formatTime(new Date(job.state.nextRunAt)) : "N/A";

		return `Job created: "${p.name}" (ID: ${id})\nSchedule: ${this.formatSchedule(schedule)}\nNext run: ${nextRun}`;
	}

	private listJobs(): string {
		const jobs = this.service.listJobs();
		if (jobs.length === 0) {
			return "No scheduled jobs.";
		}

		const lines: string[] = [];
		for (const job of jobs) {
			const nextRun = job.state.nextRunAt ? this.formatTime(new Date(job.state.nextRunAt)) : "N/A";
			const lastRun = job.state.lastRunAt
				? this.formatTime(new Date(job.state.lastRunAt))
				: "never";
			const status = job.enabled ? "enabled" : "disabled";
			lines.push(
				`- ${job.name} (ID: ${job.id})\n  Schedule: ${this.formatSchedule(job.schedule)} | Status: ${status}\n  Next run: ${nextRun} | Last run: ${lastRun}`,
			);
		}
		return lines.join("\n");
	}

	private removeJob(p: z.infer<typeof this.parameters>): string {
		if (p.jobId === undefined) {
			return "Error: 'jobId' is required for remove action";
		}
		const removed = this.service.removeJob(p.jobId);
		return removed ? `Job ${p.jobId} removed.` : `Job ${p.jobId} not found.`;
	}

	private toggleJob(p: z.infer<typeof this.parameters>, enabled: boolean): string {
		if (p.jobId === undefined) {
			return `Error: 'jobId' is required for ${enabled ? "enable" : "disable"} action`;
		}
		const success = this.service.enableJob(p.jobId, enabled);
		if (!success) {
			return `Job ${p.jobId} not found.`;
		}
		return `Job ${p.jobId} ${enabled ? "enabled" : "disabled"}.`;
	}

	private formatSchedule(schedule: {
		kind: string;
		cronExpr?: string;
		timezone?: string;
		everySeconds?: number;
		at?: string;
	}): string {
		switch (schedule.kind) {
			case "cron":
				return schedule.timezone
					? `cron "${schedule.cronExpr}" (${schedule.timezone})`
					: `cron "${schedule.cronExpr}"`;
			case "every":
				return `every ${schedule.everySeconds}s`;
			case "at":
				return `once at ${this.formatTime(new Date(schedule.at as string))}`;
			default:
				return "unknown";
		}
	}

	private formatTime(date: Date): string {
		if (this.timezone) {
			return date.toLocaleString("en-US", {
				timeZone: this.timezone,
				weekday: "short",
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				timeZoneName: "short",
			});
		}
		return date.toISOString();
	}

	private localToUtc(bare: string, timezone: string): string {
		// bare is a datetime string like "2026-02-08T21:00:00" with no zone info.
		// We want to interpret it as the user's local timezone.
		// Parse the numeric parts manually to avoid JS engine's locale-dependent parsing.
		const m = bare.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
		if (!m) {
			return bare;
		}
		const yr = Number(m[1]);
		const mo = Number(m[2]);
		const dy = Number(m[3]);
		const hr = Number(m[4]);
		const mn = Number(m[5]);
		const sc = Number(m[6]);
		// Treat the bare values as UTC to get a reference epoch
		const asUtcMs = Date.UTC(yr, mo - 1, dy, hr, mn, sc);
		const asUtc = new Date(asUtcMs);
		// Compute the timezone offset at this instant
		const utcParts = this.dateParts(asUtc, "UTC");
		const tzParts = this.dateParts(asUtc, timezone);
		const utcMs = Date.UTC(
			utcParts.y,
			utcParts.m,
			utcParts.d,
			utcParts.h,
			utcParts.min,
			utcParts.s,
		);
		const tzMs = Date.UTC(tzParts.y, tzParts.m, tzParts.d, tzParts.h, tzParts.min, tzParts.s);
		const offsetMs = tzMs - utcMs; // positive means timezone is ahead of UTC
		// The user meant the bare time in their timezone, so subtract the offset
		return new Date(asUtcMs - offsetMs).toISOString();
	}

	private dateParts(
		date: Date,
		timeZone: string,
	): { y: number; m: number; d: number; h: number; min: number; s: number } {
		const fmt = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
		const parts = fmt.formatToParts(date);
		const get = (type: string) =>
			Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
		return {
			y: get("year"),
			m: get("month") - 1,
			d: get("day"),
			h: get("hour") === 24 ? 0 : get("hour"),
			min: get("minute"),
			s: get("second"),
		};
	}
}
