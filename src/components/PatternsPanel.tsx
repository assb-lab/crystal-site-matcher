import { useMemo, useState } from "react";
import type { Doc } from "../lib/doc";
import { usePatterns } from "../lib/usePatterns";
import { LineChart, seriesColor } from "./charts";
import { useT } from "../i18n";

/**
 * Partial g(r) and simulated powder XRD of the open structure (#41). Both depend on the atoms only, so they
 * are computed here on demand (cached per crystal) and never start the BVSE grid of the Features tab.
 */
export default function PatternsPanel({ doc }: { doc: Doc }) {
  const t = useT();
  const cr = doc.crystal;
  const prdf = usePatterns([cr], "prdf")(cr);
  const xrd = usePatterns([cr], "xrd")(cr);
  const anionEls = [...new Set(cr.sites.filter((s) => (doc.ox[s.label] ?? 0) < 0).map((s) => s.element))];
  const defaultPairs = useMemo(() => {
    const m = doc.mobile;
    const pairs = prdf?.map((p) => p.pair) ?? [];
    const pick = pairs.filter((p) => {
      const [a, b] = p.split("–");
      return (m && (a === m || b === m)) || (anionEls.includes(a) && anionEls.includes(b));
    });
    return pick.length ? pick.slice(0, 4) : pairs.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prdf, doc.mobile]);
  const [pairs, setPairs] = useState<string[] | null>(null);
  const shownPairs = (pairs ?? defaultPairs).filter((p) => prdf?.some((x) => x.pair === p));

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>{t("feat.prdf")} g(r)</h2>
        </div>
        {prdf ? (
          <>
            <div className="chips">
              {prdf.map((p) => {
                const on = shownPairs.includes(p.pair);
                return (
                  <button
                    key={p.pair}
                    className={`elchip ${on ? "is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() => setPairs(on ? shownPairs.filter((x) => x !== p.pair) : [...shownPairs, p.pair].slice(-8))}
                  >
                    {p.pair}
                  </button>
                );
              })}
            </div>
            <LineChart
              series={shownPairs.map((pair, i) => ({ id: pair, label: pair, color: seriesColor(i), points: prdf.find((p) => p.pair === pair)!.points }))}
              xLabel="r (Å)"
              yLabel="g(r)"
              xDomain={[0, 8]}
              xFmt={(x) => x.toFixed(2) + " Å"}
              yFmt={(y) => y.toFixed(2)}
            />
          </>
        ) : (
          <p className="muted small">{t("pattern.computing")}</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t("feat.xrd")}</h2>
        </div>
        {xrd ? (
          <LineChart
            series={[{ id: "x", label: t("feat.intensity"), color: seriesColor(6), points: xrd.profile }]}
            xLabel="2θ (°)"
            yLabel={t("feat.relIntensity")}
            height={200}
            xDomain={[5, 90]}
            yDomain={[0, 115]}
            annotations={[...xrd.peaks]
              .sort((a, b) => b.intensity - a.intensity)
              .slice(0, 6)
              .map((p) => ({ x: p.twoTheta, y: p.intensity, text: p.hkl.join("") }))}
            xFmt={(x) => x.toFixed(2) + "°"}
            yFmt={(y) => y.toFixed(1)}
          />
        ) : (
          <p className="muted small">{t("pattern.computing")}</p>
        )}
      </section>
    </div>
  );
}
