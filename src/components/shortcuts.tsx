"use client";

import { useEffect, useRef } from "react";
import { apiR } from "~/trpc/react";
import { useToast } from "~/components/ui/toast";
import { type AppTab } from "~/components/bottomNav";
import { tx } from "~/lib/i18n";

/**
 * Home-screen shortcuts (long-press the app icon; listed in manifest.ts) open "/?do=…".
 * Runs that action once, then drops it from the address so a reload doesn't repeat it.
 */
export function useShortcutAction(onTab: (t: AppTab) => void, onBedtime: () => void) {
  const toast = useToast();
  const utils = apiR.useUtils();
  const done = () => utils.user.getPodStatus.invalidate();
  const onError = (e: { message: string }) => toast(e.message, "error");
  const hot = apiR.fun.imHot.useMutation({ onSuccess: async () => { toast(tx("Cooling for 20 minutes")); await done(); }, onError });
  const off = apiR.user.setPodPower.useMutation({ onSuccess: async () => { toast(tx("Pod off")); await done(); }, onError });
  const nap = apiR.fun.startNap.useMutation({ onSuccess: async () => { toast(tx("Nap: 20 minutes")); await done(); }, onError });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const url = new URL(window.location.href);
    const action = url.searchParams.get("do");
    if (!action) return;
    url.searchParams.delete("do");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (action === "cool") hot.mutate({});
    else if (action === "off") off.mutate({ isOn: false });
    else if (action === "nap") nap.mutate({ minutes: 20, level: -20, warmLevel: 20 });
    else if (action === "plan") onTab("schedule");
    else if (action === "bedtime") onBedtime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
