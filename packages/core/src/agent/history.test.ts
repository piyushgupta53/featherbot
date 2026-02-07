import { describe, expect, it } from "vitest";
import type { LLMMessage } from "../provider/types.js";
import { InMemoryHistory } from "./history.js";

function msg(role: LLMMessage["role"], content: string): LLMMessage {
	return { role, content };
}

describe("InMemoryHistory", () => {
	it("starts empty", () => {
		const history = new InMemoryHistory();
		expect(history.length).toBe(0);
		expect(history.getMessages()).toEqual([]);
	});

	it("adds messages", () => {
		const history = new InMemoryHistory();
		history.add(msg("user", "hello"));
		history.add(msg("assistant", "hi"));
		expect(history.length).toBe(2);
		expect(history.getMessages()).toEqual([msg("user", "hello"), msg("assistant", "hi")]);
	});

	it("returns a copy from getMessages", () => {
		const history = new InMemoryHistory();
		history.add(msg("user", "hello"));
		const messages = history.getMessages();
		messages.push(msg("user", "injected"));
		expect(history.length).toBe(1);
	});

	it("clears history", () => {
		const history = new InMemoryHistory();
		history.add(msg("user", "hello"));
		history.add(msg("assistant", "hi"));
		history.clear();
		expect(history.length).toBe(0);
		expect(history.getMessages()).toEqual([]);
	});

	it("trims oldest non-system messages when exceeding maxMessages", () => {
		const history = new InMemoryHistory({ maxMessages: 3 });
		history.add(msg("user", "1"));
		history.add(msg("assistant", "2"));
		history.add(msg("user", "3"));
		history.add(msg("assistant", "4"));
		expect(history.length).toBe(3);
		expect(history.getMessages()).toEqual([
			msg("assistant", "2"),
			msg("user", "3"),
			msg("assistant", "4"),
		]);
	});

	it("never trims system messages", () => {
		const history = new InMemoryHistory({ maxMessages: 3 });
		history.add(msg("system", "sys1"));
		history.add(msg("user", "1"));
		history.add(msg("assistant", "2"));
		history.add(msg("user", "3"));
		expect(history.length).toBe(3);
		const messages = history.getMessages();
		expect(messages[0]).toEqual(msg("system", "sys1"));
		expect(messages[1]).toEqual(msg("assistant", "2"));
		expect(messages[2]).toEqual(msg("user", "3"));
	});

	it("preserves multiple system messages during trim", () => {
		const history = new InMemoryHistory({ maxMessages: 4 });
		history.add(msg("system", "sys1"));
		history.add(msg("system", "sys2"));
		history.add(msg("user", "1"));
		history.add(msg("assistant", "2"));
		history.add(msg("user", "3"));
		expect(history.length).toBe(4);
		const messages = history.getMessages();
		expect(messages[0]).toEqual(msg("system", "sys1"));
		expect(messages[1]).toEqual(msg("system", "sys2"));
		expect(messages[2]).toEqual(msg("assistant", "2"));
		expect(messages[3]).toEqual(msg("user", "3"));
	});

	it("defaults maxMessages to 50", () => {
		const history = new InMemoryHistory();
		for (let i = 0; i < 55; i++) {
			history.add(msg("user", `msg-${i}`));
		}
		expect(history.length).toBe(50);
		const messages = history.getMessages();
		expect(messages[0]?.content).toBe("msg-5");
		expect(messages[49]?.content).toBe("msg-54");
	});

	it("handles tool messages during trim", () => {
		const history = new InMemoryHistory({ maxMessages: 2 });
		history.add({ role: "tool", content: "result", toolCallId: "tc1" });
		history.add(msg("user", "next"));
		history.add(msg("assistant", "reply"));
		expect(history.length).toBe(2);
		expect(history.getMessages()).toEqual([msg("user", "next"), msg("assistant", "reply")]);
	});
});
