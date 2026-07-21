// Drives real installed Safari via safaridriver to reproduce the local-PDF
// crash that only occurs there. Usage: node tools/safari-drive.mjs <pdf>
const DRIVER = "http://localhost:4744";
const SITE = "https://technical-paper-ai-search.jeremy-burke024.workers.dev";
const filePath = process.argv[2];

async function wd(method, path, body) {
  const res = await fetch(`${DRIVER}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json).slice(0, 300)}`);
  return json.value;
}

const session = await wd("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
const sid = session.sessionId;
const S = `/session/${sid}`;
console.log("session started");

try {
  await wd("POST", `${S}/url`, { url: SITE });
  await new Promise((r) => setTimeout(r, 4000));

  const exec = (script, args = []) => wd("POST", `${S}/execute/sync`, { script, args });

  // Switch to local mode.
  await exec(`document.evaluate("//button[contains(., 'Your PDF')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click();`);
  await new Promise((r) => setTimeout(r, 1500));

  // Try the WebDriver-native file upload first.
  const el = await wd("POST", `${S}/element`, { using: "css selector", value: "input[type=file]" });
  const elementId = Object.values(el)[0];
  try {
    await wd("POST", `${S}/element/${elementId}/value`, { text: filePath });
    console.log("file set via WebDriver send-keys");
  } catch (error) {
    console.log("send-keys upload unsupported, injecting bytes:", String(error).slice(0, 120));
    const { readFile } = await import("node:fs/promises");
    const base64 = (await readFile(filePath)).toString("base64");
    const name = filePath.split("/").pop();
    await exec(
      `const [b64, name] = arguments;
       const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
       const file = new File([bytes], name, { type: "application/pdf" });
       const dt = new DataTransfer();
       dt.items.add(file);
       const input = document.querySelector("input[type=file]");
       input.files = dt.files;
       input.dispatchEvent(new Event("change", { bubbles: true }));`,
      [base64, name],
    );
    console.log("file injected via DataTransfer");
  }

  // Poll for outcome up to 7 minutes.
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 420_000) {
    const state = await exec(`
      const err = document.querySelector(".local-error, [class*=error]");
      const list = document.querySelector(".local-doc-list");
      const prog = [...document.querySelectorAll("[class*=progress], [class*=stage]")].map(n => n.textContent).join(" | ");
      return JSON.stringify({ err: err?.textContent ?? null, list: list?.textContent ?? null, prog: prog.slice(0, 150) });
    `);
    const { err, list, prog } = JSON.parse(state);
    const line = err ? `ERR: ${err}` : list ? `OK: ${list}` : `...${prog}`;
    if (line !== last) { last = line; console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${line.slice(0, 400)}`); }
    if (err || list) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
} finally {
  await wd("DELETE", `/session/${sid}`).catch(() => {});
}
