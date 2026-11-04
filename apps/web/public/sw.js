// Ra's service worker: the app opens with no connection (J2 "You're offline.
// Everything still works."). Your mind's copy lives in IndexedDB; this only
// keeps the shell: the page, its hashed assets and the fonts.
//
// Pages: network first, falling back to the cached shell.
// /assets/*: cache first (file names change with every build).
// Fonts: cache first.
// The API, sync and the Ray socket are never cached.
// Push: Ra only ever says that something is waiting, never what (J3).

const SHELL = "ra-shell-v4";
const ASSETS = "ra-assets-v3";
// Exact API paths, and API folders. ("/me" alone, so the /memories screen still works offline.)
const API = ["/sync", "/ray", "/horizon", "/evidence", "/export", "/me", "/health", "/voice", "/transcribe", "/capture", "/push"];
const API_DIRS = ["/dial/", "/route/", "/capture/", "/markers/", "/landfall/", "/auth/", "/dev/", "/ear/", "/push/", "/people/", "/funders/"];
const isApi = (path) => API.includes(path) || API_DIRS.some((d) => path.startsWith(d));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add("/")));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // The /ray page is the app's; only its socket upgrade is the API, and that never reaches here.
  if (url.origin === self.location.origin && isApi(url.pathname) && !(url.pathname === "/ray" && req.mode === "navigate")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // An unlisted API or error page must never replace the offline shell with private JSON.
          if(res.ok&&res.headers.get("content-type")?.includes("text/html")&&!/no-store|private/i.test(res.headers.get("cache-control")??"")){
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((r) => r ?? Response.error())),
    );
    return;
  }

  const cacheable = (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) || url.hostname.endsWith("fonts.gstatic.com") || url.hostname.endsWith("fonts.googleapis.com");
  if (!cacheable) return;
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if ((res.ok || res.type === "opaque")&&!/no-store|private/i.test(res.headers.get("cache-control")??"")) {
            const copy = res.clone();
            caches.open(ASSETS).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// A content-free push: nothing in it, so nothing shows but that Ra has something for you.
self.addEventListener("push", (event) => {
  event.waitUntil(self.registration.showNotification("Ra", { body: "Ra has something for you.", tag: "ra", renotify: false }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((open) => {
      const ra = open.find((c) => new URL(c.url).origin === self.location.origin);
      return ra ? ra.focus() : self.clients.openWindow("/");
    }),
  );
});
