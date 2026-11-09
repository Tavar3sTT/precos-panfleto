export type PriceSlot = {
  id: string;
  pageIndex: number;
  /** Left edge, 0–1 of the page width. */
  nx: number;
  /** Top edge, 0–1 of the page height. */
  ny: number;
  nw: number;
  nh: number;
  manual?: boolean;
};

export function slotId(pageIndex: number, nx: number, ny: number): string {
  return `${pageIndex}:${Math.round(nx * 200)}:${Math.round(ny * 200)}`;
}

export function compareSlots(a: PriceSlot, b: PriceSlot): number {
  return a.pageIndex - b.pageIndex || a.ny - b.ny || a.nx - b.nx;
}

export type PdfBox = { x: number; y: number; w: number; h: number };

/** PDF user space, origin at the bottom-left of an upright page. */
export function slotToPdfBox(
  slot: PriceSlot,
  pageWidth: number,
  pageHeight: number,
): PdfBox {
  return {
    x: slot.nx * pageWidth,
    y: pageHeight - (slot.ny + slot.nh) * pageHeight,
    w: slot.nw * pageWidth,
    h: slot.nh * pageHeight,
  };
}
