// Einstiegspunkt. Der Worker liefert die Seite aus und hat genau eine
// Schnittstellen: GET /api/status und POST /api/extract (optionale AI-Extraktion). Gespeichert und
// geloggt wird nichts, Transkripte bleiben im Browser. Prüfmuster aus Revenue Loop.

import { aiEnabled, extract, readInput, type AiEnv } from "./extract";

interface Env extends AiEnv {
  ASSETS: Fetcher;
  LIMITER?: RateLimit;
}

const MAX_BODY_BYTES = 24_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname === "/api/status") return json({ ai: aiEnabled(env) });
    if (url.pathname !== "/api/extract") return json({ error: "Unknown endpoint." }, 404);
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    // Riegel: ohne AI_ENABLED = "true" geht kein Text an Workers AI, egal was der Browser schickt.
    if (!aiEnabled(env)) return json({ error: "AI is switched off in this demo. The rules still work." }, 403);

    // Kein Origin-Header (z. B. curl) ist erlaubt. "null" oder ein ungültiger Wert ergibt 403, nicht 500.
    const origin = request.headers.get("origin");
    if (origin !== null && !sameHost(origin, url.host)) return json({ error: "Cross-site requests are not allowed." }, 403);

    if (env.LIMITER) {
      const key = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.LIMITER.limit({ key });
      if (!success) return json({ error: "Too many requests. The rules still work." }, 429);
    }

    let body: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: "Request is too large." }, 413);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }

    const input = readInput(body ?? {});
    if (!input) return json({ error: "No turns with role seller or buyer." }, 400);
    return json(await extract(env, input));
  },
} satisfies ExportedHandler<Env>;
