import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHeartbeatPrompt } from "./heartbeat-prompt.js";
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
