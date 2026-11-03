import { type MetadataRoute } from "next";

// Makes "Install app" in Chrome produce a real Android WebAPK that shares
// Chrome's cookie jar, instead of a loose home-screen shortcut.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pod Hub",
    short_name: "Pod Hub",
    description: "Smart scheduling & controls for your Eight Sleep pod",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["health", "lifestyle", "utilities"],
    // long-press the app icon (Android; iPhone shows them as Home Screen quick actions only for some apps)
    shortcuts: [
      { name: "Cool now", short_name: "Cool now", url: "/?do=cool", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Turn off", short_name: "Turn off", url: "/?do=off", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Nap 20 min", short_name: "Nap 20", url: "/?do=nap", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Tonight's plan", short_name: "Tonight", url: "/?do=plan", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Nightstand", short_name: "Nightstand", url: "/?do=bedtime", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
