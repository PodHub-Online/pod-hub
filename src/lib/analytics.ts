// Google Analytics: page views only (which screen, the device, the country), never sleep, health,
// schedule or account data. Loaded on the live app only (src/app/layout.tsx), so previews and the
// laptop don't count.

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";

/** The tag's setup, run in <head> before the app starts so page views sent early aren't lost. */
export const gaInitScript = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}', { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
`;

type Gtag = (...args: unknown[]) => void;

/**
 * Counts a visit to one screen. The tabs all live at "/", so each gets its own path
 * (/home, /schedule, …). Demo visits are marked with visit_type "demo".
 */
export function trackPage(name: string, demo = false) {
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof gtag !== "function") return;
  gtag("event", "page_view", {
    page_title: name,
    page_path: `/${name}`,
    page_location: `${window.location.origin}/${name}`,
    visit_type: demo ? "demo" : "member",
  });
}
