// The user's element colours (#74), shared by every view and saved in this browser.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { elementColor } from "../lib/data";
import { loadElementColors, saveElementColors, type ElementColors, type Rgb } from "../lib/elementColors";

interface ElementColorsValue {
  colors: ElementColors;
  /** Display colour of an element (custom or default). */
  colorOf: (el: string) => Rgb;
  /** Set an element's colour; null returns it to the default. */
  setColor: (el: string, c: Rgb | null) => void;
  /** Return the given elements (all when omitted) to their defaults. */
  resetColors: (els?: string[]) => void;
}

const Ctx = createContext<ElementColorsValue>({
  colors: {},
  colorOf: (el) => elementColor(el),
  setColor: () => {},
  resetColors: () => {},
});

export function ElementColorsProvider({ children }: { children: ReactNode }) {
  const [colors, setColors] = useState<ElementColors>(loadElementColors);
  const change = useCallback((f: (c: ElementColors) => ElementColors) => {
    setColors((c) => {
      const next = f(c);
      saveElementColors(next);
      return next;
    });
  }, []);
  const value = useMemo<ElementColorsValue>(
    () => ({
      colors,
      colorOf: (el) => elementColor(el, colors),
      setColor: (el, rgb) =>
        change((c) => {
          const next = { ...c };
          if (rgb) next[el] = rgb;
          else delete next[el];
          return next;
        }),
      resetColors: (els) => change((c) => (els ? Object.fromEntries(Object.entries(c).filter(([el]) => !els.includes(el))) : {})),
    }),
    [colors, change],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useElementColors = () => useContext(Ctx);
