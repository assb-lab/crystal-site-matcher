import type { Doc } from "../lib/doc";
import { SAMPLES } from "../samples";
import { seriesColor } from "./charts";

interface Props {
  docs: Doc[];
  activeId: string | null;
  mode: "structure" | "compare";
  excluded: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onToggleCompare: (id: string) => void;
  onMode: (m: "structure" | "compare") => void;
  onOpen: () => void;
  onAddSample: (id: string) => void;
}

export default function Sidebar(p: Props) {
  return (
    <nav className="sidebar" aria-label="開いている構造">
      <div className="side-top">
        <button className={`side-mode ${p.mode === "compare" ? "is-on" : ""}`} onClick={() => p.onMode(p.mode === "compare" ? "structure" : "compare")} id="mode-compare" aria-pressed={p.mode === "compare"} title="開いている構造の特徴量を比較">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>比較</span>
        </button>
      </div>
      <ul className="side-list">
        {p.docs.map((d) => {
          const active = p.mode === "structure" && d.id === p.activeId;
          const inCompare = !p.excluded.has(d.id);
          return (
            <li key={d.id} className={`side-item ${active ? "is-active" : ""} ${p.mode === "compare" && !inCompare ? "is-dim" : ""}`}>
              <button className="side-card" onClick={() => (p.mode === "compare" ? p.onToggleCompare(d.id) : p.onSelect(d.id))} title={`${d.name}（${d.formula}）`}>
                <span className="side-thumb">{d.thumb ? <img src={d.thumb} alt="" /> : <span className="side-thumb-ph" />}</span>
                <span className="side-name">
                  <i className="side-dot" style={{ background: seriesColor(d.colorSlot) }} />
                  {d.name}
                </span>
                <span className="side-formula mono">{d.formula}</span>
              </button>
              {p.mode === "compare" ? (
                <input className="side-check" type="checkbox" checked={inCompare} onChange={() => p.onToggleCompare(d.id)} aria-label={`${d.name} を比較に含める`} id={`cmp-${d.id}`} />
              ) : (
                <button className="side-close" onClick={() => p.onClose(d.id)} aria-label={`${d.name} を閉じる`} title="閉じる">
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="side-bottom">
        <button className="btn btn-primary btn-block" onClick={p.onOpen} id="side-open">
          ＋ CIF
        </button>
        <select
          className="side-sample"
          value=""
          onChange={(e) => {
            if (e.target.value) p.onAddSample(e.target.value);
            e.target.value = "";
          }}
          aria-label="サンプルを追加"
          id="side-sample"
        >
          <option value="">サンプル…</option>
          <option value="__all">すべて開く</option>
          {SAMPLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}
