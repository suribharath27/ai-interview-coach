import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_CHARS = 60_000;

/** Extract plain text from a PDF file (client-side via PDF.js). */
export async function extractTextFromPdf(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    const cleaned = line.replace(/\s+/g, " ").trim();
    if (cleaned) pages.push(cleaned);
  }

  const text = pages.join("\n\n").trim();
  if (!text) {
    throw new Error(
      "No readable text found in this PDF. It may be a scanned image — paste the text instead."
    );
  }
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…` : text;
}

export async function extractTextFromUpload(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractTextFromPdf(file);
  }
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    file.type.startsWith("text/")
  ) {
    const text = (await file.text()).trim();
    if (!text) throw new Error("The file is empty.");
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…` : text;
  }
  throw new Error("Please upload a PDF or plain text file.");
}
