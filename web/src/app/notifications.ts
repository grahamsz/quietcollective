// @ts-nocheck
import { icon } from "../components/icons";
import { button, panel } from "../components/ui";
import { escapeHtml } from "../lib/utils";
import { renderRoute } from "./routing";
import {
  BROWSER_NOTIFICATIONS_KEY,
  NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS,
  NOTIFICATION_FOLLOWUP_WINDOW_MS,
  NOTIFICATION_IDLE_POLL_INTERVAL_MS,
  NOTIFICATION_RECENT_POLL_INTERVAL_MS,
  NOTIFICATION_RECENT_WINDOW_MS,
  state,
} from "./state";
import { toast } from "./toast";

let browserNotificationPollTimer = 0;
let browserNotificationWindowTouchedAt = 0;
let browserPushPublicKeyPromise = null;
let browserPushSubscriptionActive = false;
const NOTIFICATION_TITLE_PREFIX = "🔴 ";

function notificationPollIntervalMs(timestamp = Date.now()) {
  if (browserPushSubscriptionActive) return NOTIFICATION_IDLE_POLL_INTERVAL_MS;
  if (!browserNotificationWindowTouchedAt) return NOTIFICATION_IDLE_POLL_INTERVAL_MS;
  const elapsed = timestamp - browserNotificationWindowTouchedAt;
  if (elapsed <= NOTIFICATION_RECENT_WINDOW_MS) return NOTIFICATION_RECENT_POLL_INTERVAL_MS;
  if (elapsed <= NOTIFICATION_RECENT_WINDOW_MS + NOTIFICATION_FOLLOWUP_WINDOW_MS) return NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS;
  return NOTIFICATION_IDLE_POLL_INTERVAL_MS;
}

function notificationBaseTitle() {
  return (state.instance?.name || document.title || "QuietCollective").replace(/^🔴\s*/, "") || "QuietCollective";
}

function updateNotificationTitle() {
  const title = notificationBaseTitle();
  document.title = Number(state.unreadNotifications || 0) > 0 ? `${NOTIFICATION_TITLE_PREFIX}${title}` : title;
}

/** Renders the unread notification bell in the top bar. */
function notificationBell() {
  if (!state.me) return "";
  const count = Number(state.unreadNotifications || 0);
  const label = count ? `${count} unread notification${count === 1 ? "" : "s"}` : "No unread notifications";
  const countText = count > 99 ? "99+" : String(count);
  return `<div class="notification-menu-root" data-notification-menu-root><button class="notification-bell ${count ? "is-active" : ""}" data-notification-bell type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-haspopup="menu" aria-expanded="false">${icon("bell")}${count ? `<span data-notification-count>${escapeHtml(countText)}</span>` : ""}</button><div class="notification-popdown" data-notification-popdown hidden><div class="notification-popdown-body">${notificationMenuLoading()}</div>${notificationBrowserToggle()}</div></div>`;
}

function updateNotificationBell() {
  updateNotificationTitle();
  const bell = document.querySelector("[data-notification-bell]");
  if (!bell) return;
  const count = Number(state.unreadNotifications || 0);
  const label = count ? `${count} unread notification${count === 1 ? "" : "s"}` : "No unread notifications";
  bell.classList.toggle("is-active", count > 0);
  bell.setAttribute("aria-label", label);
  bell.setAttribute("title", label);
  bell.innerHTML = `${icon("bell")}${count ? `<span data-notification-count>${escapeHtml(count > 99 ? "99+" : String(count))}</span>` : ""}`;
}

function notificationMenuLoading() {
  return `<div class="notification-menu-empty">Loading notifications...</div>`;
}

function notificationMenuEmpty() {
  return `<div class="notification-menu-empty">No notifications yet.</div>`;
}

function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function notificationApi(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const body = options.body;
  if (body && !(body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (state.token) headers.set("authorization", `Bearer ${state.token}`);
  const response = await fetch(path, {
    ...options,
    headers,
    cache: "no-store",
    credentials: "include",
    body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
  if (!response.ok) {
    const error = new Error(typeof data === "object" ? data.error || "Request failed" : data || "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function browserPushPublicKey() {
  if (!browserPushPublicKeyPromise) {
    browserPushPublicKeyPromise = notificationApi("/api/notifications/push-public-key")
      .then((data) => data.available && data.public_key ? data.public_key : "");
  }
  return browserPushPublicKeyPromise;
}

async function savePushSubscription(subscription) {
  const payload = typeof subscription.toJSON === "function" ? subscription.toJSON() : { endpoint: subscription.endpoint };
  if (!payload.endpoint) payload.endpoint = subscription.endpoint;
  await notificationApi("/api/notifications/push-subscriptions", { method: "POST", body: payload });
}

async function ensurePushSubscription(registration, options = {}) {
  if (!registration?.pushManager) {
    browserPushSubscriptionActive = false;
    if (options.required) throw new Error("Push notifications are not available in this browser.");
    return false;
  }
  const publicKey = await browserPushPublicKey();
  if (!publicKey) {
    browserPushSubscriptionActive = false;
    if (options.required) throw new Error("Web push is not configured for this site.");
    return false;
  }
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    });
  }
  await savePushSubscription(subscription);
  browserPushSubscriptionActive = true;
  return true;
}

async function removePushSubscription(registration) {
  browserPushSubscriptionActive = false;
  const subscription = await registration?.pushManager?.getSubscription().catch(() => null);
  if (!subscription) return;
  await notificationApi("/api/notifications/push-subscriptions", {
    method: "DELETE",
    body: { endpoint: subscription.endpoint },
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

function browserNotificationsAvailable() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

function browserNotificationsEnabled() {
  return localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) === "true" && browserNotificationsAvailable() && Notification.permission === "granted";
}

function browserNotificationStatus() {
  if (!browserNotificationsAvailable()) return { label: "Unavailable", detail: "This browser does not support service worker push notifications.", action: "" };
  if (Notification.permission === "denied") return { label: "Blocked", detail: "Notifications are blocked in this browser.", action: "" };
  if (browserNotificationsEnabled()) return { label: "Enabled", detail: "Uses push wakeups for background delivery, with 30-minute fallback checks while this browser stays subscribed.", action: "disable" };
  return { label: "Off", detail: "Browser notifications are off for this device.", action: "enable" };
}

function notificationBrowserToggle() {
  const status = browserNotificationStatus();
  const enabled = status.action === "disable";
  const attrs = status.action
    ? `type="button" role="switch" aria-checked="${enabled ? "true" : "false"}" aria-label="Browser notifications" title="${enabled ? "Turn browser notifications off" : "Turn browser notifications on"}" data-browser-notifications-toggle="${escapeHtml(status.action)}"`
    : `type="button" role="switch" aria-checked="false" aria-label="Browser notifications" title="${escapeHtml(status.label)}" disabled`;
  const label = status.action === "disable" ? "Turn browser notifications off" : status.action === "enable" ? "Turn browser notifications on" : status.label;
  return `<div class="notification-popdown-foot"><div><strong>Browser notifications</strong><span>${escapeHtml(status.label)}</span></div><button class="notification-switch ${enabled ? "is-on" : ""}" ${attrs}><span class="notification-switch-track"><span class="notification-switch-knob"></span></span><span class="sr-only">${escapeHtml(label)}</span></button></div>`;
}

async function notificationWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  return registration || null;
}

async function postNotificationWorkerMessage(message) {
  const registration = await notificationWorker();
  const worker = registration?.active || navigator.serviceWorker.controller;
  if (!worker) return false;
  worker.postMessage(message);
  return true;
}

async function registerPeriodicNotificationSync(registration, pushSubscribed = browserPushSubscriptionActive) {
  if (!registration || !("periodicSync" in registration)) return;
  try {
    await registration.periodicSync.register("qc-notifications", {
      minInterval: pushSubscribed ? NOTIFICATION_IDLE_POLL_INTERVAL_MS : NOTIFICATION_RECENT_POLL_INTERVAL_MS,
    });
  } catch {
    // Periodic background sync is optional; foreground service-worker messages still work.
  }
}

async function unregisterPeriodicNotificationSync(registration) {
  if (!registration || !("periodicSync" in registration)) return;
  try {
    await registration.periodicSync.unregister("qc-notifications");
  } catch {
    // Optional browser capability.
  }
}

function scheduleBrowserNotificationPolls() {
  if (browserNotificationPollTimer) window.clearTimeout(browserNotificationPollTimer);
  browserNotificationPollTimer = 0;
  if (!browserNotificationsEnabled()) return;
  const scheduleNext = () => {
    if (!browserNotificationsEnabled()) {
      browserNotificationPollTimer = 0;
      return;
    }
    browserNotificationPollTimer = window.setTimeout(async () => {
      await postNotificationWorkerMessage({ type: "qc-notifications-poll" });
      scheduleNext();
    }, notificationPollIntervalMs());
  };
  scheduleNext();
}

async function touchBrowserNotificationWindow() {
  if (!state.me || !browserNotificationsEnabled()) return;
  browserNotificationWindowTouchedAt = Date.now();
  scheduleBrowserNotificationPolls();
  await postNotificationWorkerMessage({
    type: "qc-notifications-touch",
    recentIntervalMs: NOTIFICATION_RECENT_POLL_INTERVAL_MS,
    recentWindowMs: NOTIFICATION_RECENT_WINDOW_MS,
    followupIntervalMs: NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS,
    followupWindowMs: NOTIFICATION_FOLLOWUP_WINDOW_MS,
    idleIntervalMs: NOTIFICATION_IDLE_POLL_INTERVAL_MS,
    pushSubscribed: browserPushSubscriptionActive,
  });
}

async function enableBrowserNotifications() {
  if (!browserNotificationsAvailable()) {
    toast("Browser notifications are not available here.", "error");
    return;
  }
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, "false");
    await postNotificationWorkerMessage({ type: "qc-notifications-disable" });
    toast("Notifications were not enabled.", "error");
    return;
  }
  const registration = await notificationWorker();
  let pushSubscribed = false;
  try {
    pushSubscribed = await ensurePushSubscription(registration, { required: true });
  } catch (error) {
    browserPushSubscriptionActive = false;
    localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, "false");
    await unregisterPeriodicNotificationSync(registration);
    await postNotificationWorkerMessage({ type: "qc-notifications-disable" });
    toast(error.message || "Could not enable browser notifications.", "error");
    renderRoute();
    return;
  }
  localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, "true");
  await registerPeriodicNotificationSync(registration, pushSubscribed);
  browserNotificationWindowTouchedAt = Date.now();
  scheduleBrowserNotificationPolls();
  await postNotificationWorkerMessage({
    type: "qc-notifications-enable",
    recentIntervalMs: NOTIFICATION_RECENT_POLL_INTERVAL_MS,
    recentWindowMs: NOTIFICATION_RECENT_WINDOW_MS,
    followupIntervalMs: NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS,
    followupWindowMs: NOTIFICATION_FOLLOWUP_WINDOW_MS,
    idleIntervalMs: NOTIFICATION_IDLE_POLL_INTERVAL_MS,
    pushSubscribed,
    pollNow: true,
    suppressExisting: true,
  });
  toast("Browser notifications enabled");
  renderRoute();
}

async function disableBrowserNotifications(options = {}) {
  localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, "false");
  if (browserNotificationPollTimer) window.clearTimeout(browserNotificationPollTimer);
  browserNotificationPollTimer = 0;
  browserNotificationWindowTouchedAt = 0;
  const registration = await notificationWorker();
  await removePushSubscription(registration);
  await unregisterPeriodicNotificationSync(registration);
  await postNotificationWorkerMessage({ type: "qc-notifications-disable" });
  if (!options.silent) {
    toast("Browser notifications disabled");
    renderRoute();
  }
}

async function syncBrowserNotifications() {
  if (!browserNotificationsAvailable()) return;
  if (!browserNotificationsEnabled()) {
    browserPushSubscriptionActive = false;
    await postNotificationWorkerMessage({ type: "qc-notifications-disable" });
    return;
  }
  const registration = await notificationWorker();
  const pushSubscribed = await ensurePushSubscription(registration).catch(() => {
    browserPushSubscriptionActive = false;
    return false;
  });
  await registerPeriodicNotificationSync(registration, pushSubscribed);
  browserNotificationWindowTouchedAt = Date.now();
  scheduleBrowserNotificationPolls();
  await postNotificationWorkerMessage({
    type: "qc-notifications-enable",
    recentIntervalMs: NOTIFICATION_RECENT_POLL_INTERVAL_MS,
    recentWindowMs: NOTIFICATION_RECENT_WINDOW_MS,
    followupIntervalMs: NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS,
    followupWindowMs: NOTIFICATION_FOLLOWUP_WINDOW_MS,
    idleIntervalMs: NOTIFICATION_IDLE_POLL_INTERVAL_MS,
    pushSubscribed,
  });
  await postNotificationWorkerMessage({ type: "qc-notifications-poll" });
}

/** Renders the browser notification settings panel on the profile page. */
function browserNotificationsPanel() {
  const status = browserNotificationStatus();
  const action = status.action === "enable"
    ? button("Enable", "button primary", "type=button data-enable-browser-notifications")
    : status.action === "disable" ? button("Disable", "button ghost", "type=button data-disable-browser-notifications") : "";
  return panel("Browser Notifications", `<div class="notification-settings"><div><strong>${escapeHtml(status.label)}</strong><span>${escapeHtml(status.detail)}</span></div><div class="toolbar">${action}</div></div>`);
}

function bindBrowserNotificationSettings() {
  document.querySelector("[data-enable-browser-notifications]")?.addEventListener("click", enableBrowserNotifications);
  document.querySelector("[data-disable-browser-notifications]")?.addEventListener("click", () => disableBrowserNotifications());
}


export { bindBrowserNotificationSettings, browserNotificationStatus, browserNotificationsAvailable, browserNotificationsEnabled, browserNotificationsPanel, disableBrowserNotifications, enableBrowserNotifications, notificationBell, notificationBrowserToggle, notificationMenuEmpty, notificationMenuLoading, notificationWorker, postNotificationWorkerMessage, registerPeriodicNotificationSync, scheduleBrowserNotificationPolls, syncBrowserNotifications, touchBrowserNotificationWindow, unregisterPeriodicNotificationSync, updateNotificationBell, updateNotificationTitle };
