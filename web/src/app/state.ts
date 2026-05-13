// @ts-nocheck
export const state = {
  me: null,
  instance: { name: "QuietCollective", site_url: "", source_code_url: "", logo_url: "" },
  members: [],
  membersLoaded: false,
  galleries: [],
  forumBoards: [],
  forumBoardsLoaded: false,
  recentForumThreads: [],
  popularTags: [],
  popularTagsLoaded: false,
  unreadNotifications: 0,
  notificationStatusLoaded: false,
  requirementsCheckedAt: 0,
  roleSuggestions: [],
  token: localStorage.getItem("qc_token") || "",
};

export function ownsGallery(gallery) {
  return !!gallery && (gallery.owner_user_id === state.me?.id || gallery.created_by === state.me?.id);
}

export function canCrosspostToGallery(gallery) {
  if (!gallery?.capabilities?.upload_work) return false;
  if (ownsGallery(gallery)) return true;
  return gallery.ownership_type === "whole_server" || !!gallery.whole_server_upload;
}

export const UPSTREAM_SOURCE_URL = "https://www.github.com/grahamsz/quietcollective";
export const DEFAULT_WORK_ROLES = ["photographer", "model", "muse", "artist", "lighting", "staging", "make-up"];
export const NOTIFICATION_RECENT_POLL_INTERVAL_MS = 60 * 1000;
export const NOTIFICATION_RECENT_WINDOW_MS = 30 * 60 * 1000;
export const NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const NOTIFICATION_FOLLOWUP_WINDOW_MS = 2 * 60 * 60 * 1000;
export const NOTIFICATION_IDLE_POLL_INTERVAL_MS = 30 * 60 * 1000;
export const NOTIFICATION_ACTIVE_POLL_INTERVAL_MS = NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS;
export const NOTIFICATION_ACTIVE_WINDOW_MS = NOTIFICATION_RECENT_WINDOW_MS + NOTIFICATION_FOLLOWUP_WINDOW_MS;
export const BROWSER_NOTIFICATIONS_KEY = "qc_browser_notifications";
export const API_JSON_CACHE_PREFIX = "qc_api_cache:";
export const API_JSON_CACHEABLE_PATHS = [
  /^\/api\/home$/,
  /^\/api\/auth\/me$/,
  /^\/api\/members$/,
  /^\/api\/users\/[^/?]+$/,
  /^\/api\/users\/[^/?]+\/works$/,
  /^\/api\/galleries(?:$|\/[^/?]+$)/,
  /^\/api\/galleries\/[^/?]+\?.*include=comments/,
  /^\/api\/forum\/boards(?:$|\/[^/?]+$)/,
  /^\/api\/forum\/threads\/[^/?]+$/,
  /^\/api\/works\/[^/?]+\/comments$/,
  /^\/api\/activity$/,
  /^\/api\/notifications$/,
  /^\/api\/notifications\/poll(?:\?|$)/,
  /^\/api\/tags\/popular$/,
  /^\/api\/tags\/[^/?]+$/,
  /^\/api\/comments\?/,
];
