// React hook around the pattern cache (src/lib/patterns.ts): computes the requested patterns of the given
// crystals one per tick in the background and re-renders as they arrive.
import { useEffect, useState } from "react";
import type { Crystal } from "./structure";
import { PatternKind, Patterns, cachedPattern, patternOf } from "./patterns";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A stable number per Crystal object, so a list of crystals can be an effect dependency. */
const ids = new WeakMap<Crystal, number>();
let nextId = 0;
const idOf = (c: Crystal) => {
  let i = ids.get(c);
  if (i === undefined) ids.set(c, (i = nextId++));
  return i;
};

export function usePatterns<K extends PatternKind>(crystals: Crystal[], kind: K | null): (cr: Crystal) => Patterns[K] | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!kind) return;
    const todo = crystals.filter((c) => !cachedPattern(c, kind));
    if (!todo.length) return;
    let cancelled = false;
    (async () => {
      for (const c of todo) {
        await tick();
        if (cancelled) return;
        patternOf(c, kind);
        bump((n) => n + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, crystals.map(idOf).join(",")]);
  return (cr) => (kind ? cachedPattern(cr, kind) : undefined);
}
