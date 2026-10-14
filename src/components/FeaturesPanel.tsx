import { useMemo, useState } from "react";
import type { Doc } from "../lib/doc";
import type { FeatureEntry } from "../lib/useFeatures";
import { FEATURE_DEFS, FEATURE_BY_KEY, FeatureDef, FeatureValue, GROUP_LABEL, FeatureGroup } from "../lib/features";
import { bvseSupported } from "../lib/bvse";
import { shannonRadius } from "../lib/analysis";
import { POLY_JA } from "../lib/data";
import { fmt, ionLabel } from "../lib/format";
import { LineChart, ScatterChart, StackedBars, seriesColor } from "./charts";

interface Props {
  doc: Doc;
  update: (f: (d: Doc) => Partial<Doc>) => void;
  entry: FeatureEntry | undefined;
  error?: string;
}

export function fmtFeature(def: FeatureDef | undefined, v: FeatureValue | undefined): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "—";
  const d = def?.digits ?? 3;
  return v.toFixed(d);
}

export const SHARE_KEYS = [
  { key: "corner", label: "頂点共有", color: seriesColor(0) },
  { key: "edge", label: "稜共有", color: seriesColor(1) },
  { key: "face", label: "面共有", color: seriesColor(2) },
];

export function autoIsoLevel(entry: FeatureEntry | undefined): number {
  const E = entry?.grid?.E;
  if (!E) return 1;
  const pick = [E[2], E[1], E[0]].find((x) => Number.isFinite(x) && x < 3);
  return pick !== undefined ? +(pick + 0.15).toFixed(2) : 1;
}

export default function FeaturesPanel({ doc, update, entry, error }: Props) {
  const cr = doc.crystal;
  const elements = [...new Set(cr.sites.map((s) => s.element))];
  const mobileQ = doc.mobile ? (doc.ox[cr.sites.find((s) => s.element === doc.mobile)?.label ?? ""] ?? 0) : 0;
  const supported = doc.mobile ? bvseSupported(doc.mobile, mobileQ) : false;
  const v = entry?.values ?? {};
  const st = entry?.static;
  const grid = entry?.grid;
  const anionEls = [...new Set(cr.sites.filter((s) => (doc.ox[s.label] ?? 0) < 0).map((s) => s.element))];
  const defaultPairs = useMemo(() => {
    const m = doc.mobile;
    const pairs = st?.prdf.map((p) => p.pair) ?? [];
    const pick = pairs.filter((p) => {
      const [a, b] = p.split("–");
      return (m && (a === m || b === m)) || (anionEls.includes(a) && anionEls.includes(b));
    });
    return pick.length ? pick.slice(0, 4) : pairs.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, doc.mobile]);
  const [pairs, setPairs] = useState<string[] | null>(null);
  const shownPairs = (pairs ?? defaultPairs).filter((p) => st?.prdf.some((x) => x.pair === p));
  const rM = doc.mobile ? shannonRadius(doc.mobile, Math.round(mobileQ), 6, { kind: "ionic" }) : null;
  const isoLevel = doc.view.isoLevel ?? autoIsoLevel(entry);
  const setView = (patch: Partial<Doc["view"]>) => update((d) => ({ view: { ...d.view, ...patch } }));

  const copyTsv = () => {
    const lines = FEATURE_DEFS.map((d) => `${GROUP_LABEL[d.group]}\t${d.label}\t${fmtFeature(d, v[d.key])}\t${d.unit ?? ""}`);
    const text = ["分類\t特徴量\t値\t単位", ...lines].join("\n");
    navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>計算条件</h2>
          {entry?.gridStatus === "running" && <span className="muted small">BVSE グリッド計算中 {Math.round((entry.progress ?? 0) * 100)}%</span>}
        </div>
        <div className="row gap-s wrap">
          <label className="field-inline" htmlFor="mobile-el">
            <span>可動イオン</span>
            <select id="mobile-el" value={doc.mobile ?? ""} onChange={(e) => update(() => ({ mobile: e.target.value || null }))}>
              <option value="">なし</option>
              {elements.map((el) => {
                const s = cr.sites.find((x) => x.element === el)!;
                return (
                  <option key={el} value={el}>
                    {ionLabel(el, doc.ox[s.label])}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="field-inline" htmlFor="hop-cut">
            <span>ホップ距離 ≤</span>
            <input id="hop-cut" className="num" type="number" min={1.5} max={6} step={0.1} value={doc.hopCutoff} onChange={(e) => +e.target.value > 0 && update(() => ({ hopCutoff: +e.target.value }))} />
            <span>Å</span>
          </label>
          <label className="field-inline" htmlFor="grid-res">
            <span>グリッド間隔</span>
            <select id="grid-res" value={doc.gridRes} onChange={(e) => update(() => ({ gridRes: +e.target.value }))}>
              {[0.3, 0.25, 0.2, 0.15].map((r) => (
                <option key={r} value={r}>
                  {r} Å
                </option>
              ))}
            </select>
          </label>
        </div>
        {entry?.gridStatus === "running" && (
          <div className="progress" role="progressbar" aria-valuenow={Math.round(entry.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.round(entry.progress * 100)}%` }} />
          </div>
        )}
        {doc.mobile && !supported && <p className="note small">{ionLabel(doc.mobile, mobileQ)} の softBV パラメータがないため BVSE は計算できません（空隙解析のみ行います）。</p>}
        {grid?.setup.missing.length ? <p className="note small">softBV パラメータのない対イオン（{grid.setup.missing.join(", ")}）は BVSE から除外しています。</p> : null}
        {error && <p className="note small warn-note">特徴量を計算できませんでした: {error}</p>}
      </section>

      {!entry ? (
        <p className="muted">特徴量を計算しています…</p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="BVSE 障壁 1D" value={fmtFeature(FEATURE_BY_KEY.E_1D, v.E_1D)} unit="eV" sub={grid ? "" : entry.gridStatus === "none" ? "可動イオンなし" : "計算中"} />
            <Kpi label="BVSE 障壁 3D" value={fmtFeature(FEATURE_BY_KEY.E_3D, v.E_3D)} unit="eV" sub={grid && !Number.isFinite(grid.E[2]) ? "6 eV 以下で 3D 浸透なし" : ""} />
            <Kpi label="可動イオン密度" value={fmtFeature(FEATURE_BY_KEY.rho_mobile, v.rho_mobile)} unit="nm⁻³" sub={doc.mobile ? `空孔率 ${fmtFeature(FEATURE_BY_KEY.vacancy, v.vacancy)}` : ""} />
            <Kpi label="GII" value={fmtFeature(FEATURE_BY_KEY.GII, v.GII)} unit="v.u." sub={typeof v.GII === "number" ? (v.GII < 0.1 ? "安定" : v.GII < 0.2 ? "ややひずみ" : "ひずみ大") : ""} />
          </div>

          <section className="card">
            <div className="card-head">
              <h2>BVSE エネルギー地形</h2>
              <span className="muted small">ΔE 以下の領域の体積分率。縦線が浸透（1D/2D/3D）の閾値</span>
            </div>
            {grid?.energy ? (
              <>
                <LineChart
                  series={[{ id: "e", label: "体積分率", color: seriesColor(0), points: grid.energyCurve.map((p) => ({ x: p.x, y: p.y * 100 })) }]}
                  xLabel="ΔE (eV)"
                  yLabel="体積分率 (%)"
                  area
                  markers={(["1D", "2D", "3D"] as const).map((l, i) => ({ x: grid.E[i], label: l }))}
                  xFmt={(x) => x.toFixed(2)}
                  yFmt={(y) => y.toFixed(1) + "%"}
                />
                <div className="row gap-s wrap">
                  <label className="checkline" htmlFor="show-iso">
                    <input id="show-iso" type="checkbox" checked={doc.view.showIso} onChange={(e) => setView({ showIso: e.target.checked })} /> 3D に等エネルギー面を表示
                  </label>
                  <label className="slider grow" htmlFor="iso-level">
                    <span>ΔE</span>
                    <input
                      id="iso-level"
                      type="range"
                      min={0.05}
                      max={Math.max(2, (Number.isFinite(grid.E[2]) ? grid.E[2] : 2) * 1.5)}
                      step={0.01}
                      value={isoLevel}
                      onChange={(e) => setView({ isoLevel: +e.target.value, showIso: true })}
                    />
                    <span className="mono">{isoLevel.toFixed(2)} eV</span>
                  </label>
                </div>
                {entry.siteE && entry.siteE.length > 0 && (
                  <p className="muted small">
                    可動イオンサイトの BVSE: {[...new Map(entry.siteE.map((s) => [s.group, s.E])).entries()].map(([g, e]) => `${g} ${Math.abs(e) < 0.005 ? "0.00" : e.toFixed(2)} eV`).join("、")}
                  </p>
                )}
              </>
            ) : (
              <p className="muted small">{entry.gridStatus === "running" || entry.gridStatus === "pending" ? "計算中です…" : "可動イオンを選ぶと計算します。"}</p>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>空隙とボトルネック</h2>
              <span className="muted small">骨格イオン表面からの距離 ≥ r の領域の体積分率</span>
            </div>
            {grid ? (
              <LineChart
                series={[{ id: "v", label: "体積分率", color: seriesColor(2), points: grid.voidCurve.map((p) => ({ x: p.x, y: p.y * 100 })) }]}
                xLabel="プローブ半径 r (Å)"
                yLabel="体積分率 (%)"
                area
                markers={[
                  ...(["1D", "2D", "3D"] as const).map((l, i) => ({ x: grid.R[i], label: l })),
                  ...(rM ? [{ x: rM.r, label: `r(${doc.mobile})` }] : []),
                ]}
                xFmt={(x) => x.toFixed(2) + " Å"}
                yFmt={(y) => y.toFixed(1) + "%"}
              />
            ) : (
              <p className="muted small">{doc.mobile ? "計算中です…" : "可動イオンを選ぶと計算します。"}</p>
            )}
            {st && st.hops.length > 0 && (
              <>
                <div className="card-head">
                  <h3>可動イオン間のホップ（{st.hops.length} 本）</h3>
                  <label className="checkline" htmlFor="show-hops">
                    <input id="show-hops" type="checkbox" checked={doc.view.showHops} onChange={(e) => setView({ showHops: e.target.checked })} /> 3D に表示
                  </label>
                  <span className="hop-legend small muted">
                    3D の色: <i style={{ background: "rgb(227,73,72)" }} />狭い <i style={{ background: "rgb(237,161,0)" }} /> <i style={{ background: "rgb(27,175,122)" }} />広い
                  </span>
                </div>
                <ScatterChart
                  points={st.hops.map((h, i) => ({
                    id: String(i),
                    x: h.d,
                    y: h.rb,
                    label: `${cr.positions[h.a].group}→${cr.positions[h.b].group}`,
                    color: seriesColor(0),
                  }))}
                  labels={false}
                  xLabel="ホップ距離 (Å)"
                  yLabel="ボトルネック半径 (Å)"
                  height={220}
                  xFmt={(x) => x.toFixed(3) + " Å"}
                  yFmt={(y) => y.toFixed(3) + " Å"}
                  r={4}
                />
                <p className="muted small">ボトルネック半径はサイト間を結ぶ直線上で、骨格イオン（シャノン半径の球）の表面までの最短距離。曲がった実際の経路より小さめに出ます。</p>
              </>
            )}
          </section>

          {st && (
            <section className="card">
              <div className="card-head">
                <h2>部分動径分布関数 g(r)</h2>
              </div>
              <div className="chips">
                {st.prdf.map((p) => {
                  const on = shownPairs.includes(p.pair);
                  return (
                    <button
                      key={p.pair}
                      className={`elchip ${on ? "is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => setPairs(on ? shownPairs.filter((x) => x !== p.pair) : [...shownPairs, p.pair].slice(-8))}
                    >
                      {p.pair}
                    </button>
                  );
                })}
              </div>
              <LineChart
                series={shownPairs.map((pair, i) => ({ id: pair, label: pair, color: seriesColor(i), points: st.prdf.find((p) => p.pair === pair)!.points }))}
                xLabel="r (Å)"
                yLabel="g(r)"
                xDomain={[0, 8]}
                xFmt={(x) => x.toFixed(2) + " Å"}
                yFmt={(y) => y.toFixed(2)}
              />
            </section>
          )}

          {st && (
            <section className="card">
              <div className="card-head">
                <h2>多面体の連結</h2>
                <span className="muted small">陰イオンを 1 / 2 / 3 個以上共有する多面体対の割合</span>
              </div>
              <StackedBars
                keys={SHARE_KEYS}
                rows={[
                  { id: "frame", label: "骨格–骨格", parts: { ...st.sharing.frame } },
                  { id: "mm", label: "可動–可動", parts: { ...st.sharing.mm } },
                  { id: "mf", label: "可動–骨格", parts: { ...st.sharing.mf } },
                ]}
              />
              <p className="muted small">骨格の孤立多面体の割合 {fmtFeature(FEATURE_BY_KEY.frame_isolated, v.frame_isolated)}</p>
            </section>
          )}

          {st && (
            <section className="card">
              <div className="card-head">
                <h2>サイトごとの値</h2>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>サイト</th>
                      <th>イオン</th>
                      <th className="num">×</th>
                      <th className="num">CN</th>
                      <th className="num">⟨d⟩</th>
                      <th className="num">BVS</th>
                      <th className="num">不整合</th>
                      <th className="num">Δ</th>
                      <th>形 (CShM)</th>
                      {entry.siteE && <th className="num">E_site</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {st.sites.map((s) => {
                      const e = entry.siteE?.find((x) => x.group === s.group);
                      return (
                        <tr key={s.group} className={s.mobile ? "is-host" : ""}>
                          <td>{s.group}</td>
                          <td>{ionLabel(s.el, s.ox)}</td>
                          <td className="num mono">{s.mult}</td>
                          <td className="num mono">{s.cn}</td>
                          <td className="num mono">{fmt(s.cn ? s.dMean : null, 3)}</td>
                          <td className="num mono">{fmt(s.bvs, 2)}</td>
                          <td className={`num mono ${s.bvsDev !== null && Math.abs(s.bvsDev) > 0.15 ? "warn-note" : ""}`}>{s.bvsDev !== null ? `${s.bvsDev > 0 ? "+" : ""}${(s.bvsDev * 100).toFixed(0)}%` : "—"}</td>
                          <td className="num mono">{s.distortion.toFixed(3)}</td>
                          <td>
                            {POLY_JA[s.shape] ?? s.shape} <span className="muted small">{s.cshm !== null ? s.cshm.toFixed(1) : ""}</span>
                          </td>
                          {entry.siteE && <td className="num mono">{e ? `${e.E.toFixed(2)}` : ""}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <h2>粉末 X 線回折（Cu Kα₁, 計算）</h2>
            </div>
            <LineChart
              series={[{ id: "x", label: "強度", color: seriesColor(6), points: entry.xrd.profile }]}
              xLabel="2θ (°)"
              yLabel="相対強度"
              height={200}
              xDomain={[5, 90]}
              yDomain={[0, 115]}
              annotations={[...entry.xrd.peaks]
                .sort((a, b) => b.intensity - a.intensity)
                .slice(0, 6)
                .map((p) => ({ x: p.twoTheta, y: p.intensity, text: p.hkl.join("") }))}
              xFmt={(x) => x.toFixed(2) + "°"}
              yFmt={(y) => y.toFixed(1)}
            />
          </section>

          <section className="card">
            <div className="card-head">
              <h2>特徴量の一覧</h2>
              <button className="btn btn-ghost btn-small" onClick={copyTsv} id="copy-features">
                表をコピー（TSV）
              </button>
            </div>
            {(Object.keys(GROUP_LABEL) as FeatureGroup[]).map((g) => (
              <div key={g} className="feat-group">
                <h3>{GROUP_LABEL[g]}</h3>
                <dl className="metrics">
                  {FEATURE_DEFS.filter((d) => d.group === g).map((d) => (
                    <div key={d.key} title={d.desc}>
                      <dt>
                        {d.label}
                        <span className="feat-desc">{d.desc}</span>
                      </dt>
                      <dd className="mono">
                        {fmtFeature(d, v[d.key])}
                        {d.unit && v[d.key] !== null && v[d.key] !== undefined ? ` ${d.unit}` : ""}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value mono">
        {value}
        {value !== "—" && unit ? <small> {unit}</small> : null}
      </span>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}
