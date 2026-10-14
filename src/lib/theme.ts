// Light / dark / system theme. The stylesheet keys everything off <html data-theme>,
// and the 3D viewer re-reads its colours whenever that attribute changes.
import { useEffect, useState } from "react";
import { storage } from "./storage";

export type ThemePref = "system" | "light" | "dark";
const KEY = "csm.theme";

// A host page (e.g. an embedding viewer) may already have set data-theme; in "system"
// mode we hand control back to it instead of removing its choice.
const hostTheme = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") {
    if (hostTheme) root.setAttribute("data-theme", hostTheme);
    else root.removeAttribute("data-theme");
  } else root.setAttribute("data-theme", pref);
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => {
    const s = storage.get(KEY);
    return s === "light" || s === "dark" ? s : "system";
  });
  useEffect(() => {
    applyTheme(pref);
    storage.set(KEY, pref);
  }, [pref]);
  return [pref, setPref];
}
