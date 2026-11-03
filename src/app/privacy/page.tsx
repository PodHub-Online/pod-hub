"use client";

import React, { useEffect } from "react";
import { tx } from "~/lib/i18n";
import { APP_NAME } from "~/lib/appName";
import { trackPage } from "~/lib/analytics";

/** What the app keeps about you, in plain words. Linked from the sign-in screen and About. */
export default function PrivacyPage() {
  useEffect(() => trackPage("privacy"), []);
  const items = [
    tx("Your email, your first name (you can change it), and the Eight Sleep sign-in tokens the app uses to talk to your Pod. The tokens are stored encrypted. Your Eight Sleep password is never stored."),
    tx("Your schedules, presets and settings, and an activity log of what the app did (kept 7 days)."),
    tx("If you connect WHOOP: your WHOOP sign-in tokens (encrypted) and your recent sleep and recovery data."),
    tx("To slow down password guessing, failed sign-ins are counted for 10 minutes using scrambled fingerprints of the connection and email, deleted after a day."),
    tx("Usage, so the owner can keep the app running well: when you sign in and open the app, the kind of device (phone or computer, system, installed or browser), language and °F/°C, which features you use, and errors. Kept 90 days. The owner sees these counts and your last visit, never your sleep or health data, and no IP addresses are stored."),
    tx("If you ask to join, only your email and first name are kept until the owner answers (at most 30 days)."),
    tx("Google Analytics counts visits to the app's screens (which screen, the kind of device and browser, and the country), so the owner can see how the app is used. It never gets your email, name, schedule, sleep or health data. Google receives your connection's address to work out the country and sets a cookie to tell visits apart; Google's own privacy policy applies to that. Ads and Google signals are turned off."),
  ];
  return (
    <main className="mx-auto max-w-xl px-4 py-10 text-slate-700 dark:text-slate-300">
      <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100">{tx("Privacy")}</h1>
      <p className="mt-2 text-sm">
        {APP_NAME} · {tx("Not affiliated with Eight Sleep.")} {tx("It uses Eight Sleep's unofficial app interface, which can change at any time.")}
      </p>
      <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-slate-500">{tx("What's stored")}</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-slate-500">{tx("Deleting it")}</h2>
      <p className="mt-2 text-sm">
        {tx("Settings → Account → Delete my account and data removes everything above right away. Your Eight Sleep and WHOOP accounts themselves aren't touched.")}
      </p>
      <p className="mt-2 text-sm">{tx("Nothing is sold, and the app is free. Apart from the visit counts Google Analytics sees, nothing is shared.")}</p>
      <a href="/" className="mt-8 inline-block text-sm font-bold underline">
        {tx("Back to the app")}
      </a>
    </main>
  );
}
