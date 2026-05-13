const CACHE_NAME = "quietcollective-shell-d56e5b77126b";
const STYLES_CSS_URL = "/styles.css?v=2a855c9ea1f9";
const APP_JS_URL = "/app.js?v=11b46f553b34";
const NOTIFICATION_STATE_CACHE = "quietcollective-notification-state-v1";
const NOTIFICATION_STATE_URL = "/__quietcollective_notification_state__";
const NOTIFICATION_RECENT_POLL_INTERVAL_MS = 60 * 1000;
const NOTIFICATION_RECENT_WINDOW_MS = 30 * 60 * 1000;
const NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS = 5 * 60 * 1000;
const NOTIFICATION_FOLLOWUP_WINDOW_MS = 2 * 60 * 60 * 1000;
const NOTIFICATION_IDLE_POLL_INTERVAL_MS = 30 * 60 * 1000;
const STATIC_URLS = [
  "/",
  "/index.html",
  STYLES_CSS_URL,
  APP_JS_URL,
  "/vendor/easymde/easymde.min.css",
  "/vendor/easymde/easymde.min.js",
  "/icon.svg",
];
const STATIC_PATHS = new Set(STATIC_URLS.map((path) => new URL(path, self.location.origin).pathname));

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
  await cache.addAll(STATIC_URLS);
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
    await Promise.all(keys.map((key) => key === CACHE_NAME || key === NOTIFICATION_STATE_CACHE ? undefined : caches.delete(key)));
    await self.clients.claim();
  })());
});

async function readNotificationState() {
  const cache = await caches.open(NOTIFICATION_STATE_CACHE);
  const response = await cache.match(NOTIFICATION_STATE_URL);
  if (!response) return defaultNotificationState();
  try {
    return {
      ...defaultNotificationState(),
      ...(await response.json()),
    };
  } catch {
    return defaultNotificationState();
  }
}

function defaultNotificationState() {
  return {
    enabled: false,
    etag: "",
    latestCreatedAt: "",
    lastPollAt: 0,
    lastUsedAt: 0,
    recentIntervalMs: NOTIFICATION_RECENT_POLL_INTERVAL_MS,
    recentWindowMs: NOTIFICATION_RECENT_WINDOW_MS,
    followupIntervalMs: NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS,
    followupWindowMs: NOTIFICATION_FOLLOWUP_WINDOW_MS,
    idleIntervalMs: NOTIFICATION_IDLE_POLL_INTERVAL_MS,
    pushSubscribed: false,
  };
}

function notificationPollIntervalMs(state, timestamp = Date.now()) {
  const recentInterval = Math.max(Number(state.recentIntervalMs || NOTIFICATION_RECENT_POLL_INTERVAL_MS), NOTIFICATION_RECENT_POLL_INTERVAL_MS);
  const recentWindow = Math.max(Number(state.recentWindowMs || NOTIFICATION_RECENT_WINDOW_MS), NOTIFICATION_RECENT_WINDOW_MS);
  const followupInterval = Math.max(Number(state.followupIntervalMs || NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS), NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS);
  const followupWindow = Math.max(Number(state.followupWindowMs || NOTIFICATION_FOLLOWUP_WINDOW_MS), NOTIFICATION_FOLLOWUP_WINDOW_MS);
  const idleInterval = Math.max(Number(state.idleIntervalMs || NOTIFICATION_IDLE_POLL_INTERVAL_MS), NOTIFICATION_IDLE_POLL_INTERVAL_MS);
  if (state.pushSubscribed) return idleInterval;
  const lastUsedAt = Number(state.lastUsedAt || 0);
  if (!lastUsedAt) return idleInterval;
  const elapsed = timestamp - lastUsedAt;
  if (elapsed <= recentWindow) return recentInterval;
  if (elapsed <= recentWindow + followupWindow) return followupInterval;
  return idleInterval;
}

async function writeNotificationState(state) {
  const cache = await caches.open(NOTIFICATION_STATE_CACHE);
  await cache.put(NOTIFICATION_STATE_URL, new Response(JSON.stringify(state), {
    headers: { "content-type": "application/json; charset=utf-8" },
  }));
}

async function showNotificationItem(item) {
  const title = item.title || "QuietCollective";
  const body = item.title ? item.body : item.body || "You have a new notification.";
  await self.registration.showNotification(title, {
    body,
    tag: item.id,
    data: { notificationId: item.id, url: item.action_url || "/" },
  });
}

async function broadcastNotificationStatus(count) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: "qc-notifications-status", unreadCount: Number(count || 0) });
}

async function pollNotifications(options = {}) {
  const state = await readNotificationState();
  if (!state.enabled) return;
  const timestamp = Date.now();
  const interval = notificationPollIntervalMs(state, timestamp);
  if (!options.force && timestamp - Number(state.lastPollAt || 0) < interval) return;

  const headers = new Headers();
  if (state.etag) headers.set("if-none-match", state.etag);
  let response;
  try {
    response = await fetch(`/api/notifications/poll?since=${encodeURIComponent(state.latestCreatedAt || "")}`, {
      cache: "no-cache",
      credentials: "include",
      headers,
    });
  } catch {
    await writeNotificationState({ ...state, lastPollAt: timestamp });
    return;
  }

  if (response.status === 304) {
    await writeNotificationState({ ...state, lastPollAt: timestamp });
    await broadcastNotificationStatus(state.unreadCount || 0);
    return;
  }
  if (response.status === 401 || response.status === 403) {
    await writeNotificationState({ ...state, enabled: false, lastPollAt: timestamp });
    await broadcastNotificationStatus(0);
    return;
  }
  if (!response.ok) {
    await writeNotificationState({ ...state, lastPollAt: timestamp });
    return;
  }

  const previousWatermark = `${state.latestCreatedAt || ""}:${Number(state.unreadCount || 0)}`;
  const data = await response.json().catch(() => ({}));
  const nextLatestCreatedAt = data.latest_created_at || state.latestCreatedAt || "";
  const nextEtag = response.headers.get("etag") || state.etag || "";
  const nextUnreadCount = Number(data.unread_count || 0);
  const nextWatermark = `${nextLatestCreatedAt}:${nextUnreadCount}`;
  const notificationsChanged = nextWatermark !== previousWatermark;
  const nextState = {
    ...state,
    etag: nextEtag,
    latestCreatedAt: nextLatestCreatedAt,
    lastPollAt: timestamp,
    lastUsedAt: notificationsChanged ? timestamp : state.lastUsedAt,
    unreadCount: nextUnreadCount,
  };

  if (!options.suppressExisting && self.Notification?.permission === "granted") {
    for (const item of [...(data.notifications || [])].reverse()) await showNotificationItem(item);
  }
  await writeNotificationState(nextState);
  await broadcastNotificationStatus(nextState.unreadCount);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "qc-notifications-enable") {
    event.waitUntil((async () => {
      const state = await readNotificationState();
      await writeNotificationState({
        ...state,
        enabled: true,
        lastUsedAt: Date.now(),
        latestCreatedAt: state.latestCreatedAt || new Date().toISOString(),
        recentIntervalMs: Math.max(Number(data.recentIntervalMs || NOTIFICATION_RECENT_POLL_INTERVAL_MS), NOTIFICATION_RECENT_POLL_INTERVAL_MS),
        recentWindowMs: Math.max(Number(data.recentWindowMs || NOTIFICATION_RECENT_WINDOW_MS), NOTIFICATION_RECENT_WINDOW_MS),
        followupIntervalMs: Math.max(Number(data.followupIntervalMs || NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS), NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS),
        followupWindowMs: Math.max(Number(data.followupWindowMs || NOTIFICATION_FOLLOWUP_WINDOW_MS), NOTIFICATION_FOLLOWUP_WINDOW_MS),
        idleIntervalMs: Math.max(Number(data.idleIntervalMs || NOTIFICATION_IDLE_POLL_INTERVAL_MS), NOTIFICATION_IDLE_POLL_INTERVAL_MS),
        pushSubscribed: !!data.pushSubscribed,
      });
      if (data.pollNow) await pollNotifications({ force: true, suppressExisting: !!data.suppressExisting });
    })());
  }
  if (data.type === "qc-notifications-touch") {
    event.waitUntil((async () => {
      const state = await readNotificationState();
      if (!state.enabled) return;
      await writeNotificationState({
        ...state,
        lastUsedAt: Date.now(),
        recentIntervalMs: Math.max(Number(data.recentIntervalMs || NOTIFICATION_RECENT_POLL_INTERVAL_MS), NOTIFICATION_RECENT_POLL_INTERVAL_MS),
        recentWindowMs: Math.max(Number(data.recentWindowMs || NOTIFICATION_RECENT_WINDOW_MS), NOTIFICATION_RECENT_WINDOW_MS),
        followupIntervalMs: Math.max(Number(data.followupIntervalMs || NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS), NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS),
        followupWindowMs: Math.max(Number(data.followupWindowMs || NOTIFICATION_FOLLOWUP_WINDOW_MS), NOTIFICATION_FOLLOWUP_WINDOW_MS),
        idleIntervalMs: Math.max(Number(data.idleIntervalMs || NOTIFICATION_IDLE_POLL_INTERVAL_MS), NOTIFICATION_IDLE_POLL_INTERVAL_MS),
        pushSubscribed: !!data.pushSubscribed,
      });
    })());
  }
  if (data.type === "qc-notifications-disable") {
    event.waitUntil(readNotificationState().then(async (state) => {
      await writeNotificationState({ ...state, enabled: false, pushSubscribed: false, unreadCount: 0 });
      await broadcastNotificationStatus(0);
    }));
  }
  if (data.type === "qc-notifications-poll") {
    event.waitUntil(pollNotifications({ force: !!data.force, suppressExisting: !!data.suppressExisting }));
  }
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "qc-notifications") event.waitUntil(pollNotifications());
});

self.addEventListener("push", (event) => {
  event.waitUntil(pollNotifications({ force: true }));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(readNotificationState().then(async (state) => {
    await writeNotificationState({ ...state, enabled: false, pushSubscribed: false, unreadCount: 0 });
    await broadcastNotificationStatus(0);
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin);
  const notificationId = String(event.notification.data?.notificationId || event.notification.tag || "");
  if (targetUrl.origin !== self.location.origin) {
    targetUrl.href = self.location.origin;
  }
  event.waitUntil((async () => {
    if (notificationId) {
      await fetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      }).catch(() => undefined);
      await pollNotifications({ force: true, suppressExisting: true }).catch(() => undefined);
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const clientUrl = new URL(client.url || self.location.origin);
      if (clientUrl.origin !== self.location.origin) continue;
      if ("navigate" in client) {
        const navigated = await client.navigate(targetUrl.href).catch(() => null);
        if (navigated && "focus" in navigated) {
          const focused = await navigated.focus().catch(() => null);
          if (focused) return focused;
        }
      }
      if ("focus" in client) {
        const focused = await client.focus().catch(() => null);
        if (focused) return focused;
      }
    }
    if ("openWindow" in self.clients) return self.clients.openWindow(targetUrl.href);
    return undefined;
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

  if (STATIC_PATHS.has(url.pathname) || url.pathname.startsWith("/assets/")) {
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
