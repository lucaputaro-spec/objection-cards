import { describe, expect, it } from "vitest";
import { applyRoles, assignRoles, classifyCall, detectFormat, parseTranscript, SKIP, splitPasted } from "../public/lib/parse.js";
import type { Transcript } from "../public/lib/types.js";
import { call, SAMPLE } from "./helpers";

const classify = (t: Transcript) => classifyCall(t)?.reason ?? null;

describe("splitPasted", () => {
  it("splits at === name === lines", () => {
    expect(splitPasted("=== a.txt ===\nA: hi\n=== b.vtt ===\nWEBVTT")).toEqual([
      { fileName: "a.txt", text: "A: hi" },
      { fileName: "b.vtt", text: "WEBVTT" },
    ]);
  });

  it("names a paste without header pasted-1.txt", () => {
    expect(splitPasted("A: hi\nB: ho")).toEqual([{ fileName: "pasted-1.txt", text: "A: hi\nB: ho" }]);
  });
});

describe("detectFormat", () => {
  it("uses the extension, sniffs without one and refuses others", () => {
    expect(detectFormat("x.VTT", "")).toBe("vtt");
    expect(detectFormat("call a", "WEBVTT\n\n")).toBe("vtt");
    expect(detectFormat("call b", "1\n00:00:01,000 --> 00:00:02,000\nA: hi")).toBe("srt");
    expect(detectFormat("notes.docx", "A: hi")).toBeNull();
  });

  it("skips an unsupported file type", () => {
    expect(parseTranscript("c", "notes.pdf", "A: hi").skip).toEqual({ reason: SKIP.unsupported });
  });
});

describe("parseTranscript", () => {
  it("reads VTT voice tags and merges cues of the same speaker", () => {
    const t = parseTranscript("c", "a.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Lena (AE)>Hello there.\n\n00:00:02.000 --> 00:00:03.000\n<v Lena (AE)>Second part.\n\n00:00:03.000 --> 00:00:04.000\n<v Mark>Hi <b>Lena</b>.");
    expect(t.format).toBe("vtt");
    expect(t.turns.map((x) => [x.speaker, x.text, x.start])).toEqual([
      ["Lena (AE)", "Hello there. Second part.", "00:00:01.000"],
      ["Mark", "Hi Lena.", "00:00:03.000"],
    ]);
  });

  it("reads VTT with Name: labels and cue ids", () => {
    const t = parseTranscript("c", "a.vtt", "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nNina (Sales): Hi Ben.\n\n2\n00:00:02.000 --> 00:00:03.000\nBen: Hi Nina.");
    expect(t.turns.map((x) => x.speaker)).toEqual(["Nina (Sales)", "Ben"]);
  });

  it("reads SRT", () => {
    const t = parseTranscript("c", "a.srt", "1\n00:00:01,000 --> 00:00:02,000\nSam (SDR): Hi Kim.\n\n2\n00:00:02,000 --> 00:00:03,000\nKim: Hi Sam.\nStill Kim here.");
    expect(t.turns.map((x) => [x.speaker, x.text, x.start])).toEqual([
      ["Sam (SDR)", "Hi Kim.", "00:00:01,000"],
      ["Kim", "Hi Sam. Still Kim here.", "00:00:02,000"],
    ]);
  });

  it("reads TXT with and without timestamps; unlabelled lines join the previous turn", () => {
    const t = parseTranscript("c", "a.txt", "[00:01] Maya: Hi Tom.\ncontinued line\nTom: Hello.\n[01:02:03] Tom: More.");
    expect(t.turns.map((x) => [x.speaker, x.text, x.start])).toEqual([
      ["Maya", "Hi Tom. continued line", "00:01"],
      ["Tom", "Hello. More.", null],
    ]);
  });
});

describe("speaker labels", () => {
  const speakers = (text: string) => parseTranscript("c", "a.txt", text).turns.map((x) => x.speaker);

  it("reads long labels with commas from Zoom and Teams exports", () => {
    expect(speakers("[00:01:02] Anna Müller: Hi there.\nMüller, Anna (ACME GmbH): Hello.\nDr. Müller (Account Executive, ACME GmbH): We help teams.")).toEqual([
      "Anna Müller",
      "Müller, Anna (ACME GmbH)",
      "Dr. Müller (Account Executive, ACME GmbH)",
    ]);
    expect(speakers("Anna-Lena von der Heide (Senior Account Executive, Relaywise Europe GmbH): Hi.\nB: ok.")[0]).toBe("Anna-Lena von der Heide (Senior Account Executive, Relaywise Europe GmbH)");
  });

  it("assigns the role from a long label hint", () => {
    expect(call("Dr. Müller (Account Executive, ACME GmbH): Hi.\nKim (Customer): Hi.").roles["Dr. Müller (Account Executive, ACME GmbH)"]).toBe("seller");
  });

  it("does not treat sentences with a colon as labels", () => {
    expect(speakers("Kim: Hi.\nHere is the thing: we need it.\nWe tried it, but honestly: no.\nThe plan: start small.")).toEqual(["Kim"]);
  });

  it("refuses labels longer than 80 characters", () => {
    expect(speakers(`Kim: Hi.\nA${"b".repeat(85)}: text`)).toEqual(["Kim"]);
  });
});

describe("assignRoles", () => {
  it("reads role hints from labels", () => {
    expect(call(SAMPLE).roles).toEqual({ "Lena (AE)": "seller", "Mark (Prospect)": "buyer" });
    expect(call(SAMPLE).roleBasis).toEqual({ "Lena (AE)": "label", "Mark (Prospect)": "label" });
  });

  it("falls back to seller cue points", () => {
    const t = parseTranscript("c", "a.txt", "Maya: Hi, calling from Relaywise, we help teams.\nTom: Sure, go on.\nMaya: How are you currently planning?\nTom: By hand.");
    expect(assignRoles(t.turns)).toEqual({ roles: { Maya: "seller", Tom: "buyer" }, roleBasis: { Maya: "cues", Tom: "cues" } });
  });

  it("leaves everyone unknown on a tie or zero points", () => {
    const t = parseTranscript("c", "a.txt", "A: hello.\nB: hello.");
    expect(assignRoles(t.turns).roles).toEqual({ A: "unknown", B: "unknown" });
  });

  it("lets a manual override beat the label", () => {
    const t = parseTranscript("c", "a.txt", SAMPLE);
    const r = assignRoles(t.turns, { "Lena (AE)": "buyer", "Mark (Prospect)": "seller" });
    expect(r.roles).toEqual({ "Lena (AE)": "buyer", "Mark (Prospect)": "seller" });
    expect(r.roleBasis["Lena (AE)"]).toBe("manual");
  });
});

describe("classifyCall", () => {
  const sales = "Let's talk pricing and a demo.";
  it("analyses a normal sales call", () => {
    expect(classify(call(`A (AE): ${sales}\nB (Buyer): ok.\nA (AE): fine.\nB (Buyer): sure.`))).toBeNull();
  });
  it("skips a call with only one speaker", () => {
    expect(classify(call("Just one long monologue about pricing and a demo.\nwithout any labels."))).toBe(SKIP.oneSpeaker);
  });
  it("skips fewer than 4 turns", () => {
    expect(classify(call(`A (AE): ${sales}\nB (Buyer): ok.\nA (AE): fine.`))).toBe(SKIP.fewTurns);
  });
  it("skips an internal call", () => {
    expect(classify(call(`A (SDR): ${sales}\nB (Sales Manager): ok.\nA (SDR): fine.\nB (Sales Manager): sure.`))).toBe(SKIP.internal);
  });
  it("skips when roles are unclear", () => {
    expect(classify(call(`A: ${sales}\nB: ok.\nA: fine.\nB: sure.`))).toBe(SKIP.unclear);
  });
  it("skips without two sales signals", () => {
    expect(classify(call("A (AE): How was the weekend?\nB (Buyer): Good.\nA (AE): Nice.\nB (Buyer): Yes."))).toBe(SKIP.noSignals);
  });
  it("re-applies roles with overrides", () => {
    const t = applyRoles(parseTranscript("c", "a.txt", `A: ${sales}\nB: ok.\nA: fine.\nB: sure.`), { A: "seller", B: "buyer" });
    expect(classify(t)).toBeNull();
    expect(t.turns[1]?.role).toBe("buyer");
  });
});
