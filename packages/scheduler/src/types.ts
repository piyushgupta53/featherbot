import { z } from "zod";

export const CronScheduleSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("cron"),
		cronExpr: z.string(),
		timezone: z.string().optional(),
	}),
	z.object({
		kind: z.literal("every"),
		everySeconds: z.number().int().positive(),
	}),
	z.object({
		kind: z.literal("at"),
		at: z.string(),
	}),
]);

export const CronPayloadSchema = z.object({
	action: z.literal("agent_turn"),
	message: z.string(),
	channel: z.string().optional(),
	chatId: z.string().optional(),
});

export const CronJobStateSchema = z.object({
	nextRunAt: z.number().nullable().default(null),
	lastRunAt: z.number().nullable().default(null),
	lastStatus: z.string().nullable().default(null),
	lastError: z.string().nullable().default(null),
});

export const CronJobSchema = z.object({
	id: z.string(),
	name: z.string(),
	enabled: z.boolean().default(true),
	schedule: CronScheduleSchema,
	payload: CronPayloadSchema,
	state: CronJobStateSchema.default({}),
	createdAt: z.string(),
	updatedAt: z.string(),
	deleteAfterRun: z.boolean().default(false),
});

export const CronStoreSchema = z.object({
	version: z.number().int().default(1),
	jobs: z.array(CronJobSchema).default([]),
});

export type CronSchedule = z.infer<typeof CronScheduleSchema>;
export type CronPayload = z.infer<typeof CronPayloadSchema>;
export type CronJobState = z.infer<typeof CronJobStateSchema>;
export type CronJob = z.infer<typeof CronJobSchema>;
export type CronStore = z.infer<typeof CronStoreSchema>;
