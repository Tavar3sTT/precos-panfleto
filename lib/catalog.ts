import type { PDFDocumentProxy } from "pdfjs-dist";
import { detectPriceBoxes } from "@/lib/detect-prices";
import { formatMoney, isBlank, parseMoney } from "@/lib/money";
import { compareSlots, slotId, slotToPdfBox, type PriceSlot } from "@/lib/slots";

const DETECT_SCALE = 2;

export type PageSize = { width: number; height: number };

export type Catalog = {
  name: string;
  size: number;
  lastModified: number;
  bytes: Uint8Array;
  pageCount: number;
  pageSizes: PageSize[];
  slots: PriceSlot[];
  doc: PDFDocumentProxy;
};

let workerReady = false;

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  if (!workerReady) {
    lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerReady = true;
  }
  return lib;
}

export function releaseCatalog(doc: PDFDocumentProxy): void {
  void doc.loadingTask.destroy();
}

export function humanPdfError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/password/i.test(message)) {
    return "Esse PDF pede senha. Peça uma cópia sem senha e tente de novo.";
  }
  if (/invalid pdf/i.test(message)) {
    return "Não consegui abrir este arquivo. Confira se ele é um PDF.";
  }
  return "Não consegui ler este PDF. Tente de novo ou escolha outro arquivo.";
}

export async function openCatalog(
  file: { name: string; size: number; lastModified: number; data: ArrayBuffer },
  onProgress: (done: number, total: number) => void,
): Promise<Catalog> {
  const { getDocument } = await pdfjs();
  const owned = file.data.slice(0);
  const bytes = new Uint8Array(owned);
  const task = getDocument({
    data: bytes.slice(0),
    disableRange: true,
    disableStream: true,
  });
  const doc = await task.promise;
  const pageCount = doc.numPages;
  const slots: PriceSlot[] = [];
  const pageSizes: PageSize[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    onProgress(pageNumber - 1, pageCount);
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    pageSizes.push({ width: base.width, height: base.height });
    const viewport = page.getViewport({ scale: DETECT_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("canvas");
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const boxes = detectPriceBoxes(image);
    const pageIndex = pageNumber - 1;
    for (const box of boxes) {
      const nx = box.x / canvas.width;
      const ny = box.y / canvas.height;
      const nw = box.w / canvas.width;
      const nh = box.h / canvas.height;
      slots.push({
        id: slotId(pageIndex, nx, ny),
        pageIndex,
        nx,
        ny,
        nw,
        nh,
      });
    }
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }

  onProgress(pageCount, pageCount);
  slots.sort(compareSlots);
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    bytes,
    pageCount,
    pageSizes,
    slots,
    doc,
  };
}

export function drawPage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): { promise: Promise<number>; cancel: () => void } {
  let renderTask: { cancel: () => void } | null = null;
  let cancelled = false;

  const promise = (async () => {
    const page = await doc.getPage(pageIndex + 1);
    if (cancelled) return 0;
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = (cssWidth / base.width) * dpr;
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const cssHeight = viewport.height / dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    const task = page.render({ canvasContext: context, viewport, canvas });
    renderTask = task;
    if (cancelled) {
      task.cancel();
      return cssHeight;
    }
    try {
      await task.promise;
    } catch (error) {
      const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
      if (name === "RenderingCancelledException" || cancelled) return cssHeight;
      throw error;
    }
    return cssHeight;
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      renderTask?.cancel();
    },
  };
}

export async function buildPricedPdf(
  bytes: Uint8Array,
  slots: PriceSlot[],
  prices: Record<string, string>,
): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkitModule = await import("@pdf-lib/fontkit");
  const fontkit = fontkitModule.default;
  const pdf = await PDFDocument.load(bytes);
  pdf.registerFontkit(fontkit);
  const fontResponse = await fetch("/fonts/Poppins-Bold.ttf");
  if (!fontResponse.ok) throw new Error("font");
  const font = await pdf.embedFont(await fontResponse.arrayBuffer());
  const ink = rgb(0.07, 0.07, 0.08);

  for (const slot of slots) {
    const raw = prices[slot.id];
    if (isBlank(raw)) continue;
    const value = parseMoney(raw);
    if (value === null) continue;
    const page = pdf.getPage(slot.pageIndex);
    const rotation = page.getRotation().angle;
    if (rotation !== 0) continue;
    const { width, height } = page.getSize();
    const box = slotToPdfBox(slot, width, height);
    const text = formatMoney(value);
    const rightPad = box.w * 0.055;
    const leftLimit = box.x + box.w * 0.2;
    let size = box.h * 0.46;
    let textWidth = font.widthOfTextAtSize(text, size);
    while (box.x + box.w - rightPad - textWidth < leftLimit && size > 8) {
      size -= 0.25;
      textWidth = font.widthOfTextAtSize(text, size);
    }
    page.drawText(text, {
      x: box.x + box.w - rightPad - textWidth,
      y: box.y + (box.h - size) * 0.32,
      size,
      font,
      color: ink,
    });
  }

  return pdf.save();
}

export function downloadName(original: string): string {
  const base = original.replace(/\.pdf$/i, "");
  return `${base}-com-precos.pdf`;
}

export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
