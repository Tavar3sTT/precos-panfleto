const MONEY = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$|^\d+\.\d{1,2}$/;

export function isBlank(raw: string | undefined): boolean {
  return !raw || raw.trim() === "";
}

/** Reads a Brazilian price. Empty stays empty. `12,9`, `1.250,00` and `45` are valid. */
export function parseMoney(raw: string): number | null {
  let text = raw.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!text) return null;
  text = text.replace(/[.,]$/, "");
  if (!text || !MONEY.test(text)) return null;

  let normalized: string;
  if (text.includes(",")) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, "");
  } else {
    normalized = text;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  return Math.round(value * 100) / 100;
}

export function formatMoney(value: number): string {
  const negative = value < 0;
  const cents = Math.round(Math.abs(value) * 100);
  const reais = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${frac}`;
}

export function normalizeMoneyInput(raw: string): { text: string; valid: boolean } {
  if (isBlank(raw)) return { text: "", valid: true };
  const value = parseMoney(raw);
  if (value === null) return { text: raw.trim(), valid: false };
  return { text: formatMoney(value), valid: true };
}
