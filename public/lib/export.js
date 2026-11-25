// Markdown-Export eines Berichts. Nur Zitate aus Findings, also nur geprüfte Originaltexte.

import { aiSummary } from "./ai.js";
import { UNPROVEN } from "./battlecards.js";

/**
 * @typedef {import("./types.js").Report} Report
 * @typedef {import("./types.js").Finding} Finding
 */

/** @param {string} s */
const quoteLine = (s) => `> "${s}"`;
/** @param {Finding} f */
const item = (f) => `- "${f.quote}" (${f.fileName})`;

/**
 * @param {string} title
 * @param {Finding[]} list
 */
function section(title, list) {
  return [`## ${title}`, "", ...(list.length ? list.map(item) : ["- none found"]), ""];
}

/**
 * @param {Report} report
 * @param {{ aiUsed?: boolean, aiCalls?: { used: number, of: number }, date?: string }} [opts]
 *   aiCalls hat Vorrang vor aiUsed und nennt, auf wie vielen Gesprächen die AI lief.
 * @returns {string}
 */
export function toMarkdown(report, opts = {}) {
  const aiUsed = opts.aiUsed ?? report.findings.some((f) => f.source === "model");
  const source = opts.aiCalls ? (opts.aiCalls.used > 0 ? `Rules + ${aiSummary(opts.aiCalls)}` : "Rules") : aiUsed ? "Rules + Workers AI" : "Rules";
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const total = report.stats.analysed;
  const out = [
    "# Objection battlecards",
    "",
    `Source: ${source} · ${date} · ${total} calls analysed, ${report.stats.skipped} skipped`,
    "Every quote below was found word for word in the transcript, said by the buyer (answers: by the seller).",
    "",
  ];
  for (const card of report.cards) {
    out.push(`## ${card.label}`, "", `Raised in ${card.calls} of ${total} calls · ${card.mentions} ${card.mentions === 1 ? "mention" : "mentions"}`, "");
    out.push("What buyers said:", "", ...card.examples.map(item), "");
    if (card.bestAnswer && card.bestAnswer.finding.response) {
      out.push(`Best answer (${card.bestAnswer.finding.fileName}, led to a next step):`, "");
      out.push(quoteLine(card.bestAnswer.finding.response.quote), "");
      out.push(`Next step: "${card.bestAnswer.nextStep.quote}"`, "");
    } else out.push(UNPROVEN, "");
    const others = card.otherProven.filter((f) => f.response);
    if (others.length) out.push("Other answers that led to a next step:", "", ...others.map((f) => `- "${f.response?.quote}" (${f.fileName})`), "");
    if (card.counterExamples.length) {
      out.push("Counter-examples (answered, no next step followed):", "", ...card.counterExamples.map((f) => `- "${f.response?.quote}" (${f.fileName})`), "");
    }
  }
  out.push(...section("How buyers describe the problem", [...report.problems, ...report.outcomes]));
  out.push(...section("Questions buyers ask", report.questions));
  out.push("## Why deals moved / were lost", "");
  out.push(...report.calls.map((c) => `- ${c.fileName}: ${c.outcome}${c.nextStep ? `, next step "${c.nextStep.quote}"` : ""}`));
  out.push(...report.reasons.won.map((f) => `- moved: ${item(f).slice(2)}`), ...report.reasons.lost.map((f) => `- lost: ${item(f).slice(2)}`), "");
  out.push("## Skipped", "", ...(report.skipped.length ? report.skipped.map((s) => `- ${s.fileName}: ${s.reason}`) : ["- none"]), "");
  out.push(`Dropped claims: ${report.stats.dropped}`, "");
  return out.join("\n");
}
