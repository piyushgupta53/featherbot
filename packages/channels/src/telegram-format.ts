const SPECIAL_CHARS = /[_*[\]()~`>#\+\-=|{}.!]/g;

/**
 * Escapes text for Telegram MarkdownV2 while preserving code blocks and inline code.
 */
export function escapeTelegramMarkdown(text: string): string {
	const segments: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		// Check for triple-backtick code block first
		const codeBlockIdx = remaining.indexOf("```");
		const inlineCodeIdx = remaining.indexOf("`");

		// Determine which comes first
		let nextCodeStart: number;
		let isBlock: boolean;

		if (codeBlockIdx !== -1 && (inlineCodeIdx === -1 || codeBlockIdx <= inlineCodeIdx)) {
			nextCodeStart = codeBlockIdx;
			isBlock = true;
		} else if (inlineCodeIdx !== -1) {
			nextCodeStart = inlineCodeIdx;
			isBlock = false;
		} else {
			// No more code segments — escape the rest
			segments.push(remaining.replace(SPECIAL_CHARS, "\\$&"));
			break;
		}

		// Escape text before the code segment
		if (nextCodeStart > 0) {
			segments.push(remaining.slice(0, nextCodeStart).replace(SPECIAL_CHARS, "\\$&"));
		}

		if (isBlock) {
			// Find closing ```
			const closingIdx = remaining.indexOf("```", nextCodeStart + 3);
			if (closingIdx !== -1) {
				segments.push(remaining.slice(nextCodeStart, closingIdx + 3));
				remaining = remaining.slice(closingIdx + 3);
			} else {
				// No closing ``` — treat rest as code block
				segments.push(remaining.slice(nextCodeStart));
				remaining = "";
			}
		} else {
			// Inline code — find closing `
			const closingIdx = remaining.indexOf("`", nextCodeStart + 1);
			if (closingIdx !== -1) {
				segments.push(remaining.slice(nextCodeStart, closingIdx + 1));
				remaining = remaining.slice(closingIdx + 1);
			} else {
				// No closing ` — escape as normal text
				segments.push(remaining.slice(nextCodeStart).replace(SPECIAL_CHARS, "\\$&"));
				remaining = "";
			}
		}
	}

	return segments.join("");
}
