// @ts-nocheck
import { newestFirst } from "../lib/utils";
import { syncBrowserNotifications, updateNotificationBell } from "./notifications";
import { navigate } from "./routing";
import { API_JSON_CACHE_PREFIX, API_JSON_CACHEABLE_PATHS, state } from "./state";

function normalizedApiPath(path) {
  const url = new URL(path, location.origin);
  return `${url.pathname}${url.search}`;
}

function isCacheableApiRequest(apiPath, method) {
  return method === "GET" && API_JSON_CACHEABLE_PATHS.some((pattern) => pattern.test(apiPath));
}

function apiJsonCacheKey(apiPath) {
  return `${API_JSON_CACHE_PREFIX}${apiPath}`;
}

function readApiJsonCache(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    return cached && cached.etag ? cached : null;
  } catch {
    return null;
  }
}

function writeApiJsonCache(key, etag, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ etag, data, stored_at: Date.now() }));
  } catch {
    localStorage.removeItem(key);
  }
}

function clearApiJsonCache() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(API_JSON_CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function requiredGatePath(user) {
  if (user?.password_change_required) return "/force-password-change";
  if (user?.rules_required) return "/rules/accept";
  return "";
}

function publicAuthPath(path = location.pathname) {
  return path === "/login" || path === "/setup" || path === "/forgot-password" || path.startsWith("/invite/") || path.startsWith("/reset-password/");
}

function redirectToRequiredGate(user) {
  const gate = requiredGatePath(user);
  if (!gate || location.pathname === gate || publicAuthPath()) return false;
  navigate(gate);
  return true;
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const apiPath = normalizedApiPath(path);
  const cacheable = isCacheableApiRequest(apiPath, method);
  const cacheKey = cacheable ? apiJsonCacheKey(apiPath) : "";
  const cached = cacheKey ? readApiJsonCache(cacheKey) : null;
  const headers = new Headers(options.headers || {});
  const body = options.body;
  if (body && !(body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (state.token) headers.set("authorization", `Bearer ${state.token}`);
  if (cached?.etag && !headers.has("if-none-match")) headers.set("if-none-match", cached.etag);
  const response = await fetch(path, {
    ...options,
    headers,
    cache: cacheable ? "no-cache" : options.cache || "no-store",
    credentials: "include",
    body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
  });
  if (response.status === 304 && cached) return cached.data;
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(typeof data === "object" ? data.error || "Request failed" : data || "Request failed");
    error.status = response.status;
    if (typeof data === "object") {
      error.password_change_required = !!data.password_change_required;
      error.rules_required = !!data.rules_required;
    }
    if (error.password_change_required && location.pathname !== "/force-password-change") navigate("/force-password-change");
    if (error.rules_required && location.pathname !== "/rules/accept") navigate("/rules/accept");
    throw error;
  }
  if (method !== "GET") clearApiJsonCache();
  const etag = response.headers.get("etag");
  if (cacheable && etag) writeApiJsonCache(cacheKey, etag, data);
  return data;
}

async function refreshMe() {
  const data = await api("/api/auth/me");
  state.me = data.user;
  state.instance = data.instance || state.instance;
  state.requirementsCheckedAt = Date.now();
  return state.me;
}

async function loadMembers() {
  try {
    const data = await api("/api/members");
    state.members = data.members || [];
  } catch {
    state.members = [];
  }
  state.membersLoaded = true;
  return state.members;
}

async function loadGalleries() {
  try {
    const data = await api("/api/galleries");
    state.galleries = (data.galleries || []).sort(newestFirst);
  } catch {
    state.galleries = [];
  }
  return state.galleries;
}

async function loadPopularTags() {
  try {
    const data = await api("/api/tags/popular");
    state.popularTags = data.tags || [];
  } catch {
    state.popularTags = [];
  }
  state.popularTagsLoaded = true;
  return state.popularTags;
}

async function loadNotificationStatus() {
  try {
    const data = await api("/api/notifications/poll");
    state.unreadNotifications = Number(data.unread_count || 0);
  } catch {
    state.unreadNotifications = 0;
  }
  state.notificationStatusLoaded = true;
  updateNotificationBell();
  return state.unreadNotifications;
}

async function loadRoleSuggestions() {
  try {
    const data = await api("/api/role-suggestions?scope=work_collaborator");
    state.roleSuggestions = data.roles || [];
  } catch {
    state.roleSuggestions = [];
  }
  return state.roleSuggestions;
}

async function ensureAuthed() {
  if (state.me) {
    if (Date.now() - Number(state.requirementsCheckedAt || 0) > 60 * 1000) {
      await refreshMe().catch(() => undefined);
    }
    if (redirectToRequiredGate(state.me)) return false;
    const loads = [];
    if (!state.galleries.length) loads.push(loadGalleries());
    if (!state.popularTagsLoaded) loads.push(loadPopularTags());
    if (!state.notificationStatusLoaded) loads.push(loadNotificationStatus());
    if (loads.length) await Promise.all(loads);
    return true;
  }
  try {
    await refreshMe();
    if (redirectToRequiredGate(state.me)) return false;
    await Promise.all([loadGalleries(), loadPopularTags(), loadNotificationStatus()]);
    syncBrowserNotifications().catch(() => undefined);
    return true;
  } catch (error) {
    state.me = null;
    state.popularTagsLoaded = false;
    state.notificationStatusLoaded = false;
    localStorage.removeItem("qc_token");
    if (location.pathname !== "/login" && location.pathname !== "/setup" && !location.pathname.startsWith("/invite/")) navigate("/login");
    return false;
  }
}


export { api, clearApiJsonCache, loadGalleries, loadMembers, loadNotificationStatus, loadPopularTags, loadRoleSuggestions, refreshMe, ensureAuthed };
