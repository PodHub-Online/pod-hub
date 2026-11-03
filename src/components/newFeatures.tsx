"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CalendarRange,
  Check,
  CircleDashed,
  Download,
  Inbox,
  Mail,
  MessageSquare,
  Share2,
  Sparkles,
  Thermometer,
  Users,
  X,
} from "lucide-react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader } from "~/components/ui/card";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { useSide } from "~/components/sideContext";
import { Switch } from "~/components/settingsExtras";
import { readStorage, writeStorage } from "~/lib/clientStorage";
import { formatLevel } from "~/lib/presets";
import { WEEK, isDayActive, toggleDay } from "~/lib/schedule";
import { NEWS } from "~/lib/whatsNew";
import { tx, txLocale } from "~/lib/i18n";
import { formatC, useTempUnit } from "~/lib/tempUnit";

const tz = () => (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");
const btn = "flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 text-xs font-extrabold text-white transition active:scale-95 disabled:opacity-50";
const btnGhost = "flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 text-xs font-bold transition active:scale-95 dark:border-slate-700";
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-bold transition active:scale-95 ${
    on ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
  }`;
const ago = (d: Date | string | null) => {
  if (!d) return "—";
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  return min < 60 ? tx("{n} min ago", { n: min }) : min < 1440 ? tx("{n} h ago", { n: Math.round(min / 60) }) : new Date(d).toLocaleDateString(txLocale(), { month: "short", day: "numeric" });
};
const standalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

// ---------------------------------------------------------------- #3 What's new

const NEWS_KEY = "podhub-news-seen";

/** The latest update in a few lines, once per update. New people (still on the tour) skip it. */
export const WhatsNewCard: React.FC = () => {
  const latest = NEWS[0];
  const [show, setShow] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!latest) return;
    const seen = readStorage(NEWS_KEY);
    // someone who just arrived has nothing "new" to catch up on
    if (!seen && !readStorage("podhub-tour-seen")) {
      writeStorage(NEWS_KEY, latest.date);
      return;
    }
    setShow(seen !== latest.date);
  }, [latest]);
  if (!latest || !show) return null;
  const close = () => {
    writeStorage(NEWS_KEY, latest.date);
    setShow(false);
  };
  const date = new Date(`${latest.date}T12:00:00`).toLocaleDateString(txLocale(), { month: "short", day: "numeric" });
  return (
    <Card className="border-slate-300 dark:border-slate-600">
      <CardHeader icon={<Sparkles className="h-5 w-5" />} title={tx("What's new · {date}", { date })} />
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
        {latest.items.map((i) => (
          <li key={i}>{tx(i)}</li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button type="button" className={btnGhost} onClick={() => setAll(true)}>
          {tx("Earlier updates")}
        </button>
        <button type="button" className={btn} onClick={close}>
          {tx("Got it")}
        </button>
      </div>
      <Sheet open={all} onClose={() => setAll(false)} title={tx("Updates")} icon={<Sparkles className="h-5 w-5" />}>
        <div className="space-y-4 pb-4">
          {NEWS.map((n) => (
            <div key={n.date}>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {new Date(`${n.date}T12:00:00`).toLocaleDateString(txLocale(), { month: "long", day: "numeric" })}
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {n.items.map((i) => (
                  <li key={i}>{tx(i)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Sheet>
    </Card>
  );
};

// ---------------------------------------------------------------- #2 Setup checklist

const CHECK_KEY = "podhub-setup-hidden";
const EIGHT_OFF_KEY = "podhub-eight-schedule-off";

/** Stays on Home until the few things that matter are done (or it's hidden). */
export const SetupChecklist: React.FC<{ onNavigate: (tab: "schedule" | "settings") => void }> = ({ onNavigate }) => {
  const [hidden, setHidden] = useState(true);
  const [eightOffSaid, setEightOffSaid] = useState(false);
  const [howOpen, setHowOpen] = useState<"home" | "eight" | null>(null);
  useEffect(() => {
    setHidden(readStorage(CHECK_KEY) === "1");
    setEightOffSaid(readStorage(EIGHT_OFF_KEY) === "1");
  }, []);
  const account = apiR.user.getAccount.useQuery(undefined, { staleTime: 60_000 });
  const whoop = apiR.whoop.getStatus.useQuery(undefined, { retry: false, staleTime: 10 * 60_000, enabled: !hidden });
  const timezone = useMemo(tz, []);
  const sleep = apiR.user.getSleepData.useQuery({ days: 7, timezone }, { enabled: !hidden && whoop.isFetched && !whoop.data?.connected, retry: false, staleTime: 30 * 60_000 });
  const eight = apiR.more.getEightSchedule.useQuery(undefined, { enabled: !hidden && !eightOffSaid, retry: false, staleTime: 60 * 60_000 });
  if (hidden || !account.data) return null;
  const a = account.data;
  const items = [
    { key: "signin", label: tx("Signed in"), done: true },
    { key: "schedule", label: tx("Schedule set"), done: a.sides.left.hasSchedule || a.sides.right.hasSchedule || a.sides.both.hasSchedule, fix: () => onNavigate("schedule") },
    {
      key: "sleep",
      label: tx("Sleep tracking found"),
      done: !!whoop.data?.connected || !!sleep.data?.days.some((d) => (d.sleepSeconds ?? 0) > 0),
      fix: () => onNavigate("settings"),
    },
    { key: "eight", label: tx("Eight Sleep schedule off"), done: eightOffSaid || eight.data?.eightScheduleOn === false, fix: () => setHowOpen("eight") },
    { key: "home", label: tx("Add to Home Screen"), done: standalone(), fix: () => setHowOpen("home") },
  ];
  const done = items.filter((i) => i.done).length;
  // for the owner statistics (sent with the next visit): how far setup got
  (window as Window & { __podhubChecklist?: { done: number; total: number; missing: string[] } }).__podhubChecklist = {
    done,
    total: items.length,
    missing: items.filter((i) => !i.done).map((i) => i.key),
  };
  const hide = () => {
    writeStorage(CHECK_KEY, "1");
    setHidden(true);
  };
  if (done === items.length) return null;
  return (
    <Card>
      <CardHeader
        icon={<Check className="h-5 w-5" />}
        title={tx("Get set up · {n} of {total}", { n: done, total: items.length })}
        action={
          <button type="button" onClick={hide} aria-label={tx("Hide")} className="rounded-full p-1 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        }
      />
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full rounded-full bg-slate-500 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((i) => (
          <div key={i.key} className="flex items-center justify-between py-2 text-sm">
            <span className="flex items-center gap-2">
              {i.done ? <Check className="h-4 w-4 text-emerald-500" /> : <CircleDashed className="h-4 w-4 text-slate-400" />}
              <span className={i.done ? "text-slate-500" : "font-semibold"}>{i.label}</span>
            </span>
            {!i.done && i.fix && (
              <button type="button" onClick={i.fix} className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {i.key === "home" || i.key === "eight" ? tx("How ›") : tx("Fix ›")}
              </button>
            )}
          </div>
        ))}
      </div>
      <Sheet open={howOpen === "home"} onClose={() => setHowOpen(null)} title={tx("Add to Home Screen")}>
        <div className="space-y-3 pb-4 text-sm">
          <p>
            <b>iPhone:</b> {tx("open this page in Safari, tap Share, then \"Add to Home Screen\".")}
          </p>
          <p>
            <b>Android:</b> {tx("open the browser menu (⋮), then \"Add to Home screen\" or \"Install app\".")}
          </p>
          <p className="text-slate-500">{tx("It then opens like an app, and phone notifications can work.")}</p>
        </div>
      </Sheet>
      <Sheet open={howOpen === "eight"} onClose={() => setHowOpen(null)} title={tx("Eight Sleep schedule off")}>
        <div className="space-y-3 pb-4 text-sm">
          <p>{tx("Pod Hub runs its own schedule. If the Eight Sleep app's schedule (Autopilot) is on too, the two can fight over the temperature.")}</p>
          <p>{tx("In the Eight Sleep app, turn off its schedule / Autopilot for your side. Keep the Eight Sleep app installed: you still need it for the Pod itself.")}</p>
          <button
            type="button"
            className={btn + " w-full"}
            onClick={() => {
              writeStorage(EIGHT_OFF_KEY, "1");
              setEightOffSaid(true);
              setHowOpen(null);
            }}
          >
            {tx("I turned it off")}
          </button>
        </div>
      </Sheet>
    </Card>
  );
};

// ---------------------------------------------------------------- #1 Start from the Eight Sleep app's schedule

const addMinutes = (hhmm: string, m: number) => {
  const [h = 0, mm = 0] = hhmm.split(":").map(Number);
  const t = (((h * 60 + mm + m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** On a side with no schedule yet: offer the bedtime, wake-up and levels from the Eight Sleep app. */
export const EightImportCard: React.FC = () => {
  const { scheduleSide: side } = useSide();
  const toast = useToast();
  const utils = apiR.useUtils();
  const account = apiR.user.getAccount.useQuery(undefined, { staleTime: 60_000 });
  const hasSchedule = account.data?.sides[side]?.hasSchedule ?? true;
  const eight = apiR.more.getEightSchedule.useQuery(undefined, { enabled: !hasSchedule && side !== "both", retry: false, staleTime: 60 * 60_000 });
  const save = apiR.user.updateUserTemperatureProfile.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.user.getAccount.invalidate(), utils.user.getUserTemperatureProfile.invalidate()]);
      toast(tx("Schedule copied from the Eight Sleep app"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const e = eight.data;
  if (hasSchedule || side === "both" || !e?.available || !e.bedTime || !e.wakeupTime) return null;
  const lv = {
    initial: e.levels.initial ?? -20,
    mid: e.levels.mid ?? e.levels.initial ?? -30,
    final: e.levels.final ?? 0,
  };
  const use = () =>
    save.mutate({
      side,
      bedTime: e.bedTime!,
      wakeupTime: e.wakeupTime!,
      // deep sleep from 90 minutes after bedtime, late sleep for the last 2.5 hours
      midStageSleepLevelStartTime: addMinutes(e.bedTime!, 90),
      finalSleepLevelStartTime: addMinutes(e.wakeupTime!, -150),
      initialSleepLevel: lv.initial,
      midStageSleepLevel: lv.mid,
      finalSleepLevel: lv.final,
      wakeupAlarmEnabled: false,
      wakeupAlarmLevel: 20,
      wakeupAlarmLeadMinutes: 15,
      preWakeEnabled: false,
      preWakeLevel: 10,
      preWakeLeadMinutes: 60,
      preheatLeadMinutes: 30,
      timezoneTZ: tz(),
      activeDays: 127,
    });
  const row = (k: string, v: string, cls = "") => (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-slate-500">{k}</span>
      <b className={cls}>{v}</b>
    </div>
  );
  return (
    <Card>
      <CardHeader icon={<Download className="h-5 w-5" />} title={tx("Found your Eight Sleep schedule")} subtitle={tx("From the Eight Sleep app. Start from it?")} />
      <div className="divide-y divide-slate-100 rounded-2xl bg-slate-50 px-3 dark:divide-slate-800 dark:bg-slate-950/50">
        {row(tx("Bedtime"), e.bedTime)}
        {row(tx("Wake-up"), e.wakeupTime)}
        {row(tx("Falling asleep"), formatLevel(lv.initial), "text-sky-500")}
        {row(tx("Deep sleep"), formatLevel(lv.mid), "text-sky-500")}
        {row(tx("Late sleep"), formatLevel(lv.final))}
      </div>
      {e.eightScheduleOn && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{tx("Its schedule is still on in the Eight Sleep app. Turn it off there so the two don't fight.")}</p>
      )}
      <div className="mt-3 flex">
        <button type="button" className={btn} disabled={save.isPending} onClick={use}>
          {tx("Use this schedule")}
        </button>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------- #5 Weekend nights

/** Weekend nights for the side being edited: which nights, and their own bedtime and wake-up. */
export const WeekendCard: React.FC = () => {
  const { scheduleSide: side } = useSide();
  const toast = useToast();
  const utils = apiR.useUtils();
  const profile = apiR.user.getUserTemperatureProfile.useQuery({ side }, { retry: 1 });
  const p = profile.data;
  const [days, setDays] = useState(0);
  const [bed, setBed] = useState("00:30");
  const [wake, setWake] = useState("09:00");
  useEffect(() => {
    if (!p) return;
    setDays(p.weekendDays ?? 0);
    setBed(p.weekendBedTime?.slice(0, 5) ?? p.bedTime.slice(0, 5));
    setWake(p.weekendWakeupTime?.slice(0, 5) ?? p.wakeupTime.slice(0, 5));
  }, [p]);
  const save = apiR.more.setWeekend.useMutation({
    onSuccess: async (_d, v) => {
      await utils.user.getUserTemperatureProfile.invalidate();
      toast(v.days ? tx("Weekend nights saved") : tx("Weekend nights off"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  if (!p) return null;
  const on = days > 0;
  const changed = days !== (p.weekendDays ?? 0) || (on && (bed !== p.weekendBedTime?.slice(0, 5) || wake !== p.weekendWakeupTime?.slice(0, 5)));
  const input = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-lg font-black dark:border-slate-700 dark:bg-slate-800";
  return (
    <Card>
      <CardHeader
        icon={<CalendarRange className="h-5 w-5" />}
        title={tx("Weekend nights")}
        subtitle={tx("Their own bedtime and wake-up. Levels stay the same.")}
        action={
          <Switch
            on={on}
            label={tx("Weekend nights")}
            onChange={(v) => setDays(v ? (1 << 5) | (1 << 6) : 0)}
          />
        }
      />
      {on && (
        <>
          <p className="mb-1 text-xs text-slate-500">{tx("Nights that start on")}</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {WEEK.map((d) => (
              <button key={d.day} type="button" className={chip(isDayActive(days, d.day))} onClick={() => setDays(toggleDay(days, d.day))} aria-label={tx(d.long)}>
                {tx(d.short)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-500">
              {tx("In bed")}
              <input type="time" value={bed} onChange={(e) => setBed(e.target.value)} className={input} />
            </label>
            <label className="text-xs text-slate-500">
              {tx("Wake up")}
              <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} className={input} />
            </label>
          </div>
        </>
      )}
      {changed && (
        <div className="mt-3 flex">
          <button
            type="button"
            className={btn}
            disabled={save.isPending}
            onClick={() => save.mutate({ side, days, bedTime: on ? bed : null, wakeupTime: on ? wake : null })}
          >
            {tx("Save weekend nights")}
          </button>
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------- #7 Room-aware cooling

/** Settings → Smart features: cool earlier and colder after a warm night in the bedroom. */
export const RoomAwareCard: React.FC<{ demo: boolean }> = () => {
  const toast = useToast();
  const unit = useTempUnit();
  const utils = apiR.useUtils();
  const room = apiR.more.getRoom.useQuery();
  const set = apiR.more.setRoom.useMutation({
    onSuccess: async () => {
      await utils.more.getRoom.invalidate();
    },
    onError: (e) => toast(e.message, "error"),
  });
  const r = room.data;
  if (!r) return null;
  return (
    <Card>
      <CardHeader
        icon={<Thermometer className="h-5 w-5" />}
        title={tx("Room-aware cooling")}
        subtitle={tx("Uses your Pod's own room sensor. No location needed.")}
        action={<Switch on={r.enabled} label={tx("Room-aware cooling")} onChange={(v) => set.mutate({ enabled: v, threshold: r.threshold })} />}
      />
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {tx("When your bedroom was at or above {temp} last night, cooling starts 30 minutes earlier and falling asleep is one step colder.", { temp: formatC(r.threshold, unit, 0) })}
      </p>
      {r.enabled && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{tx("Warm room means")}</span>
          <div className="flex items-center gap-2">
            {[24, 25, 26, 27].map((t) => (
              <button key={t} type="button" className={chip(r.threshold === t)} onClick={() => set.mutate({ enabled: true, threshold: t })}>
                {formatC(t, unit, 0)}
              </button>
            ))}
          </div>
        </div>
      )}
      {r.lastC !== null && (
        <p className="mt-3 text-xs text-slate-500">{tx("Last reading: {temp} ({when})", { temp: formatC(r.lastC, unit), when: ago(r.lastAt) })}</p>
      )}
    </Card>
  );
};

/** Home, in the evening: says when a warm bedroom will make tonight start earlier and colder. */
export const RoomBanner: React.FC = () => {
  const unit = useTempUnit();
  const room = apiR.more.getRoom.useQuery(undefined, { staleTime: 30 * 60_000 });
  const weather = apiR.fun.getExtras.useQuery(undefined, { staleTime: 10 * 60_000 }).data?.weather;
  const r = room.data;
  // the weather card already says it's a hot night
  if (weather?.hot) return null;
  const h = new Date().getHours();
  if (!r?.enabled || r.lastC === null || r.lastC < r.threshold || (h < 17 && h > 3)) return null;
  return (
    <div className="flex items-start gap-3 rounded-3xl border border-orange-200 bg-orange-50/80 p-4 text-sm text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200">
      <Thermometer className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="font-extrabold">{tx("Warm room tonight · {temp}", { temp: formatC(r.lastC, unit) })}</p>
        <p className="mt-0.5 text-xs">{tx("Cooling starts 30 minutes earlier and falling asleep is one step colder.")}</p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- #4 Feedback

const KIND_TEXT: Record<string, string> = { bug: "Bug", idea: "Idea", question: "Question" };
const STATUS_TEXT: Record<string, string> = { new: "Sent", read: "Read", fixed: "Fixed" };

/** Settings → Send feedback: goes straight to the owner. */
export const FeedbackPage: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const mine = apiR.more.myFeedback.useQuery();
  const [kind, setKind] = useState<"bug" | "idea" | "question">("bug");
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(true);
  const send = apiR.more.sendFeedback.useMutation({
    onSuccess: async () => {
      setText("");
      await utils.more.myFeedback.invalidate();
      toast(tx("Sent. Thanks!"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const meta = () => `${navigator.userAgent.slice(0, 200)} · ${standalone() ? "app" : "browser"} · ${window.innerWidth}x${window.innerHeight}`;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={<MessageSquare className="h-5 w-5" />} title={tx("Send feedback")} subtitle={tx("Goes straight to the person who runs the app. Bugs, ideas, anything.")} />
        <div className="mb-3 flex gap-1.5">
          {(["bug", "idea", "question"] as const).map((k) => (
            <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>
              {tx(KIND_TEXT[k]!)}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder={kind === "bug" ? tx("What happened, and what did you expect?") : kind === "idea" ? tx("What would make the app better for you?") : tx("Ask away")}
          className="block w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-500">{tx("Attach phone type and app version")}</span>
          <Switch on={attach} onChange={setAttach} label={tx("Attach phone type and app version")} />
        </div>
        <div className="mt-3 flex">
          <button type="button" className={btn} disabled={send.isPending || text.trim().length < 3} onClick={() => send.mutate({ kind, text, meta: attach ? meta() : undefined })}>
            {tx("Send")}
          </button>
        </div>
      </Card>
      {!!mine.data?.length && (
        <Card>
          <CardHeader title={tx("Your earlier notes")} />
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {mine.data.map((f) => (
              <div key={f.id} className="py-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="line-clamp-2">{f.text}</span>
                  <span className={`shrink-0 text-xs font-bold ${f.status === "fixed" ? "text-emerald-500" : f.reply ? "text-indigo-500" : "text-slate-400"}`}>
                    {f.reply && f.status !== "fixed" ? tx("Replied") : tx(STATUS_TEXT[f.status] ?? f.status)}
                  </span>
                </div>
                {f.reply && (
                  <p className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    <b>{tx("Owner's reply")}:</b> {f.reply}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

/** Owner, under Invites: everyone's notes, newest first. */
export const OwnerFeedback: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const list = apiR.more.listFeedback.useQuery(undefined, { retry: false });
  const set = apiR.more.setFeedbackStatus.useMutation({ onSuccess: () => utils.more.listFeedback.invalidate() });
  // the note being answered, and what's written so far
  const [replying, setReplying] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const reply = apiR.more.replyFeedback.useMutation({
    onSuccess: async () => {
      setReplying(null);
      setDraft("");
      await utils.more.listFeedback.invalidate();
      toast(tx("Reply sent"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  if (!list.data) return null;
  return (
    <Card>
      <CardHeader icon={<Inbox className="h-5 w-5" />} title={tx("Feedback")} subtitle={tx("{n} new", { n: list.data.filter((f) => f.status === "new").length })} />
      {!list.data.length && <p className="text-sm text-slate-500">{tx("No notes yet.")}</p>}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {list.data.map((f) => (
          <div key={f.id} className="py-3 text-sm">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                <b className="text-slate-700 dark:text-slate-200">{tx(KIND_TEXT[f.kind] ?? f.kind)}</b> · {f.email} · {ago(f.createdAt)}
              </span>
              {f.status === "new" && <span className="h-2 w-2 rounded-full bg-rose-500" />}
            </div>
            <p className="mt-1 whitespace-pre-wrap">{f.text}</p>
            {f.meta && <p className="mt-1 truncate text-[11px] text-slate-400">{f.meta}</p>}
            {f.reply && (
              <div className="mt-2 rounded-xl border-l-2 border-emerald-500 bg-emerald-50/60 px-3 py-2 text-xs dark:bg-emerald-950/30">
                <div className="mb-0.5 font-bold text-emerald-700 dark:text-emerald-300">
                  {tx("You replied by email")} {f.repliedAt ? `· ${ago(f.repliedAt)}` : ""}
                </div>
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{f.reply}</p>
              </div>
            )}
            <div className="mt-2 flex gap-1.5">
              {(["read", "fixed"] as const).map((s) => (
                <button key={s} type="button" className={chip(f.status === s)} onClick={() => set.mutate({ id: f.id, status: f.status === s ? "new" : s })}>
                  {tx(s === "read" ? "Read" : "Fixed")}
                </button>
              ))}
              <button
                type="button"
                className={chip(replying === f.id)}
                onClick={() => {
                  setReplying(replying === f.id ? null : f.id);
                  setDraft("");
                }}
              >
                {tx(f.reply ? "Reply again" : "Reply")}
              </button>
            </div>
            {replying === f.id && (
              <div className="mt-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={4000}
                  rows={4}
                  autoFocus
                  placeholder={tx("Your reply. It goes to {email} from your approval-emails Gmail.", { email: f.email })}
                  className="block w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" className={btn} disabled={reply.isPending || draft.trim().length < 2} onClick={() => reply.mutate({ id: f.id, text: draft })}>
                    {reply.isPending ? tx("Sending…") : tx("Send")}
                  </button>
                  <button type="button" className="text-xs font-bold text-slate-500" onClick={() => setReplying(null)}>
                    {tx("Cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------- Approval emails (owner)

/** Owner, under Invites: send a "You're in" email from your Gmail when you approve someone. */
export const MailSetupCard: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const setup = apiR.more.getMailSetup.useQuery(undefined, { retry: false });
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [onApprove, setOnApprove] = useState(true);
  useEffect(() => {
    if (setup.data) {
      setUser(setup.data.user ?? "");
      setOnApprove(setup.data.onApprove);
    }
  }, [setup.data]);
  const save = apiR.more.saveMailSetup.useMutation({
    onSuccess: async () => {
      setPass("");
      await utils.more.getMailSetup.invalidate();
      toast(tx("Saved. A test email is on its way to you."));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const remove = apiR.more.removeMailSetup.useMutation({
    onSuccess: async () => {
      setPass("");
      await utils.more.getMailSetup.invalidate();
    },
  });
  const d = setup.data;
  if (!d) return null;
  const field = "block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800";
  return (
    <Card>
      <CardHeader
        icon={<Mail className="h-5 w-5" />}
        title={tx("Approval emails")}
        subtitle={d.configured ? tx("On · from {email}", { email: d.user ?? "" }) : tx("Email people when you approve them")}
      />
      {!d.configured && (
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
          <li>{tx("Your Google account needs 2-Step Verification turned on.")}</li>
          <li>
            {tx("Open")}{" "}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="font-bold underline">
              myaccount.google.com/apppasswords
            </a>
            {", "}
            {tx("make one named \"Pod Hub\", and copy the 16 letters.")}
          </li>
          <li>{tx("Paste them below. Your normal Gmail password is never needed.")}</li>
        </ol>
      )}
      <div className="space-y-2">
        <input type="email" value={user} onChange={(e) => setUser(e.target.value)} placeholder={tx("Your Gmail address")} autoComplete="off" className={field} />
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={d.configured ? tx("App password (leave empty to keep it)") : tx("16-letter app password")}
          autoComplete="new-password"
          className={field}
        />
        <div className="flex items-center justify-between py-1">
          <span className="text-xs text-slate-500">{tx("Email people when I approve or invite them")}</span>
          <Switch on={onApprove} onChange={setOnApprove} label={tx("Email people when I approve or invite them")} />
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{tx("The app password is stored encrypted and never shown again. Saving sends you a test email first.")}</p>
      <div className="mt-3 flex gap-2">
        {d.configured && (
          <button type="button" className={btnGhost} disabled={remove.isPending} onClick={() => remove.mutate()}>
            {tx("Turn off")}
          </button>
        )}
        <button type="button" className={btn} disabled={save.isPending || !user || (!d.configured && !pass)} onClick={() => save.mutate({ user, pass: pass || undefined, onApprove })}>
          {save.isPending ? tx("Sending a test…") : tx("Save")}
        </button>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------- #13 Usage (owner)

export const UsagePage: React.FC = () => {
  const usage = apiR.more.getUsage.useQuery(undefined, { retry: false, refetchInterval: 60_000 });
  const u = usage.data;
  if (!u) return null;
  const tile = (label: string, value: React.ReactNode, sub?: string) => (
    <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-3xl font-black">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
  const row = (k: string, v: React.ReactNode, warn = false) => (
    <div className="flex justify-between py-2 text-sm">
      <span>{k}</span>
      <b className={warn ? "text-amber-600 dark:text-amber-400" : ""}>{v}</b>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {tile(tx("People"), u.people, u.joinedThisWeek ? tx("+{n} this week", { n: u.joinedThisWeek }) : undefined)}
        {tile(tx("Used the app today"), u.activeToday)}
      </div>
      <Card>
        <CardHeader icon={<Activity className="h-5 w-5" />} title={tx("Schedule checks · last 24 h")} subtitle={tx("Last run {when}", { when: ago(u.lastRunAt) })} />
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {row(tx("Runs"), u.checks)}
          {row(tx("Changes sent to the Pods"), u.changesSent)}
          {row(tx("Eight Sleep errors"), u.errors, u.errors > 0)}
          {row(tx("Paused after errors"), u.backedOff, u.backedOff > 0)}
        </div>
      </Card>
      <Card>
        <CardHeader icon={<Users className="h-5 w-5" />} title={tx("Waiting for you")} />
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {row(tx("Access requests"), u.waitingRequests, u.waitingRequests > 0)}
          {row(tx("New feedback"), u.newFeedback, u.newFeedback > 0)}
        </div>
        <p className="mt-2 text-xs text-slate-500">{tx("Both are under Settings → Invites.")}</p>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- #12 Year in sleep

/** Your year so far as a picture to keep or share, from the nights the app has summarized. */
export const YearInSleepCard: React.FC<{ sleepByNight: Map<string, number> }> = ({ sleepByNight }) => {
  const toast = useToast();
  const { own } = useSide();
  const timezone = useMemo(tz, []);
  const levels = apiR.fun.getNightLevels.useQuery({ days: 366, timezone }, { staleTime: 60 * 60_000 });
  const name = apiR.user.getAccount.useQuery(undefined, { staleTime: 10 * 60_000 }).data?.displayName;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const year = new Date().getFullYear();

  const stats = useMemo(() => {
    const rows = (levels.data ?? []).filter((r) => r.side === own && r.night.startsWith(String(year)));
    if (rows.length < 7) return null;
    const ran = rows.filter((r) => r.scheduleRan);
    // longest run of nights in a row with the schedule on
    const dates = new Set(ran.map((r) => r.night));
    let best = 0;
    for (const d of dates) {
      const prev = new Date(`${d}T12:00:00`);
      prev.setDate(prev.getDate() - 1);
      if (dates.has(prev.toLocaleDateString("en-CA"))) continue;
      let n = 1;
      const next = new Date(`${d}T12:00:00`);
      for (;;) {
        next.setDate(next.getDate() + 1);
        if (!dates.has(next.toLocaleDateString("en-CA"))) break;
        n++;
      }
      best = Math.max(best, n);
    }
    const counts = new Map<number, number>();
    for (const r of rows) if (r.avgLevel !== null) counts.set(Math.round(r.avgLevel / 10), (counts.get(Math.round(r.avgLevel / 10)) ?? 0) + 1);
    const favorite = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const sleeps = rows.map((r) => sleepByNight.get(r.night)).filter((m): m is number => m !== undefined);
    const avgSleep = sleeps.length ? sleeps.reduce((a, b) => a + b, 0) / sleeps.length : null;
    const longest = rows.reduce<{ night: string; min: number } | null>((b, r) => {
      const m = sleepByNight.get(r.night);
      return m !== undefined && (!b || m > b.min) ? { night: r.night, min: m } : b;
    }, null);
    return { nights: rows.length, onSchedule: ran.length, streak: best, favorite, avgSleep, longest, since: rows[rows.length - 1]!.night };
  }, [levels.data, own, year, sleepByNight]);

  useEffect(() => {
    if (!stats) return;
    const c = (canvas.current ??= document.createElement("canvas"));
    c.width = 1080;
    c.height = 1350;
    const g = c.getContext("2d");
    if (!g) return;
    const bg = g.createLinearGradient(0, 0, 1080, 1350);
    bg.addColorStop(0, "#1e1b4b");
    bg.addColorStop(0.7, "#000000");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1080, 1350);
    const font = (w: number, s: number) => `${w} ${s}px system-ui, -apple-system, Segoe UI, sans-serif`;
    g.fillStyle = "#a5b4fc";
    g.font = font(800, 38);
    g.fillText(`${name ? `${name.toUpperCase()}'S ` : ""}${year}`, 80, 130);
    g.fillStyle = "#f8fafc";
    g.font = font(900, 110);
    g.fillText(tx("A year"), 80, 270);
    g.fillText(tx("in sleep"), 80, 390);
    const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;
    const tiles: [string, string][] = [
      [tx("nights with Pod Hub"), String(stats.nights)],
      [tx("on schedule"), String(stats.onSchedule)],
      [tx("favorite level"), stats.favorite === null ? "—" : formatLevel(stats.favorite * 10)],
      [tx("longest streak"), String(stats.streak)],
    ];
    tiles.forEach(([k, v], i) => {
      const x = 80 + (i % 2) * 470;
      const y = 480 + Math.floor(i / 2) * 250;
      g.fillStyle = "#f1f5f9";
      g.font = font(900, 110);
      g.fillText(v, x, y + 100);
      g.fillStyle = "#94a3b8";
      g.font = font(600, 34);
      g.fillText(k, x, y + 155);
    });
    if (stats.longest) {
      g.fillStyle = "rgba(255,255,255,0.07)";
      g.beginPath();
      g.roundRect(80, 1010, 920, 170, 36);
      g.fill();
      g.fillStyle = "#94a3b8";
      g.font = font(700, 30);
      g.fillText(tx("Longest night"), 120, 1070);
      g.fillStyle = "#f8fafc";
      g.font = font(800, 46);
      const d = new Date(`${stats.longest.night}T12:00:00`).toLocaleDateString(txLocale(), { month: "long", day: "numeric" });
      g.fillText(`${d} · ${hm(stats.longest.min)}${stats.avgSleep !== null ? `  (${tx("avg")} ${hm(stats.avgSleep)})` : ""}`, 120, 1135);
    }
    g.fillStyle = "#475569";
    g.font = font(600, 28);
    g.fillText("Pod Hub", 80, 1290);
    setUrl(c.toDataURL("image/png"));
  }, [stats, name, year]);

  if (!stats) return null;
  const file = async () => {
    const blob = await new Promise<Blob | null>((r) => canvas.current?.toBlob(r, "image/png"));
    return blob ? new File([blob], `year-in-sleep-${year}.png`, { type: "image/png" }) : null;
  };
  const save = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `year-in-sleep-${year}.png`;
    a.click();
    toast(tx("Saved"));
  };
  const share = async () => {
    const f = await file();
    if (!f) return;
    try {
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: tx("A year in sleep") });
      else save();
    } catch {
      // closed the share sheet
    }
  };
  return (
    <Card>
      <CardHeader icon={<Share2 className="h-5 w-5" />} title={tx("Your year in sleep")} subtitle={tx("{year} so far · {n} nights", { year, n: stats.nights })} />
      {url && <img src={url} alt={tx("Your year in sleep")} className="mx-auto mb-3 w-48 rounded-2xl shadow-lg" />}
      <div className="flex gap-2">
        <button type="button" onClick={() => void share()} className={btn}>
          <Share2 className="h-4 w-4" /> {tx("Share")}
        </button>
        <button type="button" onClick={save} className={btnGhost + " flex-1"}>
          <Download className="h-4 w-4" /> {tx("Save")}
        </button>
      </div>
    </Card>
  );
};
