// Einlesen (VTT, SRT, TXT), Rollen (Verkäufer/Käufer) und die Frage, ob ein
// Gespräch überhaupt ein Verkaufsgespräch ist. Übersprungene Gespräche
// bekommen einen festen englischen Grund, der so auf der Seite steht.

/**
 * @typedef {import("./types.js").Role} Role
 * @typedef {import("./types.js").Turn} Turn
 * @typedef {import("./types.js").Transcript} Transcript
 * @typedef {Record<string, Role>} RoleOverrides
 */

export const SKIP = Object.freeze({
  unsupported: "unsupported file type",
  oneSpeaker: "only one speaker",
  fewTurns: "fewer than 4 turns",
  internal: "every speaker is on the selling side (internal call)",
  unclear: "seller and buyer could not be told apart, set roles manually",
  noSignals: "fewer than 2 sales signals (pricing, demo, trial, budget, contract, proposal, next step, decision)",
});

const SELLER_LABEL = /\b(SDR|BDR|AE|Account Executive|Sales|Rep|Seller)\b/i;
const BUYER_LABEL = /\b(Prospect|Buyer|Customer|Client)\b/i;

export const SELLER_CUES = Object.freeze([
  "calling from",
  "reaching out",
  "our platform",
  "our product",
  "our software",
  "we help",
  "book a demo",
  "show you",
  "how are you currently",
]);

export const SALES_SIGNALS = Object.freeze([
  { id: "pricing", pattern: /\bpric(?:e|es|ing)\b/i },
  { id: "demo", pattern: /\bdemos?\b/i },
  { id: "trial", pattern: /\btrials?\b/i },
  { id: "budget", pattern: /\bbudgets?\b/i },
  { id: "contract", pattern: /\bcontracts?\b/i },
  { id: "proposal", pattern: /\bproposals?\b/i },
  { id: "next step", pattern: /\bnext steps?\b/i },
  { id: "decision", pattern: /\bdecisions?\b/i },
]);

const HEADER = /^===\s*(.+?)\s*===\s*$/;

/**
 * Trennt eingefügten Text an Zeilen "=== name ===".
 * @param {string} text
 * @returns {{ fileName: string, text: string }[]}
 */
export function splitPasted(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  /** @type {{ fileName: string, lines: string[] }[]} */
  const parts = [];
  /** @type {{ fileName: string, lines: string[] } | null} */
  let current = null;
  for (const line of lines) {
    const m = HEADER.exec(line);
    if (m) {
      current = { fileName: /** @type {string} */ (m[1]), lines: [] };
      parts.push(current);
      continue;
    }
    if (!current) {
      if (!line.trim()) continue;
      current = { fileName: "pasted-1.txt", lines: [] };
      parts.push(current);
    }
    current.lines.push(line);
  }
  return parts.map((p) => ({ fileName: p.fileName, text: p.lines.join("\n").trim() })).filter((p) => p.text);
}

/**
 * Macht Dateinamen eindeutig: der zweite "call.vtt" heißt "call (2).vtt".
 * Rollen-Overrides hängen am Dateinamen und werden so nicht geteilt.
 * @template {{ fileName: string }} F
 * @param {F[]} files
 * @returns {F[]}
 */
export function uniqueFileNames(files) {
  /** @type {Set<string>} */
  const used = new Set();
  return files.map((f) => {
    let name = f.fileName;
    if (used.has(name)) {
      const m = /^(.*?)(\.[a-z0-9]{1,5})?$/i.exec(f.fileName);
      const stem = m?.[1] ?? f.fileName;
      const ext = m?.[2] ?? "";
      for (let n = 2; used.has(name); n += 1) name = `${stem} (${n})${ext}`;
    }
    used.add(name);
    return name === f.fileName ? f : { ...f, fileName: name };
  });
}

/**
 * Format aus der Endung. Ohne Endung wird am Inhalt erkannt, eine fremde Endung ergibt null.
 * @param {string} fileName
 * @param {string} text
 * @returns {"vtt" | "srt" | "txt" | null}
 */
export function detectFormat(fileName, text) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase();
  if (ext === "vtt" || ext === "srt" || ext === "txt") return ext;
  if (ext) return null;
  const head = text.replace(/^﻿/, "").trimStart();
  if (head.startsWith("WEBVTT")) return "vtt";
  if (/^\d+\s*\n[^\n]*-->/.test(head)) return "srt";
  return "txt";
}

// "Name: text". Label bis 80 Zeichen, Kommas erlaubt ("Müller, Anna (ACME GmbH)").
// Damit ein Satz mit Doppelpunkt nicht als Sprecher gilt: außerhalb der Klammern
// höchstens 6 Wörter, und jedes beginnt groß, mit einer Ziffer oder ist ein
// Namenszusatz wie "von". "Here is the thing: …" ist deshalb kein Label.
const LABEL = /^(\p{L}[\p{L}\p{N} .,'’&()/-]{0,79}?)\s*:\s+(.*)$/u;
const NAME_PARTICLES = new Set(["von", "van", "de", "der", "den", "da", "di", "du", "del", "la", "le", "zu", "ten", "ter", "bin", "al", "of"]);
const NAME_WORD = /^[\p{Lu}\p{N}]/u;
const TXT_TIME = /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\]?\s+/;
const VOICE = /^<v(?:\.[^\s>]*)?\s+([^>]+)>(.*)$/;

/** @param {string} line @returns {{ speaker: string, text: string } | null} */
function splitLabel(line) {
  const m = LABEL.exec(line);
  if (!m) return null;
  const speaker = /** @type {string} */ (m[1]).trim();
  const outside = speaker.replace(/\([^()]*\)/g, " ");
  if (/[()]/.test(outside)) return null;
  const words = outside.split(/[\s,]+/).filter(Boolean);
  if (!words.length || words.length > 6) return null;
  if (!words.every((w) => NAME_WORD.test(w) || NAME_PARTICLES.has(w))) return null;
  return { speaker, text: /** @type {string} */ (m[2]) };
}

/** @param {string} s */
const stripTags = (s) => s.replace(/<[^>]*>/g, "");

/**
 * Hängt einen Abschnitt an. Gleicher Sprecher wie zuvor: zusammenfassen.
 * @param {{ speaker: string, text: string, start: string | null }[]} raw
 * @param {string | null} speaker null = kein Label, gehört zum vorigen Turn
 * @param {string} text
 * @param {string | null} start
 */
function push(raw, speaker, text, start) {
  const clean = text.trim();
  if (!clean) return;
  const last = raw[raw.length - 1];
  if (last && (speaker === null || speaker === last.speaker)) {
    last.text = `${last.text} ${clean}`;
    return;
  }
  raw.push({ speaker: speaker ?? "Unknown speaker", text: clean, start });
}

/**
 * Cue-Blöcke (VTT und SRT): Zeitzeile mit "-->", danach Textzeilen.
 * @param {string} text
 * @param {"vtt" | "srt"} format
 */
function parseCues(text, format) {
  /** @type {{ speaker: string, text: string, start: string | null }[]} */
  const raw = [];
  const blocks = text.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const timeAt = lines.findIndex((l) => l.includes("-->"));
    if (timeAt < 0) continue;
    if (format === "vtt" && /^(NOTE|STYLE|REGION)\b/.test(lines[0] ?? "")) continue;
    const start = (lines[timeAt] ?? "").split("-->")[0]?.trim() ?? null;
    for (const line of lines.slice(timeAt + 1)) {
      const voice = VOICE.exec(line);
      if (voice) {
        push(raw, /** @type {string} */ (voice[1]).trim(), stripTags(/** @type {string} */ (voice[2])), start);
        continue;
      }
      const plain = stripTags(line);
      const label = splitLabel(plain);
      if (label) push(raw, label.speaker, label.text, start);
      else push(raw, null, plain, start);
    }
  }
  return raw;
}

/** @param {string} text */
function parseTxt(text) {
  /** @type {{ speaker: string, text: string, start: string | null }[]} */
  const raw = [];
  for (const line0 of text.split("\n")) {
    let line = line0.trim();
    if (!line) continue;
    const time = TXT_TIME.exec(line);
    const start = time ? /** @type {string} */ (time[1]) : null;
    if (time) line = line.slice(time[0].length);
    const label = splitLabel(line);
    if (label) push(raw, label.speaker, label.text, start);
    else push(raw, null, line, start);
  }
  return raw;
}

/**
 * Liest ein Transkript. Rollen sind danach noch "unknown" (siehe applyRoles).
 * @param {string} id
 * @param {string} fileName
 * @param {string} text
 * @returns {Transcript}
 */
export function parseTranscript(id, fileName, text) {
  const format = detectFormat(fileName, text);
  const base = { id, fileName, roles: {}, roleBasis: {} };
  if (format === null) return { ...base, format: "txt", turns: [], skip: { reason: SKIP.unsupported } };
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const raw = format === "txt" ? parseTxt(clean) : parseCues(clean, format);
  /** @type {Turn[]} */
  const turns = raw.map((r, index) => ({ index, speaker: r.speaker, role: "unknown", text: r.text, start: r.start }));
  return { ...base, format, turns, skip: null };
}

/**
 * Rollen je Sprecher: manuell, dann Label in Klammern, dann Stichwort-Punkte.
 * @param {Turn[]} turns
 * @param {RoleOverrides} [overrides]
 * @returns {{ roles: Record<string, Role>, roleBasis: Record<string, "label" | "cues" | "manual"> }}
 */
export function assignRoles(turns, overrides = {}) {
  const speakers = [...new Set(turns.map((t) => t.speaker))];
  /** @type {Record<string, Role>} */
  const roles = {};
  /** @type {Record<string, "label" | "cues" | "manual">} */
  const roleBasis = {};
  /** @type {string[]} */
  const rest = [];
  for (const s of speakers) {
    const manual = overrides[s];
    if (manual === "seller" || manual === "buyer" || manual === "unknown") {
      roles[s] = manual;
      roleBasis[s] = "manual";
      continue;
    }
    const hint = [...s.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(" ");
    if (hint && SELLER_LABEL.test(hint)) {
      roles[s] = "seller";
      roleBasis[s] = "label";
    } else if (hint && BUYER_LABEL.test(hint)) {
      roles[s] = "buyer";
      roleBasis[s] = "label";
    } else rest.push(s);
  }
  if (rest.length) {
    const points = rest.map((s) => {
      const text = turns.filter((t) => t.speaker === s).map((t) => t.text.toLowerCase().replace(/[’‘]/g, "'")).join(" ");
      return SELLER_CUES.reduce((n, cue) => n + text.split(cue).length - 1, 0);
    });
    const max = Math.max(...points);
    const winners = points.filter((p) => p === max).length;
    rest.forEach((s, i) => {
      roles[s] = max === 0 || winners > 1 ? "unknown" : points[i] === max ? "seller" : "buyer";
      roleBasis[s] = "cues";
    });
  }
  return { roles, roleBasis };
}

/**
 * Setzt die Rollen in Transkript und Turns.
 * @param {Transcript} t
 * @param {RoleOverrides} [overrides]
 * @returns {Transcript}
 */
export function applyRoles(t, overrides) {
  const { roles, roleBasis } = assignRoles(t.turns, overrides);
  return { ...t, roles, roleBasis, turns: t.turns.map((turn) => ({ ...turn, role: roles[turn.speaker] ?? "unknown" })) };
}

/**
 * Ist das ein Verkaufsgespräch? null = ja, sonst der Grund fürs Überspringen.
 * @param {Transcript} t
 * @returns {null | { reason: string }}
 */
export function classifyCall(t) {
  if (t.skip) return t.skip;
  const speakers = Object.keys(t.roles).length ? Object.keys(t.roles) : [...new Set(t.turns.map((x) => x.speaker))];
  if (speakers.length < 2) return { reason: SKIP.oneSpeaker };
  if (t.turns.length < 4) return { reason: SKIP.fewTurns };
  const roles = speakers.map((s) => t.roles[s] ?? "unknown");
  if (roles.every((r) => r === "seller")) return { reason: SKIP.internal };
  if (!roles.includes("seller") || !roles.includes("buyer")) return { reason: SKIP.unclear };
  const all = t.turns.map((x) => x.text).join(" ");
  const signals = SALES_SIGNALS.filter((s) => s.pattern.test(all)).length;
  if (signals < 2) return { reason: SKIP.noSignals };
  return null;
}
