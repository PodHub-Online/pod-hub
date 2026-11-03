"use client";

import React from "react";
import { apiR } from "~/trpc/react";
import { useSide, type SelectedSide } from "~/components/sideContext";
import { BedGlyph } from "~/components/sideBar";
import { useScheduleStatus } from "~/components/sideStatus";
import { formatLevel } from "~/lib/presets";
import { tx } from "~/lib/i18n";

/** Name of a deck position: "Left · you", "Right · other", "Whole bed". */
export function useSideName() {
  const { own, otherKind } = useSide();
  return (side: SelectedSide) => {
    if (side === "both") return tx("Whole bed");
    const who = side === own ? tx("you") : otherKind === "guest" ? tx("guest") : tx("other");
    return `${tx(side === "left" ? "Left" : "Right")} · ${who}`;
  };
}

/**
 * The next (or previous) view, shown at the edge of the deck while swiping, so it's clear
 * where the swipe is going: big side name plus its on/off and schedule state.
 */
export const SidePeek: React.FC<{ side: SelectedSide; edge: "left" | "right" }> = ({ side, edge }) => {
  const name = useSideName();
  const health = apiR.user.getPodHealth.useQuery(undefined, { retry: false, staleTime: 10_000 });
  const scheduleStatus = useScheduleStatus();
  const showSide = side === "both" ? "left" : side;
  const st = health.data?.sides.find((s) => s.side === showSide);
  const sc = scheduleStatus(showSide, !!st?.active);
  return (
    <div
      aria-hidden
      className="absolute top-0 !mt-0 flex h-full w-full flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-900/95"
      style={edge === "right" ? { left: "calc(100% + 16px)" } : { right: "calc(100% + 16px)" }}
    >
      {/* the same little bed as the picker, big: which side you're swiping to */}
      <span className="text-slate-900 dark:text-slate-100">
        <BedGlyph fill={side} size={96} />
      </span>
      <span className="sr-only">{name(side)}</span>
      <p className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400">
        <span className={`h-2 w-2 rounded-full ${st?.active ? "bg-power-500" : "bg-slate-400"}`} />
        {st?.active ? `${tx("On")} · ${formatLevel(st.target ?? st.level ?? 0)}` : tx("Off")}
        {sc && <span>· {sc.text}</span>}
      </p>
    </div>
  );
};
