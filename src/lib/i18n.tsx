"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { readStorage, writeStorage } from "~/lib/clientStorage";
import { es } from "~/lib/i18n-es";

export type Lang = "en" | "es";
export type LangPref = Lang | "system";

const KEY = "podhub-lang";
const LOCALES: Record<Lang, string> = { en: "en-US", es: "es-ES" };

const systemLang = (): Lang =>
  typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";

type Vars = Record<string, string | number>;

interface I18n {
  lang: Lang;
  pref: LangPref;
  setPref: (p: LangPref) => void;
  /** locale for dates and numbers, e.g. "es-ES" */
  locale: string;
  /** English text in, the current language out; {name} placeholders filled from vars */
  t: (text: string, vars?: Vars) => string;
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

// Current language for code outside React hooks (helpers, 3D labels). The provider
// sets it while rendering and remounts the app when it changes, so every tx() re-runs.
let current: Lang = "en";
export const tx = (text: string, vars?: Vars) => fill(current === "es" ? es[text] ?? text : text, vars);
export const txLocale = () => LOCALES[current];

const I18nContext = createContext<I18n>({
  lang: "en",
  pref: "system",
  setPref: () => undefined,
  locale: LOCALES.en,
  t: fill,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<LangPref>("system");
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    const saved = readStorage(KEY);
    const p: LangPref = saved === "en" || saved === "es" ? saved : "system";
    setPrefState(p);
    setLang(p === "system" ? systemLang() : p);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setPref = useCallback((p: LangPref) => {
    setPrefState(p);
    setLang(p === "system" ? systemLang() : p);
    writeStorage(KEY, p);
  }, []);

  const t = useCallback((text: string, vars?: Vars) => fill(lang === "es" ? es[text] ?? text : text, vars), [lang]);

  current = lang;
  return (
    <I18nContext.Provider value={{ lang, pref, setPref, locale: LOCALES[lang], t }}>
      <React.Fragment key={lang}>{children}</React.Fragment>
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).t;
