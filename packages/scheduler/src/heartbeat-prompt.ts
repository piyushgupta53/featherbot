const DAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

export function buildHeartbeatPrompt(content: string): string {
	const now = new Date();
	const timestamp = now.toISOString();
	const dayOfWeek = DAYS[now.getDay()];

	return `You are waking up for a periodic heartbeat self-check.

Current time: ${timestamp}
Day of week: ${dayOfWeek}

Review the heartbeat file below. Execute any actionable tasks.
If nothing is actionable, respond with SKIP.

---

${content}`;
}
