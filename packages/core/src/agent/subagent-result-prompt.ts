import type { SubagentState } from "./subagent-types.js";

export function buildSubagentResultPrompt(state: SubagentState): string {
	const specLabel = state.spec.name !== "general" ? ` (${state.spec.name})` : "";

	if (state.status === "completed") {
		return [
			`A background task${specLabel} you spawned has completed. Summarize the result for the user in a natural, conversational way.`,
			"",
			`Original task: ${state.task}`,
			"",
			"Raw result:",
			state.result?.trim() || "(no result)",
			"",
			"Instructions:",
			"- Reference the original task naturally (e.g. 'About that research you asked about...')",
			"- Keep the summary concise but complete — don't lose important details",
			"- Use a friendly, conversational tone",
			"- End with an optional follow-up offer if appropriate",
			"- Do NOT mention that you are 'summarizing' or that this came from a 'sub-agent'",
		].join("\n");
	}

	if (state.status === "cancelled") {
		return [
			`A background task${specLabel} you spawned was cancelled.`,
			"",
			`Original task: ${state.task}`,
			"",
			"Instructions:",
			"- Let the user know the task was cancelled as they requested",
			"- Reference the original task naturally",
			"- Offer to retry or take a different approach if appropriate",
			"- Use a friendly, conversational tone",
			"- Do NOT mention 'sub-agent' or internal implementation details",
		].join("\n");
	}

	return [
		`A background task${specLabel} you spawned has failed. Explain the failure to the user in a helpful way.`,
		"",
		`Original task: ${state.task}`,
		"",
		`Error: ${state.error ?? "(unknown error)"}`,
		"",
		"Instructions:",
		"- Reference the original task naturally",
		"- Explain what went wrong in plain language (no stack traces or technical jargon)",
		"- Offer to retry or suggest an alternative approach",
		"- Use a friendly, conversational tone",
		"- Do NOT mention 'sub-agent' or internal implementation details",
	].join("\n");
}
