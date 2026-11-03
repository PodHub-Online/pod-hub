"use client";

import React from "react";
import { apiR } from "~/trpc/react";
import { useToast } from "~/components/ui/toast";
import { haptic } from "~/lib/clientStorage";
import { Coffee, Loader2, Wind } from "lucide-react";
import { tx } from "~/lib/i18n";

type Mode = "nap-mode" | "hot-flash-mode";

/** The pod's built-in Nap and Hot-flash modes. Hidden if the API refuses them. */
export const QuickModes: React.FC<{ emptyText?: string }> = ({ emptyText }) => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const modesQuery = apiR.user.getQuickModes.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const mutation = apiR.user.setQuickMode.useMutation({
    onSuccess: async (_d, vars) => {
      haptic(20);
      await Promise.all([utils.user.getQuickModes.invalidate(), utils.user.getPodStatus.invalidate()]);
      const name = vars.mode === "nap-mode" ? tx("Nap mode") : tx("Hot-flash mode");
      toast(vars.action === "deactivate" ? tx("{name} off", { name }) : vars.action === "extend" ? tx("{name} extended", { name }) : tx("{name} on", { name }));
    },
    onError: (e) => toast(e.message, "error"),
  });

  const modes = modesQuery.data;
  if (modesQuery.isLoading) return null;
  if (!modes || (!modes.nap.supported && !modes.hotFlash.supported)) {
    return emptyText ? <p className="text-xs text-slate-500 dark:text-slate-400">{emptyText}</p> : null;
  }

  const items: { mode: Mode; label: string; hint: string; icon: React.ElementType; active: boolean | null; supported: boolean }[] = [
    { mode: "nap-mode", label: tx("Nap"), hint: tx("Pod's nap routine"), icon: Coffee, active: modes.nap.active, supported: modes.nap.supported },
    { mode: "hot-flash-mode", label: tx("Hot flash"), hint: tx("Quick burst of cooling"), icon: Wind, active: modes.hotFlash.active, supported: modes.hotFlash.supported },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {items
        .filter((i) => i.supported)
        .map(({ mode, label, hint, icon: Icon, active }) => {
          const pending = mutation.isPending && mutation.variables?.mode === mode;
          return (
            <div
              key={mode}
              className={`rounded-3xl border p-4 transition ${
                active
                  ? "border-indigo-400 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40"
                  : "border-slate-200/80 bg-white/90 dark:border-slate-800/80 dark:bg-slate-900/70"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-indigo-500" />
                <span className="text-sm font-extrabold">{label}</span>
                {active && <span className="ml-auto rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">On</span>}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
              <div className="mt-3 flex gap-1.5">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => mutation.mutate({ mode, action: active ? "deactivate" : "activate" })}
                  className={`inline-flex h-10 flex-1 items-center justify-center rounded-2xl text-xs font-bold transition active:scale-95 disabled:opacity-50 ${
                    active ? "border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200" : "bg-indigo-600 text-white"
                  }`}
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? tx("Stop") : tx("Start")}
                </button>
                {active && mode === "nap-mode" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => mutation.mutate({ mode, action: "extend" })}
                    className="h-10 rounded-2xl border border-indigo-200 px-3 text-xs font-bold text-indigo-700 active:scale-95 dark:border-indigo-800 dark:text-indigo-300"
                  >
                    {tx("Extend")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
};
