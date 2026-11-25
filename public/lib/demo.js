// Demo-Daten: sechs erfundene Gespräche. Der Verkäufer ist die erfundene Firma
// Relaywise (Dispatch-Software), alle Domains enden auf .example. Dazu
// tamperClaims(), der Beweis per Knopf, dass erfundene Zitate durchfallen.

import { extractByRules, splitSentences } from "./rules.js";
import { MIN_QUOTE } from "./quote.js";

/**
 * @typedef {import("./types.js").Claim} Claim
 * @typedef {import("./types.js").Transcript} Transcript
 */

export const DEMO_NOTE = "Demo data: invented conversations and companies, no real outcomes";

/** @type {readonly { fileName: string, text: string }[]} */
export const DEMO_TRANSCRIPTS = Object.freeze([
  {
    fileName: "demo-01-northwind.vtt",
    text: `WEBVTT

00:00:01.000 --> 00:00:06.000
<v Lena (AE)>Hi Mark, thanks for making time. I'm Lena from Relaywise, relaywise.example.

00:00:06.000 --> 00:00:12.000
<v Mark (Prospect)>Sure. Our dispatchers plan routes by hand every morning and it takes hours.

00:00:12.000 --> 00:00:15.000
<v Lena (AE)>How are you currently assigning drivers to jobs?

00:00:15.000 --> 00:00:21.000
<v Mark (Prospect)>Mostly phone calls and a whiteboard. We want to cut planning time in half.

00:00:21.000 --> 00:00:27.000
<v Lena (AE)>Relaywise plans routes automatically and pushes them to the drivers' phones.

00:00:27.000 --> 00:00:31.000
<v Lena (AE)>Pricing is 49 euros per seat per month.

00:00:31.000 --> 00:00:35.000
<v Mark (Prospect)>Honestly, that is too expensive for a team our size.

00:00:35.000 --> 00:00:46.000
<v Lena (AE)>Fair point. Most teams your size save about ten planning hours a week, so the seats pay for themselves within the first month. We can prove it in a two-week pilot.

00:00:46.000 --> 00:00:52.000
<v Mark (Prospect)>That makes sense if the numbers hold. Let's book the pilot for next Monday.

00:00:52.000 --> 00:00:57.000
<v Lena (AE)>Great, I'll send a calendar invite and the pilot proposal today.
`,
  },
  {
    fileName: "demo-02-kestrel.srt",
    text: `1
00:00:01,000 --> 00:00:06,000
Sam (SDR): Hi Kim, this is Sam calling from Relaywise. We help dispatch teams plan routes in minutes.

2
00:00:06,000 --> 00:00:11,000
Kim (Buyer): Thanks. We already use spreadsheets for dispatch and they do the job.

3
00:00:11,000 --> 00:00:20,000
Sam (SDR): Spreadsheets work until a driver calls in sick. Then someone rebuilds the whole plan by hand. Our platform does that in one click.

4
00:00:20,000 --> 00:00:25,000
Kim (Buyer): Maybe, but we can only look at new tools next quarter.

5
00:00:25,000 --> 00:00:33,000
Sam (SDR): Understood. A short demo now means you are ready when the quarter starts. Could we find thirty minutes for a demo?

6
00:00:33,000 --> 00:00:38,000
Kim (Buyer): Please just send me something by email and I will take a look.

7
00:00:38,000 --> 00:00:43,000
Sam (SDR): Will do. I'll email you a one-page overview and our pricing today.
`,
  },
  {
    fileName: "demo-03-orbit.txt",
    text: `[00:00] Maya: Hi Tom, Maya here, calling from Relaywise. We help field service teams plan their day.
[00:08] Tom: Hi Maya. Our technicians waste a lot of time driving back and forth between jobs.
[00:15] Maya: How are you currently planning their routes?
[00:20] Tom: Each technician plans their own day, so nobody sees the full picture.
[00:31] Maya: Our platform builds one shared plan and moves jobs when something changes. I can show you in a short demo.
[00:40] Tom: What does it cost per seat for a team of twenty?
[00:46] Maya: It is 49 euros per seat per month, with a free two-week trial.
[00:52] Tom: Sounds interesting, but I need to check with our COO before we go further.
[01:02] Maya: Understood. Why don't we bring your COO into a thirty-minute call this week, so I can answer the questions directly?
[01:10] Tom: Good idea. Let's schedule it for Thursday at ten with the three of us.
[01:16] Maya: Perfect, I will send the invite to both of you from maya@relaywise.example.
`,
  },
  {
    fileName: "demo-04-harbor.txt",
    text: `[00:00] Ana (Account Executive): Hi Rob, thanks for joining again. Last time you asked about security, so I brought our security overview.
[00:09] Rob (Customer): Thanks. Our legal team is worried about GDPR and where the driver location data is stored.
[00:18] Ana (Account Executive): All data is hosted in Frankfurt, we sign a data processing agreement, and drivers are only tracked during working hours.
[00:30] Rob (Customer): Good to hear that. The bigger issue is that the price is well above what we pay today.
[00:38] Ana (Account Executive): I understand. If you sign a twelve-month contract, we can offer a fifteen percent discount on all seats.
[00:47] Rob (Customer): I appreciate the offer, but we'll pass, staying with our current vendor for now.
[00:55] Ana (Account Executive): Understood, thank you for the honest answer. I will check back in six months.
`,
  },
  {
    fileName: "demo-05-lumen.vtt",
    text: `WEBVTT

1
00:00:01.000 --> 00:00:06.000
Nina (Sales): Hi Ben, thanks for taking the call. You mentioned late deliveries on the phone.

2
00:00:06.000 --> 00:00:14.000
Ben (Client): Yes, our customers are frustrated because nobody knows when the van arrives. We would like to send them a reliable arrival time.

3
00:00:14.000 --> 00:00:20.000
Nina (Sales): Relaywise sends live arrival times by text message as soon as the route is planned.

4
00:00:20.000 --> 00:00:25.000
Ben (Client): Honestly, the timing is bad, we are in the middle of peak season.

5
00:00:25.000 --> 00:00:34.000
Nina (Sales): We can start small with one depot and a two-week onboarding, so your team is not slowed down during peak season.

6
00:00:34.000 --> 00:00:40.000
Ben (Client): A small start could work. Let's book a demo for the dispatch leads next week.

7
00:00:40.000 --> 00:00:44.000
Nina (Sales): Done. I will also send over a short proposal.

8
00:00:44.000 --> 00:00:50.000
Ben (Client): To be fair, live tracking for the warehouse is not a priority for us yet.

9
00:00:50.000 --> 00:00:55.000
Nina (Sales): That is fine, we can leave the warehouse out of the first phase.
`,
  },
  {
    fileName: "demo-06-internal-pipeline-review.txt",
    text: `Jonas (SDR): Morning Priya, quick pipeline review before the forecast call.
Priya (Sales Manager): Sure. How many demos did you book this week?
Jonas (SDR): Six demos booked, two of them from the Northwind lookalike list.
Priya (Sales Manager): Good. Which deals are stuck on pricing?
Jonas (SDR): Harbor went quiet after the discount offer. Kestrel wants a proposal next quarter.
Priya (Sales Manager): Then send Kestrel the proposal now and ask for a decision date.
`,
  },
]);

/**
 * Drei absichtlich falsche Claims für den Prüf-Knopf:
 * (a) erfundenes Zitat, (b) Verkäufersatz als Käufer-Einwand,
 * (c) echtes Einwand-Zitat mit einem ausgetauschten Wort.
 * @param {Transcript} t
 * @returns {Claim[]}
 */
export function tamperClaims(t) {
  const firstSeller = t.turns
    .filter((x) => x.role === "seller")
    .flatMap((x) => splitSentences(x.text).map((quote) => ({ quote, turn: x.index })))
    .find((s) => s.quote.length >= MIN_QUOTE);
  const real = extractByRules(t).find((c) => c.kind === "objection") ?? extractByRules(t)[0];
  const realQuote = typeof real?.quote === "string" ? real.quote : "";
  const words = realQuote.split(" ");
  const swapAt = words.findIndex((w) => /^\p{L}{4,}$/u.test(w));
  if (swapAt >= 0) words[swapAt] = words[swapAt]?.toLowerCase() === "absolutely" ? "certainly" : "absolutely";
  return [
    { transcriptId: t.id, kind: "objection", category: "price", quote: "We would happily pay double for this tomorrow.", turnHint: 0, source: "test" },
    { transcriptId: t.id, kind: "objection", category: "other", quote: firstSeller?.quote ?? "", turnHint: firstSeller?.turn, source: "test" },
    { transcriptId: t.id, kind: "objection", category: real?.category, quote: words.join(" "), turnHint: real?.turnHint, source: "test" },
  ];
}
