import { describe, expect, it } from "vitest";
import { detectRealTimeQuery, shouldForceToolUse } from "./grounding.js";

describe("detectRealTimeQuery", () => {
	describe("sports schedules", () => {
		it("detects sports schedule queries", () => {
			const result = detectRealTimeQuery("When is India's next T20 World Cup match?");
			expect(result.requiresGrounding).toBe(true);
			expect(result.detectedPatterns).toContain("sports_schedule");
		});

		it("detects game timing queries", () => {
			const result = detectRealTimeQuery("What time does the game start today?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("detects fixture queries", () => {
			const result = detectRealTimeQuery("Which day is the next fixture?");
			expect(result.requiresGrounding).toBe(true);
		});
	});

	describe("live data", () => {
		it("detects live score queries", () => {
			const result = detectRealTimeQuery("What's the latest score in the match?");
			expect(result.requiresGrounding).toBe(true);
			expect(result.detectedPatterns).toContain("live_data");
		});

		it("detects current news queries", () => {
			const result = detectRealTimeQuery("What are today's news updates?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("detects live result queries", () => {
			const result = detectRealTimeQuery("What's the current result?");
			expect(result.requiresGrounding).toBe(true);
		});
	});

	describe("sports scores", () => {
		it("detects score queries", () => {
			const result = detectRealTimeQuery("What was the score of the match?");
			expect(result.requiresGrounding).toBe(true);
			expect(result.detectedPatterns).toContain("sports_score");
		});

		it("detects team result queries", () => {
			const result = detectRealTimeQuery("How did the team play in their game?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("detects player standing queries", () => {
			const result = detectRealTimeQuery("What's the player standing in the tournament?");
			expect(result.requiresGrounding).toBe(true);
		});
	});

	describe("weather", () => {
		it("detects current weather queries", () => {
			const result = detectRealTimeQuery("What's the weather today?");
			expect(result.requiresGrounding).toBe(true);
			expect(result.detectedPatterns).toContain("weather");
		});

		it("detects temperature queries", () => {
			const result = detectRealTimeQuery("What's the temperature now?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("detects forecast queries", () => {
			const result = detectRealTimeQuery("What's the weather forecast for tomorrow?");
			expect(result.requiresGrounding).toBe(true);
		});
	});

	describe("financial data", () => {
		it("detects stock price queries", () => {
			const result = detectRealTimeQuery("What's the current stock price of Apple?");
			expect(result.requiresGrounding).toBe(true);
			expect(result.detectedPatterns).toContain("financial");
		});

		it("detects crypto price queries", () => {
			const result = detectRealTimeQuery("What's bitcoin price today?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("detects rate queries", () => {
			const result = detectRealTimeQuery("What's the current exchange rate?");
			expect(result.requiresGrounding).toBe(true);
		});
	});

	describe("recent events", () => {
		it("detects who won queries", () => {
			const result = detectRealTimeQuery("Who won the match today?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("detects yesterday event queries", () => {
			const result = detectRealTimeQuery("What happened yesterday?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("detects last night queries", () => {
			const result = detectRealTimeQuery("How did the game go last night?");
			expect(result.requiresGrounding).toBe(true);
		});
	});

	describe("upcoming events", () => {
		it("detects next match queries", () => {
			const result = detectRealTimeQuery("When is the next match?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("detects upcoming event queries", () => {
			const result = detectRealTimeQuery("What upcoming events are there?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("detects scheduled release queries", () => {
			const result = detectRealTimeQuery("When is the next episode release?");
			expect(result.requiresGrounding).toBe(true);
		});
	});

	describe("exemptions - should NOT require grounding", () => {
		it("exempts historical queries", () => {
			const result = detectRealTimeQuery("Who won the World Cup in 2011?");
			expect(result.requiresGrounding).toBe(false);
		});

		it("exempts theoretical questions", () => {
			const result = detectRealTimeQuery("How do you define a match in game theory?");
			expect(result.requiresGrounding).toBe(false);
		});

		it("exempts definition questions", () => {
			const result = detectRealTimeQuery("What is the meaning of score in music?");
			expect(result.requiresGrounding).toBe(false);
		});

		it("exempts tutorial requests", () => {
			const result = detectRealTimeQuery("How to check stock prices online?");
			expect(result.requiresGrounding).toBe(false);
		});

		it("exempts personal reminders", () => {
			const result = detectRealTimeQuery("Remind me about my schedule tomorrow");
			expect(result.requiresGrounding).toBe(false);
		});

		it("exempts historical context", () => {
			const result = detectRealTimeQuery("What was the score in the 1986 World Cup final?");
			expect(result.requiresGrounding).toBe(false);
		});

		it("exempts ancient history", () => {
			const result = detectRealTimeQuery("When did the ancient Olympics start?");
			expect(result.requiresGrounding).toBe(false);
		});
	});

	describe("general queries - should NOT require grounding", () => {
		it("passes simple greetings", () => {
			const result = detectRealTimeQuery("Hello, how are you?");
			expect(result.requiresGrounding).toBe(false);
		});

		it("passes coding questions", () => {
			const result = detectRealTimeQuery("How do I write a for loop in Python?");
			expect(result.requiresGrounding).toBe(false);
		});

		it("passes general knowledge questions", () => {
			const result = detectRealTimeQuery("What is the capital of France?");
			expect(result.requiresGrounding).toBe(false);
		});

		it("passes file operations", () => {
			const result = detectRealTimeQuery("Read the file config.json");
			expect(result.requiresGrounding).toBe(false);
		});

		it("passes memory operations", () => {
			const result = detectRealTimeQuery("Remember that I like pizza");
			expect(result.requiresGrounding).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("handles empty string", () => {
			const result = detectRealTimeQuery("");
			expect(result.requiresGrounding).toBe(false);
		});

		it("handles case insensitivity", () => {
			const result = detectRealTimeQuery("WHEN IS THE NEXT MATCH?");
			expect(result.requiresGrounding).toBe(true);
		});

		it("handles mixed case", () => {
			const result = detectRealTimeQuery("What's The Weather Today?");
			expect(result.requiresGrounding).toBe(true);
		});
	});
});

describe("shouldForceToolUse", () => {
	it("returns true for real-time queries", () => {
		expect(shouldForceToolUse("What's the score of the match?")).toBe(true);
	});

	it("returns false for general queries", () => {
		expect(shouldForceToolUse("What is 2 + 2?")).toBe(false);
	});

	it("respects disabled config", () => {
		expect(shouldForceToolUse("What's the score of the match?", { enabled: false })).toBe(false);
	});

	it("respects enabled config", () => {
		expect(shouldForceToolUse("What's the score of the match?", { enabled: true })).toBe(true);
	});
});
