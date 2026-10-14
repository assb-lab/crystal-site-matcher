import type { Dispatch, SetStateAction } from "react";
import type { Crystal } from "../lib/structure";
import { chargeBalance, formulaString, guessOxidationStates } from "../lib/structure";
import { BondSettings, BondTable, relevantPairs } from "../lib/bonding";
import { elementColor } from "../lib/data";
import { fmt, ionLabel, rgbCss } from "../lib/format";
import { tMsg, useT } from "../i18n";

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
  const t = useT();
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
          <h2>{t("struct.crystal")}</h2>
          <span className="muted small">{p.loaded.fileName}</span>
        </div>
        {p.loaded.blocks.length > 1 && (
          <label className="field" htmlFor="block-select">
            <span>{t("struct.block")}</span>
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
            <dt>{t("struct.formula")}</dt>
            <dd className="mono">
              {formula} <span className="muted">(Z = {Z})</span>
            </dd>
          </div>
          <div>
            <dt>{t("feat.sg.label")}</dt>
            <dd>
              <span className="mono">{cr.spaceGroup.symbol}</span>
              {cr.spaceGroup.number ? <span className="muted"> (No. {cr.spaceGroup.number})</span> : null}
              <div className="muted small">
                {t(`sg.source.${cr.spaceGroup.source.kind}`, { setting: cr.spaceGroup.source.setting ?? "" })} · {t("struct.nOps", { n: cr.nOps })}
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
            <dt>{t("struct.volume")}</dt>
            <dd className="mono">{L.volume.toFixed(3)} Å³</dd>
          </div>
          <div>
            <dt>{t("struct.positions")}</dt>
            <dd className="mono">{cr.positions.length}</dd>
          </div>
        </dl>
        {cr.warnings.length > 0 && (
          <ul className="warnings">
            {cr.warnings.map((w, i) => (
              <li key={i}>{tMsg(t, w)}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t("struct.sitesOx")}</h2>
          <span className={`tag ${Math.abs(balance) < 0.01 ? "tag-ok" : "tag-warn"}`}>{t("struct.charge", { q: `${balance > 0 ? "+" : ""}${fmt(balance, 2)}` })}</span>
        </div>
        <p className="muted small">
          {fromCif ? t("struct.oxFromCif") : p.oxGuessed ? t("struct.oxGuessed") : ""}
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("col.site")}</th>
                <th>{t("col.element")}</th>
                <th className="num">{t("col.ox")}</th>
                <th className="num">{t("col.occ")}</th>
                <th className="num">{t("col.mult")}</th>
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
                        aria-label={t("struct.oxOf", { site: s.label })}
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
          {t("struct.resetOx")}
        </button>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t("struct.cutoffs")}</h2>
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
            {t("struct.resetAll")}
          </button>
        </div>
        <label className="checkline" htmlFor="ionic-only">
          <input id="ionic-only" type="checkbox" checked={bs.ionicOnly} onChange={(e) => p.setBondSettings((b) => ({ ...b, ionicOnly: e.target.checked }))} />
          {t("struct.ionicOnly")}
        </label>
        <div className="table-wrap">
          <table className="data pairs">
            <thead>
              <tr>
                <th>{t("col.pair")}</th>
                <th>{t("col.enabled")}</th>
                <th>{t("col.max")}</th>
                <th>{t("col.default")}</th>
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
                      <input id={`on-${k}`} aria-label={t("struct.enablePair", { pair: k })} type="checkbox" checked={r.on} onChange={(e) => setPair(k, { on: e.target.checked })} />
                    </td>
                    <td>
                      <div className="pair-edit">
                        <input
                          id={`range-${k}`}
                          aria-label={t("struct.pairMax", { pair: k })}
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
                          aria-label={t("struct.pairMaxNum", { pair: k })}
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
                      {r.def.toFixed(2)} <span title={t(`cutoff.source.${r.source}`)}>({r.source})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {Object.keys(bs.siteOverride).length > 0 && (
          <div className="note small">
            {t("struct.overrides")}{" "}
            {Object.entries(bs.siteOverride).map(([g, v]) => (
              <span key={g} className="tag">
                {g} ≤ {v.toFixed(3)} Å{" "}
                <button
                  className="linkbtn"
                  aria-label={t("struct.clearOverride", { site: g })}
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
          <h2>{t("struct.sources")}</h2>
        </div>
        <ul className="refs small">
          <li>{t("src.shannon")}: R. D. Shannon, Acta Cryst. A32, 751 (1976)</li>
          <li>{t("src.bv")}: N. E. Brese &amp; M. O'Keeffe, Acta Cryst. B47, 192 (1991)</li>
          <li>{t("src.bvse")}: BVlain (A. D. Dembitskiy, MIT) / softBV — H. Chen &amp; S. Adams, IUCrJ 4, 614 (2017)</li>
          <li>{t("src.vesta")}: VESTA (K. Momma &amp; F. Izumi)</li>
          <li>{t("src.pymatgen")}: pymatgen (MIT License)</li>
        </ul>
      </section>
    </div>
  );
}
