"use client";

import React, { useMemo, useState } from "react";
import { Download, History, Loader2 } from "lucide-react";
import { Card, CardHeader } from "~/components/ui/card";
import { useLevelFormat } from "~/lib/tempUnit";
import { tx } from "~/lib/i18n";
import { bestCombo, bestForStage, bestNight, historyCsv, HIST_STAGES, MIN_NIGHTS_AT_TEMP, type HistNight, type HistStage } from "~/lib/tempHistory";
import { useNights, useProfileSave } from "~/components/sleepInsights";

const RANGES = [
  { days: 28, label: "4 weeks" },
  { days: 90, label: "3 months" },
  { days: 366, label: "All" },
] as const;

const STAGE_LABEL: Record<HistStage, string> = { initial: "Falling asleep", mid: "Deep sleep", final: "Late sleep" };
const FIELD = { initial: "initialSleepLevel", mid: "midStageSleepLevel", final: "finalSleepLevel" } as const;

const dateLabel = (night: string) => new Date(`${night}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** Sleep tab: each night's three stage temperatures next to the result, and which temperatures gave the best nights. */
export const TemperatureHistory: React.FC = () => {
  const [days, setDays] = useState<number>(90);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const { nights, loading, source } = useNights(days);
  const fmt = useLevelFormat();
  const { apply, busy } = useProfileSave(tx("Schedule updated"));
  const resultName = source === "whoop" ? tx("Recovery") : tx("Sleep score");

  const rows = useMemo(
    () =>
      nights
        .filter((n) => n.level !== null || n.stages)
        .map((n) => {
          // older nights have only an average: it stands in for deep sleep
          const st = n.stages ?? { initial: null, mid: n.level, final: null };
          const round = (v: number | null) => (v === null ? null : Math.round(v));
          return {
            hist: { night: n.night, stages: { initial: round(st.initial), mid: round(st.mid), final: round(st.final) }, result: n.recovery ?? n.score } as HistNight,
            ran: n.scheduleRan,
          };
        }),
    [nights],
  );
  const hist = rows.map((r) => r.hist);
  const star = bestNight(hist);
  const best = HIST_STAGES.map((s) => ({ stage: s, best: bestForStage(hist, s) }));
  const combo = bestCombo(hist);
  const text = (steps: number | null, ran: boolean) => (steps === null ? (ran ? tx("Off") : "—") : fmt.text(steps * 10));

  const exportCsv = () => {
    const blob = new Blob([historyCsv(hist, resultName.toLowerCase().replace(/\s+/g, "_"))], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pod-hub-temperatures.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return null;
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, 14);
  const pickedRow = rows.find((r) => r.hist.night === picked)?.hist ?? null;

  return (
    <Card>
      <CardHeader
        icon={<History className="h-5 w-5" />}
        title={tx("Temperatures over time")}
        subtitle={tx("Each night's three temperatures next to how you slept")}
        action={
          <button type="button" onClick={exportCsv} aria-label={tx("Export CSV")} className="flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-2.5 text-[11px] font-bold dark:border-slate-700">
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        }
      />

      <div className="mb-3 flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            onClick={() => setDays(r.days)}
            className={`h-8 rounded-full px-3 text-xs font-bold ${days === r.days ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"}`}
          >
            {tx(r.label)}
          </button>
        ))}
      </div>

      {/* what worked best */}
      <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/50">
        <p className="mb-2 text-xs font-extrabold">{tx("What worked best")}</p>
        {best.every((b) => !b.best) ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tx("Not enough nights yet. A temperature needs at least {n} nights with a result before it counts.", { n: MIN_NIGHTS_AT_TEMP })}
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {best.map(({ stage, best: b }) => (
              <li key={stage} className="flex justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">{tx(STAGE_LABEL[stage])}</span>
                <span className="font-bold">{b ? `${fmt.text(b.level * 10)} · ${tx("{avg} on average", { avg: Math.round(b.avg) })} (${tx("{n} nights", { n: b.nights })})` : "—"}</span>
              </li>
            ))}
          </ul>
        )}
        {combo && (
          <div className="mt-3 rounded-xl bg-emerald-500/10 p-2.5 text-xs">
            <p className="font-bold">
              {tx("Best three together")}: {HIST_STAGES.map((s) => fmt.text(combo.levels[s] * 10)).join(" / ")} · {tx("{avg} on average", { avg: Math.round(combo.avg) })} ({tx("{n} nights", { n: combo.nights })})
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => apply(Object.fromEntries(HIST_STAGES.map((s) => [FIELD[s], combo.levels[s] * 10])))}
              className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white active:scale-95 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {tx("Use these")}
            </button>
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-400">{tx("A pattern, not proof: many things change how you sleep.")}</p>
      </div>

      {/* one chart per stage: temperature against the result */}
      <div className="mt-3 grid gap-3">
        {HIST_STAGES.map((s) => (
          <StageChart key={s} stage={s} nights={hist} picked={picked} onPick={setPicked} resultName={resultName} />
        ))}
      </div>
      {pickedRow && (
        <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">
          <b>{dateLabel(pickedRow.night)}</b> · {HIST_STAGES.map((s) => `${tx(STAGE_LABEL[s])} ${text(pickedRow.stages[s], true)}`).join(" · ")} · {resultName} {pickedRow.result === null ? "—" : Math.round(pickedRow.result)}
        </p>
      )}

      {/* the list */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="py-1 pr-2 font-semibold">{tx("Night")}</th>
              <th className="px-1 font-semibold">{tx("Falling asleep")}</th>
              <th className="px-1 font-semibold">{tx("Deep")}</th>
              <th className="px-1 font-semibold">{tx("Late")}</th>
              <th className="pl-1 text-right font-semibold">{resultName}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ hist: h, ran }) => (
              <tr key={h.night} onClick={() => setPicked(h.night)} className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 ${h.night === star ? "bg-emerald-500/10" : ""}`}>
                <td className="py-1.5 pr-2">{dateLabel(h.night)}</td>
                {HIST_STAGES.map((s) => (
                  <td key={s} className="px-1 font-bold tabular-nums">
                    {text(h.stages[s], ran)}
                  </td>
                ))}
                <td className="pl-1 text-right font-bold tabular-nums">
                  {h.result === null ? "—" : Math.round(h.result)}
                  {h.night === star ? " ★" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 14 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-bold text-indigo-600 dark:text-indigo-300">
            {all ? tx("Show fewer") : tx("Show all {n} nights", { n: rows.length })}
          </button>
        )}
      </div>
      {days > 62 && source === "whoop" && <p className="mt-2 text-[10px] text-slate-400">{tx("WHOOP results go back about 2 months; older nights show temperatures only.")}</p>}
    </Card>
  );
};

/** Temperature (across) against the result (up) for one stage. Tap a dot for that night. */
const StageChart: React.FC<{ stage: HistStage; nights: HistNight[]; picked: string | null; onPick: (night: string) => void; resultName: string }> = ({ stage, nights, picked, onPick, resultName }) => {
  const fmt = useLevelFormat();
  const pts = nights.filter((n) => n.stages[stage] !== null && n.result !== null) as (HistNight & { result: number })[];
  if (pts.length < 3) return null;
  const levels = pts.map((p) => p.stages[stage]!);
  const minL = Math.min(...levels) - 1;
  const maxL = Math.max(...levels) + 1;
  const W = 320;
  const H = 110;
  const x = (l: number) => 34 + ((l - minL) / (maxL - minL)) * (W - 46);
  const y = (r: number) => H - 20 - (r / 100) * (H - 30);
  const ticks = Array.from(new Set([Math.ceil(minL), Math.round((minL + maxL) / 2), Math.floor(maxL)]));
  return (
    <div>
      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
        {tx(STAGE_LABEL[stage])} · {resultName}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${tx(STAGE_LABEL[stage])}: ${tx("temperature vs result")}`}>
        {[0, 50, 100].map((r) => (
          <g key={r}>
            <line x1={34} x2={W - 12} y1={y(r)} y2={y(r)} className="stroke-slate-200 dark:stroke-slate-800" />
            <text x={28} y={y(r) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">{r}</text>
          </g>
        ))}
        {ticks.map((l) => (
          <text key={l} x={x(l)} y={H - 5} textAnchor="middle" className="fill-slate-400 font-hud text-[9px]">
            {fmt.text(l * 10)}
          </text>
        ))}
        {pts.map((p) => (
          <circle
            key={p.night}
            cx={x(p.stages[stage]!)}
            cy={y(p.result)}
            r={p.night === picked ? 6.5 : 4.5}
            onClick={() => onPick(p.night)}
            className={`cursor-pointer ${p.night === picked ? "fill-indigo-500" : "fill-cyan-500"}`}
            opacity={0.8}
          />
        ))}
      </svg>
    </div>
  );
};
