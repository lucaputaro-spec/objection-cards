import { describe, expect, it } from "vitest";
import { DEMO_NOTE, DEMO_TRANSCRIPTS, tamperClaims } from "../public/lib/demo.js";
import { verifyClaims } from "../public/lib/quote.js";
import { call } from "./helpers";

describe("demo data", () => {
  it("has six labelled demo files", () => {
    expect(DEMO_TRANSCRIPTS.map((d) => d.fileName)).toEqual([
      "demo-01-northwind.vtt",
      "demo-02-kestrel.srt",
      "demo-03-orbit.txt",
      "demo-04-harbor.txt",
      "demo-05-lumen.vtt",
      "demo-06-internal-pipeline-review.txt",
    ]);
    expect(DEMO_NOTE).toMatch(/^Demo data/);
  });

  it("uses only .example domains", () => {
    const all = DEMO_TRANSCRIPTS.map((d) => d.text).join("\n");
    const domains = all.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi)?.filter((d) => /[a-z]/i.test(d) && !/^\d/.test(d)) ?? [];
    expect(domains.length).toBeGreaterThan(0);
    for (const d of domains) expect(d).toMatch(/\.example$/);
  });
});

describe("tamperClaims", () => {
  it("produces three claims that are all dropped", () => {
    const first = DEMO_TRANSCRIPTS[0]!;
    const t = call(first.text, first.fileName);
    const claims = tamperClaims(t);
    expect(claims).toHaveLength(3);
    expect(claims.every((c) => c.source === "test")).toBe(true);
    const { findings, dropped } = verifyClaims([t], claims);
    expect(findings).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(["not_in_transcript", "wrong_speaker", "not_in_transcript"]);
  });
});
