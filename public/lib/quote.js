// Der Zitat-Riegel. Jede Angabe (Claim), egal ob aus Regeln, AI oder Test,
// muss hier wörtlich im Transkript gefunden werden, beim richtigen Sprecher.
// Nur verifyClaims() erzeugt Findings (über das interne makeFinding()).
// Angeglichen werden nur Groß-/Kleinschreibung, Leerraum und Anführungszeichen.
// Kein Fuzzy-Match: lieber eine verworfene Angabe zu viel als ein erfundenes Zitat.
//
// Zirkulärer Import mit rules.js (CATEGORIES hier, MIN/MAX_QUOTE dort). Das ist
// unkritisch, weil beide Seiten die Werte erst beim Aufruf lesen, nie beim Laden.

import { CATEGORIES, kindFits, QUESTION_TOPICS } from "./rules.js";
import { KINDS } from "./types.js";

/**
 * @typedef {import("./types.js").Turn} Turn
 * @typedef {import("./types.js").Role} Role
 * @typedef {import("./types.js").Kind} Kind
 * @typedef {import("./types.js").Claim} Claim
 * @typedef {import("./types.js").Finding} Finding
 * @typedef {import("./types.js").Dropped} Dropped
 * @typedef {import("./types.js").DropReason} DropReason
 * @typedef {import("./types.js").Transcript} Transcript
 * @typedef {{ norm: string, map: number[], ends: number[] }} Normalized
 */

export const MIN_QUOTE = 12;
export const MAX_QUOTE = 300;
// Abstand, in dem die Verkäufer-Antwort auf einen Einwand liegen muss.
export const RESPONSE_WINDOW = 4;

/** @type {Record<Kind, Role>} */
export const REQUIRED_ROLE = Object.freeze({
  problem: "buyer",
  outcome: "buyer",
  objection: "buyer",
  question: "buyer",
  win_reason: "buyer",
  loss_reason: "buyer",
  next_step: "buyer",
});
/** @type {Role} */
export const RESPONSE_ROLE = "seller";

const SINGLE_QUOTES = /[‘’‚‛′´`]/g;
const DOUBLE_QUOTES = /[“”„‟″«»]/g;
const SPACE = /\s/u;
const MARK = /\p{M}/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Wie normalizeWithMap, zusätzlich mit dem Ende jedes Originalabschnitts.
 * Ein Abschnitt ist ein Zeichen samt folgender Kombinationszeichen, damit NFC
 * und toLowerCase() die Länge ändern dürfen, ohne die Zuordnung zu verlieren.
 * @param {string} s
 * @returns {Normalized}
 */
function normalizeFull(s) {
  let norm = "";
  /** @type {number[]} */
  const map = [];
  /** @type {number[]} */
  const ends = [];
  let i = 0;
  let lastWasSpace = false;
  while (i < s.length) {
    const start = i;
    const cp = /** @type {number} */ (s.codePointAt(i));
    i += cp > 0xffff ? 2 : 1;
    while (i < s.length && MARK.test(s[i] ?? "")) i += 1;
    const segment = s.slice(start, i);
    if (SPACE.test(segment)) {
      if (lastWasSpace) {
        ends[ends.length - 1] = i;
        continue;
      }
      norm += " ";
      map.push(start);
      ends.push(i);
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;
    const out = segment.normalize("NFC").replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').toLowerCase();
    for (let k = 0; k < out.length; k += 1) {
      map.push(start);
      ends.push(i);
    }
    norm += out;
  }
  return { norm, map, ends };
}

/**
 * Normalisiert Zeichen für Zeichen. map[i] ist der Index im Original.
 * @param {string} s
 * @returns {{ norm: string, map: number[] }}
 */
export function normalizeWithMap(s) {
  const { norm, map } = normalizeFull(s);
  return { norm, map };
}

const EDGE_START = /^(?:[\s"'“”„‟″«»‘’‚‛′´`]|\.\.\.|…)+/u;
const EDGE_END = /(?:[\s"'“”„‟″«»‘’‚‛′´`]|\.\.\.|…)+$/u;

/**
 * Entfernt nur am Rand Leerraum, Anführungszeichen und Auslassungspunkte.
 * @param {string} q
 */
export function trimQuoteEdges(q) {
  return q.replace(EDGE_START, "").replace(EDGE_END, "");
}

/**
 * Länge eines Zitats nach dem Zusammenfassen von Leerraum, also so, wie es
 * verglichen wird. "a       deal" hat 6 Zeichen, nicht 12.
 * @param {string} q
 */
export function quoteLength(q) {
  return normalizeFull(trimQuoteEdges(q)).norm.trim().length;
}

/** @type {WeakMap<Turn, Normalized>} */
const cache = new WeakMap();

/** @param {Turn} turn */
function normTurn(turn) {
  let n = cache.get(turn);
  if (!n) {
    n = normalizeFull(turn.text);
    cache.set(turn, n);
  }
  return n;
}

/**
 * Alle Fundstellen von needle in einem Turn, mit Wortgrenze an beiden Rändern.
 * @param {string} needle normalisiert
 * @param {Turn} turn
 * @returns {{ start: number, end: number }[]}
 */
function matchesIn(needle, turn) {
  const { norm } = normTurn(turn);
  const hits = [];
  let from = 0;
  while (needle) {
    const at = norm.indexOf(needle, from);
    if (at < 0) break;
    const end = at + needle.length;
    const before = at > 0 ? norm[at - 1] ?? "" : "";
    const after = end < norm.length ? norm[end] ?? "" : "";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) hits.push({ start: at, end });
    from = at + 1;
  }
  return hits;
}

/**
 * Sucht ein Zitat vollständig in einem einzigen Turn der verlangten Rolle.
 * @param {string} quote
 * @param {Turn[]} turns
 * @param {Role} role
 * @param {number} [turnHint]
 * @returns {{ turn: Turn, original: string, start: number, end: number } | { error: "not_in_transcript" | "wrong_speaker" }}
 */
export function findQuote(quote, turns, role, turnHint) {
  const needle = normalizeFull(trimQuoteEdges(quote)).norm.trim();
  /** @type {{ turn: Turn, start: number, end: number }[]} */
  const hits = [];
  let otherRole = false;
  for (const turn of turns) {
    const found = matchesIn(needle, turn);
    if (!found.length) continue;
    if (turn.role !== role) {
      otherRole = true;
      continue;
    }
    for (const f of found) hits.push({ turn, ...f });
  }
  if (!hits.length) return { error: otherRole ? "wrong_speaker" : "not_in_transcript" };
  const hint = typeof turnHint === "number" && Number.isFinite(turnHint) ? turnHint : null;
  const best = hint === null ? hits[0] : hits.reduce((a, b) => (Math.abs(b.turn.index - hint) < Math.abs(a.turn.index - hint) ? b : a));
  const chosen = /** @type {{ turn: Turn, start: number, end: number }} */ (best);
  const { map, ends } = normTurn(chosen.turn);
  const start = /** @type {number} */ (map[chosen.start]);
  const end = /** @type {number} */ (ends[chosen.end - 1]);
  return { turn: chosen.turn, original: chosen.turn.text.slice(start, end), start, end };
}

/**
 * Der Satz (oder die Sätze), in dem der Abschnitt start–end eines Textes steht.
 * Satzgrenze wie in splitSentences: . ! ? … mit folgendem Leerraum.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 */
function sentenceAround(text, start, end) {
  const boundary = /[.!?…]\s+/g;
  let from = 0;
  let to = text.length;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
    if (m.index + m[0].length <= start) from = m.index + m[0].length;
    else if (m.index + 1 >= end) {
      to = m.index + 1;
      break;
    }
  }
  return text.slice(from, to);
}

/**
 * Erlaubte Kategorien je Kind. Fragen haben Themen, alles andere Einwand-Kategorien.
 * @param {Kind} kind
 * @param {unknown} category
 */
function cleanCategory(kind, category) {
  const allowed = kind === "question" ? QUESTION_TOPICS : CATEGORIES.map((c) => c.id);
  return typeof category === "string" && allowed.includes(category) ? category : "other";
}

/** @param {unknown} kind @returns {kind is Kind} */
function isKind(kind) {
  return typeof kind === "string" && /** @type {readonly string[]} */ (KINDS).includes(kind);
}

/**
 * Einziger Erzeuger von Findings. Nicht exportiert.
 * @param {{ id: string, transcript: Transcript, kind: Kind, category: string, turn: Turn, original: string,
 *   source: import("./types.js").ClaimSource, response: Finding["response"] }} p
 * @returns {Finding}
 */
function makeFinding(p) {
  return Object.freeze({
    id: p.id,
    transcriptId: p.transcript.id,
    fileName: p.transcript.fileName,
    kind: p.kind,
    category: p.category,
    quote: p.original,
    turnIndex: p.turn.index,
    speaker: p.turn.speaker,
    role: p.turn.role,
    source: p.source,
    response: p.response,
  });
}

/**
 * Prüft jede Angabe gegen das Transkript. Was nicht wörtlich beim richtigen
 * Sprecher steht, landet mit Grund in dropped.
 * @param {Transcript[]} transcripts
 * @param {Claim[]} claims
 * @returns {{ findings: Finding[], dropped: Dropped[] }}
 */
export function verifyClaims(transcripts, claims) {
  const byId = new Map(transcripts.map((t) => [t.id, t]));
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Dropped[]} */
  const dropped = [];
  /** @type {Map<string, number>} */
  const seen = new Map();

  /** @param {Claim} claim @param {string} fileName @param {DropReason} reason @param {string} detail */
  const drop = (claim, fileName, reason, detail) => dropped.push({ claim, fileName, reason, detail });

  for (const claim of claims) {
    const t = byId.get(claim.transcriptId);
    if (!t) {
      drop(claim, "", "unknown_transcript", `no analysed transcript with id ${String(claim.transcriptId)}`);
      continue;
    }
    if (!isKind(claim.kind)) {
      drop(claim, t.fileName, "unknown_kind", `kind ${JSON.stringify(claim.kind)} is not one of ${KINDS.join(", ")}`);
      continue;
    }
    const kind = claim.kind;
    if (typeof claim.quote !== "string" || !trimQuoteEdges(claim.quote)) {
      drop(claim, t.fileName, "no_quote", "claim has no quote");
      continue;
    }
    const trimmed = trimQuoteEdges(claim.quote);
    const length = quoteLength(trimmed);
    if (length < MIN_QUOTE || length > MAX_QUOTE) {
      drop(claim, t.fileName, "quote_length", `quote has ${length} characters, allowed ${MIN_QUOTE}–${MAX_QUOTE}`);
      continue;
    }
    const hint = typeof claim.turnHint === "number" ? claim.turnHint : undefined;
    const hit = findQuote(trimmed, t.turns, REQUIRED_ROLE[kind], hint);
    if ("error" in hit) {
      const detail = hit.error === "wrong_speaker" ? `quote is said by the other side; this ${kind} claim needs the ${REQUIRED_ROLE[kind]}` : "quote does not appear word for word in any single turn";
      drop(claim, t.fileName, hit.error, detail);
      continue;
    }
    if (!kindFits(kind, hit.original, sentenceAround(hit.turn.text, hit.start, hit.end))) {
      const detail =
        kind === "next_step"
          ? "quote is not a next step: needs book, schedule, a calendar invite, a pilot, the contract or proposal, and no loss or “send me something” in the sentence"
          : "quote does not state a loss: needs “we'll pass”, “not moving forward”, “staying with” or similar";
      drop(claim, t.fileName, "kind_mismatch", detail);
      continue;
    }

    /** @type {Finding["response"]} */
    let response = null;
    if (kind === "objection" && claim.responseQuote !== undefined && claim.responseQuote !== null) {
      const rq = typeof claim.responseQuote === "string" ? trimQuoteEdges(claim.responseQuote) : "";
      const window = t.turns.filter((x) => x.index > hit.turn.index && x.index <= hit.turn.index + RESPONSE_WINDOW);
      const rl = quoteLength(rq);
      const r = rl >= MIN_QUOTE && rl <= MAX_QUOTE ? findQuote(rq, window, RESPONSE_ROLE) : null;
      if (r && !("error" in r)) response = { quote: r.original, turnIndex: r.turn.index, speaker: r.turn.speaker };
      else drop(claim, t.fileName, "response_not_found", `answer not found word for word in a seller turn within ${RESPONSE_WINDOW} turns after the objection; objection kept without answer`);
    }

    const key = `${t.id}|${kind}|${hit.turn.index}|${normalizeFull(hit.original).norm}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
      const old = /** @type {Finding} */ (findings[prev]);
      findings[prev] = makeFinding({
        id: old.id,
        transcript: t,
        kind,
        category: old.category === "other" ? cleanCategory(kind, claim.category) : old.category,
        turn: hit.turn,
        original: old.quote,
        source: old.source === "rule" || claim.source === "rule" ? "rule" : old.source,
        response: old.response ?? response,
      });
      continue;
    }
    seen.set(key, findings.length);
    findings.push(
      makeFinding({
        id: `f${findings.length + 1}`,
        transcript: t,
        kind,
        category: cleanCategory(kind, claim.category),
        turn: hit.turn,
        original: hit.original,
        source: claim.source,
        response,
      }),
    );
  }
  return { findings, dropped };
}
