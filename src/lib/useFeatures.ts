// Background computation of structure features for open documents.
// Static descriptors are computed synchronously (fast); the BVSE / void grid runs in chunks.
import { useEffect, useMemo, useRef, useState } from "react";
import { Doc, featureSig } from "./doc";
import { FeatureValue, StaticFeatures } from "./features";
import { GridResult } from "./bvse";
import { gridStage, hasMobile, staticStage } from "./pipeline";
import type { EnergyMinimum } from "./landscape";
import type { HopBarrier } from "./hopBarriers";

export type GridStatus = "pending" | "running" | "done" | "none" | "error";

export interface FeatureEntry {
  sig: string;
  static: StaticFeatures;
  grid: GridResult | null;
  gridStatus: GridStatus;
  gridError?: string;
  progress: number;
  siteE: { pos: number; group: string; E: number }[] | null;
  minima: EnergyMinimum[] | null;
  barriers: (HopBarrier | null)[] | null; // aligned with static.hops
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
  // static-stage errors with the settings they belong to: a later successful run (or other settings) hides them
  const [failures, setFailures] = useState<Record<string, { sig: string; message: string }>>({});
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
        if (needStatic === job) {
          const st = staticStage(job, job.hopCutoff);
          setFailures((x) => {
            if (!(job.id in x)) return x;
            const { [job.id]: _, ...rest } = x;
            return rest;
          });
          setEntries((e) => ({
            ...e,
            [job.id]: { sig, static: st, grid: null, gridStatus: hasMobile(job) ? "pending" : "none", progress: 0, siteE: null, minima: null, barriers: null, values: { ...st.values } },
          }));
          return;
        }
        // 2) grid
        setEntries((e) => (e[job.id] ? { ...e, [job.id]: { ...e[job.id], gridStatus: "running", progress: 0 } } : e));
        let lastP = 0;
        const res = await gridStage(
          job,
          job.gridRes,
          (p) => {
            if (p - lastP > 0.08 || p === 1) {
              lastP = p;
              setEntries((e) => (e[job.id] && e[job.id].sig === sig ? { ...e, [job.id]: { ...e[job.id], progress: p } } : e));
            }
          },
          stale,
          entriesRef.current[job.id]?.static.hops ?? [],
        );
        if (!res || stale()) {
          // cancelled: if the settings came back to this run's, compute again instead of staying "running"
          setEntries((e) => (e[job.id] && e[job.id].sig === sig && e[job.id].gridStatus === "running" ? { ...e, [job.id]: { ...e[job.id], gridStatus: "pending", progress: 0 } } : e));
          return;
        }
        const { grid, siteE, minima, barriers, values: vals } = res;
        setEntries((e) =>
          e[job.id] && e[job.id].sig === sig
            ? { ...e, [job.id]: { ...e[job.id], grid, siteE, minima, barriers, gridStatus: "done", progress: 1, values: { ...e[job.id].values, ...vals } } }
            : e,
        );
      } catch (err) {
        const message = (err as Error).message;
        if (needStatic === job) {
          failed.current.add(sig);
          setFailures((x) => ({ ...x, [job.id]: { sig, message } }));
        } else setEntries((e) => (e[job.id] && e[job.id].sig === sig ? { ...e, [job.id]: { ...e[job.id], gridStatus: "error", gridError: message } } : e));
      } finally {
        busy.current = false;
        setKick((k) => k + 1);
      }
    })();
  }, [docs, wantedIds, entries, kick]);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of docs) {
      const f = failures[d.id];
      if (f && f.sig === featureSig(d)) out[d.id] = f.message;
    }
    return out;
  }, [docs, failures]);
  return { entries, errors };
}
