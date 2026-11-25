// Einziger Eingang für Ergebnisse: buildReport(). Er ruft verifyClaims() selbst
// auf, ein Weg von einer Angabe zur Karte ohne Zitat-Prüfung existiert nicht.
// "Beste Antwort" ist eine einfache Regel: nach der Antwort folgt ein belegter
// nächster Schritt, ohne dass der Käufer denselben Einwand erneut bringt.
// Verlust-Regel: ein nächster Schritt gilt nur, wenn im selben Gespräch ab
// seinem Turn (gleicher Turn eingeschlossen) kein loss_reason mehr kommt.

import { applyRoles, classifyCall, parseTranscript, uniqueFileNames } from "./parse.js";
import { verifyClaims } from "./quote.js";
import { CATEGORIES, extractByRules } from "./rules.js";

/**
 * @typedef {import("./types.js").Claim} Claim
 * @typedef {import("./types.js").Finding} Finding
 * @typedef {import("./types.js").Battlecard} Battlecard
 * @typedef {import("./types.js").Report} Report
 * @typedef {import("./types.js").Transcript} Transcript
 * @typedef {import("./types.js").Role} Role
 * @typedef {Record<string, Record<string, Role>>} Overrides eindeutiger Dateiname (siehe uniqueFileNames) → Sprecher → Rolle
 */

export const UNPROVEN = "Unproven: no answer led to a next step yet";

// Grenzen für den AI-Aufruf, gleich wie im Worker (src/extract.ts).
export const AI_MAX_TURNS = 200;
export const AI_MAX_TURN_CHARS = 1000;
export const AI_MAX_TOTAL_CHARS = 12_000;

/**
 * Die nächsten Schritte eines Gesprächs, die noch gelten: ab ihrem Turn folgt
 * kein belegter loss_reason. Sortiert nach Turn.
 * @param {Finding[]} call alle Findings desselben Gesprächs
 * @returns {Finding[]}
 */
export function standingNextSteps(call) {
  const losses = call.filter((f) => f.kind === "loss_reason").map((f) => f.turnIndex);
  return call.filter((f) => f.kind === "next_step" && !losses.some((i) => i >= f.turnIndex)).sort((a, b) => a.turnIndex - b.turnIndex);
}

/**
 * Der verifizierte nächste Schritt nach der Antwort auf einen Einwand, oder null.
 * Dazwischen darf kein neuer Käufer-Einwand derselben Kategorie stehen.
 * @param {Finding} objection
 * @param {Finding[]} call alle Findings desselben Gesprächs
 * @returns {Finding | null}
 */
export function nextStepAfter(objection, call) {
  if (!objection.response) return null;
  const from = objection.response.turnIndex;
  const step = standingNextSteps(call).find((f) => f.turnIndex > from);
  if (!step) return null;
  // Bringt der Käufer denselben Einwand vor dem ersten Schritt erneut, hat die Antwort nicht getragen.
  const relapse = call.some(
    (f) => f.kind === "objection" && f.category === objection.category && f.id !== objection.id && f.turnIndex > from && f.turnIndex < step.turnIndex,
  );
  return relapse ? null : step;
}

/**
 * @param {Finding} objection
 * @param {Finding[]} call
 */
export function ledToNextStep(objection, call) {
  return nextStepAfter(objection, call) !== null;
}

/**
 * @param {Finding[]} findings
 * @returns {Battlecard[]}
 */
function buildCards(findings) {
  /** @type {Map<string, Finding[]>} */
  const byCall = new Map();
  for (const f of findings) byCall.set(f.transcriptId, [...(byCall.get(f.transcriptId) ?? []), f]);
  const objections = findings.filter((f) => f.kind === "objection");
  /** @type {Battlecard[]} */
  const cards = [];
  for (const cat of CATEGORIES) {
    const examples = objections.filter((f) => f.category === cat.id);
    if (!examples.length) continue;
    /** @type {{ finding: Finding, nextStep: Finding }[]} */
    const proven = [];
    /** @type {Finding[]} */
    const counterExamples = [];
    for (const f of examples) {
      if (!f.response) continue;
      const step = nextStepAfter(f, byCall.get(f.transcriptId) ?? []);
      if (step) proven.push({ finding: f, nextStep: step });
      else counterExamples.push(f);
    }
    proven.sort(
      (a, b) =>
        a.nextStep.turnIndex - /** @type {number} */ (a.finding.response?.turnIndex) - (b.nextStep.turnIndex - /** @type {number} */ (b.finding.response?.turnIndex)) ||
        a.finding.fileName.localeCompare(b.finding.fileName) ||
        a.finding.turnIndex - b.finding.turnIndex,
    );
    const [best, ...rest] = proven;
    cards.push({
      category: cat.id,
      label: cat.label,
      calls: new Set(examples.map((f) => f.transcriptId)).size,
      mentions: examples.length,
      examples,
      bestAnswer: best ?? null,
      otherProven: rest.map((p) => p.finding),
      counterExamples,
    });
  }
  const order = CATEGORIES.map((c) => c.id);
  return cards.sort((a, b) => b.calls - a.calls || b.mentions - a.mentions || order.indexOf(a.category) - order.indexOf(b.category));
}

/**
 * Der einzige Eingang: Dateien rein, geprüfter Bericht raus.
 * @param {{ files: { fileName: string, text: string }[], overrides?: Overrides, extraClaims?: Claim[] }} input
 * @returns {Report}
 */
export function buildReport({ files, overrides = {}, extraClaims = [] }) {
  // Gleichnamige Dateien bekommen " (2)" usw., damit Rollen-Overrides nicht geteilt werden.
  const transcripts = uniqueFileNames(files).map((f, i) => {
    const parsed = parseTranscript(`call-${i + 1}`, f.fileName, f.text);
    const t = parsed.skip ? parsed : applyRoles(parsed, overrides[f.fileName]);
    return { ...t, skip: classifyCall(t) };
  });
  const analysed = transcripts.filter((t) => !t.skip);
  const ruleClaims = analysed.flatMap(extractByRules);
  const { findings, dropped } = verifyClaims(analysed, [...ruleClaims, ...extraClaims]);

  /** @type {Record<string, number>} */
  const droppedBySource = { rule: 0, model: 0, test: 0 };
  for (const d of dropped) droppedBySource[d.claim.source] = (droppedBySource[d.claim.source] ?? 0) + 1;

  /** @param {import("./types.js").Kind} kind */
  const of = (kind) => findings.filter((f) => f.kind === kind);
  const calls = analysed.map((t) => {
    const mine = findings.filter((f) => f.transcriptId === t.id);
    // Ein noch geltender nächster Schritt liegt nach jedem Verlustgrund, also "advanced".
    const nextStep = standingNextSteps(mine)[0] ?? null;
    const lost = mine.some((f) => f.kind === "loss_reason");
    return { fileName: t.fileName, outcome: nextStep ? /** @type {const} */ ("advanced") : lost ? /** @type {const} */ ("lost") : /** @type {const} */ ("open"), nextStep };
  });
  const skipped = transcripts.filter((t) => t.skip).map((t) => ({ fileName: t.fileName, reason: /** @type {{ reason: string }} */ (t.skip).reason }));

  return {
    transcripts,
    skipped,
    findings,
    dropped,
    cards: buildCards(findings),
    problems: of("problem"),
    outcomes: of("outcome"),
    questions: of("question"),
    reasons: { won: of("win_reason"), lost: of("loss_reason") },
    calls,
    stats: { analysed: analysed.length, skipped: skipped.length, findings: findings.length, dropped: dropped.length, droppedBySource },
  };
}

/**
 * Eingabe für /api/extract: nur Rolle und Text je Turn, keine Namen, keine Dateinamen.
 * @param {Transcript} t
 * @returns {{ turns: { i: number, role: "seller" | "buyer", text: string }[] }}
 */
export function aiInput(t) {
  /** @type {{ i: number, role: "seller" | "buyer", text: string }[]} */
  const turns = [];
  let total = 0;
  for (const turn of t.turns) {
    if (turn.role !== "seller" && turn.role !== "buyer") continue;
    if (turns.length >= AI_MAX_TURNS || total >= AI_MAX_TOTAL_CHARS) break;
    const text = turn.text.slice(0, Math.min(AI_MAX_TURN_CHARS, AI_MAX_TOTAL_CHARS - total));
    total += text.length;
    turns.push({ i: turn.index, role: turn.role, text });
  }
  return { turns };
}

/**
 * Antwort von /api/extract in ungeprüfte Claims übersetzen. Geprüft wird später in buildReport().
 * @param {string} transcriptId
 * @param {unknown} answer
 * @returns {Claim[]}
 */
export function modelClaims(transcriptId, answer) {
  const a = /** @type {{ source?: unknown, claims?: unknown }} */ (answer ?? {});
  if (a.source !== "Workers AI" || !Array.isArray(a.claims)) return [];
  return a.claims.map((c) => {
    const x = /** @type {Record<string, unknown>} */ (c ?? {});
    return {
      transcriptId,
      kind: x.kind,
      category: x.category,
      quote: x.quote,
      turnHint: x.turn,
      responseQuote: x.response_quote,
      source: /** @type {const} */ ("model"),
    };
  });
}
