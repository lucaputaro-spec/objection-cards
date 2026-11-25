import { describe, expect, it } from "vitest";
import { aiStep, aiSummary } from "../public/lib/ai.js";

describe("aiStep", () => {
  it("uses a Workers AI answer", () => {
    expect(aiStep({ status: 200, body: { source: "Workers AI", claims: [] } })).toBe("use");
  });

  it("skips only this call on 413 and 400", () => {
    expect(aiStep({ status: 413 })).toBe("skip");
    expect(aiStep({ status: 400 })).toBe("skip");
  });

  it("stops on 429, 5xx, 404, network errors and the rule fallback", () => {
    for (const status of [429, 500, 503, 404]) expect(aiStep({ status })).toBe("stop");
    expect(aiStep(null)).toBe("stop");
    expect(aiStep({ status: 200, body: { source: "Rule", claims: [] } })).toBe("stop");
  });
});

describe("aiSummary", () => {
  it("says on how many calls the AI ran", () => {
    expect(aiSummary({ used: 2, of: 5 })).toBe("Workers AI on 2 of 5 calls");
    expect(aiSummary({ used: 1, of: 1 })).toBe("Workers AI on 1 of 1 call");
    expect(aiSummary({ used: 0, of: 5 })).toBe("rules only");
  });
});
