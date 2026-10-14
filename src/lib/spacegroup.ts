import sgRaw from "../data/spacegroups.json";

export interface SymOp {
  R: number[][]; // 3x3 rotation acting on fractional coords
  t: number[]; // translation
  text: string;
}

interface SgEntry {
  n: number;
  hm: string;
  u: string;
  hall: string;
  s: string;
  o: number[];
}

const SG = sgRaw as { ops: string[]; groups: SgEntry[] };

function parseFraction(s: string): number {
  if (s === "") return 1;
  if (s.includes("/")) {
    const [a, b] = s.split("/");
    return (a === "" ? 1 : parseFloat(a)) / parseFloat(b);
  }
  return parseFloat(s);
}

/** Parse "x-y+1/3, -z, 1/2+x" style operators. */
export function parseSymOp(text: string): SymOp {
  const parts = text.replace(/['"\s]/g, "").toLowerCase().split(",");
  if (parts.length !== 3) throw new Error(`対称操作を解釈できません: ${text}`);
  const R = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const t = [0, 0, 0];
  parts.forEach((expr, row) => {
    // split into signed terms
    const terms = expr.match(/[+-]?[^+-]+/g) ?? [];
    for (let term of terms) {
      let sign = 1;
      if (term.startsWith("-")) {
        sign = -1;
        term = term.slice(1);
      } else if (term.startsWith("+")) term = term.slice(1);
      const v = term.match(/[xyz]/);
      if (v) {
        const col = "xyz".indexOf(v[0]);
        // forms: x, 2x, 2*x, x/2, 1/2x
        const coefStr = term.replace(v[0], "").replace("*", "");
        let coef = 1;
        if (coefStr.startsWith("/")) coef = 1 / parseFloat(coefStr.slice(1));
        else if (coefStr !== "") coef = parseFraction(coefStr);
        R[row][col] += sign * coef;
      } else {
        t[row] += sign * parseFraction(term);
      }
    }
  });
  return { R, t, text };
}

function normHM(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s_]/g, "")
    .replace(/:.*/, "")
    .replace(/origin.*/, "");
}

function normHall(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/["']/g, '"').trim();
}

export interface SpaceGroupMatch {
  number: number;
  symbol: string;
  setting: string;
  ops: SymOp[];
}

function toMatch(e: SgEntry): SpaceGroupMatch {
  return { number: e.n, symbol: e.hm, setting: e.u, ops: e.o.map((i) => parseSymOp(SG.ops[i])) };
}

/** Prefer origin choice 2 and hexagonal axes, which is what ICSD / COD / VESTA write by default. */
function pickPreferred(cands: SgEntry[], hmRaw?: string): SgEntry | undefined {
  if (cands.length === 0) return undefined;
  if (hmRaw) {
    const want = hmRaw.toLowerCase();
    if (/:\s*1|origin\s*(choice)?\s*1/.test(want)) return cands.find((c) => c.u.endsWith(":1")) ?? cands[0];
    if (/:\s*r\b|rhomb/.test(want)) return cands.find((c) => c.u.endsWith(":R")) ?? cands[0];
  }
  return cands.find((c) => c.u.endsWith(":2")) ?? cands.find((c) => c.u.endsWith(":H")) ?? cands[0];
}

export function lookupSpaceGroup(opts: { hm?: string; hall?: string; number?: number }): SpaceGroupMatch | undefined {
  if (opts.hall) {
    const h = normHall(opts.hall);
    const e = SG.groups.find((g) => normHall(g.hall) === h);
    if (e) return toMatch(e);
  }
  if (opts.hm) {
    // ICSD-style setting suffixes: "F d -3 m Z" (origin 2), "... S" (origin 1), "R -3 m H" / "R -3 m R"
    let hmRaw = opts.hm.trim();
    const suf = hmRaw.match(/\s+([ZSHR])$/i);
    if (suf) {
      hmRaw = hmRaw.slice(0, suf.index) + ({ Z: ":2", S: ":1", H: ":H", R: ":R" } as Record<string, string>)[suf[1].toUpperCase()];
    }
    const h = normHM(hmRaw);
    const cands = SG.groups.filter((g) => normHM(g.hm) === h || normHM(g.u) === h || normHM(g.s) === h);
    const e = pickPreferred(cands, hmRaw);
    if (e) return toMatch(e);
  }
  if (opts.number && opts.number >= 1 && opts.number <= 230) {
    const e = pickPreferred(SG.groups.filter((g) => g.n === opts.number));
    if (e) return toMatch(e);
  }
  return undefined;
}

export function spaceGroupSymbolFromNumber(n: number): string | undefined {
  return SG.groups.find((g) => g.n === n)?.hm;
}
