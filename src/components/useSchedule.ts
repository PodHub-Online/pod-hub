"use client";

import { useMemo } from "react";
import { apiR } from "~/trpc/react";
import { matchPreset, type PresetDescriptor, type ScheduleValues } from "~/lib/presets";
import { useSide } from "~/components/sideContext";

/** Saved schedule of the side on the top bar + all presets + which preset (if any) it matches. */
export function useSchedule() {
  const { scheduleSide: side } = useSide();
  const profileQuery = apiR.user.getUserTemperatureProfile.useQuery({ side }, { retry: 1 });
  const presetsQuery = apiR.user.listPresets.useQuery(undefined, { retry: 1 });

  const profile = profileQuery.data ?? null;

  const savedValues: ScheduleValues | null = useMemo(
    () =>
      profile
        ? {
            bedTime: profile.bedTime,
            wakeupTime: profile.wakeupTime,
            midStageSleepLevelStartTime: profile.midStageSleepLevelStartTime,
            finalSleepLevelStartTime: profile.finalSleepLevelStartTime,
            initialSleepLevel: profile.initialSleepLevel,
            midStageSleepLevel: profile.midStageSleepLevel,
            finalSleepLevel: profile.finalSleepLevel,
            wakeupAlarmEnabled: profile.wakeupAlarmEnabled,
            wakeupAlarmLevel: profile.wakeupAlarmLevel,
            wakeupAlarmLeadMinutes: profile.wakeupAlarmLeadMinutes,
            preWakeEnabled: profile.preWakeEnabled,
            preWakeLevel: profile.preWakeLevel,
            preWakeLeadMinutes: profile.preWakeLeadMinutes,
            preheatLeadMinutes: profile.preheatLeadMinutes ?? 60,
            offStages: profile.offStages ?? 0,
          }
        : null,
    [profile],
  );

  const allPresets: PresetDescriptor[] = useMemo(() => presetsQuery.data ?? [], [presetsQuery.data]);

  const activePreset = useMemo(() => matchPreset(savedValues, allPresets), [savedValues, allPresets]);

  return {
    side,
    profile,
    savedValues,
    allPresets,
    activePreset,
    isLoading: profileQuery.isLoading || presetsQuery.isLoading,
    profileQuery,
    presetsQuery,
  };
}
