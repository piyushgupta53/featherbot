import type Database from "better-sqlite3";
import {
	type ConversationSummarizer,
	createSummaryMessage,
	extractSummaryText,
	isSummaryMessage,
} from "../agent/summarizer.js";
import type { ConversationHistory } from "../agent/types.js";
import type { LLMMessage } from "../provider/types.js";

export class SqliteHistory implements ConversationHistory {
	private readonly maxMessages: number;
	private readonly stmtInsert: Database.Statement;
	private readonly stmtSelect: Database.Statement;
	private readonly stmtClear: Database.Statement;
	private readonly stmtCount: Database.Statement;
	private readonly stmtCountNonSystem: Database.Statement;
	private readonly stmtDeleteOldest: Database.Statement;
	private readonly stmtDeleteSummary: Database.Statement;
	private summarizer?: ConversationSummarizer;
	private summarizing = false;

	constructor(
		db: Database.Database,
		private readonly sessionId: string,
		options?: { maxMessages?: number },
	) {
		this.maxMessages = options?.maxMessages ?? 50;

		this.stmtInsert = db.prepare(
			"INSERT INTO messages (session_id, role, content, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?)",
		);
		this.stmtSelect = db.prepare(
			"SELECT role, content, tool_call_id FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC",
		);
		this.stmtClear = db.prepare("DELETE FROM messages WHERE session_id = ?");
		this.stmtCount = db.prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?");
		this.stmtCountNonSystem = db.prepare(
			"SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND role != 'system'",
		);
		this.stmtDeleteOldest = db.prepare(
			"DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE session_id = ? AND role != 'system' ORDER BY created_at ASC, id ASC LIMIT ?)",
		);
		this.stmtDeleteSummary = db.prepare(
			"DELETE FROM messages WHERE session_id = ? AND role = 'system' AND content LIKE '[CONVERSATION SUMMARY]%'",
		);
	}

	setSummarizer(summarizer: ConversationSummarizer): void {
		this.summarizer = summarizer;
	}

	add(message: LLMMessage): void {
		const now = new Date().toISOString();
		this.stmtInsert.run(
			this.sessionId,
			message.role,
			message.content,
			message.toolCallId ?? null,
			now,
		);
		this.trim();
	}

	getMessages(): LLMMessage[] {
		const rows = this.stmtSelect.all(this.sessionId) as {
			role: string;
			content: string;
			tool_call_id: string | null;
		}[];
		return rows.map((row) => {
			const msg: LLMMessage = {
				role: row.role as LLMMessage["role"],
				content: sanitizeHistoryContent(row.content),
			};
			if (row.tool_call_id !== null) {
				msg.toolCallId = row.tool_call_id;
			}
			return msg;
		});
	}

	clear(): void {
		this.stmtClear.run(this.sessionId);
	}

	get length(): number {
		const row = this.stmtCount.get(this.sessionId) as { count: number };
		return row.count;
	}

	private trim(): void {
		const total = this.length;
		if (total <= this.maxMessages) {
			return;
		}

		const nonSystemRow = this.stmtCountNonSystem.get(this.sessionId) as { count: number };
		const systemCount = total - nonSystemRow.count;
		const available = this.maxMessages - systemCount;
		const excess = nonSystemRow.count - available;

		if (excess > 0) {
			// Get messages to evict for summarization before deleting
			if (this.summarizer && !this.summarizing) {
				this.summarizing = true;
				const allMessages = this.getMessages();
				const nonSystem = allMessages.filter((m) => m.role !== "system");
				const evicted = nonSystem.slice(0, excess);

				const existingSummaryMsg = allMessages.find(isSummaryMessage);
				const existingSummary = existingSummaryMsg
					? extractSummaryText(existingSummaryMsg)
					: undefined;

				// Delete oldest non-system messages
				this.stmtDeleteOldest.run(this.sessionId, excess);

				// Fire-and-forget summarization
				void this.summarizer
					.summarize(evicted, existingSummary)
					.then((summary) => {
						if (summary) {
							// Targeted replace: delete old summary, insert new one.
							// This avoids the race condition of clearing all messages
							// while new ones may have been added concurrently.
							this.stmtDeleteSummary.run(this.sessionId);
							const summaryMsg = createSummaryMessage(summary);
							this.stmtInsert.run(
								this.sessionId,
								summaryMsg.role,
								summaryMsg.content,
								null,
								new Date(0).toISOString(),
							);
						}
					})
					.catch((err) => {
						console.warn("[sqlite-history] summarization failed:", err);
					})
					.finally(() => {
						this.summarizing = false;
					});
			} else {
				this.stmtDeleteOldest.run(this.sessionId, excess);
			}
		}
	}
}

/**
 * Rewrite <tool_log> blocks in history into a plain-text format
 * the model won't mimic as XML. Preserves the tool activity info
 * so the agent can still reference what it did.
 */
function sanitizeHistoryContent(content: string): string {
	if (!content.includes("<tool_log>")) return content;
	return content
		.replace(/<tool_log>([\s\S]*?)<\/tool_log>/g, (_match, inner: string) => {
			const lines = inner.trim().split("\n").filter(Boolean);
			return `\n[Tool activity: ${lines.join(" | ")}]\n`;
		})
		.replace(/<tool_log>[\s\S]*?<\/minimax:tool_call>/g, "")
		.replace(/<tool_log>[\s\S]*$/g, "")
		.trim();
}
