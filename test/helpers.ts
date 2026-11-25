import { applyRoles, parseTranscript } from "../public/lib/parse.js";
import type { Transcript } from "../public/lib/types.js";

// Kleines TXT-Gespräch mit Rollen aus den Labels.
export function call(text: string, fileName = "call.txt", id = "call-1"): Transcript {
  return applyRoles(parseTranscript(id, fileName, text));
}

export const SAMPLE = `Lena (AE): Hi Mark, I'm calling from Relaywise about route planning.
Mark (Prospect): Honestly, the price is too high for us right now.
Lena (AE): Teams your size save ten hours a week, so it pays for itself.
Mark (Prospect): We’re fine with “our current setup” for the moment.
Lena (AE): Understood, shall we look at a pilot anyway?
Mark (Prospect): OK. Let's book a demo for next week.`;
