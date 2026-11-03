"use client";

import React, { useEffect, useState } from "react";
import { Activity, Copy, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { apiR } from "~/trpc/react";
import { useToast } from "~/components/ui/toast";
import { tx, txLocale } from "~/lib/i18n";
import { WhoopLogo } from "~/components/whoopLogo";

const when = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString(txLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : tx("never");

function CopyLine({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/50">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-slate-700 dark:text-slate-200">{value}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => toast(tx("Copied")))
              .catch(() => toast(tx("Couldn't copy. Long-press the text to copy it instead"), "error"));
          }}
          aria-label={tx("Copy {what}", { what: label })}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** The saved Client Secret, hidden until you tap the eye. */
function SavedSecret() {
  const toast = useToast();
  const [shown, setShown] = useState<string | null>(null);
  const reveal = apiR.whoop.revealSecret.useMutation({
    onSuccess: (d) => setShown(d.secret ?? ""),
    onError: (e) => toast(e.message, "error"),
  });
  return (
    <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/50">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{tx("Saved Client Secret")}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-slate-700 dark:text-slate-200">
          {shown ?? "•".repeat(24)}
        </code>
        <button
          type="button"
          onClick={() => (shown === null ? reveal.mutate() : setShown(null))}
          aria-label={shown === null ? tx("Show") : tx("Hide")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300"
        >
          {reveal.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : shown === null ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

/** The WHOOP developer app: where to create it, what to paste there, and its keys (kept on the server). */
function WhoopSetup({
  redirectUrl,
  webhookUrl,
  clientId,
  onDone,
}: {
  redirectUrl: string;
  webhookUrl: string;
  clientId: string | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const utils = apiR.useUtils();
  const [id, setId] = useState(clientId ?? "");
  const [secret, setSecret] = useState("");
  const save = apiR.whoop.saveSetup.useMutation({
    onSuccess: async () => {
      setSecret("");
      await utils.whoop.getStatus.invalidate();
      toast(tx("WHOOP keys saved"));
      onDone();
    },
    onError: (e) => toast(e.message, "error"),
  });
  const input =
    "h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800";
  return (
    <div className="mt-3 space-y-3 text-xs text-slate-600 dark:text-slate-300">
      <p>
        <b>1.</b> {tx("Create an app at")}{" "}
        <a href="https://developer.whoop.com" target="_blank" rel="noopener noreferrer" className="font-bold underline">
          developer.whoop.com
        </a>{" "}
        {tx("with all of these scopes ticked: sleep, recovery, cycles, workout, body measurement, profile and offline.")}
      </p>
      <p>
        <b>2.</b> {tx("Paste these two addresses into it (webhook model version: v2):")}
      </p>
      <CopyLine label={tx("Redirect URL")} value={redirectUrl} />
      <CopyLine label={tx("Webhook URL")} value={webhookUrl} />
      <p>
        <b>3.</b> {tx("Copy its Client ID and Client Secret here:")}
      </p>
      <input
        className={input}
        placeholder="Client ID"
        value={id}
        onChange={(e) => setId(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {clientId && <SavedSecret />}
      <input
        className={input}
        type="password"
        placeholder={clientId ? tx("Client Secret (leave empty to keep the saved one)") : "Client Secret"}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        autoComplete="new-password"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => save.mutate({ clientId: id, clientSecret: secret || undefined })}
        disabled={save.isPending || id.trim().length < 8}
        className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-xs font-bold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
      >
        {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {tx("Save keys")}
      </button>
      <p className="text-[11px] text-slate-400">{tx("The secret is stored on the server; tap the eye to see it.")}</p>
    </div>
  );
}

/** Settings: set up and connect WHOOP, see when it last sent data, sync or disconnect. */
export const WhoopCard: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const status = apiR.whoop.getStatus.useQuery(undefined, { retry: false });
  // the app keys are the owner's; everyone else just connects their own WHOOP
  const owner = apiR.user.getAccount.useQuery().data?.isOwner === true;
  const sync = apiR.whoop.sync.useMutation({
    onSuccess: async (d) => {
      await Promise.all([utils.whoop.getStatus.invalidate(), utils.whoop.getNights.invalidate()]);
      toast(tx("WHOOP synced: {n} nights", { n: d.count }));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const disconnect = apiR.whoop.disconnect.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.whoop.getStatus.invalidate(), utils.whoop.getNights.invalidate()]);
      toast(tx("WHOOP disconnected"), "info");
    },
    onError: (e) => toast(e.message, "error"),
  });
  const s = status.data;
  if (!s) return null;

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
          <Activity className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <WhoopLogo className="block text-sm text-slate-900 dark:text-slate-100" />
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
            {!s.configured
              ? owner
                ? tx("Set up the app keys in Settings → Administrator, then connect")
                : tx("Not available yet")
              : s.connected
              ? tx("Connected · last data {when}", { when: when(s.lastWebhookAt ?? s.lastSyncAt) })
              : tx("Sleep, recovery and HRV on the Sleep tab")}
          </span>
        </span>
        {s.configured && !s.connected && (
          <a
            href="/api/whoop/connect"
            className="inline-flex h-9 shrink-0 items-center rounded-xl bg-slate-900 px-3 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900"
          >
            {tx("Connect")}
          </a>
        )}
      </div>
      {(s.connected) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {s.connected && (
            <button
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              {sync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {tx("Sync now")}
            </button>
          )}
          {s.connected && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(tx("Disconnect WHOOP? Its nights are removed from this app."))) disconnect.mutate();
              }}
              disabled={disconnect.isPending}
              className="h-9 rounded-xl px-3 text-xs font-bold text-rose-600 disabled:opacity-50 dark:text-rose-400"
            >
              {tx("Disconnect")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/** Settings → Administrator → WHOOP app keys: the owner's one-time setup (keys and addresses) for everyone's WHOOP. */
export const WhoopAppKeys: React.FC = () => {
  const status = apiR.whoop.getStatus.useQuery(undefined, { retry: false });
  const [editing, setEditing] = useState(false);
  const s = status.data;
  if (!s) return null;
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
      {!s.configured || editing ? (
        <WhoopSetup redirectUrl={s.redirectUrl} webhookUrl={s.webhookUrl} clientId={s.clientId} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">{tx("The WHOOP app keys are saved. Everyone can now connect their own WHOOP in Settings → Connections.")}</p>
          <button type="button" onClick={() => setEditing(true)} className="h-9 shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
            {tx("App keys & addresses")}
          </button>
        </div>
      )}
    </div>
  );
};

/** After WHOOP sends you back (?whoop=…), says how it went and cleans the address bar. */
export const WhoopReturnNotice: React.FC<{ onConnected: () => void }> = ({ onConnected }) => {
  const toast = useToast();
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("whoop");
    if (!result) return;
    url.searchParams.delete("whoop");
    window.history.replaceState(null, "", url.toString());
    if (result === "connected") {
      toast(tx("WHOOP connected"));
      onConnected();
    } else if (result === "declined") toast(tx("WHOOP wasn't connected"), "info");
    else if (result === "invalid_scope")
      toast(tx("WHOOP refused a permission. Tick every scope in your WHOOP developer app, then connect again."), "error");
    else toast(tx("Couldn't connect WHOOP ({why})", { why: result }), "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};
