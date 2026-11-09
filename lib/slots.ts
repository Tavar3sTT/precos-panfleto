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

export type NormBox = { nx: number; ny: number; nw: number; nh: number };

/** The product card that sits above a price box in this flyer. */
export function productFrame(slot: PriceSlot): NormBox {
  const padX = slot.nw * 0.04;
  const nx = Math.max(0, slot.nx - padX);
  const right = Math.min(1, slot.nx + slot.nw + padX);
  const ny = Math.max(0, slot.ny - slot.nh * 6.55);
  const bottom = Math.min(1, slot.ny + slot.nh * 1.08);
  return { nx, ny, nw: right - nx, nh: bottom - ny };
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
