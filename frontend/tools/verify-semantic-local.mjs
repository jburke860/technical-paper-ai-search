// Serve the built static export, index a real PDF with the real embedding
// model, and verify semantic (not keyword-only) indexing completes in time.
import { chromium, webkit } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const filePath = process.argv[2];
const engine = (process.argv[3] ?? "chromium") === "webkit" ? webkit : chromium;
const root = join(process.cwd(), "out");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".pdf": "application/pdf", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  try {
    let body;
    try { body = await readFile(join(root, path)); }
    catch { body = await readFile(join(root, `${path}.html`)); path += ".html"; }
    res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((resolve) => server.listen(4517, resolve));

const browser = await engine.launch();
const page = await browser.newPage();
await page.route("**/api/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "available", runtime: "cloudflare-worker", corpus: { paperCount: 10, chunkCount: 658 }, models: { embedding: "bge-small", generation: "llama" }, quota: { available: true, code: "AVAILABLE", limit: 200, consumed: 0, remaining: 200, resetsAt: "2099-01-01T00:00:00.000Z" } }) }));
await page.route("**/api/papers", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ papers: [], count: 0 }) }));
let sawReferer = null;
page.on("request", (r) => {
  if (/huggingface\.co|hf\.co/.test(r.url()) && sawReferer === null) sawReferer = r.headers().referer ?? "(none)";
});
page.on("console", (m) => { if (m.type() !== "log") console.log(`[console:${m.type()}] ${m.text().slice(0, 160)}`); });

await page.goto("http://localhost:4517/");
await page.getByRole("button", { name: /Your PDF/ }).click();
const started = Date.now();
await page.getByLabel("Add a local PDF").setInputFiles(filePath);
await page.locator("text=/passages/").first().waitFor({ timeout: 420_000 });
const status = (await page.locator(".local-doc-list").textContent())?.trim();
console.log(`indexed in ${Math.round((Date.now() - started) / 1000)}s:`, status);
console.log("referer sent to model CDN:", sawReferer);
console.log("semantic mode:", status?.includes("keyword search only") ? "NO (keyword only)" : "YES");

await page.getByRole("textbox", { name: "Research question" }).fill("What is the current technical status and schedule risk?");
const searchStart = Date.now();
await page.getByRole("button", { name: "Search your document" }).click();
await page.locator("text=/Local search only|could not|failed/i").first().waitFor({ timeout: 200_000 });
console.log(`search completed in ${Math.round((Date.now() - searchStart) / 1000)}s, cards:`, await page.locator(".result-card").count());
await browser.close();
server.close();
