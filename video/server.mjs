// Tiny local server for the trailer: serves video/ and saves the recorded file to video/out/.
//   node video/server.mjs   ->   http://localhost:3300/trailer.html
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, "out");
mkdirSync(out, { recursive: true });
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".mp4": "video/mp4", ".webm": "video/webm" };

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/save") {
    const name = path.basename(url.searchParams.get("name") || "trailer.bin");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const data = Buffer.concat(chunks);
      writeFileSync(path.join(out, name), data);
      console.log(`saved ${name} (${data.length} bytes)`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, bytes: data.length }));
    });
    return;
  }
  if (url.pathname.startsWith("/vendor/")) {
    const f = path.join(root, "vendor", path.basename(url.pathname));
    if (existsSync(f)) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(readFileSync(f)); return; }
  }
  const base = url.pathname === "/" ? "trailer.html" : path.basename(url.pathname);
  const file = existsSync(path.join(root, base)) ? path.join(root, base) : path.join(out, base);
  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(3300, () => console.log("trailer server on http://localhost:3300/trailer.html"));
