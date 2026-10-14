import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { Crystal, Neighbor } from "../lib/structure";
import type { BondSettings, BondTable } from "../lib/bonding";
import { pairKey } from "../lib/bonding";
import { SiteAnalysis, RadiusKind, spinsFor } from "../lib/analysis";
import { POLY_JA, elementColor, roman } from "../lib/data";
import { fmt, ionLabel, pct, rgbCss } from "../lib/format";

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

export function shapeName(sym: string | undefined, en: string | undefined) {
  if (!sym) return "—";
  return POLY_JA[sym] ?? en ?? sym;
}

export function cshmWord(s: number) {
  if (s < 0.5) return "ほぼ理想形";
  if (s < 1.5) return "わずかに歪み";
  if (s < 3) return "歪みあり";
  if (s < 6) return "大きく歪み";
  return "対応する理想形なし";
}

export default function SitePanel(p: Props) {
  const { crystal, ox, bonds, bondSettings, analysis: a } = p;
  if (!a) return <p className="muted">3D 表示の原子をクリックしてサイトを選んでください。</p>;
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
          <span>解析するサイト</span>
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
            ({P.frac.map((v) => v.toFixed(4)).join(", ")}) · 単位胞内 {crystal.groups.find((g) => g.key === a.group)?.positions.length} 個
          </div>
        </div>
        {(P.occupants.length > 1 || hostSpins.length > 1) && (
          <div className="row gap-s wrap">
            {P.occupants.length > 1 && (
              <label className="field-inline" htmlFor="host-occ">
                <span>置き換える元のイオン</span>
                <select id="host-occ" value={p.hostSite ?? a.host.site} onChange={(e) => p.setHostSite(parseInt(e.target.value, 10))}>
                  {P.occupants.map((o) => (
                    <option key={o.site} value={o.site}>
                      {crystal.sites[o.site].label} {ionLabel(crystal.sites[o.site].element, ox[crystal.sites[o.site].label])} (占有率 {o.occ})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {hostSpins.length > 1 && (
              <label className="field-inline" htmlFor="host-spin">
                <span>スピン状態</span>
                <select id="host-spin" value={p.hostSpin || "HS"} onChange={(e) => p.setHostSpin(e.target.value as "HS" | "LS")}>
                  {hostSpins.map((s) => (
                    <option key={s} value={s}>
                      {s === "HS" ? "高スピン (HS)" : "低スピン (LS)"}
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
          <span className="kpi-label">配位数</span>
          <span className="kpi-value">{a.cn}</span>
          <span className="kpi-sub">ECoN {fmt(a.econ, 2)}</span>
        </div>
        <div className="kpi kpi-wide">
          <span className="kpi-label">多面体</span>
          <span className="kpi-value kpi-text">{shapeName(best?.sym, best?.name)}</span>
          <span className="kpi-sub">{best ? `CShM ${fmt(best.cshm, 2)} · ${cshmWord(best.cshm)}` : "—"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">平均結合長</span>
          <span className="kpi-value mono">{fmt(a.dMean, 3)}</span>
          <span className="kpi-sub">Å</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">BVS</span>
          <span className="kpi-value mono">{fmt(a.bvsHost, 2)}</span>
          <span className="kpi-sub">形式価数 {Math.abs(a.host.ox)} ({pct(bvsDev, 0)})</span>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>結合距離のしきい値</h2>
          <span className="muted small">点 = 近接原子、塗り = 配位に含める</span>
        </div>
        <DistanceStrip crystal={crystal} neighbors={eligible} bonded={new Set(bonds.bonded[a.pos])} cut={cut} rmax={p.rmax} onCut={p.onCutoff} />
        <div className="row gap-s wrap cut-row">
          <ShellButtons neighbors={eligible} cut={cut} onCut={p.onCutoff} />
          <label className="field-inline" htmlFor="cut-input">
            <span>上限</span>
            <input id="cut-input" type="number" step={0.01} min={0.5} max={p.rmax} value={cut.toFixed(3)} onChange={(e) => +e.target.value > 0 && p.onCutoff(+e.target.value)} className="num" />
            <span>Å</span>
          </label>
          <div className="seg" role="radiogroup" aria-label="適用範囲">
            <button role="radio" aria-checked={p.cutScope === "pair"} className={p.cutScope === "pair" ? "is-on" : ""} onClick={() => p.setCutScope("pair")} title="同じ元素ペアのすべての結合に適用">
              {pairNames.length ? pairNames.join(", ") : "元素ペア"} 全体
            </button>
            <button role="radio" aria-checked={p.cutScope === "site"} className={p.cutScope === "site" ? "is-on" : ""} onClick={() => p.setCutScope("site")} title="このサイトの結合だけに適用">
              このサイトのみ
            </button>
          </div>
        </div>
        {override !== undefined && (
          <p className="note small">
            このサイトには個別のしきい値 {override.toFixed(3)} Å が設定されています。{" "}
            <button className="linkbtn" onClick={p.onClearOverride}>
              元素ペアの設定に戻す
            </button>
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>配位子</h2>
          <span className="muted small">r<sub>X</sub> は配位子自身の配位数でのシャノン半径</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>サイト</th>
                <th>イオン</th>
                <th className="num">d (Å)</th>
                <th className="num">配位子の CN</th>
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
                  <td className="num mono" title={l.rNote}>
                    {fmt(l.r, 3)}
                    {l.rNote && <sup className="approx">*</sup>}
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
          <h2>サイトの大きさ</h2>
          <div className="seg small" role="radiogroup" aria-label="半径の種類">
            <button role="radio" aria-checked={p.radiusKind === "ionic"} className={p.radiusKind === "ionic" ? "is-on" : ""} onClick={() => p.setRadiusKind("ionic")}>
              有効イオン半径
            </button>
            <button role="radio" aria-checked={p.radiusKind === "crystal"} className={p.radiusKind === "crystal" ? "is-on" : ""} onClick={() => p.setRadiusKind("crystal")}>
              結晶半径
            </button>
          </div>
        </div>
        <SizeGauge rSite={a.rSite} rHost={a.rHost?.r ?? null} hostLabel={`${ionLabel(a.host.el, a.host.ox)} (${a.rHost?.cnLabel ?? roman(a.cn)})`} />
        <dl className="metrics">
          <div>
            <dt>サイトの空間半径 r<sub>site</sub> = ⟨d − r<sub>X</sub>⟩</dt>
            <dd className="mono">{fmt(a.rSite, 3)} Å</dd>
          </div>
          <div>
            <dt>
              ホストのシャノン半径 {ionLabel(a.host.el, a.host.ox)} ({a.rHost?.cnLabel ?? roman(a.cn)})
            </dt>
            <dd className="mono">
              {fmt(a.rHost?.r, 3)} Å{a.rHost && !a.rHost.exact && <span className="approx-note"> {a.rHost.note}</span>}
            </dd>
          </div>
          <div>
            <dt>差 (r<sub>site</sub> − r<sub>host</sub>) / r<sub>host</sub></dt>
            <dd className="mono">{pct(fitDelta)}</dd>
          </div>
        </dl>
        <p className="note small">
          {fitDelta === null
            ? "酸化数が未設定か、シャノン表に該当イオンがないため空間半径を計算できません。「構造と結合」タブで酸化数を確認してください。"
            : Math.abs(fitDelta) < 0.05
              ? "結合距離とシャノン半径はよく一致しています。置換候補の比較はこの空間半径を基準に行います。"
              : fitDelta > 0
                ? "サイトはホストイオンに比べて広めです。少し大きいイオンも入りやすい傾向があります。"
                : "サイトはホストイオンに比べて窮屈です。少し小さいイオンのほうが収まりやすい傾向があります。"}
        </p>
        <button className="btn btn-primary btn-block" onClick={p.goSubst} id="go-subst">
          このサイトに入るイオンを探す →
        </button>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>多面体の形と歪み</h2>
        </div>
        <dl className="metrics">
          <div>
            <dt>結合長の範囲</dt>
            <dd className="mono">
              {fmt(a.dMin, 3)} – {fmt(a.dMax, 3)} Å
            </dd>
          </div>
          <div>
            <dt>歪み指数 Δ (Baur)</dt>
            <dd className="mono">{fmt(a.distortion, 4)}</dd>
          </div>
          {a.qe !== null && (
            <div>
              <dt>二次伸長 ⟨λ⟩</dt>
              <dd className="mono">{fmt(a.qe, 4)}</dd>
            </div>
          )}
          {a.bav !== null && (
            <div>
              <dt>結合角分散 σ² (deg²)</dt>
              <dd className="mono">{fmt(a.bav, 1)}</dd>
            </div>
          )}
          <div>
            <dt>多面体体積</dt>
            <dd className="mono">{a.volume ? `${a.volume.toFixed(3)} Å³` : "—"}</dd>
          </div>
        </dl>
        {a.shapes.length > 0 && (
          <div className="table-wrap">
            <table className="data compact">
              <thead>
                <tr>
                  <th>理想多面体（CN {a.cn}）</th>
                  <th className="num">CShM</th>
                </tr>
              </thead>
              <tbody>
                {a.shapes.slice(0, 5).map((s, i) => (
                  <tr key={s.sym} className={i === 0 ? "is-best" : ""}>
                    <td>
                      {shapeName(s.sym, s.name)} <span className="muted small">{s.name}</span>
                    </td>
                    <td className="num mono">{s.cshm.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">CShM: 連続形状尺度（0 で理想形と一致）。中心原子から配位子へのベクトルで評価しています。</p>
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
  const shells = shellsOf(neighbors);
  const inc = shells.filter((d) => d <= cut + 1e-9).length;
  const mid = (i: number) => (i + 1 < shells.length ? (shells[i] + shells[i + 1]) / 2 : shells[i] + 0.15);
  return (
    <div className="row gap-xs">
      <button className="btn btn-small" disabled={inc <= 1} onClick={() => onCut(inc >= 2 ? mid(inc - 2) : cut)} title="一番外側の配位殻を外す" id="shell-minus">
        − 殻
      </button>
      <button className="btn btn-small" disabled={inc >= shells.length} onClick={() => onCut(mid(inc))} title="次の配位殻まで含める" id="shell-plus">
        ＋ 殻
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
        aria-label="結合距離の上限"
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
  if (rSite === null && rHost === null) return null;
  const vals = [rSite, rHost].filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.min(...vals) * 0.7),
    hi = Math.max(...vals) * 1.3;
  const W = 520,
    H = 66,
    m = 70;
  const X = (r: number) => m + ((r - lo) / (hi - lo)) * (W - 2 * m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="gauge" role="img" aria-label="サイト半径とホスト半径の比較">
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
