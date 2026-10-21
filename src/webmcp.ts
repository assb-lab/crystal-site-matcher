// WebMCP tools (#70): lets an AI agent in the browser open structures and read the same numbers as the UI,
// through structured calls instead of clicks. Registered only where the browser implements
// `document.modelContext` (or the earlier preview's `navigator.modelContext`); elsewhere nothing happens.
// Calculations reuse src/lib, so the values match the app and the CLI. Labels and messages are in English,
// as in the CLI output. Tools are exposed to same-origin documents only and make no network requests.
import { Doc, deriveBonds, featureSig } from "./lib/doc";
import { FEATURE_BY_KEY, FEATURE_DEFS, FeatureValue, hopClasses } from "./lib/features";
import { gridStage, hasMobile, staticStage } from "./lib/pipeline";
import { allCandidates, analyzeSite, evaluateCandidate } from "./lib/analysis";
import { SAMPLES } from "./samples";
import { translate, tError, tMsg, type MsgKey, type TFn } from "./i18n/translate";
import { featLabel, fmtFeature } from "./i18n/domain";
import type { Tab } from "./components/StructureView";

const tEn: TFn = (k, p) => translate("en", k, p);

export const VIEWS = ["struct", "site", "subst", "feat", "pattern", "compare"] as const;
export type View = Tab | "compare";

/** What the tools may read and change in the app. Reads must reflect calls made just before (see App). */
export interface AppBridge {
  docs(): Doc[];
  activeId(): string | null;
  view(): View;
  openSample(id: string): Doc;
  openCif(text: string, fileName: string): { opened: Doc[]; errors: string[] };
  select(id: string, view?: View): void;
  update(id: string, patch: Partial<Doc>): void;
  close(id: string): void;
}

type Json = Record<string, unknown>;

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Json;
  annotations?: { readOnlyHint?: boolean };
  execute(input: Json): Promise<unknown>;
}

/** MCP-style result: the JSON text of the value; failures come back as text with isError. */
const ok = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 1) }] });
const fail = (message: string) => ({ content: [{ type: "text", text: message }], isError: true });

class ToolError extends Error {}

const round = (x: number, digits = 6) => (Number.isFinite(x) ? Number(x.toPrecision(digits + 2)) : null);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function summary(d: Doc, active: string | null) {
  const cr = d.crystal;
  return {
    id: d.id,
    name: d.name,
    file: d.fileName,
    formula: d.formula,
    spaceGroup: cr.spaceGroup.number ? `${cr.spaceGroup.symbol} (${cr.spaceGroup.number})` : cr.spaceGroup.symbol,
    mobileIon: d.mobile,
    active: d.id === active,
  };
}

/** Feature values by key: numbers as they are, codes in English (as in the CLI), missing values null. */
function featureValue(key: string, v: FeatureValue | undefined): number | string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return fmtFeature(tEn, FEATURE_BY_KEY[key], v);
}

/** One computation per feature signature (and grid flag), shared by repeated calls. */
const featureCache = new Map<string, Promise<Record<string, FeatureValue>>>();
function computeFeatures(d: Doc, grid: boolean): Promise<Record<string, FeatureValue>> {
  const key = `${featureSig(d)}|${grid}`;
  let p = featureCache.get(key);
  if (!p) {
    p = (async () => {
      const st = staticStage(d, d.hopCutoff);
      const values: Record<string, FeatureValue> = { ...st.values };
      if (grid && hasMobile(d)) {
        const g = await gridStage(d, d.gridRes, undefined, undefined, st.hops);
        if (g) Object.assign(values, g.values);
      }
      return values;
    })();
    p.catch(() => featureCache.delete(key));
    if (featureCache.size > 32) featureCache.delete(featureCache.keys().next().value!);
    featureCache.set(key, p);
  }
  return p;
}

/** Site group whose labels include `label` (a mixed site "S3/Cl1" matches either), or the label of a group. */
function findGroup(d: Doc, label: string) {
  const cr = d.crystal;
  const g = cr.groups.find((x) => x.key === label) ?? cr.groups.find((x) => x.key.split("/").includes(label));
  if (!g) throw new ToolError(`No site "${label}". Sites: ${cr.groups.map((x) => x.key).join(", ")}`);
  const site = cr.sites.find((s) => s.label === label);
  return { g, hostSite: site && g.sites.includes(site.index) ? site.index : undefined };
}

const idProp = { type: "string", description: "Structure id from list_structures; the displayed structure when omitted" };
const siteProp = { type: "string", description: "Site label from get_structure (e.g. Li1, Ge1; a mixed site matches any of its labels)" };

export function buildTools(app: AppBridge): WebMcpTool[] {
  const docOf = (input: Json): Doc => {
    const docs = app.docs();
    const id = str(input.id) ?? app.activeId();
    const d = docs.find((x) => x.id === id);
    if (!d) throw new ToolError(id ? `No open structure "${id}". Open ones: ${docs.map((x) => x.id).join(", ") || "none"}` : "No structure is open");
    return d;
  };
  const tools: WebMcpTool[] = [
    {
      name: "list_structures",
      description: "List the crystal structures open in Crystal Site Matcher, with id, name, formula, space group, mobile ion and which one is displayed.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async execute() {
        const active = app.activeId();
        return { view: app.view(), structures: app.docs().map((d) => summary(d, active)) };
      },
    },
    {
      name: "list_samples",
      description: "List the bundled sample structures (literature coordinates) that open_sample can open.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async execute() {
        return SAMPLES.map((s) => ({ sample: s.id, name: tEn(`sample.${s.id}` as MsgKey) }));
      },
    },
    {
      name: "open_sample",
      description: "Open a bundled sample structure and display it. Returns its id.",
      inputSchema: { type: "object", properties: { sample: { type: "string", enum: SAMPLES.map((s) => s.id), description: "Sample id from list_samples" } }, required: ["sample"] },
      async execute(input) {
        const d = app.openSample(str(input.sample) ?? "");
        return summary(d, d.id);
      },
    },
    {
      name: "open_cif",
      description: "Open a crystal structure from the text of a CIF file (each data block with atomic coordinates becomes one structure) and display the last one. Returns the ids and any per-block errors.",
      inputSchema: {
        type: "object",
        properties: { cif: { type: "string", description: "Full text of the CIF file" }, fileName: { type: "string", description: "File name shown in the app (default: structure.cif)" } },
        required: ["cif"],
      },
      async execute(input) {
        const r = app.openCif(str(input.cif) ?? "", str(input.fileName) || "structure.cif");
        if (!r.opened.length) throw new ToolError(r.errors.join("\n") || "No structure in the CIF text");
        const active = r.opened[r.opened.length - 1].id;
        return { opened: r.opened.map((d) => summary(d, active)), errors: r.errors };
      },
    },
    {
      name: "select_structure",
      description:
        "Display an open structure, optionally on a tab: struct (structure and bonds), site (site analysis), subst (substitution candidates), feat (features; starts the BVSE calculation), pattern (XRD and g(r)), or compare (feature comparison of all open structures).",
      inputSchema: { type: "object", properties: { id: idProp, view: { type: "string", enum: [...VIEWS] } } },
      async execute(input) {
        const d = docOf(input);
        const view = str(input.view) as View | undefined;
        if (view !== undefined && !VIEWS.includes(view)) throw new ToolError(`Unknown view "${view}"`);
        app.select(d.id, view);
        return { selected: d.id, view: app.view() };
      },
    },
    {
      name: "get_structure",
      description: "Lattice, space group, sites (element, oxidation state, occupancy, fractional coordinates, multiplicity) and calculation settings of an open structure.",
      inputSchema: { type: "object", properties: { id: idProp } },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const d = docOf(input);
        const cr = d.crystal;
        const L = cr.lattice;
        return {
          ...summary(d, app.activeId()),
          lattice: { a: L.a, b: L.b, c: L.c, alpha: L.alpha, beta: L.beta, gamma: L.gamma, volume: L.volume },
          symmetryOperations: cr.nOps,
          oxidationStatesGuessed: d.oxGuessed,
          sites: cr.sites.map((s) => ({ label: s.label, element: s.element, oxidationState: d.ox[s.label] ?? null, occupancy: s.occ, frac: s.frac, multiplicity: s.multiplicity })),
          mixedSites: cr.groups.filter((g) => g.sites.length > 1).map((g) => g.key),
          settings: { mobileIon: d.mobile, hopCutoff: d.hopCutoff, gridResolution: d.gridRes },
          warnings: cr.warnings.map((w) => tMsg(tEn, w)),
        };
      },
    },
    {
      name: "get_features",
      description:
        "Structure features as in the Features tab and the CLI: lattice, packing, bond valence, mobile-ion sublattice, hop network, framework and anion descriptors, and (with grid, default true) the BVSE / void-grid features such as percolation barriers E_1D/E_2D/E_3D, stable sites, hop barriers and the dilute-limit diffusion tensor. The grid can take several seconds. Filter with keys to keep the answer short.",
      inputSchema: {
        type: "object",
        properties: {
          id: idProp,
          grid: { type: "boolean", description: "Include the BVSE / void-grid features (default true)" },
          keys: { type: "array", items: { type: "string" }, description: "Feature keys to return (e.g. E_1D, rb_min, bvs_mobile); all when omitted" },
        },
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const d = docOf(input);
        const keys = Array.isArray(input.keys) ? input.keys.filter((k): k is string => typeof k === "string") : null;
        const unknown = keys?.filter((k) => !FEATURE_BY_KEY[k]) ?? [];
        if (unknown.length) throw new ToolError(`Unknown feature keys: ${unknown.join(", ")}`);
        const values = await computeFeatures(d, input.grid !== false);
        const defs = keys ? keys.map((k) => FEATURE_BY_KEY[k]) : FEATURE_DEFS;
        return {
          id: d.id,
          formula: d.formula,
          mobileIon: d.mobile,
          features: defs.map((f) => ({ key: f.key, label: featLabel(tEn, f.key), value: featureValue(f.key, values[f.key]), unit: f.unit || undefined, group: f.group })),
        };
      },
    },
    {
      name: "get_hops",
      description:
        "Mobile-ion hops within the hop cutoff, grouped by site pair, distance and bottleneck radius (the free radius of the widest path with one bend; Å).",
      inputSchema: { type: "object", properties: { id: idProp } },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const d = docOf(input);
        if (!d.mobile) return { id: d.id, mobileIon: null, hops: [] };
        const st = staticStage(d, d.hopCutoff);
        return {
          id: d.id,
          mobileIon: d.mobile,
          hopCutoff: d.hopCutoff,
          hops: hopClasses(d.crystal, st.hops).map((c) => ({ from: c.from, to: c.to, distance: round(c.d), bottleneckRadius: round(c.rb), count: c.members.length })),
        };
      },
    },
    {
      name: "analyze_site",
      description: "Coordination analysis of one site, as in the Site analysis tab: coordination number, bond lengths, bond valence sum, polyhedron shape (CShM), volume and distortion.",
      inputSchema: { type: "object", properties: { id: idProp, site: siteProp }, required: ["site"] },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const d = docOf(input);
        const { g, hostSite } = findGroup(d, str(input.site) ?? "");
        const { bonds } = deriveBonds(d.crystal, d.ox, d.bondSettings);
        const a = analyzeSite(d.crystal, d.ox, bonds, g.positions[0], { kind: d.radiusKind, hostSite });
        return {
          id: d.id,
          site: g.key,
          host: { label: a.host.label, element: a.host.el, oxidationState: a.host.ox },
          coordinationNumber: a.cn,
          effectiveCoordinationNumber: round(a.econ),
          ligands: a.ligands.map((l) => ({ site: l.label, species: l.species.map((x) => x.el).join("/"), distance: round(l.nb.d) })),
          meanBondLength: round(a.dMean),
          bondValenceSum: a.bvsHost === null ? null : round(a.bvsHost),
          shapes: a.shapes.slice(0, 3).map((s) => ({ shape: s.name, cshm: round(s.cshm, 3) })),
          polyhedronVolume: a.volume === null ? null : round(a.volume),
          distortionIndex: round(a.distortion),
          centroidOffset: a.centroidOffset === null ? null : round(a.centroidOffset),
          hostRadius: a.rHost ? round(a.rHost.r) : null,
          cavityRadius: a.rSite === null ? null : round(a.rSite),
        };
      },
    },
    {
      name: "rank_substituents",
      description:
        "Rank substituent ions for one site by the score of the Substitution tab (size match to the site, bond valence sum and charge difference; 0–100, verdict good / possible / hard / unlikely).",
      inputSchema: {
        type: "object",
        properties: {
          id: idProp,
          site: siteProp,
          charge: { type: "string", enum: ["same", "pm1", "all"], description: "Charge filter relative to the host: same, within ±1 (default) or all" },
          limit: { type: "integer", minimum: 1, maximum: 200, description: "Number of candidates (default 20)" },
        },
        required: ["site"],
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const d = docOf(input);
        const { g, hostSite } = findGroup(d, str(input.site) ?? "");
        const { bonds } = deriveBonds(d.crystal, d.ox, d.bondSettings);
        const a = analyzeSite(d.crystal, d.ox, bonds, g.positions[0], { kind: d.radiusKind, hostSite });
        const charge = str(input.charge) ?? "pm1";
        const limit = Math.min(200, Math.max(1, Math.round(num(input.limit) ?? 20)));
        const ranked = allCandidates(a.host.ox)
          .map((c) => evaluateCandidate(a, c, { sizeTol: 0.15, useBVS: true, useCharge: true }))
          .filter((r) => r !== null)
          .filter((r) => charge === "all" || (charge === "same" ? r.dq === 0 : Math.abs(r.dq) <= 1))
          .sort((x, y) => y.score - x.score)
          .slice(0, limit);
        return {
          id: d.id,
          site: g.key,
          host: { element: a.host.el, oxidationState: a.host.ox, coordinationNumber: a.cn },
          candidates: ranked.map((r) => ({
            ion: `${r.el}${Math.abs(r.ox) === 1 ? "" : Math.abs(r.ox)}${r.ox > 0 ? "+" : "-"}${r.spin ? ` ${r.spin}` : ""}`,
            score: round(r.score, 3),
            verdict: r.verdict,
            radius: round(r.radius.r, 3),
            sizeMismatch: r.dSite === null ? null : round(r.dSite, 3),
            bondValenceRatio: r.bvsRatio === null ? null : round(r.bvsRatio, 3),
            chargeDifference: r.dq,
          })),
        };
      },
    },
    {
      name: "set_calculation",
      description: "Change the calculation settings of an open structure: mobile ion (element symbol, or null for none), hop cutoff (Å) and BVSE grid resolution (Å). Features are recomputed with the new settings.",
      inputSchema: {
        type: "object",
        properties: {
          id: idProp,
          mobileIon: { type: ["string", "null"], description: "Element symbol present in the structure, or null" },
          hopCutoff: { type: "number", minimum: 1.5, maximum: 6 },
          gridResolution: { type: "number", enum: [0.3, 0.25, 0.2, 0.15] },
        },
      },
      async execute(input) {
        const d = docOf(input);
        const patch: Partial<Doc> = {};
        if ("mobileIon" in input) {
          const el = input.mobileIon;
          if (el !== null && !(typeof el === "string" && d.crystal.sites.some((s) => s.element === el)))
            throw new ToolError(`Mobile ion must be null or an element of the structure: ${[...new Set(d.crystal.sites.map((s) => s.element))].join(", ")}`);
          patch.mobile = el;
        }
        const cut = num(input.hopCutoff);
        if (input.hopCutoff !== undefined) {
          if (cut === undefined || cut < 1.5 || cut > 6) throw new ToolError("hopCutoff must be between 1.5 and 6 Å");
          patch.hopCutoff = cut;
        }
        const res = num(input.gridResolution);
        if (input.gridResolution !== undefined) {
          if (res === undefined || ![0.3, 0.25, 0.2, 0.15].includes(res)) throw new ToolError("gridResolution must be 0.3, 0.25, 0.2 or 0.15 Å");
          patch.gridRes = res;
        }
        app.update(d.id, patch);
        const nd = app.docs().find((x) => x.id === d.id)!;
        return { id: d.id, settings: { mobileIon: nd.mobile, hopCutoff: nd.hopCutoff, gridResolution: nd.gridRes } };
      },
    },
    {
      name: "close_structure",
      description: "Close an open structure (its view settings are discarded).",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "Structure id from list_structures" } }, required: ["id"] },
      async execute(input) {
        const d = docOf({ id: str(input.id) ?? "" });
        app.close(d.id);
        return { closed: d.id, open: app.docs().map((x) => x.id) };
      },
    },
  ];
  // errors become a readable result instead of an opaque UnknownError at the agent
  return tools.map((tool) => ({
    ...tool,
    async execute(input: Json) {
      try {
        return ok(await tool.execute(input && typeof input === "object" ? input : {}));
      } catch (e) {
        return fail(e instanceof ToolError ? e.message : `Error: ${tError(tEn, e)}`);
      }
    },
  }));
}

interface ModelContextLike {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): void;
}

/** The browser's WebMCP entry point: document.modelContext (current draft) or navigator.modelContext (early preview). */
export function modelContext(): ModelContextLike | null {
  const c = (document as unknown as { modelContext?: ModelContextLike }).modelContext ?? (navigator as unknown as { modelContext?: ModelContextLike }).modelContext;
  return c && typeof c.registerTool === "function" ? c : null;
}

/** Register the tools; returns a function that unregisters them. A no-op without WebMCP. */
export function registerWebMcp(app: AppBridge, ctx: ModelContextLike | null = modelContext()): () => void {
  if (!ctx) return () => {};
  const controller = new AbortController();
  const handles: unknown[] = [];
  for (const tool of buildTools(app)) {
    try {
      const r = ctx.registerTool(tool, { signal: controller.signal });
      // the draft returns a promise that rejects with the abort reason on unregistration
      if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {});
      handles.push(r);
    } catch {
      // a tool that cannot be registered (e.g. duplicate name after a hot reload) is skipped
    }
  }
  return () => {
    controller.abort();
    for (const h of handles) if (h && typeof (h as { unregister?: () => void }).unregister === "function") (h as { unregister: () => void }).unregister();
    // the early preview has no signal option
    if (ctx.unregisterTool) for (const t of buildTools(app)) try { ctx.unregisterTool(t.name); } catch { /* already gone */ }
  };
}
