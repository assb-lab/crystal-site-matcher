import { useMemo, useState } from "react";
import type { Doc } from "../lib/doc";
import type { FeatureEntry } from "../lib/useFeatures";
import { FEATURE_DEFS, FEATURE_BY_KEY, GROUPS, hopClasses } from "../lib/features";
import { MINIMUM_COLOR, MINIMUM_SITE_COLOR, SADDLE_COLOR, hopColor } from "../lib/scene";
import { INTERSTITIAL_E_MAX, minimumClasses } from "../lib/landscape";
import { bvseSupported } from "../lib/bvse";
import { shannonRadius } from "../lib/analysis";
import { fmt, ionLabel, rgbCss } from "../lib/format";
import { LineChart, ScatterChart, StackedBars, seriesColor } from "./charts";
import { useI18n, type TFn } from "../i18n";
import { featDesc, featLabel, fmtFeature, groupLabel, shapeName } from "../i18n/domain";

interface Props {
  doc: Doc;
  update: (f: (d: Doc) => Partial<Doc>) => void;
  entry: FeatureEntry | undefined;
  error?: string;
}

export const shareKeys = (t: TFn) => [
  { key: "corner", label: t("share.corner"), color: seriesColor(0) },
  { key: "edge", label: t("share.edge"), color: seriesColor(1) },
  { key: "face", label: t("share.face"), color: seriesColor(2) },
];

export function autoIsoLevel(entry: FeatureEntry | undefined): number {
  const E = entry?.grid?.E;
  if (!E) return 1;
  const pick = [E[2], E[1], E[0]].find((x) => Number.isFinite(x) && x < 3);
  return pick !== undefined ? +(pick + 0.15).toFixed(2) : 1;
}

export default function FeaturesPanel({ doc, update, entry, error }: Props) {
  const { t, lang } = useI18n();
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
  const classes = useMemo(() => (st ? hopClasses(cr, st.hops) : []), [cr, st]);
  const rbLo = Math.min(...classes.map((c) => c.rb)),
    rbHi = Math.max(...classes.map((c) => c.rb));
  const hopCss = (rb: number) => rgbCss(hopColor(rb, rbLo, rbHi));
  const hopSel = classes.some((c) => c.key === doc.hopSel) ? doc.hopSel : null;
  const pickHop = (key: string) => update((d) => ({ hopSel: d.hopSel === key ? null : key }));
  // BVSE barriers of a hop class, oriented from c.from to c.to (equivalent members share them)
  const barriers = entry?.barriers ?? null;
  const classBarrier = (c: (typeof classes)[number]) => {
    const i = c.members[0];
    const b = barriers?.[i];
    if (!b || !st) return null;
    const forward = cr.positions[st.hops[i].a].group === c.from;
    return { Esad: b.Esad, there: forward ? b.fwd : b.rev, back: forward ? b.rev : b.fwd };
  };
  const [hopY, setHopY] = useState<"rb" | "barrier">("rb");
  const yBarrier = hopY === "barrier" && !!barriers;

  const copyTsv = () => {
    const lines = FEATURE_DEFS.map((d) => `${groupLabel(t, d.group)}\t${featLabel(t, d.key)}\t${fmtFeature(t, d, v[d.key])}\t${d.unit ?? ""}`);
    const text = [[t("tsv.group"), t("tsv.feature"), t("tsv.value"), t("tsv.unit")].join("\t"), ...lines].join("\n");
    navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>{t("feat.settings")}</h2>
          {entry?.gridStatus === "running" && <span className="muted small">{t("feat.gridRunning", { p: Math.round((entry.progress ?? 0) * 100) })}</span>}
        </div>
        <div className="row gap-s wrap">
          <label className="field-inline" htmlFor="mobile-el">
            <span>{t("feat.mobileIon")}</span>
            <select id="mobile-el" value={doc.mobile ?? ""} onChange={(e) => update(() => ({ mobile: e.target.value || null }))}>
              <option value="">{t("feat.none")}</option>
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
            <span>{t("feat.hopCut")} ≤</span>
            <input id="hop-cut" className="num" type="number" min={1.5} max={6} step={0.1} value={doc.hopCutoff} onChange={(e) => +e.target.value > 0 && update(() => ({ hopCutoff: +e.target.value }))} />
            <span>Å</span>
          </label>
          <label className="field-inline" htmlFor="grid-res">
            <span>{t("feat.gridRes")}</span>
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
        {doc.mobile && !supported && <p className="note small">{t("feat.noSoftBV", { ion: ionLabel(doc.mobile, mobileQ) })}</p>}
        {grid?.setup.missing.length ? <p className="note small">{t("feat.missingSoftBV", { ions: grid.setup.missing.join(", ") })}</p> : null}
        {error && <p className="note small warn-note">{t("feat.error", { error })}</p>}
      </section>

      {!entry ? (
        <p className="muted">{t("feat.computing")}</p>
      ) : (
        <>
          <div className="kpis">
            <Kpi label={t("feat.kpi.e1")} value={fmtFeature(t, FEATURE_BY_KEY.E_1D, v.E_1D)} unit="eV" sub={grid ? "" : entry.gridStatus === "none" ? t("feat.noMobile") : t("feat.running")} />
            <Kpi label={t("feat.kpi.e3")} value={fmtFeature(t, FEATURE_BY_KEY.E_3D, v.E_3D)} unit="eV" sub={grid && !Number.isFinite(grid.E[2]) ? t("feat.no3D") : ""} />
            <Kpi label={t("feat.kpi.rho")} value={fmtFeature(t, FEATURE_BY_KEY.rho_mobile, v.rho_mobile)} unit="nm⁻³" sub={doc.mobile ? `${featLabel(t, "vacancy")} ${fmtFeature(t, FEATURE_BY_KEY.vacancy, v.vacancy)}` : ""} />
            <Kpi label="GII" value={fmtFeature(t, FEATURE_BY_KEY.GII, v.GII)} unit="v.u." sub={typeof v.GII === "number" ? t(v.GII < 0.1 ? "feat.gii.ok" : v.GII < 0.2 ? "feat.gii.some" : "feat.gii.high") : ""} />
          </div>

          <section className="card">
            <div className="card-head">
              <h2>{t("feat.bvse")}</h2>
              <span className="muted small">{t("feat.bvseHint")}</span>
            </div>
            {grid?.energy ? (
              <>
                <LineChart
                  series={[{ id: "e", label: t("feat.volFrac"), color: seriesColor(0), points: grid.energyCurve.map((p) => ({ x: p.x, y: p.y * 100 })) }]}
                  xLabel="ΔE (eV)"
                  yLabel={`${t("feat.volFrac")} (%)`}
                  area
                  markers={(["1D", "2D", "3D"] as const).map((l, i) => ({ x: grid.E[i], label: l }))}
                  xFmt={(x) => x.toFixed(2)}
                  yFmt={(y) => y.toFixed(1) + "%"}
                />
                <div className="row gap-s wrap">
                  <label className="checkline" htmlFor="show-iso">
                    <input id="show-iso" type="checkbox" checked={doc.view.showIso} onChange={(e) => setView({ showIso: e.target.checked })} /> {t("feat.showIso")}
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
                    {t("feat.siteE")} {[...new Map(entry.siteE.map((s) => [s.group, s.E])).entries()].map(([g, e]) => `${g} ${Math.abs(e) < 0.005 ? "0.00" : e.toFixed(2)} eV`).join(t("list.sep"))}
                  </p>
                )}
                {entry.minima && (
                  <>
                    <div className="card-head">
                      <h3>{t("feat.minima", { n: entry.minima.length, k: entry.minima.filter((m) => !m.occupied).length })}</h3>
                      <label className="checkline" htmlFor="show-minima">
                        <input id="show-minima" type="checkbox" checked={doc.view.showMinima} onChange={(e) => setView({ showMinima: e.target.checked })} /> {t("feat.show3D")}
                      </label>
                      <span className="small muted">
                        <span className="dot" style={{ background: rgbCss(MINIMUM_COLOR) }} />
                        {t("feat.minimaEmpty")} <span className="dot" style={{ background: rgbCss(MINIMUM_SITE_COLOR) }} />
                        {t("feat.minimaSite")}
                      </span>
                    </div>
                    <div className="table-wrap">
                      <table className="data compact" id="minima">
                        <thead>
                          <tr>
                            <th>{t("feat.minimaKind")}</th>
                            <th className="num">ΔE (eV)</th>
                            <th className="num">×</th>
                            <th>{t("feat.minimaNearest")}</th>
                            <th className="num">λ (eV/Å²)</th>
                            <th className="num">x, y, z</th>
                          </tr>
                        </thead>
                        <tbody>
                          {minimumClasses(entry.minima).map((c) => (
                            <tr key={c.key} className={c.occupied ? "" : "is-host"}>
                              <td>
                                <span className="dot" style={{ background: rgbCss(c.occupied ? MINIMUM_SITE_COLOR : MINIMUM_COLOR) }} />
                                {c.occupied ? t("feat.minimaAt", { site: c.nearest?.group ?? "" }) : t("feat.minimaEmpty")}
                              </td>
                              <td className="num mono">{Math.abs(c.E) < 0.005 ? "0.00" : c.E.toFixed(2)}</td>
                              <td className="num mono">{c.count}</td>
                              <td className="mono">{c.nearest ? `${c.nearest.group} ${c.nearest.d.toFixed(2)} Å` : "—"}</td>
                              <td className="num mono">{c.curvature.map((x) => x.toFixed(1)).join(" / ")}</td>
                              <td className="num mono">{c.frac.map((x) => x.toFixed(3)).join(", ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted small">{t("feat.minimaNote", { e: INTERSTITIAL_E_MAX.toFixed(1) })}</p>
                  </>
                )}
              </>
            ) : (
              <p className="muted small">{entry.gridStatus === "running" || entry.gridStatus === "pending" ? t("feat.runningLong") : t("feat.pickMobile")}</p>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>{t("feat.voids")}</h2>
              <span className="muted small">{t("feat.voidsHint")}</span>
            </div>
            {grid ? (
              <LineChart
                series={[{ id: "v", label: t("feat.volFrac"), color: seriesColor(2), points: grid.voidCurve.map((p) => ({ x: p.x, y: p.y * 100 })) }]}
                xLabel={`${t("feat.probe")} r (Å)`}
                yLabel={`${t("feat.volFrac")} (%)`}
                area
                markers={[
                  ...(["1D", "2D", "3D"] as const).map((l, i) => ({ x: grid.R[i], label: l })),
                  ...(rM ? [{ x: rM.r, label: `r(${doc.mobile})` }] : []),
                ]}
                xFmt={(x) => x.toFixed(2) + " Å"}
                yFmt={(y) => y.toFixed(1) + "%"}
              />
            ) : (
              <p className="muted small">{doc.mobile ? t("feat.runningLong") : t("feat.pickMobile")}</p>
            )}
            {st && st.hops.length > 0 && (
              <>
                <div className="card-head">
                  <h3>{t("feat.hops", { n: st.hops.length })}</h3>
                  <label className="checkline" htmlFor="show-hops">
                    <input id="show-hops" type="checkbox" checked={doc.view.showHops} onChange={(e) => setView({ showHops: e.target.checked })} /> {t("feat.show3D")}
                  </label>
                  <span className="hop-legend small muted">
                    {t("feat.hopColors")} <i style={{ background: "rgb(227,73,72)" }} />{t("feat.narrow")} <i style={{ background: "rgb(237,161,0)" }} /> <i style={{ background: "rgb(27,175,122)" }} />{t("feat.wide")}
                    {barriers && (
                      <>
                        {" · "}
                        <span className="dot dot-square" style={{ background: rgbCss(SADDLE_COLOR) }} />
                        {t("feat.saddle")}
                      </>
                    )}
                  </span>
                </div>
                <div className="seg small" role="radiogroup" aria-label={t("feat.hopY")}>
                  <button role="radio" aria-checked={!yBarrier} className={!yBarrier ? "is-on" : ""} onClick={() => setHopY("rb")} id="hop-y-rb">
                    {t("feat.bottleneck")}
                  </button>
                  <button role="radio" aria-checked={yBarrier} className={yBarrier ? "is-on" : ""} disabled={!barriers} onClick={() => setHopY("barrier")} id="hop-y-barrier" title={barriers ? undefined : t("feat.barrierPending")}>
                    {t("feat.barrier")}
                  </button>
                </div>
                <ScatterChart
                  points={classes.map((c) => ({
                    id: c.key,
                    x: c.d,
                    y: yBarrier ? (classBarrier(c)?.Esad ?? NaN) : c.rb,
                    label: `${c.from}→${c.to}`,
                    color: hopCss(c.rb),
                    detail: t("feat.hopCount", { n: c.members.length }),
                  }))}
                  labels={false}
                  xLabel={`${t("feat.hopDist")} (Å)`}
                  yLabel={yBarrier ? `${t("feat.saddleE")} (eV)` : `${t("feat.bottleneck")} (Å)`}
                  height={220}
                  xFmt={(x) => x.toFixed(3) + " Å"}
                  yFmt={(y) => (yBarrier ? y.toFixed(3) + " eV" : y.toFixed(3) + " Å")}
                  r={5}
                  selected={hopSel}
                  onSelect={pickHop}
                />
                <p className="muted small">{t("feat.hopPickHint")}</p>
                <div className="table-wrap">
                  <table className="data compact" id="hop-classes">
                    <thead>
                      <tr>
                        <th>{t("feat.hopPath")}</th>
                        <th className="num">d (Å)</th>
                        <th className="num">
                          r<sub>b</sub> (Å)
                        </th>
                        <th className="num">{t("feat.hopN")}</th>
                        {barriers && (
                          <th className="num" title={t("feat.barrierTitle")}>
                            ΔE‡ (eV)
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {classes.map((c) => (
                        <tr
                          key={c.key}
                          className={`clickable ${hopSel === c.key ? "is-selected" : ""}`}
                          tabIndex={0}
                          aria-selected={hopSel === c.key}
                          onClick={() => pickHop(c.key)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              pickHop(c.key);
                            }
                          }}
                        >
                          <td>
                            <span className="dot" style={{ background: hopCss(c.rb) }} />
                            {c.from} → {c.to}
                          </td>
                          <td className="num mono">{c.d.toFixed(3)}</td>
                          <td className="num mono">{c.rb.toFixed(3)}</td>
                          <td className="num mono">{c.members.length}</td>
                          {barriers && (
                            <td className="num mono">
                              {(() => {
                                const b = classBarrier(c);
                                return b ? `${b.there.toFixed(2)} / ${b.back.toFixed(2)}` : "—";
                              })()}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted small">{t("feat.bottleneckNote")}</p>
                {barriers && <p className="muted small">{t("feat.barrierNote")}</p>}
              </>
            )}
          </section>

          {st && (
            <section className="card">
              <div className="card-head">
                <h2>{t("feat.prdf")} g(r)</h2>
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
                <h2>{t("feat.sharing")}</h2>
                <span className="muted small">{t("feat.sharingHint")}</span>
              </div>
              <StackedBars
                keys={shareKeys(t)}
                rows={[
                  { id: "frame", label: t("share.ff"), parts: { ...st.sharing.frame } },
                  { id: "mm", label: t("share.mm"), parts: { ...st.sharing.mm } },
                  { id: "mf", label: t("share.mf"), parts: { ...st.sharing.mf } },
                ]}
              />
              <p className="muted small">{featLabel(t, "frame_isolated")} {fmtFeature(t, FEATURE_BY_KEY.frame_isolated, v.frame_isolated)}</p>
            </section>
          )}

          {st && (
            <section className="card">
              <div className="card-head">
                <h2>{t("feat.perSite")}</h2>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("col.site")}</th>
                      <th>{t("col.ion")}</th>
                      <th className="num">×</th>
                      <th className="num">CN</th>
                      <th className="num">⟨d⟩</th>
                      <th className="num">BVS</th>
                      <th className="num">{t("feat.mismatch")}</th>
                      <th className="num">Δ</th>
                      <th>{t("feat.shape")} (CShM)</th>
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
                            {shapeName(lang, s.shape, s.shape)} <span className="muted small">{s.cshm !== null ? s.cshm.toFixed(1) : ""}</span>
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
              <h2>{t("feat.xrd")}</h2>
            </div>
            <LineChart
              series={[{ id: "x", label: t("feat.intensity"), color: seriesColor(6), points: entry.xrd.profile }]}
              xLabel="2θ (°)"
              yLabel={t("feat.relIntensity")}
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
              <h2>{t("feat.all")}</h2>
              <button className="btn btn-ghost btn-small" onClick={copyTsv} id="copy-features">
                {t("feat.copy")}
              </button>
            </div>
            {GROUPS.map((g) => (
              <div key={g} className="feat-group">
                <h3>{groupLabel(t, g)}</h3>
                <dl className="metrics">
                  {FEATURE_DEFS.filter((d) => d.group === g).map((d) => (
                    <div key={d.key} title={featDesc(t, d.key)}>
                      <dt>
                        {featLabel(t, d.key)}
                        <span className="feat-desc">{featDesc(t, d.key)}</span>
                      </dt>
                      <dd className="mono">
                        {fmtFeature(t, d, v[d.key])}
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
