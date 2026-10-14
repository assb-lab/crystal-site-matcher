// Minimal but robust CIF 1.1 reader (also tolerates CIF2/mmCIF-style dotted tags).

export interface CifLoop {
  tags: string[];
  rows: string[][];
}

export interface CifBlock {
  name: string;
  items: Map<string, string>;
  loops: CifLoop[];
}

/** Normalise a tag so `_space_group_symop.operation_xyz` and `_space_group_symop_operation_xyz` compare equal. */
export function normTag(tag: string): string {
  return tag.toLowerCase().replace(/\./g, "_");
}

type Tok = { v: string; quoted: boolean };

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Semicolon-delimited text field
    if (line.startsWith(";")) {
      const buf: string[] = [line.slice(1)];
      i++;
      while (i < lines.length && !lines[i].startsWith(";")) {
        buf.push(lines[i]);
        i++;
      }
      toks.push({ v: buf.join("\n").trim(), quoted: true });
      i++; // skip closing ;
      continue;
    }
    let p = 0;
    const n = line.length;
    while (p < n) {
      const ch = line[p];
      if (ch === " " || ch === "\t") {
        p++;
        continue;
      }
      if (ch === "#") break; // comment
      if (ch === "'" || ch === '"') {
        // quote closes only when followed by whitespace or EOL
        let q = p + 1;
        while (q < n && !(line[q] === ch && (q + 1 === n || line[q + 1] === " " || line[q + 1] === "\t"))) q++;
        toks.push({ v: line.slice(p + 1, q), quoted: true });
        p = q + 1;
        continue;
      }
      let q = p;
      while (q < n && line[q] !== " " && line[q] !== "\t") q++;
      toks.push({ v: line.slice(p, q), quoted: false });
      p = q;
    }
    i++;
  }
  return toks;
}

function isReserved(t: Tok, word: string): boolean {
  return !t.quoted && t.v.toLowerCase().startsWith(word);
}

export function parseCif(text: string): CifBlock[] {
  const toks = tokenize(text);
  const blocks: CifBlock[] = [];
  let cur: CifBlock | null = null;
  const ensure = () => {
    if (!cur) {
      cur = { name: "unnamed", items: new Map(), loops: [] };
      blocks.push(cur);
    }
    return cur;
  };
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (isReserved(t, "data_")) {
      cur = { name: t.v.slice(5) || "unnamed", items: new Map(), loops: [] };
      blocks.push(cur);
      i++;
      continue;
    }
    if (isReserved(t, "loop_")) {
      const blk = ensure();
      i++;
      const tags: string[] = [];
      while (i < toks.length && !toks[i].quoted && toks[i].v.startsWith("_")) {
        tags.push(normTag(toks[i].v));
        i++;
      }
      const vals: string[] = [];
      while (i < toks.length) {
        const u = toks[i];
        if (!u.quoted && (u.v.startsWith("_") || isReserved(u, "loop_") || isReserved(u, "data_") || isReserved(u, "save_") || isReserved(u, "global_")))
          break;
        vals.push(u.v);
        i++;
      }
      const rows: string[][] = [];
      if (tags.length > 0) {
        for (let r = 0; r + tags.length <= vals.length; r += tags.length) rows.push(vals.slice(r, r + tags.length));
      }
      blk.loops.push({ tags, rows });
      continue;
    }
    if (!t.quoted && t.v.startsWith("_")) {
      const blk = ensure();
      const tag = normTag(t.v);
      const val = toks[i + 1];
      if (val && !(!val.quoted && val.v.startsWith("_"))) {
        blk.items.set(tag, val.v);
        i += 2;
      } else {
        blk.items.set(tag, "?");
        i++;
      }
      continue;
    }
    i++; // stray token (save_, global_, ...)
  }
  return blocks;
}

/** Look up a single value (either a plain item or the first row of a loop). */
export function getItem(block: CifBlock, ...tags: string[]): string | undefined {
  for (const tag of tags) {
    const t = normTag(tag);
    const v = block.items.get(t);
    if (v !== undefined && v !== "?" && v !== ".") return v;
    for (const loop of block.loops) {
      const c = loop.tags.indexOf(t);
      if (c >= 0 && loop.rows.length > 0) {
        const lv = loop.rows[0][c];
        if (lv !== "?" && lv !== ".") return lv;
      }
    }
  }
  return undefined;
}

/** Return the loop containing `tag` plus a column accessor. */
export function getLoop(block: CifBlock, ...tags: string[]): { loop: CifLoop; col: (tag: string) => number } | undefined {
  for (const tag of tags) {
    const t = normTag(tag);
    const loop = block.loops.find((l) => l.tags.includes(t));
    if (loop) return { loop, col: (x: string) => loop.tags.indexOf(normTag(x)) };
  }
  return undefined;
}

/** Parse a CIF number, stripping standard uncertainty: "0.1234(5)" → 0.1234. */
export function cifNumber(s: string | undefined): number {
  if (s === undefined) return NaN;
  const m = s.trim().match(/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}
