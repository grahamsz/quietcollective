// @ts-nocheck
import { api, encodePath, ensureAuthed, loadGalleries, loadMembers, newestFirst, pageShell, setApp, state } from "../app/core";
import { bindCommentForm } from "../app/comments";
import { galleriesIndexView, homeView, memberProfileView, membersIndexView, tagPageView } from "../views/islands";

async function renderHome() {
  if (!(await ensureAuthed())) return;
  await loadMembers();
  const [activity, notificationsData] = await Promise.all([
    api("/api/activity").catch(() => ({ events: [] })),
    api("/api/notifications").catch(() => ({ notifications: [] })),
    loadGalleries(),
  ]);
  const details = await Promise.all(state.galleries.slice(0, 8).map((gallery) => api(`/api/galleries/${gallery.id}`).catch(() => null)));
  const works = Array.from(
    new Map(details.flatMap((detail) => detail?.works || []).filter((work) => !work.deleted_at).map((work) => [work.id, work])).values(),
  ).sort(newestFirst);
  const unreadNotifications = (notificationsData.notifications || []).filter((notification) => !notification.read_at);
  state.unreadNotifications = unreadNotifications.length;
  state.notificationStatusLoaded = true;
  setApp(pageShell(homeView({
    instanceName: state.instance.name,
    galleries: state.galleries,
    works,
    activityEvents: activity.events || [],
    members: state.members,
  })));
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
  const comments = await api(`/api/comments?target_type=profile&target_id=${encodePath(user.id)}`).catch(() => ({ comments: [] }));
  setApp(pageShell(memberProfileView({ user, comments: comments.comments })));
  bindCommentForm("profile", user.id);
}

async function renderTagPage(tag) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/tags/${encodePath(tag)}`);
  setApp(pageShell(tagPageView(data)));
}

export { renderGalleries, renderHome, renderMemberProfile, renderMembers, renderTagPage };
