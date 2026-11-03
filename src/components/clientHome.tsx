"use client";

import React, { useEffect, useRef, useState } from "react";
import { Header } from "~/components/header";
import { Footer } from "~/components/footer";
import { EightLoginDialog } from "~/components/eightLogin";
import { BedsideMode } from "~/components/bedsideMode";
import { BottomNav, APP_TABS, type AppTab } from "~/components/bottomNav";
import { HomePanel } from "~/components/homePanel";
import { SchedulePanel } from "~/components/schedulePanel";
import { SettingsPanel } from "~/components/settingsPanel";
import { SleepPanel } from "~/components/sleepPanel";
import { ToastProvider } from "~/components/ui/toast";
import { apiR } from "~/trpc/react";
import { getDeviceToken, readStorage, setDeviceToken, writeStorage } from "~/lib/clientStorage";
import { Loader2 } from "lucide-react";
import { tx } from "~/lib/i18n";
import { SideProvider } from "~/components/sideContext";
import { WhoopReturnNotice } from "~/components/whoopCard";
import { EditLockProvider } from "~/components/editLock";
import { DemoBanner } from "~/components/demoBanner";
import { FirstTour } from "~/components/firstTour";
import { Heartbeat } from "~/components/heartbeat";
import { AccentSync } from "~/components/settingsExtras";
import { useShortcutAction } from "~/components/shortcuts";
import { trackPage } from "~/lib/analytics";

const TAB_KEY = "podhub-tab";

/** Runs a home-screen shortcut (long-press the app icon) once signed in. */
function ShortcutRunner({ onTab, onBedtime }: { onTab: (t: AppTab) => void; onBedtime: () => void }) {
  useShortcutAction(onTab, onBedtime);
  return null;
}

export default function ClientHome({
  initialLoginState,
}: {
  initialLoginState: boolean;
}) {
  const [isLoggedIn, setIsLoggedIn] = useState(initialLoginState);
  // While logged out, try the saved device token before showing the login form.
  const [isRestoring, setIsRestoring] = useState(!initialLoginState);
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [showBedsideMode, setShowBedsideMode] = useState<boolean>(false);
  const utils = apiR.useUtils();

  const refreshSession = apiR.user.refreshSession.useMutation({
    // the demo has no device token (empty): keep whatever this device had, so leaving the
    // demo brings back a real session saved here
    onSuccess: (data) => {
      if (data.deviceToken) setDeviceToken(data.deviceToken);
    },
  });
  const resumeSession = apiR.user.resumeSession.useMutation();

  const sessionChecked = useRef(false);
  useEffect(() => {
    if (sessionChecked.current) return;
    sessionChecked.current = true;

    const saved = readStorage(TAB_KEY);
    if (APP_TABS.some((t) => t.id === saved) || saved === "settings") setActiveTab(saved as AppTab);

    if (initialLoginState) {
      refreshSession.mutate();
      return;
    }
    const deviceToken = getDeviceToken();
    if (!deviceToken) {
      setIsRestoring(false);
      return;
    }
    resumeSession.mutate(
      { deviceToken },
      {
        onSuccess: (data) => {
          setDeviceToken(data.deviceToken);
          utils.invalidate().catch(() => undefined);
          setIsLoggedIn(true);
        },
        onError: () => setDeviceToken(null),
        onSettled: () => setIsRestoring(false),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeTab = (tab: AppTab) => {
    setActiveTab(tab);
    writeStorage(TAB_KEY, tab);
    window.scrollTo({ top: 0 });
  };

  // the owner's Statistics button opens Settings on that page
  useEffect(() => {
    const toSettings = () => {
      setActiveTab("settings");
      writeStorage(TAB_KEY, "settings");
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("podhub-open-page", toSettings);
    return () => window.removeEventListener("podhub-open-page", toSettings);
  }, []);

  // the tour points at parts of Home, so it always starts there
  useEffect(() => {
    const toHome = () => {
      setActiveTab("home");
      writeStorage(TAB_KEY, "home");
    };
    window.addEventListener("podhub-tour", toHome);
    return () => window.removeEventListener("podhub-tour", toHome);
  }, []);

  // Google Analytics: one page view per screen shown (demo visits marked), on the live app only
  const account = apiR.user.getAccount.useQuery(undefined, { retry: false, enabled: isLoggedIn });
  const shownPage = isRestoring ? null : !isLoggedIn ? "signin" : !account.data ? null : showBedsideMode ? "nightstand" : activeTab;
  const demo = account.data?.demo === true;
  useEffect(() => {
    if (shownPage) trackPage(shownPage, demo);
  }, [shownPage, demo]);

  const handleLogout = () => {
    setIsLoggedIn(false);
    utils.invalidate().catch(() => undefined);
  };

  return (
    <ToastProvider>
      <SideProvider enabled={isLoggedIn}>
      <div className="flex min-h-[100dvh] flex-col bg-slate-100 text-slate-900 transition-colors duration-200 dark:bg-slate-950 dark:text-slate-100">
        {showBedsideMode && <BedsideMode onClose={() => setShowBedsideMode(false)} />}
        {isLoggedIn && <WhoopReturnNotice onConnected={() => changeTab("sleep")} />}
        <AccentSync enabled={isLoggedIn} />
        {isLoggedIn && !isRestoring && <FirstTour />}
        {isLoggedIn && !isRestoring && <Heartbeat />}
        {isLoggedIn && <ShortcutRunner onTab={changeTab} onBedtime={() => setShowBedsideMode(true)} />}

        <Header
          isLoggedIn={isLoggedIn}
          onOpenSettings={() => changeTab(activeTab === "settings" ? "home" : "settings")}
          settingsActive={activeTab === "settings"}
          showSides={activeTab === "home" || activeTab === "schedule"}
        />

        {isRestoring ? (
          <main className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            <span>{tx("Restoring your session…")}</span>
          </main>
        ) : !isLoggedIn ? (
          <>
            <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
              <EightLoginDialog
                onLoginSuccess={() => {
                  utils.invalidate().catch(() => undefined);
                  setIsLoggedIn(true);
                }}
              />
            </main>
            <Footer />
          </>
        ) : (
          <>
            <EditLockProvider lockKey={activeTab}>
            <main className="flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:pb-28">
              <div className="mx-auto max-w-3xl">
                <DemoBanner />
                {activeTab === "home" && (
                  <HomePanel
                    onOpenBedsideMode={() => setShowBedsideMode(true)}
                    onNavigate={changeTab}
                  />
                )}
                {activeTab === "schedule" && <SchedulePanel />}
                {activeTab === "sleep" && <SleepPanel />}
                {activeTab === "settings" && <SettingsPanel onLogoutSuccess={handleLogout} />}
              </div>
            </main>
            </EditLockProvider>
            <BottomNav active={activeTab} onChange={changeTab} />
          </>
        )}
      </div>
      </SideProvider>
    </ToastProvider>
  );
}
