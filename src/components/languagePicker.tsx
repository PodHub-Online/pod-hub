"use client";

import React from "react";
import { Languages } from "lucide-react";
import { useI18n, type LangPref } from "~/lib/i18n";

const OPTIONS: { id: LangPref; label: string }[] = [
  { id: "system", label: "Phone" },
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];

/** Language for the whole app. "Phone" follows the system language. */
export const LanguagePicker: React.FC = () => {
  const { pref, setPref, t } = useI18n();
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-slate-200/80 bg-white/90 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-900/70">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
        <Languages className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-extrabold text-slate-900 dark:text-slate-200">{t("Language")}</span>
      <div className="inline-flex rounded-xl border border-slate-200 bg-white/80 p-1 dark:border-slate-800 dark:bg-slate-900/80">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setPref(o.id)}
            aria-pressed={pref === o.id}
            className={`h-7 rounded-lg px-2.5 text-xs font-bold transition ${
              pref === o.id
                ? "bg-slate-200 text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {o.id === "system" ? t(o.label) : o.label}
          </button>
        ))}
      </div>
    </div>
  );
};
