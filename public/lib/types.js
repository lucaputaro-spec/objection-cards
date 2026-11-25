// Datenmodell als JSDoc. Alle anderen Dateien importieren ihre Typen von hier.
// Laufzeit-Inhalt gibt es keinen, nur die Liste der Kinds.

/**
 * @typedef {"seller" | "buyer" | "unknown"} Role
 * @typedef {{ index: number, speaker: string, role: Role, text: string, start: string | null }} Turn
 * @typedef {{
 *   id: string, fileName: string, format: "vtt" | "srt" | "txt", turns: Turn[],
 *   roles: Record<string, Role>, roleBasis: Record<string, "label" | "cues" | "manual">,
 *   skip: null | { reason: string }
 * }} Transcript
 * @typedef {"problem" | "outcome" | "objection" | "question" | "win_reason" | "loss_reason" | "next_step"} Kind
 * @typedef {"rule" | "model" | "test"} ClaimSource
 * @typedef {{
 *   transcriptId: string, kind: unknown, category?: unknown, quote: unknown,
 *   turnHint?: unknown, responseQuote?: unknown, source: ClaimSource
 * }} Claim
 * @typedef {{ quote: string, turnIndex: number, speaker: string }} Response
 * @typedef {{
 *   id: string, transcriptId: string, fileName: string, kind: Kind, category: string,
 *   quote: string, turnIndex: number, speaker: string, role: Role, source: ClaimSource,
 *   response: null | Response
 * }} Finding
 * @typedef {"no_quote" | "quote_length" | "unknown_transcript" | "unknown_kind" | "not_in_transcript" | "wrong_speaker" | "kind_mismatch" | "response_not_found"} DropReason
 * @typedef {{ claim: Claim, fileName: string, reason: DropReason, detail: string }} Dropped
 * @typedef {{
 *   category: string, label: string, calls: number, mentions: number, examples: Finding[],
 *   bestAnswer: null | { finding: Finding, nextStep: Finding }, otherProven: Finding[],
 *   counterExamples: Finding[]
 * }} Battlecard
 * @typedef {{ fileName: string, outcome: "advanced" | "lost" | "open", nextStep: Finding | null }} CallSummary
 * @typedef {{
 *   transcripts: Transcript[], skipped: { fileName: string, reason: string }[], findings: Finding[],
 *   dropped: Dropped[], cards: Battlecard[], problems: Finding[], outcomes: Finding[], questions: Finding[],
 *   reasons: { won: Finding[], lost: Finding[] }, calls: CallSummary[],
 *   stats: { analysed: number, skipped: number, findings: number, dropped: number, droppedBySource: Record<string, number> }
 * }} Report
 */

/** @type {readonly Kind[]} */
export const KINDS = Object.freeze(["problem", "outcome", "objection", "question", "win_reason", "loss_reason", "next_step"]);
