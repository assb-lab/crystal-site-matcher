import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Viewer, { ViewDir } from "./components/Viewer";
import SitePanel from "./components/SitePanel";
import SubstitutionPanel from "./components/SubstitutionPanel";
import StructurePanel from "./components/StructurePanel";
import ViewControls from "./components/ViewControls";
import { parseCif, CifBlock } from "./lib/cif";
import { Crystal, buildNeighborTable, crystalFromCif, guessOxidationStates, formulaString } from "./lib/structure";
import { BondSettings, computeBonds, defaultBondSettings, pairKey } from "./lib/bonding";
import { analyzeSite, RadiusKind } from "./lib/analysis";
import { DEFAULT_VIEW, ViewOptions, atomKey, buildScene, defaultPolyElements, parseAtomKey } from "./lib/scene";
import { ionLabel } from "./lib/format";
import { SAMPLES } from "./samples";

type Tab = "site" | "subst" | "struct";

interface Loaded {
  id: string;
  fileName: string;
  blocks: CifBlock[];
  blockIdx: number;
  crystal: Crystal;
  preferSite?: string;
}

let loadCounter = 0;

function loadText(text: string, fileName: string, blockIdx = 0, preferSite?: string): Loaded {
  const blocks = parseCif(text).filter((b) => b.loops.some((l) => l.tags.includes("_atom_site_fract_x")));
  if (blocks.length === 0) throw new Error("原子座標を含むデータブロックが見つかりません（_atom_site_fract_x が必要です）。");
  const idx = Math.min(blockIdx, blocks.length - 1);
  const crystal = crystalFromCif(blocks[idx]);
  return { id: `${fileName}#${idx}#${++loadCounter}`, fileName, blocks, blockIdx: idx, crystal, preferSite };
}

const storage = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

export default function App() {
  const [loaded, setLoaded] = useState<Loaded>(() => loadText(SAMPLES[0].text, `${SAMPLES[0].id}.cif`, 0, SAMPLES[0].site));
  const [sampleId, setSampleId] = useState<string>(SAMPLES[0].id);
  const [error, setError] = useState<string | null>(null);
  const crystal = loaded.crystal;

  const initialOx = useMemo(() => guessOxidationStates(crystal), [crystal]);
  const [ox, setOx] = useState<Record<string, number>>(initialOx.byLabel);
  const [bondSettings, setBondSettings] = useState<BondSettings>(() => defaultBondSettings(crystal, initialOx.byLabel));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hostSite, setHostSite] = useState<number | undefined>(undefined);
  const [hostSpin, setHostSpin] = useState<"" | "HS" | "LS">("");
  const [radiusKind, setRadiusKind] = useState<RadiusKind>("ionic");
  const [cutScope, setCutScope] = useState<"pair" | "site">("pair");
  const [view, setView] = useState<ViewOptions>(DEFAULT_VIEW);
  const [viewCmd, setViewCmd] = useState<{ dir: ViewDir; n: number } | null>(null);
  const [tab, setTab] = useState<Tab>(() => (storage.get("csm.tab") as Tab) || "site");
  const [dragging, setDragging] = useState(false);
  const [needsInit, setNeedsInit] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [loaded.id, tab]);

  useEffect(() => storage.set("csm.tab", tab), [tab]);

  // reset dependent state when a new structure arrives
  const lastId = useRef(loaded.id);
  useEffect(() => {
    if (lastId.current === loaded.id) return;
    lastId.current = loaded.id;
    setOx(initialOx.byLabel);
    setBondSettings(defaultBondSettings(crystal, initialOx.byLabel));
    setSelectedKey(null);
    setHostSite(undefined);
    setHostSpin("");
    setNeedsInit(true);
  }, [loaded.id, crystal, initialOx]);

  const rmax = useMemo(() => {
    const vals = [...Object.values(bondSettings.pairs).map((p) => p.max), ...Object.values(bondSettings.siteOverride)];
    return Math.max(6, Math.ceil(Math.max(...vals, 0) + 1.5));
  }, [bondSettings]);
  const table = useMemo(() => buildNeighborTable(crystal, rmax), [crystal, rmax]);
  const bonds = useMemo(() => computeBonds(crystal, ox, bondSettings, table), [crystal, ox, bondSettings, table]);

  // pick a default site + polyhedron centres once bonds exist for the new structure
  useEffect(() => {
    if (!needsInit || lastId.current !== loaded.id) return;
    setNeedsInit(false);
    setView((v) => ({ ...v, polyElements: defaultPolyElements(crystal, ox, bonds), hiddenElements: [] }));
    const pref = loaded.preferSite ? crystal.groups.find((g) => g.key.split("/").includes(loaded.preferSite!)) : undefined;
    const cationGroup =
      crystal.groups.find((g) => {
        const p = crystal.positions[g.positions[0]];
        const cn = bonds.bonded[p.index].length;
        return (ox[crystal.sites[p.main].label] ?? 0) > 0 && cn >= 4 && cn <= 8;
      }) ?? crystal.groups[0];
    const g = pref ?? cationGroup;
    setSelectedKey(atomKey(g.positions[0], [0, 0, 0]));
  }, [needsInit, loaded, crystal, ox, bonds]);

  const selPos = selectedKey ? parseAtomKey(selectedKey).pos : -1;
  const validSel = selPos >= 0 && selPos < crystal.positions.length;

  const analysis = useMemo(
    () => (validSel ? analyzeSite(crystal, ox, bonds, selPos, { kind: radiusKind, hostSite, hostSpin }) : null),
    [validSel, crystal, ox, bonds, selPos, radiusKind, hostSite, hostSpin],
  );

  const scene = useMemo(() => buildScene(crystal, bonds, view, validSel ? selectedKey : null), [crystal, bonds, view, selectedKey, validSel]);

  // ---------- file handling ----------
  const openText = useCallback((text: string, name: string) => {
    try {
      const l = loadText(text, name);
      setLoaded(l);
      setError(null);
      setSampleId("");
    } catch (e) {
      setError(`${name} を読み込めませんでした: ${(e as Error).message}`);
    }
  }, []);

  const openFile = useCallback(
    (f: File) => {
      f.text().then((t) => openText(t, f.name));
    },
    [openText],
  );

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) openFile(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [openFile]);

  const chooseSample = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id);
    if (!s) return;
    setSampleId(id);
    setLoaded(loadText(s.text, `${s.id}.cif`, 0, s.site));
    setError(null);
  };

  const chooseBlock = (idx: number) => {
    try {
      const crystal2 = crystalFromCif(loaded.blocks[idx]);
      setLoaded({ ...loaded, id: `${loaded.fileName}#${idx}#${++loadCounter}`, blockIdx: idx, crystal: crystal2, preferSite: undefined });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // ---------- cutoff editing from the site panel ----------
  const setSiteCutoff = useCallback(
    (cut: number) => {
      if (!analysis) return;
      const c = Math.round(cut * 1000) / 1000;
      setBondSettings((bs) => {
        if (cutScope === "site") return { ...bs, siteOverride: { ...bs.siteOverride, [analysis.group]: c } };
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
        return { ...bs, pairs, siteOverride: so };
      });
    },
    [analysis, cutScope, crystal, bonds],
  );

  const clearSiteOverride = useCallback(() => {
    if (!analysis) return;
    setBondSettings((bs) => {
      const so = { ...bs.siteOverride };
      delete so[analysis.group];
      return { ...bs, siteOverride: so };
    });
  }, [analysis]);

  const describe = useCallback(
    (key: string) => {
      const { pos, t } = parseAtomKey(key);
      const p = crystal.positions[pos];
      if (!p) return "";
      const ions = p.occupants.map((o) => ionLabel(crystal.sites[o.site].element, ox[crystal.sites[o.site].label])).join(" / ");
      const f = p.frac.map((v, i) => (v + t[i]).toFixed(3)).join(", ");
      return `${p.group}  ${ions}  (${f})  CN ${bonds.bonded[pos].length}`;
    },
    [crystal, ox, bonds],
  );

  const onPick = useCallback(
    (key: string) => {
      const prev = selectedKey ? parseAtomKey(selectedKey).pos : -1;
      if (prev < 0 || crystal.positions[prev]?.group !== crystal.positions[parseAtomKey(key).pos]?.group) {
        setHostSite(undefined);
        setHostSpin("");
      }
      setSelectedKey(key);
    },
    [selectedKey, crystal],
  );

  const selectGroup = (groupKey: string) => {
    const g = crystal.groups.find((x) => x.key === groupKey);
    if (!g) return;
    setHostSite(undefined);
    setHostSpin("");
    setSelectedKey(atomKey(g.positions[0], [0, 0, 0]));
  };

  const { formula } = formulaString(crystal);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 2v20M3 7l18 10M21 7 3 17" stroke="currentColor" strokeWidth="1" opacity=".45" />
              <circle cx="12" cy="12" r="2.6" fill="currentColor" />
            </svg>
          </span>
          <div>
            <h1>Crystal Site Matcher</h1>
            <p className="brand-sub">配位多面体とシャノン半径で置換イオンを見積もる</p>
          </div>
        </div>
        <div className="file-controls">
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} id="open-cif">
            CIF を開く
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".cif,.mcif,.txt,chemical/x-cif"
            hidden
            id="cif-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
              e.target.value = "";
            }}
          />
          <label className="field-inline" htmlFor="sample-select">
            <span>サンプル</span>
            <select id="sample-select" value={sampleId} onChange={(e) => chooseSample(e.target.value)}>
              {sampleId === "" && <option value="">（読み込んだファイル）</option>}
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button className="btn btn-ghost" onClick={() => setError(null)}>
            閉じる
          </button>
        </div>
      )}

      <main className="layout">
        <section className="stage" aria-label="結晶構造の3D表示">
          <div className="stage-head">
            <div className="stage-title">
              <strong>{crystal.title}</strong>
              <span className="mono">{formula}</span>
              <span className="tag">{crystal.spaceGroup.symbol}</span>
              <span className="muted small">{loaded.fileName}</span>
            </div>
          </div>
          <div className="stage-body">
            <Viewer spec={scene} structureId={`${loaded.id}|${view.supercell.join("x")}`} viewCmd={viewCmd} onPick={onPick} describe={describe} />
            <ViewControls
              view={view}
              setView={setView}
              onViewDir={(dir) => setViewCmd((c) => ({ dir, n: (c?.n ?? 0) + 1 }))}
              crystal={crystal}
              ox={ox}
            />
            <p className="stage-hint">ドラッグで回転・右ドラッグで移動・ホイールで拡大。原子をクリックするとそのサイトを解析します。</p>
          </div>
        </section>

        <aside className="panel">
          <nav className="tabs" role="tablist">
            {(
              [
                ["site", "サイト解析"],
                ["subst", "置換候補"],
                ["struct", "構造と結合"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "is-active" : ""}`} onClick={() => setTab(k)} id={`tab-${k}`}>
                {label}
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
                hostSite={hostSite}
                setHostSite={setHostSite}
                hostSpin={hostSpin}
                setHostSpin={setHostSpin}
                radiusKind={radiusKind}
                setRadiusKind={setRadiusKind}
                cutScope={cutScope}
                setCutScope={setCutScope}
                onCutoff={setSiteCutoff}
                onClearOverride={clearSiteOverride}
                onSelectGroup={selectGroup}
                rmax={rmax}
                goSubst={() => setTab("subst")}
              />
            )}
            {tab === "subst" && <SubstitutionPanel analysis={analysis} crystal={crystal} onSelectGroup={selectGroup} />}
            {tab === "struct" && (
              <StructurePanel
                crystal={crystal}
                loaded={{ fileName: loaded.fileName, blocks: loaded.blocks.map((b) => b.name), blockIdx: loaded.blockIdx }}
                onBlock={chooseBlock}
                ox={ox}
                setOx={setOx}
                oxGuessed={initialOx.guessed}
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

      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <div>CIF ファイルをドロップして読み込む</div>
        </div>
      )}
    </div>
  );
}
