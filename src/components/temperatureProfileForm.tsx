"use client";
import React, { useState, useEffect, useRef } from "react";
import { useForm, Controller, type Control, type FieldError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiR } from "~/trpc/react";
import { useToast } from "~/components/ui/toast";
import { Skeleton } from "~/components/ui/card";
import { useSchedule } from "~/components/useSchedule";
import { ALARM_LEAD_OPTIONS, matchPreset, OFF, preheatLabel, PREHEAT_LEAD_OPTIONS, PRE_WAKE_LEAD_OPTIONS, type OffStage, type ScheduleValues } from "~/lib/presets";
import { useLevelFormat } from "~/lib/tempUnit";
import { ALL_DAYS, isDayActive, toggleDay, WEEK } from "~/lib/schedule";
import { useEditLock } from "~/components/editLock";
import { FollowNotice, FollowToggle } from "~/components/scheduleStatus";
import { ScheduleZoneBanner, ScheduleZoneNote } from "~/components/scheduleZone";
import { Check, ChevronDown, Minus, Moon, Plus, Save, SlidersHorizontal, Sun, Trash2 } from "lucide-react";
import { tx, txLocale } from "~/lib/i18n";

/** Weekday name in the app language; day 0 = Sunday */
const dayName = (day: number, width: "narrow" | "short" | "long") =>
  new Date(2024, 0, 7 + day).toLocaleDateString(txLocale(), { weekday: width });

const temperatureProfileSchema = z.object({
  bedTime: z.string().regex(/^\d{2}:\d{2}$/, tx("Must be in HH:MM format")),
  wakeupTime: z.string().regex(/^\d{2}:\d{2}$/, tx("Must be in HH:MM format")),
  midStageSleepLevelStartTime: z.string().regex(/^\d{2}:\d{2}$/, tx("Must be in HH:MM format")),
  finalSleepLevelStartTime: z.string().regex(/^\d{2}:\d{2}$/, tx("Must be in HH:MM format")),
  initialSleepLevel: z.number().min(-100).max(100),
  midStageSleepLevel: z.number().min(-100).max(100),
  finalSleepLevel: z.number().min(-100).max(100),
  wakeupAlarmEnabled: z.boolean(),
  wakeupAlarmLevel: z.number().min(-100).max(100),
  wakeupAlarmLeadMinutes: z.number().min(5).max(60),
  preWakeEnabled: z.boolean(),
  preWakeLevel: z.number().min(-100).max(100),
  preWakeLeadMinutes: z.number().min(5).max(180),
  preheatLeadMinutes: z.number().min(0).max(180),
  activeDays: z.number().int().min(0).max(127),
  offStages: z.number().int().min(0).max(15),
  timezone: z.object({
    value: z.string(),
    altName: z.string().optional(),
    abbrev: z.string().optional(),
  }),
});

type TemperatureProfileForm = z.infer<typeof temperatureProfileSchema>;

// Wait this long after the last change before saving it
const AUTOSAVE_MS = 1500;

type LevelField = "initialSleepLevel" | "midStageSleepLevel" | "finalSleepLevel" | "preWakeLevel" | "wakeupAlarmLevel";

/** Form values → API/preset values. Levels are the Pod's own -100..100 (one degree can sit between two levels). */
function formToSchedule(data: TemperatureProfileForm): ScheduleValues {
  return {
    bedTime: data.bedTime,
    wakeupTime: data.wakeupTime,
    midStageSleepLevelStartTime: data.midStageSleepLevelStartTime,
    finalSleepLevelStartTime: data.finalSleepLevelStartTime,
    initialSleepLevel: Math.round(data.initialSleepLevel),
    midStageSleepLevel: Math.round(data.midStageSleepLevel),
    finalSleepLevel: Math.round(data.finalSleepLevel),
    wakeupAlarmEnabled: data.wakeupAlarmEnabled,
    wakeupAlarmLevel: Math.round(data.wakeupAlarmLevel),
    wakeupAlarmLeadMinutes: data.wakeupAlarmLeadMinutes,
    preWakeEnabled: data.preWakeEnabled,
    preWakeLevel: Math.round(data.preWakeLevel),
    preWakeLeadMinutes: data.preWakeLeadMinutes,
    preheatLeadMinutes: data.preheatLeadMinutes,
    offStages: data.offStages,
  };
}

/** What a save would store, as one string: equal strings mean nothing new to save. */
const scheduleKey = (data: TemperatureProfileForm) => JSON.stringify([formToSchedule(data), data.activeDays, data.timezone?.value]);

// Compact − value + [Off] row for one level, shown as a Pod level or a temperature (Settings →
// Preferences). Lives outside the form so it isn't re-created each render.
const LevelRow: React.FC<{
  name: LevelField;
  label: string;
  hint?: string;
  control: Control<TemperatureProfileForm>;
  error?: FieldError;
  disabled?: boolean;
  /** unticked: the stage doesn't run (its level is kept for when it's ticked again) */
  off?: boolean;
  onToggleOff?: () => void;
  /** what the row says while unticked (default: "Bed off · …") */
  offHint?: string;
}> = ({ name, label, hint, control, error, disabled, off, onToggleOff, offHint }) => {
  const fmt = useLevelFormat();
  return (
    <Controller
      name={name}
      control={control}
      render={({ field: { onChange, value } }) => {
        const locked = (disabled ?? false) || !!off;
        const sub = off ? null : fmt.sub(value);
        return (
          <div className="flex items-center gap-2 py-2.5">
            {onToggleOff && (
              // tick = this stage runs; empty circle = it doesn't
              <button
                type="button"
                role="checkbox"
                aria-checked={!off}
                aria-label={label}
                onClick={onToggleOff}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${
                  off ? "border-2 border-slate-300 dark:border-slate-600" : "bg-emerald-500 text-white dark:text-emerald-950"
                }`}
              >
                {!off && <Check className="h-4 w-4" strokeWidth={3} />}
              </button>
            )}
            <div className={`min-w-0 flex-1 ${disabled && !off ? "opacity-40" : ""}`}>
              <div className={`text-sm font-bold ${off ? "text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-100"}`}>{label}</div>
              {hint && <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{off ? offHint ?? `${tx("Bed off")} · ${hint}` : hint}</div>}
              {error && <div className="text-[11px] text-rose-500">{error.message}</div>}
            </div>
            <button
              type="button"
              aria-label={tx("{what}: cooler", { what: label })}
              disabled={locked || value <= -100}
              onClick={() => onChange(fmt.step(value, -1))}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition active:scale-90 disabled:opacity-30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Minus className="h-5 w-5" />
            </button>
            <span className={`w-16 shrink-0 text-center leading-tight ${disabled && !off ? "opacity-40" : ""}`}>
              <span
                className={`block font-black tabular-nums ${off ? "text-base text-slate-400 dark:text-slate-500" : fmt.mode === "levels" ? "text-2xl" : "text-xl"} ${
                  off ? "" : value < 0 ? "text-cyan-600 dark:text-cyan-300" : value > 0 ? "text-orange-500 dark:text-orange-400" : "text-slate-700 dark:text-slate-200"
                }`}
              >
                {off ? tx("Off") : fmt.text(value)}
              </span>
              {sub && <span className="block text-[10px] font-bold text-slate-400">{sub}</span>}
            </span>
            <button
              type="button"
              aria-label={tx("{what}: warmer", { what: label })}
              disabled={locked || value >= 100}
              onClick={() => onChange(fmt.step(value, 1))}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition active:scale-90 disabled:opacity-30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        );
      }}
    />
  );
};

/** label on the left, control on the right */
function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[48px] items-center justify-between gap-3 py-2">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </div>
  );
}

export const TemperatureProfileForm: React.FC = () => {
  const toast = useToast();
  const [sleepDurationError, setSleepDurationError] = useState<string | null>(null);
  const [fineTune, setFineTune] = useState(false);
  const [daysOpen, setDaysOpen] = useState(false);

  // Auto-detect browser timezone
  const detectedTimezone =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York";

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<TemperatureProfileForm>({
    resolver: zodResolver(temperatureProfileSchema),
    defaultValues: {
      bedTime: "23:00",
      wakeupTime: "07:00",
      midStageSleepLevelStartTime: "00:30",
      finalSleepLevelStartTime: "05:30",
      initialSleepLevel: -10,
      midStageSleepLevel: -20,
      finalSleepLevel: 0,
      wakeupAlarmEnabled: true,
      wakeupAlarmLevel: 20,
      wakeupAlarmLeadMinutes: 15,
      preWakeEnabled: true,
      preWakeLevel: 10,
      preWakeLeadMinutes: 60,
      preheatLeadMinutes: 60,
      activeDays: ALL_DAYS,
      offStages: 0,
      timezone: { value: detectedTimezone },
    },
  });

  const bedTime = watch("bedTime");
  const wakeupTime = watch("wakeupTime");
  const wakeupAlarmEnabled = watch("wakeupAlarmEnabled");
  const wakeupAlarmLeadMinutes = watch("wakeupAlarmLeadMinutes");
  const preWakeLeadMinutes = watch("preWakeLeadMinutes");
  const preWakeEnabled = watch("preWakeEnabled");
  const preheatLeadMinutes = watch("preheatLeadMinutes");
  const initialSleepLevel = watch("initialSleepLevel");
  const midStart = watch("midStageSleepLevelStartTime");
  const finalStart = watch("finalSleepLevelStartTime");
  const activeDays = watch("activeDays");
  const offStages = watch("offStages") ?? 0;
  const offProps = (stage: OffStage) => ({
    off: (offStages & OFF[stage]) !== 0,
    onToggleOff: () => setValue("offStages", offStages ^ OFF[stage], { shouldDirty: true }),
  });
  const allValues = watch();

  const utils = apiR.useUtils();
  const { profile, profileQuery, allPresets, activePreset, side } = useSchedule();
  const accountQuery = apiR.user.getAccount.useQuery(undefined, { refetchInterval: 60_000 });
  // greyed out = not in use AND locked (same for Left, Right and Whole bed); unlocking brings the colors back
  const { unlocked } = useEditLock();
  const scheduleOff = !!accountQuery.data && !accountQuery.data.sides[side].scheduleEnabled && !unlocked;
  const isExistingProfile = !!profile;

  // The schedule as last saved; anything different on screen is waiting to save
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const valuesKey = allValues.bedTime ? scheduleKey(allValues) : null;
  const unsaved = savedKey !== null && valuesKey !== savedKey;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;

  // Load the saved schedule into the form. Changes not saved yet win: a save that lands
  // mid-edit doesn't undo the newer taps.
  useEffect(() => {
    if (!profile || unsavedRef.current) return;
    const loaded: TemperatureProfileForm = {
      bedTime: profile.bedTime.slice(0, 5),
      wakeupTime: profile.wakeupTime.slice(0, 5),
      midStageSleepLevelStartTime: profile.midStageSleepLevelStartTime?.slice(0, 5) ?? "23:00",
      finalSleepLevelStartTime: profile.finalSleepLevelStartTime?.slice(0, 5) ?? "05:00",
      initialSleepLevel: profile.initialSleepLevel,
      midStageSleepLevel: profile.midStageSleepLevel,
      finalSleepLevel: profile.finalSleepLevel,
      wakeupAlarmEnabled: profile.wakeupAlarmEnabled ?? false,
      wakeupAlarmLevel: profile.wakeupAlarmLevel ?? 30,
      wakeupAlarmLeadMinutes: profile.wakeupAlarmLeadMinutes ?? 15,
      preWakeEnabled: profile.preWakeEnabled ?? false,
      preWakeLevel: profile.preWakeLevel ?? 10,
      preWakeLeadMinutes: profile.preWakeLeadMinutes ?? 60,
      preheatLeadMinutes: profile.preheatLeadMinutes ?? 60,
      activeDays: profile.activeDays ?? ALL_DAYS,
      offStages: profile.offStages ?? 0,
      timezone: { value: profile.timezoneTZ || detectedTimezone },
    };
    reset(loaded);
    setSavedKey(scheduleKey(loaded));
  }, [profile, reset, detectedTimezone]);

  // At least 4 hours in bed
  const durationMin = (() => {
    const [bh = 0, bm = 0] = (bedTime ?? "00:00").split(":").map(Number);
    const [wh = 0, wm = 0] = (wakeupTime ?? "00:00").split(":").map(Number);
    return ((wh * 60 + wm - (bh * 60 + bm)) % 1440 + 1440) % 1440 || 1440;
  })();
  useEffect(() => {
    setSleepDurationError(durationMin < 240 ? tx("At least 4 hours between in bed and wake up.") : null);
  }, [durationMin]);

  const [justSaved, setJustSaved] = useState(false);
  const updateProfileMutation = apiR.user.updateUserTemperatureProfile.useMutation({
    onSuccess: async () => {
      // the first save creates the schedule, so say so; later ones show "Saved" in the header
      if (!isExistingProfile) toast(tx("Schedule saved"));
      setJustSaved(true);
      await utils.user.getUserTemperatureProfile.invalidate();
    },
    onError: (error) => toast(error.message, "error"),
  });

  const deleteProfileMutation = apiR.user.deleteUserTemperatureProfile.useMutation({
    onSuccess: async () => {
      reset();
      await utils.user.getUserTemperatureProfile.invalidate();
      toast(tx("Schedule cleared"), "info");
    },
    onError: (error) => toast(error.message, "error"),
  });

  const onSubmit = (data: TemperatureProfileForm) => {
    if (sleepDurationError) return;
    const formatTimeForAPI = (time: string) => `${time}:00.000000`;
    const values = formToSchedule(data);
    const sent = scheduleKey(data);
    lastTried.current = sent;
    updateProfileMutation.mutate(
      {
        ...values,
        bedTime: formatTimeForAPI(values.bedTime),
        wakeupTime: formatTimeForAPI(values.wakeupTime),
        midStageSleepLevelStartTime: formatTimeForAPI(values.midStageSleepLevelStartTime),
        finalSleepLevelStartTime: formatTimeForAPI(values.finalSleepLevelStartTime),
        timezoneTZ: data.timezone.value,
        activeDays: data.activeDays,
        side,
      },
      // what was sent is now the saved schedule; taps made while it was saving save next
      { onSuccess: () => setSavedKey(sent) },
    );
  };

  // Changes save by themselves a moment after the last tap (one save per burst of taps, so
  // Eight Sleep only hears about the final schedule). A failed save waits for the next change.
  const lastTried = useRef<string | null>(null);
  useEffect(() => {
    if (!isExistingProfile || !unsaved || sleepDurationError || updateProfileMutation.isPending) return;
    if (valuesKey === lastTried.current) return;
    const t = setTimeout(() => void handleSubmit(onSubmit)(), AUTOSAVE_MS);
    return () => clearTimeout(t);
    // onSubmit reads the latest values through handleSubmit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey, unsaved, isExistingProfile, sleepDurationError, updateProfileMutation.isPending]);

  // Leaving the tab, switching side or putting the app away saves what's waiting right away
  const flush = useRef<() => void>(() => undefined);
  flush.current = () => {
    if (!isExistingProfile || !unsavedRef.current || sleepDurationError) return;
    if (valuesKey === lastTried.current) return;
    void handleSubmit(onSubmit)();
  };
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush.current();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush.current();
    };
  }, []);

  // "Saved" shows for a couple of seconds after each save
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(t);
  }, [justSaved]);

  if (profileQuery.isLoading) {
    return <Skeleton className="h-96" />;
  }

  // Which preset the form currently matches (updates live while editing)
  const formPreset = allValues.bedTime ? matchPreset(formToSchedule(allValues), allPresets) : null;
  const shownPreset = isDirty ? formPreset : activePreset;

  const hhmm = (total: number) =>
    `${String(Math.floor((((total % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String((((total % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
  const [bH = 22, bM = 0] = bedTime.split(":").map(Number);
  const [wH = 6, wM = 0] = wakeupTime.split(":").map(Number);
  const leadMin = preheatLeadMinutes ?? 60;
  const preHeatTimeStr = hhmm(bH * 60 + bM - leadMin);
  const alarmStartStr = hhmm(wH * 60 + wM - (wakeupAlarmLeadMinutes ?? 30));
  // Pre-wake starts its minutes before wake-up and ends where the warmth starts (or at wake-up when the alarm is off)
  const warmStartStr = wakeupAlarmEnabled ? alarmStartStr : wakeupTime;
  const preWakeTooShort = !!preWakeEnabled && (preWakeLeadMinutes ?? 60) <= (wakeupAlarmEnabled ? (wakeupAlarmLeadMinutes ?? 15) : 0);
  const preWakeOn = !!preWakeEnabled && !preWakeTooShort;
  const preWakeStr = hhmm(wH * 60 + wM - (preWakeLeadMinutes ?? 60));
  const leadLabel = tx(preheatLabel(initialSleepLevel ?? 0));
  const mask = activeDays ?? ALL_DAYS;
  const daysSummary =
    mask === ALL_DAYS
      ? tx("Every night")
      : mask === 0
      ? tx("No nights")
      : mask === 0b0111110
      ? tx("Mon–Fri")
      : mask === 0b1000001
      ? tx("Weekends")
      : WEEK.filter((d) => isDayActive(mask, d.day))
          .map((d) => dayName(d.day, "short"))
          .join(", ");
  const durationStr = `${Math.floor(durationMin / 60)}h ${String(durationMin % 60).padStart(2, "0")}m`;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="w-full rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/70"
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-black tracking-tight text-slate-900 dark:text-slate-200">
            {side === "both" ? tx("Whole bed's night") : side === "left" ? tx("Left side's night") : tx("Right side's night")}
            {isExistingProfile && (unsaved || updateProfileMutation.isPending) ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                {tx("Saving…")}
              </span>
            ) : justSaved ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                <Check className="h-3 w-3" />
                {tx("Saved")}
              </span>
            ) : null}
          </h2>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {shownPreset ? tx("Preset: {name}", { name: shownPreset.name }) : isExistingProfile || isDirty ? tx("Your own schedule") : tx("Not saved yet")}
          </p>
          <button
            type="button"
            onClick={() => setDaysOpen((v) => !v)}
            aria-expanded={daysOpen}
            aria-label={tx("Nights: {days}. Tap to edit", { days: daysSummary })}
            className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400"
          >
            <span className="flex gap-1">
              {WEEK.map((d) => (
                <span
                  key={d.day}
                  className={`h-1.5 w-1.5 rounded-full ${isDayActive(mask, d.day) ? "bg-slate-800 dark:bg-slate-200" : "bg-slate-300 dark:bg-slate-700"}`}
                />
              ))}
            </span>
            {daysSummary} · {daysOpen ? tx("done") : tx("edit")}
          </button>
        </div>
        <FollowToggle />
      </div>
      <FollowNotice />
      <ScheduleZoneBanner className="mb-3" />
      <ScheduleZoneNote className="mb-3" />
      {/* Greyed out and disabled while the schedule is off */}
      <div
        aria-disabled={scheduleOff}
        className={scheduleOff ? "pointer-events-none select-none opacity-60 grayscale dark:opacity-45 transition" : "transition"}
      >

      {/* Nights the schedule runs (opened from the dots in the header) */}
      {daysOpen && (
      <div className="mb-3 flex items-center justify-between gap-1.5" role="group" aria-label={tx("Nights the schedule runs")}>
        {WEEK.map((d) => {
          const on = isDayActive(activeDays ?? ALL_DAYS, d.day);
          return (
            <button
              key={d.day}
              type="button"
              aria-pressed={on}
              aria-label={dayName(d.day, "long")}
              title={dayName(d.day, "long")}
              onClick={() => setValue("activeDays", toggleDay(activeDays ?? ALL_DAYS, d.day), { shouldDirty: true })}
              className={`h-8 flex-1 rounded-full text-[11px] font-black transition active:scale-90 ${
                on
                  ? "bg-slate-700 text-white dark:bg-slate-600 dark:text-slate-100"
                  : "border border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-600"
              }`}
            >
              {dayName(d.day, "narrow")}
            </button>
          );
        })}
      </div>
      )}

      {/* In bed → wake up, one compact row */}
      <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
        <label className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <Moon className="h-3 w-3" /> {tx("In bed")}
          </span>
          <input
            {...register("bedTime")}
            type="time"
            style={{ colorScheme: "light dark" }}
            className="block w-full bg-transparent text-xl font-black text-slate-900 focus:outline-none dark:text-slate-200"
          />
        </label>
        <div className="flex shrink-0 flex-col items-center px-1">
          <span className={`text-[11px] font-bold ${sleepDurationError ? "text-rose-600" : "text-slate-500 dark:text-slate-400"}`}>
            {sleepDurationError ? "< 4h" : durationStr}
          </span>
          <span className="mt-0.5 h-px w-12 bg-slate-300 dark:bg-slate-700" />
        </div>
        <label className="min-w-0 flex-1 text-right">
          <span className="flex items-center justify-end gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {tx("Wake up")} <Sun className="h-3 w-3" />
          </span>
          <input
            {...register("wakeupTime")}
            type="time"
            style={{ colorScheme: "light dark" }}
            className="block w-full bg-transparent text-right text-xl font-black text-slate-900 focus:outline-none dark:text-slate-200"
          />
        </label>
      </div>
      {sleepDurationError && <p className="mt-1 px-1 text-[11px] font-semibold text-rose-600">{sleepDurationError}</p>}

      {/* The night, stage by stage: a tick turns each one on or off */}
      <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200/80 px-3 dark:divide-slate-800 dark:border-slate-800">
        <LevelRow
          name="initialSleepLevel"
          label={tx("Falling asleep")}
          hint={tx("From {time}", { time: leadMin > 0 ? preHeatTimeStr : bedTime })}
          control={control}
          error={errors.initialSleepLevel}
          {...offProps("initial")}
        />
        <LevelRow name="midStageSleepLevel" label={tx("Deep sleep")} hint={tx("From {time}", { time: midStart })} control={control} error={errors.midStageSleepLevel} {...offProps("mid")} />
        <LevelRow
          name="finalSleepLevel"
          label={tx("Late sleep")}
          hint={tx("From {from} until {to}", { from: finalStart, to: preWakeOn ? preWakeStr : warmStartStr })}
          control={control}
          error={errors.finalSleepLevel}
          {...offProps("final")}
        />
        {/* Pre-wake unticked: no pre-wake step, late sleep runs on (as its switch did) */}
        <LevelRow
          name="preWakeLevel"
          label={tx("Pre-wake")}
          hint={
            preWakeTooShort
              ? tx("Starts after the wake-up warmth: make it earlier in Fine-tune")
              : tx("From {from} until {to}", { from: preWakeStr, to: warmStartStr })
          }
          control={control}
          error={errors.preWakeLevel}
          disabled={preWakeTooShort}
          off={!preWakeEnabled || (offStages & OFF.prewake) !== 0}
          offHint={
            // ticked but set to "bed off": the bed really is off for this stretch; unticked: Late sleep just runs on
            preWakeEnabled && !preWakeTooShort
              ? tx("Bed off from {from} until {to}", { from: preWakeStr, to: warmStartStr })
              : tx("Off: Late sleep runs until {time}", { time: warmStartStr })
          }
          onToggleOff={() => {
            const on = !!preWakeEnabled && (offStages & OFF.prewake) === 0;
            setValue("preWakeEnabled", !on, { shouldDirty: true });
            // a Pre-wake set to "bed off" earlier comes back as a normal Pre-wake
            if (offStages & OFF.prewake) setValue("offStages", offStages & ~OFF.prewake, { shouldDirty: true });
          }}
        />
        {/* Waking up unticked: no warmth, the bed just turns off at wake-up (as the alarm switch did) */}
        <LevelRow
          name="wakeupAlarmLevel"
          label={tx("Waking up")}
          hint={tx("From {from} until {to}", { from: alarmStartStr, to: wakeupTime })}
          control={control}
          error={errors.wakeupAlarmLevel}
          off={!wakeupAlarmEnabled}
          offHint={tx("Off: the bed just turns off at {time}", { time: wakeupTime })}
          onToggleOff={() => setValue("wakeupAlarmEnabled", !wakeupAlarmEnabled, { shouldDirty: true })}
        />
      </div>

      {/* Fine-tune: a plain list of settings */}
      <button
        type="button"
        onClick={() => setFineTune((v) => !v)}
        className="mt-3 flex w-full items-center justify-between px-1 py-2 text-sm font-bold text-slate-600 dark:text-slate-300"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-slate-400" /> {tx("Fine-tune")}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${fineTune ? "rotate-180" : ""}`} />
      </button>

      {fineTune && (
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 px-3 text-sm dark:divide-slate-800 dark:border-slate-800">
          <SettingRow label={tx("{what} before bed", { what: leadLabel })}>
            <select
              value={leadMin}
              onChange={(e) => setValue("preheatLeadMinutes", Number(e.target.value), { shouldDirty: true })}
              className="rounded-lg bg-transparent py-1 text-right font-bold text-slate-900 focus:outline-none dark:text-slate-200"
            >
              {PREHEAT_LEAD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? tx("Off") : `${m} min`}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label={tx("Deep sleep starts")}>
            <input
              {...register("midStageSleepLevelStartTime")}
              type="time"
              style={{ colorScheme: "light dark" }}
              className="bg-transparent text-right font-bold text-slate-900 focus:outline-none dark:text-slate-200"
            />
          </SettingRow>
          <SettingRow label={tx("Late sleep starts")}>
            <input
              {...register("finalSleepLevelStartTime")}
              type="time"
              style={{ colorScheme: "light dark" }}
              className="bg-transparent text-right font-bold text-slate-900 focus:outline-none dark:text-slate-200"
            />
          </SettingRow>
          {wakeupAlarmEnabled && (
            <SettingRow label={tx("Alarm starts before wake up")}>
              <select
                value={wakeupAlarmLeadMinutes ?? 15}
                onChange={(e) => setValue("wakeupAlarmLeadMinutes", Number(e.target.value), { shouldDirty: true })}
                className="rounded-lg bg-transparent py-1 text-right font-bold text-slate-900 focus:outline-none dark:text-slate-200"
              >
                {ALARM_LEAD_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </SettingRow>
          )}
          {preWakeEnabled && (
            <SettingRow label={tx("Pre-wake starts before wake up")}>
              <select
                value={preWakeLeadMinutes ?? 60}
                onChange={(e) => setValue("preWakeLeadMinutes", Number(e.target.value), { shouldDirty: true })}
                className="rounded-lg bg-transparent py-1 text-right font-bold text-slate-900 focus:outline-none dark:text-slate-200"
              >
                {PRE_WAKE_LEAD_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`}
                  </option>
                ))}
              </select>
            </SettingRow>
          )}
          {isExistingProfile && (
            <div className="py-3">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(tx("Clear your schedule? The pod will stop being automated."))) deleteProfileMutation.mutate({ side });
                }}
                disabled={deleteProfileMutation.isPending}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 disabled:opacity-50 dark:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" /> {tx("Clear schedule")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* A new schedule starts with one tap; after that, every change saves by itself */}
      {!isExistingProfile && (
        <div className="mt-4">
          <button
            type="submit"
            disabled={updateProfileMutation.isPending || !!sleepDurationError}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/25 transition active:scale-[0.98] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {updateProfileMutation.isPending ? tx("Saving…") : tx("Save schedule")}
          </button>
        </div>
      )}

      </div>

    </form>
  );
};
