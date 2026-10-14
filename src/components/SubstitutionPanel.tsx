import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import PeriodicTable, { CellInfo } from "./PeriodicTable";
import type { Crystal } from "../lib/structure";
import {
  Candidate,
  CandidateResult,
  SiteAnalysis,
  ScoreOpts,
  VERDICT_LABEL,
  allCandidates,
  candKey,
  chargesFor,
  evaluateCandidate,
  paulingRange,
  spinsFor,
} from "../lib/analysis";
import { ELEMENTS, SHANNON, roman } from "../lib/data";
import { fmt, ionLabel, pct, signed } from "../lib/format";
import { shapeName } from "./SitePanel";

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
    chargeFilter === "same" ? "同じ価数" : chargeFilter === "pm1" ? "価数差 ±1 まで" : "すべての価数",
    quality === "reliable" ? "表・内挿の半径のみ" : "外挿・代用の半径も含む",
    excludeRadio ? "放射性元素を除く" : "放射性元素も含む",
    `サイズ許容幅 ${Math.round(opts.sizeTol * 100)}%`,
  ].join("・");

  const ptCell = (el: string, mode: "compare" | "pick"): CellInfo => {
    const best = bestByEl.get(el);
    const hasSameSign = chargesFor(el).some((v) => Math.sign(v) === Math.sign(hostOx || 1));
    if (best) {
      const charges = [...new Set(filtered.filter((r) => r.el === el).map((r) => r.ox))].sort((x, y) => x - y);
      return {
        state: best.verdict,
        value: best.score.toFixed(0),
        sub: charges.map((q) => signed(q)).join(" "),
        title: `${ionLabel(best.el, best.ox, best.spin || undefined)}  スコア ${best.score.toFixed(0)}（${VERDICT_LABEL[best.verdict]}）`,
      };
    }
    if (hasSameSign) return { state: "neutral", title: mode === "compare" ? `${el}: 現在の条件では候補なし` : el };
    return { state: "disabled", title: `${el}: シャノン表に該当する価数のイオンなし` };
  };

  if (!a) return <p className="muted">先に 3D 表示かサイト解析タブでサイトを選んでください。</p>;

  const detail = selected ? evaluateCandidate(a, selected, opts) : null;
  const best = a.shapes[0];

  return (
    <div className="stack">
      <div className="context">
        <div>
          <span className="muted small">対象サイト</span>
          <div className="context-main">
            <select className="inline-select" value={a.group} onChange={(e) => onSelectGroup(e.target.value)} aria-label="対象サイト" id="subst-site">
              {crystal.groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.key}
                </option>
              ))}
            </select>
            <strong>{ionLabel(a.host.el, a.host.ox, a.rHost?.spin || undefined)}</strong>
            <span>
              CN {roman(a.cn)} · {shapeName(best?.sym, best?.name)}
            </span>
          </div>
        </div>
        <div className="context-figs">
          <div>
            <span className="muted small">空間半径 r_site</span>
            <strong className="mono">{fmt(a.rSite, 3)} Å</strong>
          </div>
          <div>
            <span className="muted small">ホスト r({roman(a.cn)})</span>
            <strong className="mono">{fmt(a.rHost?.r, 3)} Å</strong>
          </div>
          <div>
            <span className="muted small">⟨d⟩ 実測</span>
            <strong className="mono">{fmt(a.dMean, 3)} Å</strong>
          </div>
        </div>
      </div>

      {a.rSite === null && (
        <div className="banner banner-warn">配位子または中心イオンの酸化数が未設定のため、空間半径を計算できません。「構造と結合」タブで酸化数を入力してください。</div>
      )}

      <section className="card">
        <div className="card-head">
          <h2>イオン半径マップ</h2>
          <span className="muted small">CN {roman(a.cn)} でのシャノン半径。帯は r_site ±{Math.round(opts.sizeTol * 100)}% と ±{Math.round(opts.sizeTol * 200)}%</span>
        </div>
        <RadiusMap a={a} results={filtered} tol={opts.sizeTol} selectedKey={selected ? candKey(selected) : null} onSelect={(r) => setSelected(r)} />
      </section>

      <div ref={detailRef} className="scroll-anchor">
        {detail && <DetailCard a={a} r={detail} onClose={() => setSelected(null)} />}
      </div>

      <section className="card">
        <div className="card-head">
          <h2>イオンを指定して評価</h2>
        </div>
        <div className="row gap-s wrap">
          <label className="field-inline" htmlFor="c-el">
            <span>元素</span>
            <select id="c-el" value={cEl} onChange={(e) => chooseElement(e.target.value)}>
              {SHANNON_ELEMENTS.map((el) => (
                <option key={el} value={el}>
                  {el}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-small" onClick={() => setPtMode("pick")} id="pick-element" aria-haspopup="dialog">
            周期表から選ぶ
          </button>
          <label className="field-inline" htmlFor="c-ox">
            <span>価数</span>
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
              <span>スピン</span>
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
            評価する
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>候補ランキング</h2>
          <div className="row gap-s">
            <span className="muted small">
              {filtered.length} / {results.length} イオン
            </span>
            <button className="btn btn-small" onClick={() => setPtMode("compare")} id="open-ptable" aria-haspopup="dialog">
              周期表で見る
            </button>
          </div>
        </div>
        <div className="filters">
          <label className="slider" htmlFor="tol">
            <span>サイズ許容幅 σ</span>
            <input id="tol" type="range" min={0.05} max={0.3} step={0.01} value={opts.sizeTol} onChange={(e) => setOpts({ ...opts, sizeTol: +e.target.value })} />
            <span className="mono">{Math.round(opts.sizeTol * 100)}%</span>
          </label>
          <div className="checks">
            <label htmlFor="use-bvs">
              <input id="use-bvs" type="checkbox" checked={opts.useBVS} onChange={(e) => setOpts({ ...opts, useBVS: e.target.checked })} /> BVS を評価に含める
            </label>
            <label htmlFor="use-charge">
              <input id="use-charge" type="checkbox" checked={opts.useCharge} onChange={(e) => setOpts({ ...opts, useCharge: e.target.checked })} /> 価数差を評価に含める
            </label>
          </div>
          <div className="row gap-s wrap">
            <div className="seg small" role="radiogroup" aria-label="価数">
              {(
                [
                  ["same", "同じ価数"],
                  ["pm1", "±1 まで"],
                  ["all", "すべて"],
                ] as [ChargeFilter, string][]
              ).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={chargeFilter === k} className={chargeFilter === k ? "is-on" : ""} onClick={() => setChargeFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="seg small" role="radiogroup" aria-label="半径の信頼度">
              <button role="radio" aria-checked={quality === "reliable"} className={quality === "reliable" ? "is-on" : ""} onClick={() => setQuality("reliable")} title="表の値と内挿値のみ">
                表・内挿のみ
              </button>
              <button role="radio" aria-checked={quality === "all"} className={quality === "all" ? "is-on" : ""} onClick={() => setQuality("all")} title="外挿や別 CN の代用値も含める">
                外挿も含む
              </button>
            </div>
            <label className="checkline" htmlFor="ex-radio">
              <input id="ex-radio" type="checkbox" checked={excludeRadio} onChange={(e) => setExcludeRadio(e.target.checked)} /> 放射性元素を除く
            </label>
            <input id="search" className="search" type="search" placeholder="元素で絞り込み (例: Mn)" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="table-wrap">
          <table className="data ranking">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>イオン</th>
                <th className="num">r (Å)</th>
                <th className="num">Δr</th>
                <th className="num">BVS</th>
                <th className="num">Δq</th>
                <th>スコア</th>
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
                    {r.el === a.host.el && r.ox === a.host.ox && <span className="tag tag-quiet">ホスト</span>}
                  </td>
                  <td className="num mono" title={r.radius.note}>
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
            さらに表示（残り {filtered.length - showN}）
          </button>
        )}
        <p className="muted small">
          r の右肩: <sup className="approx">i</sup> = 隣接 CN の値から内挿、<sup className="approx">*</sup> = 外挿または別 CN の値で代用。Δr は r_site に対する差。
        </p>
      </section>

      <details className="card method">
        <summary>
          <h2>判定の考え方</h2>
        </summary>
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
      </details>
      <Modal
        open={ptMode !== null}
        onClose={() => setPtMode(null)}
        wide
        id="ptable-modal"
        title={
          ptMode === "pick" ? (
            "元素を選ぶ"
          ) : (
            <>
              周期表で比較 — {a.group}（{ionLabel(a.host.el, a.host.ox)}、CN {roman(a.cn)}）
            </>
          )
        }
      >
        <p className="muted small">
          {ptMode === "pick" ? "評価する元素をクリックしてください。色はランキングと同じ条件での最高スコアの判定です。" : "各元素のイオン（価数・スピン）のうち最もスコアの高いものの判定色と、そのスコア。"}
          条件: {filterSummary}（ランキングと共通）。
        </p>
        <div className="pt-legend">
          {(["good", "possible", "hard", "unlikely"] as const).map((v) => (
            <span key={v} className={`pt-legend-item pt-${v}`}>
              <i />
              {VERDICT_LABEL[v]}
            </span>
          ))}
          <span className="pt-legend-item pt-neutral">
            <i />
            条件外
          </span>
          <span className="pt-legend-item pt-marked-key">
            <i />
            ホスト元素
          </span>
        </div>
        <PeriodicTable
          ariaLabel="周期表"
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
        {ptMode === "compare" && !ptEl && <p className="muted small">元素をクリックすると、その元素のイオンごとの値を表示します。</p>}
      </Modal>
    </div>
  );
}

function ScoreBar({ r }: { r: CandidateResult }) {
  return (
    <div className={`score v-${r.verdict}`}>
      <div className="score-track">
        <div className="score-fill" style={{ width: `${Math.max(2, r.score)}%` }} />
      </div>
      <span className="score-num mono">{r.score.toFixed(0)}</span>
      <span className="pill">{VERDICT_LABEL[r.verdict]}</span>
    </div>
  );
}

function DetailCard({ a, r, onClose }: { a: SiteAnalysis; r: CandidateResult; onClose: () => void }) {
  const pr = paulingRange(a.cn);
  const ratio = r.dPred !== null ? r.dPred / a.dMean - 1 : null;
  return (
    <section className={`card detail v-${r.verdict}`} aria-live="polite">
      <div className="card-head">
        <h2>
          {ionLabel(r.el, r.ox, r.spin || undefined)} → {a.group}（{ionLabel(a.host.el, a.host.ox)}）
        </h2>
        <button className="btn btn-ghost btn-small" onClick={onClose}>
          閉じる
        </button>
      </div>
      <div className="detail-verdict">
        <span className="pill pill-big">{VERDICT_LABEL[r.verdict]}</span>
        <span className="detail-score mono">{r.score.toFixed(0)}</span>
        <span className="muted small">/ 100</span>
      </div>
      <dl className="metrics">
        <div>
          <dt>
            シャノン半径 r<sub>M</sub>（CN {roman(a.cn)}）
          </dt>
          <dd className="mono">
            {r.radius.r.toFixed(3)} Å {!r.radius.exact && <span className="approx-note">{r.radius.note}</span>}
          </dd>
        </div>
        <div>
          <dt>サイト空間半径に対する差 Δr</dt>
          <dd className="mono">
            {pct(r.dSite)} <span className="muted">（S {r.sSize.toFixed(2)}）</span>
          </dd>
        </div>
        <div>
          <dt>ホストイオン半径に対する差</dt>
          <dd className="mono">{pct(r.dHost)}</dd>
        </div>
        <div>
          <dt>予想平均結合長 r<sub>M</sub> + ⟨r<sub>X</sub>⟩ / 実測</dt>
          <dd className="mono">
            {fmt(r.dPred, 3)} / {a.dMean.toFixed(3)} Å <span className="muted">({pct(ratio)})</span>
          </dd>
        </div>
        <div>
          <dt>このサイトでの BVS / 形式価数</dt>
          <dd className="mono">
            {r.bvs !== null ? `${r.bvs.toFixed(2)} / ${Math.abs(r.ox)}` : "パラメータなし"}
            {r.sBVS !== null && <span className="muted">（S {r.sBVS.toFixed(2)}）</span>}
          </dd>
        </div>
        <div>
          <dt>価数差 Δq</dt>
          <dd className="mono">
            {signed(r.dq)} <span className="muted">（S {r.sCharge.toFixed(2)}）</span>
          </dd>
        </div>
        <div>
          <dt>半径比 r<sub>M</sub>/r<sub>X</sub>（Pauling）</dt>
          <dd className="mono">
            {fmt(r.rho, 3)}
            {pr && (
              <span className={r.rhoOk ? "ok-note" : "warn-note"}>
                {" "}
                CN {a.cn} の安定範囲 {pr[0].toFixed(3)}–{Number.isFinite(pr[1]) ? pr[1].toFixed(3) : "∞"} {r.rhoOk ? "内" : "外"}
              </span>
            )}
          </dd>
        </div>
      </dl>
      <p className="note small">{commentFor(a, r)}</p>
    </section>
  );
}

function commentFor(a: SiteAnalysis, r: CandidateResult): string {
  const parts: string[] = [];
  const d = r.dSite ?? r.dHost;
  if (d !== null) {
    const ad = Math.abs(d);
    if (ad < 0.05) parts.push("サイズはほぼ一致します。");
    else if (ad < 0.15) parts.push(d > 0 ? "やや大きく、局所的に結合が伸びる方向の歪みが入ります。" : "やや小さく、多面体が縮むかオフセンターになりやすくなります。");
    else if (ad < 0.3) parts.push(d > 0 ? "かなり大きく、固溶量は限られそうです。" : "かなり小さく、別のサイトや低配位を好む可能性があります。");
    else parts.push("サイズの差が大きく、このサイトへの置換は起こりにくいと考えられます。");
  }
  if (r.bvsRatio !== null) {
    if (r.bvsRatio > 1.2) parts.push("BVS が形式価数を大きく上回り、結合が混み合う（過剰結合）状態です。");
    else if (r.bvsRatio < 0.8) parts.push("BVS が形式価数を下回り、サイトが緩すぎる（結合不足）状態です。");
  }
  if (r.dq !== 0) {
    const need = r.dq > 0 ? "陽イオン空孔、低価数イオンとの共ドープ、または周囲の還元" : "陰イオン空孔、高価数イオンとの共ドープ、または周囲の酸化";
    parts.push(`価数が ${signed(r.dq)} 異なるため、${need}などによる電荷補償が必要です。`);
  }
  if (r.el === a.host.el && r.ox === a.host.ox) parts.push("（ホストイオン自身の値で、評価の基準になります。）");
  return parts.join("");
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
  const ref = a.rSite ?? a.rHost?.r ?? null;
  if (ref === null) return <p className="muted small">基準となる半径がありません。</p>;
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
      <svg viewBox={`0 0 ${W} ${H}`} className="rmap" role="img" aria-label="候補イオンのシャノン半径">
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
                      {ionLabel(r.el, r.ox, r.spin || undefined)} {r.radius.r.toFixed(3)} Å · スコア {r.score.toFixed(0)}
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
  const sorted = [...rows].sort((x, y) => y.score - x.score);
  if (!sorted.length) return <p className="muted small">{el} にはこのサイトと同じ符号の価数のイオンがシャノン表にありません。</p>;
  return (
    <div className="pt-ions">
      <h3>{el} のイオン</h3>
      <div className="table-wrap">
        <table className="data ranking">
          <thead>
            <tr>
              <th>イオン</th>
              <th className="num">r (Å)</th>
              <th className="num">Δr</th>
              <th className="num">BVS</th>
              <th className="num">Δq</th>
              <th>スコア</th>
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
                    {!ok && <span className="tag tag-quiet">条件外</span>}
                  </td>
                  <td className="num mono" title={r.radius.note}>
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
                      詳細
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
