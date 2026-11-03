"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiR } from "~/trpc/react";
import { haptic, readStorage, writeStorage } from "~/lib/clientStorage";

export type BedSideName = "left" | "right";
export type SelectedSide = BedSideName | "both";

const KEY = "podhub-side";

interface SideCtx {
  /** what the app is showing and controlling: Left, Right or Both (= Whole bed) */
  selected: SelectedSide;
  /** the schedule shown and edited: Left, Right, or the whole-bed one */
  scheduleSide: SelectedSide;
  /** the side the signed-in account sleeps on */
  own: BedSideName;
  /** who is on the other side: another Eight Sleep account, or the official guest */
  otherKind: "account" | "guest" | null;
  /** true while Whole bed is being switched */
  switching: boolean;
  select: (side: SelectedSide) => void;
}

const Ctx = createContext<SideCtx>({
  selected: "left",
  scheduleSide: "left",
  own: "left",
  otherKind: null,
  switching: false,
  select: () => undefined,
});

/**
 * One place that knows which side of the bed the app is showing: Left, Right or Both.
 * Picking one only changes the view; it never sends anything to the bed. Commands go out
 * only when you press Turn on/off or − / +, and each side always keeps its own schedule.
 */
export function SideProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const utils = apiR.useUtils();
  const bedMode = apiR.user.getBedMode.useQuery(undefined, { retry: false, staleTime: 60_000, enabled });
  const guest = apiR.user.getGuestSide.useQuery(undefined, { retry: false, staleTime: 5 * 60_000, enabled });
  const own: BedSideName = bedMode.data?.side === "right" || bedMode.data?.homeSide === "right" ? "right" : "left";
  const [pick, setPick] = useState<SelectedSide | null>(null);

  useEffect(() => {
    const saved = readStorage(KEY);
    if (saved === "left" || saved === "right" || saved === "both") setPick(saved);
  }, []);

  // The old Whole bed mode made the schedule drive both sides; turn it off once if it's still on.
  const clearWholeBed = apiR.user.setWholeBed.useMutation({
    onSettled: () => utils.user.getBedMode.invalidate(),
  });
  const cleared = useRef(false);
  useEffect(() => {
    if (cleared.current || !bedMode.data?.wholeBed) return;
    cleared.current = true;
    clearWholeBed.mutate({ enabled: false });
  }, [bedMode.data?.wholeBed, clearWholeBed]);

  const selected: SelectedSide = pick ?? own;

  const select = useCallback(
    (side: SelectedSide) => {
      if (side === selected) return;
      haptic();
      setPick(side);
      writeStorage(KEY, side);
    },
    [selected],
  );

  const value = useMemo<SideCtx>(
    () => ({
      selected,
      scheduleSide: selected,
      own,
      otherKind: guest.data?.supported ? guest.data.kind : null,
      switching: false,
      select,
    }),
    [selected, own, guest.data, select],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSide = () => useContext(Ctx);
