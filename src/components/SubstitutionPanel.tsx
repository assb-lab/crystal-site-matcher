import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import PeriodicTable, { CellInfo } from "./PeriodicTable";
import type { Crystal } from "../lib/structure";
import {
  Candidate,
  CandidateResult,
  SiteAnalysis,
  ScoreOpts,
  allCandidates,
  candKey,
  chargesFor,
  evaluateCandidate,
  paulingRange,
  spinsFor,
} from "../lib/analysis";
import { ELEMENTS, SHANNON, roman } from "../lib/data";
import { fmt, ionLabel, pct, signed } from "../lib/format";
import { useI18n, useT, type Lang, type TFn } from "../i18n";
import { radiusNote, shapeName } from "../i18n/domain";

interface Props {
  analysis: SiteAnalysis | null;
  crystal: Crystal;
  onSelectGroup: (g: string) => void;
}

const RADIOACTIVE = new Set(["Tc", "Pm", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Pa", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es"]);
const SHANNON_ELEMENTS = [...new Set(SHANNON.map((s) => s.el))].sort((a, b) => (ELEMENTS[a]?.Z ?? 0) - (ELEMENTS[b]?.Z ?? 0));

type ChargeFilter = "same" | "pm1" | "all";
type Quality = "reliable" | "all";

export default function SubstitutionPanel({ analysis: a, crystal, onSelectGroup }: Props) {
  const { t, lang } = useI18n();
  const [opts, setOpts] = useState<ScoreOpts>({ sizeTol: 0.15, useBVS: true, useCharge: true });
  const [chargeFilter, setChargeFilter] = useState<ChargeFilter>("pm1");
  const [quality, setQuality] = useState<Quality>("reliable");
  const [excludeRadio, setExcludeRadio] = useState(true);
  const [search, setSearch] = useState("");
  const [showN, setShowN] = useState(30);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [cEl, setCEl] = useState("Mn");
  const [cOx, setCOx] = useState(2);
  const [cSpin, setCSpin] = useState<"" | "HS" | "LS">("");
  const [ptMode, setPtMode] = useState<null | "compare" | "pick">(null);
  const [ptEl, setPtEl] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const hostOx = a?.host.ox ?? 0;
  const results = useMemo(() => {
    if (!a) return [];
    return allCandidates(hostOx)
      .map((c) => evaluateCandidate(a, c, opts))
      .filter((r): r is CandidateResult => r !== null)
      .sort((x, y) => y.score - x.score);
  }, [a, hostOx, opts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      if (excludeRadio && RADIOACTIVE.has(r.el)) return false;
      if (quality === "reliable" && (r.radius.method === "extrap" || r.radius.method === "subst")) return false;
      if (chargeFilter === "same" && r.dq !== 0) return false;
      if (chargeFilter === "pm1" && Math.abs(r.dq) > 1) return false;
      if (q && !r.el.toLowerCase().startsWith(q) && !ionLabel(r.el, r.ox).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [results, excludeRadio, quality, chargeFilter, search]);

  // default the custom-ion picker to something sensible for this site
  useEffect(() => {
    if (!a) return;
    const top = filtered.find((r) => r.el !== a.host.el);
    if (top) {
      setCEl(top.el);
      setCOx(top.ox);
      setCSpin(top.spin);
    }
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.group, a?.host.site]);

  // best-scoring ion per element under the current ranking filters
  const bestByEl = useMemo(() => {
    const m = new Map<string, CandidateResult>();
    for (const r of filtered) {
      const cur = m.get(r.el);
      if (!cur || r.score > cur.score) m.set(r.el, r);
    }
    return m;
  }, [filtered]);
  const filteredKeys = useMemo(() => new Set(filtered.map((r) => r.key)), [filtered]);

  const chooseElement = (el: string) => {
    setCEl(el);
    const ch = chargesFor(el);
    const sameSign = ch.filter((v) => Math.sign(v) === Math.sign(hostOx || 1));
    const pick = sameSign.includes(hostOx) ? hostOx : (sameSign[0] ?? ch[0]);
    setCOx(pick);
    setCSpin(spinsFor(el, pick)[0] ?? "");
  };

  const openDetail = (c: Candidate) => {
    setSelected(c);
    setPtMode(null);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const filterSummary = [
    t(`subst.sum.charge.${chargeFilter}`),
    t(quality === "reliable" ? "subst.sum.reliable" : "subst.sum.allRadii"),
    t(excludeRadio ? "subst.sum.noRadio" : "subst.sum.radio"),
    t("subst.sum.tol", { tol: Math.round(opts.sizeTol * 100) }),
  ].join(t("subst.sum.sep"));

  const ptCell = (el: string, mode: "compare" | "pick"): CellInfo => {
    const best = bestByEl.get(el);
    const hasSameSign = chargesFor(el).some((v) => Math.sign(v) === Math.sign(hostOx || 1));
    if (best) {
      const charges = [...new Set(filtered.filter((r) => r.el === el).map((r) => r.ox))].sort((x, y) => x - y);
      return {
        state: best.verdict,
        value: best.score.toFixed(0),
        sub: charges.map((q) => signed(q)).join(" "),
        title: t("subst.cellTitle", { ion: ionLabel(best.el, best.ox, best.spin || undefined), score: best.score.toFixed(0), verdict: t(`verdict.${best.verdict}`) }),
      };
    }
    if (hasSameSign) return { state: "neutral", title: mode === "compare" ? t("subst.cellNone", { el }) : el };
    return { state: "disabled", title: t("subst.cellNoIon", { el }) };
  };

  if (!a) return <p className="muted">{t("subst.pick")}</p>;

  const detail = selected ? evaluateCandidate(a, selected, opts) : null;
  const best = a.shapes[0];

  return (
    <div className="stack">
      <div className="context">
        <div>
          <span className="muted small">{t("subst.target")}</span>
          <div className="context-main">
            <select className="inline-select" value={a.group} onChange={(e) => onSelectGroup(e.target.value)} aria-label={t("subst.target")} id="subst-site">
              {crystal.groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.key}
                </option>
              ))}
            </select>
            <strong>{ionLabel(a.host.el, a.host.ox, a.rHost?.spin || undefined)}</strong>
            <span>
              CN {roman(a.cn)} · {shapeName(lang, best?.sym, best?.name)}
            </span>
          </div>
        </div>
        <div className="context-figs">
          <div>
            <span className="muted small">{t("subst.rSite")} r_site</span>
            <strong className="mono">{fmt(a.rSite, 3)} Å</strong>
          </div>
          <div>
            <span className="muted small">{t("subst.host")} r({roman(a.cn)})</span>
            <strong className="mono">{fmt(a.rHost?.r, 3)} Å</strong>
          </div>
          <div>
            <span className="muted small">⟨d⟩ {t("subst.observed")}</span>
            <strong className="mono">{fmt(a.dMean, 3)} Å</strong>
          </div>
        </div>
      </div>

      {a.rSite === null && (
        <div className="banner banner-warn">{t("subst.noRSite")}</div>
      )}

      <section className="card">
        <div className="card-head">
          <h2>{t("subst.map")}</h2>
          <span className="muted small">{t("subst.mapHint", { cn: roman(a.cn), t1: Math.round(opts.sizeTol * 100), t2: Math.round(opts.sizeTol * 200) })}</span>
        </div>
        <RadiusMap a={a} results={filtered} tol={opts.sizeTol} selectedKey={selected ? candKey(selected) : null} onSelect={(r) => setSelected(r)} />
      </section>

      <div ref={detailRef} className="scroll-anchor">
        {detail && <DetailCard a={a} r={detail} onClose={() => setSelected(null)} />}
      </div>

      <section className="card">
        <div className="card-head">
          <h2>{t("subst.custom")}</h2>
        </div>
        <div className="row gap-s wrap">
          <label className="field-inline" htmlFor="c-el">
            <span>{t("col.element")}</span>
            <select id="c-el" value={cEl} onChange={(e) => chooseElement(e.target.value)}>
              {SHANNON_ELEMENTS.map((el) => (
                <option key={el} value={el}>
                  {el}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-small" onClick={() => setPtMode("pick")} id="pick-element" aria-haspopup="dialog">
            {t("subst.pickPt")}
          </button>
          <label className="field-inline" htmlFor="c-ox">
            <span>{t("subst.charge")}</span>
            <select
              id="c-ox"
              value={cOx}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setCOx(v);
                setCSpin(spinsFor(cEl, v)[0] ?? "");
              }}
            >
              {chargesFor(cEl).map((v) => (
                <option key={v} value={v}>
                  {signed(v)}
                </option>
              ))}
            </select>
          </label>
          {spinsFor(cEl, cOx).length > 1 && (
            <label className="field-inline" htmlFor="c-spin">
              <span>{t("subst.spin")}</span>
              <select id="c-spin" value={cSpin} onChange={(e) => setCSpin(e.target.value as "HS" | "LS")}>
                {spinsFor(cEl, cOx).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="btn btn-primary" onClick={() => setSelected({ el: cEl, ox: cOx, spin: spinsFor(cEl, cOx).includes(cSpin) ? cSpin : (spinsFor(cEl, cOx)[0] ?? "") })} id="eval-ion">
            {t("subst.evaluate")}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t("subst.ranking")}</h2>
          <div className="row gap-s">
            <span className="muted small">
              {t("subst.count", { n: filtered.length, total: results.length })}
            </span>
            <button className="btn btn-small" onClick={() => setPtMode("compare")} id="open-ptable" aria-haspopup="dialog">
              {t("subst.viewPt")}
            </button>
          </div>
        </div>
        <div className="filters">
          <label className="slider" htmlFor="tol">
            <span>{t("subst.tol")} σ</span>
            <input id="tol" type="range" min={0.05} max={0.3} step={0.01} value={opts.sizeTol} onChange={(e) => setOpts({ ...opts, sizeTol: +e.target.value })} />
            <span className="mono">{Math.round(opts.sizeTol * 100)}%</span>
          </label>
          <div className="checks">
            <label htmlFor="use-bvs">
              <input id="use-bvs" type="checkbox" checked={opts.useBVS} onChange={(e) => setOpts({ ...opts, useBVS: e.target.checked })} /> {t("subst.useBVS")}
            </label>
            <label htmlFor="use-charge">
              <input id="use-charge" type="checkbox" checked={opts.useCharge} onChange={(e) => setOpts({ ...opts, useCharge: e.target.checked })} /> {t("subst.useCharge")}
            </label>
          </div>
          <div className="row gap-s wrap">
            <div className="seg small" role="radiogroup" aria-label={t("subst.charge")}>
              {(
                [
                  ["same", t("subst.charge.same")],
                  ["pm1", t("subst.charge.pm1")],
                  ["all", t("subst.charge.all")],
                ] as [ChargeFilter, string][]
              ).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={chargeFilter === k} className={chargeFilter === k ? "is-on" : ""} onClick={() => setChargeFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="seg small" role="radiogroup" aria-label={t("subst.quality")}>
              <button role="radio" aria-checked={quality === "reliable"} className={quality === "reliable" ? "is-on" : ""} onClick={() => setQuality("reliable")} title={t("subst.reliableTitle")}>
                {t("subst.reliable")}
              </button>
              <button role="radio" aria-checked={quality === "all"} className={quality === "all" ? "is-on" : ""} onClick={() => setQuality("all")} title={t("subst.allTitle")}>
                {t("subst.allRadii")}
              </button>
            </div>
            <label className="checkline" htmlFor="ex-radio">
              <input id="ex-radio" type="checkbox" checked={excludeRadio} onChange={(e) => setExcludeRadio(e.target.checked)} /> {t("subst.noRadio")}
            </label>
            <input id="search" className="search" type="search" placeholder={t("subst.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="table-wrap">
          <table className="data ranking">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{t("col.ion")}</th>
                <th className="num">r (Å)</th>
                <th className="num">Δr</th>
                <th className="num">BVS</th>
                <th className="num">Δq</th>
                <th>{t("col.score")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, showN).map((r, i) => (
                <tr
                  key={r.key}
                  className={`clickable ${selected && candKey(selected) === r.key ? "is-selected" : ""} ${r.el === a.host.el && r.ox === a.host.ox ? "is-host" : ""}`}
                  onClick={() => setSelected(r)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(r)}
                >
                  <td className="num mono muted">{i + 1}</td>
                  <td>
                    <strong>{ionLabel(r.el, r.ox, r.spin || undefined)}</strong>
                    {r.el === a.host.el && r.ox === a.host.ox && <span className="tag tag-quiet">{t("subst.hostTag")}</span>}
                  </td>
                  <td className="num mono" title={radiusNote(t, r.radius)}>
                    {r.radius.r.toFixed(3)}
                    {r.radius.method !== "exact" && <sup className="approx">{r.radius.method === "interp" ? "i" : "*"}</sup>}
                  </td>
                  <td className="num mono">{pct(r.dSite ?? r.dHost, 1)}</td>
                  <td className="num mono">{r.bvs !== null ? r.bvs.toFixed(2) : "—"}</td>
                  <td className="num mono">{signed(r.dq)}</td>
                  <td>
                    <ScoreBar r={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > showN && (
          <button className="btn btn-ghost btn-block" onClick={() => setShowN(showN + 40)} id="more">
            {t("subst.more", { n: filtered.length - showN })}
          </button>
        )}
        <p className="muted small">
          {t("subst.legend.r")} <sup className="approx">i</sup> = {t("subst.legend.i")}, <sup className="approx">*</sup> = {t("subst.legend.star")} {t("subst.legend.dr")}
        </p>
      </section>

      <details className="card method">
        <summary>
          <h2>{t("subst.method")}</h2>
        </summary>
        <MethodText lang={lang} />
      </details>
      <Modal
        open={ptMode !== null}
        onClose={() => setPtMode(null)}
        wide
        id="ptable-modal"
        title={
          ptMode === "pick" ? (
            t("subst.pt.pickTitle")
          ) : (
            t("subst.pt.compareTitle", { site: a.group, ion: ionLabel(a.host.el, a.host.ox), cn: roman(a.cn) })
          )
        }
      >
        <p className="muted small">
          {t(ptMode === "pick" ? "subst.pt.pickHint" : "subst.pt.compareHint")} {t("subst.pt.filters", { filters: filterSummary })}
        </p>
        <div className="pt-legend">
          {(["good", "possible", "hard", "unlikely"] as const).map((v) => (
            <span key={v} className={`pt-legend-item pt-${v}`}>
              <i />
              {t(`verdict.${v}`)}
            </span>
          ))}
          <span className="pt-legend-item pt-neutral">
            <i />
            {t("subst.outside")}
          </span>
          <span className="pt-legend-item pt-marked-key">
            <i />
            {t("subst.hostEl")}
          </span>
        </div>
        <PeriodicTable
          ariaLabel={t("subst.pt.aria")}
          cell={(el) => ptCell(el, ptMode === "pick" ? "pick" : "compare")}
          selected={ptMode === "pick" ? cEl : ptEl}
          marked={a.host.el}
          onPick={(el) => {
            if (ptMode === "pick") {
              chooseElement(el);
              setPtMode(null);
            } else setPtEl(el);
          }}
        />
        {ptMode === "compare" && ptEl && (
          <ElementIons el={ptEl} rows={results.filter((r) => r.el === ptEl)} inFilter={filteredKeys} onOpen={openDetail} />
        )}
        {ptMode === "compare" && !ptEl && <p className="muted small">{t("subst.pt.clickHint")}</p>}
      </Modal>
    </div>
  );
}

function ScoreBar({ r }: { r: CandidateResult }) {
  const t = useT();
  return (
    <div className={`score v-${r.verdict}`}>
      <div className="score-track">
        <div className="score-fill" style={{ width: `${Math.max(2, r.score)}%` }} />
      </div>
      <span className="score-num mono">{r.score.toFixed(0)}</span>
      <span className="pill">{t(`verdict.${r.verdict}`)}</span>
    </div>
  );
}

function DetailCard({ a, r, onClose }: { a: SiteAnalysis; r: CandidateResult; onClose: () => void }) {
  const t = useT();
  const pr = paulingRange(a.cn);
  const ratio = r.dPred !== null ? r.dPred / a.dMean - 1 : null;
  return (
    <section className={`card detail v-${r.verdict}`} aria-live="polite">
      <div className="card-head">
        <h2>
          {ionLabel(r.el, r.ox, r.spin || undefined)} → {a.group} ({ionLabel(a.host.el, a.host.ox)})
        </h2>
        <button className="btn btn-ghost btn-small" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
      <div className="detail-verdict">
        <span className="pill pill-big">{t(`verdict.${r.verdict}`)}</span>
        <span className="detail-score mono">{r.score.toFixed(0)}</span>
        <span className="muted small">/ 100</span>
      </div>
      <dl className="metrics">
        <div>
          <dt>
            {t("subst.d.rM")} r<sub>M</sub> (CN {roman(a.cn)})
          </dt>
          <dd className="mono">
            {r.radius.r.toFixed(3)} Å {!r.radius.exact && <span className="approx-note">{radiusNote(t, r.radius)}</span>}
          </dd>
        </div>
        <div>
          <dt>{t("subst.d.dSite")} Δr</dt>
          <dd className="mono">
            {pct(r.dSite)} <span className="muted">(S {r.sSize.toFixed(2)})</span>
          </dd>
        </div>
        <div>
          <dt>{t("subst.d.dHost")}</dt>
          <dd className="mono">{pct(r.dHost)}</dd>
        </div>
        <div>
          <dt>{t("subst.d.dPred")} r<sub>M</sub> + ⟨r<sub>X</sub>⟩ / {t("subst.observed")}</dt>
          <dd className="mono">
            {fmt(r.dPred, 3)} / {a.dMean.toFixed(3)} Å <span className="muted">({pct(ratio)})</span>
          </dd>
        </div>
        <div>
          <dt>{t("subst.d.bvs")}</dt>
          <dd className="mono">
            {r.bvs !== null ? `${r.bvs.toFixed(2)} / ${Math.abs(r.ox)}` : t("subst.d.noParam")}
            {r.sBVS !== null && <span className="muted">(S {r.sBVS.toFixed(2)})</span>}
          </dd>
        </div>
        <div>
          <dt>{t("subst.d.dq")} Δq</dt>
          <dd className="mono">
            {signed(r.dq)} <span className="muted">(S {r.sCharge.toFixed(2)})</span>
          </dd>
        </div>
        <div>
          <dt>{t("subst.d.rho")} r<sub>M</sub>/r<sub>X</sub> (Pauling)</dt>
          <dd className="mono">
            {fmt(r.rho, 3)}
            {pr && (
              <span className={r.rhoOk ? "ok-note" : "warn-note"}>
                {" "}
                {t(r.rhoOk ? "subst.d.rhoIn" : "subst.d.rhoOut", { cn: a.cn, lo: pr[0].toFixed(3), hi: Number.isFinite(pr[1]) ? pr[1].toFixed(3) : "∞" })}
              </span>
            )}
          </dd>
        </div>
      </dl>
      <p className="note small">{commentFor(t, a, r)}</p>
    </section>
  );
}

function commentFor(t: TFn, a: SiteAnalysis, r: CandidateResult): string {
  const parts: string[] = [];
  const d = r.dSite ?? r.dHost;
  if (d !== null) {
    const ad = Math.abs(d);
    if (ad < 0.05) parts.push(t("cmt.sizeMatch"));
    else if (ad < 0.15) parts.push(t(d > 0 ? "cmt.slightBig" : "cmt.slightSmall"));
    else if (ad < 0.3) parts.push(t(d > 0 ? "cmt.big" : "cmt.small"));
    else parts.push(t("cmt.tooDifferent"));
  }
  if (r.bvsRatio !== null) {
    if (r.bvsRatio > 1.2) parts.push(t("cmt.overbonded"));
    else if (r.bvsRatio < 0.8) parts.push(t("cmt.underbonded"));
  }
  if (r.dq !== 0) {
    parts.push(t(r.dq > 0 ? "cmt.chargeUp" : "cmt.chargeDown", { dq: signed(r.dq) }));
  }
  if (r.el === a.host.el && r.ox === a.host.ox) parts.push(t("cmt.host"));
  return parts.join(t("cmt.sep"));
}

function RadiusMap({
  a,
  results,
  tol,
  selectedKey,
  onSelect,
}: {
  a: SiteAnalysis;
  results: CandidateResult[];
  tol: number;
  selectedKey: string | null;
  onSelect: (r: CandidateResult) => void;
}) {
  const t = useT();
  const ref = a.rSite ?? a.rHost?.r ?? null;
  if (ref === null) return <p className="muted small">{t("subst.noRef")}</p>;
  const lo = Math.max(0, ref * (1 - 3 * tol) - 0.05),
    hi = ref * (1 + 3 * tol) + 0.05;
  const charges = [...new Set(results.map((r) => r.ox))].sort((x, y) => Math.abs(x) - Math.abs(y));
  const rowH = 30,
    top = 34,
    ml = 44,
    mr = 14;
  const W = 560;
  const H = top + Math.max(1, charges.length) * rowH + 30;
  const X = (r: number) => ml + ((r - lo) / (hi - lo)) * (W - ml - mr);
  const inRange = results.filter((r) => r.radius.r >= lo && r.radius.r <= hi);
  const labelled = new Set(
    [...inRange]
      .sort((x, y) => y.score - x.score)
      .slice(0, 10)
      .map((r) => r.key),
  );
  if (selectedKey) labelled.add(selectedKey);
  const ticks: number[] = [];
  const step = hi - lo > 1.2 ? 0.2 : 0.1;
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(+t.toFixed(2));

  return (
    <div className="table-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="rmap" role="img" aria-label={t("subst.mapAria")}>
        <rect x={X(ref * (1 - 2 * tol))} y={top - 8} width={X(ref * (1 + 2 * tol)) - X(ref * (1 - 2 * tol))} height={charges.length * rowH + 8} className="rmap-band2" />
        <rect x={X(ref * (1 - tol))} y={top - 8} width={X(ref * (1 + tol)) - X(ref * (1 - tol))} height={charges.length * rowH + 8} className="rmap-band1" />
        <line x1={X(ref)} x2={X(ref)} y1={top - 14} y2={top + charges.length * rowH} className="rmap-ref" />
        <text x={X(ref)} y={top - 16} textAnchor="middle" className="rmap-reflabel">
          r_site {ref.toFixed(3)}
        </text>
        {charges.map((q, i) => {
          const y = top + i * rowH + rowH / 2;
          const row = inRange.filter((r) => r.ox === q).sort((x, y2) => x.radius.r - y2.radius.r);
          let lastLabelX = -Infinity;
          return (
            <g key={q}>
              <text x={ml - 8} y={y + 4} textAnchor="end" className="rmap-q">
                {signed(q)}
              </text>
              <line x1={ml} x2={W - mr} y1={y} y2={y} className="rmap-row" />
              {row.map((r) => {
                const x = X(r.radius.r);
                const sel = r.key === selectedKey;
                const showLabel = labelled.has(r.key) && x - lastLabelX > 26;
                if (showLabel) lastLabelX = x;
                return (
                  <g key={r.key} className={`rmap-pt v-${r.verdict} ${sel ? "is-sel" : ""}`} onClick={() => onSelect(r)} style={{ cursor: "pointer" }}>
                    <circle cx={x} cy={y} r={sel ? 7 : 5} />
                    {showLabel && (
                      <text x={x} y={y - 9} textAnchor="middle" className="rmap-label">
                        {r.el}
                        {r.spin ? `·${r.spin}` : ""}
                      </text>
                    )}
                    <title>
                      {ionLabel(r.el, r.ox, r.spin || undefined)} {r.radius.r.toFixed(3)} Å · {t("col.score")} {r.score.toFixed(0)}
                    </title>
                  </g>
                );
              })}
            </g>
          );
        })}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={top + charges.length * rowH} y2={top + charges.length * rowH + 5} className="strip-axis" />
            <text x={X(t)} y={top + charges.length * rowH + 19} textAnchor="middle" className="strip-tick">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={W - mr} y={top + charges.length * rowH + 19} textAnchor="end" className="strip-tick">
          Å
        </text>
      </svg>
    </div>
  );
}

function ElementIons({ el, rows, inFilter, onOpen }: { el: string; rows: CandidateResult[]; inFilter: Set<string>; onOpen: (c: Candidate) => void }) {
  const t = useT();
  const sorted = [...rows].sort((x, y) => y.score - x.score);
  if (!sorted.length) return <p className="muted small">{t("subst.pt.noIons", { el })}</p>;
  return (
    <div className="pt-ions">
      <h3>{t("subst.pt.ionsOf", { el })}</h3>
      <div className="table-wrap">
        <table className="data ranking">
          <thead>
            <tr>
              <th>{t("col.ion")}</th>
              <th className="num">r (Å)</th>
              <th className="num">Δr</th>
              <th className="num">BVS</th>
              <th className="num">Δq</th>
              <th>{t("col.score")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const ok = inFilter.has(r.key);
              return (
                <tr key={r.key} className={ok ? "" : "is-out"}>
                  <td>
                    <strong>{ionLabel(r.el, r.ox, r.spin || undefined)}</strong>
                    {!ok && <span className="tag tag-quiet">{t("subst.outside")}</span>}
                  </td>
                  <td className="num mono" title={radiusNote(t, r.radius)}>
                    {r.radius.r.toFixed(3)}
                    {r.radius.method !== "exact" && <sup className="approx">{r.radius.method === "interp" ? "i" : "*"}</sup>}
                  </td>
                  <td className="num mono">{pct(r.dSite ?? r.dHost, 1)}</td>
                  <td className="num mono">{r.bvs !== null ? r.bvs.toFixed(2) : "—"}</td>
                  <td className="num mono">{signed(r.dq)}</td>
                  <td>
                    <ScoreBar r={r} />
                  </td>
                  <td>
                    <button className="btn btn-small" onClick={() => onOpen(r)}>
                      {t("subst.details")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MethodText({ lang }: { lang: Lang }) {
  if (lang === "en")
    return (
      <>
      <ol className="method-list">
        <li>
          <strong>Site cavity radius.</strong> For each bond, the Shannon radius of the ligand r<sub>X,i</sub> (at the ligand's own coordination number) is subtracted from the observed distance d<sub>i</sub>; the mean r<sub>site</sub> = ⟨d<sub>i</sub> − r<sub>X,i</sub>⟩ is taken as the radius of a cation that fits the site.
        </li>
        <li>
          <strong>Size match.</strong> From the mismatch Δr = (r<sub>M</sub> − r<sub>site</sub>)/r<sub>site</sub> with the candidate radius r<sub>M</sub> (Shannon radius at the same CN), S<sub>size</sub> = exp(−½(Δr/σ)²). σ is the tolerance (15% by default, in line with the Goldschmidt and Hume-Rothery rules of thumb).
        </li>
        <li>
          <strong>Bond-valence sum (BVS).</strong> With the candidate placed at the observed bond lengths, V = Σ exp((R<sub>0</sub> − d<sub>i</sub>)/0.37) is computed with the Brese &amp; O'Keeffe (1991) parameters, and S<sub>BVS</sub> = exp(−½((V/|q| − 1)/0.25)²) from its ratio to the formal charge. This captures size differences between charge states.
        </li>
        <li>
          <strong>Charge difference.</strong> 1 for Δq = 0, 0.75 for ±1, 0.5 for ±2 and 0.3 beyond. Aliovalent substitution needs charge compensation by vacancies, co-doping or valence changes.
        </li>
        <li>
          <strong>Overall score.</strong> Weighted geometric mean (size 0.6, BVS 0.25, charge 0.15) × 100. 75 or more “likely”, 50 or more “possible”, 25 or more “conditional”, below that “unlikely”.
        </li>
      </ol>
      <p className="muted small">
        This is a geometric guide only. Crystal-field stabilisation, covalency, site preference, synthesis temperature and atmosphere, and secondary phases are not considered. Shannon radii were derived mainly from oxides and fluorides.
      </p>
      </>
    );
  return (
    <>
        <ol className="method-list">
        <li>
          <strong>サイトの空間半径.</strong> 各結合について実測距離 d<sub>i</sub> から配位子のシャノン半径 r<sub>X,i</sub>（配位子自身の配位数での値）を引き、平均した r<sub>site</sub> = ⟨d<sub>i</sub> − r<sub>X,i</sub>⟩ をサイトに収まる陽イオンの半径とみなします。
        </li>
        <li>
          <strong>サイズの一致.</strong> 候補イオンの半径 r<sub>M</sub>（同じ配位数でのシャノン半径）との差 Δr = (r<sub>M</sub> − r<sub>site</sub>)/r<sub>site</sub> から、S<sub>size</sub> = exp(−½(Δr/σ)²) を計算します。σ は許容幅（既定 15%、Goldschmidt や Hume-Rothery の経験則に相当）。
        </li>
        <li>
          <strong>結合原子価和 (BVS).</strong> 実際の結合距離のまま候補イオンを置いたときの V = Σ exp((R<sub>0</sub> − d<sub>i</sub>)/0.37) を Brese &amp; O'Keeffe (1991) のパラメータで求め、形式価数との比から S<sub>BVS</sub> = exp(−½((V/|q| − 1)/0.25)²)。価数ごとの大きさの違いを反映します。
        </li>
        <li>
          <strong>価数差.</strong> Δq = 0 で 1、±1 で 0.75、±2 で 0.5、それ以上で 0.3。異価数置換では空孔・共ドープ・価数変化などの電荷補償が必要になります。
        </li>
        <li>
          <strong>総合スコア.</strong> 重み付き幾何平均（サイズ 0.6、BVS 0.25、価数 0.15）× 100。75 以上「入りやすい」、50 以上「可能性あり」、25 以上「条件次第」、それ未満「困難」。
        </li>
      </ol>
      <p className="muted small">
        幾何学的な目安です。結晶場安定化エネルギー、共有結合性、サイト選択性、合成温度や雰囲気、第二相の生成などは考慮していません。シャノン半径は主に酸化物・フッ化物から求められた値です。
      </p>
    </>
  );
}
