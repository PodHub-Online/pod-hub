"use client";

import React, { useEffect, useState } from "react";
import { apiR } from "~/trpc/react";
import { Skeleton } from "~/components/ui/card";
import { useToast } from "~/components/ui/toast";
import { useSchedule } from "~/components/useSchedule";
import { preheatLabel, stageLevel, type PresetDescriptor, type ScheduleValues } from "~/lib/presets";
import { useLevelFormat } from "~/lib/tempUnit";
import { formatDuration, sleepDurationMinutes } from "~/lib/schedule";
import { haptic } from "~/lib/clientStorage";
import {
  Bookmark,
  BookmarkPlus,
  Check,
  Copy,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { tx } from "~/lib/i18n";
import { useEditLock } from "~/components/editLock";

const detectTimezone = () =>
  typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

/** Tiny night curve: pre-heat → bed → mid → final → (alarm) → off */
function PresetSparkline({ values, active }: { values: ScheduleValues; active: boolean }) {
  const levels = [
    values.initialSleepLevel,
    values.initialSleepLevel,
    values.midStageSleepLevel,
    values.finalSleepLevel,
    ...(values.preWakeEnabled ? [values.preWakeLevel ?? 10] : []),
    values.wakeupAlarmEnabled ? values.wakeupAlarmLevel : values.finalSleepLevel,
  ];
  const w = 120;
  const h = 36;
  const y = (lvl: number) => h / 2 - (lvl / 100) * (h / 2 - 3);
  const step = w / (levels.length - 1);
  const d = levels
    .map((lvl, i) => {
      const x = i * step;
      if (i === 0) return `M ${x} ${y(lvl)}`;
      const px = (i - 1) * step;
      const py = y(levels[i - 1] ?? 0);
      return `C ${px + step / 2} ${py}, ${x - step / 2} ${y(lvl)}, ${x} ${y(lvl)}`;
    })
    .join(" ");
  const id = `spark-${Math.abs(levels.reduce((a, b) => a * 31 + b, 7))}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="50%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="currentColor" strokeOpacity="0.12" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke={`url(#${id})`} strokeWidth={active ? 3 : 2.25} strokeLinecap="round" />
    </svg>
  );
}

function LevelChip({ label, level }: { label: string; level: number | null }) {
  const fmt = useLevelFormat();
  const tone =
    level === null
      ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
      : level > 0
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200"
      : level < 0
      ? "bg-sky-100 text-sky-900 dark:bg-sky-950/70 dark:text-sky-200"
      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`rounded-lg px-1.5 py-0.5 text-[10px] font-bold ${tone}`}>
      {label} {level === null ? tx("Off") : fmt.short(level)}
    </span>
  );
}

/** Bottom sheet to name a preset (create) or rename / refresh it (edit). */
export function PresetSheet({
  open,
  onClose,
  values,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  /** Schedule to store. For edits, only used when "replace values" is checked. */
  values: ScheduleValues | null;
  editing?: { id: number; name: string; description: string } | null;
}) {
  const toast = useToast();
  const utils = apiR.useUtils();
  const fmt = useLevelFormat();
  const sheetLevel = (level: number | null) => (level === null ? tx("Off") : fmt.short(level));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [replaceValues, setReplaceValues] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setDescription(editing?.description ?? "");
      setReplaceValues(false);
    }
  }, [open, editing]);

  const done = async (message: string) => {
    await utils.user.listPresets.invalidate();
    toast(message);
    onClose();
  };
  const create = apiR.user.createPreset.useMutation({
    onSuccess: () => done(tx("Preset saved")),
    onError: (e) => toast(e.message, "error"),
  });
  const update = apiR.user.updatePreset.useMutation({
    onSuccess: () => done(tx("Preset updated")),
    onError: (e) => toast(e.message, "error"),
  });

  if (!open) return null;
  const pending = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (editing) {
      update.mutate({
        id: editing.id,
        name,
        description,
        values: replaceValues && values ? values : undefined,
      });
    } else if (values) {
      create.mutate({ name, description, values });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border border-slate-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom-8 dark:border-slate-800 dark:bg-slate-900 sm:rounded-3xl sm:pb-5"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700 sm:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black">{editing ? tx("Edit preset") : tx("Save as preset")}</h3>
          <button type="button" onClick={onClose} aria-label={tx("Close")} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {values && !editing && (
          <p className="mb-4 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            {tx("Saves")} {values.bedTime.slice(0, 5)} → {values.wakeupTime.slice(0, 5)}, {tx("stages")}{" "}
            {sheetLevel(stageLevel(values, "initial", values.initialSleepLevel))} / {sheetLevel(stageLevel(values, "mid", values.midStageSleepLevel))} /{" "}
            {sheetLevel(stageLevel(values, "final", values.finalSleepLevel))}
            {values.wakeupAlarmEnabled ? `, ${tx("alarm")} ${sheetLevel(values.wakeupAlarmLevel)}` : `, ${tx("no alarm")}`}.
          </p>
        )}

        <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300" htmlFor="preset-name">
          {tx("Name")}
        </label>
        <input
          id="preset-name"
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tx("e.g. Summer weeknights")}
          className="mb-3 block h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
        />
        <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300" htmlFor="preset-desc">
          {tx("Description")} <span className="font-normal text-slate-400">{tx("(optional)")}</span>
        </label>
        <input
          id="preset-desc"
          maxLength={160}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={tx("When do you use it?")}
          className="mb-4 block h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
        />

        {editing && values && (
          <label className="mb-4 flex items-start gap-3 rounded-2xl border border-slate-200 p-3 text-xs dark:border-slate-700">
            <input
              type="checkbox"
              checked={replaceValues}
              onChange={(e) => setReplaceValues(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span>
              <strong className="block text-slate-800 dark:text-slate-100">{tx("Replace with my current schedule")}</strong>
              <span className="text-slate-500 dark:text-slate-400">
                {tx("Overwrite this preset's times and levels with what's saved on the Schedule tab.")}
              </span>
            </span>
          </label>
        )}

        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-extrabold text-white shadow-lg shadow-indigo-500/25 active:scale-[0.98] disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {editing ? tx("Save changes") : tx("Save preset")}
        </button>
      </form>
    </div>
  );
}

function PresetCard({
  preset,
  active,
  applying,
  onApply,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  preset: PresetDescriptor;
  active: boolean;
  applying: boolean;
  onApply: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const v = preset.values;
  return (
    <div
      className={`relative flex flex-col rounded-3xl border p-4 transition ${
        active
          ? "border-indigo-500 bg-indigo-50/70 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500/30 dark:bg-indigo-950/40"
          : "border-slate-200/80 bg-white/90 dark:border-slate-800/80 dark:bg-slate-900/70"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-black text-slate-900 dark:text-slate-200">{preset.name}</h3>
            {active && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                <Check className="h-3 w-3" /> Active
              </span>
            )}
          </div>
          {preset.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{preset.description}</p>
          )}
        </div>
      </div>

      <div className="mt-2 text-slate-400">
        <PresetSparkline values={v} active={active} />
      </div>

      <div className="mt-1 flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
        <span>
          {v.bedTime} → {v.wakeupTime}
        </span>
        <span className="text-slate-400">{formatDuration(sleepDurationMinutes(v))}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <LevelChip label={tx("Start")} level={stageLevel(v, "initial", v.initialSleepLevel)} />
        <LevelChip label={tx("Deep")} level={stageLevel(v, "mid", v.midStageSleepLevel)} />
        <LevelChip label={tx("Late")} level={stageLevel(v, "final", v.finalSleepLevel)} />
        {v.preWakeEnabled && <LevelChip label={tx("Pre-wake")} level={stageLevel(v, "prewake", v.preWakeLevel ?? 10)} />}
        {v.wakeupAlarmEnabled && <LevelChip label={tx("Alarm")} level={v.wakeupAlarmLevel} />}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        {v.preheatLeadMinutes > 0
          ? tx("{what} {n} min before bed", { what: tx(preheatLabel(v.initialSleepLevel)), n: v.preheatLeadMinutes })
          : tx("Pod turns on at bedtime")}
      </p>

      <div className="mt-3 flex items-center gap-1.5 pt-1">
        <button
          type="button"
          disabled={active || applying}
          onClick={onApply}
          className={`inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-2xl text-xs font-extrabold transition active:scale-95 ${
            active
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200"
              : "bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 disabled:opacity-60"
          }`}
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {active ? tx("In use") : applying ? tx("Applying…") : tx("Use tonight")}
        </button>
        <IconButton label={tx("Edit")} onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </IconButton>
        <IconButton label={tx("Duplicate")} onClick={onDuplicate}>
          <Copy className="h-4 w-4" />
        </IconButton>
        <IconButton label={tx("Delete")} onClick={onDelete} danger>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-2xl border transition active:scale-95 ${
        danger
          ? "border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
          : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

/** Preset chips at the top of the Schedule tab; tap to switch, Manage to edit. */
export const PresetsPanel: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const { savedValues, allPresets, activePreset, isLoading, side } = useSchedule();
  const [sheet, setSheet] = useState<{
    open: boolean;
    values: ScheduleValues | null;
    editing: { id: number; name: string; description: string } | null;
  }>({ open: false, values: null, editing: null });
  const [applyingId, setApplyingId] = useState<number | null>(null);

  const { lock } = useEditLock();
  const apply = apiR.user.applyPreset.useMutation({
    onSuccess: async (data) => {
      haptic(20);
      lock();
      await Promise.all([
        utils.user.getUserTemperatureProfile.invalidate(),
        utils.user.getPodStatus.invalidate(),
      ]);
      toast(`${data.name} is now your schedule`);
    },
    onError: (e) => toast(e.message, "error"),
    onSettled: () => setApplyingId(null),
  });
  const create = apiR.user.createPreset.useMutation({
    onSuccess: async () => {
      await utils.user.listPresets.invalidate();
      toast(tx("Preset duplicated"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const remove = apiR.user.deletePreset.useMutation({
    onSuccess: async () => {
      await utils.user.listPresets.invalidate();
      toast(tx("Preset deleted"), "info");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const handleApply = (preset: PresetDescriptor) => {
    setApplyingId(preset.id);
    apply.mutate({ id: preset.id, timezoneTZ: detectTimezone(), side });
  };
  const handleDuplicate = (preset: PresetDescriptor) =>
    create.mutate({
      name: `${preset.name} copy`.slice(0, 60),
      description: preset.description,
      values: preset.values,
    });

  const isUnsavedCustom = savedValues && !activePreset;

  const renderCard = (preset: PresetDescriptor) => (
    <PresetCard
      key={preset.id}
      preset={preset}
      active={activePreset?.id === preset.id}
      applying={applyingId === preset.id}
      onApply={() => handleApply(preset)}
      onDuplicate={() => handleDuplicate(preset)}
      onEdit={() =>
        setSheet({
          open: true,
          values: savedValues,
          editing: { id: preset.id, name: preset.name, description: preset.description },
        })
      }
      onDelete={() => {
        if (window.confirm(tx("Delete \"{name}\"?", { name: preset.name }))) remove.mutate({ id: preset.id });
      }}
    />
  );

  const [manageOpen, setManageOpen] = useState(false);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-1.5 text-sm font-black tracking-tight">
          <Bookmark className="h-4 w-4 text-indigo-500" /> {tx("Presets")}
        </h2>
        {allPresets.length > 0 && (
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="inline-flex h-9 items-center gap-1 rounded-xl px-2 text-xs font-bold text-indigo-600 active:scale-95 dark:text-indigo-400"
          >
            <Pencil className="h-3.5 w-3.5" /> {tx("Manage")}
          </button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-11" />
      ) : (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {allPresets.map((preset) => {
            const active = activePreset?.id === preset.id;
            const applying = applyingId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={active || applying}
                onClick={() => handleApply(preset)}
                className={`flex h-11 shrink-0 items-center gap-1.5 rounded-2xl px-4 text-sm font-bold transition active:scale-95 ${
                  active
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                    : "border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                }`}
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? <Check className="h-4 w-4" /> : null}
                {preset.name}
              </button>
            );
          })}
          <button
            type="button"
            disabled={!savedValues}
            onClick={() => setSheet({ open: true, values: savedValues, editing: null })}
            aria-label={tx("Save current schedule as a preset")}
            className="flex h-11 shrink-0 items-center gap-1 rounded-2xl border-2 border-dashed border-indigo-300 px-3 text-sm font-bold text-indigo-600 active:scale-95 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-300"
          >
            <BookmarkPlus className="h-4 w-4" /> {tx("Save")}
          </button>
        </div>
      )}
      <p className="mt-1 px-1 text-[11px] text-slate-500 dark:text-slate-400">
        {activePreset
          ? tx("Tonight: {name}. Tap another to switch.", { name: activePreset.name })
          : savedValues
          ? isUnsavedCustom
            ? tx("Tonight: your own schedule (not a preset). Tap Save to keep it.")
            : tx("Tonight: your own schedule.")
          : tx("Tap a preset, or set up your schedule below.")}
      </p>

      {/* Manage: full cards with edit / duplicate / delete */}
      {manageOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center" onClick={() => setManageOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-slate-50 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-950 sm:rounded-3xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-black">{tx("Manage presets")}</h3>
              <button type="button" onClick={() => setManageOpen(false)} aria-label={tx("Close")} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-3">{allPresets.map(renderCard)}</div>
          </div>
        </div>
      )}

      <PresetSheet
        open={sheet.open}
        values={sheet.values}
        editing={sheet.editing}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
      />
    </section>
  );
};
