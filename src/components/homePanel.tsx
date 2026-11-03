"use client";

import React from "react";
import { apiR } from "~/trpc/react";
import { PodControl } from "~/components/podControl";
import { BedDiagram } from "~/components/bedDiagram";
import { TonightCurves } from "~/components/tonightCurves";
import { useToast } from "~/components/ui/toast";
import { type AppTab } from "~/components/bottomNav";
import { useSide } from "~/components/sideContext";
import { SIDE_ORDER as ORDER, useSideSwipe } from "~/components/useSideSwipe";
import { SidePeek } from "~/components/sidePeek";
import { AlertTriangle, ChevronRight, Moon, Palmtree } from "lucide-react";
import { useI18n } from "~/lib/i18n";
import { QuickActions, TargetChime, TravelBanner, WeatherCard } from "~/components/homeExtras";
import { RoomBanner, SetupChecklist, WhatsNewCard } from "~/components/newFeatures";

export const HomePanel: React.FC<{
  onOpenBedsideMode: () => void;
  onNavigate: (tab: AppTab) => void;
}> = ({ onOpenBedsideMode, onNavigate }) => {
  const toast = useToast();
  const { t, locale } = useI18n();
  // Home is a deck of three views (Left, Right, Whole bed). The 3D bed, the controller and
  // tonight's curve slide together; swiping loops: Left → Right → Whole bed → Left.
  const { selected, select } = useSide();
  const { deck, handlers } = useSideSwipe();
  const utils = apiR.useUtils();
  const accountQuery = apiR.user.getAccount.useQuery();
  const healthQuery = apiR.user.getPodHealth.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60_000,
  });
  const health = healthQuery.data;
  const healthIssue = !health
    ? null
    : health.online === false
      ? t("Your pod looks offline. Check its power and Wi-Fi.")
      : health.hasWater === false
        ? t("The water tank looks empty. Refill it and prime the pod.")
        : health.needsPriming
          ? t("Your pod needs priming. Start it from Settings → Pod health.")
          : null;

  const resume = apiR.user.setVacationMode.useMutation({
    onSuccess: async () => {
      await utils.user.getAccount.invalidate();
      await utils.user.getPodStatus.invalidate();
      toast(t("Welcome back! Schedule resumed"));
    },
    onError: (e) => toast(e.message, "error"),
  });

  const account = accountQuery.data;

  return (
    <div className="space-y-4">
      {account?.vacationMode && (
        <div className="flex items-center gap-3 rounded-3xl border border-teal-200 bg-gradient-to-r from-teal-50 to-cyan-50 p-4 dark:border-teal-900/60 dark:from-teal-950/40 dark:to-cyan-950/30">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-300">
            <Palmtree className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-teal-900 dark:text-teal-100">
              {t("Vacation mode is on")}
            </p>
            <p className="text-xs text-teal-800/80 dark:text-teal-200/70">
              {account.vacationUntil
                ? t("Automation paused until {date}", {
                    date: new Date(account.vacationUntil).toLocaleDateString(
                      locale,
                      { weekday: "short", month: "short", day: "numeric" },
                    ),
                  })
                : t("Automation paused until you resume it")}
            </p>
          </div>
          <button
            type="button"
            disabled={resume.isPending}
            onClick={() => resume.mutate({ enabled: false })}
            className="h-10 shrink-0 rounded-2xl bg-teal-600 px-4 text-xs font-bold text-white shadow-sm transition active:scale-95 disabled:opacity-50"
          >
            {resume.isPending ? "…" : t("Resume")}
          </button>
        </div>
      )}

      {healthIssue && (
        <button
          type="button"
          onClick={() => onNavigate("settings")}
          className="flex w-full items-center gap-3 rounded-3xl border border-amber-300 bg-amber-50 p-4 text-left dark:border-amber-800 dark:bg-amber-950/40"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <span className="flex-1 text-sm font-semibold text-amber-900 dark:text-amber-100">
            {healthIssue}
          </span>
          <ChevronRight className="h-4 w-4 text-amber-600" />
        </button>
      )}

      <SetupChecklist onNavigate={onNavigate} />
      <WhatsNewCard />
      <TravelBanner />
      <RoomBanner />
      <WeatherCard />
      <TargetChime />

      <div className="flex items-center justify-end gap-3">
      </div>
      {/* clip sideways only, so the peeking cards stay off screen until you swipe */}
      <div className="relative overflow-x-clip">
        <div
          ref={deck}
          {...handlers}
          className="relative space-y-4 will-change-transform"
          style={{ touchAction: "pan-y" }}
        >
          <div data-tour="bed">
            <BedDiagram />
          </div>

          <div>
            <div data-tour="control">
              <PodControl onSetUpSchedule={() => onNavigate("schedule")} />
            </div>
            {/* dots: which card (Left, Right, Whole bed) is showing; tap one to jump there */}
            <div data-tour="sides" className="mt-2 flex flex-col items-center gap-1">
              <div className="flex items-center gap-1.5">
                {ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => select(s)}
                    aria-label={
                      s === "both"
                        ? t("Whole bed")
                        : t(s === "left" ? "Left" : "Right")
                    }
                    className={`h-1.5 rounded-full transition-all ${selected === s ? "w-4 bg-slate-700 dark:bg-slate-200" : "w-1.5 bg-slate-300 dark:bg-slate-700"}`}
                  />
                ))}
              </div>
            </div>
          </div>
          {/* the views on either side, peeking in while you swipe (last, so they don't shift the layout) */}
          <SidePeek
            side={ORDER[(ORDER.indexOf(selected) + 1) % 3]!}
            edge="right"
          />
          <SidePeek
            side={ORDER[(ORDER.indexOf(selected) + 2) % 3]!}
            edge="left"
          />
        </div>
      </div>

      <QuickActions />

      {/* tonight's plan for each side; fixed, not part of the swipe */}
      <div data-tour="curve">
        <TonightCurves onOpen={(side) => { select(side); onNavigate("schedule"); }} />
      </div>

      <button
        type="button"
        onClick={onOpenBedsideMode}
        className="flex w-full items-center justify-center gap-2 rounded-3xl border border-slate-200/80 bg-white/90 py-4 text-sm font-extrabold text-slate-700 shadow-sm transition active:scale-[0.98] dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-200"
      >
        <Moon className="h-4 w-4 text-slate-400" />
        {t("Nightstand mode")}
      </button>
    </div>
  );
};
