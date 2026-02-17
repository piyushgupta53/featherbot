import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHeartbeatPrompt, isHeartbeatSkip } from "./heartbeat-prompt.js";
import type { ProactiveSendRecord } from "./heartbeat-prompt.js";

describe("buildHeartbeatPrompt", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-09T14:30:00Z")); // Monday
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("includes current timestamp", () => {
		const prompt = buildHeartbeatPrompt("test content");
		expect(prompt).toContain("2026-02-09T14:30:00.000Z");
	});

	it("includes day of week", () => {
		const prompt = buildHeartbeatPrompt("test content");
		expect(prompt).toContain("Monday");
	});

	it("includes heartbeat file content", () => {
		const content = "## Tasks\n- [ ] Check email\n- [ ] Review calendar";
		const prompt = buildHeartbeatPrompt(content);
		expect(prompt).toContain(content);
	});

	it("includes SKIP instruction", () => {
		const prompt = buildHeartbeatPrompt("test");
		expect(prompt).toContain("SKIP");
	});

	it("shows empty history when no recent sends", () => {
		const prompt = buildHeartbeatPrompt("test");
		expect(prompt).toContain("None — you have not sent any proactive messages recently.");
	});

	it("shows empty history when recentSends is empty array", () => {
		const prompt = buildHeartbeatPrompt("test", undefined, []);
		expect(prompt).toContain("None — you have not sent any proactive messages recently.");
	});

	it("includes recent send history in prompt", () => {
		const sends: ProactiveSendRecord[] = [
			{ summary: "Your package arrives today", sentAt: "2026-02-09T09:00:00Z" },
			{ summary: "Meeting in 30 minutes", sentAt: "2026-02-09T13:30:00Z" },
		];
		const prompt = buildHeartbeatPrompt("test", undefined, sends);
		expect(prompt).toContain("Your package arrives today");
		expect(prompt).toContain("Meeting in 30 minutes");
	});

	it("includes do-not-repeat instruction", () => {
		const prompt = buildHeartbeatPrompt("test");
		expect(prompt).toContain("Do NOT repeat information you already sent");
	});
});

describe("isHeartbeatSkip", () => {
	it("detects explicit SKIP", () => {
		expect(isHeartbeatSkip("SKIP")).toBe(true);
		expect(isHeartbeatSkip("skip")).toBe(true);
		expect(isHeartbeatSkip("  SKIP  ")).toBe(true);
	});

	it("detects SKIP wrapped in extra text (short response)", () => {
		expect(isHeartbeatSkip("I'll SKIP this one.")).toBe(true);
		expect(isHeartbeatSkip("Nothing to do, SKIP.")).toBe(true);
	});

	it("detects common filler patterns", () => {
		expect(isHeartbeatSkip("Nothing actionable in the heartbeat file right now.")).toBe(true);
		expect(isHeartbeatSkip("I checked the heartbeat file. Everything looks good and there are no updates.")).toBe(true);
		expect(isHeartbeatSkip("No reminders or tasks to relay.")).toBe(true);
		expect(isHeartbeatSkip("All good, nothing pending.")).toBe(true);
		expect(isHeartbeatSkip("There are no updates or actionable items at this time.")).toBe(true);
	});

	it("passes genuinely actionable messages", () => {
		expect(isHeartbeatSkip("Hey Piyush! Your deployment to production just finished — all health checks passed.")).toBe(false);
		expect(isHeartbeatSkip("Reminder: you have a meeting with the team in 15 minutes.")).toBe(false);
		expect(isHeartbeatSkip("The cron job you set up for database backup ran successfully at 3am.")).toBe(false);
	});

	it("passes short harmless responses that aren't filler", () => {
		expect(isHeartbeatSkip("Hello!")).toBe(false);
	});
});
