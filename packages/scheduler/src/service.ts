import { Cron } from "croner";
import { CronJobStore } from "./store.js";
import type { CronJob, CronSchedule } from "./types.js";

export interface CronServiceOptions {
	storePath: string;
	onJobFire: (job: CronJob) => Promise<void>;
}

export class CronService {
	private readonly store: CronJobStore;
	private readonly onJobFire: (job: CronJob) => Promise<void>;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;

	constructor(options: CronServiceOptions) {
		this.store = new CronJobStore(options.storePath);
		this.onJobFire = options.onJobFire;
	}

	start(): void {
		this.store.load();
		this.running = true;
		for (const job of this.store.listJobs()) {
			if (job.enabled) {
				const nextRun = this.computeNextRun(job.schedule);
				this.store.updateJob(job.id, {
					state: { ...job.state, nextRunAt: nextRun },
				});
			}
		}
		this.armTimer();
	}

	stop(): void {
		this.running = false;
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	addJob(job: CronJob): void {
		const nextRun = this.computeNextRun(job.schedule);
		this.store.addJob({
			...job,
			state: { ...job.state, nextRunAt: nextRun },
		});
		this.armTimer();
	}

	removeJob(jobId: string): boolean {
		const removed = this.store.removeJob(jobId);
		if (removed) {
			this.armTimer();
		}
		return removed;
	}

	enableJob(jobId: string, enabled: boolean): boolean {
		const job = this.store.getJob(jobId);
		if (job === undefined) {
			return false;
		}
		const nextRun = enabled ? this.computeNextRun(job.schedule) : null;
		this.store.updateJob(jobId, {
			enabled,
			state: { ...job.state, nextRunAt: nextRun },
		});
		this.armTimer();
		return true;
	}

	listJobs(): CronJob[] {
		return this.store.listJobs();
	}

	getJob(jobId: string): CronJob | undefined {
		return this.store.getJob(jobId);
	}

	computeNextRun(schedule: CronSchedule): number | null {
		switch (schedule.kind) {
			case "cron": {
				try {
					const cron = new Cron(schedule.cronExpr, {
						timezone: schedule.timezone,
					});
					const next = cron.nextRun();
					return next !== null ? next.getTime() : null;
				} catch {
					return null;
				}
			}
			case "every":
				return Date.now() + schedule.everySeconds * 1000;
			case "at": {
				const time = new Date(schedule.at).getTime();
				if (Number.isNaN(time) || time <= Date.now()) {
					return null;
				}
				return time;
			}
		}
	}

	private armTimer(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (!this.running) {
			return;
		}

		const jobs = this.store.listJobs();
		let earliest: number | null = null;
		for (const job of jobs) {
			if (job.enabled && job.state.nextRunAt !== null) {
				if (earliest === null || job.state.nextRunAt < earliest) {
					earliest = job.state.nextRunAt;
				}
			}
		}

		if (earliest === null) {
			return;
		}

		const delay = Math.max(0, earliest - Date.now());
		this.timer = setTimeout(() => {
			this.onTimer();
		}, delay);
	}

	private async onTimer(): Promise<void> {
		if (!this.running) {
			return;
		}

		const now = Date.now();
		const jobs = this.store.listJobs();
		const dueJobs = jobs.filter(
			(j) => j.enabled && j.state.nextRunAt !== null && j.state.nextRunAt <= now,
		);

		for (const job of dueJobs) {
			try {
				await this.onJobFire(job);
				this.store.updateJob(job.id, {
					state: {
						...job.state,
						lastRunAt: Date.now(),
						lastStatus: "ok",
						lastError: null,
					},
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.store.updateJob(job.id, {
					state: {
						...job.state,
						lastRunAt: Date.now(),
						lastStatus: "error",
						lastError: message,
					},
				});
			}

			if (job.deleteAfterRun) {
				this.store.removeJob(job.id);
			} else {
				const current = this.store.getJob(job.id);
				if (current !== undefined) {
					const nextRun = this.computeNextRun(current.schedule);
					this.store.updateJob(job.id, {
						state: { ...current.state, nextRunAt: nextRun },
					});
				}
			}
		}

		this.armTimer();
	}
}
