import type { Dispatch, SetStateAction } from "react";
import type { Crystal } from "../lib/structure";
import { chargeBalance, formulaString, guessOxidationStates } from "../lib/structure";
import { BondSettings, BondTable, relevantPairs } from "../lib/bonding";
import { elementColor } from "../lib/data";
import { fmt, ionLabel, rgbCss } from "../lib/format";

interface Props {
  crystal: Crystal;
  loaded: { fileName: string; blocks: string[]; blockIdx: number };
  onBlock: (i: number) => void;
  ox: Record<string, number>;
  setOx: Dispatch<SetStateAction<Record<string, number>>>;
  oxGuessed: boolean;
  bondSettings: BondSettings;
  setBondSettings: Dispatch<SetStateAction<BondSettings>>;
  bonds: BondTable;
  onSelectGroup: (g: string) => void;
  selectedGroup: string | null;
}

export default function StructurePanel(p: Props) {
  const { crystal: cr, ox, bondSettings: bs } = p;
  const L = cr.lattice;
  const { formula, Z } = formulaString(cr);
  const balance = chargeBalance(cr, ox);
  const pairs = relevantPairs(cr, ox, bs.ionicOnly);
  const fromCif = cr.sites.every((s) => s.cifOx !== null);

  const setPair = (k: string, patch: Partial<BondSettings["pairs"][string]>) =>
    p.setBondSettings((b) => ({ ...b, pairs: { ...b.pairs, [k]: { ...b.pairs[k], ...patch } } }));

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>結晶データ</h2>
          <span className="muted small">{p.loaded.fileName}</span>
        </div>
        {p.loaded.blocks.length > 1 && (
          <label className="field" htmlFor="block-select">
            <span>データブロック</span>
            <select id="block-select" value={p.loaded.blockIdx} onChange={(e) => p.onBlock(parseInt(e.target.value, 10))}>
              {p.loaded.blocks.map((b, i) => (
                <option key={i} value={i}>
                  data_{b}
                </option>
              ))}
            </select>
          </label>
        )}
        <dl className="metrics">
          <div>
            <dt>組成</dt>
            <dd className="mono">
              {formula} <span className="muted">(Z = {Z})</span>
            </dd>
          </div>
          <div>
            <dt>空間群</dt>
            <dd>
              <span className="mono">{cr.spaceGroup.symbol}</span>
              {cr.spaceGroup.number ? <span className="muted"> (No. {cr.spaceGroup.number})</span> : null}
              <div className="muted small">
                {cr.spaceGroup.source} · 対称操作 {cr.nOps} 個
              </div>
            </dd>
          </div>
          <div>
            <dt>a, b, c (Å)</dt>
            <dd className="mono">
              {L.a.toFixed(4)}, {L.b.toFixed(4)}, {L.c.toFixed(4)}
            </dd>
          </div>
          <div>
            <dt>α, β, γ (°)</dt>
            <dd className="mono">
              {L.alpha.toFixed(3)}, {L.beta.toFixed(3)}, {L.gamma.toFixed(3)}
            </dd>
          </div>
          <div>
            <dt>体積</dt>
            <dd className="mono">{L.volume.toFixed(3)} Å³</dd>
          </div>
          <div>
            <dt>単位胞内の原子位置</dt>
            <dd className="mono">{cr.positions.length}</dd>
          </div>
        </dl>
        {cr.warnings.length > 0 && (
          <ul className="warnings">
            {cr.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>サイトと酸化数</h2>
          <span className={`tag ${Math.abs(balance) < 0.01 ? "tag-ok" : "tag-warn"}`}>電荷の合計 {balance > 0 ? "+" : ""}{fmt(balance, 2)}</span>
        </div>
        <p className="muted small">
          {fromCif ? "酸化数は CIF の記載から読み込みました。" : p.oxGuessed ? "CIF に酸化数がないため、電荷中性になるよう推定しました。必要に応じて修正してください。" : ""}
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>サイト</th>
                <th>元素</th>
                <th className="num">酸化数</th>
                <th className="num">占有率</th>
                <th className="num">多重度</th>
                <th className="num">CN</th>
                <th className="num">x, y, z</th>
              </tr>
            </thead>
            <tbody>
              {cr.sites.map((s) => {
                const g = cr.groups.find((x) => x.sites.includes(s.index))!;
                const cn = p.bonds.bonded[g.positions[0]].length;
                return (
                  <tr key={s.index} className={`clickable ${p.selectedGroup === g.key ? "is-selected" : ""}`} onClick={() => p.onSelectGroup(g.key)}>
                    <td>
                      <span className="dot" style={{ background: rgbCss(elementColor(s.element)) }} />
                      {s.label}
                    </td>
                    <td>{ionLabel(s.element, ox[s.label])}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      <input
                        id={`ox-${s.label}`}
                        aria-label={`${s.label} の酸化数`}
                        className="num ox-input"
                        type="number"
                        step={1}
                        value={ox[s.label] ?? 0}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (Number.isFinite(v)) p.setOx((o) => ({ ...o, [s.label]: v }));
                        }}
                      />
                    </td>
                    <td className="num mono">{s.occ.toFixed(3).replace(/\.?0+$/, "")}</td>
                    <td className="num mono">{s.multiplicity}</td>
                    <td className="num mono">{cn}</td>
                    <td className="num mono small">{s.frac.map((v) => v.toFixed(4)).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="btn btn-ghost btn-small" onClick={() => p.setOx(guessOxidationStates(cr).byLabel)} id="reguess">
          酸化数を初期値に戻す
        </button>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>結合の判定距離</h2>
          <button
            className="btn btn-ghost btn-small"
            id="reset-bonds"
            onClick={() =>
              p.setBondSettings((b) => ({
                ...b,
                siteOverride: {},
                pairs: Object.fromEntries(Object.entries(b.pairs).map(([k, v]) => [k, { ...v, max: v.def, on: true }])),
              }))
            }
          >
            すべて初期値に戻す
          </button>
        </div>
        <label className="checkline" htmlFor="ionic-only">
          <input id="ionic-only" type="checkbox" checked={bs.ionicOnly} onChange={(e) => p.setBondSettings((b) => ({ ...b, ionicOnly: e.target.checked }))} />
          陽イオン–陰イオン間だけを結合とみなす
        </label>
        <div className="table-wrap">
          <table className="data pairs">
            <thead>
              <tr>
                <th>ペア</th>
                <th>有効</th>
                <th>上限 (Å)</th>
                <th>初期値</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((k) => {
                const r = bs.pairs[k];
                if (!r) return null;
                return (
                  <tr key={k}>
                    <td className="mono">{k.replace("-", "–")}</td>
                    <td>
                      <input id={`on-${k}`} aria-label={`${k} を有効にする`} type="checkbox" checked={r.on} onChange={(e) => setPair(k, { on: e.target.checked })} />
                    </td>
                    <td>
                      <div className="pair-edit">
                        <input
                          id={`range-${k}`}
                          aria-label={`${k} の上限`}
                          type="range"
                          min={1}
                          max={Math.max(4.5, r.def + 1)}
                          step={0.01}
                          value={r.max}
                          disabled={!r.on}
                          onChange={(e) => setPair(k, { max: +e.target.value })}
                        />
                        <input
                          id={`max-${k}`}
                          aria-label={`${k} の上限 (数値)`}
                          className="num"
                          type="number"
                          step={0.01}
                          min={0.5}
                          value={r.max}
                          disabled={!r.on}
                          onChange={(e) => +e.target.value > 0 && setPair(k, { max: +e.target.value })}
                        />
                      </div>
                    </td>
                    <td className="muted small">
                      {r.def.toFixed(2)} <span title={r.source === "VESTA" ? "VESTA の既定値" : r.source === "Shannon" ? "シャノン半径の和 × 1.25" : "原子半径の和 × 1.15"}>({r.source})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {Object.keys(bs.siteOverride).length > 0 && (
          <div className="note small">
            サイト個別の設定:{" "}
            {Object.entries(bs.siteOverride).map(([g, v]) => (
              <span key={g} className="tag">
                {g} ≤ {v.toFixed(3)} Å{" "}
                <button
                  className="linkbtn"
                  aria-label={`${g} の個別設定を解除`}
                  onClick={() =>
                    p.setBondSettings((b) => {
                      const so = { ...b.siteOverride };
                      delete so[g];
                      return { ...b, siteOverride: so };
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>データの出典</h2>
        </div>
        <ul className="refs small">
          <li>イオン半径: R. D. Shannon, Acta Cryst. A32, 751 (1976)</li>
          <li>結合原子価パラメータ: N. E. Brese &amp; M. O'Keeffe, Acta Cryst. B47, 192 (1991)</li>
          <li>結合判定距離の既定値: VESTA (K. Momma &amp; F. Izumi)</li>
          <li>空間群の対称操作・理想多面体・元素データ: pymatgen (MIT License)</li>
        </ul>
      </section>
    </div>
  );
}
