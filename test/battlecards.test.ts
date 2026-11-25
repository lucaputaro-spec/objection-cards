import { describe, expect, it } from "vitest";
import { aiInput, buildReport, ledToNextStep, modelClaims } from "../public/lib/battlecards.js";

const file = (fileName: string, text: string) => ({ fileName, text });

const PROVEN = `A (AE): Hi, we help teams with pricing and a demo.
B (Buyer): Honestly, that is too expensive for us.
A (AE): It pays for itself within the first month.
B (Buyer): OK, let's book a pilot for Monday.`;

const RELAPSE = `A (AE): Hi, we help teams with pricing and a demo.
B (Buyer): Honestly, that is too expensive for us.
A (AE): It pays for itself within the first month.
B (Buyer): I still think the price is too high.
A (AE): We can talk about the contract length.
B (Buyer): OK, let's book a call next week.`;

const NO_STEP = `A (AE): Hi, we help teams with pricing and a demo.
B (Buyer): Honestly, the budget is not there this year.
A (AE): We offer a discount for annual contracts.
B (Buyer): Please send me something by email.`;

describe("ledToNextStep", () => {
  it("is true when a verified next step follows the answer", () => {
    const r = buildReport({ files: [file("a.txt", PROVEN)] });
    const objection = r.findings.find((f) => f.kind === "objection")!;
    expect(ledToNextStep(objection, r.findings)).toBe(true);
  });

  it("is false when the buyer raises the same objection again before the next step", () => {
    const r = buildReport({ files: [file("a.txt", RELAPSE)] });
    const first = r.findings.find((f) => f.kind === "objection")!;
    expect(first.turnIndex).toBe(1);
    expect(ledToNextStep(first, r.findings)).toBe(false);
  });
});

describe("loss rule", () => {
  it("does not prove an answer with a sentence that is also a loss", () => {
    const text = PROVEN.replace("OK, let's book a pilot for Monday.", "Let's do a final check, but we'll pass for now.");
    const r = buildReport({ files: [file("a.txt", text)] });
    expect(r.findings.some((f) => f.kind === "next_step")).toBe(false);
    expect(r.calls[0]?.outcome).toBe("lost");
    expect(r.cards.find((c) => c.category === "price")?.bestAnswer).toBeNull();
  });

  it("does not count a next step that is followed by a loss reason later in the call", () => {
    const r = buildReport({ files: [file("a.txt", `${PROVEN}\nA (AE): Great, I will send the invite.\nB (Buyer): Actually, we will pass after all.`)] });
    expect(r.findings.some((f) => f.kind === "next_step")).toBe(true);
    expect(r.cards.find((c) => c.category === "price")?.bestAnswer).toBeNull();
    expect(r.calls[0]).toMatchObject({ outcome: "lost", nextStep: null });
  });

  it("keeps a next step that comes after the loss reason", () => {
    const text = `A (AE): Hi, we help teams with pricing and a demo.\nB (Buyer): We will pass on the big plan.\nA (AE): Then start small, it pays for itself within the first month.\nB (Buyer): OK, let's book a pilot for Monday.`;
    const r = buildReport({ files: [file("a.txt", text)] });
    expect(r.calls[0]?.outcome).toBe("advanced");
  });
});

describe("file names", () => {
  it("makes duplicate file names unique so role overrides are not shared", () => {
    const overrides = { "a (2).txt": { "A (AE)": "buyer" as const, "B (Buyer)": "seller" as const } };
    const r = buildReport({ files: [file("a.txt", PROVEN), file("a.txt", PROVEN)], overrides });
    expect(r.transcripts.map((t) => t.fileName)).toEqual(["a.txt", "a (2).txt"]);
    expect(r.transcripts[0]?.roles["A (AE)"]).toBe("seller");
    expect(r.transcripts[1]?.roles["A (AE)"]).toBe("buyer");
  });
});

describe("cards", () => {
  const r = buildReport({ files: [file("b.txt", NO_STEP), file("a.txt", PROVEN), file("c.txt", RELAPSE)] });
  const price = r.cards.find((c) => c.category === "price")!;

  it("counts calls and mentions", () => {
    expect(price.calls).toBe(3);
    expect(price.mentions).toBe(4);
    expect(price.label).toBe("Price / budget");
  });

  it("picks the best answer by distance to the next step, then by file name", () => {
    expect(price.bestAnswer?.finding.fileName).toBe("a.txt");
    expect(price.otherProven.map((f) => [f.fileName, f.turnIndex])).toEqual([["c.txt", 3]]);
  });

  it("lists answers without a next step as counter-examples", () => {
    expect(price.counterExamples.map((f) => [f.fileName, f.turnIndex])).toEqual([["b.txt", 1], ["c.txt", 1]]);
  });

  it("sorts cards by number of calls, before the category order", () => {
    // risk steht in CATEGORIES nach price, kommt hier aber in mehr Gesprächen vor.
    const risk = (q: string) => `A (AE): Hi, we help teams with pricing and a demo.\nB (Buyer): ${q}\nA (AE): All data is hosted in Frankfurt.\nB (Buyer): Fine.`;
    const s = buildReport({ files: [file("p.txt", NO_STEP), file("r1.txt", risk("Our legal team worries about GDPR.")), file("r2.txt", risk("We have real concerns about security."))] });
    expect(s.cards.map((c) => [c.category, c.calls])).toEqual([["risk", 2], ["price", 1]]);
  });

  it("summarises each call", () => {
    expect(r.calls.map((c) => [c.fileName, c.outcome])).toEqual([["b.txt", "open"], ["a.txt", "advanced"], ["c.txt", "advanced"]]);
  });
});

describe("AI helpers", () => {
  const r = buildReport({ files: [file("a.txt", PROVEN)] });
  const t = r.transcripts[0]!;

  it("sends only role and text, no names and no file name", () => {
    const input = aiInput(t);
    expect(input.turns[0]).toEqual({ i: 0, role: "seller", text: "Hi, we help teams with pricing and a demo." });
    const body = JSON.stringify(input);
    expect(body).not.toContain("(AE)");
    expect(body).not.toContain("a.txt");
  });

  it("maps a Workers AI answer to unverified model claims and ignores the fallback", () => {
    const claims = modelClaims(t.id, { source: "Workers AI", claims: [{ kind: "objection", category: "price", turn: 1, quote: "too expensive for us", response_quote: "pays for itself" }] });
    expect(claims).toEqual([{ transcriptId: t.id, kind: "objection", category: "price", quote: "too expensive for us", turnHint: 1, responseQuote: "pays for itself", source: "model" }]);
    expect(modelClaims(t.id, { source: "Rule", note: "x", claims: [] })).toEqual([]);
  });
});
