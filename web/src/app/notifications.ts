// @ts-nocheck
import { icon } from "../components/icons";
import { button, panel } from "../components/ui";
import { escapeHtml } from "../lib/utils";
import { renderRoute } from "./routing";
import { BROWSER_NOTIFICATIONS_KEY, NOTIFICATION_ACTIVE_POLL_INTERVAL_MS, NOTIFICATION_ACTIVE_WINDOW_MS, NOTIFICATION_IDLE_POLL_INTERVAL_MS, state } from "./state";
import { toast } from "./toast";

let browserNotificationPollTimer = 0;

/** Renders the unread notification bell in the top bar. */
function notificationBell() {
  if (!state.me) return "";
  const count = Number(state.unreadNotifications || 0);
  const label = count ? `${count} unread notification${count === 1 ? "" : "s"}` : "No unread notifications";
  const countText = count > 99 ? "99+" : String(count);
  return `<div class="notification-menu-root" data-notification-menu-root><button class="notification-bell ${count ? "is-active" : ""}" data-notification-bell type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-haspopup="menu" aria-expanded="false">${icon("bell")}${count ? `<span data-notification-count>${escapeHtml(countText)}</span>` : ""}</button><div class="notification-popdown" data-notification-popdown hidden><div class="notification-popdown-body">${notificationMenuLoading()}</div>${notificationBrowserToggle()}</div></div>`;
}

function updateNotificationBell() {
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


function browserNotificationsAvailable() {
  return "Notification" in window && "serviceWorker" in navigator;
}

function browserNotificationsEnabled() {
  return localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) === "true" && browserNotificationsAvailable() && Notification.permission === "granted";
}

function browserNotificationStatus() {
  if (!browserNotificationsAvailable()) return { label: "Unavailable", detail: "This browser does not support service worker notifications.", action: "" };
  if (Notification.permission === "denied") return { label: "Blocked", detail: "Notifications are blocked in this browser.", action: "" };
  if (browserNotificationsEnabled()) return { label: "Enabled", detail: "Checks every 5 minutes for an hour after use, then every 30 minutes.", action: "disable" };
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

async function registerPeriodicNotificationSync(registration) {
  if (!registration || !("periodicSync" in registration)) return;
  try {
    await registration.periodicSync.register("qc-notifications", { minInterval: NOTIFICATION_IDLE_POLL_INTERVAL_MS });
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
    }, NOTIFICATION_ACTIVE_POLL_INTERVAL_MS);
  };
  scheduleNext();
}

async function touchBrowserNotificationWindow() {
  if (!state.me || !browserNotificationsEnabled()) return;
  scheduleBrowserNotificationPolls();
  await postNotificationWorkerMessage({
    type: "qc-notifications-touch",
    activeIntervalMs: NOTIFICATION_ACTIVE_POLL_INTERVAL_MS,
    idleIntervalMs: NOTIFICATION_IDLE_POLL_INTERVAL_MS,
    activeWindowMs: NOTIFICATION_ACTIVE_WINDOW_MS,
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
  localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, "true");
  const registration = await notificationWorker();
  await registerPeriodicNotificationSync(registration);
  scheduleBrowserNotificationPolls();
  await postNotificationWorkerMessage({ type: "qc-notifications-enable", activeIntervalMs: NOTIFICATION_ACTIVE_POLL_INTERVAL_MS, idleIntervalMs: NOTIFICATION_IDLE_POLL_INTERVAL_MS, activeWindowMs: NOTIFICATION_ACTIVE_WINDOW_MS, pollNow: true, suppressExisting: true });
  toast("Browser notifications enabled");
  renderRoute();
}

async function disableBrowserNotifications(options = {}) {
  localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, "false");
  if (browserNotificationPollTimer) window.clearTimeout(browserNotificationPollTimer);
  browserNotificationPollTimer = 0;
  const registration = await notificationWorker();
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
    await postNotificationWorkerMessage({ type: "qc-notifications-disable" });
    return;
  }
  const registration = await notificationWorker();
  await registerPeriodicNotificationSync(registration);
  scheduleBrowserNotificationPolls();
  await postNotificationWorkerMessage({ type: "qc-notifications-enable", activeIntervalMs: NOTIFICATION_ACTIVE_POLL_INTERVAL_MS, idleIntervalMs: NOTIFICATION_IDLE_POLL_INTERVAL_MS, activeWindowMs: NOTIFICATION_ACTIVE_WINDOW_MS });
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


export { bindBrowserNotificationSettings, browserNotificationStatus, browserNotificationsAvailable, browserNotificationsEnabled, browserNotificationsPanel, disableBrowserNotifications, enableBrowserNotifications, notificationBell, notificationBrowserToggle, notificationMenuEmpty, notificationMenuLoading, notificationWorker, postNotificationWorkerMessage, registerPeriodicNotificationSync, scheduleBrowserNotificationPolls, syncBrowserNotifications, touchBrowserNotificationWindow, unregisterPeriodicNotificationSync, updateNotificationBell };
