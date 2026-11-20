import { useEffect, useState } from "react";
import Modal from "./Modal";
import { TOUR_STEPS } from "../lib/onboarding";
import { useT, type MsgKey } from "../i18n";

/**
 * First-visit guide (#58): what the app does and how to use it, a few pages with back / next.
 * Skip, ✕, Esc and a click on the backdrop all close it; the header "?" button opens it again.
 */
export default function Onboarding({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [i, setI] = useState(0);
  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;
  const go = (d: number) => setI((x) => Math.min(TOUR_STEPS.length - 1, Math.max(0, x + d)));
  // ← / → page wherever focus is in the modal (e.g. on ✕, or on the body after the back button disappears)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Modal open onClose={onClose} title={t(`tour.${step.id}.title` as MsgKey)} id="onboarding">
      <div className="tour">
        <ul className="tour-list">
          {Array.from({ length: step.items }, (_, k) => (
            <li key={`${step.id}-${k}`}>{t(`tour.${step.id}.${k + 1}` as MsgKey)}</li>
          ))}
        </ul>
        <div className="tour-foot">
          <div className="tour-dots" aria-label={t("tour.progress", { i: i + 1, n: TOUR_STEPS.length })} role="img">
            {TOUR_STEPS.map((s, k) => (
              <span key={s.id} className={k === i ? "is-on" : ""} />
            ))}
            <span className="muted small tour-count">
              {i + 1} / {TOUR_STEPS.length}
            </span>
          </div>
          <div className="row gap-s">
            {!last && (
              <button className="btn btn-ghost" onClick={onClose} id="tour-skip">
                {t("tour.skip")}
              </button>
            )}
            {i > 0 && (
              <button className="btn" onClick={() => go(-1)} id="tour-back">
                {t("tour.back")}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => (last ? onClose() : go(1))} id="tour-next" data-autofocus>
              {t(last ? "tour.start" : "tour.next")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
