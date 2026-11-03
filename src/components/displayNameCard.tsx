"use client";

import React, { useEffect, useState } from "react";
import { apiR } from "~/trpc/react";
import { Card, CardHeader } from "~/components/ui/card";
import { useToast } from "~/components/ui/toast";
import { Loader2, PenLine } from "lucide-react";
import { tx } from "~/lib/i18n";
import { bedEngraving, hubName } from "~/lib/appName";

/** Settings → Preferences: the name on the header and the headboard ("Pod Hub", "ALEX'S BED"). */
export const DisplayNameCard: React.FC = () => {
  const toast = useToast();
  const utils = apiR.useUtils();
  const saved = apiR.user.getAccount.useQuery().data?.displayName ?? "";
  const [name, setName] = useState(saved);
  useEffect(() => setName(saved), [saved]);
  const save = apiR.user.setDisplayName.useMutation({
    onSuccess: async () => {
      await utils.user.getAccount.invalidate();
      toast(tx("Name saved"));
    },
    onError: (e) => toast(e.message, "error"),
  });
  const trimmed = name.trim();
  return (
    <Card>
      <CardHeader icon={<PenLine className="h-5 w-5" />} title={tx("Your name")} subtitle={tx("Shown at the top and engraved on the 3D bed")} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ name: trimmed });
        }}
      >
        <input
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={save.isPending || trimmed === saved}
          className="h-10 shrink-0 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : tx("Save")}
        </button>
      </form>
      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        {hubName(trimmed || null)} · {bedEngraving(trimmed || null)}
      </p>
    </Card>
  );
};
