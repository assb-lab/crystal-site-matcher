import { PT_CELLS } from "../lib/periodic";

export type CellState = "good" | "possible" | "hard" | "unlikely" | "neutral" | "disabled";

export interface CellInfo {
  state: CellState;
  value?: string; // e.g. best score
  sub?: string; // e.g. charges
  title?: string;
}

interface Props {
  cell: (el: string) => CellInfo;
  selected?: string | null;
  marked?: string | null; // e.g. the host element
  onPick: (el: string) => void;
  ariaLabel: string;
}

export default function PeriodicTable({ cell, selected, marked, onPick, ariaLabel }: Props) {
  return (
    <div className="ptable-wrap">
      <div className="ptable" role="grid" aria-label={ariaLabel}>
        {PT_CELLS.map((c) => {
          const info = cell(c.el);
          const disabled = info.state === "disabled";
          return (
            <button
              key={c.el}
              className={`pt-cell pt-${info.state} ${selected === c.el ? "is-selected" : ""} ${marked === c.el ? "is-marked" : ""}`}
              style={{ gridRow: c.row, gridColumn: c.col }}
              disabled={disabled}
              onClick={() => onPick(c.el)}
              title={info.title ?? c.el}
              aria-pressed={selected === c.el}
              id={`pt-${c.el}`}
            >
              <span className="pt-z">{c.Z}</span>
              <span className="pt-sym">{c.el}</span>
              {info.value && <span className="pt-val">{info.value}</span>}
              {info.sub && <span className="pt-sub">{info.sub}</span>}
            </button>
          );
        })}
        <span className="pt-marker" style={{ gridRow: 6, gridColumn: 3 }} aria-hidden="true">
          57–71
        </span>
        <span className="pt-marker" style={{ gridRow: 7, gridColumn: 3 }} aria-hidden="true">
          89–103
        </span>
      </div>
    </div>
  );
}
