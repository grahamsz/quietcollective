// @ts-nocheck
import { api, encodePath, ensureAuthed, loadGalleries, loadMembers, navigate, newestFirst, pageShell, setApp, state, syncBrowserNotifications, updateNotificationBell } from "../app/core";
import { bindCommentForm, highlightLinkedComment } from "../app/comments";
import { galleriesIndexView, homeView, memberProfileView, membersIndexView, tagPageView } from "../views/islands";

async function renderHome() {
  let data;
  try {
    data = await api("/api/home");
  } catch (error) {
    if (error?.status !== 401) throw error;
    state.me = null;
    state.popularTagsLoaded = false;
    state.notificationStatusLoaded = false;
    localStorage.removeItem("qc_token");
    if (location.pathname !== "/login") navigate("/login");
    return;
  }

  state.me = data.user;
  state.instance = data.instance || state.instance;
  state.requirementsCheckedAt = Date.now();
  if (state.me?.password_change_required) return navigate("/force-password-change");
  if (state.me?.rules_required) return navigate("/rules/accept");

  state.galleries = (data.galleries || []).sort(newestFirst);
  state.members = data.members || [];
  state.membersLoaded = true;
  state.popularTags = data.popular_tags || [];
  state.popularTagsLoaded = true;
  state.unreadNotifications = Number(data.unread_count || 0);
  state.notificationStatusLoaded = true;
  setApp(pageShell(homeView({
    instanceName: state.instance.name,
    subtitle: state.instance.homepage_subtitle || "",
    galleries: state.galleries,
    works: data.works || [],
    activityEvents: data.activity_events || [],
    members: state.members,
  })));
  updateNotificationBell();
  syncBrowserNotifications().catch(() => undefined);
}

async function renderGalleries() {
  if (!(await ensureAuthed())) return;
  const galleries = await loadGalleries();
  setApp(pageShell(galleriesIndexView(galleries)));
}

async function renderMembers() {
  if (!(await ensureAuthed())) return;
  await loadMembers();
  setApp(pageShell(membersIndexView(state.members)));
}

async function renderMemberProfile(handle) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/users/${encodePath(handle)}`);
  const user = data.user;
  const [comments, works] = await Promise.all([
    api(`/api/comments?target_type=profile&target_id=${encodePath(user.id)}`).catch(() => ({ comments: [] })),
    api(`/api/users/${encodePath(handle)}/works`).catch(() => ({ works: [] })),
  ]);
  setApp(pageShell(memberProfileView({ user, comments: comments.comments, works: works.works || [] })));
  bindCommentForm("profile", user.id);
  highlightLinkedComment();
}

async function renderTagPage(tag) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/tags/${encodePath(tag)}`);
  setApp(pageShell(tagPageView(data)));
}

export { renderGalleries, renderHome, renderMemberProfile, renderMembers, renderTagPage };
