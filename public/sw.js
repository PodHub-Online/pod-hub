// @ts-nocheck (service worker: runs outside the app, so the page types don't apply)
// Pod Hub service worker: only for phone notifications (nothing is cached).
// A push arrives empty; ask the app what to show, with this phone's sign-in.
self.addEventListener("push", (event) => {
  event.waitUntil(
    fetch("/api/push/latest", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((n) =>
        self.registration.showNotification((n && n.title) || "Pod Hub", {
          body: (n && n.body) || "Open the app to see what changed.",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: (n && n.kind) || "pod-hub",
        }),
      ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("/");
    }),
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
