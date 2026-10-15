import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import Viewer, { ViewDir } from "./Viewer";
import SitePanel from "./SitePanel";
import SubstitutionPanel from "./SubstitutionPanel";
import StructurePanel from "./StructurePanel";
import FeaturesPanel, { autoIsoLevel } from "./FeaturesPanel";
import PatternsPanel from "./PatternsPanel";
import ViewControls from "./ViewControls";
import { Doc, createDoc, deriveBonds } from "../lib/doc";
import { BondSettings, pairKey } from "../lib/bonding";
import { analyzeSite } from "../lib/analysis";
import { SceneExtras, ViewOptions, atomKey, atomSectors, buildScene, parseAtomKey } from "../lib/scene";
import { ionLabel } from "../lib/format";
import type { FeatureEntry } from "../lib/useFeatures";
import { hopClasses } from "../lib/features";
import { useT, type MsgKey } from "../i18n";

export type Tab = "site" | "subst" | "feat" | "pattern" | "struct";

/** Isosurface colour: a magenta that no element in the VESTA scheme uses, so it reads against polyhedra. */
const ISO_COLOR: [number, number, number] = [226, 54, 150];

interface Props {
  doc: Doc;
  update: (f: (d: Doc) => Partial<Doc>) => void;
  onReplace: (d: Doc) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  entry: FeatureEntry | undefined;
  featError?: string;
}

function resolve<T>(u: SetStateAction<T>, prev: T): T {
  return typeof u === "function" ? (u as (p: T) => T)(prev) : u;
}

export default function StructureView({ doc, update, onReplace, tab, setTab, entry, featError }: Props) {
  const t = useT();
  const { crystal, ox, bondSettings, view } = doc;
  const { bonds, rmax } = useMemo(() => deriveBonds(crystal, ox, bondSettings), [crystal, ox, bondSettings]);
  const [viewCmd, setViewCmd] = useState<{ dir: ViewDir; n: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [doc.id, tab]);

  const selPos = doc.selectedKey ? parseAtomKey(doc.selectedKey).pos : -1;
  const validSel = selPos >= 0 && selPos < crystal.positions.length;
  const analysis = useMemo(
    () => (validSel ? analyzeSite(crystal, ox, bonds, selPos, { kind: doc.radiusKind, hostSite: doc.hostSite, hostSpin: doc.hostSpin }) : null),
    [validSel, crystal, ox, bonds, selPos, doc.radiusKind, doc.hostSite, doc.hostSpin],
  );

  const hops = entry?.static.hops;
  const selClass = useMemo(() => (hops && doc.hopSel ? (hopClasses(crystal, hops).find((c) => c.key === doc.hopSel) ?? null) : null), [crystal, hops, doc.hopSel]);

  const extras = useMemo<SceneExtras>(() => {
    const x: SceneExtras = {};
    if (hops?.length) {
      const rbs = hops.map((h) => h.rb);
      x.hopRange = [Math.min(...rbs), Math.max(...rbs)];
    }
    if (view.showHops && hops?.length) x.hops = hops;
    if (selClass && hops) x.selHops = selClass.members.map((i) => ({ ...hops[i], saddle: entry?.barriers?.[i]?.saddle }));
    if (view.showMinima && entry?.minima) x.minima = entry.minima;
    if (view.showIso && entry?.grid?.energy && doc.mobile)
      x.iso = { field: entry.grid.energy, n: entry.grid.n, level: view.isoLevel ?? autoIsoLevel(entry), color: ISO_COLOR };
    return x;
  }, [view.showHops, view.showIso, view.showMinima, view.isoLevel, entry, doc.mobile, hops, selClass]);

  const scene = useMemo(() => buildScene(crystal, bonds, view, validSel ? doc.selectedKey : null, extras), [crystal, bonds, view, doc.selectedKey, validSel, extras]);

  const setView = (u: SetStateAction<ViewOptions>) => update((d) => ({ view: resolve(u, d.view) }));
  const setOx = (u: SetStateAction<Record<string, number>>) => update((d) => ({ ox: resolve(u, d.ox) }));
  const setBondSettings = (u: SetStateAction<BondSettings>) => update((d) => ({ bondSettings: resolve(u, d.bondSettings) }));

  const setSiteCutoff = useCallback(
    (cut: number) => {
      if (!analysis) return;
      const c = Math.round(cut * 1000) / 1000;
      update((d) => {
        const bs = d.bondSettings;
        if (d.cutScope === "site") return { bondSettings: { ...bs, siteOverride: { ...bs.siteOverride, [analysis.group]: c } } };
        const pairs = { ...bs.pairs };
        const P = crystal.positions[analysis.pos];
        const hostEls = new Set(P.occupants.map((o) => crystal.sites[o.site].element));
        const ligEls = new Set<string>();
        for (const nb of bonds.eligible[analysis.pos]) for (const o of crystal.positions[nb.j].occupants) ligEls.add(crystal.sites[o.site].element);
        for (const h of hostEls)
          for (const l of ligEls) {
            const k = pairKey(h, l);
            if (pairs[k]) pairs[k] = { ...pairs[k], max: c };
          }
        const so = { ...bs.siteOverride };
        delete so[analysis.group];
        return { bondSettings: { ...bs, pairs, siteOverride: so } };
      });
    },
    [analysis, crystal, bonds, update],
  );

  const clearSiteOverride = useCallback(() => {
    if (!analysis) return;
    update((d) => {
      const so = { ...d.bondSettings.siteOverride };
      delete so[analysis.group];
      return { bondSettings: { ...d.bondSettings, siteOverride: so } };
    });
  }, [analysis, update]);

  const describe = useCallback(
    (key: string) => {
      const { pos, t: translation } = parseAtomKey(key);
      const p = crystal.positions[pos];
      if (!p) return "";
      const ions = p.occupants.map((o) => ionLabel(crystal.sites[o.site].element, ox[crystal.sites[o.site].label])).join(" / ");
      const f = p.frac.map((v, i) => (v + translation[i]).toFixed(3)).join(", ");
      const sectors = atomSectors(crystal, pos);
      const fractions = sectors.length > 1 ? "  " + sectors.map((s) => `${s.element ?? t("view.vacancy")} ${(s.fraction * 100).toFixed(1)}%`).join(" / ") : "";
      return `${p.group}  ${ions}${fractions}  (${f})  CN ${bonds.bonded[pos].length}`;
    },
    [crystal, ox, bonds, t],
  );

  const onPick = useCallback(
    (key: string) => {
      update((d) => {
        const prev = d.selectedKey ? parseAtomKey(d.selectedKey).pos : -1;
        const changed = prev < 0 || crystal.positions[prev]?.group !== crystal.positions[parseAtomKey(key).pos]?.group;
        return changed ? { selectedKey: key, hostSite: undefined, hostSpin: "" } : { selectedKey: key };
      });
    },
    [crystal, update],
  );

  const selectGroup = (groupKey: string) => {
    const g = crystal.groups.find((x) => x.key === groupKey);
    if (!g) return;
    update(() => ({ hostSite: undefined, hostSpin: "", selectedKey: atomKey(g.positions[0], [0, 0, 0]) }));
  };

  const chooseBlock = (idx: number) => {
    try {
      onReplace({ ...createDoc(doc.blocks, doc.fileName, idx, doc.colorSlot), id: doc.id });
    } catch {
      /* keep current */
    }
  };

  const tabs: Tab[] = ["struct", "site", "subst", "feat", "pattern"];

  return (
    <main className="layout">
      <section className="stage" aria-label={t("stage.aria")}>
        <div className="stage-head">
          <div className="stage-title">
            <strong>{crystal.title}</strong>
            <span className="mono">{doc.formula}</span>
            <span className="tag">{crystal.spaceGroup.symbol}</span>
            <span className="muted small">{doc.fileName}</span>
          </div>
        </div>
        <div className="stage-body">
          <Viewer spec={scene} structureId={`${doc.id}|${doc.blockIdx}|${view.supercell.join("x")}`} viewCmd={viewCmd} onPick={onPick} describe={describe} />
          <ViewControls view={view} setView={setView} onViewDir={(dir) => setViewCmd((c) => ({ dir, n: (c?.n ?? 0) + 1 }))} crystal={crystal} ox={ox} bonds={bonds} />
          {(view.showIso || view.showHops || view.showMinima || selClass) && (
            <div className="overlay-chips">
              {view.showIso && (
                <button className="chip is-on" onClick={() => setView((v) => ({ ...v, showIso: false }))} title={t("stage.hideIso")}>
                  BVSE ΔE ≤ {(view.isoLevel ?? autoIsoLevel(entry)).toFixed(2)} eV ✕
                </button>
              )}
              {view.showHops && (
                <button className="chip is-on" onClick={() => setView((v) => ({ ...v, showHops: false }))} title={t("stage.hideHops")}>
                  {t("stage.hops")} ✕
                </button>
              )}
              {view.showMinima && (
                <button className="chip is-on" onClick={() => setView((v) => ({ ...v, showMinima: false }))} title={t("stage.hideMinima")} id="hide-minima">
                  {t("stage.minima")} ✕
                </button>
              )}
              {selClass && (
                <button className="chip is-on chip-path" onClick={() => update(() => ({ hopSel: null }))} title={t("stage.clearPath")} id="clear-hop-path">
                  {t("stage.path", { from: selClass.from, to: selClass.to, d: selClass.d.toFixed(3), n: selClass.members.length })} ✕
                </button>
              )}
            </div>
          )}
          <p className="stage-hint">{t("stage.hint")}</p>
        </div>
      </section>

      <aside className="panel">
        <nav className="tabs" role="tablist">
          {tabs.map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "is-active" : ""}`} onClick={() => setTab(k)} id={`tab-${k}`}>
              {t(`tab.${k}` as MsgKey)}
            </button>
          ))}
        </nav>
        <div className="panel-body" ref={panelRef}>
          {tab === "site" && (
            <SitePanel
              crystal={crystal}
              ox={ox}
              bonds={bonds}
              bondSettings={bondSettings}
              analysis={analysis}
              hostSite={doc.hostSite}
              setHostSite={(v) => update(() => ({ hostSite: v }))}
              hostSpin={doc.hostSpin}
              setHostSpin={(v) => update(() => ({ hostSpin: v }))}
              radiusKind={doc.radiusKind}
              setRadiusKind={(k) => update(() => ({ radiusKind: k }))}
              cutScope={doc.cutScope}
              setCutScope={(s) => update(() => ({ cutScope: s }))}
              onCutoff={setSiteCutoff}
              onClearOverride={clearSiteOverride}
              onSelectGroup={selectGroup}
              rmax={rmax}
              goSubst={() => setTab("subst")}
            />
          )}
          {tab === "subst" && <SubstitutionPanel analysis={analysis} crystal={crystal} onSelectGroup={selectGroup} />}
          {tab === "feat" && <FeaturesPanel doc={doc} update={update} entry={entry} error={featError} />}
          {tab === "pattern" && <PatternsPanel doc={doc} />}
          {tab === "struct" && (
            <StructurePanel
              crystal={crystal}
              loaded={{ fileName: doc.fileName, blocks: doc.blocks.map((b) => b.name), blockIdx: doc.blockIdx }}
              onBlock={chooseBlock}
              ox={ox}
              setOx={setOx}
              oxGuessed={doc.oxGuessed}
              bondSettings={bondSettings}
              setBondSettings={setBondSettings}
              bonds={bonds}
              onSelectGroup={selectGroup}
              selectedGroup={analysis?.group ?? null}
            />
          )}
        </div>
      </aside>
    </main>
  );
}
