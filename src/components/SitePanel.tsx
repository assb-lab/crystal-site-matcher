import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { Crystal, Neighbor } from "../lib/structure";
import type { BondSettings, BondTable } from "../lib/bonding";
import { pairKey } from "../lib/bonding";
import { SiteAnalysis, RadiusKind, spinsFor } from "../lib/analysis";
import { elementColor, roman } from "../lib/data";
import { fmt, ionLabel, pct, rgbCss } from "../lib/format";
import { useI18n, useT } from "../i18n";
import { cshmWord, radiusNote, radiusNotes, shapeName } from "../i18n/domain";

interface Props {
  crystal: Crystal;
  ox: Record<string, number>;
  bonds: BondTable;
  bondSettings: BondSettings;
  analysis: SiteAnalysis | null;
  hostSite: number | undefined;
  setHostSite: (v: number | undefined) => void;
  hostSpin: "" | "HS" | "LS";
  setHostSpin: (v: "" | "HS" | "LS") => void;
  radiusKind: RadiusKind;
  setRadiusKind: (k: RadiusKind) => void;
  cutScope: "pair" | "site";
  setCutScope: (s: "pair" | "site") => void;
  onCutoff: (c: number) => void;
  onClearOverride: () => void;
  onSelectGroup: (g: string) => void;
  rmax: number;
  goSubst: () => void;
}

export default function SitePanel(p: Props) {
  const { t, lang } = useI18n();
  const { crystal, ox, bonds, bondSettings, analysis: a } = p;
  if (!a) return <p className="muted">{t("site.pick")}</p>;
  const P = crystal.positions[a.pos];
  const eligible = bonds.eligible[a.pos];
  const override = bondSettings.siteOverride[a.group];

  // effective cutoff currently applied to this site
  const ligEls = new Set<string>();
  for (const nb of eligible) for (const o of crystal.positions[nb.j].occupants) ligEls.add(crystal.sites[o.site].element);
  const hostEls = new Set(P.occupants.map((o) => crystal.sites[o.site].element));
  let pairCut = 0;
  const pairNames: string[] = [];
  for (const h of hostEls)
    for (const l of ligEls) {
      const r = bondSettings.pairs[pairKey(h, l)];
      if (r?.on) {
        pairCut = Math.max(pairCut, r.max);
        pairNames.push(`${h}–${l}`);
      }
    }
  const cut = override ?? pairCut;
  const best = a.shapes[0];
  const hostSpins = spinsFor(a.host.el, a.host.ox);
  const fitDelta = a.rSite !== null && a.rHost ? (a.rSite - a.rHost.r) / a.rHost.r : null;
  const bvsDev = a.bvsHost !== null && a.host.ox !== 0 ? a.bvsHost / Math.abs(a.host.ox) - 1 : null;

  return (
    <div className="stack">
      <div className="site-head">
        <label className="field" htmlFor="site-select">
          <span>{t("site.select")}</span>
          <select id="site-select" value={a.group} onChange={(e) => p.onSelectGroup(e.target.value)}>
            {crystal.groups.map((g) => {
              const q = crystal.positions[g.positions[0]];
              const ions = q.occupants.map((o) => ionLabel(crystal.sites[o.site].element, ox[crystal.sites[o.site].label])).join("/");
              return (
                <option key={g.key} value={g.key}>
                  {g.key} — {ions} · CN {bonds.bonded[q.index].length} · ×{g.positions.length}
                </option>
              );
            })}
          </select>
        </label>
        <div className="site-ident">
          <div className="ion-big">{ionLabel(a.host.el, a.host.ox, a.rHost?.spin || undefined)}</div>
          <div className="muted small mono">
            ({P.frac.map((v) => v.toFixed(4)).join(", ")}) · {t("site.inCell", { n: crystal.groups.find((g) => g.key === a.group)?.positions.length ?? 0 })}
          </div>
        </div>
        {(P.occupants.length > 1 || hostSpins.length > 1) && (
          <div className="row gap-s wrap">
            {P.occupants.length > 1 && (
              <label className="field-inline" htmlFor="host-occ">
                <span>{t("site.hostOcc")}</span>
                <select id="host-occ" value={p.hostSite ?? a.host.site} onChange={(e) => p.setHostSite(parseInt(e.target.value, 10))}>
                  {P.occupants.map((o) => (
                    <option key={o.site} value={o.site}>
                      {crystal.sites[o.site].label} {ionLabel(crystal.sites[o.site].element, ox[crystal.sites[o.site].label])} ({t("col.occ")} {o.occ})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {hostSpins.length > 1 && (
              <label className="field-inline" htmlFor="host-spin">
                <span>{t("site.spin")}</span>
                <select id="host-spin" value={p.hostSpin || "HS"} onChange={(e) => p.setHostSpin(e.target.value as "HS" | "LS")}>
                  {hostSpins.map((s) => (
                    <option key={s} value={s}>
                      {t(s === "HS" ? "site.hs" : "site.ls")}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{t("site.cn")}</span>
          <span className="kpi-value">{a.cn}</span>
          <span className="kpi-sub">ECoN {fmt(a.econ, 2)}</span>
        </div>
        <div className="kpi kpi-wide">
          <span className="kpi-label">{t("site.poly")}</span>
          <span className="kpi-value kpi-text">{shapeName(lang, best?.sym, best?.name)}</span>
          <span className="kpi-sub">{best ? `CShM ${fmt(best.cshm, 2)} · ${cshmWord(t, best.cshm)}` : "—"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t("site.dMean")}</span>
          <span className="kpi-value mono">{fmt(a.dMean, 3)}</span>
          <span className="kpi-sub">Å</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">BVS</span>
          <span className="kpi-value mono">{fmt(a.bvsHost, 2)}</span>
          <span className="kpi-sub">{t("site.formal", { v: Math.abs(a.host.ox) })} ({pct(bvsDev, 0)})</span>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>{t("site.cutoff")}</h2>
          <span className="muted small">{t("site.cutoffHint")}</span>
        </div>
        <DistanceStrip crystal={crystal} neighbors={eligible} bonded={new Set(bonds.bonded[a.pos])} cut={cut} rmax={p.rmax} onCut={p.onCutoff} />
        <div className="row gap-s wrap cut-row">
          <ShellButtons neighbors={eligible} cut={cut} onCut={p.onCutoff} />
          <label className="field-inline" htmlFor="cut-input">
            <span>{t("site.max")}</span>
            <input id="cut-input" type="number" step={0.01} min={0.5} max={p.rmax} value={cut.toFixed(3)} onChange={(e) => +e.target.value > 0 && p.onCutoff(+e.target.value)} className="num" />
            <span>Å</span>
          </label>
          <div className="seg" role="radiogroup" aria-label={t("site.scope")}>
            <button role="radio" aria-checked={p.cutScope === "pair"} className={p.cutScope === "pair" ? "is-on" : ""} onClick={() => p.setCutScope("pair")} title={t("site.scopePairTitle")}>
              {t("site.scopePair", { pairs: pairNames.length ? pairNames.join(", ") : t("site.elementPair") })}
            </button>
            <button role="radio" aria-checked={p.cutScope === "site"} className={p.cutScope === "site" ? "is-on" : ""} onClick={() => p.setCutScope("site")} title={t("site.scopeSiteTitle")}>
              {t("site.scopeSite")}
            </button>
          </div>
        </div>
        {override !== undefined && (
          <p className="note small">
            {t("site.overrideNote", { d: override.toFixed(3) })}{" "}
            <button className="linkbtn" onClick={p.onClearOverride}>
              {t("site.clearOverride")}
            </button>
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t("site.ligands")}</h2>
          <span className="muted small">{t("site.ligandsHint")}</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("col.site")}</th>
                <th>{t("col.ion")}</th>
                <th className="num">d (Å)</th>
                <th className="num">{t("site.ligandCn")}</th>
                <th className="num">r<sub>X</sub> (Å)</th>
                <th className="num">d − r<sub>X</sub></th>
              </tr>
            </thead>
            <tbody>
              {a.ligands.map((l, i) => (
                <tr key={i}>
                  <td>
                    <span className="dot" style={{ background: rgbCss(elementColor(l.species[0].el)) }} />
                    {l.label}
                  </td>
                  <td>{l.species.map((s) => ionLabel(s.el, s.ox)).join("/")}</td>
                  <td className="num mono">{l.nb.d.toFixed(3)}</td>
                  <td className="num mono">{l.cn}</td>
                  <td className="num mono" title={l.rNotes.length ? radiusNotes(t, l.rNotes) : undefined}>
                    {fmt(l.r, 3)}
                    {l.rNotes.length > 0 && <sup className="approx">*</sup>}
                  </td>
                  <td className="num mono">{l.r !== null ? (l.nb.d - l.r).toFixed(3) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t("site.size")}</h2>
          <div className="seg small" role="radiogroup" aria-label={t("site.radiusKind")}>
            <button role="radio" aria-checked={p.radiusKind === "ionic"} className={p.radiusKind === "ionic" ? "is-on" : ""} onClick={() => p.setRadiusKind("ionic")}>
              {t("site.ionic")}
            </button>
            <button role="radio" aria-checked={p.radiusKind === "crystal"} className={p.radiusKind === "crystal" ? "is-on" : ""} onClick={() => p.setRadiusKind("crystal")}>
              {t("site.crystalR")}
            </button>
          </div>
        </div>
        <SizeGauge rSite={a.rSite} rHost={a.rHost?.r ?? null} hostLabel={`${ionLabel(a.host.el, a.host.ox)} (${a.rHost?.cnLabel ?? roman(a.cn)})`} />
        <dl className="metrics">
          <div>
            <dt>{t("site.rSite")} r<sub>site</sub> = ⟨d − r<sub>X</sub>⟩</dt>
            <dd className="mono">{fmt(a.rSite, 3)} Å</dd>
          </div>
          <div>
            <dt>
              {t("site.rHost")} {ionLabel(a.host.el, a.host.ox)} ({a.rHost?.cnLabel ?? roman(a.cn)})
            </dt>
            <dd className="mono">
              {fmt(a.rHost?.r, 3)} Å{a.rHost && !a.rHost.exact && <span className="approx-note"> {radiusNote(t, a.rHost)}</span>}
            </dd>
          </div>
          <div>
            <dt>{t("site.diff")} (r<sub>site</sub> − r<sub>host</sub>) / r<sub>host</sub></dt>
            <dd className="mono">{pct(fitDelta)}</dd>
          </div>
        </dl>
        <p className="note small">
          {fitDelta === null
            ? t("site.fit.none")
            : Math.abs(fitDelta) < 0.05
              ? t("site.fit.match")
              : fitDelta > 0
                ? t("site.fit.wide")
                : t("site.fit.tight")}
        </p>
        <button className="btn btn-primary btn-block" onClick={p.goSubst} id="go-subst">
          {t("site.goSubst")} →
        </button>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t("site.shape")}</h2>
        </div>
        <dl className="metrics">
          <div>
            <dt>{t("site.dRange")}</dt>
            <dd className="mono">
              {fmt(a.dMin, 3)} – {fmt(a.dMax, 3)} Å
            </dd>
          </div>
          <div>
            <dt>{t("site.baur")} Δ (Baur)</dt>
            <dd className="mono">{fmt(a.distortion, 4)}</dd>
          </div>
          {a.qe !== null && (
            <div>
              <dt>{t("site.qe")} ⟨λ⟩</dt>
              <dd className="mono">{fmt(a.qe, 4)}</dd>
            </div>
          )}
          {a.bav !== null && (
            <div>
              <dt>{t("site.bav")} σ² (deg²)</dt>
              <dd className="mono">{fmt(a.bav, 1)}</dd>
            </div>
          )}
          <div>
            <dt>{t("site.volume")}</dt>
            <dd className="mono">{a.volume ? `${a.volume.toFixed(3)} Å³` : "—"}</dd>
          </div>
        </dl>
        {a.shapes.length > 0 && (
          <div className="table-wrap">
            <table className="data compact">
              <thead>
                <tr>
                  <th>{t("site.ideal", { cn: a.cn })}</th>
                  <th className="num">CShM</th>
                </tr>
              </thead>
              <tbody>
                {a.shapes.slice(0, 5).map((s, i) => (
                  <tr key={s.sym} className={i === 0 ? "is-best" : ""}>
                    <td>
                      {shapeName(lang, s.sym, s.name)} {lang === "ja" && <span className="muted small">{s.name}</span>}
                    </td>
                    <td className="num mono">{s.cshm.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">{t("site.cshmNote")}</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function shellsOf(neighbors: Neighbor[]): number[] {
  const out: number[] = [];
  for (const n of neighbors) if (!out.length || n.d - out[out.length - 1] > 0.015) out.push(n.d);
  return out;
}

function ShellButtons({ neighbors, cut, onCut }: { neighbors: Neighbor[]; cut: number; onCut: (c: number) => void }) {
  const t = useT();
  const shells = shellsOf(neighbors);
  const inc = shells.filter((d) => d <= cut + 1e-9).length;
  const mid = (i: number) => (i + 1 < shells.length ? (shells[i] + shells[i + 1]) / 2 : shells[i] + 0.15);
  return (
    <div className="row gap-xs">
      <button className="btn btn-small" disabled={inc <= 1} onClick={() => onCut(inc >= 2 ? mid(inc - 2) : cut)} title={t("site.shellMinusTitle")} id="shell-minus">
        − {t("site.shell")}
      </button>
      <button className="btn btn-small" disabled={inc >= shells.length} onClick={() => onCut(mid(inc))} title={t("site.shellPlusTitle")} id="shell-plus">
        + {t("site.shell")}
      </button>
    </div>
  );
}

function DistanceStrip({
  crystal,
  neighbors,
  bonded,
  cut,
  rmax,
  onCut,
}: {
  crystal: Crystal;
  neighbors: Neighbor[];
  bonded: Set<Neighbor>;
  cut: number;
  rmax: number;
  onCut: (c: number) => void;
}) {
  const W = 520,
    H = 132,
    ml = 14,
    mr = 14,
    base = 92;
  const t = useT();
  const [local, setLocal] = useState<number | null>(null);
  const dragging = useRef(false);
  const lastCount = useRef(-1);
  const svgRef = useRef<SVGSVGElement>(null);
  const shown = local ?? cut;

  const dmin = neighbors.length ? neighbors[0].d : 1.5;
  const xMin = Math.max(0, Math.floor((dmin - 0.25) * 10) / 10);
  const xMax = Math.min(rmax, Math.max(cut + 1.2, xMin + 1.6));
  const X = (d: number) => ml + ((d - xMin) / (xMax - xMin)) * (W - ml - mr);
  const D = (x: number) => xMin + ((x - ml) / (W - ml - mr)) * (xMax - xMin);

  const vis = useMemo(() => neighbors.filter((n) => n.d <= xMax), [neighbors, xMax]);
  const stacks = useMemo(() => {
    const out: { n: Neighbor; k: number }[] = [];
    let last = -1,
      k = 0;
    for (const n of vis) {
      if (Math.abs(n.d - last) < 0.012) k++;
      else k = 0;
      last = n.d;
      out.push({ n, k });
    }
    return out;
  }, [vis]);

  useEffect(() => {
    if (!dragging.current) setLocal(null);
  }, [cut]);

  const fromEvent = (e: RPointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    return Math.max(xMin, Math.min(xMax, D(x)));
  };
  const countAt = (c: number) => neighbors.filter((n) => n.d <= c).length;
  const onDown = (e: RPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging.current = true;
    const c = fromEvent(e);
    setLocal(c);
    lastCount.current = countAt(c);
    onCut(c);
  };
  const onMove = (e: RPointerEvent) => {
    if (!dragging.current) return;
    const c = fromEvent(e);
    setLocal(c);
    const n = countAt(c);
    if (n !== lastCount.current) {
      lastCount.current = n;
      onCut(c);
    }
  };
  const onUp = (e: RPointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    onCut(fromEvent(e));
  };

  const ticks: number[] = [];
  for (let t = Math.ceil(xMin * 2) / 2; t <= xMax + 1e-9; t += 0.5) ticks.push(+t.toFixed(2));
  const cnShown = neighbors.filter((n) => n.d <= shown && bonded.has(n)).length;
  const cnPreview = local !== null ? countAt(local) : cnShown;

  return (
    <div className="strip">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        aria-label={t("site.cutoffMax")}
        aria-valuemin={xMin}
        aria-valuemax={xMax}
        aria-valuenow={+shown.toFixed(3)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onCut(cut + 0.01);
          if (e.key === "ArrowLeft") onCut(Math.max(0.5, cut - 0.01));
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <rect x={ml} y={14} width={Math.max(0, X(shown) - ml)} height={base - 8} className="strip-in" />
        <line x1={ml} x2={W - mr} y1={base + 8} y2={base + 8} className="strip-axis" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={base + 8} y2={base + 13} className="strip-axis" />
            <text x={X(t)} y={base + 27} textAnchor="middle" className="strip-tick">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={W - mr} y={base + 27} textAnchor="end" className="strip-tick">
          Å
        </text>
        {stacks.map(({ n, k }, i) => {
          const el = crystal.sites[crystal.positions[n.j].main].element;
          const inc = local !== null ? n.d <= local : bonded.has(n);
          const col = rgbCss(elementColor(el));
          return (
            <circle key={i} cx={X(n.d)} cy={base - 2 - k * 11.5} r={4.6} fill={inc ? col : "var(--panel)"} stroke={inc ? "var(--ink)" : col} strokeWidth={inc ? 0.8 : 1.6}>
              <title>
                {crystal.positions[n.j].group} {n.d.toFixed(3)} Å
              </title>
            </circle>
          );
        })}
        <line x1={X(shown)} x2={X(shown)} y1={8} y2={base + 8} className="strip-cut" />
        <g transform={`translate(${Math.min(Math.max(X(shown), ml + 60), W - mr - 60)}, 0)`}>
          <rect x={-60} y={0} width={120} height={19} rx={9.5} className="strip-badge" />
          <text x={0} y={13} textAnchor="middle" className="strip-badge-text">
            ≤ {shown.toFixed(3)} Å · CN {cnPreview}
          </text>
        </g>
      </svg>
    </div>
  );
}

function SizeGauge({ rSite, rHost, hostLabel }: { rSite: number | null; rHost: number | null; hostLabel: string }) {
  const t = useT();
  if (rSite === null && rHost === null) return null;
  const vals = [rSite, rHost].filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.min(...vals) * 0.7),
    hi = Math.max(...vals) * 1.3;
  const W = 520,
    H = 66,
    m = 70;
  const X = (r: number) => m + ((r - lo) / (hi - lo)) * (W - 2 * m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="gauge" role="img" aria-label={t("site.gauge")}>
      <line x1={m} x2={W - m} y1={34} y2={34} className="strip-axis" />
      {rSite !== null && (
        <>
          <rect x={X(rSite * 0.85)} y={26} width={X(rSite * 1.15) - X(rSite * 0.85)} height={16} rx={3} className="gauge-band" />
          <line x1={X(rSite)} x2={X(rSite)} y1={20} y2={48} className="gauge-site" />
          <text x={X(rSite)} y={14} textAnchor="middle" className="gauge-label">
            r_site {rSite.toFixed(3)}
          </text>
        </>
      )}
      {rHost !== null && (
        <>
          <circle cx={X(rHost)} cy={34} r={6} className="gauge-host" />
          <text x={X(rHost)} y={60} textAnchor="middle" className="gauge-label">
            {hostLabel} {rHost.toFixed(3)}
          </text>
        </>
      )}
    </svg>
  );
}
