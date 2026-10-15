import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import StructureView, { Tab } from "./components/StructureView";
import CompareView from "./components/CompareView";
import { renderThumbnail } from "./components/Viewer";
import { Doc, blocksWithAtoms, createDoc, deriveBonds, featureSig } from "./lib/doc";
import { buildScene } from "./lib/scene";
import { useFeatures } from "./lib/useFeatures";
import { SAMPLES, STARTUP_SAMPLES } from "./samples";
import ThemeToggle from "./components/ThemeToggle";
import { useThemePref } from "./lib/theme";
import LangToggle from "./components/LangToggle";
import { tError, useT, type MsgKey, type Params } from "./i18n";
import { MsgError } from "./lib/messages";

interface BannerItem {
  key: MsgKey;
  params: Params;
  error?: unknown;
}

const MAX_BLOCKS_PER_FILE = 24;

function nextSlot(docs: Doc[]): number {
  const used = new Set(docs.map((d) => d.colorSlot));
  for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
  return 8; // beyond the categorical palette: neutral colour, identified by label
}

function sampleDoc(id: string, docs: Doc[]): Doc | null {
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) return null;
  return createDoc(blocksWithAtoms(s.text), `${s.id}.cif`, 0, nextSlot(docs), s.site);
}

export default function App() {
  const [docs, setDocs] = useState<Doc[]>(() => {
    const out: Doc[] = [];
    for (const id of STARTUP_SAMPLES) {
      const d = sampleDoc(id, out);
      if (d) out.push(d);
    }
    return out;
  });
  const [activeId, setActiveId] = useState<string | null>(() => docs[0]?.id ?? null);
  const [mode, setMode] = useState<"structure" | "compare">("structure");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // Always start on the lightweight structure tab; heavy feature calculations only run
  // once the user opens the Features tab (or the comparison view). See #4.
  const [tab, setTab] = useState<Tab>("struct");
  const [themePref, setThemePref] = useThemePref();
  const t = useT();
  const [banner, setBanner] = useState<BannerItem[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);


  const active = docs.find((d) => d.id === activeId) ?? docs[0] ?? null;

  const updateDoc = useCallback((id: string, f: (d: Doc) => Partial<Doc>) => {
    setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...f(d) } : d)));
  }, []);
  const updateActive = useCallback((f: (d: Doc) => Partial<Doc>) => active && updateDoc(active.id, f), [active, updateDoc]);

  // ---------- features ----------
  const compareDocs = docs.filter((d) => !excluded.has(d.id));
  const wantedIds = useMemo(() => {
    if (mode === "compare") return compareDocs.map((d) => d.id);
    if (active && (tab === "feat" || active.view.showHops || active.view.showIso || active.hopSel)) return [active.id];
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tab, active?.id, active?.view.showHops, active?.view.showIso, active?.hopSel, compareDocs.map((d) => d.id).join(",")]);
  const { entries, errors } = useFeatures(docs, wantedIds);
  const freshEntry = (d: Doc) => (entries[d.id] && entries[d.id].sig === featureSig(d) ? entries[d.id] : undefined);

  // ---------- thumbnails (one per tick) ----------
  useEffect(() => {
    const d = docs.find((x) => x.thumb === null);
    if (!d) return;
    const t = setTimeout(() => {
      const { bonds } = deriveBonds(d.crystal, d.ox, d.bondSettings);
      const spec = buildScene(d.crystal, bonds, { ...d.view, showLabels: false, supercell: [1, 1, 1], showHops: false, showIso: false, atomScale: 0.3 }, null);
      updateDoc(d.id, () => ({ thumb: renderThumbnail(spec) ?? "" }));
    }, 30);
    return () => clearTimeout(t);
  }, [docs, updateDoc]);

  // ---------- opening files ----------
  const addDocs = useCallback((made: Doc[], activate = true) => {
    if (!made.length) return;
    setDocs((ds) => [...ds, ...made]);
    if (activate) {
      setActiveId(made[made.length - 1].id);
      setMode((m) => (made.length > 1 && m === "compare" ? m : "structure"));
    }
  }, []);

  const openFiles = useCallback(
    async (files: FileList | File[]) => {
      const errs: BannerItem[] = [];
      const made: Doc[] = [];
      let current = docs;
      for (const f of Array.from(files)) {
        try {
          const text = await f.text();
          const blocks = blocksWithAtoms(text);
          if (!blocks.length) throw new MsgError("err.noAtomBlock");
          const n = Math.min(blocks.length, MAX_BLOCKS_PER_FILE);
          for (let i = 0; i < n; i++) {
            try {
              const d = createDoc(blocks, f.name, i, nextSlot(current));
              made.push(d);
              current = [...current, d];
            } catch (e) {
              errs.push({ key: "err.fileBlock", params: { file: f.name, block: blocks[i].name }, error: e });
            }
          }
          if (blocks.length > MAX_BLOCKS_PER_FILE) errs.push({ key: "err.tooManyBlocks", params: { file: f.name, n: blocks.length, max: MAX_BLOCKS_PER_FILE } });
        } catch (e) {
          errs.push({ key: "err.readFile", params: { file: f.name }, error: e });
        }
      }
      addDocs(made);
      setBanner(errs.length ? errs : null);
    },
    [docs, addDocs],
  );

  const addSample = (id: string) => {
    if (id === "__all") {
      const made: Doc[] = [];
      let current = docs;
      for (const s of SAMPLES) {
        if (docs.some((d) => d.fileName === `${s.id}.cif`)) continue;
        const d = sampleDoc(s.id, current);
        if (d) {
          made.push(d);
          current = [...current, d];
        }
      }
      addDocs(made, mode !== "compare");
      return;
    }
    const d = sampleDoc(id, docs);
    if (d) addDocs([d]);
  };

  const closeDoc = (id: string) => {
    setDocs((ds) => {
      const i = ds.findIndex((d) => d.id === id);
      const next = ds.filter((d) => d.id !== id);
      if (id === activeId) setActiveId(next[Math.min(i, next.length - 1)]?.id ?? null);
      return next;
    });
  };

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
      if (e.dataTransfer?.files?.length) openFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [openFiles]);

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
            <p className="brand-sub">{t("app.tagline")}</p>
          </div>
        </div>
        <div className="file-controls">
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} id="open-cif">
            {t("app.open")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".cif,.mcif,.txt,chemical/x-cif"
            multiple
            hidden
            id="cif-input"
            onChange={(e) => {
              if (e.target.files?.length) openFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="muted small hide-narrow">{t("app.openHint")}</span>
          <LangToggle />
          <ThemeToggle value={themePref} onChange={setThemePref} />
        </div>
      </header>

      {banner && (
        <div className="banner banner-error" role="alert">
          <span>{banner.map((b) => t(b.key, { ...b.params, error: b.error !== undefined ? tError(t, b.error) : "" })).join(" / ")}</span>
          <button className="btn btn-ghost" onClick={() => setBanner(null)}>
            {t("common.close")}
          </button>
        </div>
      )}

      <div className="workspace">
        <Sidebar
          docs={docs}
          activeId={active?.id ?? null}
          mode={mode}
          excluded={excluded}
          onSelect={(id) => {
            setActiveId(id);
            setMode("structure");
          }}
          onClose={closeDoc}
          onToggleCompare={(id) =>
            setExcluded((s) => {
              const n = new Set(s);
              if (n.has(id)) n.delete(id);
              else n.add(id);
              return n;
            })
          }
          onMode={setMode}
          onOpen={() => fileRef.current?.click()}
          onAddSample={addSample}
        />
        {mode === "compare" ? (
          <CompareView
            docs={compareDocs}
            allCount={docs.length}
            entries={Object.fromEntries(docs.map((d) => [d.id, freshEntry(d)]))}
            errors={errors}
            onOpenDoc={(id) => {
              setActiveId(id);
              setMode("structure");
              setTab("feat");
            }}
          />
        ) : active ? (
          <StructureView
            key={active.id}
            doc={active}
            update={updateActive}
            onReplace={(nd) => setDocs((ds) => ds.map((d) => (d.id === nd.id ? nd : d)))}
            tab={tab}
            setTab={setTab}
            entry={freshEntry(active)}
            featError={errors[active.id]}
          />
        ) : (
          <main className="empty">
            <h2>{t("app.emptyTitle")}</h2>
            <p className="muted">{t("app.emptyBody")}</p>
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
              {t("app.open")}
            </button>
          </main>
        )}
      </div>

      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <div>{t("app.drop")}</div>
        </div>
      )}
    </div>
  );
}
