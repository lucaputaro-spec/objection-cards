# Objection Cards: battlecards from real sales calls, every quote checked

Live demo (rules only, AI switched off): https://objection-cards.lucaputaro.workers.dev

Paste or upload sales call transcripts (.txt, .vtt, .srt). The page tells
seller and buyer apart, skips calls that are not sales calls (with the
reason), and pulls out what buyers actually said: problems, desired outcomes,
objections with the seller's answer, questions, and reasons a deal moved or
was lost. The objections become battlecards: category, how often it came up,
the best answer that was followed by a next step (or "Unproven"), and
counter-examples. Export as Markdown or print.

**Every quote is verified.** A claim, whether it comes from the rules,
from Workers AI or from a test, becomes a finding only if its quote appears
word for word in one single turn of the transcript, said by the right side
(buyer for statements, seller for answers). A next step must actually name
one ("let's book", "schedule" …; "send me something" does not count) and a
loss reason must state a loss, otherwise the claim is dropped as
`kind_mismatch`. Only case, whitespace and quote marks are normalised; the
minimum length is measured after whitespace is collapsed. No fuzzy matching. Everything else is dropped with a
reason, and the page counts the drops. A button injects three fabricated
claims to show they are caught.

**Demo data: invented conversations and companies, no real outcomes.** The
demo seller is "Relaywise", a made-up dispatch software. All domains end in
`.example`. This page and its server store nothing, not even settings.
Only use transcripts you are allowed to process. The Markdown export
contains buyer quotes and file names, so check it before sharing.

## What it shows

- **Parsing.** WebVTT (`<v Name>` or `Name:`), SRT and plain text
  (`[00:01] Name: …` or `Name: …`). Labels may be up to 80 characters with
  commas, e.g. `Müller, Anna (ACME GmbH):`; a sentence with a colon is not a
  label. Duplicate file names become `call (2).vtt`. Consecutive cues of one speaker are merged.
  Several pasted transcripts are separated by `=== name ===`.
- **Roles.** Manual override per speaker first, then hints in the label
  (`(AE)`, `(SDR)`, `(Prospect)`, `(Customer)` …), then seller phrases
  ("calling from", "we help", "how are you currently" …).
- **Skip reasons.** Only one speaker, fewer than 4 turns, internal call
  (everyone on the selling side), roles unclear, fewer than 2 sales signals.
- **Rule extractor.** Searches buyer sentences only. Objection categories:
  price, timing, already have something, not the decision maker, no need,
  risk/security, other.
- **Best answer.** A deliberately simple rule: the seller's answer is followed
  by a verified next step, and the buyer does not raise the same objection in
  between. Shortest distance wins. Several objections before one next step
  all count as proven. A next step only counts if no loss reason comes at or
  after its turn in the same call, and a sentence that is a loss ("let's do a
  final check, but we'll pass") is never a next step. A call with a next step
  that still counts is "advanced", otherwise "lost" if it has a loss reason.
  This is correlation, not proof of cause.
- **Optional Workers AI.** Off by default. Sends the text of each turn to
  Cloudflare Workers AI (US provider). Speaker labels and file names are
  removed, but names, companies or emails inside the text are sent as
  written. This page and its server store nothing. Its quotes go through the
  same check. If one call is too large (413) it is skipped and the others are
  tried; on 429, server errors or network errors the AI stops and the rules
  carry on. Page and export say on how many calls the AI actually ran
  ("Workers AI on 2 of 5 calls").

## Run it

```bash
npm install
npm run preview   # static server on http://127.0.0.1:8788, no login, rules only
npm run dev       # the Worker as deployed: AI switched off (AI_ENABLED=false)
npm run dev:ai    # the Worker with Workers AI, needs a Wrangler login
```

## Checks

```bash
npm run test:run
npm run typecheck
npm run lint
grep -q "\"AI_ENABLED\": \"false\"" wrangler.jsonc
```

## Structure

| File | Role |
|---|---|
| `public/lib/quote.js` | Quote check: normalisation, `findQuote`, `verifyClaims` (the only place that creates findings) |
| `public/lib/parse.js` | Split, parse VTT/SRT/TXT, assign roles, classify calls |
| `public/lib/rules.js` | Categories and patterns, sentence split, rule extractor |
| `public/lib/battlecards.js` | `buildReport`, the single entry point: parse → roles → classify → extract → verify → cards |
| `public/lib/export.js` | Markdown export |
| `public/lib/ai.js` | What the page does after each AI call (use, skip, stop) and the AI summary |
| `public/lib/demo.js` | Six invented demo calls and the fabricated-claims check |
| `public/app.js` | The page, the only caller of `lib/` |
| `src/index.ts`, `src/extract.ts` | Worker: serves the page and `POST /api/extract` |
| `scripts/serve.mjs` | Dependency-free static server for `npm run preview` |

## Stack

Cloudflare Workers, Workers AI, TypeScript checks on JSDoc-typed ES modules,
Vitest. Plain HTML, CSS and ES modules, no build step. Transcripts stay in
the browser unless you switch the AI on.
