import { z } from "zod";

export const CorrectionSchema = z.object({
	wrong: z.string(),
	right: z.string(),
});

export type Correction = z.infer<typeof CorrectionSchema>;

export const ExtractionResultSchema = z.object({
	skip: z.boolean(),
	facts: z.array(z.string()),
	patterns: z.array(z.string()),
	pending: z.array(z.string()),
	resolvedPending: z.array(z.string()),
	corrections: z.array(CorrectionSchema),
	observations: z.array(
		z.object({
			text: z.string(),
			priority: z.enum(["red", "yellow", "green"]),
		}),
	),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export const CompactionResultSchema = z.object({
	facts: z.array(z.string()),
	patterns: z.array(z.string()),
	pending: z.array(z.string()),
});

export type CompactionResult = z.infer<typeof CompactionResultSchema>;
