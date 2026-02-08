import { randomUUID } from "node:crypto";
import type { CronService } from "@featherbot/scheduler";
import { z } from "zod";
import type { Tool } from "./types.js";

export class CronTool implements Tool {
	readonly name = "cron";
	readonly description =
		"Manage scheduled tasks. Use action 'add' with name, message, and a schedule (cronExpr, everySeconds, or at) to create a job. Use 'list' to view jobs, 'remove' with jobId to delete. Listing does NOT create — you must use 'add' to create.";
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
		timezone: z.string().optional().describe("Timezone for cron expressions"),
		at: z.string().optional().describe("ISO 8601 timestamp for one-time jobs"),
	});

	private readonly service: CronService;
	private channel: string | undefined;
	private chatId: string | undefined;

	constructor(service: CronService) {
		this.service = service;
	}

	setContext(channel: string, chatId: string): void {
		this.channel = channel;
		this.chatId = chatId;
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

		const scheduleCount = [p.everySeconds, p.cronExpr, p.at].filter((v) => v !== undefined).length;
		if (scheduleCount === 0) {
			return "Error: Provide exactly one of 'everySeconds', 'cronExpr', or 'at'";
		}
		if (scheduleCount > 1) {
			return "Error: Provide exactly one of 'everySeconds', 'cronExpr', or 'at'";
		}

		let schedule:
			| { kind: "cron"; cronExpr: string; timezone?: string }
			| { kind: "every"; everySeconds: number }
			| { kind: "at"; at: string };
		if (p.cronExpr !== undefined) {
			schedule = { kind: "cron", cronExpr: p.cronExpr, timezone: p.timezone };
		} else if (p.everySeconds !== undefined) {
			schedule = { kind: "every", everySeconds: p.everySeconds };
		} else {
			schedule = { kind: "at", at: p.at as string };
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
		const nextRun = job?.state.nextRunAt ? new Date(job.state.nextRunAt).toISOString() : "N/A";

		return `Job created: "${p.name}" (ID: ${id})\nSchedule: ${this.formatSchedule(schedule)}\nNext run: ${nextRun}`;
	}

	private listJobs(): string {
		const jobs = this.service.listJobs();
		if (jobs.length === 0) {
			return "No scheduled jobs.";
		}

		const lines: string[] = [];
		for (const job of jobs) {
			const nextRun = job.state.nextRunAt ? new Date(job.state.nextRunAt).toISOString() : "N/A";
			const lastRun = job.state.lastRunAt ? new Date(job.state.lastRunAt).toISOString() : "never";
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
				return `once at ${schedule.at}`;
			default:
				return "unknown";
		}
	}
}
