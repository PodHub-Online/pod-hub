"use client";

// TEMPORARY: the "Demo weather" pill on the 3D bed. Tap it to step through the weathers.
// Shown in the demo, and for the administrator when switched on in Settings → Administrator.
// Remove it: see the note at the top of src/lib/skyOverride.ts.
import React from "react";
import { CloudSun, X } from "lucide-react";
import { apiR } from "~/trpc/react";
import { tx } from "~/lib/i18n";
import { DEMO_WEATHERS, nextDemoWeather, stopDemoWeather, useDemoWeatherEnabled, useDemoWeatherStep } from "~/lib/skyOverride";

export const SkySimulator: React.FC = () => {
  const account = apiR.user.getAccount.useQuery(undefined, { retry: false });
  const enabled = useDemoWeatherEnabled();
  const step = useDemoWeatherStep();
  const show = account.data?.demo === true || (account.data?.isOwner === true && enabled);
  if (!show) return null;
  const on = step >= 0;
  return (
    <div className="absolute bottom-2 left-2 z-20 flex items-center gap-1">
      <button
        type="button"
        onClick={nextDemoWeather}
        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-extrabold text-white backdrop-blur active:scale-95 ${on ? "border-indigo-300/50 bg-indigo-600/90" : "border-white/20 bg-black/55"}`}
      >
        <CloudSun className="h-3.5 w-3.5" />
        {on ? `${tx(DEMO_WEATHERS[step]!.label)} · ${step + 1}/${DEMO_WEATHERS.length}` : tx("Demo weather")}
      </button>
      {on && (
        <button type="button" onClick={stopDemoWeather} aria-label={tx("Back to the real sky")} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur active:scale-95">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
