import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { SAMPLES } from "../samples";
import { useT, type MsgKey } from "../i18n";

interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  last: boolean;
}

/** Sample actions share the app's theme, including the expanded list. */
export default function SampleMenu({ onSelect }: { onSelect: (id: string) => void }) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const close = (restore = false) => {
    setPlacement(null);
    if (restore) trigger.current?.focus();
  };
  const open = (last = false) => {
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const down = below >= Math.min(420, above);
    const maxHeight = Math.max(44, Math.min(420, down ? below : above));
    setPlacement({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: down ? rect.bottom + 6 : Math.max(8, rect.top - maxHeight - 6),
      width,
      maxHeight,
      last,
    });
  };
  useLayoutEffect(() => {
    if (!placement) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    items?.[placement.last ? items.length - 1 : 0]?.focus();
  }, [placement]);
  const isOpen = placement !== null;
  useEffect(() => {
    if (!isOpen) return;
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setPlacement(null);
    };
    const resize = () => {
      setPlacement(null);
      if (menu.current?.contains(document.activeElement)) trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
    };
  }, [isOpen]);
  const navigate = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...menu.current!.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === "Escape") { e.preventDefault(); close(true); return; }
    // Return to the trigger before the browser follows the natural document tab order.
    if (e.key === "Tab") { close(true); return; }
    if (e.key === "ArrowDown") next = (current + 1) % items.length;
    else if (e.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    items[next].focus();
  };
  const select = (id: string) => {
    close(true);
    onSelect(id);
  };
  return (
    <>
      <button
        ref={trigger}
        className="side-sample"
        id="side-sample"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? "sample-menu" : undefined}
        onClick={() => isOpen ? close() : open()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(e.key === "ArrowUp"); }
        }}
      >
        <span>{t("side.samples")}</span>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {placement && createPortal(
        <div ref={menu} id="sample-menu" role="menu" aria-label={t("side.samples")} className="sample-menu" style={{ left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }} onKeyDown={navigate}>
          {SAMPLES.map((s) => (
            <button key={s.id} role="menuitem" tabIndex={-1} className="sample-menu-item" onClick={() => select(s.id)}>
              {t(`sample.${s.id}` as MsgKey)}
            </button>
          ))}
          <div role="separator" className="sample-menu-separator" />
          <button role="menuitem" tabIndex={-1} className="sample-menu-item sample-menu-all" onClick={() => select("__all")}>{t("side.openAll")}</button>
        </div>, document.body,
      )}
    </>
  );
}
