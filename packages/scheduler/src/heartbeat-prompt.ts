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

export function buildHeartbeatPrompt(content: string, timezone?: string): string {
	const now = new Date();
	const { timestamp, dayOfWeek, timezoneLabel } = localDateParts(now, timezone);

	return `You are waking up for a periodic heartbeat self-check.

Current time: ${timestamp}
Day of week: ${dayOfWeek}
Timezone: ${timezoneLabel}

Review the heartbeat file below. Execute any actionable tasks.
If you want to notify the user, respond with a clear, friendly message.
If nothing is actionable, respond with SKIP.

---

${content}`;
}
