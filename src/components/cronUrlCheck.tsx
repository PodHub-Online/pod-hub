"use client";

import React, { useState } from "react";
import { apiR } from "~/trpc/react";
import { AlertTriangle, Copy } from "lucide-react";
import { tx, txLocale } from "~/lib/i18n";

/**
 * The cron endpoint updates "last cron run" in every version of the app, but only
 * current code writes activity-log entries. If the timestamp keeps moving with no
 * cron entries, cron-job.org is calling an old Vercel deployment URL.
 */
export const CronUrlCheck: React.FC = () => {
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  const config = apiR.user.getAppConfig.useQuery();
  const [copied, setCopied] = useState(false);

  // Both timestamps come from the same server response, so they can't drift apart
  const lastRun = account.data?.lastCronRunAt ? new Date(account.data.lastCronRunAt).getTime() : null;
  const lastLogged = account.data?.lastLoggedCronAt ? new Date(account.data.lastLoggedCronAt).getTime() : null;
  const mismatch = lastRun !== null && (lastLogged === null || lastRun - lastLogged > 60_000);
  if (!mismatch) return null;

  const url = config.data?.cronUrl ?? "";
  return (
    <div className="rounded-2xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
      <p className="flex items-start gap-2 font-bold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
        {tx("Your cron job is calling an old copy of the app")}
      </p>
      <p className="mt-1.5">
        {tx("The last cron call was at {time}, but it wasn't logged. Vercel keeps every old deployment online at its own address, and cron-job.org is calling one of those, which runs code from before the activity log existed.", { time: new Date(lastRun).toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" }) })}
      </p>
      <p className="mt-2 font-semibold">{tx("Fix: in cron-job.org, edit the job and set the URL to exactly this:")}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-white/70 px-2 py-1.5 font-mono dark:bg-slate-900/70">{url}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => setCopied(true));
          }}
          className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-rose-600 px-3 font-bold text-white"
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? tx("Copied") : tx("Copy")}
        </button>
      </div>
      <p className="mt-1.5 text-rose-800/80 dark:text-rose-200/70">
        {tx("Use your project's main domain (the one you open the app with), not a long address with random letters. The next call will then show up here.")}
      </p>
    </div>
  );
};
