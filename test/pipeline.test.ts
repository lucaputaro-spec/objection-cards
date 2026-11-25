import { describe, expect, it } from "vitest";
import { buildReport, modelClaims } from "../public/lib/battlecards.js";
import { DEMO_TRANSCRIPTS, tamperClaims } from "../public/lib/demo.js";
import type { Report } from "../public/lib/types.js";
import { extract } from "../src/extract";

const files = [...DEMO_TRANSCRIPTS];
const report = buildReport({ files });
const card = (r: Report, category: string) => r.cards.find((c) => c.category === category);

function everyQuoteVerbatim(r: Report) {
  for (const f of r.findings) {
    const t = r.transcripts.find((x) => x.id === f.transcriptId)!;
    expect(t.turns[f.turnIndex]?.text).toContain(f.quote);
    if (f.response) expect(t.turns[f.response.turnIndex]?.text).toContain(f.response.quote);
  }
}

describe("pipeline with demo data, rules only", () => {
  it("skips only the internal call", () => {
    expect(report.skipped.map((s) => s.fileName)).toEqual(["demo-06-internal-pipeline-review.txt"]);
    expect(report.skipped[0]?.reason).toContain("internal call");
    expect(report.stats.analysed).toBe(5);
  });

  it("finds all six objection categories", () => {
    const cats = report.cards.map((c) => c.category);
    for (const c of ["price", "timing", "status_quo", "authority", "risk", "need"]) expect(cats).toContain(c);
  });

  it("takes the price answer from demo-01 and lists demo-04 as counter-example", () => {
    const price = card(report, "price")!;
    expect(price.bestAnswer?.finding.fileName).toBe("demo-01-northwind.vtt");
    expect(price.counterExamples.map((f) => f.fileName)).toContain("demo-04-harbor.txt");
  });

  it("leaves status quo unproven", () => {
    expect(card(report, "status_quo")?.bestAnswer).toBeNull();
  });

  it("drops nothing", () => {
    expect(report.stats.dropped).toBe(0);
  });

  it("quotes every finding word for word from its turn", () => {
    everyQuoteVerbatim(report);
  });
});

describe("pipeline with fabricated claims", () => {
  it("drops the three tampered claims and keeps them off the cards", () => {
    const first = report.transcripts.find((t) => !t.skip)!;
    const r = buildReport({ files, extraClaims: tamperClaims(first) });
    expect(r.stats.dropped).toBe(3);
    expect(r.stats.droppedBySource).toEqual({ rule: 0, model: 0, test: 3 });
    expect(JSON.stringify(r.cards)).not.toContain("pay double");
    everyQuoteVerbatim(r);
  });

  it("delivers an invented model quote from the worker, then verifyClaims drops it", async () => {
    const invented = "We would sign a three-year contract today.";
    const ai = { run: async () => ({ response: JSON.stringify({ claims: [{ kind: "objection", category: "price", turn: 1, quote: invented }] }) }) } as unknown as Ai;
    const first = report.transcripts.find((t) => !t.skip)!;
    const answer = await extract({ AI: ai, AI_MODEL: "m" }, { turns: [{ i: 1, role: "buyer", text: "x" }] });
    expect(answer).toMatchObject({ source: "Workers AI", claims: [{ quote: invented }] });

    const r = buildReport({ files, extraClaims: modelClaims(first.id, answer) });
    expect(r.dropped).toEqual([expect.objectContaining({ reason: "not_in_transcript", fileName: "demo-01-northwind.vtt" })]);
    expect(r.stats.droppedBySource.model).toBe(1);
    expect(JSON.stringify(r.findings)).not.toContain(invented);
  });

  it("drops an AI next_step on 'send me something' and keeps status quo unproven", () => {
    const kestrel = report.transcripts.find((t) => t.fileName === "demo-02-kestrel.srt")!;
    const quote = "Please just send me something by email and I will take a look.";
    const claims = modelClaims(kestrel.id, { source: "Workers AI", claims: [{ kind: "next_step", turn: 5, quote }] });
    const r = buildReport({ files, extraClaims: claims });
    expect(r.dropped.map((d) => d.reason)).toEqual(["kind_mismatch"]);
    expect(card(r, "status_quo")?.bestAnswer).toBeNull();
    everyQuoteVerbatim(r);
  });

  it("shows wrong_speaker for model claims after the roles are swapped", async () => {
    const quote = "Sounds interesting, but I need to check with our COO before we go further.";
    const orbit = report.transcripts.find((t) => t.fileName === "demo-03-orbit.txt")!;
    const claims = modelClaims(orbit.id, { source: "Workers AI", claims: [{ kind: "objection", category: "authority", turn: 7, quote }] });
    const swapped = buildReport({ files, overrides: { "demo-03-orbit.txt": { Maya: "buyer", Tom: "seller" } }, extraClaims: claims });
    expect(swapped.dropped.map((d) => d.reason)).toEqual(["wrong_speaker"]);
    expect(card(swapped, "authority")).toBeUndefined();
  });
});
