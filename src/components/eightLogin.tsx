"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiR } from "~/trpc/react";
import { ArrowRight, Hourglass, MailCheck, PlayCircle } from "lucide-react";
import { setDeviceToken } from "~/lib/clientStorage";
import { tx } from "~/lib/i18n";
import { APP_NAME } from "~/lib/appName";

const loginSchema = z.object({
  email: z.string().email(tx("Please enter a valid email")),
  password: z.string().min(1, tx("Password is required")),
});

type EightLoginDialog = z.infer<typeof loginSchema>;

interface EightLoginDialogProps {
  onLoginSuccess: () => void;
}

export const EightLoginDialog: React.FC<EightLoginDialogProps> = ({
  onLoginSuccess,
}) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EightLoginDialog>({
    resolver: zodResolver(loginSchema),
  });

  const loginMutation = apiR.user.login.useMutation({
    onSuccess: (data) => {
      // not invited yet: a request went to the owner instead
      if (!data.deviceToken) return;
      setDeviceToken(data.deviceToken);
      onLoginSuccess();
    },
  });
  const requested = loginMutation.data && !loginMutation.data.deviceToken ? loginMutation.data : null;

  // no device token for the demo: it ends when the browser drops the short session
  const demoMutation = apiR.user.startDemo.useMutation({ onSuccess: () => onLoginSuccess() });

  const onSubmit = (data: EightLoginDialog) => {
    loginMutation.mutate(data);
  };

  return (
    <div className="mx-auto w-full max-w-sm rounded-3xl border border-slate-200/80 bg-white/95 p-8 shadow-2xl backdrop-blur-2xl transition-all dark:border-slate-800/80 dark:bg-slate-900/90">
      {/* Brand Icon Header */}
      <div className="mb-6 text-center">
        <img
          src="/icon-192.png"
          alt={APP_NAME}
          className="mx-auto h-16 w-16 rounded-2xl shadow-xl shadow-indigo-500/20 ring-1 ring-white/10"
        />
        <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-900 dark:text-slate-200">
          {APP_NAME}
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {tx("Sign in once with your Eight Sleep account. You'll stay signed in on this device.")}
        </p>
        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
          {tx("Uses your Eight Sleep account. Not affiliated with Eight Sleep.")}{" "}
          <a href="/privacy" className="underline">
            {tx("Privacy")}
          </a>
        </p>
      </div>

      {/* Before anyone types a password: say how getting in works */}
      {!requested && (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50/80 p-3 text-xs text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
          <p className="font-bold">{tx("Invite-only")}</p>
          <p className="mt-0.5">
            {tx("New here? Signing in sends the owner a request to join. Once it's approved, sign in again and you're in.")}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} method="post" action="#" className="space-y-4">
        <div>
          <input
            {...register("email")}
            type="email"
            id="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="username"
            placeholder={tx("Account Email")}
            className="block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:bg-slate-800/90"
          />
          {errors.email && (
            <p className="mt-1.5 pl-1 text-xs text-rose-500">{errors.email.message}</p>
          )}
        </div>

        <div>
          <input
            {...register("password")}
            type="password"
            id="password"
            autoComplete="current-password"
            placeholder={tx("Account Password")}
            className="block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:bg-slate-800/90"
          />
          {errors.password && (
            <p className="mt-1.5 pl-1 text-xs text-rose-500">
              {errors.password.message}
            </p>
          )}
        </div>

        {requested && (
          <div
            role="status"
            className="rounded-2xl border-2 border-sky-400 bg-sky-50 p-4 text-sky-900 dark:border-sky-500/70 dark:bg-sky-950/60 dark:text-sky-100"
          >
            <div className="flex items-center gap-2 text-base font-black">
              {requested.requested ? <MailCheck className="h-5 w-5 shrink-0" /> : <Hourglass className="h-5 w-5 shrink-0" />}
              {requested.requested ? tx("Request sent") : tx("Not taking new requests right now")}
            </div>
            <p className="mt-1.5 text-sm">
              {requested.requested
                ? tx("Your Eight Sleep account checks out. The owner will review your request; once it's approved, come back and sign in again.")
                : tx("This app is invite-only, and too many requests are waiting right now. Try again in a few days.")}
            </p>
          </div>
        )}

        {loginMutation.isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-3 text-center text-xs text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            {typeof loginMutation.error.message === "string"
              ? loginMutation.error.message
              : tx("Invalid credentials. Please verify your email and password.")}
          </div>
        )}

        <button
          type="submit"
          disabled={loginMutation.isPending}
          className="group relative mt-2 inline-flex w-full items-center justify-center space-x-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-500 hover:to-purple-500 focus:outline-none active:scale-98 disabled:opacity-50"
        >
          <span>{loginMutation.isPending ? tx("Signing in...") : tx("Sign In to Pod")}</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </button>
      </form>

      <div className="mt-6 border-t border-slate-200 pt-5 text-center dark:border-slate-800">
        <button
          type="button"
          onClick={() => demoMutation.mutate()}
          disabled={demoMutation.isPending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 py-3 text-sm font-bold text-indigo-700 transition-all hover:bg-indigo-100 active:scale-98 disabled:opacity-50 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70"
        >
          <PlayCircle className="h-4 w-4" />
          <span>{demoMutation.isPending ? tx("Opening the demo…") : tx("Try the demo")}</span>
        </button>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          {tx("No Pod needed: look around with pretend data. Nothing you change is saved.")}
        </p>
        {demoMutation.isError && (
          <p className="mt-1.5 text-xs text-rose-500">{demoMutation.error.message}</p>
        )}
      </div>
    </div>
  );
};
