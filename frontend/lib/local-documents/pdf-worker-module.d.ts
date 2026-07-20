// The PDF.js worker bundle has no published types; importing it only assigns
// globalThis.pdfjsWorker so PDF.js can run in fake-worker mode on this thread.
declare module "pdfjs-dist/build/pdf.worker.min.mjs";
