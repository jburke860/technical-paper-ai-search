import { expect, test } from "@playwright/test";

// Opt-in verification of the real in-browser embedding path. It downloads the
// quantized MiniLM model (~25 MB) from the Hugging Face CDN inside the page,
// so it never runs in CI: LIVE_MODEL=1 npx playwright test local-pdf-live
test.skip(!process.env.LIVE_MODEL, "Set LIVE_MODEL=1 to run the networked embedding test.");

const PAGE_TEXT = [
  "Spacecraft thermal control keeps the radiator margin inside its allowed band during science operations.",
  "Star trackers and gyroscopes feed the attitude estimator that stabilizes the platform for imaging.",
  "Battery management balances charge cycles against eclipse duration on every orbit of the mission.",
];

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function minimalPdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const line of pages) {
    const contentNumber = objects.length + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`,
    );
    const stream = `BT /F1 12 Tf 72 740 Td (${escapePdfText(line)}) Tj ET`;
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
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("builds a semantic index with the real embedding model", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await page.getByRole("button", { name: /Your PDF/ }).click();
  await page.getByLabel("Add a local PDF").setInputFiles({
    name: "live-sample.pdf",
    mimeType: "application/pdf",
    buffer: minimalPdf(PAGE_TEXT),
  });

  await expect(page.getByText("hybrid semantic + keyword search")).toBeVisible({ timeout: 240_000 });

  await page.getByRole("textbox", { name: "Research question" }).fill("how is heat rejection kept within limits");
  await page.getByRole("button", { name: "Search your document" }).click();
  await expect(page.getByText("Local search only")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/local embeddings and keyword search/)).toBeVisible();
  // A semantic-only phrasing (no keyword overlap with the passage) must still
  // surface the thermal passage through the embedding ranks.
  await expect(page.locator(".result-card").first()).toContainText("thermal control");
});
