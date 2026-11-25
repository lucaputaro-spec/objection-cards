// Statischer Server für die Abnahme ohne Wrangler-Login: liefert public/ aus.
// /api/* gibt es hier nicht (404), die Seite fällt dann auf die Regeln zurück.
// Pfade werden normalisiert und müssen unter public/ bleiben. Nur 127.0.0.1,
// damit niemand im selben Netz die Seite erreicht.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const HOST = "127.0.0.1";
const PORT = 8788;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    return notFound(res);
  }
  if (pathname.startsWith("/api/")) return notFound(res);
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep)) return notFound(res);
  const type = MIME[path.extname(file)];
  if (!type) return notFound(res);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  } catch {
    notFound(res);
  }
}).listen(PORT, HOST, () => {
  console.log(`Objection Cards: http://${HOST}:${PORT}`);
});
