import { describe, expect, it } from "vitest";
import { escapeTelegramMarkdown } from "./telegram-format.js";

describe("escapeTelegramMarkdown", () => {
	it("escapes MarkdownV2 special characters in plain text", () => {
		const input =
			"Hello_world *bold* [link](url) ~strike~ #tag +plus -minus =eq |pipe {brace} .dot !bang";
		const result = escapeTelegramMarkdown(input);
		expect(result).toBe(
			"Hello\\_world \\*bold\\* \\[link\\]\\(url\\) \\~strike\\~ \\#tag \\+plus \\-minus \\=eq \\|pipe \\{brace\\} \\.dot \\!bang",
		);
	});

	it("preserves content inside triple-backtick code blocks", () => {
		const input = "Before ```const x = 1 + 2;``` After";
		const result = escapeTelegramMarkdown(input);
		expect(result).toBe("Before ```const x = 1 + 2;``` After");
	});

	it("preserves content inside inline code", () => {
		const input = "Use `array[0]` to access";
		const result = escapeTelegramMarkdown(input);
		expect(result).toBe("Use `array[0]` to access");
	});

	it("handles mixed content with code blocks and inline code", () => {
		const input = "Run `npm install` then:\n```\nconst x = 1 + 2;\n```\nDone!";
		const result = escapeTelegramMarkdown(input);
		expect(result).toBe("Run `npm install` then:\n```\nconst x = 1 + 2;\n```\nDone\\!");
	});

	it("handles text with no special characters", () => {
		expect(escapeTelegramMarkdown("Hello world")).toBe("Hello world");
	});

	it("handles empty string", () => {
		expect(escapeTelegramMarkdown("")).toBe("");
	});

	it("handles unclosed code block", () => {
		const input = "Start ```code without end";
		const result = escapeTelegramMarkdown(input);
		expect(result).toBe("Start ```code without end");
	});

	it("handles unclosed inline code", () => {
		const input = "Start `code without end";
		const result = escapeTelegramMarkdown(input);
		expect(result).toBe("Start \\`code without end");
	});

	it("handles code block with language specifier", () => {
		const input = "```typescript\nconst x = 1 + 2;\n```";
		const result = escapeTelegramMarkdown(input);
		expect(result).toBe("```typescript\nconst x = 1 + 2;\n```");
	});

	it("handles multiple code blocks", () => {
		const input = "`a+b` and `c.d`";
		const result = escapeTelegramMarkdown(input);
		expect(result).toBe("`a+b` and `c.d`");
	});

	it("escapes > character for blockquotes", () => {
		expect(escapeTelegramMarkdown("> quote")).toBe("\\> quote");
	});
});
