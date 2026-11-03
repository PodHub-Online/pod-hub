"use client";

import React, { useState } from "react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader, Skeleton } from "~/components/ui/card";
import { useToast } from "~/components/ui/toast";
import { Loader2, UserPlus, Users } from "lucide-react";
import { tx, txLocale } from "~/lib/i18n";

const day = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString(txLocale(), { month: "short", day: "numeric", year: "numeric" }) : null;

/** Owner only: who may sign in, and who's asking to. */
export const InvitesPanel: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const q = apiR.user.getInvites.useQuery();
  const [email, setEmail] = useState("");
  const refresh = () => Promise.all([utils.user.getInvites.invalidate(), utils.user.getAccount.invalidate()]);
  const onError = (e: { message: string }) => toast(e.message, "error");

  const add = apiR.user.addInvite.useMutation({
    onSuccess: async () => {
      setEmail("");
      await refresh();
      toast(tx("Invited. They can sign in now."));
    },
    onError,
  });
  const answer = apiR.user.answerRequest.useMutation({
    onSuccess: async (_d, v) => {
      await refresh();
      toast(v.approve ? tx("Approved. They can sign in now.") : tx("Request removed"), v.approve ? "success" : "info");
    },
    onError,
  });
  const remove = apiR.user.removeInvite.useMutation({
    onSuccess: async (_d, v) => {
      await refresh();
      toast(v.deleteData ? tx("Removed, and their data deleted") : tx("Removed. They're signed out."), "info");
    },
    onError,
  });

  const data = q.data;
  const busy = add.isPending || answer.isPending || remove.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={<UserPlus className="h-5 w-5" />} title={tx("Waiting for you")} subtitle={tx("They signed in with Eight Sleep, so the email is theirs")} />
        {!data ? (
          <Skeleton className="h-12" />
        ) : data.requests.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{tx("No one is waiting.")}</p>
        ) : (
          <ul className="space-y-2">
            {data.requests.map((r) => (
              <li key={r.email} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/50">
                <p className="truncate text-sm font-semibold">{r.firstName ? `${r.firstName} · ${r.email}` : r.email}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{tx("Asked on {date}", { date: day(r.requestedAt) ?? "" })}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => answer.mutate({ email: r.email, approve: true })}
                    className="h-9 flex-1 rounded-xl bg-slate-900 text-xs font-bold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                  >
                    {tx("Approve")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => answer.mutate({ email: r.email, approve: false })}
                    className="h-9 flex-1 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                  >
                    {tx("Deny")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader icon={<Users className="h-5 w-5" />} title={tx("Invited")} subtitle={tx("Besides you, only these emails can sign in")} />
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) add.mutate({ email: email.trim() });
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={tx("Their Eight Sleep email")}
            autoCapitalize="none"
            autoCorrect="off"
            className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <button type="submit" disabled={busy || !email.trim()} className="h-10 shrink-0 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900">
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : tx("Invite")}
          </button>
        </form>
        {!data ? (
          <Skeleton className="h-16" />
        ) : data.invites.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{tx("No one yet. Only you can sign in.")}</p>
        ) : (
          <ul className="space-y-2">
            {data.invites.map((i) => (
              <li key={i.email} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/50">
                <p className="truncate text-sm font-semibold">{i.email}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {i.joinedAt
                    ? tx("Joined {date} · last signed in {last}", { date: day(i.joinedAt) ?? "", last: day(i.lastSignInAt) ?? "" })
                    : tx("Invited {date} · hasn't signed in yet", { date: day(i.addedAt) ?? "" })}
                </p>
                <div className="mt-2 flex gap-3 text-xs font-bold">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(tx("Remove {email}? They're signed out right away; their data stays.", { email: i.email })))
                        remove.mutate({ email: i.email, deleteData: false });
                    }}
                    className="text-slate-600 disabled:opacity-50 dark:text-slate-300"
                  >
                    {tx("Remove")}
                  </button>
                  {i.joinedAt && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(tx("Remove {email} and delete all their data from this app? This can't be undone.", { email: i.email })))
                          remove.mutate({ email: i.email, deleteData: true });
                      }}
                      className="text-rose-600 disabled:opacity-50 dark:text-rose-400"
                    >
                      {tx("Remove and delete data")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
