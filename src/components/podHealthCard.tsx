"use client";

import React, { useEffect, useState } from "react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader, Skeleton } from "~/components/ui/card";
import { useToast } from "~/components/ui/toast";
import { formatLevel } from "~/lib/presets";
import { BedDouble, Droplets, Lightbulb, Loader2, Stethoscope, Wifi } from "lucide-react";
import { tx, txLocale } from "~/lib/i18n";

function Row({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={`text-right font-semibold ${
          tone === "good"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "bad"
            ? "text-rose-600 dark:text-rose-400"
            : tone === "warn"
            ? "text-amber-600 dark:text-amber-400"
            : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(txLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : tx("Unknown");

export const ago = (iso: string | null) => {
  if (!iso) return tx("Unknown");
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return tx("Just now");
  if (min < 60) return tx("{n} min ago", { n: min });
  const h = Math.round(min / 60);
  return h < 48 ? tx("{n} h ago", { n: h }) : tx("{n} days ago", { n: Math.round(h / 24) });
};

export function wifiLabel(strength: number | null) {
  if (strength === null) return tx("Unknown");
  // Eight Sleep reports either a 0–100 quality or a negative dBm value
  const q = strength < 0 ? Math.max(0, Math.min(100, 2 * (strength + 100))) : strength;
  const word = q >= 70 ? tx("Strong") : q >= 40 ? tx("OK") : tx("Weak");
  return `${word} (${strength < 0 ? `${strength} dBm` : `${Math.round(strength)}%`})`;
}

export function usePodHealth() {
  return apiR.user.getPodHealth.useQuery(undefined, { retry: false, staleTime: 60_000 });
}

/** One quiet line for Home: online, plus priming or water only when they need attention. */
export const PodStatusStrip: React.FC = () => {
  const query = apiR.user.getPodHealth.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const h = query.data;
  if (!h) return null;
  const items: { text: string; tone?: "warn" | "live" }[] = [
    { text: h.online === false ? tx("Offline") : h.online ? tx("Online") : tx("Connection unknown"), tone: h.online === false ? "warn" : undefined },
    // "Primed X ago" lives in Settings → Pod health; Home only shows priming while it happens
    ...(h.priming
      ? [{ text: tx("Priming now…"), tone: "live" as const }]
      : h.needsPriming
      ? [{ text: tx("Needs priming"), tone: "warn" as const }]
      : []),
    ...(h.hasWater === false ? [{ text: tx("Water empty"), tone: "warn" as const }] : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
      {items.map((i) => (
        <span key={i.text} className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              i.tone === "warn" ? "bg-amber-500" : i.tone === "live" ? "animate-pulse bg-sky-400" : "bg-slate-400 dark:bg-slate-500"
            }`}
          />
          <span className={i.tone === "warn" ? "text-amber-600 dark:text-amber-400" : i.tone === "live" ? "text-sky-500 dark:text-sky-400" : ""}>{i.text}</span>
        </span>
      ))}
    </div>
  );
};

/**
 * Shown only when the other Eight Sleep account has dropped off the pod (its side now works
 * as a guest): offers to put it back. Nothing to show otherwise.
 */
export const OtherAccountNotice: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const mode = apiR.user.getBedMode.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const guest = apiR.user.getGuestSide.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const restore = apiR.user.restoreOtherAccount.useMutation({
    onSuccess: async (d) => {
      await Promise.all([utils.user.getGuestSide.invalidate(), utils.user.getPodHealth.invalidate()]);
      toast(d.ok ? tx("Other account is back on its side") : tx("Eight Sleep didn't let this login put it back"), d.ok ? "success" : "error");
    },
    onError: (e) => toast(e.message, "error"),
  });
  const otherMissing = !!mode.data?.otherSaved && guest.data?.supported && guest.data.kind === "guest";
  if (!otherMissing) return null;
  return (
    <div className="rounded-3xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="font-semibold">{tx("The other account is no longer on the pod. Its side now works as a guest.")}</p>
      <button
        type="button"
        onClick={() => restore.mutate()}
        disabled={restore.isPending}
        className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-600 px-3 font-bold text-white disabled:opacity-50"
      >
        {restore.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {tx("Try to put it back")}
      </button>
      {restore.data && !restore.data.ok && (
        <p className="mt-2">
          {tx("Eight Sleep refused ({how}). Open the Eight Sleep app on that account and pick the right side of this bed again.", { how: restore.data.log.join("; ") })}
        </p>
      )}
    </div>
  );
};

/** LED brightness, near the top of the Pod page. */
export const LedCard: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const query = usePodHealth();
  const current = query.data?.ledBrightnessLevel ?? null;
  const [led, setLed] = useState<number | null>(null);

  useEffect(() => {
    if (current !== null) setLed(current);
  }, [current]);

  const mutation = apiR.user.setLedBrightness.useMutation({
    onSuccess: async () => {
      await utils.user.getPodHealth.invalidate();
      toast(tx("LED brightness updated"));
    },
    onError: (e) => toast(e.message, "error"),
  });

  // a tap (or letting go of the slider) sets the light right away
  const apply = (v: number) => {
    setLed(v);
    if (v !== current) mutation.mutate({ level: v });
  };

  return (
    <Card>
      <CardHeader icon={<Lightbulb className="h-5 w-5" />} title={tx("Pod light")} subtitle={tx("Brightness of the LED on the hub")} />
      {query.isLoading ? (
        <Skeleton className="h-16" />
      ) : led === null ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Your pod didn&apos;t report an LED setting.</p>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-1.5">
            {[0, 25, 50, 75, 100].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => apply(v)}
                className={`h-11 rounded-xl text-xs font-bold transition active:scale-95 ${
                  led === v ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {v === 0 ? tx("Off") : `${v}%`}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={led}
            onChange={(e) => setLed(Number(e.target.value))}
            onPointerUp={(e) => apply(Number(e.currentTarget.value))}
            onKeyUp={(e) => apply(Number(e.currentTarget.value))}
            className="mt-3 h-2 w-full cursor-pointer accent-slate-400"
            aria-label="LED brightness"
          />
          {mutation.isPending && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {tx("Setting the light…")}
            </p>
          )}
        </>
      )}
    </Card>
  );
};

export const PodHealthCard: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const query = usePodHealth();
  const h = query.data;

  const prime = apiR.user.primePod.useMutation({
    onSuccess: async () => {
      await utils.user.getPodHealth.invalidate();
      toast(tx("Priming started. It takes a few minutes and is a bit noisy"));
    },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <>
      <Card>
        <CardHeader icon={<Stethoscope className="h-5 w-5" />} title={tx("Health")} subtitle={tx("Connection, water and priming")} />
        {query.isLoading ? (
          <Skeleton className="h-40" />
        ) : !h ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Couldn&apos;t read device info from Eight Sleep.</p>
        ) : (
          <>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <Row
                label={tx("Connection")}
                value={h.online === null ? tx("Unknown") : h.online ? tx("Online") : tx("Offline")}
                tone={h.online === null ? undefined : h.online ? "good" : "bad"}
              />
              <Row label={tx("Last heard from")} value={ago(h.lastSeen)} />
              <Row
                label={tx("Water")}
                value={h.hasWater === null ? tx("Unknown") : h.hasWater ? tx("OK") : tx("Empty, refill tank")}
                tone={h.hasWater === null ? undefined : h.hasWater ? "good" : "bad"}
              />
              <Row
                label={tx("Priming")}
                value={h.priming ? tx("In progress…") : h.needsPriming ? tx("Needed") : h.needsPriming === false ? tx("Not needed") : tx("Unknown")}
                tone={h.priming || h.needsPriming ? "warn" : h.needsPriming === false ? "good" : undefined}
              />
              <Row label={tx("Last prime")} value={`${date(h.lastPrime)} (${ago(h.lastPrime)})`} />
              {h.isAway !== null && <Row label={tx("Eight Sleep away mode")} value={h.isAway ? tx("On") : tx("Off")} tone={h.isAway ? "warn" : undefined} />}
            </div>
            <button
              type="button"
              disabled={prime.isPending || h.priming === true}
              onClick={() => {
                if (window.confirm(tx("Start priming now? The pod circulates water for a few minutes and can be noisy."))) {
                  prime.mutate();
                }
              }}
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 text-xs font-bold text-sky-800 transition active:scale-[0.98] disabled:opacity-50 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200"
            >
              {prime.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Droplets className="h-4 w-4" />}
              {h.priming ? tx("Priming…") : tx("Prime now")}
            </button>
          </>
        )}
      </Card>

      {h && (
        <Card>
          <CardHeader icon={<BedDouble className="h-5 w-5" />} title={tx("Both sides")} subtitle={tx("Live level of each side of the bed")} />
          <div className="grid grid-cols-2 gap-2">
            {h.sides.map((s) => (
              <div
                key={s.side}
                className={`rounded-2xl p-3 ${s.isYou ? "bg-indigo-50 ring-1 ring-indigo-300 dark:bg-indigo-950/40 dark:ring-indigo-800" : "bg-slate-50 dark:bg-slate-800/50"}`}
              >
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <span>{tx(s.side)}</span>
                  {s.isYou && <span className="text-indigo-600 dark:text-indigo-300">{tx("You")}</span>}
                </div>
                <div className="mt-1 text-xl font-black">{s.active ? formatLevel(s.level ?? 0) : tx("Off")}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {s.active && s.target !== null ? tx("target {level}", { level: formatLevel(s.target) }) : tx("not active")}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {h && (
        <Card>
          <CardHeader icon={<Wifi className="h-5 w-5" />} title={tx("Device")} />
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <Row label="Wi-Fi" value={h.wifiSsid ? `${h.wifiSsid} · ${wifiLabel(h.wifiStrength)}` : wifiLabel(h.wifiStrength)} />
            <Row label={tx("Firmware")} value={h.firmwareVersion ?? tx("Unknown")} />
            <Row label={tx("Your side")} value={tx(h.side)} />
            <Row label={tx("Features")} value={h.features.length ? h.features.join(", ") : "—"} />
            <Row label={tx("Device ID")} value={`…${h.deviceId.slice(-6)}`} />
          </div>
        </Card>
      )}
    </>
  );
};
