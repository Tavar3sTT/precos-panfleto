export type PixelBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Finds the empty "R$" price boxes used by the Bartofil flyer.
 * The product names are painted into the PDF as images, so the reliable
 * signal is the wide gray rounded rectangle with "R$" on the left and a
 * blank white field on the right.
 */
export function detectPriceBoxes(image: ImageData): PixelBox[] {
  const { data, width, height } = image;
  const minLen = Math.floor(width * 0.16);
  const maxLen = Math.floor(width * 0.4);

  const isGray = (offset: number) => {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    if (a < 200) return false;
    return (
      Math.abs(r - g) < 26 &&
      Math.abs(g - b) < 26 &&
      r >= 140 &&
      r <= 242
    );
  };

  type Run = { y: number; x0: number; x1: number };
  const runs: Run[] = [];

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let x = 0;
    while (x < width) {
      if (!isGray((row + x) * 4)) {
        x++;
        continue;
      }
      const x0 = x;
      x++;
      while (x < width && isGray((row + x) * 4)) x++;
      const len = x - x0;
      if (len >= minLen && len <= maxLen) runs.push({ y, x0, x1: x });
    }
  }

  const bands: Run[][] = [];
  for (const run of runs) {
    const last = bands[bands.length - 1];
    if (!last || run.y > last[last.length - 1].y + 2) bands.push([run]);
    else last.push(run);
  }

  type Seg = { x0: number; x1: number };
  type Border = { y: number; segs: Seg[] };
  const borders: Border[] = [];

  for (const band of bands) {
    const med = band[Math.floor(band.length / 2)].y;
    const segs = band
      .filter((run) => Math.abs(run.y - med) <= 1)
      .map((run) => ({ x0: run.x0, x1: run.x1 }))
      .sort((a, b) => a.x0 - b.x0);
    const merged: Seg[] = [];
    for (const seg of segs) {
      const prev = merged[merged.length - 1];
      if (prev && seg.x0 <= prev.x1 + Math.max(4, width * 0.008)) {
        prev.x1 = Math.max(prev.x1, seg.x1);
      } else {
        merged.push({ ...seg });
      }
    }
    const kept = merged.filter((seg) => {
      const len = seg.x1 - seg.x0;
      return len >= minLen && len <= maxLen;
    });
    if (kept.length > 0) borders.push({ y: med, segs: kept });
  }

  const boxes: PixelBox[] = [];
  for (const top of borders) {
    for (const bottom of borders) {
      if (bottom.y <= top.y) continue;
      const rel = (bottom.y - top.y) / height;
      if (rel < 0.028 || rel > 0.075) continue;
      for (const upper of top.segs) {
        for (const lower of bottom.segs) {
          const overlap =
            Math.min(upper.x1, lower.x1) - Math.max(upper.x0, lower.x0);
          const upperLen = upper.x1 - upper.x0;
          if (overlap <= upperLen * 0.65) continue;
          const x = Math.min(upper.x0, lower.x0);
          const x2 = Math.max(upper.x1, lower.x1);
          const w = x2 - x;
          const h = bottom.y - top.y;
          if (w > h * 2.4) boxes.push({ x, y: top.y, w, h });
          break;
        }
      }
    }
  }

  const unique: PixelBox[] = [];
  const slop = Math.max(8, width * 0.01);
  for (const box of boxes) {
    const duplicate = unique.some(
      (other) => Math.abs(other.x - box.x) < slop && Math.abs(other.y - box.y) < slop,
    );
    if (!duplicate && looksLikePriceBox(data, width, box)) unique.push(box);
  }

  unique.sort((a, b) => a.y - b.y || a.x - b.x);
  return unique;
}

function looksLikePriceBox(
  data: Uint8ClampedArray,
  width: number,
  box: PixelBox,
): boolean {
  let dark = 0;
  let leftCount = 0;
  let white = 0;
  let rightCount = 0;
  const y0 = Math.floor(box.y + box.h * 0.22);
  const y1 = Math.floor(box.y + box.h * 0.8);
  const leftX1 = Math.floor(box.x + box.w * 0.3);
  const rightX0 = Math.floor(box.x + box.w * 0.42);
  const rightX1 = Math.floor(box.x + box.w * 0.94);

  for (let y = y0; y < y1; y += 2) {
    for (let x = Math.floor(box.x + 2); x < leftX1; x += 2) {
      const offset = (y * width + x) * 4;
      leftCount++;
      if (data[offset] < 100 && data[offset + 3] > 180) dark++;
    }
    for (let x = rightX0; x < rightX1; x += 2) {
      const offset = (y * width + x) * 4;
      rightCount++;
      if (data[offset] > 242 && data[offset + 1] > 242 && data[offset + 2] > 242) {
        white++;
      }
    }
  }

  const darkRatio = dark / Math.max(1, leftCount);
  const whiteRatio = white / Math.max(1, rightCount);
  return darkRatio > 0.012 && darkRatio < 0.5 && whiteRatio > 0.55;
}
