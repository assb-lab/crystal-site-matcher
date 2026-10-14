import type { Dispatch, SetStateAction } from "react";
import type { ViewOptions, PolyMode } from "../lib/scene";
import type { Crystal, Vec3 } from "../lib/structure";
import type { ViewDir } from "./Viewer";
import { elementColor } from "../lib/data";
import { rgbCss } from "../lib/format";

interface Props {
  view: ViewOptions;
  setView: Dispatch<SetStateAction<ViewOptions>>;
  onViewDir: (d: ViewDir) => void;
  crystal: Crystal;
  ox: Record<string, number>;
}

export default function ViewControls({ view, setView, onViewDir, crystal, ox }: Props) {
  const els = [...new Set(crystal.sites.map((s) => s.element))];
  const cationEls = [...new Set(crystal.sites.filter((s) => (ox[s.label] ?? 0) > 0).map((s) => s.element))];
  const set = <K extends keyof ViewOptions>(k: K, v: ViewOptions[K]) => setView((o) => ({ ...o, [k]: v }));
  const toggleIn = (k: "polyElements" | "hiddenElements", el: string) =>
    setView((o) => ({ ...o, [k]: o[k].includes(el) ? o[k].filter((x) => x !== el) : [...o[k], el] }));

  return (
    <>
      <div className="viewdirs" role="group" aria-label="視点">
        {(["a", "b", "c"] as ViewDir[]).map((d) => (
          <button key={d} className="chip" onClick={() => onViewDir(d)} title={`${d} 軸方向から見る`} id={`view-${d}`}>
            {d}
          </button>
        ))}
        {(["a*", "b*", "c*"] as ViewDir[]).map((d) => (
          <button key={d} className="chip" onClick={() => onViewDir(d)} title={`逆格子 ${d} 方向から見る`} id={`view-${d.replace("*", "s")}`}>
            {d}
          </button>
        ))}
        <button className="chip" onClick={() => onViewDir("reset")} title="初期の視点に戻す" id="view-reset">
          リセット
        </button>
      </div>

      <details className="viewmenu">
        <summary className="chip">表示設定</summary>
        <div className="viewmenu-body">
          <fieldset>
            <legend>表示範囲（単位胞の数）</legend>
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
            <legend>多面体</legend>
            <div className="seg" role="radiogroup">
              {(
                [
                  ["elements", "元素ごと"],
                  ["selected", "選択サイトのみ"],
                  ["none", "なし"],
                ] as [PolyMode, string][]
              ).map(([k, l]) => (
                <button key={k} role="radio" aria-checked={view.polyMode === k} className={view.polyMode === k ? "is-on" : ""} onClick={() => set("polyMode", k)}>
                  {l}
                </button>
              ))}
            </div>
            {view.polyMode === "elements" && (
              <div className="chips">
                {cationEls.map((el) => (
                  <button key={el} className={`elchip ${view.polyElements.includes(el) ? "is-on" : ""}`} onClick={() => toggleIn("polyElements", el)} aria-pressed={view.polyElements.includes(el)}>
                    <i style={{ background: rgbCss(elementColor(el)) }} />
                    {el}
                  </button>
                ))}
              </div>
            )}
            <label className="slider" htmlFor="poly-op">
              <span>不透明度</span>
              <input id="poly-op" type="range" min={0.1} max={0.9} step={0.05} value={view.polyOpacity} onChange={(e) => set("polyOpacity", +e.target.value)} />
            </label>
          </fieldset>

          <fieldset>
            <legend>原子と結合</legend>
            <div className="checks">
              <label htmlFor="show-bonds">
                <input id="show-bonds" type="checkbox" checked={view.showBonds} onChange={(e) => set("showBonds", e.target.checked)} /> 結合
              </label>
              <label htmlFor="show-cell">
                <input id="show-cell" type="checkbox" checked={view.showCell} onChange={(e) => set("showCell", e.target.checked)} /> 単位胞
              </label>
              <label htmlFor="show-labels">
                <input id="show-labels" type="checkbox" checked={view.showLabels} onChange={(e) => set("showLabels", e.target.checked)} /> 結合距離ラベル
              </label>
            </div>
            <label className="slider" htmlFor="atom-scale">
              <span>原子サイズ</span>
              <input id="atom-scale" type="range" min={0.1} max={1} step={0.05} value={view.atomScale} onChange={(e) => set("atomScale", +e.target.value)} />
            </label>
            <label className="slider" htmlFor="bond-r">
              <span>結合の太さ</span>
              <input id="bond-r" type="range" min={0.03} max={0.25} step={0.01} value={view.bondRadius} onChange={(e) => set("bondRadius", +e.target.value)} />
            </label>
            <div className="sub-legend">非表示にする元素</div>
            <div className="chips">
              {els.map((el) => {
                const hidden = view.hiddenElements.includes(el);
                return (
                  <button key={el} className={`elchip ${hidden ? "is-off" : "is-on"}`} onClick={() => toggleIn("hiddenElements", el)} aria-pressed={!hidden}>
                    <i style={{ background: rgbCss(elementColor(el)) }} />
                    {el}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      </details>
    </>
  );
}
