// @ts-nocheck
import { activeLabel, api, avatar, empty, encodePath, ensureAuthed, escapeHtml, galleryMosaic, iconLink, imageGrid, loadGalleries, loadMembers, newestFirst, pageShell, panel, renderMarkdown, setApp, state } from "../app/core";
import { commentArticle, commentsPanel } from "../app/comments";
import { eventList, memberMini, notificationList } from "../views/lists";

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
  const feedbackWorks = works.filter((work) => work.feedback_requested && !work.feedback_dismissed);
  const unreadNotifications = (notificationsData.notifications || []).filter((notification) => !notification.read_at);
  state.unreadNotifications = unreadNotifications.length;
  state.notificationStatusLoaded = true;
  setApp(pageShell(`
    <section class="view home-view">
      ${unreadNotifications.length ? panel("Notifications", notificationList(unreadNotifications.slice(0, 8)), "notification-panel") : ""}
      <div class="view-header"><div><p class="eyebrow">Recently Updated</p><h1>${escapeHtml(state.instance.name || "QuietCollective")}</h1><p class="lede">Private image galleries, critique, collaborator credits, and member profiles for logged-in members.</p></div><div class="toolbar">${iconLink("/galleries/new", "plus", "New gallery", "button primary square-button")}</div></div>
      ${state.galleries.length ? panel("Recently Updated Galleries", galleryMosaic(state.galleries.slice(0, 14)), "flush-panel") : empty("No visible galleries yet.")}
      ${feedbackWorks.length ? panel("Feedback Requested", imageGrid(feedbackWorks.slice(0, 12)), "flush-panel") : ""}
      ${works.length ? panel("Fresh Works", imageGrid(works.slice(0, 18)), "flush-panel") : ""}
      <div class="home-lower-grid">${panel("Activity", activity.events?.length ? eventList(activity.events.slice(0, 18)) : empty("No recent visible activity."), "activity-panel")}${panel("Members", `<div class="member-rail">${state.members.map(memberMini).join("")}</div>`)}</div>
    </section>
  `));
}

async function renderGalleries() {
  if (!(await ensureAuthed())) return;
  const galleries = await loadGalleries();
  setApp(pageShell(`<section class="view gallery-view"><div class="view-header"><div><p class="eyebrow">Galleries</p><h1>Browse galleries</h1></div><div class="toolbar">${iconLink("/galleries/new", "plus", "New gallery", "button primary square-button")}</div></div>${galleries.length ? galleryMosaic(galleries) : empty("No visible galleries yet.")}</section>`));
}

async function renderMembers() {
  if (!(await ensureAuthed())) return;
  await loadMembers();
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Members</p><h1>Community members</h1></div></div><div class="card-grid">${state.members.map(memberMini).join("") || empty("No members yet.")}</div></section>`));
}

async function renderMemberProfile(handle) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/users/${encodePath(handle)}`);
  const user = data.user;
  const comments = await api(`/api/comments?target_type=profile&target_id=${encodePath(user.id)}`).catch(() => ({ comments: [] }));
  setApp(pageShell(`<section class="view"><div class="profile-head">${avatar(user, "avatar-lg")}<div><p class="eyebrow">Member</p><h1>@${escapeHtml(user.handle)}</h1><p class="member-active">${escapeHtml(activeLabel(user.last_active_at))}</p></div></div><div class="grid two">${panel("Profile", `<div class="description markdown-body">${renderMarkdown(user.bio || "No bio yet.")}</div><div class="badge-row">${(user.medium_tags || []).map((tag) => `<a href="/tags/${encodePath(tag)}" class="badge green" data-link>#${escapeHtml(tag)}</a>`).join("")}</div>`)}${commentsPanel("profile", user.id, comments.comments)}</div></section>`));
  bindCommentForm("profile", user.id);
}

async function renderTagPage(tag) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/tags/${encodePath(tag)}`);
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Tag</p><h1>#${escapeHtml(data.tag)}</h1><p class="lede">Photos, galleries, members, and visible comments using this tag.</p></div></div>${data.works?.length ? panel("Photos", imageGrid(data.works), "flush-panel") : empty("No visible photos use this tag yet.")}<div class="home-lower-grid">${panel("Galleries", data.galleries?.length ? galleryMosaic(data.galleries) : empty("No galleries use this tag."), "flush-panel")}${panel("Members", data.members?.length ? `<div class="member-rail">${data.members.map(memberMini).join("")}</div>` : empty("No members use this tag."))}</div>${panel("Comments", data.comments?.length ? `<div class="grid">${data.comments.map((comment) => commentArticle(comment, { replyButton: false })).join("")}</div>` : empty("No visible comments use this tag."))}</section>`));
}


export { renderGalleries, renderHome, renderMemberProfile, renderMembers, renderTagPage };
