// @ts-nocheck
export const state = {
  me: null,
  instance: { name: "QuietCollective", source_code_url: "", logo_url: "" },
  members: [],
  galleries: [],
  popularTags: [],
  popularTagsLoaded: false,
  unreadNotifications: 0,
  notificationStatusLoaded: false,
  roleSuggestions: [],
  token: localStorage.getItem("qc_token") || "",
};

export const UPSTREAM_SOURCE_URL = "https://www.github.com/grahamsz/quietcollective";
export const DEFAULT_WORK_ROLES = ["photographer", "model", "muse", "artist", "lighting", "staging", "make-up"];
export const NOTIFICATION_ACTIVE_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const NOTIFICATION_IDLE_POLL_INTERVAL_MS = 30 * 60 * 1000;
export const NOTIFICATION_ACTIVE_WINDOW_MS = 60 * 60 * 1000;
export const BROWSER_NOTIFICATIONS_KEY = "qc_browser_notifications";
export const API_JSON_CACHE_PREFIX = "qc_api_cache:";
export const API_JSON_CACHEABLE_PATHS = [
  /^\/api\/galleries(?:$|\/[^/?]+$)/,
  /^\/api\/activity$/,
  /^\/api\/notifications$/,
  /^\/api\/notifications\/poll(?:\?|$)/,
  /^\/api\/tags\/popular$/,
  /^\/api\/comments\?/,
];
