"use client";

/* eslint-disable @next/next/no-img-element */
import { CircleAlert, CircleCheck, Download, Flag, ImageUp, Info, LoaderCircle, RotateCcw, Save, ScanLine } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { check, SUMMARY_FIELDS, type Receipt } from "@/lib/consistency";
import { useDecisions } from "@/lib/decisions";
import { CheckList, cloneReceipt, FIELD_LABEL, ReceiptFields } from "./ReceiptFields";
import { Banner, Button, Card, Pill } from "./ui";

export type Sample = { id: number; image: string; pred: Receipt | null; flagged: boolean };

type Current = { kind: "sample"; id: number; src: string } | { kind: "upload"; name: string; src: string };
type Live = "checking" | "on" | "off";

/** The live reader runs on a GPU machine. It is only contacted when one is configured, or when the site runs locally. */
function apiBase(): string | null {
  if (process.env.NEXT_PUBLIC_SUMPROOF_API) return process.env.NEXT_PUBLIC_SUMPROOF_API.replace(/\/$/, "");
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) return "http://localhost:8000";
  return null;
}

function toCsv(r: Receipt): string {
  const esc = (v: string | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["section", "name", "qty", "unit_price", "amount"].join(",")];
  for (const it of r.items ?? []) lines.push(["item", esc(it.name), esc(it.qty), esc(it.unit_price), esc(it.amount)].join(","));
  for (const f of SUMMARY_FIELDS) if (r[f]) lines.push(["summary", esc(FIELD_LABEL[f]), "", "", esc(r[f])].join(","));
  return lines.join("\n");
}

export function ScanReceipt({ samples }: { samples: Sample[] }) {
  const params = useSearchParams();
  const { decisions, save } = useDecisions();
  const [live, setLive] = useState<Live>("checking");
  const [current, setCurrent] = useState<Current | null>(null);
  const [reading, setReading] = useState<Receipt | null>(null);
  const [original, setOriginal] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples]);
  const picks = useMemo(() => {
    const ok = samples.filter((s) => !s.flagged).slice(0, 9);
    const toCheck = samples.filter((s) => s.flagged).slice(0, 3);
    return [...ok, ...toCheck].sort((a, b) => a.id - b.id);
  }, [samples]);

  useEffect(() => {
    const base = apiBase();
    if (!base) return setLive("off");
    fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) })
      .then((r) => r.json())
      .then((j) => setLive(j.ok ? "on" : "off"))
      .catch(() => setLive("off"));
  }, []);

  const reset = useCallback(() => {
    if (current?.kind === "upload") URL.revokeObjectURL(current.src);
    setCurrent(null);
    setReading(null);
    setOriginal(null);
    setError(null);
    setNotice(null);
    setSeconds(null);
    window.history.replaceState(null, "", "/");
  }, [current]);

  const openSample = useCallback(
    (id: number) => {
      const s = byId.get(id);
      if (!s) return;
      setCurrent({ kind: "sample", id, src: `/data/${s.image}` });
      setOriginal(cloneReceipt(s.pred));
      setReading(cloneReceipt(s.pred));
      setError(null);
      setNotice(null);
      setSeconds(null);
      window.history.replaceState(null, "", `/?sample=${id}`);
    },
    [byId],
  );

  // Open ?sample=N (links from the receipt inbox).
  useEffect(() => {
    const q = params.get("sample");
    if (q !== null && /^\d+$/.test(q)) openSample(Number(q));
  }, [params, openSample]);

  // A saved edit from this browser replaces the stored reading of a sample.
  const savedEdit = current?.kind === "sample" ? decisions[current.id]?.edited : undefined;
  useEffect(() => {
    if (savedEdit) setReading(cloneReceipt(savedEdit));
  }, [savedEdit]);

  const upload = async (file: File) => {
    const base = apiBase();
    if (!base || live !== "on") return;
    if (!file.type.startsWith("image/")) return setError("Please choose a photo (JPG, PNG or WebP).");
    if (file.size > 10 * 1024 * 1024) return setError("The photo is larger than 10 MB.");
    if (current?.kind === "upload") URL.revokeObjectURL(current.src);
    setCurrent({ kind: "upload", name: file.name, src: URL.createObjectURL(file) });
    setReading(null);
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`${base}/read`, { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || "The reader could not read this photo.");
      setOriginal(cloneReceipt(json.receipt));
      setReading(cloneReceipt(json.receipt));
      setSeconds(json.seconds ?? null);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "The reader stopped responding. Is the server still running?");
    } finally {
      setBusy(false);
    }
  };

  const update = (fn: (r: Receipt) => void) => {
    setReading((w) => {
      const n = cloneReceipt(w);
      fn(n);
      return n;
    });
    setNotice(null);
  };

  const checks = useMemo(() => (reading ? check(reading) : []), [reading]);
  const failed = checks.filter((c) => !c.passed).length;
  const edited = JSON.stringify(reading) !== JSON.stringify(original);

  const download = () => {
    if (!reading) return;
    const url = URL.createObjectURL(new Blob([toCsv(reading)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = current?.kind === "sample" ? `receipt-${current.id}.csv` : "receipt.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const decide = (status: "approved" | "review") => {
    if (current?.kind !== "sample" || !reading) return;
    save(current.id, { status, edited: edited || savedEdit ? reading : undefined, at: new Date().toISOString() });
    setNotice(status === "approved" ? "Saved." : "Flagged for a second look.");
  };

  const header = (
    <Banner
      crumbs={[{ label: "SumProof" }, { label: "Scan receipt" }]}
      title="Scan a receipt"
      pills={live === "on" ? <Pill tone="good">Reader online</Pill> : undefined}
      meta="Upload a photo of a receipt. SumProof reads every item and total, then checks that the numbers add up."
      right={
        current ? (
          <Button onClick={reset}>
            <ScanLine size={16} /> Scan another
          </Button>
        ) : undefined
      }
    />
  );

  if (!current) {
    const canUpload = live === "on";
    return (
      <>
        {header}
        <Card>
          <div
            role={canUpload ? "button" : undefined}
            tabIndex={canUpload ? 0 : -1}
            aria-disabled={!canUpload}
            onClick={() => canUpload && input.current?.click()}
            onKeyDown={(e) => canUpload && (e.key === "Enter" || e.key === " ") && input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (canUpload) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) upload(f);
            }}
            className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
              canUpload
                ? `cursor-pointer ${dragging ? "border-accent bg-accent-soft" : "border-accent/50 hover:border-accent hover:bg-accent-soft/50"}`
                : "border-line bg-sunken"
            }`}
          >
            <span className={`grid h-12 w-12 place-items-center rounded-full ${canUpload ? "bg-accent-soft text-accent" : "bg-surface-solid text-muted"}`}>
              {live === "checking" ? <LoaderCircle size={22} className="animate-spin" /> : <ImageUp size={22} />}
            </span>
            {canUpload ? (
              <>
                <p className="text-[16px] font-semibold text-ink">
                  Drop a receipt photo here or <span className="text-accent">browse</span>
                </p>
                <p className="text-[13px] text-muted">JPG, PNG or WebP, up to 10 MB · one receipt per photo</p>
              </>
            ) : live === "checking" ? (
              <p className="text-[14px] text-muted">Connecting to the receipt reader…</p>
            ) : (
              <>
                <p className="text-[16px] font-semibold text-ink">Uploading your own photo is offline in this online demo</p>
                <p className="max-w-[560px] text-[13.5px] leading-relaxed text-muted">
                  The reader is an AI model that needs a graphics card, which free hosting does not have. Try one of the sample receipts below:
                  each shows exactly what the model read.
                </p>
              </>
            )}
            {error && <p className="text-[13.5px] font-medium text-warn">{error}</p>}
            <input
              ref={input}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </div>
        </Card>

        <Card title="Try a sample receipt" className="mt-5" action={<Link href="/queue/" className="text-[13.5px] font-medium text-accent hover:underline">See all 100</Link>}>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {picks.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => openSample(s.id)}
                  className="group block w-full rounded-xl border border-line bg-surface-solid p-1.5 text-left transition hover:border-accent"
                >
                  <img src={`/data/${s.image}`} alt={`Sample receipt ${s.id}`} loading="lazy" className="aspect-[3/4] w-full rounded-lg object-cover object-top" />
                  <span className="mt-1.5 block px-0.5 text-[12.5px] font-medium text-ink">Receipt {s.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </>
    );
  }

  const status = busy ? null : !reading ? null : checks.length === 0 ? (
    <div className="flex items-start gap-3">
      <Info size={26} className="mt-0.5 shrink-0 text-muted" />
      <div>
        <p className="text-[17px] font-semibold text-ink">Couldn&apos;t cross-check the totals</p>
        <p className="mt-0.5 text-[13.5px] text-muted">This receipt doesn&apos;t show enough amounts to check against each other. Compare the numbers with the photo.</p>
      </div>
    </div>
  ) : failed === 0 ? (
    <div className="flex items-start gap-3">
      <CircleCheck size={26} className="mt-0.5 shrink-0 text-good" />
      <div>
        <p className="text-[17px] font-semibold text-ink">Everything adds up</p>
        <p className="mt-0.5 text-[13.5px] text-muted">The items, subtotal, tax and total agree with each other. Glance at the item names, then save.</p>
      </div>
    </div>
  ) : (
    <div className="flex items-start gap-3">
      <CircleAlert size={26} className="mt-0.5 shrink-0 text-warn" />
      <div>
        <p className="text-[17px] font-semibold text-ink">
          Please check {failed === 1 ? "one number" : `${failed} numbers`}
        </p>
        <p className="mt-0.5 text-[13.5px] text-muted">Something on this receipt doesn&apos;t add up. Compare the red row below with the photo and fix the field.</p>
      </div>
    </div>
  );

  return (
    <>
      {header}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card title={current.kind === "sample" ? `Sample receipt ${current.id}` : current.name}>
          <div className="overflow-hidden rounded-xl border border-line bg-sunken">
            <img src={current.src} alt="The receipt photo" className="mx-auto max-h-[640px] w-auto object-contain" />
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-5">
          {busy ? (
            <Card>
              <div className="flex items-center gap-3 py-6">
                <LoaderCircle size={24} className="animate-spin text-accent" />
                <div>
                  <p className="text-[16px] font-semibold text-ink">Reading the receipt…</p>
                  <p className="text-[13.5px] text-muted">This takes about 10 to 30 seconds.</p>
                </div>
              </div>
            </Card>
          ) : error ? (
            <Card>
              <div className="flex items-start gap-3">
                <CircleAlert size={24} className="mt-0.5 shrink-0 text-warn" />
                <div>
                  <p className="text-[16px] font-semibold text-ink">Couldn&apos;t read this photo</p>
                  <p className="mt-0.5 text-[13.5px] text-muted">{error}</p>
                </div>
              </div>
            </Card>
          ) : (
            reading && (
              <>
                <Card>{status}</Card>

                <Card
                  title="What SumProof read"
                  action={
                    edited ? (
                      <button
                        type="button"
                        onClick={() => setReading(cloneReceipt(original))}
                        className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
                      >
                        <RotateCcw size={14} /> Undo my edits
                      </button>
                    ) : null
                  }
                >
                  <p className="mb-3 text-[13px] text-muted">Click any value to correct it. The checks below update as you type.</p>
                  <ReceiptFields value={reading} update={update} />
                </Card>

                {checks.length > 0 && (
                  <Card title="Checks">
                    <CheckList checks={checks} />
                  </Card>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  {current.kind === "sample" && (
                    <>
                      <Button tone="accent" onClick={() => decide("approved")}>
                        <Save size={16} /> Save
                      </Button>
                      <Button onClick={() => decide("review")}>
                        <Flag size={15} /> Flag for a second look
                      </Button>
                    </>
                  )}
                  <Button tone={current.kind === "sample" ? "light" : "accent"} onClick={download}>
                    <Download size={16} /> Download CSV
                  </Button>
                  {notice && (
                    <span role="status" className="text-[13.5px] font-medium text-good">
                      {notice}
                    </span>
                  )}
                </div>
                <p className="text-[12.5px] text-muted">
                  {current.kind === "sample" ? "Sample receipts show the model's saved reading." : seconds !== null ? `Read in ${seconds} s on the local GPU.` : ""} AI can misread
                  names and numbers, so compare with the photo before you save.
                </p>
              </>
            )
          )}
        </div>
      </div>
    </>
  );
}
