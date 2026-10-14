import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "../i18n";

/** Native <dialog> modal: focus trapping, Esc and top-layer stacking come from the browser. */
export default function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  id,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  id?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      id={id}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // click on the backdrop (the dialog element itself, outside the panel)
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <div className="modal-panel">
        <div className="modal-head">
          <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
          <button className="btn btn-ghost btn-small" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </dialog>
  );
}
