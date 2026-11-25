// Was die Seite nach jedem AI-Aufruf tut, als reine Funktion, damit testbar.
// - 200 mit source "Workers AI": Antwort verwenden.
// - 413 (Gespräch zu groß) oder 400 (keine brauchbaren Turns): nur dieses
//   Gespräch auslassen, die übrigen weiter versuchen.
// - Alles andere (429, 5xx, 404 im Preview, Netzfehler, 200 mit Regel-Fallback):
//   abbrechen, der Rest läuft nur mit den Regeln.

/** @typedef {"use" | "skip" | "stop"} AiStep */

/**
 * @param {{ status: number, body?: unknown } | null} res null = Netzfehler
 * @returns {AiStep}
 */
export function aiStep(res) {
  if (!res) return "stop";
  if (res.status === 200) {
    const body = /** @type {{ source?: unknown } | null} */ (res.body ?? null);
    return body?.source === "Workers AI" ? "use" : "stop";
  }
  if (res.status === 413 || res.status === 400) return "skip";
  return "stop";
}

/**
 * Ehrliche Angabe, auf wie vielen Gesprächen die AI tatsächlich mitgelesen hat.
 * @param {{ used: number, of: number }} ai
 */
export function aiSummary({ used, of }) {
  return used > 0 ? `Workers AI on ${used} of ${of} ${of === 1 ? "call" : "calls"}` : "rules only";
}
