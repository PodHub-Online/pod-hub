"use client";

import React from "react";
import { apiR } from "~/trpc/react";
import { LogOut } from "lucide-react";
import { setDeviceToken } from "~/lib/clientStorage";
import { tx } from "~/lib/i18n";

interface LogoutButtonProps {
  onLogoutSuccess: () => void;
  className?: string;
}

export const LogoutButton: React.FC<LogoutButtonProps> = ({
  onLogoutSuccess,
  className = "",
}) => {
  const logoutMutation = apiR.user.logout.useMutation({
    onSuccess: () => {
      setDeviceToken(null);
      onLogoutSuccess();
    },
    onError: (error) => {
      console.error("Logout failed:", error.message);
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <div className="inline-flex flex-col items-end">
      <button
        onClick={handleLogout}
        disabled={logoutMutation.isPending}
        className={`inline-flex items-center space-x-1.5 rounded-xl border border-red-200 bg-red-50/80 px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm transition-all hover:bg-red-100 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 disabled:opacity-50 dark:border-red-950/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/60 ${className}`}
      >
        <LogOut className="h-3.5 w-3.5" />
        <span>{logoutMutation.isPending ? tx("Signing out...") : tx("Sign out")}</span>
      </button>
      {logoutMutation.isError && (
        <p className="mt-1 text-xs text-red-500">
          {logoutMutation.error.message}
        </p>
      )}
    </div>
  );
};
