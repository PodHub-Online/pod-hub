"use client";

import React, { useState } from "react";
import { Activity, AlertTriangle, Bell, Cpu, Download, Gauge, Mail, Radio, Send, Smartphone, Sparkles, UserCheck, Users } from "lucide-react";
import { type inferRouterOutputs } from "@trpc/server";
import { type AppRouter } from "~/server/api/root";
import { apiR } from "~/trpc/react";
import { Card, CardHeader } from "~/components/ui/card";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { formatLevel } from "~/lib/presets";
import { tx, txLocale } from "~/lib/i18n";

type Stats = inferRouterOutputs<AppRouter>["stats"]["getStats"];
type Person = Stats["people"][number];

const ago = (d: Date | string | null | undefined) => {
  if (!d) return tx("never");
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (min < 2) return tx("now");
  if (min < 60) return tx("{n} min ago", { n: min });
  if (min < 1440) return tx("{n} h ago", { n: Math.round(min / 60) });
  return tx("{n} days ago", { n: Math.round(min / 1440) });
};
const short = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(txLocale(), { month: "short", day: "numeric" });

function Tile({ label, value, sub, warn }: { label: string; value: React.ReactNode; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-800/80 dark:bg-slate-900/70">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-2xl font-black ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-600 dark:text-slate-300">{k}</span>
      <b className={warn ? "text-amber-600 dark:text-amber-400" : ""}>{v}</b>
    </div>
  );
}

/** Small bars, with the label under each. */
function Bars({ data, warnZero, height = 64 }: { data: { label: string; n: number; title?: string }[]; warnZero?: boolean; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={d.title ?? `${d.label}: ${d.n}`}>
          <div
            className={`w-full rounded-t ${warnZero && d.n === 0 ? "bg-rose-400/70" : "bg-slate-400 dark:bg-slate-500"}`}
            style={{ height: `${Math.max(warnZero && d.n === 0 ? 8 : 2, (d.n / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/** A list of counts with a bar each ("nap 12", "im_hot 7"). */
function Counts({ items, empty }: { items: { key: string; n: number }[]; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  if (!items.length) return <p className="text-xs text-slate-500">{empty ?? tx("Nothing yet.")}</p>;
  return (
    <div className="space-y-1">
      {items.map((i) => (
        <div key={i.key} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-slate-600 dark:text-slate-300">{i.key.replace(/_/g, " ")}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-slate-500" style={{ width: `${(i.n / max) * 100}%` }} />
          </div>
          <b className="w-8 text-right">{i.n}</b>
        </div>
      ))}
    </div>
  );
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv(people: Person[]) {
  const cols: (keyof Person)[] = ["email", "name", "joinedAt", "lastSeenAt", "device", "lang", "unit", "hasSchedule", "following", "whoop", "notifications", "signInOk", "away", "errors7d"];
  const lines = [cols.join(","), ...people.map((p) => cols.map((c) => csvCell(p[c])).join(","))];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `pod-hub-people-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** One person's usage, and a way to reach them. */
function PersonSheet({ email, onClose }: { email: string | null; onClose: () => void }) {
  const toast = useToast();
  const person = apiR.stats.getPerson.useQuery({ email: email ?? "" }, { enabled: !!email, retry: false });
  const [via, setVia] = useState<"push" | "email">("push");
  const [title, setTitle] = useState("Pod Hub");
  const [text, setText] = useState("");
  const send = apiR.stats.messagePerson.useMutation({
    onSuccess: () => {
      setText("");
      toast(tx("Sent"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const p = person.data;
  return (
    <Sheet open={!!email} onClose={onClose} title={p?.name ?? email ?? ""} icon={<UserCheck className="h-5 w-5" />}>
      {!p ? (
        <p className="pb-6 text-sm text-slate-500">{tx("Loading…")}</p>
      ) : (
        <div className="space-y-4 pb-6">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <Row k={tx("Email")} v={<span className="text-xs">{p.email}</span>} />
            <Row k={tx("Joined")} v={new Date(p.joinedAt).toLocaleDateString(txLocale())} />
            <Row k={tx("Last visit")} v={ago(p.lastSeenAt)} />
            <Row k={tx("Visits (30 days)")} v={p.visits30d} />
            <Row k={tx("Device")} v={p.client ? `${p.client.device} · ${p.client.os}${p.client.standalone ? " · app" : ""}` : "—"} />
            <Row k={tx("Language · unit")} v={p.client ? `${p.client.lang} · °${p.client.unit.toUpperCase()}` : "—"} />
            <Row k={tx("Eight Sleep sign-in")} v={p.signInOk ? tx("OK") : tx("Expired")} warn={!p.signInOk} />
            <Row k={tx("Phones with notifications")} v={p.phones} />
            <Row k={tx("Pod")} v={p.pod ? `${p.pod.online === false ? tx("offline") : tx("online")}${p.pod.hasWater === false ? ` · ${tx("no water")}` : ""} · ${ago(p.pod.at)}` : "—"} warn={p.pod?.online === false || p.pod?.hasWater === false} />
            <Row k={tx("Away")} v={p.away ? tx("On") : tx("Off")} />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Schedules")}</p>
            {p.schedules.length ? (
              p.schedules.map((s) => <Row key={s.side} k={tx(s.side === "both" ? "Whole bed" : s.side === "left" ? "Left" : "Right")} v={`${s.bedTime} → ${s.wakeupTime} · ${s.on ? tx("on") : tx("off")}`} />)
            ) : (
              <p className="text-xs text-slate-500">{tx("No schedule yet")}</p>
            )}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Most used (30 days)")}</p>
            <Counts items={p.features} />
          </div>
          {!!p.lastErrors.length && (
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Last errors")}</p>
              {p.lastErrors.map((e, i) => (
                <p key={i} className="text-xs text-slate-500">
                  {ago(e.at)} · {e.message}
                </p>
              ))}
            </div>
          )}
          <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
            <p className="mb-2 text-sm font-bold">{tx("Send them a message")}</p>
            <div className="mb-2 flex gap-1.5">
              {(["push", "email"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={v === "email" ? !p.canEmail : !p.phones}
                  onClick={() => setVia(v)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold disabled:opacity-40 ${via === v ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-200 dark:border-slate-700"}`}
                >
                  {v === "push" ? tx("Notification") : tx("Email")}
                </button>
              ))}
            </div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="mb-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" />
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={3} placeholder={tx("Write a short message")} className="block w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
            <button
              type="button"
              disabled={send.isPending || !text.trim() || (via === "email" ? !p.canEmail : !p.phones)}
              onClick={() => send.mutate({ email: p.email, via, title, text })}
              className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-xs font-extrabold text-white disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {tx("Send")}
            </button>
            {!p.phones && <p className="mt-1 text-[11px] text-slate-500">{tx("They haven't turned on notifications.")}</p>}
            {!p.canEmail && <p className="mt-1 text-[11px] text-slate-500">{tx("Set up approval emails under Invites to email people.")}</p>}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Owner only: how people use the app and how it's running. No one's sleep or health data. */
export const StatsPage: React.FC = () => {
  const q = apiR.stats.getStats.useQuery(undefined, { retry: false, refetchInterval: 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  const s = q.data;
  if (q.isLoading) return <p className="text-sm text-slate-500">{tx("Loading…")}</p>;
  if (!s) return <p className="text-sm text-slate-500">{q.error?.message ?? tx("Couldn't load the statistics.")}</p>;
  const lastCron = s.lastCronRunAt ? (Date.now() - new Date(s.lastCronRunAt).getTime()) / 60_000 : null;
  const sum = (k: Exclude<keyof Stats["daily"][number], "day">) => s.daily.reduce((a, d) => a + d[k], 0);

  return (
    <div className="space-y-4">
      <p className="px-1 text-xs text-slate-500">{tx("How people use the app and how it runs. No one's sleep or health data is shown here.")}</p>

      {/* right now */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label={tx("Open now")} value={s.liveNow} />
        <Tile label={tx("Today")} value={s.activeToday} sub={tx("{n} this week", { n: s.activeWeek })} />
        <Tile label={tx("People")} value={s.total} sub={s.newThisWeek ? tx("+{n} this week", { n: s.newThisWeek }) : undefined} />
      </div>

      {/* people */}
      <Card>
        <CardHeader
          icon={<Users className="h-5 w-5" />}
          title={tx("People")}
          subtitle={tx("{n} active this month · tap someone for details", { n: s.activeMonth })}
          action={
            <button type="button" onClick={() => exportCsv(s.people)} className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold dark:border-slate-700">
              <Download className="h-4 w-4" /> CSV
            </button>
          }
        />
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {s.people.map((p) => (
            <button key={p.email} type="button" onClick={() => setOpen(p.email)} className="flex w-full items-center justify-between gap-3 py-2 text-left">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {p.live && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title={tx("Open now")} />}
                  <span className="truncate">{p.name ?? p.email}</span>
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {p.device ?? tx("no visit yet")} · {p.hasSchedule ? (p.following ? tx("schedule on") : tx("schedule off")) : tx("no schedule")}
                </span>
              </span>
              <span className="shrink-0 text-right text-[11px]">
                <span className={p.inactive ? "font-bold text-amber-600 dark:text-amber-400" : "text-slate-500"}>{ago(p.lastSeenAt)}</span>
                {(!p.signInOk || p.errors7d > 0) && (
                  <span className="block text-rose-500">{!p.signInOk ? tx("sign-in expired") : tx("{n} errors", { n: p.errors7d })}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader icon={<UserCheck className="h-5 w-5" />} title={tx("Sign-ups and who stays")} subtitle={tx("Last 8 weeks")} />
        <Bars data={s.signups.map((w) => ({ label: short(w.week), n: w.n, title: `${short(w.week)}: ${w.n}` }))} />
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {s.cohorts.filter((c) => c.joined).map((c) => (
            <Row key={c.week} k={tx("Week of {date}", { date: short(c.week) })} v={tx("{a} of {b} still active", { a: c.stillActive, b: c.joined })} />
          ))}
        </div>
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          <Row k={tx("Requests waiting")} v={s.requests.waiting} warn={s.requests.waiting > 0} />
          <Row k={tx("Asked to join (90 days)")} v={s.requests.asked} />
          <Row k={tx("Approved · denied")} v={`${s.requests.approved} · ${s.requests.denied}`} />
          <Row k={tx("On the invite list")} v={s.requests.invited} />
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Smartphone className="h-5 w-5" />} title={tx("Devices")} subtitle={tx("{n} use the installed app", { n: s.installed })} />
        <div className="grid grid-cols-2 gap-4">
          <Counts items={s.devices} />
          <Counts items={s.systems} />
          <Counts items={s.languages} />
          <Counts items={s.units} />
        </div>
      </Card>

      {/* how they use it */}
      <Card>
        <CardHeader icon={<Sparkles className="h-5 w-5" />} title={tx("How they use it")} subtitle={tx("Last 30 days")} />
        <div className="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
          <Row k={tx("With a schedule")} v={`${s.withSchedule} / ${s.total}`} />
          <Row k={tx("Following it")} v={s.following} />
          <Row k={tx("Manual changes per night")} v={s.manualPerNight ?? "—"} warn={(s.manualPerNight ?? 0) > 2} />
          <Row k={tx("WHOOP connected")} v={s.whoop} />
          <Row k={tx("Notifications on")} v={s.notificationsOn} />
          <Row k={tx("Average levels")} v={`${s.avgLevels.initial !== null ? formatLevel(Math.round(s.avgLevels.initial) * 10) : "—"} · ${s.avgLevels.mid !== null ? formatLevel(Math.round(s.avgLevels.mid) * 10) : "—"} · ${s.avgLevels.final !== null ? formatLevel(Math.round(s.avgLevels.final) * 10) : "—"}`} />
        </div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Most used features")}</p>
        <Counts items={s.features} />
        <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Bedtimes")}</p>
        <Counts items={s.bedHours.map((b) => ({ key: `${b.key}:00`, n: b.n }))} />
      </Card>

      <Card>
        <CardHeader icon={<Gauge className="h-5 w-5" />} title={tx("Getting started")} />
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <Row k={tx("Finished the setup checklist")} v={`${s.checklist.finished} / ${s.checklist.reported}`} />
          <Row k={tx("Finished the tour")} v={s.tour.done} />
        </div>
        <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Checklist steps still missing")}</p>
        <Counts items={s.checklist.stuckOn} />
        <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Tour skipped at step")}</p>
        <Counts items={s.tour.skipped} />
      </Card>

      {/* app health */}
      <Card>
        <CardHeader
          icon={<Activity className="h-5 w-5" />}
          title={tx("Schedule checks")}
          subtitle={lastCron === null ? tx("Never ran") : tx("Last run {when}", { when: ago(s.lastCronRunAt) })}
        />
        {lastCron !== null && lastCron > 20 && (
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-rose-500">
            <AlertTriangle className="h-4 w-4" /> {tx("cron-job.org hasn't called in over 20 minutes")}
          </p>
        )}
        <p className="mb-1 text-[11px] text-slate-500">{tx("Checks per hour, last 48 hours (red = none)")}</p>
        <Bars data={s.hours.map((h) => ({ label: h.at, n: h.checks, title: `${new Date(h.at).toLocaleString(txLocale(), { weekday: "short", hour: "2-digit" })}: ${h.checks}` }))} warnZero height={48} />
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {s.perNight.map((n) => (
            <Row key={n.day} k={short(n.day)} v={`${tx("{n} changes", { n: n.changes })}${n.errors ? ` · ${tx("{n} errors", { n: n.errors })}` : ""}`} warn={n.errors > 0} />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Radio className="h-5 w-5" />} title={tx("Calls to Eight Sleep")} subtitle={tx("{n} in 14 days · {e} errors", { n: sum("eightCalls"), e: sum("eightErrors") })} />
        <Bars data={s.daily.map((d) => ({ label: short(d.day), n: d.eightCalls, title: `${short(d.day)}: ${d.eightCalls} · ${d.eightErrors} errors` }))} />
        <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Errors by type (HTTP code)")}</p>
        <Counts items={s.errorTypes.map((e) => ({ key: e.key === "401" || e.key === "403" ? `${e.key} sign-in` : e.key === "429" ? "429 too many" : e.key, n: e.n }))} empty={tx("No errors.")} />
      </Card>

      <Card>
        <CardHeader icon={<Cpu className="h-5 w-5" />} title={tx("Speed")} subtitle={s.avgLoadMs !== null ? tx("Average start-up {s} s", { s: (s.avgLoadMs / 1000).toFixed(1) }) : undefined} />
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("Slow answers (over 2 s, last 7 days)")}</p>
        {s.slowest.length ? (
          s.slowest.slice(0, 8).map((x) => <Row key={x.path} k={x.path} v={`${x.times}× · ${(x.avgMs / 1000).toFixed(1)} s`} warn={x.avgMs > 5000} />)
        ) : (
          <p className="text-xs text-slate-500">{tx("Nothing slow.")}</p>
        )}
      </Card>

      <Card>
        <CardHeader icon={<Bell className="h-5 w-5" />} title={tx("Notifications and emails")} subtitle={tx("Last 14 days")} />
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <Row k={tx("Notifications sent")} v={sum("pushSent")} />
          <Row k={tx("Phones dropped (expired)")} v={sum("pushDropped")} warn={sum("pushDropped") > 0} />
          <Row k={tx("Approval emails sent")} v={sum("emailsSent")} />
          <Row k={tx("Emails that failed")} v={sum("emailsFailed")} warn={sum("emailsFailed") > 0} />
        </div>
        <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx("By kind")}</p>
        <Counts items={s.pushKinds} />
      </Card>

      <Card>
        <CardHeader icon={<Mail className="h-5 w-5" />} title={tx("Pods")} subtitle={tx("As last seen in the app")} />
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <Row k={tx("Online")} v={s.pods.online} />
          <Row k={tx("Offline")} v={s.pods.offline} warn={s.pods.offline > 0} />
          <Row k={tx("Water tank empty")} v={s.pods.noWater} warn={s.pods.noWater > 0} />
          <Row k={tx("Needs priming")} v={s.pods.needsPriming} warn={s.pods.needsPriming > 0} />
          <Row k={tx("Not seen yet")} v={s.pods.unknown} />
          <Row k={tx("Away mode on")} v={s.away} />
          <Row k={tx("Napping now")} v={s.napping} />
          <Row k={tx("Eight Sleep sign-in expired")} v={s.signInExpired.length} warn={s.signInExpired.length > 0} />
        </div>
        {!!s.signInExpired.length && <p className="mt-1 text-[11px] text-slate-500">{s.signInExpired.join(", ")}</p>}
      </Card>

      <PersonSheet email={open} onClose={() => setOpen(null)} />
    </div>
  );
};
