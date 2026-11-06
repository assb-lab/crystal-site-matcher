import type { Dispatch, SetStateAction } from "react";
import { atomSectors, defaultPolyElements, polyCenterElements, type PolyCenter, type PolyMode, type ViewOptions } from "../lib/scene";
import type { Crystal, Vec3 } from "../lib/structure";
import type { BondTable } from "../lib/bonding";
import type { ViewDir } from "./Viewer";
import { hexRgb, rgbHex } from "../lib/elementColors";
import { rgbCss } from "../lib/format";
import { useElementColors } from "./ElementColors";
import { useT } from "../i18n";

interface Props {
  view: ViewOptions;
  setView: Dispatch<SetStateAction<ViewOptions>>;
  onViewDir: (d: ViewDir) => void;
  crystal: Crystal;
  ox: Record<string, number>;
  bonds: BondTable;
}

export default function ViewControls({ view, setView, onViewDir, crystal, ox, bonds }: Props) {
  const t = useT();
  const { colors, colorOf, setColor, resetColors } = useElementColors();
  const els = [...new Set(crystal.sites.map((s) => s.element))];
  const customised = els.filter((el) => colors[el]);
  const mixed = crystal.positions.some((p) => atomSectors(crystal, p.index).length > 1);
  const centerEls = polyCenterElements(crystal, ox, view.polyCenter);
  const setCenter = (c: PolyCenter) =>
    setView((o) => (o.polyCenter === c ? o : { ...o, polyCenter: c, polyElements: defaultPolyElements(crystal, ox, bonds, c) }));
  const set = <K extends keyof ViewOptions>(k: K, v: ViewOptions[K]) => setView((o) => ({ ...o, [k]: v }));
  const toggleIn = (k: "polyElements" | "hiddenElements", el: string) =>
    setView((o) => ({ ...o, [k]: o[k].includes(el) ? o[k].filter((x) => x !== el) : [...o[k], el] }));

  return (
    <>
      <div className="viewdirs" role="group" aria-label={t("view.group")}>
        {(["a", "b", "c"] as ViewDir[]).map((d) => (
          <button key={d} className="chip" onClick={() => onViewDir(d)} title={t("view.along", { axis: d })} id={`view-${d}`}>
            {d}
          </button>
        ))}
        {(["a*", "b*", "c*"] as ViewDir[]).map((d) => (
          <button key={d} className="chip" onClick={() => onViewDir(d)} title={t("view.alongRecip", { axis: d })} id={`view-${d.replace("*", "s")}`}>
            {d}
          </button>
        ))}
        <button className="chip" onClick={() => onViewDir("reset")} title={t("view.resetTitle")} id="view-reset">
          {t("view.reset")}
        </button>
      </div>

      <details className="viewmenu">
        <summary className="chip">{t("view.menu")}</summary>
        <div className="viewmenu-body">
          <fieldset>
            <legend>{t("view.range")}</legend>
            <div className="row gap-s">
              {(["a", "b", "c"] as const).map((ax, i) => (
                <label key={ax} className="field-inline" htmlFor={`sc-${ax}`}>
                  <span>{ax}</span>
                  <select
                    id={`sc-${ax}`}
                    value={view.supercell[i]}
                    onChange={(e) => {
                      const sc = [...view.supercell] as Vec3;
                      sc[i] = parseInt(e.target.value, 10);
                      set("supercell", sc);
                    }}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>{t("view.poly")}</legend>
            <div className="seg" role="radiogroup">
              {(
                [
                  ["elements", t("view.poly.elements")],
                  ["selected", t("view.poly.selected")],
                  ["none", t("view.poly.none")],
                ] as [PolyMode, string][]
              ).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={view.polyMode === k} className={view.polyMode === k ? "is-on" : ""} onClick={() => set("polyMode", k)}>
                  {l}
                </button>
              ))}
            </div>
            {view.polyMode === "elements" && (
              <div className="field-inline">
                <span>{t("view.poly.center")}</span>
                <div className="seg" role="radiogroup" aria-label={t("view.poly.center")}>
                {(
                  [
                    ["cation", t("view.poly.cation")],
                    ["anion", t("view.poly.anion")],
                  ] as [PolyCenter, string][]
                ).map(([k, l]) => (
                  <button key={k} role="radio" aria-checked={view.polyCenter === k} className={view.polyCenter === k ? "is-on" : ""} onClick={() => setCenter(k)} id={`poly-center-${k}`}>
                    {l}
                  </button>
                ))}
                </div>
              </div>
            )}
            {view.polyMode === "elements" && (
              <div className="chips">
                {centerEls.length === 0 && <span className="muted small">{t("view.poly.noCenter")}</span>}
                {centerEls.map((el) => (
                  <button key={el} className={`elchip ${view.polyElements.includes(el) ? "is-on" : ""}`} onClick={() => toggleIn("polyElements", el)} aria-pressed={view.polyElements.includes(el)}>
                    <i style={{ background: rgbCss(colorOf(el)) }} />
                    {el}
                  </button>
                ))}
              </div>
            )}
            <label className="slider" htmlFor="poly-op">
              <span>{t("view.opacity")}</span>
              <input id="poly-op" type="range" min={0.1} max={0.9} step={0.05} value={view.polyOpacity} onChange={(e) => set("polyOpacity", +e.target.value)} />
            </label>
          </fieldset>

          <fieldset>
            <legend>{t("view.atoms")}</legend>
            {mixed && <p className="muted small">{t("view.occupancyColors")}</p>}
            <div className="checks">
              <label htmlFor="show-bonds">
                <input id="show-bonds" type="checkbox" checked={view.showBonds} onChange={(e) => set("showBonds", e.target.checked)} /> {t("view.bonds")}
              </label>
              <label htmlFor="show-cell">
                <input id="show-cell" type="checkbox" checked={view.showCell} onChange={(e) => set("showCell", e.target.checked)} /> {t("view.cell")}
              </label>
              <label htmlFor="show-labels">
                <input id="show-labels" type="checkbox" checked={view.showLabels} onChange={(e) => set("showLabels", e.target.checked)} /> {t("view.labels")}
              </label>
            </div>
            <label className="slider" htmlFor="atom-scale">
              <span>{t("view.atomSize")}</span>
              <input id="atom-scale" type="range" min={0.1} max={1} step={0.05} value={view.atomScale} onChange={(e) => set("atomScale", +e.target.value)} />
            </label>
            <label className="slider" htmlFor="bond-r">
              <span>{t("view.bondWidth")}</span>
              <input id="bond-r" type="range" min={0.03} max={0.25} step={0.01} value={view.bondRadius} onChange={(e) => set("bondRadius", +e.target.value)} />
            </label>
            <div className="sub-legend">{t("view.hide")}</div>
            <div className="chips">
              {els.map((el) => {
                const hidden = view.hiddenElements.includes(el);
                return (
                  <button key={el} className={`elchip ${hidden ? "is-off" : "is-on"}`} onClick={() => toggleIn("hiddenElements", el)} aria-pressed={!hidden}>
                    <i style={{ background: rgbCss(colorOf(el)) }} />
                    {el}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend>{t("view.colors")}</legend>
            <div className="chips">
              {els.map((el) => (
                <span key={el} className={`colorchip ${colors[el] ? "is-custom" : ""}`}>
                  <label htmlFor={`color-${el}`} title={t("view.colors.pick", { el })}>
                    <input
                      id={`color-${el}`}
                      type="color"
                      value={rgbHex(colorOf(el))}
                      aria-label={t("view.colors.pick", { el })}
                      onChange={(e) => {
                        const c = hexRgb(e.target.value);
                        if (c) setColor(el, c);
                      }}
                    />
                    {el}
                  </label>
                  {colors[el] && (
                    <button className="colorchip-reset" onClick={() => setColor(el, null)} aria-label={t("view.colors.resetOne", { el })} title={t("view.colors.resetOne", { el })} id={`color-reset-${el}`}>
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            <p className="muted small">{t("view.colors.hint")}</p>
            {customised.length > 0 && (
              <button className="btn btn-ghost btn-small" onClick={() => resetColors(customised)} id="color-reset-all">
                {t("view.colors.reset")}
              </button>
            )}
          </fieldset>
        </div>
      </details>
    </>
  );
}
