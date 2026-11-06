/* Monerem service worker: makes the app open instantly and feel like a phone app.
   - Pages (HTML): try the network first so updates show up, fall back to the saved copy if the signal is slow or gone.
   - Layouts, icons, the Supabase library: show the saved copy instantly, refresh it quietly in the background.
   - NEVER touches Supabase data, login, server math, or Stripe. Those always go straight to the network.
   After you change any file, bump VERSION below so phones pick up the new copy. */
const VERSION = "monerem-v10";
const SHELL = [
  "app.html",
  "paycheck.js",
  "index.html",
  "terms.html",
  "paycheck-calculator.html",
  "monthly-budget.layout.json",
  "yearly-projection.layout.json",
  "manifest.webmanifest",
  "monerem-icon.svg",
  "icon-192.png",
  "apple-touch-icon.png"
];
const CDN = ["cdn.jsdelivr.net"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetworkFirst(req, key) {
  return caches.open(VERSION).then((cache) => {
    // always ask GitHub for the newest page (skip the browser's 10-minute saved copy)
    const net = fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; });
    const slow = new Promise((resolve) => setTimeout(resolve, 2500)).then(() => cache.match(key));
    return Promise.race([net.catch(() => cache.match(key)), slow.then((r) => r || net)])
      .then((r) => r || net);
  });
}

function staleWhileRevalidate(req, key) {
  return caches.open(VERSION).then((cache) =>
    cache.match(key).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; });
      if (hit) { net.catch(() => {}); return hit; }
      return net;
    })
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (!sameOrigin) {
    if (CDN.includes(url.hostname)) e.respondWith(staleWhileRevalidate(req, req.url));
    return; // Supabase, Stripe, fonts, etc. go straight to the network
  }

  // ignore ?query and #hash so app.html?checkout=... still opens from the saved copy
  const key = new Request(url.origin + url.pathname);
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    e.respondWith(fromNetworkFirst(req, key));
  } else {
    e.respondWith(staleWhileRevalidate(req, key));
  }
});
