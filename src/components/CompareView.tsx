import { useMemo, useState } from "react";
import type { Doc } from "../lib/doc";
import type { FeatureEntry } from "../lib/useFeatures";
import { FEATURE_DEFS, FEATURE_BY_KEY, FeatureGroup, GROUPS } from "../lib/features";
import { BarChart, LineChart, ScatterChart, seriesColor } from "./charts";
import { featDesc, featLabel, fmtFeature, groupLabel } from "./FeaturesPanel";
import { translate, useT, type MsgKey, type TFn } from "../i18n";

/** CSV is always written in English so files are comparable across UI languages. */
const tEn: TFn = (k, p) => translate("en", k, p);

interface Props {
  docs: Doc[]; // the ones included in the comparison
  allCount: number;
  entries: Record<string, FeatureEntry | undefined>;
  errors: Record<string, string>;
  onOpenDoc: (id: string) => void;
}

type Curve = "prdf" | "xrd" | "bvse" | "void";

const GENERIC: Record<string, MsgKey> = { MX: "cmp.pair.MX", MM: "cmp.pair.MM", XX: "cmp.pair.XX" };

/** The element pair of a structure that plays the given role (mobile ion / anion). */
function genericPair(d: Doc, e: FeatureEntry, kind: string) {
  const anions = new Set(d.crystal.sites.filter((s) => (d.ox[s.label] ?? 0) < 0).map((s) => s.element));
  const m = d.mobile;
  return e.static.prdf.find((p) => {
    const [a, b] = p.pair.split("–");
    if (kind === "MX") return !!m && ((a === m && anions.has(b)) || (b === m && anions.has(a)));
    if (kind === "MM") return !!m && a === m && b === m;
    return anions.has(a) && anions.has(b);
  });
}
const NUMERIC = FEATURE_DEFS.filter((d) => !d.text);

export default function CompareView({ docs, allCount, entries, errors, onOpenDoc }: Props) {
  const t = useT();
  const [barKey, setBarKey] = useState("E_1D");
  const [xKey, setXKey] = useState("V_anion");
  const [yKey, setYKey] = useState("E_1D");
  const [curve, setCurve] = useState<Curve>("bvse");
  const [pair, setPair] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<FeatureGroup>>(new Set());
  const [copied, setCopied] = useState(false);

  const val = (d: Doc, k: string) => entries[d.id]?.values[k] ?? null;
  const pending = docs.filter((d) => !entries[d.id]).length;
  const gridRunning = docs.filter((d) => {
    const s = entries[d.id]?.gridStatus;
    return s === "pending" || s === "running";
  }).length;

  const pairs = useMemo(() => {
    const s = new Set<string>();
    for (const d of docs) for (const p of entries[d.id]?.static.prdf ?? []) s.add(p.pair);
    return [...s].sort();
  }, [docs, entries]);
  const shownPair = pair && (GENERIC[pair] || pairs.includes(pair)) ? pair : "MX";

  const curveSeries = docs.flatMap((d) => {
    const e = entries[d.id];
    if (!e) return [];
    const base = { id: d.id, label: d.name, color: seriesColor(d.colorSlot) };
    if (curve === "xrd") return [{ ...base, points: e.xrd.profile }];
    if (curve === "prdf") {
      const p = GENERIC[shownPair] ? genericPair(d, e, shownPair) : e.static.prdf.find((x) => x.pair === shownPair);
      return p ? [{ ...base, label: GENERIC[shownPair] ? `${d.name} (${p.pair})` : d.name, points: p.points }] : [];
    }
    if (curve === "bvse") return e.grid?.energy ? [{ ...base, points: e.grid.energyCurve.map((p) => ({ x: p.x, y: p.y * 100 })) }] : [];
    return e.grid ? [{ ...base, points: e.grid.voidCurve.map((p) => ({ x: p.x, y: p.y * 100 })) }] : [];
  });

  const csv = () => {
    const head = ["key", "feature", "unit", ...docs.map((d) => d.name)];
    const rows = FEATURE_DEFS.map((f) => [f.key, featLabel(tEn, f.key), f.unit ?? "", ...docs.map((d) => {
      const v = val(d, f.key);
      return v === null ? "" : typeof v === "number" ? String(+v.toPrecision(8)) : fmtFeature(tEn, f, v);
    })]);
    return [head, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  };
  const copyCsv = () => {
    navigator.clipboard
      ?.writeText(csv())
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => undefined);
  };
  const saveCsv = () => {
    const blob = new Blob(["﻿" + csv()], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "crystal-features.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (docs.length === 0)
    return (
      <main className="compare">
        <p className="muted">{t("cmp.none", { all: allCount })}</p>
      </main>
    );

  return (
    <main className="compare">
      <div className="compare-head">
        <div>
          <h2>{t("cmp.title")}</h2>
          <p className="muted small">
            {t(allCount > docs.length ? "cmp.countOf" : "cmp.count", { n: docs.length, all: allCount })} {t("cmp.hint")}
            {pending > 0 && ` ${t("cmp.pending", { done: docs.length - pending, n: docs.length })}`}
            {pending === 0 && gridRunning > 0 && ` ${t("cmp.gridRunning", { n: gridRunning })}`}
          </p>
        </div>
        <div className="row gap-s">
          <button className="btn" onClick={copyCsv} id="copy-csv">
            {t(copied ? "cmp.copied" : "cmp.copyCsv")}
          </button>
          <button className="btn" onClick={saveCsv} id="save-csv">
            {t("cmp.saveCsv")}
          </button>
        </div>
      </div>

      <div className="compare-grid">
        <section className="card">
          <div className="card-head">
            <h2>{t("cmp.bar")}</h2>
            <select value={barKey} onChange={(e) => setBarKey(e.target.value)} aria-label={t("tsv.feature")} id="bar-key">
              {NUMERIC.map((f) => (
                <option key={f.key} value={f.key}>
                  {groupLabel(t, f.group)} · {featLabel(t, f.key)}
                </option>
              ))}
            </select>
          </div>
          <p className="muted small">{featDesc(t, barKey)}</p>
          <BarChart
            items={docs.map((d) => {
              const v = val(d, barKey);
              return { id: d.id, label: d.name, value: typeof v === "number" ? v : null, color: seriesColor(d.colorSlot) };
            })}
            unit={FEATURE_BY_KEY[barKey]?.unit}
            fmt={(v) => v.toFixed(FEATURE_BY_KEY[barKey]?.digits ?? 3)}
          />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{t("cmp.scatter")}</h2>
            <div className="row gap-s wrap">
              <label className="field-inline" htmlFor="x-key">
                <span>X</span>
                <select id="x-key" value={xKey} onChange={(e) => setXKey(e.target.value)}>
                  {NUMERIC.map((f) => (
                    <option key={f.key} value={f.key}>
                      {featLabel(t, f.key)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-inline" htmlFor="y-key">
                <span>Y</span>
                <select id="y-key" value={yKey} onChange={(e) => setYKey(e.target.value)}>
                  {NUMERIC.map((f) => (
                    <option key={f.key} value={f.key}>
                      {featLabel(t, f.key)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <ScatterChart
            points={docs.flatMap((d) => {
              const x = val(d, xKey),
                y = val(d, yKey);
              return typeof x === "number" && typeof y === "number" ? [{ id: d.id, x, y, label: d.name, color: seriesColor(d.colorSlot) }] : [];
            })}
            xLabel={`${featLabel(t, xKey)}${FEATURE_BY_KEY[xKey]?.unit ? ` (${FEATURE_BY_KEY[xKey].unit})` : ""}`}
            yLabel={`${featLabel(t, yKey)}${FEATURE_BY_KEY[yKey]?.unit ? ` (${FEATURE_BY_KEY[yKey].unit})` : ""}`}
            xFmt={(v) => v.toFixed(FEATURE_BY_KEY[xKey]?.digits ?? 3)}
            yFmt={(v) => v.toFixed(FEATURE_BY_KEY[yKey]?.digits ?? 3)}
          />
        </section>

        <section className="card span-2">
          <div className="card-head">
            <h2>{t("cmp.curves")}</h2>
            <div className="row gap-s wrap">
              <div className="seg small" role="radiogroup" aria-label={t("cmp.curve")}>
                {(
                  [
                    ["bvse", t("cmp.curve.bvse")],
                    ["void", t("cmp.curve.void")],
                    ["prdf", t("cmp.curve.prdf")],
                    ["xrd", "XRD"],
                  ] as [Curve, string][]
                ).map(([k, l]) => (
                  <button key={k} role="radio" aria-checked={curve === k} className={curve === k ? "is-on" : ""} onClick={() => setCurve(k)}>
                    {l}
                  </button>
                ))}
              </div>
              {curve === "prdf" && (
                <select value={shownPair} onChange={(e) => setPair(e.target.value)} aria-label={t("cmp.elementPairs")} id="pair-select">
                  <optgroup label={t("cmp.rolePairs")}>
                    {Object.entries(GENERIC).map(([k, l]) => (
                      <option key={k} value={k}>
                        {t(l)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t("cmp.elementPairs")}>
                    {pairs.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </optgroup>
                </select>
              )}
            </div>
          </div>
          {curveSeries.length ? (
            <LineChart
              series={curveSeries}
              xLabel={curve === "xrd" ? "2θ (°)" : curve === "prdf" ? "r (Å)" : curve === "bvse" ? "ΔE (eV)" : `${t("feat.probe")} r (Å)`}
              yLabel={curve === "xrd" ? t("feat.relIntensity") : curve === "prdf" ? "g(r)" : `${t("feat.volFrac")} (%)`}
              xDomain={curve === "xrd" ? [5, 90] : curve === "prdf" ? [0, 8] : undefined}
              height={250}
              xFmt={(x) => x.toFixed(2)}
              yFmt={(y) => y.toFixed(curve === "prdf" ? 2 : 1)}
            />
          ) : (
            <p className="muted small">{t(gridRunning ? "cmp.gridRunningLong" : "cmp.noCurves")}</p>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>{t("feat.all")}</h2>
          <span className="muted small">{t("cmp.tableHint")}</span>
        </div>
        <div className="table-wrap">
          <table className="data compare-table">
            <thead>
              <tr>
                <th>{t("tsv.feature")}</th>
                {docs.map((d) => (
                  <th key={d.id} className="num">
                    <button className="linkbtn plain" onClick={() => onOpenDoc(d.id)} title={t("cmp.openDoc")}>
                      <i className="side-dot" style={{ background: seriesColor(d.colorSlot) }} />
                      {d.name}
                    </button>
                    {errors[d.id] && <div className="warn-note small">{t("cmp.error")}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            {GROUPS.map((g) => {
              const isCol = collapsed.has(g);
              return (
                <tbody key={g}>
                  <tr className="group-row">
                    <td colSpan={docs.length + 1}>
                      <button
                        className="linkbtn plain"
                        aria-expanded={!isCol}
                        onClick={() =>
                          setCollapsed((s) => {
                            const n = new Set(s);
                            if (n.has(g)) n.delete(g);
                            else n.add(g);
                            return n;
                          })
                        }
                      >
                        {isCol ? "▸" : "▾"} {groupLabel(t, g)}
                      </button>
                    </td>
                  </tr>
                  {!isCol &&
                    FEATURE_DEFS.filter((f) => f.group === g).map((f) => {
                      const nums = docs.map((d) => val(d, f.key)).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
                      const maxAbs = Math.max(1e-12, ...nums.map(Math.abs));
                      return (
                        <tr key={f.key} className={`clickable ${barKey === f.key ? "is-selected" : ""}`} onClick={() => !f.text && setBarKey(f.key)} title={featDesc(t, f.key)}>
                          <td>
                            {featLabel(t, f.key)}
                            {f.unit && <span className="muted small"> ({f.unit})</span>}
                          </td>
                          {docs.map((d) => {
                            const v = val(d, f.key);
                            const pend = f.async && entries[d.id] && (entries[d.id]!.gridStatus === "pending" || entries[d.id]!.gridStatus === "running");
                            return (
                              <td key={d.id} className="num mono cell-bar">
                                {typeof v === "number" && Number.isFinite(v) && !f.text && <span className="cell-fill" style={{ width: `${(Math.abs(v) / maxAbs) * 100}%`, background: seriesColor(d.colorSlot) }} />}
                                <span className="cell-val">{pend ? "…" : fmtFeature(t, f, v)}</span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                </tbody>
              );
            })}
          </table>
        </div>
      </section>
    </main>
  );
}
