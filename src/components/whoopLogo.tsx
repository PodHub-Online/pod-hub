import React from "react";

/**
 * WHOOP wordmark drawn as text (heavy, wide, uppercase) so it follows light/dark mode.
 * Swap in the official logo file here if you add one to /public.
 */
export const WhoopLogo: React.FC<{ className?: string }> = ({ className }) => (
  <span
    aria-label="WHOOP"
    className={`select-none font-black uppercase italic leading-none tracking-[0.18em] ${className ?? ""}`}
    style={{ fontFamily: "'Arial Black', 'Helvetica Neue', Arial, sans-serif" }}
  >
    WHOOP
  </span>
);
