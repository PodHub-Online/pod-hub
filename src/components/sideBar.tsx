"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSide, type SelectedSide } from "~/components/sideContext";
import { useTonight } from "~/components/sideStatus";
import { Moon } from "lucide-react";
import { apiR } from "~/trpc/react";
import { tx } from "~/lib/i18n";

/** A bed seen from above (headboard on top): the left half, the right half, or both filled in. */
export function BedGlyph({ fill, size = 22 }: { fill: SelectedSide; size?: number }) {
  const half = (x: number, on: boolean) =>
    on ? (
      <rect x={x} y={5} width={9} height={12} rx={2} fill="currentColor" />
    ) : (
      <rect x={x + 0.6} y={5.6} width={7.8} height={10.8} rx={1.6} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.2} />
    );
  return (
    <svg width={size} height={(size * 17) / 22} viewBox="0 0 24 18" aria-hidden>
      <rect x={2} y={1} width={20} height={3} rx={1} fill="currentColor" fillOpacity={0.45} />
      {fill === "both" ? <rect x={2.5} y={5} width={19} height={12} rx={2} fill="currentColor" /> : (
        <>
          {half(2.5, fill === "left")}
          {half(12.5, fill === "right")}
        </>
      )}
    </svg>
  );
}

/** Which side Home and Schedule are about: three little beds (left half, right half, whole bed). */
export const SideSwitch: React.FC = () => {
  const { selected, own, otherKind, select } = useSide();
  const tonight = useTonight();
  const runs = { left: !!tonight("left")?.runs, right: !!tonight("right")?.runs, both: !!tonight("both")?.runs };
  const health = apiR.user.getPodHealth.useQuery(undefined, { retry: false, refetchInterval: 10_000 });
  const isOn = (side: "left" | "right") => !!health.data?.sides.find((x) => x.side === side)?.active;
  const on = { left: isOn("left"), right: isOn("right"), both: isOn("left") && isOn("right") };
  const who = (s: "left" | "right") => (s === own ? tx("you") : otherKind === "guest" ? tx("guest") : tx("other"));
  const options: { id: SelectedSide; title: string }[] = [
    { id: "left", title: `${tx("Left")} · ${who("left")}` },
    { id: "right", title: `${tx("Right")} · ${who("right")}` },
    { id: "both", title: tx("Whole bed") },
  ];
  const index = options.findIndex((o) => o.id === selected);

  // Where the highlight sits (0, 1, 2; -1 and 3 are just off the edges). Going past an end
  // loops: it slides out of one edge and comes back in from the other, never back across.
  const [pos, setPos] = useState(index);
  const [instant, setInstant] = useState(false);
  const prev = useRef(index);
  useEffect(() => {
    const from = prev.current;
    prev.current = index;
    if (from === index) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wrap = (out: number, back: number) => {
      setInstant(false);
      setPos(out); // slide off the edge
      timers.push(
        setTimeout(() => {
          setInstant(true);
          setPos(back); // jump to the other edge, out of sight
          timers.push(
            setTimeout(() => {
              setInstant(false);
              setPos(index); // slide in
            }, 30),
          );
        }, 160),
      );
    };
    // only a swipe loops around; a tap moves straight to the bed you tapped
    const swiped = document.documentElement.hasAttribute("data-side-swiped");
    document.documentElement.removeAttribute("data-side-swiped");
    if (swiped && from === 2 && index === 0) wrap(3, -1);
    else if (swiped && from === 0 && index === 2) wrap(-1, 3);
    else {
      setInstant(false);
      setPos(index);
    }
    return () => timers.forEach(clearTimeout);
  }, [index]);

  return (
    <div
      role="tablist"
      aria-label={tx("Side of the bed")}
      className="relative inline-flex items-center gap-0.5 overflow-hidden rounded-xl border border-slate-200 bg-white/80 p-0.5 dark:border-slate-800 dark:bg-slate-900/80"
    >
      {/* the highlight slides between the three; while you swipe Home it follows your finger (--side-drag) */}
      <span
        aria-hidden
        className="side-switch-highlight absolute left-0.5 top-0.5 h-7 w-9 rounded-lg bg-slate-900 shadow-md dark:bg-white"
        style={{
          transform: `translateX(calc(clamp(-1, ${pos} + var(--side-drag, 0), 3) * 38px))`,
          ...(instant ? { transition: "none" } : {}),
        }}
      />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={selected === o.id}
          aria-label={`${o.title}${on[o.id] ? ` · ${tx("on")}` : ""}${runs[o.id] ? ` · ${tx("schedule runs tonight")}` : ""}`}
          title={o.title}
          onClick={() => select(o.id)}
          className={`relative flex h-7 w-9 items-center justify-center rounded-lg transition-colors ${
            // picked: inverted (white bed on black, or black on white) so it reads at a glance
            selected === o.id ? "text-white dark:text-slate-950" : "text-slate-400 dark:text-slate-500"
          }`}
        >
          <BedGlyph fill={o.id} />
          {/* green dot: on right now */}
          {on[o.id] && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-power-500 ring-1 ring-white dark:ring-slate-950" aria-hidden />}
          {/* moon: its schedule runs tonight */}
          {runs[o.id] && <Moon className="absolute bottom-0 right-0 h-2.5 w-2.5 fill-current text-sky-400" aria-hidden />}
        </button>
      ))}
    </div>
  );
};
