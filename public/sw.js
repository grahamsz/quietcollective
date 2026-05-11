const CACHE_NAME = "quietcollective-shell-v8";
const STATIC_PATHS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/vendor/easymde/easymde.min.css",
  "/vendor/easymde/easymde.min.js",
  "/manifest.webmanifest",
  "/icon.svg",
];

const APP_PATHS = [
  "/setup",
  "/login",
  "/members",
  "/galleries",
  "/galleries/new",
  "/me/profile",
  "/me/exports",
  "/admin",
  "/admin/invites",
];

function isAppNavigation(pathname) {
  return pathname === "/" ||
    APP_PATHS.includes(pathname) ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/members/") ||
    pathname.startsWith("/tags/") ||
    pathname.startsWith("/galleries/") ||
    pathname.startsWith("/works/");
}

function isNeverCached(pathname) {
  if (pathname.startsWith("/api/")) return true;
  if (pathname.includes("/original")) return true;
  if (pathname.includes("high-resolution")) return true;
  return false;
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(STATIC_PATHS);
  const shell = await cache.match("/index.html");
  if (shell) {
    await Promise.all(APP_PATHS.map((path) => cache.put(path, shell.clone())));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => key === CACHE_NAME ? undefined : caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url.pathname)) return;

  if (request.mode === "navigate" && isAppNavigation(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) {
          const shell = await fetch("/index.html", { cache: "no-store" });
          if (shell.ok) await cache.put("/index.html", shell.clone());
        }
        return response;
      } catch {
        return (await cache.match(url.pathname)) ||
          (await cache.match("/index.html")) ||
          new Response("<!doctype html><title>QuietCollective offline</title><body>QuietCollective is offline.</body>", {
            status: 503,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
      }
    })());
    return;
  }

  if (STATIC_PATHS.includes(url.pathname) || url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
