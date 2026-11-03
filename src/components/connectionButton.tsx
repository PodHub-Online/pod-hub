"use client";

import React from "react";
import { Wifi, WifiOff } from "lucide-react";
import { apiR } from "~/trpc/react";
import { ago, wifiLabel } from "~/components/podHealthCard";
import { Sheet } from "~/components/ui/sheet";
import { tx } from "~/lib/i18n";

/** The pod's connection, Wi-Fi, water and priming, opened by tapping the pod name in the header. */
export const ConnectionSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const health = apiR.user.getPodHealth.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const h = health.data;
  const online = h?.online !== false;
  const Icon = online ? Wifi : WifiOff;
  const rows: [string, string, boolean?][] = h
    ? [
        [tx("Status"), online ? tx("Connected") : tx("Offline"), !online],
        [tx("Wi-Fi"), h.wifiSsid ?? "—"],
        [tx("Signal"), wifiLabel(h.wifiStrength)],
        [tx("Last heard from"), ago(h.lastSeen)],
        [tx("Water"), h.hasWater === false ? tx("Empty, refill tank") : tx("OK"), h.hasWater === false],
        [tx("Priming"), h.priming ? tx("In progress…") : h.needsPriming ? tx("Needed") : tx("Not needed"), !!h.needsPriming],
      ]
    : [];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={!h ? tx("Connecting…") : online ? tx("Pod connected") : tx("Pod offline")}
      icon={<Icon className={`h-5 w-5 ${online ? "text-power-500" : "text-amber-500"}`} />}
    >
      {!h ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{tx("Connecting…")}</p>
      ) : (
        <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {rows.map(([k, v, warn]) => (
            <div key={k} className="flex justify-between gap-3 py-2.5">
              <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
              <dd className={`text-right font-semibold ${warn ? "text-amber-600 dark:text-amber-400" : "text-slate-800 dark:text-slate-100"}`}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Sheet>
  );
};
