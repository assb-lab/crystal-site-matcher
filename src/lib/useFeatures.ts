// Background computation of structure features for open documents.
// Static descriptors are computed synchronously (fast); the BVSE / void grid runs in chunks.
import { useEffect, useRef, useState } from "react";
import { Doc, deriveBonds, featureSig } from "./doc";
import { FeatureValue, StaticFeatures, computeStaticFeatures, ionicRadiusFn, mobileSiteEnergies } from "./features";
import { FrameworkField, GridResult, computeGrid } from "./bvse";
import { XrdPattern, simulateXrd } from "./xrd";

export type GridStatus = "pending" | "running" | "done" | "none" | "error";

export interface FeatureEntry {
  sig: string;
  static: StaticFeatures;
  xrd: XrdPattern;
  grid: GridResult | null;
  gridStatus: GridStatus;
  gridError?: string;
  progress: number;
  siteE: { pos: number; group: string; E: number }[] | null;
  values: Record<string, FeatureValue>;
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export function useFeatures(docs: Doc[], wantedIds: string[]) {
  const [entries, setEntries] = useState<Record<string, FeatureEntry>>({});
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const busy = useRef(false);
  const failed = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [kick, setKick] = useState(0);

  // drop entries of closed documents
  useEffect(() => {
    const ids = new Set(docs.map((d) => d.id));
    if (Object.keys(entriesRef.current).some((k) => !ids.has(k)))
      setEntries((e) => Object.fromEntries(Object.entries(e).filter(([k]) => ids.has(k))));
  }, [docs]);

  useEffect(() => {
    if (busy.current) return;
    const wanted = wantedIds.map((id) => docsRef.current.find((d) => d.id === id)).filter((d): d is Doc => !!d);
    // 1) static features first, for every wanted doc
    const needStatic = wanted.find((d) => entriesRef.current[d.id]?.sig !== featureSig(d) && !failed.current.has(featureSig(d)));
    const needGrid = wanted.find((d) => entriesRef.current[d.id]?.sig === featureSig(d) && entriesRef.current[d.id].gridStatus === "pending");
    const job = needStatic ?? needGrid;
    if (!job) return;
    busy.current = true;
    const sig = featureSig(job);
    const stale = () => {
      const cur = docsRef.current.find((d) => d.id === job.id);
      return !cur || featureSig(cur) !== sig;
    };
    (async () => {
      try {
        await nextFrame();
        if (stale()) return;
        const { table, bonds } = deriveBonds(job.crystal, job.ox, job.bondSettings);
        if (needStatic === job) {
          const st = computeStaticFeatures(job.crystal, job.ox, bonds, table, { mobileEl: job.mobile, hopCutoff: job.hopCutoff });
          const xrd = simulateXrd(job.crystal);
          const hasMobile = !!job.mobile && job.crystal.sites.some((s) => s.element === job.mobile);
          setEntries((e) => ({
            ...e,
            [job.id]: { sig, static: st, xrd, grid: null, gridStatus: hasMobile ? "pending" : "none", progress: 0, siteE: null, values: { ...st.values } },
          }));
          return;
        }
        // 2) grid
        setEntries((e) => (e[job.id] ? { ...e, [job.id]: { ...e[job.id], gridStatus: "running", progress: 0 } } : e));
        const field = new FrameworkField(job.crystal, job.ox, job.mobile!, ionicRadiusFn(job.crystal, job.ox, bonds), 8);
        let lastP = 0;
        const grid = await computeGrid(
          field,
          job.crystal,
          { resolution: job.gridRes, maxPoints: 260000, eCap: 6 },
          (p) => {
            if (p - lastP > 0.08 || p === 1) {
              lastP = p;
              setEntries((e) => (e[job.id] && e[job.id].sig === sig ? { ...e, [job.id]: { ...e[job.id], progress: p } } : e));
            }
          },
          stale,
        );
        if (!grid || stale()) return;
        const siteE = grid.energy ? mobileSiteEnergies(job.crystal, field, job.mobile!, grid.eMinAbs) : null;
        const vals: Record<string, FeatureValue> = {
          E_1D: Number.isFinite(grid.E[0]) ? grid.E[0] : null,
          E_2D: Number.isFinite(grid.E[1]) ? grid.E[1] : null,
          E_3D: Number.isFinite(grid.E[2]) ? grid.E[2] : null,
          R_1D: Number.isNaN(grid.R[0]) ? null : grid.R[0],
          R_2D: Number.isNaN(grid.R[1]) ? null : grid.R[1],
          R_3D: Number.isNaN(grid.R[2]) ? null : grid.R[2],
          maxVoid: grid.maxVoid,
        };
        if (siteE && siteE.length) {
          const Es = siteE.map((s) => s.E);
          const m = Es.reduce((a, b) => a + b, 0) / Es.length;
          vals.siteE_sd = Math.sqrt(Es.reduce((a, b) => a + (b - m) ** 2, 0) / Es.length);
          vals.siteE_range = Math.max(...Es) - Math.min(...Es);
        }
        setEntries((e) =>
          e[job.id] && e[job.id].sig === sig
            ? { ...e, [job.id]: { ...e[job.id], grid, siteE, gridStatus: "done", progress: 1, values: { ...e[job.id].values, ...vals } } }
            : e,
        );
      } catch (err) {
        if (needStatic === job) {
          failed.current.add(sig);
          setErrors((x) => ({ ...x, [job.id]: (err as Error).message }));
        }
        setEntries((e) => (e[job.id] ? { ...e, [job.id]: { ...e[job.id], gridStatus: "error", gridError: (err as Error).message } } : e));
      } finally {
        busy.current = false;
        setKick((k) => k + 1);
      }
    })();
  }, [docs, wantedIds, entries, kick]);

  return { entries, errors };
}
