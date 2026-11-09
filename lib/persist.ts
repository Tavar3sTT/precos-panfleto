import type { PriceSlot } from "@/lib/slots";

const PRICE_KEY = "precos-panfleto-prices-v1";
const META_KEY = "precos-panfleto-meta-v1";
const DB_NAME = "precos-panfleto";
const DB_STORE = "files";

export type PriceState = {
  prices: Record<string, string>;
  hidden: string[];
  manual: PriceSlot[];
};

export type FileMeta = {
  key: string;
  name: string;
  size: number;
  lastModified: number;
  savedAt: number;
  filled: number;
  total: number;
};

export function fileKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

type PriceBook = Record<string, PriceState>;

function readBook(): PriceBook {
  try {
    const raw = localStorage.getItem(PRICE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PriceBook;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadPriceState(key: string): PriceState | null {
  const state = readBook()[key];
  if (!state || typeof state !== "object") return null;
  return {
    prices: state.prices ?? {},
    hidden: state.hidden ?? [],
    manual: state.manual ?? [],
  };
}

export function savePriceState(key: string, state: PriceState): void {
  const book = readBook();
  book[key] = state;
  const keys = Object.keys(book);
  if (keys.length > 8) {
    for (const old of keys.slice(0, keys.length - 8)) delete book[old];
  }
  localStorage.setItem(PRICE_KEY, JSON.stringify(book));
}

export function loadMeta(): FileMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw) as FileMeta;
    if (!meta?.key || !meta.name) return null;
    return meta;
  } catch {
    return null;
  }
}

export function saveMeta(meta: FileMeta): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function clearMeta(): void {
  localStorage.removeItem(META_KEY);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePdfBytes(key: string, bytes: ArrayBuffer): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(bytes, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadPdfBytes(key: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  const bytes = await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const request = tx.objectStore(DB_STORE).get(key);
    request.onsuccess = () => {
      const result = request.result;
      resolve(result instanceof ArrayBuffer ? result : null);
    };
    request.onerror = () => reject(request.error);
  });
  db.close();
  return bytes;
}

export async function clearStoredPdf(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
