// Periodic union–find: tracks, for every connected cluster in a periodic system,
// the lattice of "winding" vectors created when the cluster wraps onto itself.
// The rank of that lattice (0–3) is the dimensionality of percolation; a lattice axis is open
// when a multiple of it lies in the winding lattice of some cluster.

type V3 = [number, number, number];

function rankOf(vs: V3[]): number {
  if (vs.length === 0) return 0;
  const nz = vs.filter((v) => v[0] || v[1] || v[2]);
  if (nz.length === 0) return 0;
  // rank 3?
  for (let i = 0; i < nz.length; i++)
    for (let j = i + 1; j < nz.length; j++)
      for (let k = j + 1; k < nz.length; k++) {
        const a = nz[i],
          b = nz[j],
          c = nz[k];
        const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
        if (det !== 0) return 3;
      }
  for (let i = 0; i < nz.length; i++)
    for (let j = i + 1; j < nz.length; j++) {
      const a = nz[i],
        b = nz[j];
      if (a[1] * b[2] - a[2] * b[1] || a[2] * b[0] - a[0] * b[2] || a[0] * b[1] - a[1] * b[0]) return 2;
    }
  return 1;
}

/** Keep at most 3 independent vectors (plus duplicates are dropped). */
function addBasis(basis: V3[], v: V3): V3[] | null {
  if (!(v[0] || v[1] || v[2])) return null;
  const r0 = rankOf(basis);
  if (r0 === 3) return null;
  const next = [...basis, v];
  return rankOf(next) > r0 ? next : null;
}

const AXES: V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export class PeriodicUnionFind {
  parent: Int32Array;
  // offset of node relative to its parent, in lattice units
  ox: Int32Array;
  oy: Int32Array;
  oz: Int32Array;
  basis: Map<number, V3[]> = new Map();
  maxRank = 0;
  /** Whether some cluster wraps along a / b / c (a multiple of the axis is a winding vector). */
  axes: [boolean, boolean, boolean] = [false, false, false];

  constructor(n: number) {
    this.parent = new Int32Array(n).fill(-1);
    this.ox = new Int32Array(n);
    this.oy = new Int32Array(n);
    this.oz = new Int32Array(n);
  }

  /** Activate a node as its own cluster. */
  make(i: number) {
    this.parent[i] = i;
    this.ox[i] = this.oy[i] = this.oz[i] = 0;
  }

  active(i: number) {
    return this.parent[i] >= 0;
  }

  /** Returns root and accumulated offset (node position = root position + offset). */
  find(i: number): [number, number, number, number] {
    let x = 0,
      y = 0,
      z = 0,
      r = i;
    while (this.parent[r] !== r) {
      x += this.ox[r];
      y += this.oy[r];
      z += this.oz[r];
      r = this.parent[r];
    }
    // path compression
    let c = i,
      cx = x,
      cy = y,
      cz = z;
    while (this.parent[c] !== r && this.parent[c] !== c) {
      const p = this.parent[c];
      const px = cx - this.ox[c],
        py = cy - this.oy[c],
        pz = cz - this.oz[c];
      this.parent[c] = r;
      this.ox[c] = cx;
      this.oy[c] = cy;
      this.oz[c] = cz;
      c = p;
      cx = px;
      cy = py;
      cz = pz;
    }
    return [r, x, y, z];
  }

  /** Connect i and the image of j shifted by lattice vector s (j_image = j + s). Returns cluster rank. */
  union(i: number, j: number, s: V3): number {
    const [ri, ix, iy, iz] = this.find(i);
    const [rj, jx, jy, jz] = this.find(j);
    if (ri === rj) {
      // unwrapped cells must satisfy c(j) = c(i) + s; any mismatch is a winding vector
      const w: V3 = [ix + s[0] - jx, iy + s[1] - jy, iz + s[2] - jz];
      const b = this.basis.get(ri) ?? [];
      const nb = addBasis(b, w);
      if (nb) {
        this.basis.set(ri, nb);
        const r = rankOf(nb);
        if (r > this.maxRank) this.maxRank = r;
        this.openAxes(nb, r);
        return r;
      }
      return rankOf(b);
    }
    // attach rj under ri with c(rj) − c(ri) = off(i) + s − off(j), so that c(j) = c(i) + s
    this.parent[rj] = ri;
    this.ox[rj] = ix + s[0] - jx;
    this.oy[rj] = iy + s[1] - jy;
    this.oz[rj] = iz + s[2] - jz;
    const bi = this.basis.get(ri) ?? [];
    const bj = this.basis.get(rj) ?? [];
    let merged = bi;
    for (const v of bj) {
      const nb = addBasis(merged, v);
      if (nb) merged = nb;
    }
    this.basis.delete(rj);
    if (merged.length) this.basis.set(ri, merged);
    const r = rankOf(merged);
    if (r > this.maxRank) this.maxRank = r;
    if (bj.length) this.openAxes(merged, r);
    return r;
  }

  /** Mark the axes lying in the (rational = real) span of an integer winding basis of rank r. */
  private openAxes(basis: V3[], r: number) {
    for (let k = 0; k < 3; k++) if (!this.axes[k] && (r === 3 || rankOf([...basis, AXES[k]]) === r)) this.axes[k] = true;
  }
}
