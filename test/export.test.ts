import { describe, expect, it } from "vitest";
import { buildReport, UNPROVEN } from "../public/lib/battlecards.js";
import { DEMO_TRANSCRIPTS } from "../public/lib/demo.js";
import { toMarkdown } from "../public/lib/export.js";

const report = buildReport({ files: [...DEMO_TRANSCRIPTS] });
const md = toMarkdown(report, { date: "2026-11-24" });

describe("toMarkdown", () => {
  it("names source and date in the header", () => {
    expect(md).toContain("Source: Rules · 2026-11-24");
    expect(toMarkdown(report, { aiUsed: true, date: "2026-11-24" })).toContain("Source: Rules + Workers AI");
  });

  it("names on how many calls the AI actually ran", () => {
    expect(toMarkdown(report, { aiCalls: { used: 2, of: 5 }, date: "2026-11-24" })).toContain("Source: Rules + Workers AI on 2 of 5 calls · 2026-11-24");
    expect(toMarkdown(report, { aiCalls: { used: 0, of: 5 }, date: "2026-11-24" })).toContain("Source: Rules · 2026-11-24");
  });

  it("has a heading for every card", () => {
    for (const card of report.cards) expect(md).toContain(`## ${card.label}`);
  });

  it("quotes the best answer with its file and marks unproven cards", () => {
    const price = report.cards.find((c) => c.category === "price")!;
    expect(md).toContain(`> "${price.bestAnswer?.finding.response?.quote}"`);
    expect(md).toContain("Best answer (demo-01-northwind.vtt");
    expect(md).toContain(UNPROVEN);
  });

  it("has the closing sections", () => {
    for (const s of ["## How buyers describe the problem", "## Questions buyers ask", "## Why deals moved / were lost", "## Skipped", "Dropped claims: 0"]) {
      expect(md).toContain(s);
    }
    expect(md).toContain("demo-06-internal-pipeline-review.txt: every speaker is on the selling side (internal call)");
  });
});
