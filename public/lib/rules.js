// Regel-Extraktor: der vollwertige Weg ohne AI. Durchsucht nur Käufer-Sätze,
// der Satz selbst ist das Zitat. Auch diese Claims laufen durch verifyClaims(),
// es gibt keinen Sonderweg für Regeln.

import { MAX_QUOTE, MIN_QUOTE, quoteLength, RESPONSE_WINDOW } from "./quote.js";

/**
 * @typedef {import("./types.js").Claim} Claim
 * @typedef {import("./types.js").Kind} Kind
 * @typedef {import("./types.js").Transcript} Transcript
 * @typedef {{ id: string, label: string, pattern: RegExp | null }} Category
 */

// Einzige Quelle für die Einwand-Kategorien. Reihenfolge = Prüfreihenfolge.
/** @type {readonly Category[]} */
export const CATEGORIES = Object.freeze([
  { id: "price", label: "Price / budget", pattern: /\b(too expensive|expensive|pricey|price|pricing|costs?|costly|budget|afford|cheaper)\b/i },
  { id: "timing", label: "Timing", pattern: /\b(next quarter|next year|next month|not right now|not now|the timing|bad timing|bad time|too busy|later this year|in a few months|revisit (this|it))\b/i },
  {
    id: "status_quo",
    label: "Already have something",
    pattern: /\b(already (use|using|have|has|work with|working with)|our current (vendor|provider|tool|system|setup|solution|process)|happy with (our|what we)|stick(ing)? with|built (it|our own|something) in-house|spreadsheets? (work|works|do the job))\b/i,
  },
  { id: "authority", label: "Not the decision maker", pattern: /\b(check with|run (it|this) (by|past)|not (my|the) (call|decision)|decision[- ]makers?|sign[- ]off|needs? (approval|to approve)|loop in)\b/i },
  { id: "need", label: "No need / not a priority", pattern: /\b(not a priority|not a top priority|no need|(don't|do not) (really )?need|nice to have|not urgent|works? fine (for us|as it is))\b/i },
  { id: "risk", label: "Risk / security / trust", pattern: /\b(security|secure|gdpr|dsgvo|data protection|compliance|compliant|privacy|soc ?2|iso ?27001|risky|lock[- ]in|trust)\b/i },
  { id: "other", label: "Other", pattern: null },
]);

export const QUESTION_TOPICS = Object.freeze(["pricing", "integration", "security", "onboarding", "other"]);

/** @type {readonly { id: string, pattern: RegExp }[]} */
const TOPIC_PATTERNS = Object.freeze([
  { id: "pricing", pattern: /\b(pric\w*|costs?|per seat|seats?|budget|discount|plans?|invoice)\b/i },
  { id: "integration", pattern: /\b(integrat\w*|api|connect\w*|sync\w*|import|export|crm|erp)\b/i },
  { id: "security", pattern: /\b(secur\w*|gdpr|dsgvo|data|privacy|hosted|hosting|soc ?2)\b/i },
  { id: "onboarding", pattern: /\b(onboard\w*|set ?up|setup|training|implement\w*|roll ?out|go live|how long)\b/i },
]);

export const PROBLEM = /\b(struggl\w*|problems?|pain|frustrat\w*|wast(e|es|ed|ing)|takes? (us )?(forever|hours|too long)|manually|by hand|chaos|mess|keep (losing|missing))\b/i;
export const OUTCOME = /\b(we want to|we'd like to|we would like to|our goal|goal is|trying to|hoping to|looking to|would love to|save (us )?(time|hours|money))\b/i;
export const WIN = /\b(that'?s (exactly )?what we need|makes sense|sounds good|that works for (us|me)|that helps|great fit|convinced|i like (that|this))\b/i;
export const LOSS = /\b(we'?ll pass|we will pass|not moving forward|won'?t move forward|go(ing)? with (another|a different) (vendor|provider|tool)|staying with|decided against|not for us)\b/i;
// "send me something" ist ausdrücklich kein nächster Schritt.
export const NEXT_STEP = /\b(book|schedule|calendar invite|set up a pilot|send (over )?the (contract|proposal)|let'?s do)\b/i;
export const NOT_NEXT_STEP = /\bsend (me|us) something\b/i;

/**
 * Trennt an . ! ? mit folgendem Leerraum. Gibt die Sätze in Originalschreibweise zurück.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @param {string} s */
const plain = (s) => s.replace(/[’‘]/g, "'");

/**
 * Ein Satz ist ein nächster Schritt, wenn NEXT_STEP trifft und weder der
 * Ausschluss ("send me something") noch LOSS. "Let's do a final check, but
 * we'll pass" ist damit ein Verlust, kein nächster Schritt.
 * @param {string} sentence
 */
export function isNextStep(sentence) {
  const s = plain(sentence);
  return NEXT_STEP.test(s) && !NOT_NEXT_STEP.test(s) && !LOSS.test(s);
}

/**
 * Passt ein geprüftes Zitat zu seiner Art? next_step, loss_reason und
 * question haben eine Bedingung, alle anderen Arten passen immer. Eine Frage
 * muss in einem Satz stehen, der mit „?“ endet — „that is too expensive“ ist
 * keine Frage, auch wenn die AI es so nennt.
 * @param {Kind} kind
 * @param {string} quote das Original aus dem Transkript
 * @param {string} sentence der Satz bzw. die Sätze, in denen das Zitat steht
 */
export function kindFits(kind, quote, sentence) {
  if (kind === "next_step") return NEXT_STEP.test(plain(quote)) && isNextStep(sentence);
  if (kind === "loss_reason") return LOSS.test(plain(quote));
  if (kind === "question") return /\?["'”’)]*\s*$/.test(sentence);
  return true;
}

/** @param {string} sentence */
export function objectionCategory(sentence) {
  const s = plain(sentence);
  return CATEGORIES.find((c) => c.pattern && c.pattern.test(s))?.id ?? null;
}

/** @param {string} sentence */
export function questionTopic(sentence) {
  const s = plain(sentence);
  return TOPIC_PATTERNS.find((t) => t.pattern.test(s))?.id ?? "other";
}

/**
 * Anfang eines Verkäufer-Turns, an einer Satzgrenze, höchstens MAX_QUOTE Zeichen.
 * @param {string} text
 */
function leadingSentences(text) {
  let out = "";
  for (const s of splitSentences(text)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > MAX_QUOTE) break;
    out = next;
  }
  return out;
}

/**
 * Claims aus Käufer-Sätzen.
 * @param {Transcript} t
 * @returns {Claim[]}
 */
export function extractByRules(t) {
  /** @type {Claim[]} */
  const claims = [];
  for (const turn of t.turns) {
    if (turn.role !== "buyer") continue;
    for (const sentence of splitSentences(turn.text)) {
      const len = quoteLength(sentence);
      if (len < MIN_QUOTE || len > MAX_QUOTE) continue;
      /** @param {Kind} kind @param {string} [category] @param {string} [responseQuote] */
      const add = (kind, category, responseQuote) =>
        claims.push({ transcriptId: t.id, kind, category, quote: sentence, turnHint: turn.index, responseQuote, source: "rule" });

      if (sentence.endsWith("?")) {
        add("question", questionTopic(sentence));
        continue;
      }
      const s = plain(sentence);
      const nextStep = isNextStep(s);
      const win = WIN.test(s);
      if (LOSS.test(s)) add("loss_reason", objectionCategory(s) ?? "other");
      else if (!nextStep && !win) {
        const category = objectionCategory(s);
        if (category) {
          const reply = t.turns.find((x) => x.index > turn.index && x.role === "seller");
          const answer = reply && reply.index <= turn.index + RESPONSE_WINDOW ? leadingSentences(reply.text) : "";
          add("objection", category, quoteLength(answer) >= MIN_QUOTE ? answer : undefined);
        }
      }
      if (nextStep) add("next_step");
      if (win) add("win_reason");
      if (PROBLEM.test(s)) add("problem");
      if (OUTCOME.test(s)) add("outcome");
    }
  }
  return claims;
}
