// Small SVG chart kit: line, scatter, horizontal bar and 100%-stacked bar charts.
// Colours come from CSS tokens (--series-1 … --series-8, --ink, --muted, --grid) so both themes work.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";

/**
 * Track the rendered width so 1 SVG unit = 1 CSS pixel (text keeps its size at any width).
 * Returns the width, a ref object (for tooltip positioning) and a callback ref to attach.
 */
function useWidth(fallback = 560) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);
  const ref = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((n: HTMLDivElement | null) => {
    ref.current = n;
    setEl(n);
  }, []);
  useLayoutEffect(() => {
    if (!el) return;
    const set = (x: number) => x > 0 && setW(Math.max(260, Math.round(x)));
    set(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((e) => set(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { W: w, wrap: ref, attach };
}

/** Merge markers that would sit on top of each other ("2D" + "3D" → "2D/3D"). */
function mergeMarkers(ms: { x: number; label: string }[], X: (x: number) => number) {
  const out: { x: number; label: string }[] = [];
  for (const m of [...ms].sort((a, b) => a.x - b.x)) {
    const last = out[out.length - 1];
    if (last && Math.abs(X(m.x) - X(last.x)) < 22) last.label = `${last.label}/${m.label}`;
    else out.push({ ...m });
  }
  return out;
}

export const SERIES_COUNT = 8;
export const seriesColor = (slot: number) => (slot >= 0 && slot < SERIES_COUNT ? `var(--series-${slot + 1})` : "var(--series-other)");

/** Smallest span treated as non-zero, relative to the magnitude of the values. */
function minSpan(lo: number, hi: number) {
  return 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi));
}

/**
 * Widen a [lo, hi] range that is empty or only floating-point noise wide
 * (e.g. symmetry-equivalent values such as identical hop lengths) so axes stay readable.
 */
export function padRange(lo: number, hi: number, frac = 0.12): [number, number] {
  const span = hi - lo;
  const pad = span > minSpan(lo, hi) ? span * frac : Math.max(Math.abs(lo) * 0.05, 0.05);
  return [lo - pad, hi + pad];
}

export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (!(n > 0) || !Number.isFinite(n)) return [];
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi - lo <= minSpan(lo, hi)) [lo, hi] = padRange(lo, hi);
  const span = hi - lo;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  if (!(step > 0) || !Number.isFinite(step)) return [lo, hi];
  // Count ticks by integer index: an accumulating `t += step` can stall when step is
  // below the floating-point resolution of t, which froze the page (issue #2).
  const k0 = Math.ceil(lo / step - 1e-9),
    k1 = Math.floor(hi / step + 1e-9);
  const count = k1 - k0 + 1;
  if (!Number.isSafeInteger(k0) || !Number.isSafeInteger(k1) || count > 1000) return [lo, hi];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(+((k0 + i) * step).toPrecision(12));
  return out;
}

export const fmtTick = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1000) return `${+(v / 1000).toFixed(1)}K`;
  if (a === 0) return "0";
  if (a < 0.01) return v.toExponential(0);
  return String(+v.toPrecision(3));
};

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.content}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dash?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.label}>
          <i className={it.dash ? "dash" : ""} style={{ background: it.dash ? undefined : it.color, borderColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
export interface LineSeries {
  id: string;
  label: string;
  color: string;
  points: { x: number; y: number }[];
  dash?: boolean;
}

export function LineChart({
  series,
  xLabel,
  yLabel,
  height = 220,
  xDomain,
  yDomain,
  markers = [],
  annotations = [],
  area = false,
  xFmt = (v: number) => v.toFixed(2),
  yFmt = (v: number) => v.toFixed(3),
}: {
  series: LineSeries[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xDomain?: [number, number];
  yDomain?: [number, number];
  markers?: { x: number; label: string }[];
  annotations?: { x: number; y: number; text: string }[];
  area?: boolean;
  xFmt?: (v: number) => string;
  yFmt?: (v: number) => string;
}) {
  const t = useT();
  const { W, wrap, attach } = useWidth();
  const H = height,
    ml = 48,
    mr = 14,
    mt = markers.length ? 22 : 12,
    mb = 38;
  const [hx, setHx] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const all = series.flatMap((s) => s.points);
  const x0 = xDomain?.[0] ?? Math.min(...all.map((p) => p.x)),
    x1 = xDomain?.[1] ?? Math.max(...all.map((p) => p.x));
  const yMaxData = Math.max(...all.map((p) => p.y), 0);
  const y0 = yDomain?.[0] ?? Math.min(0, ...all.map((p) => p.y)),
    y1 = yDomain?.[1] ?? (yMaxData > 0 ? yMaxData * 1.08 : 1);
  const X = (x: number) => ml + ((x - x0) / (x1 - x0 || 1)) * (W - ml - mr);
  const Y = (y: number) => mt + (1 - (y - y0) / (y1 - y0 || 1)) * (H - mt - mb);
  const xt = niceTicks(x0, x1, 6),
    yt = niceTicks(y0, y1, 4);
  if (!all.length)
    return (
      <div ref={attach}>
        <p className="muted small">{t("chart.noData")}</p>
      </div>
    );

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    if (sx < ml || sx > W - mr) {
      setHx(null);
      setTip(null);
      return;
    }
    const xv = x0 + ((sx - ml) / (W - ml - mr)) * (x1 - x0);
    setHx(xv);
    const rows = series.map((s) => {
      let best = s.points[0];
      for (const p of s.points) if (Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p;
      return { s, p: best };
    });
    const wr = wrap.current!.getBoundingClientRect();
    setTip({
      x: Math.min(e.clientX - wr.left + 12, wr.width - 170),
      y: e.clientY - wr.top + 10,
      content: (
        <>
          <div className="tip-head">
            {xLabel} {xFmt(xv)}
          </div>
          {rows.map(({ s, p }) => (
            <div key={s.id} className="tip-row">
              <i style={{ background: s.color }} />
              <span>{s.label}</span>
              <b>{yFmt(p.y)}</b>
            </div>
          ))}
        </>
      ),
    });
  };

  return (
    <div className="chart" ref={attach}>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, dash: s.dash }))} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${yLabel} vs ${xLabel}`}
        onPointerMove={onMove}
        onPointerLeave={() => {
          setHx(null);
          setTip(null);
        }}
      >
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={ml} x2={W - mr} y1={Y(t)} y2={Y(t)} className="grid" />
            <text x={ml - 6} y={Y(t) + 4} textAnchor="end" className="tick">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={`x${t}`} x={X(t)} y={H - mb + 16} textAnchor="middle" className="tick">
            {fmtTick(t)}
          </text>
        ))}
        <line x1={ml} x2={W - mr} y1={Y(y0)} y2={Y(y0)} className="axis" />
        <text x={(ml + W - mr) / 2} y={H - 6} textAnchor="middle" className="axis-label">
          {xLabel}
        </text>
        <text x={12} y={(mt + H - mb) / 2} textAnchor="middle" className="axis-label" transform={`rotate(-90 12 ${(mt + H - mb) / 2})`}>
          {yLabel}
        </text>
        {mergeMarkers(
          markers.filter((m) => Number.isFinite(m.x) && m.x >= x0 && m.x <= x1),
          X,
        ).map((m, i) => (
            <g key={`m${i}`}>
              <line x1={X(m.x)} x2={X(m.x)} y1={mt - 4} y2={H - mb} className="marker" />
              <text x={X(m.x)} y={mt - 8} textAnchor="middle" className="marker-label">
                {m.label}
              </text>
            </g>
          ))}
        {series.map((s) => {
          const pts = s.points.filter((p) => p.x >= x0 && p.x <= x1);
          if (!pts.length) return null;
          const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(Math.min(y1, Math.max(y0, p.y))).toFixed(1)}`).join("");
          return (
            <g key={s.id}>
              {area && series.length === 1 && <path d={`${d}L${X(pts[pts.length - 1].x)},${Y(y0)}L${X(pts[0].x)},${Y(y0)}Z`} fill={s.color} opacity={0.1} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dash ? "5 4" : undefined} />
            </g>
          );
        })}
        {annotations
          .filter((a) => a.x >= x0 && a.x <= x1)
          .map((a, i) => (
            <text key={`a${i}`} x={X(a.x)} y={Y(Math.min(a.y, y1)) - 5} textAnchor="middle" className="annot">
              {a.text}
            </text>
          ))}
        {hx !== null && <line x1={X(hx)} x2={X(hx)} y1={mt} y2={H - mb} className="crosshair" />}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  detail?: string;
}

export function ScatterChart({
  points,
  xLabel,
  yLabel,
  height = 260,
  labels = true,
  xFmt = (v: number) => v.toPrecision(4),
  yFmt = (v: number) => v.toPrecision(4),
  r = 5,
  selected = null,
  onSelect,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  height?: number;
  labels?: boolean;
  xFmt?: (v: number) => string;
  yFmt?: (v: number) => string;
  r?: number;
  /** id of the highlighted point */
  selected?: string | null;
  /** makes the points buttons (click / Enter / Space) */
  onSelect?: (id: string) => void;
}) {
  const t = useT();
  const { W, wrap, attach } = useWidth();
  const H = height,
    ml = 54,
    mr = 90,
    mt = 16,
    mb = 40;
  const [tip, setTip] = useState<Tip | null>(null);
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const { x0, x1, y0, y1 } = useMemo(() => {
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y);
    const [a, b] = padRange(Math.min(...xs), Math.max(...xs));
    const [c, d] = padRange(Math.min(...ys), Math.max(...ys));
    return { x0: a, x1: b, y0: c, y1: d };
  }, [pts]);
  if (!pts.length)
    return (
      <div ref={attach}>
        <p className="muted small">{t("chart.noPairs")}</p>
      </div>
    );
  const X = (x: number) => ml + ((x - x0) / (x1 - x0)) * (W - ml - mr);
  const Y = (y: number) => mt + (1 - (y - y0) / (y1 - y0)) * (H - mt - mb);
  const xt = niceTicks(x0, x1, 5),
    yt = niceTicks(y0, y1, 4);
  return (
    <div className="chart" ref={attach}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} vs ${xLabel}`} onPointerLeave={() => setTip(null)}>
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={ml} x2={W - mr} y1={Y(t)} y2={Y(t)} className="grid" />
            <text x={ml - 6} y={Y(t) + 4} textAnchor="end" className="tick">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <g key={`x${t}`}>
            <line x1={X(t)} x2={X(t)} y1={mt} y2={H - mb} className="grid" />
            <text x={X(t)} y={H - mb + 16} textAnchor="middle" className="tick">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        <text x={(ml + W - mr) / 2} y={H - 6} textAnchor="middle" className="axis-label">
          {xLabel}
        </text>
        <text x={12} y={(mt + H - mb) / 2} textAnchor="middle" className="axis-label" transform={`rotate(-90 12 ${(mt + H - mb) / 2})`}>
          {yLabel}
        </text>
        {pts.map((p) => (
          <g
            key={p.id}
            className={onSelect ? "pt-button" : undefined}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={onSelect ? `${p.label}: ${xLabel} ${xFmt(p.x)}, ${yLabel} ${yFmt(p.y)}` : undefined}
            aria-pressed={onSelect ? selected === p.id : undefined}
            onClick={onSelect ? () => onSelect(p.id) : undefined}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(p.id);
                    }
                  }
                : undefined
            }
            onPointerEnter={(e) => {
              const wr = wrap.current!.getBoundingClientRect();
              setTip({
                x: Math.min(e.clientX - wr.left + 12, wr.width - 180),
                y: e.clientY - wr.top + 10,
                content: (
                  <>
                    <div className="tip-head">{p.label}</div>
                    <div className="tip-row">
                      <span>{xLabel}</span>
                      <b>{xFmt(p.x)}</b>
                    </div>
                    <div className="tip-row">
                      <span>{yLabel}</span>
                      <b>{yFmt(p.y)}</b>
                    </div>
                    {p.detail && <div className="tip-row muted">{p.detail}</div>}
                  </>
                ),
              });
            }}
            onPointerLeave={() => setTip(null)}
          >
            <circle cx={X(p.x)} cy={Y(p.y)} r={r + 7} fill="transparent" />
            {selected === p.id && <circle cx={X(p.x)} cy={Y(p.y)} r={r + 4.5} className="pt-selected" />}
            <circle cx={X(p.x)} cy={Y(p.y)} r={r} fill={p.color} stroke="var(--panel)" strokeWidth={2} />
            {labels && (
              <text x={X(p.x) + r + 4} y={Y(p.y) + 4} className="point-label">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export function BarChart({
  items,
  unit,
  fmt = (v: number) => v.toPrecision(4),
}: {
  items: { id: string; label: string; value: number | null; color: string }[];
  unit?: string;
  fmt?: (v: number) => string;
}) {
  const t = useT();
  const { W, attach } = useWidth();
  const valid = items.filter((i) => i.value !== null && Number.isFinite(i.value)) as { id: string; label: string; value: number; color: string }[];
  if (!valid.length)
    return (
      <div ref={attach}>
        <p className="muted small">{t("chart.noValues")}</p>
      </div>
    );
  const row = 30,
    ml = Math.min(150, W * 0.3),
    mr = 80,
    mt = 6;
  const H = mt + items.length * row + 22;
  const lo = Math.min(0, ...valid.map((i) => i.value)),
    hi = Math.max(0, ...valid.map((i) => i.value));
  const X = (v: number) => ml + ((v - lo) / (hi - lo || 1)) * (W - ml - mr);
  const ticks = niceTicks(lo, hi, W < 440 ? 3 : 4);
  return (
    <div className="chart" ref={attach}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("chart.bar")}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={mt} y2={H - 20} className="grid" />
            <text x={X(t)} y={H - 6} textAnchor="middle" className="tick">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {items.map((it, i) => {
          const y = mt + i * row;
          const v = it.value;
          const has = v !== null && Number.isFinite(v);
          const x0 = X(0),
            xv = has ? X(v as number) : x0;
          const left = Math.min(x0, xv),
            w = Math.abs(xv - x0);
          return (
            <g key={it.id}>
              <text x={ml - 8} y={y + row / 2 + 4} textAnchor="end" className="bar-label">
                {it.label.length > 22 ? it.label.slice(0, 21) + "…" : it.label}
              </text>
              {has ? (
                <>
                  <path d={roundedBar(left, y + 6, Math.max(w, 1), Math.min(18, row - 10), (v as number) >= 0)} fill={it.color} />
                  <text x={(v as number) >= 0 ? xv + 6 : xv - 6} y={y + row / 2 + 4} textAnchor={(v as number) >= 0 ? "start" : "end"} className="bar-value">
                    {fmt(v as number)}
                    {unit ? ` ${unit}` : ""}
                  </text>
                </>
              ) : (
                <text x={x0 + 6} y={y + row / 2 + 4} className="bar-value muted-fill">
                  —
                </text>
              )}
            </g>
          );
        })}
        <line x1={X(0)} x2={X(0)} y1={mt} y2={H - 20} className="axis" />
      </svg>
    </div>
  );
}

function roundedBar(x: number, y: number, w: number, h: number, right: boolean) {
  const r = Math.min(4, w, h / 2);
  if (right) return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
}

// ---------------------------------------------------------------------------
export function StackedBars({
  rows,
  keys,
}: {
  rows: { id: string; label: string; parts: Record<string, number> }[];
  keys: { key: string; label: string; color: string }[];
}) {
  const t = useT();
  const [tip, setTip] = useState<Tip | null>(null);
  const { W, wrap, attach } = useWidth();
  const row = 30,
    ml = 110,
    mr = 16;
  const H = rows.length * row + 4;
  return (
    <div className="chart" ref={attach}>
      <Legend items={keys.map((k) => ({ label: k.label, color: k.color }))} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("chart.fractions")} onPointerLeave={() => setTip(null)}>
        {rows.map((r, i) => {
          const tot = keys.reduce((s, k) => s + (r.parts[k.key] ?? 0), 0);
          const y = i * row + 4;
          let x = ml;
          const span = W - ml - mr;
          return (
            <g key={r.id}>
              <text x={ml - 8} y={y + 15} textAnchor="end" className="bar-label">
                {r.label}
              </text>
              {tot === 0 ? (
                <text x={ml} y={y + 15} className="bar-value muted-fill">
                  {t("chart.noLinks")}
                </text>
              ) : (
                keys.map((k) => {
                  const v = r.parts[k.key] ?? 0;
                  if (!v) return null;
                  const w = (v / tot) * span;
                  const x0 = x;
                  x += w;
                  return (
                    <rect
                      key={k.key}
                      x={x0 + 1}
                      y={y + 2}
                      width={Math.max(0, w - 2)}
                      height={20}
                      rx={3}
                      fill={k.color}
                      onPointerEnter={(e) => {
                        const wr = wrap.current!.getBoundingClientRect();
                        setTip({
                          x: Math.min(e.clientX - wr.left + 12, wr.width - 160),
                          y: e.clientY - wr.top + 10,
                          content: (
                            <>
                              <div className="tip-head">{r.label}</div>
                              <div className="tip-row">
                                <i style={{ background: k.color }} />
                                <span>{k.label}</span>
                                <b>
                                  {((v / tot) * 100).toFixed(0)}% ({+v.toFixed(2)})
                                </b>
                              </div>
                            </>
                          ),
                        });
                      }}
                    />
                  );
                })
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
