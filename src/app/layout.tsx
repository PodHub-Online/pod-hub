import "~/styles/globals.css";

import { Inter as FontSans, Share_Tech_Mono as FontHud } from "next/font/google";
import { type Metadata, type Viewport } from "next";
import { TRPCReactProvider } from "~/trpc/react";
import { ThemeProvider } from "~/components/themeProvider";
import { I18nProvider } from "~/lib/i18n";
import { cn } from "~/lib/utils";
import { GA_ID, gaInitScript } from "~/lib/analytics";

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontHud = FontHud({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hud",
});

export const metadata: Metadata = {
  title: "Pod Hub",
  description:
    "Your own sleep schedule, wake-up warmth and a 3D view for your Pod. Not affiliated with Eight Sleep.",
  applicationName: "Pod Hub",
  appleWebApp: {
    capable: true,
    title: "Pod Hub",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: [
    { rel: "icon", url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { rel: "apple-touch-icon", url: "/icon-192.png" },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "dark min-h-screen font-sans antialiased",
        fontSans.variable,
        fontHud.variable,
      )}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const saved = localStorage.getItem('podhub-theme');
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (saved === 'dark' || (!saved && prefersDark) || (saved === 'system' && prefersDark)) {
                  document.documentElement.classList.add('dark');
                } else if (saved === 'light' || (saved === 'system' && !prefersDark)) {
                  document.documentElement.classList.remove('dark');
                }
              } catch (_) {}
            `,
          }}
        />
        {/* Google Analytics, on the live app only (see src/lib/analytics.ts) */}
        {process.env.VERCEL_ENV === "production" && GA_ID && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
            <script dangerouslySetInnerHTML={{ __html: gaInitScript }} />
          </>
        )}
      </head>
      <body className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-300">
        {/* a test copy (Vercel preview / staging), so nobody mistakes it for the real app */}
        {process.env.VERCEL_ENV === "preview" && (
          <div className="sticky top-0 z-[70] bg-amber-400 px-3 py-1 text-center text-xs font-black text-black">TEST SITE · changes here don&apos;t reach everyone</div>
        )}
        <TRPCReactProvider>
          <ThemeProvider>
            <I18nProvider>{children}</I18nProvider>
          </ThemeProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
