"use client";

import React, { useEffect, useRef, useState } from "react";
import { apiR } from "~/trpc/react";
import { useToast } from "~/components/ui/toast";
import { haptic } from "~/lib/clientStorage";
import { tick } from "~/lib/sounds";
import {
  Flame,
  Loader2,
  Minus,
  Plus,
  Power,
  Snowflake,
  Sparkles,
} from "lucide-react";
import { useT } from "~/lib/i18n";
import { useSide } from "~/components/sideContext";
import { useLevelFormat } from "~/lib/tempUnit";

const SEND_DELAY_MS = 1800; // wait for more taps before sending, so 3 taps = 1 change

/**
 * Manual pod control. − / + adjust the target; it's sent automatically once you stop
 * tapping (with a short, cancellable countdown), so nothing changes from a stray touch.
 * Drives the side picked on the top bar: Left, Right, or Both (whole bed).
 */
export const PodControl: React.FC<{ onSetUpSchedule?: () => void }> = ({
  onSetUpSchedule,
}) => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const t = useT();
  // levels or temperatures, as chosen in Settings → Preferences (one level or one degree per tap)
  const fmt = useLevelFormat();
  const levelText = (raw: number) => fmt.text(raw);
  const [pending, setPending] = useState<number | null>(null); // level waiting to be sent (Pod units, -100…100)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // In Both, the left side shows what the whole bed is doing
  const { selected } = useSide();
  const showSide = selected === "both" ? "left" : selected;
  const statusQuery = apiR.user.getPodStatus.useQuery(
    { side: showSide },
    { refetchInterval: 5_000 },
  );
  const status = statusQuery.data;
  const isOn = status?.isOn ?? false;
  const podTarget = status ? Math.round(status.targetHeatingLevel ?? status.heatingLevel) : 0;
  const shown = pending ?? podTarget;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const refresh = () =>
    Promise.all([
      utils.user.getPodStatus.invalidate(),
      utils.user.getPodHealth.invalidate(),
      utils.user.getAccount.invalidate(),
      utils.user.getGuestSide.invalidate(),
    ]);

  // a pending tap belongs to the side it was made on
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setPending(null);
  }, [selected]);

  const setLevel = apiR.user.setPodTargetLevel.useMutation({
    onSuccess: async (_d, vars) => {
      haptic(20);
      await refresh();
      setPending(null);
      toast(
        vars.side === "both"
          ? t("Both sides set to {level}", {
              level: levelText(vars.level),
            })
          : t("{side} side set to {level}", {
              side: t(vars.side ?? "left"),
              level: levelText(vars.level),
            }),
      );
    },
    onError: (e) => {
      setPending(null);
      toast(e.message, "error");
    },
  });
  const setPower = apiR.user.setPodPower.useMutation({
    onSuccess: async (_d, vars) => {
      haptic(20);
      await refresh();
      toast(
        vars.side === "both"
          ? vars.isOn
            ? t("Both sides on")
            : t("Both sides off")
          : vars.isOn
            ? t("{side} side on", { side: t(vars.side ?? "left") })
            : t("{side} side off", { side: t(vars.side ?? "left") }),
        "info",
      );
    },
    onError: (e) => toast(e.message, "error"),
  });
  const levelBusy = setLevel.isPending;
  const powerBusy = setPower.isPending;
  const power = (on: boolean) => setPower.mutate({ isOn: on, side: selected });

  /** waits `delay` ms for more changes, then sends the level once (3 taps = 1 change) */
  const schedule = (next: number, delay: number) => {
    setPending(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next === podTarget && isOn) {
        setPending(null);
        return;
      }
      setLevel.mutate({
        level: next,
        turnOn: !isOn ? true : undefined,
        side: selected,
      });
    }, delay);
  };

  const step = (delta: number) => {
    haptic();
    tick(delta > 0);
    schedule(fmt.step(shown, delta > 0 ? 1 : -1), SEND_DELAY_MS);
  };

  // Dragging the knob on the line under the number: follows the finger in whole steps, sent when let go
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const snap = (target: number, from: number) => {
    let cur = from;
    for (let i = 0; i < 220; i++) {
      const dir = target > cur ? 1 : -1;
      const next = fmt.step(cur, dir);
      if (next === cur || Math.abs(next - target) >= Math.abs(cur - target)) break;
      cur = next;
    }
    return cur;
  };
  const dragTo = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const raw = Math.max(-100, Math.min(100, ((clientX - r.left) / r.width) * 200 - 100));
    const next = snap(raw, shown);
    if (next !== shown) {
      // the same sound as pressing − / +, once for each step the knob moves
      tick(next > shown);
      haptic(5);
      if (timer.current) clearTimeout(timer.current);
      setPending(next);
    }
  };

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    setPending(null);
  };

  const tone = shown < 0 ? "cool" : shown > 0 ? "warm" : "neutral";
  // where the pod is now (on only), and the label above the number
  // where the Pod is right now (whole levels in Levels mode, as before)
  const now = isOn && status ? (fmt.mode === "levels" ? Math.round(status.heatingLevel / 10) * 10 : Math.round(status.heatingLevel)) : null;
  // the same wording either way: compare what's shown (a level or a whole degree)
  const sameAsNow = now !== null && levelText(now) === levelText(shown);
  const heading =
    now === null ? "" : sameAsNow ? t("At target") : shown > now ? t("Warming to") : t("Cooling to");
  const waiting = pending !== null && !levelBusy;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70">
      <div
        className={`pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full blur-3xl transition-colors duration-700 ${
          !isOn
            ? "bg-slate-500/5"
            : tone === "cool"
              ? "bg-cyan-500/20"
              : tone === "warm"
                ? "bg-amber-500/20"
                : "bg-indigo-500/15"
        }`}
      />

      {/* whole bed: whether its own schedule runs tonight, and a clear way to switch it */}
      {selected === "both" && <WholeBedPlan onSetUp={onSetUpSchedule} />}

      {/* Header: name + a power icon (gray off, green on); one tap turns it on or off */}
      <div className="relative flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
        <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-800 dark:text-slate-100">
          {t("Temperature")}
        </span>
        <button
          type="button"
          onClick={() => {
            haptic();
            power(!isOn);
          }}
          disabled={powerBusy || !status}
          aria-label={isOn ? t("Turn off") : t("Turn on")}
          className={`-m-1.5 flex h-9 w-9 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-50 ${
            isOn ? "text-power-500" : "text-slate-400 dark:text-slate-500"
          }`}
        >
          {powerBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Power className="h-5 w-5" />}
        </button>
      </div>

      {status && !isOn && pending === null ? (
        // Off: the whole area (number, − and +) turns it on
        <button
          type="button"
          onClick={() => power(true)}
          disabled={powerBusy}
          className="relative mt-5 block w-full transition active:scale-[0.98] disabled:opacity-60"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
              <Minus className="h-6 w-6" />
            </span>
            <span className="flex-1 text-center text-4xl font-extralight tracking-wider text-slate-400 dark:text-slate-500">
              {t("OFF")}
            </span>
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
              <Plus className="h-6 w-6" />
            </span>
          </span>
          <span className="mt-3 block text-center text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
            {t("Tap to turn on")}
          </span>
        </button>
      ) : (
        <>
          {/* where it's heading, above the number */}
          <p className="relative mt-4 h-4 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            {heading}
          </p>
          <div className="relative mt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={shown <= -100}
              aria-label={t("Cooler")}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-90 disabled:opacity-30 dark:bg-slate-800 dark:text-slate-200"
            >
              <Minus className="h-6 w-6" />
            </button>

            <div className="flex flex-1 flex-col items-center">
              <div className="flex items-center gap-1.5">
                {tone === "cool" ? (
                  <Snowflake className="h-4 w-4 text-cyan-500" />
                ) : tone === "warm" ? (
                  <Flame className="h-4 w-4 text-amber-500" />
                ) : (
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                )}
                <span
                  className={`text-5xl font-black tabular-nums ${
                    tone === "cool"
                      ? "text-cyan-600 dark:text-cyan-300"
                      : tone === "warm"
                        ? "text-orange-500 dark:text-orange-400"
                        : "text-slate-800 dark:text-slate-100"
                  }`}
                >
                  {levelText(shown)}
                </span>
              </div>
              {fmt.sub(shown) && <span className="text-xs font-bold text-slate-400">{fmt.sub(shown)}</span>}
            </div>

            <button
              type="button"
              onClick={() => step(1)}
              disabled={shown >= 100}
              aria-label={t("Warmer")}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-90 disabled:opacity-30 dark:bg-slate-800 dark:text-slate-200"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
          {/* where it is right now, below the number */}
          <p className="relative mt-1 h-4 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            {now !== null && !sameAsNow ? t("Currently at {level}", { level: levelText(now) }) : ""}
          </p>
          {/* Thin cool to warm line: ring = where it is now, bar = where it's set. Drag the bar to set it. */}
          <div className="relative mx-auto mt-2 w-full max-w-[11rem]">
            <div ref={trackRef} className="relative h-1.5 rounded-full bg-gradient-to-r from-cyan-400/70 via-slate-300 to-orange-400/70 dark:via-slate-700">
              {now !== null && (
                <span
                  className="pointer-events-none absolute -top-[3px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-slate-500 bg-white shadow transition-[left] duration-1000 dark:border-slate-300 dark:bg-slate-900"
                  style={{ left: `${((Math.max(-100, Math.min(100, status?.heatingLevel ?? 0)) + 100) / 200) * 100}%` }}
                  title={t("Now")}
                />
              )}
              {/* the knob: a big invisible hit area; only it captures touches, so the page still scrolls elsewhere */}
              <span
                role="slider"
                data-no-swipe
                tabIndex={0}
                aria-label={t("Temperature")}
                aria-valuemin={-100}
                aria-valuemax={100}
                aria-valuenow={shown}
                aria-valuetext={levelText(shown)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowUp") step(1);
                  if (e.key === "ArrowLeft" || e.key === "ArrowDown") step(-1);
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(true);
                }}
                onPointerMove={(e) => dragging && dragTo(e.clientX)}
                onPointerUp={() => {
                  setDragging(false);
                  schedule(shown, 600);
                }}
                onPointerCancel={() => {
                  setDragging(false);
                  schedule(shown, 600);
                }}
                className="absolute -top-[18px] flex h-10 w-10 -translate-x-1/2 cursor-grab items-center justify-center active:cursor-grabbing"
                style={{ left: `${((Math.max(-100, Math.min(100, shown)) + 100) / 200) * 100}%`, touchAction: "none" }}
              >
                <span className={`h-3.5 rounded-full bg-slate-900 shadow transition-all dark:bg-slate-100 ${dragging ? "w-2" : "w-1"}`} />
              </span>
            </div>
            <div className="mt-1 flex justify-between font-hud text-[9px] text-slate-400">
              <span>{fmt.short(-100)}</span>
              <span>{fmt.short(0)}</span>
              <span>{fmt.short(100)}</span>
            </div>
          </div>
        </>
      )}

      {/* Sending state: countdown bar + cancel (only while a change is on its way) */}
      {(levelBusy || waiting) && (
        <div className="relative mt-3 h-8">
          {levelBusy ? (
            <p className="flex h-8 items-center justify-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
              <Loader2 className="h-4 w-4 animate-spin" />{" "}
              {selected === "both"
                ? t("Sending {level} to both sides…", {
                    level: levelText(shown),
                  })
                : t("Sending {level} to the {side} side…", {
                    level: levelText(shown),
                    side: t(selected),
                  })}
            </p>
          ) : waiting ? (
            <div className="flex h-8 items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  key={pending}
                  className="h-full rounded-full bg-indigo-500"
                  style={{
                    animation: `podhub-countdown ${SEND_DELAY_MS}ms linear forwards`,
                  }}
                />
              </div>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {isOn
                  ? t("Setting {level}", { level: levelText(shown) })
                  : t("Turning on at {level}", { level: levelText(shown) })}
              </span>
              <button
                type="button"
                onClick={cancel}
                className="text-xs font-bold text-rose-600 dark:text-rose-400"
              >
                {t("Cancel")}
              </button>
            </div>
          ) : null}
        </div>
      )}
      <style>{`@keyframes podhub-countdown { from { width: 0% } to { width: 100% } }`}</style>
    </section>
  );
};

/** Whole bed view: is the whole-bed schedule running tonight? Switch it here (with a confirm). */
function WholeBedPlan({ onSetUp }: { onSetUp?: () => void }) {
  const toast = useToast();
  const utils = apiR.useUtils();
  const t = useT();
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  const setEnabled = apiR.user.setScheduleEnabled.useMutation({
    onSuccess: async (_d, vars) => {
      haptic(20);
      await Promise.all([utils.user.getAccount.invalidate(), utils.user.getUserTemperatureProfile.invalidate()]);
      toast(vars.enabled ? t("Whole-bed schedule on for tonight") : t("Back to each side's own schedule"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const w = account.data?.sides.both;
  if (!w) return null;
  const row = "relative mb-3 flex items-center justify-between gap-3 rounded-2xl bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800/60";
  if (!w.hasSchedule) {
    return (
      <div className={row}>
        <span className="text-slate-600 dark:text-slate-300">{t("No whole-bed schedule yet")}</span>
        <button type="button" onClick={onSetUp} className="font-bold text-slate-900 underline dark:text-slate-100">
          {t("Set it up")} ›
        </button>
      </div>
    );
  }
  return (
    <div className={row}>
      <span className="text-slate-600 dark:text-slate-300">
        {w.scheduleEnabled ? t("Whole-bed schedule runs tonight") : t("Each side follows its own schedule")}
      </span>
      <button
        type="button"
        disabled={setEnabled.isPending}
        onClick={() => {
          const on = !w.scheduleEnabled;
          if (
            window.confirm(
              on
                ? t("Use the whole-bed schedule tonight? Both sides follow it and the Left and Right schedules wait.")
                : t("Stop the whole-bed schedule? Each side goes back to its own schedule."),
            )
          )
            setEnabled.mutate({ enabled: on, side: "both" });
        }}
        className={`h-8 shrink-0 rounded-xl px-3 font-bold disabled:opacity-50 ${
          w.scheduleEnabled ? "border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200" : "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
        }`}
      >
        {w.scheduleEnabled ? t("Stop") : t("Use tonight")}
      </button>
    </div>
  );
}
