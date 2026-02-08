import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CronJob, CronStore } from "./types.js";
import { CronStoreSchema } from "./types.js";

export class CronJobStore {
	private readonly storePath: string;
	private data: CronStore = { version: 1, jobs: [] };

	constructor(storePath: string) {
		this.storePath = storePath;
	}

	load(): void {
		if (!existsSync(this.storePath)) {
			this.data = { version: 1, jobs: [] };
			return;
		}
		try {
			const raw = readFileSync(this.storePath, "utf-8");
			const parsed = JSON.parse(raw);
			const result = CronStoreSchema.safeParse(parsed);
			if (result.success) {
				this.data = result.data;
			} else {
				this.data = { version: 1, jobs: [] };
			}
		} catch {
			this.data = { version: 1, jobs: [] };
		}
	}

	save(): void {
		const dir = dirname(this.storePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(this.storePath, JSON.stringify(this.data, null, "\t"), "utf-8");
	}

	addJob(job: CronJob): void {
		this.data.jobs.push(job);
		this.save();
	}

	removeJob(jobId: string): boolean {
		const before = this.data.jobs.length;
		this.data.jobs = this.data.jobs.filter((j) => j.id !== jobId);
		const removed = this.data.jobs.length < before;
		if (removed) {
			this.save();
		}
		return removed;
	}

	getJob(jobId: string): CronJob | undefined {
		return this.data.jobs.find((j) => j.id === jobId);
	}

	listJobs(): CronJob[] {
		return [...this.data.jobs];
	}

	updateJob(jobId: string, updates: Partial<CronJob>): void {
		const job = this.data.jobs.find((j) => j.id === jobId);
		if (job === undefined) {
			return;
		}
		Object.assign(job, updates);
		this.save();
	}
}
