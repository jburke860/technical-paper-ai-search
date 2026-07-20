import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import papers from "../../data/papers.json" with { type: "json" };

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "..");
const outputDirectory = resolve(frontendRoot, "public", "pdfs");

await mkdir(outputDirectory, { recursive: true });

for (const paper of papers.filter((entry) => entry.include)) {
  const filename = decodeURIComponent(paper.pdf_url.split("/").at(-1));
  await copyFile(
    resolve(repositoryRoot, "data", "pdfs", filename),
    resolve(outputDirectory, filename),
  );
}

await copyFile(
  resolve(frontendRoot, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"),
  resolve(frontendRoot, "public", "pdf.worker.min.mjs"),
);

console.log(`Synced ${papers.filter((entry) => entry.include).length} curated PDFs and the PDF.js worker.`);
