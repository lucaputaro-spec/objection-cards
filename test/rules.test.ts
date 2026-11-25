import { describe, expect, it } from "vitest";
import { verifyClaims } from "../public/lib/quote.js";
import { CATEGORIES, extractByRules, NEXT_STEP, objectionCategory, questionTopic, splitSentences } from "../public/lib/rules.js";
import { call, SAMPLE } from "./helpers";

describe("splitSentences", () => {
  it("splits at . ! ? and keeps the original spelling", () => {
    expect(splitSentences("It costs 4.50 per Seat. Really? Yes!")).toEqual(["It costs 4.50 per Seat.", "Really?", "Yes!"]);
  });
});

describe("categories", () => {
  it("has the fixed list with labels", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(["price", "timing", "status_quo", "authority", "need", "risk", "other"]);
  });

  it("recognises typical objections", () => {
    expect(objectionCategory("That is too expensive for us.")).toBe("price");
    expect(objectionCategory("Let's revisit this next quarter.")).toBe("timing");
    expect(objectionCategory("We already use a spreadsheet for that.")).toBe("status_quo");
    expect(objectionCategory("I have to check with my boss first.")).toBe("authority");
    expect(objectionCategory("It is not a priority this year.")).toBe("need");
    expect(objectionCategory("Our DPO will ask about GDPR.")).toBe("risk");
    expect(objectionCategory("The weather is nice today.")).toBeNull();
  });

  it("sorts questions by topic", () => {
    expect(questionTopic("What is the price per seat?")).toBe("pricing");
    expect(questionTopic("Does it integrate with our CRM?")).toBe("integration");
    expect(questionTopic("Where is the data hosted?")).toBe("security");
    expect(questionTopic("How long does onboarding take?")).toBe("onboarding");
    expect(questionTopic("Who else uses it?")).toBe("other");
  });

  it("does not count 'send me something' as a next step", () => {
    expect(NEXT_STEP.test("Just send me something.")).toBe(false);
    expect(NEXT_STEP.test("Please send over the contract.")).toBe(true);
  });
});

describe("extractByRules", () => {
  const t = call(SAMPLE);
  const claims = extractByRules(t);

  it("only reads buyer sentences", () => {
    expect(claims.every((c) => typeof c.quote === "string" && !c.quote.includes("calling from"))).toBe(true);
  });

  it("finds objections with the next seller answer", () => {
    const price = claims.find((c) => c.kind === "objection" && c.category === "price");
    expect(price?.quote).toBe("Honestly, the price is too high for us right now.");
    expect(price?.responseQuote).toBe("Teams your size save ten hours a week, so it pays for itself.");
    expect(claims.find((c) => c.kind === "objection" && c.category === "status_quo")).toBeTruthy();
  });

  it("finds next steps", () => {
    expect(claims.filter((c) => c.kind === "next_step").map((c) => c.quote)).toEqual(["Let's book a demo for next week."]);
  });

  it("treats a sentence that hits LOSS and NEXT_STEP as a loss only", () => {
    const both = extractByRules(call("A (AE): We help teams with pricing.\nB (Buyer): Let's do a final check, but we'll pass for now."));
    expect(both.map((c) => c.kind)).toEqual(["loss_reason"]);
  });

  it("produces claims that all pass verifyClaims", () => {
    expect(verifyClaims([t], claims).dropped).toEqual([]);
  });

  it("turns buyer questions into question claims", () => {
    const q = extractByRules(call("A (AE): Hello there, we help teams.\nB (Buyer): How long does onboarding take?"));
    expect(q).toEqual([expect.objectContaining({ kind: "question", category: "onboarding" })]);
  });
});
