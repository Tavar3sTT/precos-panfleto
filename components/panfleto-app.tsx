"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildPricedPdf,
  downloadBytes,
  downloadName,
  drawPage,
  humanPdfError,
  openCatalog,
  releaseCatalog,
  type Catalog,
} from "@/lib/catalog";
import { isBlank, normalizeMoneyInput, parseMoney } from "@/lib/money";
import {
  clearMeta,
  clearStoredPdf,
  fileKey,
  loadMeta,
  loadPdfBytes,
  loadPriceState,
  saveMeta,
  savePdfBytes,
  savePriceState,
  type FileMeta,
} from "@/lib/persist";
import { compareSlots, type PriceSlot } from "@/lib/slots";

type Phase = "home" | "loading" | "editor";

export function PanfletoApp() {
  const [phase, setPhase] = useState<Phase>("home");
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 1 });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [slots, setSlots] = useState<PriceSlot[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, true>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<"fit" | "large">("fit");
  const [marking, setMarking] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pageBox, setPageBox] = useState({ width: 0, height: 0 });
  const [coarse, setCoarse] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadGen = useRef(0);
  const pendingFocus = useRef<{ id: string; select: boolean } | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setMeta(loadMeta());
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!marking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMarking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marking]);

  const filled = useMemo(
    () => slots.filter((slot) => parseMoney(prices[slot.id] ?? "") !== null).length,
    [prices, slots],
  );

  useEffect(() => {
    if (phase !== "editor" || !catalog) return;
    const key = fileKey(catalog);
    const state = {
      prices,
      hidden,
      manual: slots.filter((slot) => slot.manual),
    };
    const handle = window.setTimeout(() => {
      savePriceState(key, state);
      const nextMeta: FileMeta = {
        key,
        name: catalog.name,
        size: catalog.size,
        lastModified: catalog.lastModified,
        savedAt: Date.now(),
        filled,
        total: slots.length,
      };
      saveMeta(nextMeta);
      setMeta(nextMeta);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [catalog, filled, hidden, phase, prices, slots]);

  const loadFromBuffer = useCallback(
    async (file: { name: string; size: number; lastModified: number; data: ArrayBuffer }) => {
      const gen = ++loadGen.current;
      setError(null);
      setPhase("loading");
      setProgress({ done: 0, total: 1 });
      setMarking(false);
      setConfirmClear(false);
      try {
        const next = await openCatalog(file, (done, total) => {
          if (gen === loadGen.current) setProgress({ done, total });
        });
        if (gen !== loadGen.current) {
          releaseCatalog(next.doc);
          return;
        }
        const key = fileKey(file);
        const saved = loadPriceState(key);
        const hiddenIds = saved?.hidden ?? [];
        const hiddenSet = new Set(hiddenIds);
        const merged = [
          ...next.slots.filter((slot) => !hiddenSet.has(slot.id)),
          ...(saved?.manual ?? []),
        ].sort(compareSlots);
        setCatalog((current) => {
          if (current) releaseCatalog(current.doc);
          return next;
        });
        setSlots(merged);
        setPrices(saved?.prices ?? {});
        setInvalid({});
        setHidden(hiddenIds);
        const first = merged[0];
        setPageIndex(first?.pageIndex ?? 0);
        setActiveId(first?.id ?? null);
        setZoom("fit");
        pendingFocus.current =
          first && !window.matchMedia("(pointer: coarse)").matches
            ? { id: first.id, select: false }
            : null;
        setFocusNonce((nonce) => nonce + 1);
        setPhase("editor");
        void savePdfBytes(key, file.data.slice(0)).catch(() => undefined);
      } catch (caught) {
        if (gen !== loadGen.current) return;
        setError(humanPdfError(caught));
        setPhase("home");
      }
    },
    [],
  );

  async function takeFile(file: File | undefined) {
    if (!file) return;
    const looksPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!looksPdf) {
      setError("Escolha um arquivo PDF.");
      return;
    }
    const data = await file.arrayBuffer();
    await loadFromBuffer({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      data,
    });
  }

  async function resume() {
    if (!meta) return;
    const bytes = await loadPdfBytes(meta.key);
    if (!bytes) {
      setError("O PDF salvo não está mais neste navegador. Escolha o arquivo de novo.");
      return;
    }
    await loadFromBuffer({
      name: meta.name,
      size: meta.size,
      lastModified: meta.lastModified,
      data: bytes,
    });
  }

  async function forgetSaved() {
    if (!meta) return;
    await clearStoredPdf(meta.key).catch(() => undefined);
    clearMeta();
    setMeta(null);
  }

  const pageSlots = slots.filter((slot) => slot.pageIndex === pageIndex);
  const active = slots.find((slot) => slot.id === activeId) ?? null;
  const activeOffset = active ? slots.findIndex((slot) => slot.id === active.id) : -1;

  function commit(id: string) {
    const raw = prices[id] ?? "";
    const next = normalizeMoneyInput(raw);
    setInvalid((flags) => {
      if (next.valid && !flags[id]) return flags;
      if (!next.valid && flags[id]) return flags;
      const copy = { ...flags };
      if (next.valid) delete copy[id];
      else copy[id] = true;
      return copy;
    });
    if (next.text !== raw) {
      setPrices((current) => ({ ...current, [id]: next.text }));
    }
  }

  function focusSlot(id: string, select = false) {
    const slot = slots.find((item) => item.id === id);
    if (!slot) return;
    setActiveId(id);
    if (slot.pageIndex !== pageIndex) setPageIndex(slot.pageIndex);
    pendingFocus.current = { id, select };
    setFocusNonce((nonce) => nonce + 1);
  }

  function goRelative(step: number) {
    if (activeOffset < 0) {
      if (slots[0]) focusSlot(slots[0].id, true);
      return;
    }
    const next = slots[activeOffset + step];
    if (next) focusSlot(next.id, true);
  }

  function goNextEmpty() {
    if (slots.length === 0) return;
    const start = activeOffset < 0 ? 0 : activeOffset + 1;
    const ordered = [...slots.slice(start), ...slots.slice(0, start)];
    const empty = ordered.find((slot) => isBlank(prices[slot.id]));
    if (empty) focusSlot(empty.id, true);
    else if (slots[activeOffset + 1]) focusSlot(slots[activeOffset + 1].id, true);
  }

  function onPriceKeyDown(event: React.KeyboardEvent<HTMLInputElement>, id: string) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit(id);
    const index = slots.findIndex((slot) => slot.id === id);
    const next = slots[index + 1];
    if (next) focusSlot(next.id, true);
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || phase !== "editor") return;
    const observer = new ResizeObserver(() => {
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    });
    observer.observe(stage);
    setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    return () => observer.disconnect();
  }, [phase]);

  const pageSize = catalog?.pageSizes[pageIndex];
  const cssWidth = useMemo(() => {
    if (!pageSize || stageSize.width < 40 || stageSize.height < 40) return 0;
    const aspect = pageSize.height / pageSize.width;
    const availableWidth = Math.max(240, stageSize.width - (stageSize.width < 720 ? 20 : 56));
    const availableHeight = Math.max(240, stageSize.height - 24);
    const contain = Math.min(availableWidth, availableHeight / aspect);
    const width = zoom === "fit" ? contain : contain * 1.6;
    return Math.max(240, Math.floor(width));
  }, [pageSize, stageSize.height, stageSize.width, zoom]);

  useEffect(() => {
    if (phase !== "editor" || !catalog || !canvasRef.current || cssWidth < 40) return;
    const drawing = drawPage(catalog.doc, pageIndex, canvasRef.current, cssWidth);
    let alive = true;
    drawing.promise
      .then((height) => {
        if (alive) setPageBox({ width: cssWidth, height });
      })
      .catch(() => {
        if (alive) setError("Não consegui desenhar esta página.");
      });
    return () => {
      alive = false;
      drawing.cancel();
    };
  }, [catalog, cssWidth, pageIndex, phase]);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || phase !== "editor") return;
    const slot = slots.find((item) => item.id === pending.id);
    if (!slot) return;
    if (!coarse && slot.pageIndex !== pageIndex) return;
    const targetId = coarse ? "price-composer" : `price-${pending.id}`;
    const element = document.getElementById(targetId) as HTMLInputElement | null;
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
    if (pending.select) element.select();
  }, [coarse, focusNonce, pageBox.width, pageIndex, phase, slots]);

  function hideActive() {
    if (!active) return;
    setHidden((current) => [...current, active.id]);
    setSlots((current) => current.filter((slot) => slot.id !== active.id));
    setPrices((current) => {
      const copy = { ...current };
      delete copy[active.id];
      return copy;
    });
    setActiveId(null);
  }

  function placeManual(event: React.MouseEvent<HTMLDivElement>) {
    if (!marking) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    const sample = slots.find((slot) => !slot.manual);
    const nw = sample?.nw ?? 0.273;
    const nh = sample?.nh ?? 0.0485;
    const left = clamp(nx - nw / 2, 0.008, 1 - nw - 0.008);
    const top = clamp(ny - nh / 2, 0.008, 1 - nh - 0.008);
    const slot: PriceSlot = {
      id: `manual-${pageIndex}-${Date.now()}`,
      pageIndex,
      nx: left,
      ny: top,
      nw,
      nh,
      manual: true,
    };
    setSlots((current) => [...current, slot].sort(compareSlots));
    setMarking(false);
    setActiveId(slot.id);
    pendingFocus.current = { id: slot.id, select: true };
    setFocusNonce((nonce) => nonce + 1);
  }

  async function download() {
    if (!catalog) return;
    const bad = slots.find((slot) => !isBlank(prices[slot.id]) && parseMoney(prices[slot.id] ?? "") === null);
    if (bad) {
      setPageIndex(bad.pageIndex);
      setActiveId(bad.id);
      pendingFocus.current = { id: bad.id, select: true };
      setFocusNonce((nonce) => nonce + 1);
      setError("Tem um valor que não ficou claro. Use 12,90 ou 1.250,00.");
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const bytes = await buildPricedPdf(catalog.bytes, slots, prices);
      downloadBytes(bytes, downloadName(catalog.name));
    } catch {
      setError("Não consegui gerar o PDF. Tente baixar de novo.");
    } finally {
      setDownloading(false);
    }
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="application/pdf,.pdf"
      className="sr-only"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        void takeFile(file);
      }}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-[#efeae1] text-[#1c2430]">
      {fileInput}
      <header className="shrink-0 bg-[#173a66] text-[#f6f3ec]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          <div className="min-w-[12rem] flex-1">
            <p className="text-[0.68rem] font-semibold tracking-[0.18em] text-[#f3d48a] uppercase">
              Encarte do dia
            </p>
            <h1 className="text-xl leading-tight font-semibold">Preços do panfleto</h1>
          </div>
          {phase === "editor" && catalog && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-11 border-white/20 bg-white/5 text-[#f6f3ec] hover:bg-white/15 hover:text-white"
                onClick={() => fileRef.current?.click()}
              >
                <FolderOpen />
                Trocar PDF
              </Button>
              <Button
                variant="outline"
                className="h-11 border-white/20 bg-white/5 text-[#f6f3ec] hover:bg-white/15 hover:text-white"
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 />
                Limpar
              </Button>
              <Button
                className="h-11 bg-[#e6a317] px-4 text-base text-[#1c2430] hover:bg-[#d39310]"
                disabled={filled === 0 || downloading}
                onClick={() => void download()}
              >
                <Download />
                {downloading ? "Gerando…" : filled > 0 ? `Baixar PDF · ${filled}` : "Baixar PDF"}
              </Button>
            </div>
          )}
        </div>
        {phase === "editor" && (
          <div className="h-1.5 bg-[#0f2744]">
            <div
              className="h-full bg-[#e6a317] transition-[width]"
              style={{ width: `${slots.length ? (filled / slots.length) * 100 : 0}%` }}
            />
          </div>
        )}
      </header>

      {error && (
        <div className="flex items-start justify-between gap-3 bg-[#f8e4e0] px-4 py-3 text-sm text-[#6e261c] sm:px-6">
          <p>{error}</p>
          <button type="button" className="shrink-0 font-semibold underline" onClick={() => setError(null)}>
            Fechar
          </button>
        </div>
      )}

      {phase === "home" && (
        <HomeScreen
          meta={meta}
          dragOver={dragOver}
          onBrowse={() => fileRef.current?.click()}
          onDrop={(file) => void takeFile(file)}
          onDrag={setDragOver}
          onResume={() => void resume()}
          onForget={() => void forgetSaved()}
        />
      )}

      {phase === "loading" && (
        <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-lg font-semibold">Lendo o panfleto</p>
          <p className="mt-2 max-w-md text-[#5e584e]">
            Procurando as caixas de preço. Página {Math.min(progress.done + 1, progress.total)} de{" "}
            {progress.total}.
          </p>
          <div className="mt-6 h-2 w-full max-w-sm overflow-hidden rounded-full bg-[#ddd4c4]">
            <div
              className="h-full bg-[#1d4e89]"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </main>
      )}

      {phase === "editor" && catalog && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <main className="flex h-[68vh] w-full shrink-0 flex-col lg:h-auto lg:min-h-0 lg:min-w-0 lg:flex-1">
            <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-3 text-sm sm:px-5">
                <Button
                  variant="outline"
                  className="h-11 bg-[#f7f4ee]"
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
                >
                  <ChevronLeft />
                  <span className="hidden sm:inline">Anterior</span>
                </Button>
                <div className="text-center">
                  <p className="font-semibold">
                    Página {pageIndex + 1} de {catalog.pageCount}
                  </p>
                  <p className="text-[#5e584e]">
                    {pageSlots.length === 0
                      ? "Sem preço nesta página"
                      : `${pageSlots.filter((slot) => parseMoney(prices[slot.id] ?? "") !== null).length} de ${pageSlots.length} preenchidos`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="h-11 bg-[#f7f4ee]"
                  disabled={pageIndex >= catalog.pageCount - 1}
                  onClick={() => setPageIndex((page) => Math.min(catalog.pageCount - 1, page + 1))}
                >
                  <span className="hidden sm:inline">Próxima</span>
                  <ChevronRight />
                </Button>
                <div className="hidden gap-2 sm:flex">
                  <Button
                    variant={zoom === "fit" ? "default" : "outline"}
                    className={`h-11 ${zoom === "fit" ? "" : "bg-[#f7f4ee]"}`}
                    onClick={() => setZoom("fit")}
                  >
                    Página inteira
                  </Button>
                  <Button
                    variant={zoom === "large" ? "default" : "outline"}
                    className={`h-11 ${zoom === "large" ? "" : "bg-[#f7f4ee]"}`}
                    onClick={() => setZoom("large")}
                  >
                    Ampliar
                  </Button>
                </div>
              </div>
              <div className="flex justify-center gap-2 px-3 pb-2 sm:hidden">
                <Button
                  variant={zoom === "fit" ? "default" : "outline"}
                  className={`h-10 ${zoom === "fit" ? "" : "bg-[#f7f4ee]"}`}
                  onClick={() => setZoom("fit")}
                >
                  Página inteira
                </Button>
                <Button
                  variant={zoom === "large" ? "default" : "outline"}
                  className={`h-10 ${zoom === "large" ? "" : "bg-[#f7f4ee]"}`}
                  onClick={() => setZoom("large")}
                >
                  Ampliar
                </Button>
              </div>

              {marking && (
                <p className="mx-auto mb-2 w-fit rounded-full bg-[#1d4e89] px-4 py-2 text-sm text-white">
                  Clique no meio da caixa de R$. Esc cancela.
                </p>
              )}

              <div ref={stageRef} className="min-h-0 flex-1 overflow-auto">
              <div className="flex min-h-full flex-col items-center px-2 py-4 sm:px-6">
              <div
                className="relative bg-white shadow-[0_18px_50px_rgba(28,36,48,0.16)]"
                style={{
                  width: cssWidth || undefined,
                  height:
                    pageBox.height ||
                    (cssWidth && pageSize ? cssWidth * (pageSize.height / pageSize.width) : undefined),
                }}
                onClick={placeManual}
              >
                <canvas ref={canvasRef} className="block" />
                {pageSlots.map((slot, index) => {
                  const value = prices[slot.id] ?? "";
                  const selected = slot.id === activeId;
                  const broken = invalid[slot.id];
                  return (
                    <div
                      key={slot.id}
                      className={`absolute rounded-[4px] ${
                        selected
                          ? "ring-2 ring-[#e6a317] ring-offset-1"
                          : "hover:ring-2 hover:ring-[#e6a317]/70"
                      } ${broken ? "ring-2 ring-[#a33b32]" : ""}`}
                      style={{
                        left: `${slot.nx * 100}%`,
                        top: `${slot.ny * 100}%`,
                        width: `${slot.nw * 100}%`,
                        height: `${slot.nh * 100}%`,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (marking) return;
                        focusSlot(slot.id);
                      }}
                    >
                      {coarse ? (
                        <button
                          type="button"
                          className="price-field cursor-text"
                          style={{ fontSize: Math.max(15, (pageBox.height || 0) * slot.nh * 0.5) }}
                        >
                          {value || <span className="font-semibold text-[#b7b1a6]">0,00</span>}
                        </button>
                      ) : (
                        <input
                          id={`price-${slot.id}`}
                          aria-label={`Preço do item ${index + 1} na página ${pageIndex + 1}`}
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="0,00"
                          className="price-field"
                          style={{ fontSize: Math.max(14, (pageBox.height || 0) * slot.nh * 0.5) }}
                          value={value}
                          onChange={(event) => {
                            const text = event.target.value;
                            setPrices((current) => ({ ...current, [slot.id]: text }));
                            setInvalid((flags) => {
                              if (!flags[slot.id]) return flags;
                              const copy = { ...flags };
                              delete copy[slot.id];
                              return copy;
                            });
                          }}
                          onFocus={() => setActiveId(slot.id)}
                          onBlur={() => commit(slot.id)}
                          onKeyDown={(event) => onPriceKeyDown(event, slot.id)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          </main>

          <aside className="shrink-0 border-t border-[#ddd4c4] bg-[#f7f4ee] lg:w-[22rem] lg:overflow-auto lg:border-t-0 lg:border-l">
            <div className="flex flex-col gap-4 p-4">
              <div>
                <p className="truncate text-sm text-[#5e584e]" title={catalog.name}>
                  {catalog.name}
                </p>
                <p className="mt-1 text-sm" aria-live="polite">
                  <span className="font-semibold">{filled}</span> de {slots.length} preços
                </p>
              </div>

              <div>
                <label htmlFor="price-composer" className="text-sm font-semibold">
                  {active
                    ? `Página ${active.pageIndex + 1} · item ${
                        slots.filter((slot) => slot.pageIndex === active.pageIndex).findIndex((slot) => slot.id === active.id) + 1
                      }`
                    : "Escolha um produto"}
                </label>
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-[#ddd4c4] bg-white px-3 focus-within:border-[#e6a317] focus-within:ring-2 focus-within:ring-[#e6a317]/40">
                  <span className="text-lg font-semibold text-[#5e584e]">R$</span>
                  <input
                    id="price-composer"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!active}
                    placeholder="0,00"
                    className="h-14 w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-[#b7b1a6]"
                    value={active ? (prices[active.id] ?? "") : ""}
                    onChange={(event) => {
                      if (!active) return;
                      const text = event.target.value;
                      setPrices((current) => ({ ...current, [active.id]: text }));
                    }}
                    onBlur={() => {
                      if (active) commit(active.id);
                    }}
                    onKeyDown={(event) => {
                      if (active) onPriceKeyDown(event, active.id);
                    }}
                  />
                </div>
                <p className="mt-2 text-sm text-[#5e584e]">
                  Digite 12,90 ou 1.250,00. Enter passa para o próximo item.
                </p>
                {active && invalid[active.id] && (
                  <p className="mt-1 text-sm font-medium text-[#a33b32]">
                    Não entendi este valor.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-11 bg-white" onClick={() => goRelative(-1)}>
                  <ChevronLeft />
                  Anterior
                </Button>
                <Button variant="outline" className="h-11 bg-white" onClick={() => goRelative(1)}>
                  Próximo
                  <ChevronRight />
                </Button>
                <Button className="col-span-2 h-11" onClick={goNextEmpty}>
                  Ir ao próximo vazio
                </Button>
              </div>

              {confirmClear ? (
                <div className="rounded-xl border border-[#e7c4be] bg-[#f8e4e0] p-3">
                  <p className="text-sm">Apagar todos os valores deste panfleto?</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="destructive"
                      className="h-10"
                      onClick={() => {
                        setPrices({});
                        setInvalid({});
                        setConfirmClear(false);
                      }}
                    >
                      Apagar
                    </Button>
                    <Button variant="outline" className="h-10 bg-white" onClick={() => setConfirmClear(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant={marking ? "default" : "outline"}
                  className={`h-10 ${marking ? "" : "bg-white"}`}
                  onClick={() => setMarking((value) => !value)}
                >
                  <Plus />
                  {marking ? "Clique na caixa" : "Marcar outra caixa"}
                </Button>
                {active && (
                  <Button variant="ghost" className="h-10" onClick={hideActive}>
                    Tirar este campo
                  </Button>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">Páginas</p>
                <div className="flex gap-1.5 overflow-x-auto pb-1 lg:grid lg:grid-cols-6 lg:overflow-visible">
                  {catalog.pageSizes.map((_, index) => {
                    const onPage = slots.filter((slot) => slot.pageIndex === index);
                    const done = onPage.filter((slot) => parseMoney(prices[slot.id] ?? "") !== null).length;
                    const complete = onPage.length > 0 && done === onPage.length;
                    const current = index === pageIndex;
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          setPageIndex(index);
                          const first = onPage[0];
                          if (first) setActiveId(first.id);
                        }}
                        className={`flex h-11 min-w-11 items-center justify-center rounded-lg border text-sm font-semibold ${
                          current
                            ? "border-[#1d4e89] bg-[#1d4e89] text-white"
                            : complete
                              ? "border-[#b7d7c2] bg-[#e5f3ea] text-[#1f6b3a]"
                              : "border-[#ddd4c4] bg-white text-[#1c2430]"
                        }`}
                        aria-label={`Página ${index + 1}`}
                      >
                        {complete ? <Check className="size-4" /> : index + 1}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs leading-relaxed text-[#5e584e]">
                O arquivo não sai deste navegador. O PDF baixado é o original, com os valores
                impressos nas caixas de R$.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function HomeScreen({
  meta,
  dragOver,
  onBrowse,
  onDrop,
  onDrag,
  onResume,
  onForget,
}: {
  meta: FileMeta | null;
  dragOver: boolean;
  onBrowse: () => void;
  onDrop: (file: File) => void;
  onDrag: (over: boolean) => void;
  onResume: () => void;
  onForget: () => void;
}) {
  return (
    <main className="flex-1 overflow-auto px-4 py-8 sm:px-6">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.8fr)] lg:items-center">
        <div>
          <h2 className="max-w-xl text-3xl leading-tight font-semibold sm:text-4xl">
            O panfleto chega com os preços em branco. Aqui eles entram no PDF.
          </h2>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#3d4654]">
            Solte o PDF do dia, digite o valor em cada produto e baixe o mesmo panfleto pronto
            para enviar. Nada é enviado para a internet.
          </p>
          <ol className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["1", "Abrir o PDF"],
              ["2", "Digitar cada R$"],
              ["3", "Baixar com os preços"],
            ].map(([number, label]) => (
              <li key={number} className="rounded-2xl bg-[#f7f4ee] px-4 py-3">
                <span className="text-sm font-semibold text-[#1d4e89]">{number}</span>
                <p className="font-medium">{label}</p>
              </li>
            ))}
          </ol>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            onDrag(true);
          }}
          onDragLeave={() => onDrag(false)}
          onDrop={(event) => {
            event.preventDefault();
            onDrag(false);
            const file = event.dataTransfer.files?.[0];
            if (file) onDrop(file);
          }}
          className={`rounded-3xl border-2 border-dashed p-3 transition ${
            dragOver ? "border-[#e6a317] bg-[#fff8e8]" : "border-[#cfc4b0] bg-[#f7f4ee]"
          }`}
        >
          <button
            type="button"
            onClick={onBrowse}
            className="flex w-full flex-col items-center rounded-2xl px-4 py-10 text-center"
          >
            <span className="mb-4 flex h-16 w-14 items-end justify-center rounded-md bg-white shadow-md">
              <span className="mb-2 rounded bg-[#e6a317] px-1.5 py-0.5 text-xs font-bold text-[#1c2430]">
                R$
              </span>
            </span>
            <span className="text-lg font-semibold">Solte o PDF aqui</span>
            <span className="mt-1 text-[#5e584e]">ou clique para escolher o arquivo</span>
          </button>
        </div>
      </div>

      {meta && (
        <section className="mx-auto mt-8 max-w-5xl rounded-2xl bg-[#f7f4ee] p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm text-[#5e584e]">Continuar de onde parou</p>
            <p className="font-semibold">{meta.name}</p>
            <p className="text-sm text-[#5e584e]">
              {meta.filled} de {meta.total} preços · salvo {formatSavedAt(meta.savedAt)}
            </p>
          </div>
          <div className="mt-3 flex gap-2 sm:mt-0">
            <Button className="h-11" onClick={onResume}>
              Continuar
            </Button>
            <Button variant="outline" className="h-11 bg-white" onClick={onForget}>
              Esquecer
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatSavedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(timestamp);
}
