"use client";

import React, { useState } from "react";
import { apiR } from "~/trpc/react";
import { BarChart3, ChevronDown, Palmtree, Settings, X } from "lucide-react";
import { ThemeCycleButton } from "~/components/themeToggle";
import { ConnectionSheet } from "~/components/connectionButton";
import { SideSwitch } from "~/components/sideBar";
import { hubName } from "~/lib/appName";
import { useT } from "~/lib/i18n";

interface HeaderProps {
  isLoggedIn: boolean;
  onOpenSettings?: () => void;
  /** Left / Right / Whole bed on the right of the header (Home and Schedule) */
  showSides?: boolean;
  settingsActive?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  isLoggedIn,
  onOpenSettings,
  showSides,
  settingsActive,
}) => {
  const t = useT();
  const podStatusQuery = apiR.user.getPodStatus.useQuery(undefined, {
    enabled: isLoggedIn,
    retry: false,
  });
  const accountQuery = apiR.user.getAccount.useQuery(undefined, {
    enabled: isLoggedIn,
    retry: false,
  });

  // the owner's Statistics icon shows how many other people opened the app today
  const liveQuery = apiR.stats.todayCount.useQuery(undefined, {
    enabled: isLoggedIn && accountQuery.data?.isOwner === true,
    refetchInterval: 60_000,
    retry: false,
  });

  const healthQuery = apiR.user.getPodHealth.useQuery(undefined, {
    enabled: isLoggedIn,
    retry: false,
    refetchInterval: 30_000,
  });
  const health = healthQuery.data;
  const onVacation = accountQuery.data?.vacationMode ?? false;
  // someone asked to get in (owner only)
  const waiting = (accountQuery.data?.pendingRequests ?? 0) > 0;
  const isOn = podStatusQuery.data?.isOn ?? false;
  const hasStatus = !!podStatusQuery.data;
  const [connOpen, setConnOpen] = useState(false);
  // the dot under the name: red offline, amber needs water or priming, blue priming, else on/off
  const dot = !hasStatus
    ? "bg-slate-400"
    : health?.online === false
      ? "bg-rose-500"
      : health?.hasWater === false || health?.needsPriming
        ? "bg-amber-500"
        : health?.priming
          ? "bg-sky-500"
          : isOn
            ? "bg-emerald-500"
            : "bg-slate-400";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/70 bg-white/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/75">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {/* the app icon opens Settings (and closes it again); a dot when someone is waiting */}
          <button
            type="button"
            disabled={!isLoggedIn || !onOpenSettings}
            onClick={onOpenSettings}
            data-tour="settings"
            aria-label={settingsActive ? t("Close settings") : t("Settings")}
            className="relative h-9 w-9 shrink-0 rounded-xl transition active:scale-95 disabled:cursor-default"
          >
            <img
              src="/icon-192.png"
              alt=""
              className={`h-9 w-9 rounded-xl shadow-md shadow-indigo-500/25 ring-1 transition ${settingsActive ? "opacity-40 ring-indigo-500" : "ring-white/10"}`}
            />
            {isLoggedIn && (
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-slate-600 shadow ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                {settingsActive ? <X className="h-2.5 w-2.5" /> : <Settings className="h-2.5 w-2.5" />}
              </span>
            )}
            {isLoggedIn && !settingsActive && waiting && (
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-950" aria-label={t("Someone is waiting for an invite")} />
            )}
          </button>
          {/* signed in: the name and status open the pod's connection details */}
          <button
            type="button"
            disabled={!isLoggedIn}
            onClick={() => setConnOpen(true)}
            aria-label={isLoggedIn ? t("Pod connection") : undefined}
            className="min-w-0 rounded-lg text-left transition active:opacity-70 disabled:cursor-default"
          >
            <span className="flex items-center gap-1 truncate text-base font-black tracking-tight text-slate-900 dark:text-slate-200">
              <span className="truncate">{hubName(isLoggedIn ? accountQuery.data?.displayName : null)}</span>
              {isLoggedIn && <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
            </span>
            {isLoggedIn && (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {onVacation ? (
                  <>
                    <Palmtree className="h-3 w-3 text-teal-500" />
                    <span>{t("Vacation mode")}</span>
                  </>
                ) : (
                  <>
                    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                    <span>
                      {!hasStatus
                        ? t("Connecting…")
                        : isOn
                          ? t("Pod is on")
                          : t("Pod is off")}
                    </span>
                    {/* only when something needs attention: priming, offline, water (tapping the name shows the rest) */}
                    {health && (health.priming === true || health.online === false || health.needsPriming === true || health.hasWater === false) && (
                      <span
                        className={
                          health.priming
                            ? "text-sky-500"
                            : health.online === false || health.needsPriming || health.hasWater === false
                              ? "text-amber-600 dark:text-amber-400"
                              : ""
                        }
                      >
                        ·{" "}
                        {health.priming
                          ? t("Priming now…")
                          : health.online === false
                            ? t("Offline")
                            : health.hasWater === false
                              ? t("Water empty")
                              : health.needsPriming
                                ? t("Needs priming")
                                : null}
                      </span>
                    )}
                  </>
                )}
              </span>
            )}
          </button>
          {isLoggedIn && <ConnectionSheet open={connOpen} onClose={() => setConnOpen(false)} />}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* the owner's quick way to the Statistics page; a dot when someone is waiting */}
          {isLoggedIn && accountQuery.data?.isOwner && (
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.setItem("podhub-open-page", "usage");
                } catch {
                  // the event below still opens it
                }
                window.dispatchEvent(new Event("podhub-open-page"));
              }}
              aria-label={t("Statistics")}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-600 shadow-sm transition active:scale-95 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300"
            >
              <BarChart3 className="h-4 w-4" />
              {/* green: people using the app right now (you included); red dot: someone waiting to join */}
              {liveQuery.data && liveQuery.data.n > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-extrabold text-emerald-950 ring-2 ring-white dark:ring-slate-950" aria-label={t("{n} other people used the app today", { n: liveQuery.data.n })}>
                  {liveQuery.data.n}
                </span>
              )}
              {!!accountQuery.data.pendingRequests && <span className="absolute -left-0.5 -top-0.5 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-950" />}
            </button>
          )}
          {/* signed out, the theme stays here; signed in it's in Settings → Preferences */}
          {!isLoggedIn && <ThemeCycleButton />}
          {isLoggedIn && showSides && <SideSwitch />}
        </div>
      </div>
    </header>
  );
};
