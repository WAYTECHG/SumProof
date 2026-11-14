// Small hand-made SVG charts drawn from the real results (no chart library).

export function BarBreakdown({
  bars,
  max = 1,
  format = (v: number) => v.toFixed(2),
  label,
}: {
  bars: { label: string; value: number; highlight?: boolean; note?: string }[];
  max?: number;
  format?: (v: number) => string;
  label: string;
}) {
  return (
    <div role="img" aria-label={label} className="grid items-end gap-2.5 sm:gap-3.5" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
      {bars.map((b) => {
        const h = Math.max(6, (b.value / max) * 100);
        return (
          <div key={b.label} className="flex min-w-0 flex-col items-center gap-2" title={`${b.label}: ${format(b.value)}${b.note ? ` (${b.note})` : ""}`}>
            <div className="flex h-[150px] w-full flex-col items-center justify-end gap-1.5">
              <span
                className={`tabular rounded-md px-1.5 py-0.5 text-[11.5px] font-bold ${
                  b.highlight ? "bg-ink text-bg" : "border border-line bg-surface-solid text-ink"
                }`}
              >
                {format(b.value)}
              </span>
              <div
                className={`w-full max-w-[86px] rounded-xl transition-all ${b.highlight ? "accent-grad accent-glow" : "bg-ink/15"}`}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className={`text-center text-[12px] leading-tight ${b.highlight ? "font-bold text-ink" : "text-muted"}`}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TrainingCurve({
  log,
  val,
}: {
  log: { step: number; loss: number; lr: number }[];
  val: { field_f1: number; epoch: number }[];
}) {
  const W = 620;
  const H = 248;
  const pad = { l: 46, r: 16, t: 14, b: 50 };
  const maxStep = Math.max(...log.map((d) => d.step));
  const maxLoss = Math.ceil(Math.max(...log.map((d) => d.loss)) * 10) / 10;
  const x = (s: number) => pad.l + ((s - 1) / (maxStep - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / maxLoss) * (H - pad.t - pad.b);
  // light smoothing (moving average of 5 steps) so the trend is readable; raw loss is faint behind it
  const smooth = log.map((d, i) => {
    const win = log.slice(Math.max(0, i - 2), i + 3);
    return { step: d.step, loss: win.reduce((a, b) => a + b.loss, 0) / win.length };
  });
  const line = (pts: { step: number; loss: number }[]) => pts.map((d, i) => `${i ? "L" : "M"}${x(d.step).toFixed(1)},${y(d.loss).toFixed(1)}`).join(" ");
  const area = `${line(smooth)} L${x(maxStep)},${y(0)} L${x(1)},${y(0)} Z`;
  const ticks = [0, maxLoss / 2, maxLoss];
  const epochStep = 100;

  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img" aria-label="Training loss over 165 optimizer steps, falling from 0.43 to about 0.02">
          <defs>
            <linearGradient id="lossFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="3 4" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">
                {t.toFixed(2)}
              </text>
            </g>
          ))}
          <line x1={x(epochStep)} x2={x(epochStep)} y1={pad.t} y2={y(0)} stroke="var(--accent)" strokeDasharray="4 4" />
          <text x={x(epochStep) + 6} y={pad.t + 12} fontSize="12" fill="var(--accent-deep)" fontWeight="600">
            end of epoch 1 · checkpoint used
          </text>
          <path d={line(log)} fill="none" stroke="var(--muted)" strokeOpacity="0.35" strokeWidth="1" />
          <path d={area} fill="url(#lossFill)" />
          <path d={line(smooth)} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
          {[1, 50, 100, 150].map((s) => (
            <text key={s} x={x(s)} y={H - pad.b + 18} textAnchor="middle" fontSize="12" fill="var(--muted)">
              {s}
            </text>
          ))}
          <text x={(pad.l + W - pad.r) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--muted)">
            optimizer step (8 receipts each)
          </text>
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">Validation field F1 (30 receipts):</span>
        {val.map((v) => (
          <span key={v.epoch} className="tabular rounded-full border border-line bg-surface-solid px-2.5 py-1 font-semibold text-ink">
            epoch {v.epoch}: <span className="text-accent-deep">{v.field_f1.toFixed(2)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
