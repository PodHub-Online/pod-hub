"use client";

import React, { useEffect, useState } from "react";
import { Bell, CloudSun, Compass, Loader2, MapPin, Plane, Volume2 } from "lucide-react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader } from "~/components/ui/card";
import { useToast } from "~/components/ui/toast";
import { ACCENTS, ACCENT_KEY, ACCENT_NAMES, applyAccent, swatch, type Accent } from "~/lib/accents";
import { haptic, readStorage, SOUNDS_KEY, VIBRATION_KEY, writeStorage } from "~/lib/clientStorage";
import { tick } from "~/lib/sounds";
import { TOUR_KEY } from "~/components/firstTour";
import { tx } from "~/lib/i18n";
import { formatC, useTempUnit } from "~/lib/tempUnit";

/** An on/off switch like the rest of Settings. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-indigo-500" : "bg-slate-300 dark:bg-slate-700"}`}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`} />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-bold">{title}</p>
        {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Keeps the page's accent in step with the account (and remembers it on this phone for the first paint). */
export const AccentSync: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const extras = apiR.fun.getExtras.useQuery(undefined, { enabled, staleTime: 5 * 60_000 });
  useEffect(() => {
    const saved = readStorage(ACCENT_KEY) as Accent | null;
    if (saved && ACCENTS.includes(saved)) applyAccent(saved);
  }, []);
  useEffect(() => {
    const a = extras.data?.accent;
    if (!a) return;
    applyAccent(a);
    writeStorage(ACCENT_KEY, a);
  }, [extras.data?.accent]);
  return null;
};

export const AccentCard: React.FC = () => {
  const utils = apiR.useUtils();
  const extras = apiR.fun.getExtras.useQuery(undefined, { staleTime: 5 * 60_000 });
  const set = apiR.fun.setAccent.useMutation({ onSuccess: () => utils.fun.getExtras.invalidate() });
  const current = extras.data?.accent ?? "classic";
  return (
    <Card>
      <CardHeader icon={<span className="h-5 w-5 rounded-full" style={{ background: swatch(current) }} />} title={tx("Accent color")} subtitle={tx("Buttons, icons and highlights")} />
      <div className="grid grid-cols-5 gap-2">
        {ACCENTS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => {
              haptic();
              applyAccent(a);
              writeStorage(ACCENT_KEY, a);
              set.mutate({ accent: a });
            }}
            className={`flex flex-col items-center gap-1 rounded-2xl p-2 text-[11px] font-bold transition active:scale-95 ${current === a ? "bg-slate-100 ring-2 ring-indigo-500 dark:bg-slate-800" : ""}`}
          >
            <span className="h-8 w-8 rounded-full shadow-inner" style={{ background: swatch(a) }} />
            {tx(ACCENT_NAMES[a])}
          </button>
        ))}
      </div>
    </Card>
  );
};

/** Sounds and vibration, saved on this phone. */
export const FeedbackCard: React.FC = () => {
  const [sounds, setSounds] = useState(true);
  const [vibe, setVibe] = useState(true);
  useEffect(() => {
    setSounds(readStorage(SOUNDS_KEY) !== "off");
    setVibe(readStorage(VIBRATION_KEY) !== "off");
  }, []);
  return (
    <Card>
      <CardHeader icon={<Volume2 className="h-5 w-5" />} title={tx("Sounds & vibration")} subtitle={tx("A soft click on − / +, a chime when a side reaches its temperature")} />
      <Row title={tx("Sounds")}>
        <Switch
          on={sounds}
          label={tx("Sounds")}
          onChange={(v) => {
            setSounds(v);
            writeStorage(SOUNDS_KEY, v ? null : "off");
            if (v) tick();
          }}
        />
      </Row>
      <Row title={tx("Vibration")}>
        <Switch
          on={vibe}
          label={tx("Vibration")}
          onChange={(v) => {
            setVibe(v);
            writeStorage(VIBRATION_KEY, v ? null : "off");
            if (v) haptic(20);
          }}
        />
      </Row>
    </Card>
  );
};

/** Hot-night thresholds, saved in °C: from 80°F up in °F, from 27°C up in °C. */
const HOT_STEPS: Record<"f" | "c", { c: number; label: string }[]> = {
  f: [80, 82, 84, 86, 88].map((f) => ({ c: Math.round(((f - 32) / 1.8) * 2) / 2, label: `${f}°F` })),
  c: [27, 28, 29, 30, 31].map((c) => ({ c, label: `${c}°C` })),
};

/** The notification switches, in groups; the last group only shows for the owner. */
const KIND_GROUPS: { title: string; owner?: boolean; kinds: Record<string, [string, string]> }[] = [
  {
    title: "Your Pod",
    kinds: {
      water: ["Pod needs water", "When the tank runs empty"],
      priming: ["Priming done", "When the Pod is ready again"],
      offline: ["Pod went offline", "When it loses Wi-Fi or power during the night"],
      schedule: ["Schedule didn't run", "When Eight Sleep refuses tonight's change"],
      signin: ["Sign in again", "When Eight Sleep stops accepting your sign-in"],
      lefton: ["Bed left on", "When it was still on after wake-up and got turned off"],
      notreached: ["Not at temperature", "When a side is still far off an hour after bedtime"],
      whoop: ["WHOOP disconnected", "When WHOOP stops sending your nights"],
    },
  },
  {
    title: "Your night",
    kinds: {
      bedtime: ["Bedtime reminder", "15 minutes before pre-cool starts"],
      hotnight: ["Hot night tonight", "When cooling will start early tonight"],
      morning: ["Morning summary", "After wake-up: how last night's schedule went"],
      hold: ["Schedule paused", "After a manual change: when the schedule takes over again"],
      nap: ["Nap done", "When a nap ends and the bed turns off"],
      vacation: ["Away ending", "A day before Away mode ends"],
    },
  },
  {
    title: "Extras",
    kinds: {
      digest: ["Weekly digest", "Sunday morning: last week's nights in one line"],
      autotune: ["Auto-tune suggestion", "Sundays, when it finds a better level"],
      streak: ["Streaks", "7, 14, 30… nights on schedule in a row"],
      monthly: ["Monthly report", "On the 1st, when last month's report is ready"],
      news: ["What's new", "When there's an app update worth knowing"],
    },
  },
  {
    title: "Owner",
    owner: true,
    kinds: {
      owner_request: ["Someone asked to join", "Answer it in Settings → Invites"],
      owner_signins: ["People signing in", "New users and sign-ins since the last check, every 5 minutes"],
      owner_feedback: ["New feedback", "When someone sends a note"],
      owner_cron: ["Schedule check stopped", "When cron-job.org hasn't called in 20 minutes"],
      owner_errors: ["Eight Sleep errors piling up", "When several schedules fail at once"],
      owner_daily: ["Daily summary", "Each morning: people, errors, what's waiting"],
    },
  },
];

/** base64url → bytes, for the push key */
const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Settings → Smart features: weather, travel, notifications, the tour. */
export const SmartFeatures: React.FC<{ demo: boolean }> = ({ demo }) => {
  const toast = useToast();
  const unit = useTempUnit();
  const utils = apiR.useUtils();
  const extras = apiR.fun.getExtras.useQuery();
  const isOwner = apiR.user.getAccount.useQuery(undefined, { staleTime: 60_000 }).data?.isOwner === true;
  const refresh = () => utils.fun.getExtras.invalidate();
  const onError = (e: { message: string }) => toast(e.message, "error");
  const setHome = apiR.fun.setHome.useMutation({ onSuccess: refresh, onError });
  const setWeather = apiR.fun.setWeather.useMutation({ onSuccess: refresh, onError });
  // hot nights: the room sensor (no location) and/or the weather forecast at home
  const roomQuery = apiR.more.getRoom.useQuery();
  const room = roomQuery.data;
  const setRoom = apiR.more.setRoom.useMutation({ onSuccess: () => utils.more.getRoom.invalidate(), onError });
  const setTravel = apiR.fun.setTravel.useMutation({ onSuccess: refresh, onError });
  const setNotify = apiR.fun.setNotify.useMutation({ onSuccess: refresh, onError });
  const subscribe = apiR.fun.subscribePush.useMutation({ onSuccess: refresh, onError });
  const unsubscribe = apiR.fun.unsubscribePush.useMutation({ onSuccess: refresh, onError });
  const test = apiR.fun.testPush.useMutation({
    onSuccess: (d) =>
      d.sent
        ? toast(tx("Sent. It should show up in a moment."))
        : d.errors.length
        ? toast(d.errors[0]!, "error")
        : toast(tx("No phone is set up yet"), "error"),
    onError,
  });
  const [locating, setLocating] = useState(false);
  const [thisPhone, setThisPhone] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const pushSupported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    if (!pushSupported) return;
    void navigator.serviceWorker.getRegistration("/").then(async (r) => {
      const sub = await r?.pushManager.getSubscription();
      setThisPhone(!!sub);
      // the server can forget a phone (Apple or Google said it expired once): register it again, quietly
      if (sub && !demo) subscribe.mutate({ endpoint: sub.endpoint, quiet: true });
    });
  }, [pushSupported]);

  const locate = () => {
    if (!navigator.geolocation) return toast(tx("This phone can't share its location"), "error");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (g) => {
        setLocating(false);
        setHome.mutate({ lat: g.coords.latitude, lon: g.coords.longitude }, { onSuccess: () => toast(tx("Home saved (rounded to about 1 km)")) });
      },
      () => {
        setLocating(false);
        toast(tx("Location wasn't allowed"), "error");
      },
      { timeout: 15_000 },
    );
  };

  const turnOnPush = async () => {
    setPushBusy(true);
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error(tx("Notifications weren't allowed on this phone"));
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const { key } = await utils.fun.getPushKey.fetch();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      await subscribe.mutateAsync({ endpoint: sub.endpoint });
      setThisPhone(true);
      toast(tx("Notifications are on for this phone"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setPushBusy(false);
    }
  };
  const turnOffPush = async () => {
    setPushBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
      if (sub) {
        await unsubscribe.mutateAsync({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setThisPhone(false);
    } finally {
      setPushBusy(false);
    }
  };

  const x = extras.data;
  const hotOn = !!room?.enabled || !!x?.weatherEnabled;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<MapPin className="h-5 w-5" />}
          title={tx("Home")}
          subtitle={x?.hasHome ? tx("Saved. Used for the weather and travel checks.") : tx("Needed for the weather and travel checks. Asked once, rounded to about 1 km.")}
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={locating || setHome.isPending}
            onClick={locate}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-xs font-bold text-white transition active:scale-95 disabled:opacity-50"
          >
            {(locating || setHome.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
            {x?.hasHome ? tx("I'm home: update it") : tx("I'm home: use my location")}
          </button>
          {x?.hasHome && (
            <button type="button" onClick={() => setHome.mutate(null)} className="h-10 rounded-2xl border border-slate-200 px-3 text-xs font-bold dark:border-slate-700">
              {tx("Forget")}
            </button>
          )}
        </div>
      </Card>

      {/* one setting, two ways to spot a hot night: the Pod's own room sensor and the forecast at home */}
      <Card>
        <CardHeader
          icon={<CloudSun className="h-5 w-5" />}
          title={tx("Hot nights")}
          subtitle={tx("On a hot night, cooling starts 30 minutes earlier and falling asleep is one step colder.")}
          action={
            <Switch
              on={hotOn}
              label={tx("Hot nights")}
              onChange={(v) => {
                setRoom.mutate({ enabled: v, threshold: room?.threshold ?? 26.5 });
                if (!v || x?.hasHome) setWeather.mutate({ enabled: v && !!x?.hasHome });
              }}
            />
          }
        />
        {hotOn && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <Row title={tx("Your Pod's room sensor")} hint={room?.lastC !== null && room?.lastC !== undefined ? tx("Last night: {temp}", { temp: formatC(room.lastC, unit) }) : tx("No location needed")}>
              <Switch on={!!room?.enabled} label={tx("Your Pod's room sensor")} onChange={(v) => setRoom.mutate({ enabled: v, threshold: room?.threshold ?? 26.5 })} />
            </Row>
            <div className="py-2">
              <span className="text-xs text-slate-500">{tx("A night counts as hot from")}</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {HOT_STEPS[unit].map(({ c, label }) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setRoom.mutate({ enabled: !!room?.enabled, threshold: c })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-bold ${Math.abs((room?.threshold ?? 26.5) - c) < 0.3 ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Row
              title={tx("Weather forecast at home")}
              hint={
                !x?.hasHome
                  ? tx("Save Home above to use it")
                  : x.weather
                  ? `${tx("Tonight: {temp} at 22:00", { temp: formatC(x.weather.evening, unit, 0) })} · ${x.weather.hot ? tx("hot night") : tx("normal night")}`
                  : tx("From Open-Meteo, no account needed")
              }
            >
              <Switch on={!!x?.weatherEnabled} disabled={!x?.hasHome} label={tx("Weather forecast at home")} onChange={(v) => setWeather.mutate({ enabled: v })} />
            </Row>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          icon={<Plane className="h-5 w-5" />}
          title={tx("Smart travel")}
          subtitle={tx("When you open the app far from home, it offers Away; back home, it turns Away off. Your location is checked only then, and never saved.")}
          action={<Switch on={!!x?.travelEnabled} disabled={!x?.hasHome} label={tx("Smart travel")} onChange={(v) => setTravel.mutate({ enabled: v })} />}
        />
      </Card>

      <Card>
        <CardHeader icon={<Bell className="h-5 w-5" />} title={tx("Phone notifications")} subtitle={tx("Only things that matter. Each one can be switched off.")} />
        {demo ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{tx("Not in the demo.")}</p>
        ) : !pushSupported ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{tx("This browser can't get notifications. On iPhone, add the app to your Home Screen first.")}</p>
        ) : (
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              disabled={pushBusy}
              onClick={() => void (thisPhone ? turnOffPush() : turnOnPush())}
              className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl text-xs font-bold transition active:scale-95 disabled:opacity-50 ${thisPhone ? "border border-slate-200 dark:border-slate-700" : "bg-indigo-600 text-white"}`}
            >
              {pushBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {thisPhone ? tx("Turn off on this phone") : tx("Turn on for this phone")}
            </button>
            {thisPhone && (
              <button type="button" disabled={test.isPending} onClick={() => test.mutate()} className="h-10 rounded-2xl border border-slate-200 px-3 text-xs font-bold dark:border-slate-700">
                {tx("Send a test")}
              </button>
            )}
          </div>
        )}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {KIND_GROUPS.filter((g) => !g.owner || isOwner).map((g) => (
            <div key={g.title} className="py-1">
              <p className="pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">{tx(g.title)}</p>
              {Object.entries(g.kinds).map(([kind, [title, hint]]) => (
                <Row key={kind} title={tx(title)} hint={tx(hint)}>
                  <Switch
                    on={x?.notify[kind as keyof NonNullable<typeof x>["notify"]] ?? false}
                    label={tx(title)}
                    onChange={(v) => setNotify.mutate({ kind, enabled: v })}
                  />
                </Row>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<Compass className="h-5 w-5" />}
          title={tx("Quick tour")}
          subtitle={tx("The short tour new people see the first time")}
          action={
            <button
              type="button"
              onClick={() => {
                writeStorage(TOUR_KEY, null);
                window.dispatchEvent(new Event("podhub-tour"));
              }}
              className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-bold dark:border-slate-700"
            >
              {tx("Show")}
            </button>
          }
        />
      </Card>
    </div>
  );
};
