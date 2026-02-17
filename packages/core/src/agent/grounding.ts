/**
 * @deprecated This module uses regex keyword patterns to detect real-time queries —
 * a fundamentally brittle approach. It was never wired into the agent loop and is now
 * superseded by:
 * 1. System-prompt-level grounding instructions (context-builder.ts) that teach the LLM
 *    to self-assess when it needs factual verification via tools.
 * 2. LLM-based factual claim detection in COVE (cove.ts) that acts as a safety net.
 *
 * This module should be removed in a future cleanup. Do not add new functionality here.
 */

export interface GroundingResult {
	requiresGrounding: boolean;
	detectedPatterns: string[];
	reason: string;
}

export interface GroundingConfig {
	enabled: boolean;
}

const REAL_TIME_PATTERNS = [
	{
		pattern:
			/\b(when|what time|what date|which day|which date)\b.+\b(match|game|play|schedule|fixture)\b/i,
		category: "sports_schedule",
		reason: "Query asks about sports schedule timing",
	},
	{
		pattern: /\b(when|what time|what date)\b.+\b(next|upcoming|today|tomorrow|yesterday)\b/i,
		category: "temporal_query",
		reason: "Query asks about timing of events",
	},
	{
		pattern: /\b(latest|current|recent|today|now|live)\b.+\b(news|update|score|result)\b/i,
		category: "live_data",
		reason: "Query asks for live/current information",
	},
	{
		pattern: /\b(score|result|standing|leaderboard)\b.+\b(match|game|team|player|tournament)\b/i,
		category: "sports_score",
		reason: "Query asks for sports scores/results",
	},
	{
		pattern: /\b(how did|how do)\b.+\b(team|player|game|match)\b.+\b(do|play|perform)\b/i,
		category: "sports_performance",
		reason: "Query asks about team/player performance",
	},
	{
		pattern: /\b(weather|temperature|forecast)\b.+\b(today|tomorrow|now|current)\b/i,
		category: "weather",
		reason: "Query asks for current weather",
	},
	{
		pattern: /\b(price|cost|rate|stock|crypto|bitcoin)\b.+\b(current|now|today|latest)\b/i,
		category: "financial",
		reason: "Query asks for current financial data",
	},
	{
		pattern: /\b(current|latest|today)\b.+\b(price|cost|rate|stock|crypto)\b/i,
		category: "financial",
		reason: "Query asks for current financial data",
	},
	{
		pattern:
			/\b(who (is|was|won)|what (is|was) the (score|result)|how (did|do|is))\b.+\b(today|yesterday|last night|this week)\b/i,
		category: "recent_events",
		reason: "Query asks about recent events",
	},
	{
		pattern: /\b(what|anything)\b.+\b(happened|happening)\b.+\b(today|yesterday|last night)\b/i,
		category: "recent_events",
		reason: "Query asks about recent events",
	},
	{
		pattern: /\b(next|upcoming|coming|scheduled)\b.+\b(match|game|event|episode|release)\b/i,
		category: "upcoming_events",
		reason: "Query asks about upcoming events",
	},
	{
		pattern: /\b(upcoming|coming)\b.+\b(events|matches|games|releases)\b/i,
		category: "upcoming_events",
		reason: "Query asks about upcoming events",
	},
	{
		pattern:
			/\b(what's|what is|how's|how is)\b.+\b(happening|on|playing|showing)\b.+\b(today|tonight|now)\b/i,
		category: "current_activities",
		reason: "Query asks about current activities",
	},
	{
		pattern: /\b(did|has|have)\b.+\b(won|lost|scored|played|announced|released)\b/i,
		category: "past_events",
		reason: "Query asks about past events that may be recent",
	},
	{
		pattern: /\b(standing|rankings?|leaderboard)\b.+\b(tournament|league|competition)\b/i,
		category: "sports_standing",
		reason: "Query asks about tournament standings",
	},
];

const EXEMPTION_PATTERNS = [
	/\b(history|historical|in \d{4}|last century|ancient)\b/i,
	/\b(theory|theoretically|hypothetically|imagine)\b/i,
	/\b(define|definition|meaning of|explain what)\b/i,
	/\b(how do (you|i)|how to|tutorial|guide)\b/i,
	/\b(remember|remind me|my|our)\b.+\b(schedule|calendar|task)\b/i,
];

export function detectRealTimeQuery(message: string): GroundingResult {
	const detectedPatterns: string[] = [];
	let requiresGrounding = false;
	let reason = "";

	for (const exemption of EXEMPTION_PATTERNS) {
		if (exemption.test(message)) {
			return {
				requiresGrounding: false,
				detectedPatterns: [],
				reason: "Query matches exemption pattern - likely not real-time data",
			};
		}
	}

	for (const { pattern, category, reason: patternReason } of REAL_TIME_PATTERNS) {
		if (pattern.test(message)) {
			detectedPatterns.push(category);
			requiresGrounding = true;
			reason = patternReason;
		}
	}

	if (!requiresGrounding) {
		reason = "No real-time data patterns detected";
	}

	return {
		requiresGrounding,
		detectedPatterns,
		reason,
	};
}

export function shouldForceToolUse(message: string, config?: GroundingConfig): boolean {
	if (config?.enabled === false) {
		return false;
	}

	const result = detectRealTimeQuery(message);
	return result.requiresGrounding;
}
