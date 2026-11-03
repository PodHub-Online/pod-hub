"use client";

import React from "react";
import { useTheme } from "./themeProvider";
import { Sun, Moon, Laptop } from "lucide-react";
import { tx } from "~/lib/i18n";

export const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white/80 p-1 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <button
        type="button"
        onClick={() => setTheme("light")}
        title={tx("Light theme")}
        aria-label={tx("Light theme")}
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
          theme === "light"
            ? "bg-slate-200 text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        }`}
      >
        <Sun className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => setTheme("dark")}
        title={tx("Dark theme")}
        aria-label={tx("Dark theme")}
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
          theme === "dark"
            ? "bg-slate-200 text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        }`}
      >
        <Moon className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => setTheme("system")}
        title={tx("Follow phone")}
        aria-label={tx("Follow phone theme")}
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
          theme === "system"
            ? "bg-slate-200 text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        }`}
      >
        <Laptop className="h-4 w-4" />
      </button>
    </div>
  );
};

/** One small button for the header: tap to go phone → light → dark. Shows the current choice. */
export const ThemeCycleButton: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const label = theme === "light" ? tx("Light theme") : theme === "dark" ? tx("Dark theme") : tx("Follow phone");
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Laptop;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
};
