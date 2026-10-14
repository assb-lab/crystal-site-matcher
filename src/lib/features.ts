// Structure descriptors computed from a CIF, aimed at ion-conductor screening.
// Everything here is geometric / empirical; see FEATURE_DEFS for definitions.

import { BondTable } from "./bonding";
import { ELEMENTS, IDEAL_POLYHEDRA, IdealPolyhedron } from "./data";
import { analyzeSite, shannonRadius, SiteAnalysis } from "./analysis";
import { cshm } from "./shape";
import { FrameworkField } from "./bvse";
import { PeriodicUnionFind } from "./percolation";
import { Crystal, Neighbor, Vec3, add, buildNeighborTable, formulaString, toCart } from "./structure";

export type FeatureValue = number | string | null;

export interface FeatureDef {
  key: string;
  label: string;
  group: FeatureGroup;
  unit?: string;
  digits?: number;
  desc: string;
  text?: boolean;
  async?: boolean; // filled by the grid (BVSE / void) calculation
}

export type FeatureGroup = "lattice" | "packing" | "bv" | "mobile" | "network" | "frame" | "grid";

export const GROUP_LABEL: Record<FeatureGroup, string> = {
  lattice: "格子と対称性",
  packing: "充填とアニオン骨格",
  bv: "結合原子価",
  mobile: "可動イオンの副格子",
  network: "ホップ経路とボトルネック",
  frame: "多面体の連結",
  grid: "BVSE と空隙（グリッド計算）",
};

export const FEATURE_DEFS: FeatureDef[] = [
  // lattice
  { key: "a", label: "a", unit: "Å", digits: 4, group: "lattice", desc: "格子定数 a" },
  { key: "b", label: "b", unit: "Å", digits: 4, group: "lattice", desc: "格子定数 b" },
  { key: "c", label: "c", unit: "Å", digits: 4, group: "lattice", desc: "格子定数 c" },
  { key: "alpha", label: "α", unit: "°", digits: 3, group: "lattice", desc: "格子角 α" },
  { key: "beta", label: "β", unit: "°", digits: 3, group: "lattice", desc: "格子角 β" },
  { key: "gamma", label: "γ", unit: "°", digits: 3, group: "lattice", desc: "格子角 γ" },
  { key: "c_a", label: "c/a", digits: 4, group: "lattice", desc: "軸比 c/a。同じ構造型の系列で異方性の変化を追う" },
  { key: "b_a", label: "b/a", digits: 4, group: "lattice", desc: "軸比 b/a" },
  { key: "V", label: "体積 V", unit: "Å³", digits: 2, group: "lattice", desc: "単位胞体積" },
  { key: "Z", label: "Z", digits: 0, group: "lattice", desc: "単位胞あたりの化学式単位数" },
  { key: "V_Z", label: "V/Z", unit: "Å³", digits: 2, group: "lattice", desc: "化学式単位あたりの体積" },
  { key: "N", label: "原子数 N", digits: 2, group: "lattice", desc: "単位胞内の原子数（占有率で重み付け）" },
  { key: "V_atom", label: "V/N", unit: "Å³", digits: 2, group: "lattice", desc: "原子あたりの体積。構造の疎密" },
  { key: "density", label: "密度", unit: "g/cm³", digits: 3, group: "lattice", desc: "組成と体積から計算した結晶密度" },
  { key: "sg", label: "空間群", group: "lattice", text: true, desc: "空間群記号と番号" },
  { key: "system", label: "晶系", group: "lattice", text: true, desc: "空間群番号から求めた晶系" },
  { key: "nSites", label: "独立サイト数", digits: 0, group: "lattice", desc: "CIF の独立な原子サイト（ラベル）の数" },
  { key: "IG", label: "情報量 I_G", unit: "bit/atom", digits: 3, group: "lattice", desc: "Krivovichev の構造情報量 −Σ p_i log₂ p_i（p_i = 軌道の多重度 / N）。構造の複雑さ" },
  { key: "IG_total", label: "情報量 I_G,total", unit: "bit/cell", digits: 2, group: "lattice", desc: "N · I_G" },
  // packing
  { key: "packing", label: "充填率", digits: 3, group: "packing", desc: "シャノン半径（各イオンの配位数での値）の球の体積和 / V" },
  { key: "anionEls", label: "陰イオン", group: "packing", text: true, desc: "酸化数が負の元素" },
  { key: "V_anion", label: "陰イオンあたりの体積", unit: "Å³", digits: 2, group: "packing", desc: "V / 陰イオン数。アニオン骨格の広がり" },
  { key: "dXX", label: "陰イオン間最近接距離", unit: "Å", digits: 3, group: "packing", desc: "各陰イオンから最も近い陰イオンまでの距離の平均" },
  { key: "anionFrame", label: "アニオン副格子の型", group: "packing", text: true, desc: "陰イオンの陰イオン配位を bcc（14配位）、fcc（立方八面体）、hcp（反立方八面体）と CShM で比べ、最も近い型" },
  { key: "cshm_bcc", label: "CShM(bcc)", digits: 2, group: "packing", desc: "陰イオン副格子と bcc 配置の形状差（小さいほど bcc 的。Li 伝導に有利とされる）" },
  { key: "cshm_fcc", label: "CShM(fcc)", digits: 2, group: "packing", desc: "陰イオン副格子と fcc 配置の形状差" },
  { key: "cshm_hcp", label: "CShM(hcp)", digits: 2, group: "packing", desc: "陰イオン副格子と hcp 配置の形状差" },
  { key: "dX_frame", label: "Δχ 骨格陽イオン–陰イオン", digits: 3, group: "packing", desc: "骨格陽イオンと配位陰イオンの電気陰性度差の平均（結合のイオン性の目安）" },
  // bond valence
  { key: "GII", label: "GII", unit: "v.u.", digits: 3, group: "bv", desc: "Global Instability Index √⟨(BVS − |q|)²⟩。0.2 を超えると構造にひずみ・不安定性" },
  { key: "bvs_mobile", label: "可動イオンの BVS", unit: "v.u.", digits: 3, group: "bv", desc: "可動イオンサイトの BVS 平均（Brese & O'Keeffe）" },
  { key: "bvs_mobile_dev", label: "可動イオンの BVS 不整合", digits: 3, group: "bv", desc: "⟨BVS / |q|⟩ − 1。負は結合不足（サイトが緩い）、正は過剰" },
  // mobile sublattice
  { key: "mobile", label: "可動イオン", group: "mobile", text: true, desc: "解析対象の可動イオン" },
  { key: "n_mobile", label: "可動イオン数 / 胞", digits: 3, group: "mobile", desc: "Σ 多重度 × 占有率" },
  { key: "rho_mobile", label: "可動イオン数密度", unit: "nm⁻³", digits: 2, group: "mobile", desc: "単位体積あたりの可動イオン数" },
  { key: "mobileSites", label: "独立な可動イオンサイト数", digits: 0, group: "mobile", desc: "可動イオンを含む独立サイト（ラベル）の数" },
  { key: "mobilePositions", label: "可動イオンサイト数 / 胞", digits: 0, group: "mobile", desc: "可動イオンが占めうる位置の数" },
  { key: "vacancy", label: "空孔率", digits: 3, group: "mobile", desc: "1 − 可動イオン数 / 可動イオンサイト数" },
  { key: "occEntropy", label: "占有エントロピー", unit: "k_B/サイト", digits: 3, group: "mobile", desc: "−⟨f ln f + (1−f) ln(1−f)⟩（理想混合近似の配置エントロピー）" },
  { key: "cn_mobile", label: "可動イオンの平均 CN", digits: 2, group: "mobile", desc: "可動イオンサイトの配位数の平均（占有率で重み付け）" },
  { key: "d_mobile", label: "可動イオン–陰イオン平均距離", unit: "Å", digits: 3, group: "mobile", desc: "可動イオンサイトの平均結合長" },
  { key: "vol_mobile", label: "可動イオン多面体の体積", unit: "Å³", digits: 2, group: "mobile", desc: "可動イオンの配位多面体体積の平均" },
  { key: "dist_mobile", label: "可動イオン多面体の歪み Δ", digits: 4, group: "mobile", desc: "可動イオンサイトの Baur 歪み指数の平均" },
  { key: "dMM", label: "可動イオン間最近接距離", unit: "Å", digits: 3, group: "mobile", desc: "可動イオンサイト間の最短距離" },
  { key: "dMF", label: "可動イオン–骨格陽イオン最近接", unit: "Å", digits: 3, group: "mobile", desc: "可動イオンと骨格陽イオンの最短距離（静電反発の目安）" },
  // network
  { key: "hopDegree", label: "ホップ次数", digits: 2, group: "network", desc: "各可動イオンサイトからホップ距離以内にある可動イオンサイトの数の平均" },
  { key: "hopDim", label: "ホップ網の次元", digits: 0, group: "network", desc: "ホップ距離以内のサイトをつないだネットワークが周期的につながる次元（0–3）" },
  { key: "rb_min", label: "最小ボトルネック半径", unit: "Å", digits: 3, group: "network", desc: "ホップ経路（直線）上の、骨格イオン表面までの最短距離の最小値" },
  { key: "rb_mean", label: "平均ボトルネック半径", unit: "Å", digits: 3, group: "network", desc: "ホップごとのボトルネック半径の平均" },
  { key: "rb_1D", label: "ホップ網の通過半径 1D", unit: "Å", digits: 3, group: "network", desc: "ボトルネック半径がこの値以上のホップだけで 1 次元につながる最大値" },
  { key: "rb_2D", label: "ホップ網の通過半径 2D", unit: "Å", digits: 3, group: "network", desc: "同 2 次元" },
  { key: "rb_3D", label: "ホップ網の通過半径 3D", unit: "Å", digits: 3, group: "network", desc: "同 3 次元" },
  // framework connectivity
  { key: "frame_corner", label: "骨格: 頂点共有の割合", digits: 3, group: "frame", desc: "骨格陽イオン多面体どうしの連結のうち頂点共有の割合（Jun et al. 2022 の指標）" },
  { key: "frame_edge", label: "骨格: 稜共有の割合", digits: 3, group: "frame", desc: "同 稜共有" },
  { key: "frame_face", label: "骨格: 面共有の割合", digits: 3, group: "frame", desc: "同 面共有" },
  { key: "frame_isolated", label: "骨格: 孤立多面体の割合", digits: 3, group: "frame", desc: "他の骨格多面体と陰イオンを共有しない多面体の割合（例: 孤立 PS₄）" },
  { key: "mm_face", label: "可動–可動: 面共有の割合", digits: 3, group: "frame", desc: "可動イオン多面体どうしの連結のうち面共有の割合（面共有はホップの窓になる）" },
  { key: "mf_face", label: "可動–骨格: 面共有の割合", digits: 3, group: "frame", desc: "可動イオン多面体と骨格多面体の連結のうち面共有の割合（陽イオン反発が強い）" },
  // grid
  { key: "E_1D", label: "BVSE 浸透障壁 1D", unit: "eV", digits: 3, group: "grid", async: true, desc: "BVSE 地形で低エネルギー領域が 1 次元につながる最小エネルギー（最小値基準）" },
  { key: "E_2D", label: "BVSE 浸透障壁 2D", unit: "eV", digits: 3, group: "grid", async: true, desc: "同 2 次元" },
  { key: "E_3D", label: "BVSE 浸透障壁 3D", unit: "eV", digits: 3, group: "grid", async: true, desc: "同 3 次元" },
  { key: "siteE_sd", label: "サイトエネルギーの分散 σ_E", unit: "eV", digits: 3, group: "grid", async: true, desc: "可動イオンサイトの BVSE の標準偏差（多重度で重み付け）" },
  { key: "siteE_range", label: "サイトエネルギーの幅", unit: "eV", digits: 3, group: "grid", async: true, desc: "可動イオンサイトの BVSE の最大 − 最小" },
  { key: "R_1D", label: "空隙の浸透半径 1D", unit: "Å", digits: 3, group: "grid", async: true, desc: "骨格イオン表面から離れた空間が 1 次元につながる最大のプローブ半径" },
  { key: "R_2D", label: "空隙の浸透半径 2D", unit: "Å", digits: 3, group: "grid", async: true, desc: "同 2 次元" },
  { key: "R_3D", label: "空隙の浸透半径 3D", unit: "Å", digits: 3, group: "grid", async: true, desc: "同 3 次元" },
  { key: "maxVoid", label: "最大空隙半径", unit: "Å", digits: 3, group: "grid", async: true, desc: "骨格イオン表面から最も離れた点までの距離（最大内接球半径）" },
];

export const FEATURE_BY_KEY = Object.fromEntries(FEATURE_DEFS.map((f) => [f.key, f])) as Record<string, FeatureDef>;

const MOBILE_PREF = ["Li", "Na", "K", "Ag", "Cu", "Mg", "Zn", "Ca", "Rb", "Cs", "H", "F", "O"];

export function defaultMobile(cr: Crystal, ox: Record<string, number>): string | null {
  const present = new Set(cr.sites.map((s) => s.element));
  for (const el of MOBILE_PREF) {
    if (!present.has(el)) continue;
    const s = cr.sites.find((x) => x.element === el)!;
    const q = ox[s.label] ?? 0;
    if ((el === "F" || el === "O") && q < 0) return el;
    if (q > 0) return el;
  }
  return null;
}

export function crystalSystem(n: number | null): string {
  if (!n) return "—";
  if (n <= 2) return "三斜晶";
  if (n <= 15) return "単斜晶";
  if (n <= 74) return "直方晶";
  if (n <= 142) return "正方晶";
  if (n <= 167) return "三方晶";
  if (n <= 194) return "六方晶";
  return "立方晶";
}

export interface Hop {
  a: number; // position index
  b: number;
  t: Vec3; // translation of b
  d: number;
  rb: number; // bottleneck radius (Å)
  mid: Vec3; // Cartesian point of the bottleneck
}

export interface SiteRow {
  group: string;
  el: string;
  ox: number;
  mult: number;
  occ: number;
  cn: number;
  dMean: number;
  bvs: number | null;
  bvsDev: number | null;
  distortion: number;
  shape: string;
  cshm: number | null;
  volume: number | null;
  mobile: boolean;
}

export interface Sharing {
  corner: number;
  edge: number;
  face: number;
}

export interface StaticFeatures {
  values: Record<string, FeatureValue>;
  sites: SiteRow[];
  hops: Hop[];
  prdf: { pair: string; points: { x: number; y: number }[] }[];
  sharing: { frame: Sharing; mm: Sharing; mf: Sharing };
  mobileEl: string | null;
  analyses: SiteAnalysis[];
}

/** Shannon ionic radius of the occupant at its own CN (fallback: 0.6 × atomic radius). */
export function ionicRadiusFn(cr: Crystal, ox: Record<string, number>, bonds: BondTable) {
  const cache = new Map<string, number>();
  return (pos: number, site: number) => {
    const s = cr.sites[site];
    const cn = bonds.bonded[pos].length || 6;
    const k = `${site}|${cn}`;
    const c = cache.get(k);
    if (c !== undefined) return c;
    const r = shannonRadius(s.element, Math.round(ox[s.label] ?? 0), cn, { kind: "ionic" })?.r ?? (ELEMENTS[s.element]?.r ?? 1.2) * 0.6;
    cache.set(k, r);
    return r;
  };
}

function bccIdeal(): IdealPolyhedron {
  const pts: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) pts.push([x, y, z]);
  for (const ax of [0, 1, 2])
    for (const s of [-2, 2]) {
      const p: Vec3 = [0, 0, 0];
      p[ax] = s;
      pts.push(p);
    }
  return { sym: "BCC:14", name: "bcc (8+6)", cn: 14, iupac: null, pts };
}
const BCC = bccIdeal();
const FCC = IDEAL_POLYHEDRA.find((p) => p.sym === "C:12")!;
const HCP = IDEAL_POLYHEDRA.find((p) => p.sym === "AC:12")!;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeStaticFeatures(
  cr: Crystal,
  ox: Record<string, number>,
  bonds: BondTable,
  table: Neighbor[][],
  opts: { mobileEl: string | null; hopCutoff: number },
): StaticFeatures {
  const L = cr.lattice;
  const v: Record<string, FeatureValue> = {};
  const elOf = (site: number) => cr.sites[site].element;
  const qOf = (site: number) => ox[cr.sites[site].label] ?? 0;
  const mainQ = (pos: number) => qOf(cr.positions[pos].main);

  // ---------------- lattice ----------------
  v.a = L.a;
  v.b = L.b;
  v.c = L.c;
  v.alpha = L.alpha;
  v.beta = L.beta;
  v.gamma = L.gamma;
  v.c_a = L.c / L.a;
  v.b_a = L.b / L.a;
  v.V = L.volume;
  const { Z } = formulaString(cr);
  v.Z = Z;
  v.V_Z = L.volume / Z;
  let N = 0,
    mass = 0;
  for (const p of cr.positions)
    for (const o of p.occupants) {
      N += o.occ;
      mass += o.occ * (ELEMENTS[elOf(o.site)]?.m ?? 0);
    }
  v.N = N;
  v.V_atom = L.volume / N;
  v.density = (mass * 1.66053907) / L.volume;
  v.sg = cr.spaceGroup.number ? `${cr.spaceGroup.symbol} (${cr.spaceGroup.number})` : cr.spaceGroup.symbol;
  v.system = crystalSystem(cr.spaceGroup.number);
  v.nSites = cr.sites.length;
  const nPos = cr.positions.length;
  let IG = 0;
  for (const g of cr.groups) {
    const p = g.positions.length / nPos;
    IG -= p * Math.log2(p);
  }
  v.IG = IG;
  v.IG_total = IG * nPos;

  // ---------------- per-site analyses ----------------
  const radius = ionicRadiusFn(cr, ox, bonds);
  const analyses = cr.groups.map((g) => analyzeSite(cr, ox, bonds, g.positions[0], { kind: "ionic" }));
  const mobileEl = opts.mobileEl;
  const isMobilePos = (pos: number) => !!mobileEl && cr.positions[pos].occupants.some((o) => elOf(o.site) === mobileEl);

  const sites: SiteRow[] = analyses.map((a, i) => {
    const g = cr.groups[i];
    const P = cr.positions[a.pos];
    return {
      group: g.key,
      el: a.host.el,
      ox: a.host.ox,
      mult: g.positions.length,
      occ: P.occupants.reduce((s, o) => s + o.occ, 0),
      cn: a.cn,
      dMean: a.dMean,
      bvs: a.bvsHost,
      bvsDev: a.bvsHost !== null && a.host.ox ? a.bvsHost / Math.abs(a.host.ox) - 1 : null,
      distortion: a.distortion,
      shape: a.shapes[0]?.sym ?? "",
      cshm: a.shapes[0]?.cshm ?? null,
      volume: a.volume,
      mobile: isMobilePos(a.pos),
    };
  });

  // ---------------- packing ----------------
  let vIons = 0;
  for (const p of cr.positions) for (const o of p.occupants) vIons += o.occ * (4 / 3) * Math.PI * radius(p.index, o.site) ** 3;
  v.packing = vIons / L.volume;
  const anionPos = cr.positions.filter((p) => mainQ(p.index) < 0);
  const anionEls = [...new Set(cr.sites.filter((s) => (ox[s.label] ?? 0) < 0).map((s) => s.element))];
  v.anionEls = anionEls.join(", ") || "—";
  const nAnion = anionPos.reduce((s, p) => s + p.occupants.filter((o) => qOf(o.site) < 0).reduce((t, o) => t + o.occ, 0), 0);
  v.V_anion = nAnion ? L.volume / nAnion : null;
  const anionSet = new Set(anionPos.map((p) => p.index));
  const dXX: number[] = [];
  for (const p of anionPos) {
    const nb = table[p.index].find((n) => anionSet.has(n.j));
    if (nb) dXX.push(nb.d);
  }
  v.dXX = mean(dXX);
  // anion sublattice type (one representative per anion orbit)
  const fits = { bcc: [] as number[], fcc: [] as number[], hcp: [] as number[] };
  for (const g of cr.groups) {
    const p0 = g.positions[0];
    if (mainQ(p0) >= 0) continue;
    const nbs = table[p0].filter((n) => anionSet.has(n.j));
    const w = g.positions.length;
    if (nbs.length >= 14) {
      const s = cshm(nbs.slice(0, 14).map((n) => n.v), BCC);
      for (let k = 0; k < w; k++) fits.bcc.push(s);
    }
    if (nbs.length >= 12) {
      const pts = nbs.slice(0, 12).map((n) => n.v);
      const sf = cshm(pts, FCC),
        sh = cshm(pts, HCP);
      for (let k = 0; k < w; k++) {
        fits.fcc.push(sf);
        fits.hcp.push(sh);
      }
    }
  }
  v.cshm_bcc = mean(fits.bcc);
  v.cshm_fcc = mean(fits.fcc);
  v.cshm_hcp = mean(fits.hcp);
  {
    const cands = (["bcc", "fcc", "hcp"] as const).map((k) => [k, v[`cshm_${k}`] as number | null] as const).filter((x) => x[1] !== null) as [string, number][];
    cands.sort((a, b) => a[1] - b[1]);
    v.anionFrame = cands.length ? (cands[0][1] < 6 ? `${cands[0][0]} 的` : `${cands[0][0]} に近い（歪み大）`) : "—";
  }
  {
    const dx: number[] = [];
    for (const p of cr.positions) {
      const q = mainQ(p.index);
      if (q <= 0 || isMobilePos(p.index)) continue;
      const Xc = ELEMENTS[elOf(p.main)]?.X;
      for (const nb of bonds.bonded[p.index]) {
        const Xa = ELEMENTS[elOf(cr.positions[nb.j].main)]?.X;
        if (Xc != null && Xa != null) dx.push(Xa - Xc);
      }
    }
    v.dX_frame = mean(dx);
  }

  // ---------------- bond valence ----------------
  {
    let s2 = 0,
      w = 0;
    analyses.forEach((a, i) => {
      if (a.bvsHost === null || !a.host.ox) return;
      const m = cr.groups[i].positions.length;
      s2 += m * (a.bvsHost - Math.abs(a.host.ox)) ** 2;
      w += m;
    });
    v.GII = w ? Math.sqrt(s2 / w) : null;
  }

  // ---------------- mobile sublattice ----------------
  const mobilePos = cr.positions.filter((p) => isMobilePos(p.index));
  v.mobile = mobileEl ?? "—";
  const occM = (pos: number) => cr.positions[pos].occupants.filter((o) => elOf(o.site) === mobileEl).reduce((s, o) => s + o.occ, 0);
  if (mobileEl && mobilePos.length) {
    const nM = mobilePos.reduce((s, p) => s + occM(p.index), 0);
    v.n_mobile = nM;
    v.rho_mobile = (nM / L.volume) * 1000;
    v.mobileSites = new Set(cr.sites.filter((s) => s.element === mobileEl).map((s) => s.label)).size;
    v.mobilePositions = mobilePos.length;
    v.vacancy = 1 - nM / mobilePos.length;
    const ent = mobilePos.map((p) => {
      const f = Math.min(1, occM(p.index));
      return f <= 0 || f >= 1 ? 0 : -(f * Math.log(f) + (1 - f) * Math.log(1 - f));
    });
    v.occEntropy = mean(ent);
    const mobileGroups = analyses.map((a, i) => ({ a, g: cr.groups[i] })).filter((x) => isMobilePos(x.a.pos));
    const wavg = (f: (a: SiteAnalysis) => number | null) => {
      let s = 0,
        w = 0;
      for (const { a, g } of mobileGroups) {
        const val = f(a);
        if (val === null || !Number.isFinite(val)) continue;
        const ww = g.positions.length * occM(a.pos);
        s += ww * val;
        w += ww;
      }
      return w ? s / w : null;
    };
    v.cn_mobile = wavg((a) => a.cn);
    v.d_mobile = wavg((a) => (a.cn ? a.dMean : null));
    v.vol_mobile = wavg((a) => a.volume);
    v.dist_mobile = wavg((a) => a.distortion);
    // BVS of the mobile ion itself (even on mixed sites)
    const mobileBvs = mobileGroups.map(({ a, g }) => {
      const site = cr.positions[a.pos].occupants.find((o) => elOf(o.site) === mobileEl)!.site;
      const b = site === a.host.site ? a : analyzeSite(cr, ox, bonds, a.pos, { kind: "ionic", hostSite: site });
      return { bvs: b.bvsHost, q: Math.abs(b.host.ox), w: g.positions.length * occM(a.pos) };
    });
    const bw = mobileBvs.filter((x) => x.bvs !== null && x.q);
    const sw = bw.reduce((s, x) => s + x.w, 0);
    v.bvs_mobile = sw ? bw.reduce((s, x) => s + x.w * (x.bvs as number), 0) / sw : null;
    v.bvs_mobile_dev = sw ? bw.reduce((s, x) => s + x.w * ((x.bvs as number) / x.q - 1), 0) / sw : null;
    const mSet = new Set(mobilePos.map((p) => p.index));
    let dMM = Infinity,
      dMF = Infinity;
    for (const p of mobilePos)
      for (const n of table[p.index]) {
        if (mSet.has(n.j)) dMM = Math.min(dMM, n.d);
        else if (mainQ(n.j) > 0) dMF = Math.min(dMF, n.d);
      }
    v.dMM = Number.isFinite(dMM) ? dMM : null;
    v.dMF = Number.isFinite(dMF) ? dMF : null;
  } else {
    for (const k of ["n_mobile", "rho_mobile", "mobileSites", "mobilePositions", "vacancy", "occEntropy", "cn_mobile", "d_mobile", "vol_mobile", "dist_mobile", "bvs_mobile", "bvs_mobile_dev", "dMM", "dMF"]) v[k] = null;
  }

  // ---------------- hop network ----------------
  const hops: Hop[] = [];
  if (mobileEl && mobilePos.length) {
    const field = new FrameworkField(cr, ox, mobileEl, radius, 6);
    const mSet = new Set(mobilePos.map((p) => p.index));
    for (const p of mobilePos)
      for (const n of table[p.index]) {
        if (n.d > opts.hopCutoff) break;
        if (!mSet.has(n.j)) continue;
        // each undirected hop once
        const key = `${p.index}|${n.j}|${n.t.join(",")}`;
        const rev = `${n.j}|${p.index}|${n.t.map((x) => -x).join(",")}`;
        if (p.index > n.j || (p.index === n.j && key > rev)) continue;
        const A = p.cart;
        let rb = Infinity,
          mid: Vec3 = A;
        const S = 24;
        for (let s = 1; s < S; s++) {
          const t = s / S;
          const x: Vec3 = [A[0] + n.v[0] * t, A[1] + n.v[1] * t, A[2] + n.v[2] * t];
          const r = field.eval(x[0], x[1], x[2])[1];
          if (r < rb) {
            rb = r;
            mid = x;
          }
        }
        hops.push({ a: p.index, b: n.j, t: n.t, d: n.d, rb, mid });
      }
    const deg = new Map<number, number>();
    for (const h of hops) {
      deg.set(h.a, (deg.get(h.a) ?? 0) + 1);
      deg.set(h.b, (deg.get(h.b) ?? 0) + 1);
    }
    v.hopDegree = mean(mobilePos.map((p) => deg.get(p.index) ?? 0));
    const rbs = hops.map((h) => h.rb);
    v.rb_min = rbs.length ? Math.min(...rbs) : null;
    v.rb_mean = mean(rbs);
    // percolation over hops sorted by bottleneck (largest first)
    const idx = new Map(mobilePos.map((p, i) => [p.index, i]));
    const uf = new PeriodicUnionFind(mobilePos.length);
    mobilePos.forEach((_, i) => uf.make(i));
    const rbD: (number | null)[] = [null, null, null];
    for (const h of [...hops].sort((x, y) => y.rb - x.rb)) {
      const before = uf.maxRank;
      uf.union(idx.get(h.a)!, idx.get(h.b)!, h.t);
      for (let d = before; d < uf.maxRank; d++) rbD[d] = h.rb;
    }
    v.hopDim = uf.maxRank;
    v.rb_1D = rbD[0];
    v.rb_2D = rbD[1];
    v.rb_3D = rbD[2];
  } else {
    for (const k of ["hopDegree", "hopDim", "rb_min", "rb_mean", "rb_1D", "rb_2D", "rb_3D"]) v[k] = null;
  }

  // ---------------- polyhedral connectivity ----------------
  const kindOf = (pos: number): "mobile" | "frame" | null => {
    if (bonds.bonded[pos].length < 3) return null;
    if (isMobilePos(pos)) return "mobile";
    return mainQ(pos) > 0 ? "frame" : null;
  };
  const sharing = { frame: { corner: 0, edge: 0, face: 0 }, mm: { corner: 0, edge: 0, face: 0 }, mf: { corner: 0, edge: 0, face: 0 } };
  let frameCount = 0,
    frameIsolated = 0;
  for (const p of cr.positions) {
    const kA = kindOf(p.index);
    if (!kA) continue;
    const shared = new Map<string, { kind: "mobile" | "frame"; n: number }>();
    for (const lig of bonds.bonded[p.index]) {
      for (const back of bonds.bonded[lig.j]) {
        const t2 = add(lig.t, back.t);
        if (back.j === p.index && t2[0] === 0 && t2[1] === 0 && t2[2] === 0) continue;
        const kB = kindOf(back.j);
        if (!kB) continue;
        const key = `${back.j}|${t2.join(",")}`;
        const cur = shared.get(key);
        if (cur) cur.n++;
        else shared.set(key, { kind: kB, n: 1 });
      }
    }
    if (kA === "frame") {
      frameCount++;
      if (![...shared.values()].some((s) => s.kind === "frame")) frameIsolated++;
    }
    for (const s of shared.values()) {
      const bucket = kA === "frame" && s.kind === "frame" ? sharing.frame : kA === "mobile" && s.kind === "mobile" ? sharing.mm : sharing.mf;
      const w = kA !== s.kind ? 1 : 0.5; // same-kind pairs are seen from both ends
      if (s.n === 1) bucket.corner += w;
      else if (s.n === 2) bucket.edge += w;
      else bucket.face += w;
    }
  }
  // mixed pairs were counted from both sides too
  sharing.mf.corner /= 2;
  sharing.mf.edge /= 2;
  sharing.mf.face /= 2;
  const frac = (s: Sharing, k: keyof Sharing) => {
    const t = s.corner + s.edge + s.face;
    return t ? s[k] / t : null;
  };
  v.frame_corner = frac(sharing.frame, "corner");
  v.frame_edge = frac(sharing.frame, "edge");
  v.frame_face = frac(sharing.frame, "face");
  v.frame_isolated = frameCount ? frameIsolated / frameCount : null;
  v.mm_face = frac(sharing.mm, "face");
  v.mf_face = frac(sharing.mf, "face");

  // ---------------- partial RDF ----------------
  const prdf = computePrdf(cr, 8, 0.05);

  for (const d of FEATURE_DEFS) if (d.async && !(d.key in v)) v[d.key] = null;
  return { values: v, sites, hops, prdf, sharing, mobileEl, analyses };
}

export function computePrdf(cr: Crystal, rmax: number, dr: number) {
  const tbl = buildNeighborTable(cr, rmax);
  const nb = Math.round(rmax / dr);
  const hist = new Map<string, Float64Array>();
  const count: Record<string, number> = {};
  for (const p of cr.positions) for (const o of p.occupants) count[cr.sites[o.site].element] = (count[cr.sites[o.site].element] ?? 0) + o.occ;
  const els = Object.keys(count).sort((a, b) => (ELEMENTS[a]?.X ?? 0) - (ELEMENTS[b]?.X ?? 0));
  for (let i = 0; i < els.length; i++) for (let j = i; j < els.length; j++) hist.set(`${els[i]}–${els[j]}`, new Float64Array(nb));
  cr.positions.forEach((p, i) => {
    for (const n of tbl[i]) {
      const bin = Math.floor(n.d / dr);
      if (bin >= nb) continue;
      for (const oa of p.occupants)
        for (const ob of cr.positions[n.j].occupants) {
          const A = cr.sites[oa.site].element,
            B = cr.sites[ob.site].element;
          const ia = els.indexOf(A),
            ib = els.indexOf(B);
          if (ia > ib) continue; // ordered pairs A ≤ B only
          hist.get(`${A}–${B}`)![bin] += oa.occ * ob.occ;
        }
    }
  });
  const V = cr.lattice.volume;
  const out: { pair: string; points: { x: number; y: number }[] }[] = [];
  for (const [pair, h] of hist) {
    const [A, B] = pair.split("–");
    const norm = V / (count[A] * count[B]);
    // gaussian smoothing (σ = dr)
    const g = new Float64Array(nb);
    for (let k = 0; k < nb; k++) {
      const r = (k + 0.5) * dr;
      g[k] = (h[k] * norm) / (4 * Math.PI * r * r * dr);
    }
    const sm: { x: number; y: number }[] = [];
    for (let k = 0; k < nb; k++) {
      let s = 0,
        w = 0;
      for (let q = -3; q <= 3; q++) {
        const kk = k + q;
        if (kk < 0 || kk >= nb) continue;
        const ww = Math.exp((-q * q) / 2);
        s += ww * g[kk];
        w += ww;
      }
      sm.push({ x: +((k + 0.5) * dr).toFixed(3), y: s / w });
    }
    if (sm.some((p) => p.y > 0)) out.push({ pair, points: sm });
  }
  return out;
}

/** Site energies (BVSE, relative to the grid minimum) of mobile positions. */
export function mobileSiteEnergies(cr: Crystal, field: FrameworkField, mobileEl: string, eMinAbs: number) {
  const rows: { pos: number; group: string; E: number }[] = [];
  for (const p of cr.positions) {
    if (!p.occupants.some((o) => cr.sites[o.site].element === mobileEl)) continue;
    const c = toCart(cr.lattice, p.frac);
    rows.push({ pos: p.index, group: p.group, E: field.eval(c[0], c[1], c[2])[0] - eMinAbs });
  }
  return rows;
}
