// Die Seite. Einzige Stelle, die lib/ aufruft. Regeln dazu:
// - Ergebnisse entstehen nur über buildReport(). Der ruft verifyClaims() selbst
//   auf, deshalb kommt keine Angabe ungeprüft auf eine Karte.
// - Gespeichert wird nichts, alles liegt nur im Speicher dieser Seite.
// - AI ist standardmäßig aus. Ist sie an: ein Aufruf pro Gespräch, nacheinander,
//   mit Grenzen pro Lauf und pro Sitzung. Fehler fallen auf die Regeln zurück.
// Inhalte werden nur als Text eingesetzt, nie als HTML.

import { aiStep, aiSummary } from "./lib/ai.js";
import { aiInput, buildReport, modelClaims, UNPROVEN } from "./lib/battlecards.js";
import { DEMO_NOTE, DEMO_TRANSCRIPTS, tamperClaims } from "./lib/demo.js";
import { toMarkdown } from "./lib/export.js";
import { splitPasted } from "./lib/parse.js";

const MAX_FILES = 8;
const MAX_FILE_BYTES = 300_000;
const MAX_AI_CALLS_PER_RUN = 8;
const MAX_AI_CALLS_PER_SESSION = 24;
const ROLES = ["seller", "buyer", "unknown"];
const SOURCE_LABEL = { rule: "rule", model: "AI", test: "test" };

const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "selected" || k === "open") el[k] = Boolean(v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false || kid === "") continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const bytes = (s) => new TextEncoder().encode(s).length;

/* ---------- Zustand, nur im Speicher ---------- */

let uploaded = [];
let demoLoaded = false;
let lastFiles = [];
let overrides = {};
let aiClaims = [];
let testClaims = [];
// Auf wie vielen der analysierten Gespräche die AI tatsächlich mitgelesen hat.
let aiCalls = { used: 0, of: 0 };
let aiCallsSession = 0;
let report = null;

function setNote(sel, text) {
  $(sel).textContent = text;
}

// Eingefügter Text plus hochgeladene Dateien, mit Grenzen für Anzahl und Größe.
function collectFiles() {
  const notes = [];
  const all = [...splitPasted($("#paste").value), ...uploaded];
  const sized = all.filter((f) => {
    if (bytes(f.text) <= MAX_FILE_BYTES) return true;
    notes.push(`${f.fileName} is larger than ${MAX_FILE_BYTES / 1000} KB and was left out.`);
    return false;
  });
  if (sized.length > MAX_FILES) notes.push(`Only the first ${MAX_FILES} transcripts are used.`);
  setNote("#input-note", notes.join(" "));
  return sized.slice(0, MAX_FILES);
}

function rebuild() {
  report = buildReport({ files: lastFiles, overrides, extraClaims: [...aiClaims, ...testClaims] });
}

/* ---------- AI (optional) ---------- */

async function runAi() {
  const analysed = report.transcripts.filter((t) => !t.skip);
  aiCalls = { used: 0, of: analysed.length };
  let calls = 0;
  const notes = [];
  for (const t of analysed) {
    if (calls >= MAX_AI_CALLS_PER_RUN || aiCallsSession >= MAX_AI_CALLS_PER_SESSION) {
      notes.push(`AI limit reached (${MAX_AI_CALLS_PER_RUN} calls per run, ${MAX_AI_CALLS_PER_SESSION} per session). Remaining calls use rules only.`);
      break;
    }
    calls += 1;
    aiCallsSession += 1;
    let res = null;
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(aiInput(t)),
      });
      res = { status: r.status, body: r.status === 200 ? await r.json() : null };
    } catch {
      res = null;
    }
    const step = aiStep(res);
    if (step === "use") {
      aiCalls.used += 1;
      aiClaims.push(...modelClaims(t.id, res.body));
      continue;
    }
    if (step === "skip") {
      notes.push(`${t.fileName}: AI skipped (HTTP ${res.status}), rules only.`);
      continue;
    }
    notes.push(aiCalls.used ? `AI stopped${res ? ` (HTTP ${res.status})` : ""}, remaining calls use rules only.` : "AI not available, rules only.");
    break;
  }
  const lead = aiCalls.used ? `${aiSummary(aiCalls)}. Its quotes went through the same check as the rules.` : "";
  setNote("#ai-note", [lead, ...notes].filter(Boolean).join(" "));
}

/* ---------- Aktionen ---------- */

async function build() {
  lastFiles = collectFiles();
  aiClaims = [];
  testClaims = [];
  aiCalls = { used: 0, of: 0 };
  setNote("#ai-note", "");
  if (!lastFiles.length) {
    report = null;
    setNote("#input-note", "Paste a transcript or upload a file first.");
    render();
    return;
  }
  rebuild();
  if ($("#use-ai").checked) {
    $("#build").disabled = true;
    setNote("#ai-note", "Asking Workers AI, one call at a time …");
    render();
    await runAi();
    $("#build").disabled = false;
    rebuild();
  }
  render();
}

async function tamper() {
  if (!report) await build();
  const first = report?.transcripts.find((t) => !t.skip);
  if (!first) {
    setNote("#input-note", "No analysed call to test with.");
    return;
  }
  testClaims = tamperClaims(first);
  rebuild();
  render();
  $("#dropped-details").open = true;
}

function loadDemo() {
  uploaded = DEMO_TRANSCRIPTS.map((d) => ({ fileName: d.fileName, text: d.text }));
  $("#paste").value = "";
  demoLoaded = true;
  overrides = {};
  setNote("#input-note", `${uploaded.length} demo transcripts loaded. Press “Build battlecards”.`);
  render();
}

function clearAll() {
  uploaded = [];
  demoLoaded = false;
  lastFiles = [];
  overrides = {};
  aiClaims = [];
  testClaims = [];
  aiCalls = { used: 0, of: 0 };
  report = null;
  $("#paste").value = "";
  $("#files").value = "";
  setNote("#input-note", "");
  setNote("#ai-note", "");
  render();
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function onFiles(event) {
  const notes = [];
  for (const file of event.target.files) {
    if (uploaded.length >= MAX_FILES) {
      notes.push(`At most ${MAX_FILES} files.`);
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      notes.push(`${file.name} is larger than ${MAX_FILE_BYTES / 1000} KB and was left out.`);
      continue;
    }
    try {
      uploaded.push({ fileName: file.name, text: await readFile(file) });
    } catch {
      notes.push(`${file.name} could not be read.`);
    }
  }
  event.target.value = "";
  setNote("#input-note", notes.join(" "));
  render();
}

// fileName kommt aus dem Bericht und ist dort eindeutig ("call (2).vtt"),
// gleichnamige Dateien teilen sich deshalb keine Overrides.
function setRole(fileName, speaker, role) {
  overrides = { ...overrides, [fileName]: { ...(overrides[fileName] ?? {}), [speaker]: role } };
  if (report) rebuild();
  render();
}

function markdown() {
  return report ? toMarkdown(report, { aiCalls }) : "";
}

function download() {
  if (!report) return setNote("#export-note", "Build the battlecards first.");
  const url = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
  const a = h("a", { href: url, download: "battlecards.md" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setNote("#export-note", "battlecards.md downloaded.");
}

async function copy() {
  if (!report) return setNote("#export-note", "Build the battlecards first.");
  try {
    await navigator.clipboard.writeText(markdown());
    setNote("#export-note", "Markdown copied.");
  } catch {
    setNote("#export-note", "Copy was blocked by the browser. Use Download instead.");
  }
}

/* ---------- Darstellung ---------- */

function renderFiles() {
  const list = $("#file-list");
  list.replaceChildren(...uploaded.map((f) => h("li", null, f.fileName)));
  const note = $("#demo-note");
  note.textContent = DEMO_NOTE;
  note.hidden = !demoLoaded;
}

function renderCalls() {
  const table = $("#calls");
  if (!report) {
    table.replaceChildren(h("tbody", null, h("tr", null, h("td", { class: "hint" }, "No calls yet. Load the demo or add transcripts, then build."))));
    return;
  }
  const head = h("thead", null, h("tr", null, h("th", null, "File"), h("th", null, "Format"), h("th", null, "Roles"), h("th", null, "Status")));
  const rows = report.transcripts.map((t) => {
    const roles = Object.keys(t.roles).map((speaker) => {
      const id = `role-${t.id}-${speaker}`;
      const select = h(
        "select",
        { id, onchange: (e) => setRole(t.fileName, speaker, e.target.value) },
        ROLES.map((r) => h("option", { value: r, selected: t.roles[speaker] === r }, r)),
      );
      return h("label", { for: id }, speaker, select, h("span", { class: "hint" }, `(${t.roleBasis[speaker]})`));
    });
    const status = t.skip ? h("span", { class: "status-skip" }, `Skipped because ${t.skip.reason}`) : h("span", { class: "status-ok" }, "Analysed");
    return h("tr", null, h("td", null, t.fileName), h("td", null, t.format), h("td", null, h("div", { class: "roles" }, roles.length ? roles : "–")), h("td", null, status));
  });
  table.replaceChildren(head, h("tbody", null, rows));
}

function renderCheck() {
  const s = report?.stats;
  const by = s?.droppedBySource ?? {};
  $("#counter").textContent = `Findings ${s?.findings ?? 0} · Dropped ${s?.dropped ?? 0} (rule ${by.rule ?? 0}, AI ${by.model ?? 0}, test ${by.test ?? 0})`;
  const box = $("#dropped");
  if (!report || !report.dropped.length) {
    box.replaceChildren(h("p", { class: "hint" }, "Nothing dropped."));
    return;
  }
  const head = h("thead", null, h("tr", null, ["File", "Source", "Reason", "Detail", "Claimed quote"].map((x) => h("th", null, x))));
  const rows = report.dropped.map((d) =>
    h(
      "tr",
      null,
      h("td", null, d.fileName || "–"),
      h("td", null, SOURCE_LABEL[d.claim.source] ?? d.claim.source),
      h("td", { class: "bad" }, d.reason),
      h("td", null, d.detail),
      h("td", null, typeof d.claim.quote === "string" ? `“${d.claim.quote}”` : "–"),
    ),
  );
  box.replaceChildren(h("table", null, head, h("tbody", null, rows)));
}

const quoteItem = (text, fileName) => h("li", null, `“${text}” `, h("span", { class: "src" }, fileName));

function renderCards() {
  const box = $("#cards");
  if (!report) return box.replaceChildren();
  const total = report.stats.analysed;
  const cards = report.cards.map((c) => {
    const best = c.bestAnswer?.finding.response
      ? [
          h("h4", null, "Best answer"),
          h("blockquote", null, `“${c.bestAnswer.finding.response.quote}”`),
          h("p", { class: "src" }, `${c.bestAnswer.finding.fileName} · next step: “${c.bestAnswer.nextStep.quote}”`),
        ]
      : [h("p", { class: "unproven" }, UNPROVEN)];
    return h(
      "article",
      { class: "battlecard" },
      h("h3", null, c.label),
      h("p", { class: "freq" }, `Raised in ${c.calls} of ${total} calls · ${c.mentions} ${c.mentions === 1 ? "mention" : "mentions"}`),
      best,
      h("h4", null, "What buyers said"),
      h("ul", null, c.examples.map((f) => quoteItem(f.quote, f.fileName))),
      c.otherProven.length ? [h("h4", null, "Other answers that led to a next step"), h("ul", null, c.otherProven.map((f) => quoteItem(f.response?.quote ?? "", f.fileName)))] : null,
      c.counterExamples.length
        ? [h("h4", null, "Counter-examples (answered, no next step followed)"), h("ul", null, c.counterExamples.map((f) => quoteItem(f.response?.quote ?? "", f.fileName)))]
        : null,
    );
  });
  box.replaceChildren(...(cards.length ? cards : [h("p", { class: "card hint" }, "No objections found in the analysed calls.")]));
}

function renderInsights() {
  const box = $("#insights-body");
  if (!report) return box.replaceChildren(h("p", { class: "hint" }, "Build the battlecards to see problems, questions and outcomes."));
  const list = (items, map) => (items.length ? h("ul", null, items.map(map)) : h("p", { class: "hint" }, "None found."));
  box.replaceChildren(
    h("h3", null, "How buyers describe the problem"),
    list([...report.problems, ...report.outcomes], (f) => quoteItem(f.quote, f.fileName)),
    h("h3", null, "Questions buyers ask"),
    list(report.questions, (f) => h("li", null, `“${f.quote}” `, h("span", { class: "src" }, `${f.category} · ${f.fileName}`))),
    h("h3", null, "Why deals moved / were lost"),
    list(report.calls, (c) => h("li", null, `${c.fileName}: ${c.outcome}`, c.nextStep ? ` (next step: “${c.nextStep.quote}”)` : "")),
    list([...report.reasons.won, ...report.reasons.lost], (f) =>
      h("li", null, `${f.kind === "win_reason" ? "Moved" : "Lost"}: “${f.quote}” `, h("span", { class: "src" }, f.fileName)),
    ),
  );
}

function render() {
  renderFiles();
  renderCalls();
  renderCheck();
  renderCards();
  renderInsights();
}

$("#load-demo").addEventListener("click", loadDemo);
$("#clear").addEventListener("click", clearAll);
$("#build").addEventListener("click", build);
$("#tamper").addEventListener("click", tamper);
$("#files").addEventListener("change", onFiles);
$("#download").addEventListener("click", download);
$("#copy").addEventListener("click", copy);
$("#print").addEventListener("click", () => window.print());
render();
