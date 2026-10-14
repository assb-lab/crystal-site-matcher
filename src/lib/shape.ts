// Continuous shape measure (CShM) against ideal coordination polyhedra.
// S = 100 · min Σ|p_i − s·R·q_π(i)|² / Σ|p_i|², with p, q taken relative to the central atom.
// The minimum over rotations R and assignments π is found by iterative closest point
// (Hungarian assignment + Horn quaternion superposition) from many starting orientations.

import { IDEAL_POLYHEDRA, IdealPolyhedron } from "./data";
import type { Vec3 } from "./structure";

export interface ShapeFit {
  sym: string;
  name: string;
  cshm: number;
}

/** Hungarian algorithm (minimisation) for a square cost matrix. Returns assignment row→col. */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const INF = 1e18;
  const u = new Array(n + 1).fill(0),
    v = new Array(n + 1).fill(0),
    p = new Array(n + 1).fill(0),
    way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF,
        j1 = 0;
      for (let j = 1; j <= n; j++)
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      for (let j = 0; j <= n; j++)
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const ans = new Array(n).fill(0);
  for (let j = 1; j <= n; j++) ans[p[j] - 1] = j - 1;
  return ans;
}

type Mat3 = number[][];

function quatToMat(q: number[]): Mat3 {
  const [w, x, y, z] = q;
  return [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
}

/** Largest eigenvector of a symmetric 4x4 matrix (Jacobi). */
function maxEigVec4(A: number[][]): number[] {
  const a = A.map((r) => r.slice());
  const V = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p],
            akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k],
            aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = V[k][p],
            vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [V[0][best], V[1][best], V[2][best], V[3][best]];
}

/** Optimal rotation R minimising Σ|p_i − R q_i|² (Horn 1987). */
function superpose(P: Vec3[], Q: Vec3[]): Mat3 {
  let Sxx = 0,
    Sxy = 0,
    Sxz = 0,
    Syx = 0,
    Syy = 0,
    Syz = 0,
    Szx = 0,
    Szy = 0,
    Szz = 0;
  for (let i = 0; i < P.length; i++) {
    const q = Q[i],
      p = P[i];
    Sxx += q[0] * p[0];
    Sxy += q[0] * p[1];
    Sxz += q[0] * p[2];
    Syx += q[1] * p[0];
    Syy += q[1] * p[1];
    Syz += q[1] * p[2];
    Szx += q[2] * p[0];
    Szy += q[2] * p[1];
    Szz += q[2] * p[2];
  }
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  return quatToMat(maxEigVec4(N));
}

const mul = (R: Mat3, v: Vec3): Vec3 => [
  R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
  R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
  R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
];

function normalizeSet(V: Vec3[]): Vec3[] {
  const rms = Math.sqrt(V.reduce((s, v) => s + v[0] * v[0] + v[1] * v[1] + v[2] * v[2], 0) / V.length) || 1;
  return V.map((v) => [v[0] / rms, v[1] / rms, v[2] / rms] as Vec3);
}

// deterministic pseudo random rotations
function rotations(count: number): Mat3[] {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const out: Mat3[] = [quatToMat([1, 0, 0, 0])];
  for (let i = 1; i < count; i++) {
    const u1 = rnd(),
      u2 = rnd(),
      u3 = rnd();
    const q = [
      Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
      Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
      Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
      Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
    ];
    out.push(quatToMat(q));
  }
  return out;
}
const START_ROTS = rotations(24);

function frame(a: Vec3, b: Vec3): Mat3 | null {
  const na = Math.hypot(...a);
  if (na < 1e-9) return null;
  const e1: Vec3 = [a[0] / na, a[1] / na, a[2] / na];
  const d = b[0] * e1[0] + b[1] * e1[1] + b[2] * e1[2];
  const u: Vec3 = [b[0] - d * e1[0], b[1] - d * e1[1], b[2] - d * e1[2]];
  const nu = Math.hypot(...u);
  if (nu < 1e-6) return null;
  const e2: Vec3 = [u[0] / nu, u[1] / nu, u[2] / nu];
  const e3: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return [e1, e2, e3]; // rows
}

const angleBetween = (a: Vec3, b: Vec3) =>
  Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))));

/** Starting rotations that map a pair of ligands onto every ideal vertex pair with a similar angle. */
function anchorRotations(P: Vec3[], Q: Vec3[]): Mat3[] {
  const out: Mat3[] = [];
  const n = P.length;
  if (n < 2) return out;
  // anchors: ligand 0 with its angularly closest and its most distant non-collinear partner
  const partners = P.map((p, i) => ({ i, a: angleBetween(P[0], p) }))
    .filter((x) => x.i !== 0 && x.a > 0.05 && x.a < Math.PI - 0.05)
    .sort((x, y) => x.a - y.a);
  const picks = partners.length ? [partners[0], partners[partners.length - 1]] : [];
  for (const pk of picks) {
    const Fp = frame(P[0], P[pk.i]);
    if (!Fp) continue;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (Math.abs(angleBetween(Q[i], Q[j]) - pk.a) > 0.35) continue;
        const Fq = frame(Q[i], Q[j]);
        if (!Fq) continue;
        // R = Fp^T · Fq  (maps q-frame onto p-frame)
        const R: Mat3 = [0, 1, 2].map((r) => [0, 1, 2].map((c) => Fp[0][r] * Fq[0][c] + Fp[1][r] * Fq[1][c] + Fp[2][r] * Fq[2][c]));
        out.push(R);
      }
  }
  return out;
}

export function cshm(ligands: Vec3[], ideal: IdealPolyhedron): number {
  const n = ligands.length;
  if (n !== ideal.pts.length || n === 0) return Infinity;
  const P = normalizeSet(ligands);
  const Q = normalizeSet(ideal.pts);
  const sumP2 = P.reduce((s, v) => s + v[0] * v[0] + v[1] * v[1] + v[2] * v[2], 0);
  const sumQ2 = Q.reduce((s, v) => s + v[0] * v[0] + v[1] * v[1] + v[2] * v[2], 0);
  let best = Infinity;
  const starts = [...START_ROTS, ...anchorRotations(P, Q)];
  for (const R0 of starts) {
    let R = R0;
    let last = Infinity;
    for (let it = 0; it < 30; it++) {
      const RQ = Q.map((q) => mul(R, q));
      const cost = P.map((p) => RQ.map((q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2));
      const assign = hungarian(cost);
      const Qa = assign.map((j) => Q[j]);
      R = superpose(P, Qa);
      const RQa = Qa.map((q) => mul(R, q));
      let cross = 0;
      for (let i = 0; i < n; i++) cross += P[i][0] * RQa[i][0] + P[i][1] * RQa[i][1] + P[i][2] * RQa[i][2];
      const s = cross / sumQ2;
      let res = 0;
      for (let i = 0; i < n; i++) res += (P[i][0] - s * RQa[i][0]) ** 2 + (P[i][1] - s * RQa[i][1]) ** 2 + (P[i][2] - s * RQa[i][2]) ** 2;
      const S = (100 * res) / sumP2;
      if (S < best) best = S;
      if (Math.abs(last - S) < 1e-9) break;
      last = S;
    }
    if (best < 1e-6) break;
  }
  return best;
}

export function classifyShape(ligands: Vec3[]): ShapeFit[] {
  const n = ligands.length;
  const shapes = IDEAL_POLYHEDRA.filter((p) => p.cn === n);
  return shapes.map((s) => ({ sym: s.sym, name: s.name, cshm: cshm(ligands, s) })).sort((a, b) => a.cshm - b.cshm);
}
