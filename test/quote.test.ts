import { describe, expect, it } from "vitest";
import { findQuote, MAX_QUOTE, MIN_QUOTE, normalizeWithMap, trimQuoteEdges, verifyClaims } from "../public/lib/quote.js";
import type { Claim } from "../public/lib/types.js";
import { call, SAMPLE } from "./helpers";

const t = call(SAMPLE);
const claim = (quote: unknown, extra: Partial<Claim> = {}): Claim => ({ transcriptId: t.id, kind: "objection", category: "price", quote, source: "test", ...extra });

describe("normalizeWithMap", () => {
  it("lowercases, collapses whitespace incl. NBSP and unifies quotes", () => {
    const { norm, map } = normalizeWithMap("A  B’s “C”");
    expect(norm).toBe(`a b's "c"`);
    expect(map[0]).toBe(0);
    expect(map[2]).toBe(3);
  });

  it("does not touch dashes or inner ellipses", () => {
    expect(normalizeWithMap("a – b … c").norm).toBe("a – b … c");
  });
});

describe("trimQuoteEdges", () => {
  it("strips quotes, whitespace and ellipses only at the edges", () => {
    expect(trimQuoteEdges(' "…the price... is high..." ')).toBe("the price... is high");
  });
});

describe("findQuote", () => {
  it("matches across case, whitespace and apostrophe/quote variants", () => {
    const r = findQuote(`we're FINE with   "our current setup" for the moment`, t.turns, "buyer");
    expect(r).toMatchObject({ turn: { index: 3 } });
    if ("original" in r) expect(r.original).toBe("We’re fine with “our current setup” for the moment");
  });

  it("keeps the original spelling", () => {
    const r = findQuote("HONESTLY, THE PRICE IS TOO HIGH", t.turns, "buyer");
    expect("original" in r && r.original).toBe("Honestly, the price is too high");
  });

  it("rejects a changed word", () => {
    expect(findQuote("the price is far too high", t.turns, "buyer")).toEqual({ error: "not_in_transcript" });
  });

  it("rejects a partial word", () => {
    expect(findQuote("rice is too high", t.turns, "buyer")).toEqual({ error: "not_in_transcript" });
  });

  it("rejects a quote spanning two turns", () => {
    expect(findQuote("for us right now. Teams your size", t.turns, "buyer")).toEqual({ error: "not_in_transcript" });
  });

  it("reports wrong_speaker when only the other side said it", () => {
    expect(findQuote("calling from Relaywise", t.turns, "buyer")).toEqual({ error: "wrong_speaker" });
  });

  it("prefers the turn closest to the hint", () => {
    const twice = call("A (AE): hello there friend.\nB (Buyer): we need to think.\nA (AE): ok.\nB (Buyer): we need to think.");
    expect(findQuote("we need to think", twice.turns, "buyer", 3)).toMatchObject({ turn: { index: 3 } });
    expect(findQuote("we need to think", twice.turns, "buyer", 0)).toMatchObject({ turn: { index: 1 } });
  });
});

describe("verifyClaims", () => {
  it("turns a verbatim buyer quote into a finding with the original text", () => {
    const { findings, dropped } = verifyClaims([t], [claim("the price is too high for us")]);
    expect(dropped).toEqual([]);
    expect(findings[0]).toMatchObject({ kind: "objection", category: "price", quote: "the price is too high for us", turnIndex: 1, speaker: "Mark (Prospect)", role: "buyer" });
  });

  it("drops a seller sentence used as an objection with wrong_speaker", () => {
    expect(verifyClaims([t], [claim("I'm calling from Relaywise")]).dropped[0]?.reason).toBe("wrong_speaker");
  });

  it("drops too short and too long quotes with quote_length", () => {
    expect(verifyClaims([t], [claim("price".padEnd(MIN_QUOTE - 1, "x"))]).dropped[0]?.reason).toBe("quote_length");
    expect(verifyClaims([t], [claim("x".repeat(MAX_QUOTE + 1))]).dropped[0]?.reason).toBe("quote_length");
  });

  it("measures the length after collapsing whitespace", () => {
    expect(verifyClaims([t], [claim("the     price")]).dropped[0]?.reason).toBe("quote_length");
  });

  it("accepts a next step only if the original says one", () => {
    const ok = verifyClaims([t], [claim("Let's book a demo for next week", { kind: "next_step" })]);
    expect(ok.findings[0]?.kind).toBe("next_step");
    const bad = verifyClaims([t], [claim("the price is too high for us", { kind: "next_step" })]);
    expect(bad.findings).toEqual([]);
    expect(bad.dropped.map((d) => d.reason)).toEqual(["kind_mismatch"]);
  });

  it("rejects a next-step fragment from a sentence that is a loss or a 'send me something'", () => {
    const lossy = call("A (AE): We help teams with pricing.\nB (Buyer): Let's do a final check, but we'll pass for now.\nA (AE): ok.\nB (Buyer): Let's do this: send me something by email.");
    const { findings, dropped } = verifyClaims([lossy], [
      claim("Let's do a final check", { transcriptId: lossy.id, kind: "next_step" }),
      claim("Let's do this", { transcriptId: lossy.id, kind: "next_step" }),
    ]);
    expect(findings).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(["kind_mismatch", "kind_mismatch"]);
  });

  it("accepts a loss reason only if the original states a loss", () => {
    expect(verifyClaims([t], [claim("the price is too high for us", { kind: "loss_reason" })]).dropped[0]?.reason).toBe("kind_mismatch");
    const lost = call("A (AE): We help teams.\nB (Buyer): Thanks, but we'll pass for now.");
    expect(verifyClaims([lost], [claim("we'll pass for now", { transcriptId: lost.id, kind: "loss_reason" })]).findings[0]?.kind).toBe("loss_reason");
  });

  it("accepts a question only if its sentence ends with a question mark", () => {
    const q = call("A (AE): We help teams with pricing.\nB (Buyer): How long does onboarding take? Honestly that is too expensive.");
    const ok = verifyClaims([q], [claim("How long does onboarding take", { transcriptId: q.id, kind: "question", category: "other" })]);
    expect(ok.findings[0]?.kind).toBe("question");
    const bad = verifyClaims([q], [claim("that is too expensive", { transcriptId: q.id, kind: "question", category: "other" })]);
    expect(bad.findings).toEqual([]);
    expect(bad.dropped.map((d) => d.reason)).toEqual(["kind_mismatch"]);
    expect(bad.dropped[0]?.detail).toContain("not a question");
  });

  it("drops missing quotes, unknown kinds and unknown transcripts", () => {
    const { dropped } = verifyClaims([t], [claim(42), claim("the price is too high", { kind: "rumour" }), claim("the price is too high", { transcriptId: "nope" })]);
    expect(dropped.map((d) => d.reason)).toEqual(["no_quote", "unknown_kind", "unknown_transcript"]);
  });

  it("maps an unknown category to other", () => {
    expect(verifyClaims([t], [claim("the price is too high", { category: "vibes" })]).findings[0]?.category).toBe("other");
  });

  it("attaches a seller response within four turns", () => {
    const { findings } = verifyClaims([t], [claim("the price is too high for us", { responseQuote: "so it pays for itself" })]);
    expect(findings[0]?.response).toEqual({ quote: "so it pays for itself", turnIndex: 2, speaker: "Lena (AE)" });
  });

  it("keeps the objection but counts a missing response as dropped", () => {
    const { findings, dropped } = verifyClaims([t], [claim("the price is too high for us", { responseQuote: "we give it away for free" })]);
    expect(findings[0]?.response).toBeNull();
    expect(dropped.map((d) => d.reason)).toEqual(["response_not_found"]);
  });

  it("rejects a response from the buyer", () => {
    const { findings } = verifyClaims([t], [claim("the price is too high for us", { responseQuote: "Let's book a demo for next week" })]);
    expect(findings[0]?.response).toBeNull();
  });

  it("merges duplicates from rule and model without counting them as dropped", () => {
    const { findings, dropped } = verifyClaims([t], [claim("The price is too high", { source: "model" }), claim("the price is TOO high", { source: "rule" })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.source).toBe("rule");
    expect(dropped).toEqual([]);
  });
});
