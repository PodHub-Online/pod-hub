"use client";

import React from "react";
import { CalendarClock, Home, Moon } from "lucide-react";
import { haptic } from "~/lib/clientStorage";
import { useT } from "~/lib/i18n";

// "settings" opens from the account button in the header, not the bottom bar
export type AppTab = "home" | "schedule" | "sleep" | "settings";

export const APP_TABS: { id: AppTab; label: string; icon: React.ElementType }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
  { id: "sleep", label: "Sleep", icon: Moon },
];

export const BottomNav: React.FC<{
  active: AppTab;
  onChange: (tab: AppTab) => void;
  badges?: Partial<Record<AppTab, boolean>>;
}> = ({ active, onChange, badges }) => {
  const t = useT();
  return (
  <nav
    aria-label="Main"
    className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/70 bg-white/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/85 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-[24rem] sm:-translate-x-1/2 sm:rounded-3xl sm:border sm:pb-0 sm:shadow-2xl"
  >
    <ul className="mx-auto grid max-w-md grid-cols-3">
      {APP_TABS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <li key={id}>
            <button
              type="button"
              data-tour={`tab-${id}`}
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                if (!isActive) haptic();
                onChange(id);
              }}
              className="group relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-bold transition active:scale-95"
            >
              <span
                className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
                  isActive
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                    : "text-slate-500 group-hover:text-slate-800 dark:text-slate-400 dark:group-hover:text-white"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                {badges?.[id] && (
                  <span className="absolute right-2.5 top-1 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-950" />
                )}
              </span>
              <span
                className={
                  isActive ? "text-indigo-700 dark:text-indigo-300" : "text-slate-500 dark:text-slate-400"
                }
              >
                {t(label)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  </nav>
  );
};
