export interface ProactiveSendRecord {
	summary: string;
	sentAt: string;
}

function localDateParts(
	date: Date,
	timezone?: string,
): {
	timestamp: string;
	dayOfWeek: string;
	timezoneLabel: string;
} {
	if (!timezone) {
		const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long" });
		return { timestamp: date.toISOString(), dayOfWeek, timezoneLabel: "UTC" };
	}
	const local = date.toLocaleString("en-US", {
		timeZone: timezone,
		weekday: "short",
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		timeZoneName: "short",
	});
	const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long", timeZone: timezone });
	return { timestamp: local, dayOfWeek, timezoneLabel: timezone };
}

function formatRecentSends(sends: ProactiveSendRecord[], timezone?: string): string {
	if (sends.length === 0) return "None — you have not sent any proactive messages recently.";
	return sends
		.map((s) => {
			const date = new Date(s.sentAt);
			const timeStr = timezone
				? date.toLocaleString("en-US", {
					timeZone: timezone,
					month: "short",
					day: "numeric",
					hour: "numeric",
					minute: "2-digit",
				})
				: date.toISOString();
			return `- [${timeStr}] ${s.summary}`;
		})
		.join("\n");
}

export function buildHeartbeatPrompt(
	content: string,
	timezone?: string,
	recentSends?: ProactiveSendRecord[],
): string {
	const now = new Date();
	const { timestamp, dayOfWeek, timezoneLabel } = localDateParts(now, timezone);
	const historyBlock = formatRecentSends(recentSends ?? [], timezone);

	return `You are waking up for a periodic heartbeat self-check.

Current time: ${timestamp}
Day of week: ${dayOfWeek}
Timezone: ${timezoneLabel}

## Recent proactive messages you already sent
${historyBlock}

Do NOT repeat information you already sent unless there is a meaningful update.

## Instructions

Review the heartbeat file below.

Your DEFAULT response is SKIP. Only deviate from SKIP if ALL of the following are true:
1. The heartbeat file contains a genuinely time-sensitive, actionable task (a reminder due now, a deadline passing, a check that must happen)
2. The task has NOT already been covered in your recent proactive messages above
3. The user would genuinely benefit from receiving this message RIGHT NOW

If NONE of those conditions are met, you MUST respond with exactly: SKIP
Do NOT send greetings, status updates, weather reports, motivational messages, "just checking in" messages, or summaries of what you found in the heartbeat file. These are NOT actionable.

When you DO have something actionable, respond with a clear, concise, friendly message.
When you DON'T, respond with ONLY the word SKIP — nothing else, no explanation.

---

${content}`;
}

/**
 * Detect whether a heartbeat response should be treated as a SKIP.
 * Catches both explicit SKIP responses and non-actionable filler messages
 * that the LLM generates instead of a clean SKIP.
 */
export function isHeartbeatSkip(text: string): boolean {
	const trimmed = text.trim();

	// Explicit SKIP at start
	if (/^SKIP\b/i.test(trimmed)) return true;

	// Short response that contains SKIP anywhere (LLM wrapped SKIP in extra text)
	if (trimmed.length < 100 && /\bSKIP\b/i.test(trimmed)) return true;

	// Common non-actionable filler patterns the LLM generates instead of SKIP
	const lc = trimmed.toLowerCase();
	const fillerPatterns = [
		"nothing actionable",
		"nothing to report",
		"no actionable",
		"no action needed",
		"no updates",
		"no tasks",
		"no reminders",
		"everything looks good",
		"all good",
		"nothing new",
		"nothing requires",
		"checked the heartbeat",
		"reviewed the heartbeat",
		"no pending",
		"nothing pending",
	];

	if (fillerPatterns.some((p) => lc.includes(p))) return true;

	return false;
}
