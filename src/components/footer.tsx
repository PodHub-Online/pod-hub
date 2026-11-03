"use client";

import React from "react";
import { APP_NAME } from "~/lib/appName";
import { tx } from "~/lib/i18n";

// Shown on the sign-in screen. Credits live in Settings → About.
export const Footer: React.FC = () => (
  <footer className="w-full py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center text-[11px] text-slate-400 dark:text-slate-500">
    {APP_NAME} · {tx("Not affiliated with Eight Sleep.")}{" "}
    <a href="/privacy" className="underline">
      {tx("Privacy")}
    </a>
  </footer>
);
