import type { LLMProvider } from "../provider/types.js";
import type { ToolRegistry } from "../tools/registry.js";

export interface CoVeOptions {
	provider: LLMProvider;
	toolRegistry: ToolRegistry;
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface VerificationResult {
	claim: string;
	verified: boolean;
	evidence: string;
}

export interface CoVeResult {
	originalResponse: string;
	verifications: VerificationResult[];
	verifiedResponse: string;
	hasHallucination: boolean;
}

/**
 * Chain of Verification (CoVe) implementation to reduce hallucination.
 *
 * 4-step process:
 * 1. Generate baseline response
 * 2. Plan verification questions for any action claims
 * 3. Execute verifications by checking tool results / facts
 * 4. Generate final verified response
 */
export class ChainOfVerification {
	private readonly provider: LLMProvider;
	private readonly model?: string;
	private readonly temperature: number;
	private readonly maxTokens?: number;

	constructor(options: CoVeOptions) {
		this.provider = options.provider;
		this.model = options.model;
		this.temperature = options.temperature ?? 0.3; // Lower temp for verification
		this.maxTokens = options.maxTokens;
	}

	/**
	 * Verify a response for hallucinated action claims
	 */
	async verify(
		response: string,
		toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
		toolResults: Array<{ toolName: string; content: string }>,
	): Promise<CoVeResult> {
		// Step 2 & 3: Extract claims and verify against tool results
		const verifications = await this.extractAndVerifyClaims(response, toolCalls, toolResults);

		// Check if any claims are hallucinated
		const hasHallucination = verifications.some((v) => !v.verified);

		// Step 4: Generate verified response
		const verifiedResponse = hasHallucination
			? await this.generateCorrectedResponse(response, verifications)
			: response;

		return {
			originalResponse: response,
			verifications,
			verifiedResponse,
			hasHallucination,
		};
	}

	/**
	 * Extract action claims from response and verify against tool execution evidence
	 */
	private async extractAndVerifyClaims(
		response: string,
		toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
		toolResults: Array<{ toolName: string; content: string }>,
	): Promise<VerificationResult[]> {
		const verifications: VerificationResult[] = [];

		// Check for common action claim patterns
		const actionPatterns = [
			{
				pattern:
					/(?:created|wrote|updated|modified)\s+(?:the\s+)?(?:file\s+)?[`']?(?:data\/|workspace\/|\.\/)?([\w\-./]+\.\w+)[`']?/i,
				type: "file_write",
			},
			{ pattern: /(?:updated|modified)\s+(?:the\s+)?\w+\s+file/i, type: "file_write" },
			{ pattern: /(?:ran|executed)\s+(?:the\s+)?(?:command|script)?/i, type: "execution" },
			{
				pattern:
					/(?:installed|added)\s+(?:the\s+)?(?:\w+\s+)?(?:package|packages|dependency|dependencies|pip)/i,
				type: "install",
			},
			{ pattern: /(?:edited|changed)\s+(?:the\s+)?(?:file|script)/i, type: "edit" },
			{ pattern: /(?:scheduled|set up)\s+(?:the\s+)?(?:cron|reminder|task)/i, type: "schedule" },
		];

		for (const { pattern, type } of actionPatterns) {
			const matches = response.match(pattern);
			if (matches) {
				const claim = matches[0];
				const verified = this.verifyClaimAgainstEvidence(claim, type, toolCalls, toolResults);
				verifications.push({
					claim,
					verified,
					evidence: verified ? "Tool execution confirmed" : "No matching tool call found",
				});
			}
		}

		// Also verify that tool calls succeeded (not just that they were made)
		for (const result of toolResults) {
			const hasError = this.checkForError(result.content);
			if (hasError) {
				verifications.push({
					claim: `${result.toolName} execution`,
					verified: false,
					evidence: `Tool failed: ${result.content.slice(0, 100)}`,
				});
			}
		}

		return verifications;
	}

	/**
	 * Verify a specific claim against tool execution evidence
	 */
	private verifyClaimAgainstEvidence(
		claim: string,
		claimType: string,
		toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
		toolResults: Array<{ toolName: string; content: string }>,
	): boolean {
		// Extract potential file paths from claim
		const pathMatch = claim.match(/[\w\-./]+\.\w+/);
		const claimedPath = pathMatch ? pathMatch[0] : null;

		switch (claimType) {
			case "file_write":
			case "edit": {
				// Check if write_file or edit_file was called
				const hasWriteTool = toolCalls.some(
					(tc) =>
						(tc.name === "write_file" || tc.name === "edit_file") &&
						(!claimedPath || JSON.stringify(tc.arguments).includes(claimedPath)),
				);
				if (!hasWriteTool) return false;

				// Check if the tool actually succeeded
				const writeResult = toolResults.find(
					(tr) =>
						(tr.toolName === "write_file" || tr.toolName === "edit_file") &&
						(!claimedPath ||
							tr.content.includes(claimedPath) ||
							tr.content.includes("Successfully")),
				);
				return writeResult !== undefined && !this.checkForError(writeResult.content);
			}

			case "execution": {
				const hasExecTool = toolCalls.some((tc) => tc.name === "exec");
				if (!hasExecTool) return false;

				const execResult = toolResults.find((tr) => tr.toolName === "exec");
				return execResult !== undefined && !this.checkForError(execResult.content);
			}

			case "install": {
				const hasPipInstall = toolCalls.some(
					(tc) => tc.name === "exec" && JSON.stringify(tc.arguments).includes("pip"),
				);
				if (!hasPipInstall) return false;

				const installResult = toolResults.find(
					(tr) => tr.toolName === "exec" && tr.content.includes("pip"),
				);
				return installResult !== undefined && !this.checkForError(installResult.content);
			}

			case "schedule": {
				const hasCronTool = toolCalls.some((tc) => tc.name === "cron");
				if (!hasCronTool) return false;

				const cronResult = toolResults.find((tr) => tr.toolName === "cron");
				return cronResult !== undefined && !this.checkForError(cronResult.content);
			}

			default:
				return false;
		}
	}

	/**
	 * Check if tool result indicates an error
	 */
	private checkForError(content: string): boolean {
		const errorIndicators = [
			/[Cc]ommand failed/,
			/[Ee]rror:/,
			/[Ee]xception/,
			/Traceback/,
			/No such file/,
			/Permission denied/,
			/cannot open file/,
			/exit code [1-9]/,
		];
		return errorIndicators.some((pattern) => pattern.test(content));
	}

	/**
	 * Generate a corrected response when hallucination is detected
	 */
	private async generateCorrectedResponse(
		originalResponse: string,
		verifications: VerificationResult[],
	): Promise<string> {
		const unverifiedClaims = verifications.filter((v) => !v.verified);

		// Build prompt for correction
		const correctionPrompt = `The following response contains claims that were NOT actually executed:

Original response: """${originalResponse}"""

Unverified claims:
${unverifiedClaims.map((v) => `- "${v.claim}": ${v.evidence}`).join("\n")}

IMPORTANT RULES:
1. NEVER claim an action was completed if it wasn't actually executed
2. If you said you updated a file but didn't - admit it and offer to do it
3. Be honest about what actually happened vs what you claimed
4. Don't make excuses, just correct the record

Provide a corrected response that only claims what was actually done.`;

		const result = await this.provider.generate({
			model: this.model,
			messages: [{ role: "system", content: correctionPrompt }],
			temperature: this.temperature,
			maxTokens: this.maxTokens,
		});

		return result.text;
	}

	/**
	 * Quick check - does response have claims without tool evidence?
	 */
	static hasUnverifiedClaims(
		response: string,
		toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
	): boolean {
		// Check for action verbs without corresponding tool calls
		const actionPatterns = [
			/(?:created|wrote|updated|modified)\s+(?:the\s+)?(?:file\s+)?[`']?(?:data\/|workspace\/|\.\/)?([\w\-./]+\.\w+)[`']?/i,
			/(?:updated|modified)\s+(?:the\s+)?\w+\s+file/i,
			/(?:edited|changed)\s+(?:the\s+)?(?:file|script)/i,
		];

		for (const pattern of actionPatterns) {
			if (pattern.test(response)) {
				// Has claim - check if write/edit tool was called
				const hasWriteTool = toolCalls.some(
					(tc) => tc.name === "write_file" || tc.name === "edit_file",
				);
				if (!hasWriteTool) {
					return true; // Claim without tool evidence
				}
			}
		}

		return false;
	}
}
