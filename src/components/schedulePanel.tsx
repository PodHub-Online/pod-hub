"use client";

import React from "react";
import { apiR } from "~/trpc/react";
import { TemperatureCurveGraph } from "~/components/temperatureCurveGraph";
import { TemperatureProfileForm } from "~/components/temperatureProfileForm";
import { PresetsPanel } from "~/components/presetsPanel";
import { useSide } from "~/components/sideContext";
import { useSideSwipe } from "~/components/useSideSwipe";
import { Locked, LockButton, useEditLock } from "~/components/editLock";
import { CompromiseCard } from "~/components/compromiseCard";
import { EightImportCard, WeekendCard } from "~/components/newFeatures";

/** Your night, presets and tonight's curve on one page. Greyed out and disabled while the schedule is off. */
export const SchedulePanel: React.FC = () => {
  const account = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  // "Follow schedule" and the manual pause of the side on the top bar (Both follows Left)
  const { scheduleSide: side } = useSide();
  const st = account.data?.sides[side] ?? { scheduleEnabled: true, manualHoldUntil: null, hasSchedule: false };
  // greyed out = not in use AND locked (same for all three); unlocking brings the colors back
  const { unlocked } = useEditLock();
  const off = !!account.data && !st.scheduleEnabled && !unlocked;
  const { deck, handlers } = useSideSwipe();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <LockButton />
      </div>
      {/* swipe sideways to switch side, like Home (clipped so it slides off the edge) */}
      <div className="overflow-x-clip">
        <div ref={deck} {...handlers} className="space-y-5 will-change-transform" style={{ touchAction: "pan-y" }}>
          {/* set-and-forget: read-only until you hold the lock; a fresh form per side */}
          {side === "both" && (
            <Locked>
              <CompromiseCard />
            </Locked>
          )}
          <EightImportCard />
          <Locked>
            <TemperatureProfileForm key={side} />
          </Locked>
          {side !== "both" && (
            <Locked>
              <WeekendCard key={`weekend-${side}`} />
            </Locked>
          )}
          <div
            aria-disabled={off}
            className={off ? "pointer-events-none select-none space-y-5 opacity-60 grayscale dark:opacity-45 transition" : "space-y-5 transition"}
          >
            <Locked>
              <PresetsPanel />
            </Locked>
            <TemperatureCurveGraph />
          </div>
        </div>
      </div>
    </div>
  );
};
