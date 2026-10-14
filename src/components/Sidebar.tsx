import type { Doc } from "../lib/doc";
import { SAMPLES } from "../samples";
import { seriesColor } from "./charts";
import { useT, type MsgKey } from "../i18n";

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
  const t = useT();
  return (
    <nav className="sidebar" aria-label={t("side.nav")}>
      <div className="side-top">
        <button className={`side-mode ${p.mode === "compare" ? "is-on" : ""}`} onClick={() => p.onMode(p.mode === "compare" ? "structure" : "compare")} id="mode-compare" aria-pressed={p.mode === "compare"} title={t("side.compareTitle")}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>{t("side.compare")}</span>
        </button>
      </div>
      <ul className="side-list">
        {p.docs.map((d) => {
          const active = p.mode === "structure" && d.id === p.activeId;
          const inCompare = !p.excluded.has(d.id);
          return (
            <li key={d.id} className={`side-item ${active ? "is-active" : ""} ${p.mode === "compare" && !inCompare ? "is-dim" : ""}`}>
              <button className="side-card" onClick={() => (p.mode === "compare" ? p.onToggleCompare(d.id) : p.onSelect(d.id))} title={`${d.name} (${d.formula})`}>
                <span className="side-thumb">{d.thumb ? <img src={d.thumb} alt="" /> : <span className="side-thumb-ph" />}</span>
                <span className="side-name">
                  <i className="side-dot" style={{ background: seriesColor(d.colorSlot) }} />
                  {d.name}
                </span>
                <span className="side-formula mono">{d.formula}</span>
              </button>
              {p.mode === "compare" ? (
                <input className="side-check" type="checkbox" checked={inCompare} onChange={() => p.onToggleCompare(d.id)} aria-label={t("side.include", { name: d.name })} id={`cmp-${d.id}`} />
              ) : (
                <button className="side-close" onClick={() => p.onClose(d.id)} aria-label={t("side.closeDoc", { name: d.name })} title={t("common.close")}>
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
          aria-label={t("side.addSample")}
          id="side-sample"
        >
          <option value="">{t("side.samples")}</option>
          <option value="__all">{t("side.openAll")}</option>
          {SAMPLES.map((s) => (
            <option key={s.id} value={s.id}>
              {t(`sample.${s.id}` as MsgKey)}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}
