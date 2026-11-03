"use client";

import { useEffect } from "react";
import { apiR } from "~/trpc/react";
import { readStorage } from "~/lib/clientStorage";
import { txLocale } from "~/lib/i18n";

// while the app is open, it says so this often (owner statistics: last visit, "open now")
const EVERY_MS = 2 * 60_000;

/** What this device is: phone or computer, its system, installed app or browser, language, unit. */
function clientInfo(): { device: "phone" | "tablet" | "computer"; os: string; standalone: boolean; lang: string; unit: "f" | "c" } {
  const ua = navigator.userAgent;
  const device = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "phone" : "computer";
  const os = /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "other";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    device,
    os,
    standalone,
    lang: txLocale().slice(0, 2),
    unit: readStorage("podhub-unit") === "c" ? "c" : "f",
  };
}

/** Tells the server the app is open: once a few seconds after start, then every 2 minutes while it's showing. */
export function Heartbeat() {
  const beat = apiR.stats.heartbeat.useMutation();
  useEffect(() => {
    let first = true;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      // the setup checklist leaves its progress here (see SetupChecklist)
      const checklist = (window as Window & { __podhubChecklist?: { done: number; total: number; missing: string[] } }).__podhubChecklist;
      beat.mutate({ client: clientInfo(), loadMs: first ? Math.round(performance.now()) : undefined, checklist });
      first = false;
    };
    const start = setTimeout(send, 8_000);
    const every = setInterval(send, EVERY_MS);
    const onShow = () => document.visibilityState === "visible" && send();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(start);
      clearInterval(every);
      document.removeEventListener("visibilitychange", onShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
