import { expect, test, type Page } from "@playwright/test";

const paper = {
  id: "autonomous-systems-and-ai",
  filename: "Autonomous-System-and-AI-content.pdf",
  title: "Autonomous System and AI",
  authors: ["T. Preethiya", "Priyanga Subbiah"],
  year: 2024,
  topics: ["autonomous systems", "artificial intelligence", "safety"],
  source_url: "https://doi.org/10.4018/979-8-3693-1962-8.ch001",
  pdf_url: "/pdfs/Autonomous-System-and-AI-content.pdf",
  include: true,
};

const source = {
  id: "autonomous-systems-and-ai-p001-introduction-c01",
  paper_id: paper.id,
  document: paper.filename,
  title: paper.title,
  authors: paper.authors,
  year: paper.year,
  page: 1,
  section: "Introduction",
  pdf_url: paper.pdf_url,
  source_url: paper.source_url,
  snippet: "Autonomous systems integrate sensing, decision-making, and control while introducing safety and reliability challenges.",
  vector_score: 0.92,
  bm25_score: 4.2,
  hybrid_score: 0.03,
  vector_rank: 1,
  keyword_rank: 2,
  rrf_score: 0.03,
};

async function mockResearchApi(page: Page) {
  await page.route("**/api/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      status: "available",
      corpus: { paperCount: 1, chunkCount: 41 },
      models: { embedding: "bge-small", generation: "llama" },
      quota: { available: true, code: "AVAILABLE", limit: 200, consumed: 0, remaining: 200, resetsAt: "2026-07-21T00:00:00.000Z" },
    }),
  }));
  await page.route("**/api/papers", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ papers: [paper], count: 1 }),
  }));
  await page.route("**/api/answer/stream", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "X-Demo-Remaining": "199" },
    body: [
      JSON.stringify({ type: "sources", question: "test", sources: [source] }),
      JSON.stringify({ type: "stage", stage: "synthesizing" }),
      JSON.stringify({ type: "delta", delta: "Safety remains a core challenge [Source 1]." }),
      JSON.stringify({ type: "done" }),
      "",
    ].join("\n"),
  }));
}

test("opens a citation at its real PDF page only after interaction", async ({ page }, testInfo) => {
  const pdfRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/pdfs/")) pdfRequests.push(request.url());
  });
  await mockResearchApi(page);
  await page.goto("/");

  await expect(page.getByText("200 questions left")).toBeVisible({ timeout: 15_000 });
  expect(pdfRequests).toHaveLength(0);

  await page.getByRole("button", { name: "Ask the library" }).click();
  await expect(page.getByText("Safety remains a core challenge")).toBeVisible();
  expect(pdfRequests).toHaveLength(0);

  await page.getByRole("button", { name: /Open Source 1/ }).click();
  await expect(page.getByLabel(/PDF viewer for Autonomous System and AI/)).toBeVisible();
  await expect(page.locator(".pdf-page canvas")).toBeVisible();
  await expect.poll(() => pdfRequests.length).toBeGreaterThan(0);
  expect(pdfRequests[0]).toContain("Autonomous-System-and-AI-content.pdf");

  await expect(page.locator(".page-controls")).toContainText("1 / 14");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator(".page-controls")).toContainText("2 / 14");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".zoom-controls")).toContainText("115%");
  await expect(page.getByText("Position data is unavailable", { exact: false })).toBeVisible();

  if (testInfo.project.name === "mobile") {
    await expect(page.locator(".source-panel")).toHaveClass(/is-open/);
  }
});

test("serves every included corpus PDF as a static document", async ({ request }) => {
  const documents = [
    "/pdfs/Autonomous-System-and-AI-content.pdf",
    "/pdfs/Computer%20vision%20tasks%20for%20intelligent%20aerospace%20perception-%20An%20overview.pdf",
    "/pdfs/Modeling%20Considerations%20for%20Developing%20Deep%20Space%20Autonomous%20Spacecraft%20and%20Simulators.pdf",
  ];

  for (const document of documents) {
    const response = await request.get(document);
    expect(response.ok(), document).toBe(true);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
  }
});
