// Quick visual check: open the status popover on a phone-sized viewport and screenshot it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "@playwright/test";

const OUT = new URL("../out", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const status = {
  status: "available",
  runtime: "cloudflare-worker",
  corpus: { paperCount: 10, chunkCount: 658 },
  models: { embedding: "bge-small", generation: "llama" },
  quota: { available: true, code: "AVAILABLE", limit: 200, consumed: 4, remaining: 196, resetsAt: "2099-01-01T00:00:00.000Z" },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(status));
    return;
  }
  if (url.pathname === "/api/papers") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ papers: [], count: 0 }));
    return;
  }
  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    let body;
    try {
      body = await readFile(join(OUT, path));
    } catch {
      body = await readFile(join(OUT, `${path}.html`));
      path += ".html";
    }
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

await new Promise((resolve) => server.listen(4520, resolve));

const browser = await chromium.launch();
for (const [name, viewport] of [["iphone-390", { width: 390, height: 844 }], ["small-360", { width: 360, height: 740 }], ["tablet-820", { width: 820, height: 1024 }]]) {
  const page = await browser.newPage({ viewport, isMobile: viewport.width < 800, hasTouch: viewport.width < 800 });
  await page.goto("http://127.0.0.1:4520/");
  await page.waitForTimeout(1200);
  await page.locator(".system-pill").click();
  await page.waitForTimeout(300);
  const box = await page.locator(".about-popover").boundingBox();
  const fits = box && box.x >= 0 && box.x + box.width <= viewport.width;
  console.log(`${name}: popover box ${JSON.stringify(box)} — ${fits ? "fits" : "OVERFLOWS"}`);
  await page.screenshot({ path: `/tmp/popover-${name}.png` });
  await page.close();
}
await browser.close();
server.close();
