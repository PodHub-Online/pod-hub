"use client";

import React, { useEffect, useState } from "react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader, Skeleton } from "~/components/ui/card";
import { useToast } from "~/components/ui/toast";
import { ThemeToggle } from "~/components/themeToggle";
import { LogoutButton } from "~/components/logout";
import { ActivityLog, actionText, stageName } from "~/components/activityLog";
import { CronUrlCheck } from "~/components/cronUrlCheck";
import { LedCard, OtherAccountNotice, PodHealthCard, usePodHealth } from "~/components/podHealthCard";
import { QuickModes } from "~/components/quickModes";
import { CapabilitiesCard } from "~/components/capabilitiesCard";
import { haptic } from "~/lib/clientStorage";
import {
  ArrowUpRight,
  Coffee,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Heart,
  History,
  Wind,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Palette,
  Palmtree,
  Play,
  PlayCircle,
  Timer,
  User,
  Users,
  Info,
  Plug,
  SlidersHorizontal,
  Sparkles,
  ShieldCheck,
  MessageSquare,
} from "lucide-react";
import { AccentCard, FeedbackCard, SmartFeatures } from "~/components/settingsExtras";
import { FeedbackPage, MailSetupCard, OwnerFeedback } from "~/components/newFeatures";
import { StatsPage } from "~/components/statsPage";
import { tx, txLocale } from "~/lib/i18n";
import { LanguagePicker } from "~/components/languagePicker";
import { LevelDisplayPicker, UnitPicker } from "~/components/unitPicker";
import { WhoopAppKeys, WhoopCard } from "~/components/whoopCard";
import { DemoAccountCard } from "~/components/demoBanner";
import { InvitesPanel } from "~/components/invitesPanel";
import { DisplayNameCard } from "~/components/displayNameCard";
import { ScheduleTimezoneCard } from "~/components/scheduleZone";
import { AdministratorPage } from "~/components/administratorPage"; // DEMO-WEATHER
import { DONATE_URL, donateService } from "~/lib/donate";
import { APP_NAME } from "~/lib/appName";

function useCopy() {
  const toast = useToast();
  return async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      haptic();
      toast(`${what} copied`);
    } catch {
      toast(tx("Couldn't copy. Long-press the text to copy it instead"), "error");
    }
  };
}

function CopyRow({
  label,
  value,
  display,
  secret,
}: {
  label: string;
  value: string;
  display?: string;
  secret?: boolean;
}) {
  const copy = useCopy();
  const [revealed, setRevealed] = useState(false);
  const shown = secret && !revealed ? "•".repeat(Math.min(24, Math.max(8, value.length))) : display ?? value;
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all font-mono text-xs text-slate-800 dark:text-slate-100">
          {shown || <span className="text-rose-500">Not set</span>}
        </code>
        {secret && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? tx("Hide") : tx("Reveal")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-700"
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          disabled={!value}
          onClick={() => copy(value, label)}
          aria-label={tx("Copy {what}", { what: label })}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white active:scale-95 disabled:opacity-40"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return tx("Never");
  return new Date(d).toLocaleString(txLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(d: Date | string | null | undefined) {
  if (!d) return null;
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return tx("just now");
  if (mins < 60) return tx("{n} min ago", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 48) return tx("{n} h ago", { n: hours });
  return tx("{n} days ago", { n: Math.round(hours / 24) });
}

function toDateInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** What the official Eight Sleep app says about Away mode, next to our Vacation mode. */
function EightAwayStatus({ vacationOn }: { vacationOn: boolean }) {
  const toast = useToast();
  const utils = apiR.useUtils();
  const health = apiR.user.getPodHealth.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const sync = apiR.user.setEightAwayMode.useMutation({
    onSuccess: async () => {
      await utils.user.getPodHealth.invalidate();
      toast(tx("Eight Sleep Away mode updated"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const away = health.data?.isAway ?? null;
  const mismatch = away !== null && away !== vacationOn;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white/60 px-3 py-2.5 text-xs dark:bg-slate-900/50">
      <span className="text-slate-600 dark:text-slate-300">
        Eight Sleep app:{" "}
        <strong className={mismatch ? "text-amber-600 dark:text-amber-400" : ""}>
          {health.isLoading ? tx("checking…") : away === null ? tx("unknown") : away ? tx("Away on") : tx("Away off")}
        </strong>
        {mismatch && <span className="block text-[11px] text-amber-700 dark:text-amber-300">Doesn&apos;t match Vacation mode here.</span>}
      </span>
      {mismatch && (
        <button
          type="button"
          disabled={sync.isPending}
          onClick={() => sync.mutate({ on: vacationOn })}
          className="h-9 shrink-0 rounded-xl bg-slate-700 px-3 text-xs font-bold text-white disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
        >
          {sync.isPending ? tx("Syncing…") : tx("Sync")}
        </button>
      )}
    </div>
  );
}

function VacationCard() {
  const toast = useToast();
  const utils = apiR.useUtils();
  const accountQuery = apiR.user.getAccount.useQuery();
  const account = accountQuery.data;
  const [untilDate, setUntilDate] = useState<string>("");

  const mutation = apiR.user.setVacationMode.useMutation({
    onSuccess: async (data, vars) => {
      haptic(20);
      await Promise.all([
        utils.user.getAccount.invalidate(),
        utils.user.getPodStatus.invalidate(),
        utils.user.getPodHealth.invalidate(),
      ]);
      toast(vars.enabled ? tx("Vacation mode on. Pod turned off") : tx("Schedule resumed"));
      if (!data.awaySynced)
        toast(
          data.awayError?.includes("403")
            ? tx("Vacation is on here. Eight Sleep's own Away mode refuses this account (needs the subscription), so it stays off there.")
            : tx("Couldn't update Eight Sleep's own Away mode"),
          "info",
        );
    },
    onError: (e) => toast(e.message, "error"),
  });

  const enabled = account?.vacationMode ?? false;

  const toggle = () => {
    if (enabled) {
      mutation.mutate({ enabled: false });
    } else {
      // Resume at the start of the chosen day (local time)
      const until = untilDate ? new Date(`${untilDate}T00:00:00`) : null;
      mutation.mutate({ enabled: true, until });
    }
  };

  return (
    <Card
      className={
        enabled
          ? "border-teal-300 bg-gradient-to-br from-teal-50 to-cyan-50 dark:border-teal-800 dark:from-teal-950/40 dark:to-cyan-950/30"
          : undefined
      }
    >
      <CardHeader
        icon={<Palmtree className="h-5 w-5" />}
        title={tx("Vacation mode")}
        subtitle={tx("Pauses the schedule and turns on Eight Sleep's Away mode. Schedule and presets stay saved.")}
        action={
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={tx("Vacation mode")}
            disabled={!account || mutation.isPending}
            onClick={toggle}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              enabled ? "bg-teal-500" : "bg-slate-300 dark:bg-slate-700"
            }`}
          >
            <span
              className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
                enabled ? "left-7" : "left-1"
              }`}
            />
          </button>
        }
      />
      {enabled ? (
        <p className="rounded-2xl bg-white/70 p-3 text-xs font-semibold text-teal-900 dark:bg-slate-900/50 dark:text-teal-100">
          {account?.vacationUntil
            ? tx("Paused. Automation resumes on {date}.", { date: new Date(account.vacationUntil).toLocaleDateString(txLocale(), { weekday: "long", month: "long", day: "numeric" }) })
            : tx("Paused until you turn it off.")}{" "}
          {tx("You can still control the pod manually from Home.")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="vacation-until" className="text-xs font-bold text-slate-600 dark:text-slate-300">
            {tx("Resume automatically on")}
          </label>
          <input
            id="vacation-until"
            type="date"
            min={toDateInput(new Date(Date.now() + 86400000))}
            value={untilDate}
            onChange={(e) => setUntilDate(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <span className="text-[11px] text-slate-400">{tx("(optional)")}</span>
        </div>
      )}
      <EightAwayStatus vacationOn={enabled} />
    </Card>
  );
}

function CronCard() {
  const toast = useToast();
  const utils = apiR.useUtils();
  const configQuery = apiR.user.getAppConfig.useQuery();
  const accountQuery = apiR.user.getAccount.useQuery();
  const config = configQuery.data;
  const lastRun = accountQuery.data?.lastCronRunAt;

  const runNow = apiR.user.runCronNow.useMutation({
    onSuccess: async (data) => {
      await Promise.all([
        utils.user.getAccount.invalidate(),
        utils.user.getPodStatus.invalidate(),
        utils.user.getCronHistory.invalidate(),
      ]);
      const failed = data.mine.some((r) => !r.logged);
      toast(failed ? tx("Check ran, but the log couldn't be written") : tx("Check ran and was logged"), failed ? "error" : "success");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const lastRunAgeMin = lastRun ? (Date.now() - new Date(lastRun).getTime()) / 60000 : Infinity;
  const healthy = lastRunAgeMin < 60;

  return (
    <Card>
      <CardHeader
        icon={<Timer className="h-5 w-5" />}
        title={tx("Cron job")}
        subtitle={tx("Use these values on cron-job.org (or any scheduler)")}
      />
      {!config ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-2">
          <div
            className={`flex items-center justify-between rounded-2xl px-3 py-2.5 text-xs font-semibold ${
              healthy
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-amber-500"}`} />
              {tx("Last run:")} {lastRun ? `${timeAgo(lastRun)} (${formatDateTime(lastRun)})` : tx("never recorded")}
            </span>
          </div>
          <CopyRow label="URL" value={config.cronUrl} />
          <CopyRow label={tx("Cron secret")} value={config.cronSecret} secret />
          <CopyRow
            label={`Header: ${config.cronHeaderName}`}
            value={config.cronHeaderValue}
            display={`Bearer ${"•".repeat(12)}`}
          />
          <p className="px-1 text-[11px] text-slate-500 dark:text-slate-400">
            {tx("Method")} <strong>GET</strong>, {tx("schedule")} <strong>{config.cronIntervalHint.toLowerCase()}</strong>.{" "}
            {tx("Add the header under Advanced → Headers, then run a test: it should return 200 OK.")}
          </p>
          <button
            type="button"
            // the owner runs it for everyone, like the 5-minute cron does
            onClick={() => runNow.mutate({ everyone: true })}
            disabled={runNow.isPending}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 text-xs font-bold text-indigo-700 transition active:scale-[0.98] disabled:opacity-50 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300"
          >
            {runNow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {tx("Run schedule check now")}
          </button>
          {runNow.data && (
            <div className="rounded-2xl border border-slate-200/80 p-3 text-xs dark:border-slate-800">
              <p className="mb-1 font-bold text-slate-700 dark:text-slate-200">
                {tx("Result")} · {new Date(runNow.data.ranAt).toLocaleTimeString(txLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
              {runNow.data.mine.length === 0 ? (
                <p className="text-amber-700 dark:text-amber-300">{tx("The check ran but didn't include your account.")}</p>
              ) : (
                runNow.data.mine.map((r, i) => (
                  <div key={i} className="space-y-0.5">
                    <p className={r.action === "error" ? "font-semibold text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300"}>
                      {stageName(r)} · {actionText(r)}
                    </p>
                    <p className={r.logged ? "text-emerald-600 dark:text-emerald-400" : "font-semibold text-rose-600 dark:text-rose-400"}>
                      {r.logged ? tx("✓ Saved to the activity log") : tx("✗ Not saved to the activity log: {error}", { error: r.logError ?? tx("unknown error") })}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AccountCard({ onLogoutSuccess }: { onLogoutSuccess: () => void }) {
  const accountQuery = apiR.user.getAccount.useQuery();
  const a = accountQuery.data;
  return (
    <Card>
      <CardHeader icon={<User className="h-5 w-5" />} title={tx("Account")} />
      {!a ? (
        <Skeleton className="h-24" />
      ) : (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">{tx("Email")}</dt>
            <dd className="truncate font-semibold">{a.email}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">{tx("Eight Sleep user")}</dt>
            <dd className="truncate font-mono text-xs">{a.eightUserId}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">{tx("Eight token renews")}</dt>
            <dd className="font-semibold">{formatDateTime(a.eightTokenExpiresAt)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">{tx("Member since")}</dt>
            <dd className="font-semibold">{new Date(a.memberSince).toLocaleDateString(txLocale())}</dd>
          </div>
        </dl>
      )}
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
        <span>{tx("This device stays signed in. Sign out only if it's not yours.")}</span>
        <LogoutButton onLogoutSuccess={onLogoutSuccess} className="ml-3 h-10 shrink-0" />
      </div>
      {a && !a.isOwner && <DeleteAccount email={a.email} onDeleted={onLogoutSuccess} />}
    </Card>
  );
}

/** Deletes everything the app keeps about you; you type your email to confirm. */
function DeleteAccount({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const del = apiR.user.deleteAccount.useMutation({
    onSuccess: () => {
      try {
        localStorage.removeItem("podhub-device-token");
      } catch {
        // storage blocked: nothing to clear
      }
      toast(tx("Your account and data were deleted"), "info");
      onDeleted();
    },
    onError: (e) => toast(e.message, "error"),
  });
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-xs font-bold text-rose-600 dark:text-rose-400">
        {tx("Delete my account and data")}
      </button>
    );
  }
  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-rose-200 p-3 text-xs dark:border-rose-900/60">
      <p className="text-slate-600 dark:text-slate-300">
        {tx("This removes your schedules, presets, activity log and WHOOP data from this app, and signs you out. Your Eight Sleep account isn't touched. Type your email to confirm.")}
      </p>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={email}
        autoCapitalize="none"
        autoCorrect="off"
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={del.isPending || typed.trim().toLowerCase() !== email.toLowerCase()}
          onClick={() => del.mutate({ confirmEmail: typed })}
          className="h-10 flex-1 rounded-xl bg-rose-600 font-bold text-white disabled:opacity-40"
        >
          {del.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : tx("Delete everything")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-xl px-3 font-bold text-slate-600 dark:text-slate-300">
          {tx("Cancel")}
        </button>
      </div>
    </div>
  );
}

type SettingsPage = "preferences" | "smart" | "vacation" | "activity" | "health" | "connections" | "account" | "invites" | "usage" | "admin" | "cron" | "whoopkeys" | "feedback" | "about";

/** The pages that live under Settings → Administrator (the back button returns there). */
const ADMIN_PAGES: SettingsPage[] = ["invites", "usage", "cron", "whoopkeys"];

function MenuRow({
  icon: Icon,
  title,
  summary,
  tone,
  onClick,
  external,
}: {
  icon: React.ElementType;
  title: string;
  summary: string;
  tone?: "warn" | "good";
  onClick: () => void;
  /** opens another site (shows an arrow out instead of a chevron) */
  external?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-slate-100 dark:active:bg-slate-800"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold text-slate-900 dark:text-slate-200">{title}</span>
        <span
          className={`block truncate text-xs ${
            tone === "warn"
              ? "font-semibold text-amber-600 dark:text-amber-400"
              : tone === "good"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {summary}
        </span>
      </span>
      {external ? <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
    </button>
  );
}

function AboutPage() {
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" className="h-14 w-14 rounded-2xl shadow-md ring-1 ring-white/10" />
          <div>
            <h2 className="text-lg font-black">{APP_NAME}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{tx("Your own schedule for your Pod, and a 3D view of your bed")}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          {tx("Your schedule lives in this app. A cron job calls it every few minutes, and each time it checks the clock and tells the pod what to do: turn on, change level, or turn off.")}
        </p>
        <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
          {tx("Install tip: in Chrome on Android open the menu → Install app. On iPhone use Safari → Share → Add to Home Screen. It stays signed in.")}
        </p>
      </Card>
      <Card>
        <CardHeader icon={<Heart className="h-5 w-5" />} title={tx("Credits")} />
        <ul className="space-y-3 text-sm">
          <li>
            Built on{" "}
            <a
              className="font-semibold text-indigo-600 underline dark:text-indigo-400"
              href="https://github.com/aerotow/eightsleep-nosub-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              eightsleep-nosub-app
            </a>{" "}
            by @aerotow. The original idea and scheduling core come from there.
          </li>
          <li className="text-slate-600 dark:text-slate-300">
            Eight Sleep API details from the open-source{" "}
            <a className="underline" href="https://github.com/lukas-clarke/eight_sleep" target="_blank" rel="noopener noreferrer">
              eight_sleep
            </a>
            ,{" "}
            <a className="underline" href="https://github.com/mezz64/pyEight" target="_blank" rel="noopener noreferrer">
              pyEight
            </a>{" "}
            and{" "}
            <a className="underline" href="https://github.com/steipete/eightctl" target="_blank" rel="noopener noreferrer">
              eightctl
            </a>{" "}
            projects.
          </li>
          <li className="text-xs text-slate-500 dark:text-slate-400">
            {tx("Unofficial project, not affiliated with Eight Sleep, Inc. The API it uses is undocumented and may change.")}{" "}
            <a href="/privacy" className="underline">
              {tx("Privacy")}
            </a>
          </li>
        </ul>
      </Card>
    </div>
  );
}

export const SettingsPanel: React.FC<{ onLogoutSuccess: () => void }> = ({ onLogoutSuccess }) => {
  const [page, setPage] = useState<SettingsPage | null>(null);
  const accountQuery = apiR.user.getAccount.useQuery();
  const healthQuery = usePodHealth();
  const account = accountQuery.data;
  const health = healthQuery.data;
  const demo = account?.demo === true;
  const owner = account?.isOwner === true;

  const open = (p: SettingsPage | null) => {
    setPage(p);
    window.scrollTo({ top: 0 });
  };

  // a page asked for from elsewhere (the Statistics button in the header)
  useEffect(() => {
    const take = () => {
      let want: string | null = null;
      try {
        want = sessionStorage.getItem("podhub-open-page");
        sessionStorage.removeItem("podhub-open-page");
      } catch {
        // nothing asked
      }
      if (want === "usage") open("usage");
    };
    take();
    window.addEventListener("podhub-open-page", take);
    return () => window.removeEventListener("podhub-open-page", take);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const whoop = apiR.whoop.getStatus.useQuery(undefined, { retry: false });
  const lastRunMin = account?.lastCronRunAt ? (Date.now() - new Date(account.lastCronRunAt).getTime()) / 60000 : null;
const vacationSummary = account?.vacationMode
    ? account.vacationUntil
      ? tx("On until {date}", { date: new Date(account.vacationUntil).toLocaleDateString(txLocale(), { month: "short", day: "numeric" }) })
      : tx("On")
    : tx("Off · pause everything while you're away");
  // the cron job is the owner's to look after
  const cronWarn = owner && (lastRunMin === null || lastRunMin > 20);
  const accountSummary = cronWarn
    ? lastRunMin === null
      ? tx("Cron job hasn't run yet")
      : tx("Cron job last ran {when}", { when: timeAgo(account.lastCronRunAt) ?? "" })
    : account?.email ?? tx("Email and sign-out");

  const podIssue = !health
    ? null
    : health.online === false
    ? tx("Offline")
    : health.hasWater === false
    ? tx("Water tank empty")
    : health.needsPriming
    ? tx("Needs priming")
    : null;
  const healthSummary = !health ? tx("Water, priming, both sides, device, supported features") : podIssue ?? tx("Online · water OK");

  const titles: Record<SettingsPage, string> = {
    vacation: tx("Vacation"),
    activity: tx("Activity log"),
    health: tx("Pod health"),
    account: demo ? tx("Demo") : tx("Account"),
    preferences: tx("Preferences"),
    smart: tx("Smart features"),
    connections: tx("Connections"),
    invites: tx("Invites"),
    usage: tx("Statistics"),
    admin: tx("Administrator"),
    cron: tx("Cron job"),
    whoopkeys: tx("WHOOP app keys"),
    feedback: tx("Send feedback"),
    about: tx("About"),
  };

  if (page) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => open(ADMIN_PAGES.includes(page) ? "admin" : null)}
            className="inline-flex h-10 items-center gap-1 rounded-2xl pr-3 text-sm font-bold text-indigo-600 active:scale-95 dark:text-indigo-400"
          >
            <ChevronLeft className="h-5 w-5" /> {ADMIN_PAGES.includes(page) ? tx("Administrator") : tx("Settings")}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-2xl font-black tracking-tight">{titles[page]}</h2>
        </div>

        {page === "vacation" && (
          <div>
            <VacationCard />
          </div>
        )}
        {page === "activity" && <ActivityLog />}
        {page === "health" && (
          <>
            <div className="space-y-4">
              <OtherAccountNotice />
              <PodHealthCard />
              <LedCard />
              <Card>
                <CardHeader icon={<Wind className="h-5 w-5" />} title={tx("Nap & hot flash")} subtitle={tx("The pod's quick modes. Also in Nightstand mode")} />
                <QuickModes emptyText={tx("Your account can't use Nap or Hot-flash mode (Eight Sleep refused them).")} />
              </Card>
            </div>
            <CapabilitiesCard />
          </>
        )}
        {page === "account" && demo && <DemoAccountCard />}
        {page === "account" && !demo && (
          <>
            <div className="space-y-4">
              <AccountCard onLogoutSuccess={onLogoutSuccess} />
            </div>
          </>
        )}
        {page === "preferences" && (
          <div className="space-y-4">
            {!demo && <DisplayNameCard />}
            <LanguagePicker />
            <ScheduleTimezoneCard />
            <UnitPicker />
            <LevelDisplayPicker />
            <Card>
              <CardHeader icon={<Palette className="h-5 w-5" />} title={tx("Appearance")} subtitle={tx("Light, dark, or follow your phone")} action={<ThemeToggle />} />
            </Card>
            <AccentCard />
            <FeedbackCard />
          </div>
        )}
        {page === "smart" && (
          <SmartFeatures demo={demo} />
        )}
        {page === "connections" && !demo && (
          <div>
            <WhoopCard />
          </div>
        )}
        {page === "invites" && owner && (
          <div className="space-y-4">
            <InvitesPanel />
            <MailSetupCard />
            <OwnerFeedback />
          </div>
        )}
        {page === "usage" && owner && <StatsPage />}
        {page === "admin" && owner && (
          <AdministratorPage
            pendingRequests={account?.pendingRequests ?? 0}
            cronSummary={cronWarn ? accountSummary : null}
            whoopConfigured={whoop.data?.configured ?? false}
            onOpen={(p) => open(p)}
          />
        )}
        {page === "cron" && owner && (
          <div className="space-y-4">
            <CronUrlCheck />
            <CronCard />
          </div>
        )}
        {page === "whoopkeys" && owner && <WhoopAppKeys />}
        {page === "feedback" && <FeedbackPage />}
        {page === "about" && <AboutPage />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="px-1 text-2xl font-black tracking-tight">{tx("Settings")}</h2>
      {owner && !demo && (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 dark:divide-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70">
          <MenuRow
            icon={ShieldCheck}
            title={tx("Administrator")}
            summary={account?.pendingRequests ? tx("{n} waiting for you", { n: account.pendingRequests }) : cronWarn ? accountSummary : tx("Invites, statistics, cron job, WHOOP keys")}
            tone={account?.pendingRequests || cronWarn ? "warn" : undefined}
            onClick={() => open("admin")}
          />
        </div>
      )}{/* DEMO-WEATHER */}
      <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 dark:divide-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70">
        <MenuRow
          icon={SlidersHorizontal}
          title={tx("Preferences")}
          summary={tx("Language, °F / °C, light or dark, colors, sounds")}
          onClick={() => open("preferences")}
        />
        <MenuRow
          icon={Sparkles}
          title={tx("Smart features")}
          summary={tx("Hot nights, travel, phone notifications")}
          onClick={() => open("smart")}
        />
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 dark:divide-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70">
        <MenuRow icon={Palmtree} title={tx("Vacation")} summary={vacationSummary} tone={account?.vacationMode ? "warn" : undefined} onClick={() => open("vacation")} />
        <MenuRow
          icon={History}
          title={tx("Activity log")}
          summary={tx("Every schedule check and every change, with details")}
          onClick={() => open("activity")}
        />
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 dark:divide-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70">
        <MenuRow icon={Cpu} title={tx("Pod health")} summary={healthSummary} tone={podIssue ? "warn" : undefined} onClick={() => open("health")} />
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 dark:divide-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70">
        {demo ? (
          <MenuRow icon={PlayCircle} title={tx("Demo")} summary={tx("What this is, and leaving the demo")} onClick={() => open("account")} />
        ) : (
          <>
            <MenuRow
              icon={Plug}
              title={tx("Connections")}
              summary={whoop.data?.connected ? tx("WHOOP · connected") : tx("WHOOP · not connected")}
              onClick={() => open("connections")}
            />
            <MenuRow icon={User} title={tx("Account")} summary={account?.email ?? tx("Email and sign-out")} onClick={() => open("account")} />
          </>
        )}
        <MenuRow icon={MessageSquare} title={tx("Send feedback")} summary={tx("Bugs, ideas, questions")} onClick={() => open("feedback")} />
        <MenuRow icon={Info} title={tx("About")} summary={tx("How it works and credits")} onClick={() => open("about")} />
      </div>
      {/* an optional tip link, only when this copy of the app has one (NEXT_PUBLIC_DONATE_URL) */}
      {DONATE_URL && (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 dark:divide-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70">
          <MenuRow
            icon={Coffee}
            title={tx("Support Pod Hub")}
            summary={donateService(DONATE_URL) ? tx("Optional tip · opens PayPal") : tx("Optional tip · opens in your browser")}
            external
            onClick={() => {
              const url = DONATE_URL;
              if (url) window.open(url, "_blank", "noopener,noreferrer");
            }}
          />
        </div>
      )}
    </div>
  );
};
