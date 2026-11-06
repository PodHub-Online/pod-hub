// An optional "tip" link (for example a PayPal.me address). It is read from NEXT_PUBLIC_DONATE_URL, so the
// open-source code carries no link: whoever deploys the app decides. Only https addresses are accepted.
export const DONATE_URL: string | null = (() => {
  const raw = process.env.NEXT_PUBLIC_DONATE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
})();

/** "PayPal" when the link goes to PayPal, else null. */
export const donateService = (url: string | null): string | null => {
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  return host === "paypal.me" || host.endsWith(".paypal.me") || host === "paypal.com" || host.endsWith(".paypal.com") ? "PayPal" : null;
};
