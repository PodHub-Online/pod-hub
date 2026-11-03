"use client";

import React from "react";
import { BarChart3, ChevronRight, CloudSun, Cog, KeyRound, UserPlus } from "lucide-react";
import { Card, CardHeader } from "~/components/ui/card";
import { tx } from "~/lib/i18n";
import { setDemoWeatherEnabled, useDemoWeatherEnabled } from "~/lib/skyOverride"; // DEMO-WEATHER

type AdminPage = "invites" | "usage" | "cron" | "whoopkeys";

function Row({ icon: Icon, title, summary, tone, onClick }: { icon: React.ElementType; title: string; summary: string; tone?: "warn"; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-slate-100 dark:active:bg-slate-800">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${tone === "warn" ? "bg-amber-500/15 text-amber-600" : "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold text-slate-900 dark:text-slate-100">{title}</span>
        <span className={`block truncate text-xs ${tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}`}>{summary}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
    </button>
  );
}

/** Settings → Administrator: everything only the owner sees. */
export const AdministratorPage: React.FC<{
  pendingRequests: number;
  /** a warning about the cron job, when it hasn't run lately */
  cronSummary: string | null;
  whoopConfigured: boolean;
  onOpen: (page: AdminPage) => void;
}> = ({ pendingRequests, cronSummary, whoopConfigured, onOpen }) => {
  const weather = useDemoWeatherEnabled(); // DEMO-WEATHER
  return (
    <div className="space-y-4">
      <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 dark:divide-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70">
        <Row
          icon={UserPlus}
          title={tx("Invites")}
          summary={pendingRequests ? tx("{n} waiting for you", { n: pendingRequests }) : tx("Who can sign in, and who's asking")}
          tone={pendingRequests ? "warn" : undefined}
          onClick={() => onOpen("invites")}
        />
        <Row icon={BarChart3} title={tx("Statistics")} summary={tx("People, how they use the app, how it runs")} onClick={() => onOpen("usage")} />
        <Row icon={Cog} title={tx("Cron job")} summary={cronSummary ?? tx("The 5-minute schedule check: address and last run")} tone={cronSummary ? "warn" : undefined} onClick={() => onOpen("cron")} />
        <Row icon={KeyRound} title={tx("WHOOP app keys")} summary={whoopConfigured ? tx("Saved · edit keys and addresses") : tx("Not set up yet")} onClick={() => onOpen("whoopkeys")} />
      </div>
      {/* DEMO-WEATHER (start) */}
      <Card>
        <CardHeader icon={<CloudSun className="h-5 w-5" />} title={tx("Demo weather")} subtitle={tx("Shows a button on the 3D bed that steps through the weathers, to show friends")} />
        <button
          type="button"
          role="switch"
          aria-checked={weather}
          aria-label={tx("Demo weather")}
          onClick={() => setDemoWeatherEnabled(!weather)}
          className={`relative h-8 w-14 rounded-full transition-colors ${weather ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${weather ? "left-7" : "left-1"}`} />
        </button>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{tx("Saved on this device only. Nobody else sees the button, except in the demo, where everyone does.")}</p>
      </Card>
      {/* DEMO-WEATHER (end) */}
    </div>
  );
};
