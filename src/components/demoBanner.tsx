"use client";

import React from "react";
import { PlayCircle } from "lucide-react";
import { apiR } from "~/trpc/react";
import { tx } from "~/lib/i18n";

/** True while signed in to the demo (pretend data, nothing reaches a real pod). */
export function useIsDemo() {
  const account = apiR.user.getAccount.useQuery(undefined, { retry: false });
  return account.data?.demo === true;
}

/** Leaves the demo. Reloads so a real session saved on this device comes back by itself. */
export const LeaveDemoButton: React.FC<{ className?: string }> = ({ className = "" }) => {
  const logout = apiR.user.logout.useMutation({ onSettled: () => window.location.reload() });
  return (
    <button
      type="button"
      onClick={() => logout.mutate()}
      disabled={logout.isPending}
      className={`shrink-0 rounded-xl bg-white/80 px-2.5 py-1 text-[11px] font-bold text-indigo-700 shadow-sm active:scale-95 disabled:opacity-50 dark:bg-slate-900/70 dark:text-indigo-300 ${className}`}
    >
      {tx("Leave demo")}
    </button>
  );
};

/** A thin strip on every tab: this is the demo, and the way out. */
export const DemoBanner: React.FC = () => {
  if (!useIsDemo()) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-100">
      <span className="flex min-w-0 items-center gap-2">
        <PlayCircle className="h-4 w-4 shrink-0 text-indigo-500" />
        <span>
          <b>{tx("Demo")}</b> · {tx("Pretend data. Try anything: it resets and never controls a real bed.")}
        </span>
      </span>
      <LeaveDemoButton />
    </div>
  );
};

/** Settings → Demo: what the demo is, in place of the account page. */
export const DemoAccountCard: React.FC = () => (
  <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-5 text-sm dark:border-slate-800/80 dark:bg-slate-900/70">
    <p className="font-bold">{tx("You're in the demo")}</p>
    <p className="mt-1.5 text-slate-500 dark:text-slate-400">
      {tx("Everything here is pretend: two sides, schedules, last night's history, sleep stats and WHOOP data. Your changes last for this visit only and never reach a real Pod or account.")}
    </p>
    <p className="mt-1.5 text-slate-500 dark:text-slate-400">
      {tx("Account details, cron job keys and connections are hidden in the demo.")}
    </p>
    <div className="mt-4 flex justify-end">
      <LeaveDemoButton className="border border-indigo-200 px-3 py-1.5 text-xs dark:border-indigo-900/60" />
    </div>
  </div>
);
