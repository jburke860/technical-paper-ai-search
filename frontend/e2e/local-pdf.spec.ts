import { expect, test, type Page, type Request } from "@playwright/test";

// A unique marker proves the document body never appears in any network
// request while the local pipeline runs.
const MARKER = "quixotic-thermal-subsystem";

const PAGE_TEXT: string[][] = [
  [
    "Autonomous spacecraft rely on layered fault protection to survive",
    "long communication gaps between ground contacts during deep space",
    "operations, and each layer is validated against recorded telemetry.",
  ],
  [
    `The ${MARKER} margin analysis shows that radiator sizing`,
    "constrains the peak power budget of the onboard computer during",
    "high-rate science observations and downlink sessions.",
  ],
  [
    "Verification of the guidance loop uses hardware in the loop testing",
    "with injected sensor faults to measure detection latency and the",
    "resulting safe mode entry behavior of the flight software.",
  ],
];

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// Builds a small, valid, uncompressed PDF with real extractable text.
function minimalPdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const lines of pages) {
    const contentNumber = objects.length + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`,
    );
    const stream = [
      "BT /F1 12 Tf 72 740 Td",
      ...lines.map((line, index) => `${index === 0 ? "" : "0 -16 Td "}(${escapePdfText(line)}) Tj`),
      "ET",
    ].join("\n");
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const SAMPLE_PDF = {
  name: "mission-notes.pdf",
  mimeType: "application/pdf",
  buffer: minimalPdf(PAGE_TEXT),
};

async function mockHostedApi(page: Page) {
  await page.route("**/api/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "available",
        runtime: "cloudflare-worker",
        corpus: { paperCount: 3, chunkCount: 262 },
        models: { embedding: "bge-small", generation: "llama" },
        quota: {
          available: true,
          code: "AVAILABLE",
          limit: 200,
          consumed: 0,
          remaining: 200,
          resetsAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    }),
  );
  await page.route("**/api/papers", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ papers: [], count: 0 }),
    }),
  );
}

// The embedding model download is blocked so the pipeline exercises its
// deterministic keyword-only fallback; tests never rely on an external CDN.
async function blockModelCdn(page: Page) {
  await page.route(/huggingface\.co|hf\.co|jsdelivr\.net|hf\.xet/, (route) => route.abort());
}

function trackRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  return requests;
}

async function openLocalMode(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Your PDF/ }).click();
  await expect(page.getByText("It is never uploaded or stored on any server.")).toBeVisible();
}

async function indexSamplePdf(page: Page) {
  await page.getByLabel("Add a local PDF").setInputFiles(SAMPLE_PDF);
  await expect(page.getByText(SAMPLE_PDF.name)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/keyword search only/)).toBeVisible();
}

test.describe("browser-local PDF mode", () => {
  test.setTimeout(180_000);

  test("indexes a visitor PDF and searches it without any upload", async ({ page }) => {
    await mockHostedApi(page);
    await blockModelCdn(page);
    const requests = trackRequests(page);

    await openLocalMode(page);
    await indexSamplePdf(page);

    await page.getByRole("textbox", { name: "Research question" }).fill("thermal subsystem radiator margin");
    await page.getByRole("button", { name: "Search your document" }).click();

    await expect(page.getByText("Local search only")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Nothing was transmitted.")).toBeVisible();
    const topResult = page.locator(".result-card").first();
    await expect(topResult).toContainText("Local passage · Page 2");
    await expect(topResult).toContainText(MARKER);

    const apiPosts = requests.filter(
      (request) => request.method() === "POST" && request.url().includes("/api/"),
    );
    expect(apiPosts).toHaveLength(0);
    for (const request of requests) {
      const body = request.postData();
      expect(body ?? "").not.toContain(MARKER);
      expect(body ?? "").not.toContain("%PDF");
    }
  });

  test("sends only bounded excerpts when hosted synthesis is opted in", async ({ page }) => {
    await mockHostedApi(page);
    await blockModelCdn(page);
    let synthesisBody: string | null = null;
    await page.route("**/api/answer/local/stream", (route) => {
      synthesisBody = route.request().postData();
      route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "X-Demo-Remaining": "199",
        },
        body: [
          JSON.stringify({ type: "stage", stage: "synthesizing" }),
          JSON.stringify({ type: "delta", delta: "The radiator margin constrains peak power [Source 1]." }),
          JSON.stringify({ type: "done" }),
          "",
        ].join("\n"),
      });
    });

    await openLocalMode(page);
    await indexSamplePdf(page);
    // The styled toggle visually hides its checkbox, so click the label text.
    await page.getByText("Generate answers with the hosted model").click();

    await page.getByRole("textbox", { name: "Research question" }).fill("thermal subsystem radiator margin");
    await page.getByRole("button", { name: "Search your document" }).click();

    await expect(page.getByText("The radiator margin constrains peak power")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Answer generated by the hosted model from bounded excerpts"),
    ).toBeVisible();

    expect(synthesisBody).not.toBeNull();
    const payload = JSON.parse(synthesisBody!) as {
      question: string;
      excerpts: Array<{ label: string; page: number; text: string }>;
    };
    expect(Object.keys(payload).sort()).toEqual(["excerpts", "question"]);
    expect(payload.excerpts.length).toBeGreaterThan(0);
    expect(payload.excerpts.length).toBeLessThanOrEqual(5);
    for (const excerpt of payload.excerpts) {
      expect(excerpt.text.length).toBeLessThanOrEqual(800);
      expect(excerpt.text).not.toContain("%PDF");
    }
  });

  test("fails safely for unsupported and oversized files", async ({ page }) => {
    await mockHostedApi(page);
    await blockModelCdn(page);
    await openLocalMode(page);

    await page.getByLabel("Add a local PDF").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("plain text, not a PDF document, long enough to check"),
    });
    await expect(page.getByText("Only PDF files are supported.")).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Try another file" }).click();
    await page.getByLabel("Add a local PDF").setInputFiles({
      name: "huge.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(21 * 1024 * 1024, 32),
    });
    await expect(page.getByText(/PDFs up to 20 MB are supported/)).toBeVisible();
  });

  test("removes the local document and returns to the empty state", async ({ page }) => {
    await mockHostedApi(page);
    await blockModelCdn(page);
    await openLocalMode(page);
    await indexSamplePdf(page);

    await page.getByRole("button", { name: "Remove document" }).click();
    await expect(page.getByText("Add a local PDF")).toBeVisible();
    await expect(page.getByText(SAMPLE_PDF.name)).toHaveCount(0);
  });
});
