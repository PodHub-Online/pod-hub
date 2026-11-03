"use client";

import React from "react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader, Skeleton } from "~/components/ui/card";
import { Check, HelpCircle, Lock, Minus, RotateCw, Sparkles } from "lucide-react";
import { tx, txLocale } from "~/lib/i18n";

const STATE = {
  available: { label: "Available", icon: Check, cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
  subscription: { label: "Needs subscription", icon: Lock, cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
  unsupported: { label: "Not on your pod", icon: Minus, cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
  unknown: { label: "Unknown", icon: HelpCircle, cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
} as const;

/** Which Eight Sleep features this account can actually use. Checked each time the Pod page opens. */
export const CapabilitiesCard: React.FC = () => {
  const query = apiR.user.getCapabilities.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnMount: "always",
  });

  return (
    <Card>
      <CardHeader
        icon={<Sparkles className="h-5 w-5" />}
        title={tx("What your pod supports")}
        subtitle={query.dataUpdatedAt ? tx("Checked {time}", { time: new Date(query.dataUpdatedAt).toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit" }) }) : tx("Checking your account…")}
        action={
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="inline-flex h-10 items-center gap-1.5 rounded-2xl bg-indigo-600 px-3 text-xs font-bold text-white active:scale-95 disabled:opacity-50"
          >
            <RotateCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            {tx("Recheck")}
          </button>
        }
      />
      {query.isFetching && !query.data ? (
        <Skeleton className="h-40" />
      ) : query.isError ? (
        <p className="text-xs text-rose-600">{query.error.message}</p>
      ) : !query.data ? null : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {query.data.map((c) => {
            const s = STATE[c.state];
            const Icon = s.icon;
            return (
              <li key={c.key} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">{tx(c.label)}</span>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${s.cls}`} title={c.detail}>
                  <Icon className="h-3 w-3" />
                  {tx(s.label)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};
