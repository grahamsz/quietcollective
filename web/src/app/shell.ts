// @ts-nocheck
import { mountComponentIslands } from "../components/islands";
import { icon } from "../components/icons";
import { bindProtectedMedia } from "../components/media";
import { avatar, button, iconButton, link } from "../components/ui";
import { encodePath, escapeHtml, newestFirst } from "../lib/utils";
import { api } from "./api";
import { enhanceMarkdownEditors } from "./forms";
import { bindNotificationActions, bindReactionButtons, bindReplyButtons } from "./interactions";
import { disableBrowserNotifications, notificationBell, touchBrowserNotificationWindow } from "./notifications";
import { navigate } from "./routing";
import { state, UPSTREAM_SOURCE_URL } from "./state";

const appRoot = document.querySelector("#app");

function ownershipHelp(value) {
  if (value === "whole_server") return "Everyone ownership lets any logged-in member add images. Only the owner, gallery admins, and instance admins can edit gallery settings.";
  if (value === "collaborative") return "Collaborative galleries are meant for invited collaborators. Add members who can upload, edit, or manage collaborators.";
  return "Self-owned galleries are controlled by you. You can still invite people to view or comment.";
}

function visibilityHelp(value) {
  return value === "server_public"
    ? "Everyone means any logged-in member of this instance can view it. It is never anonymous public web access."
    : "Private means only you, explicitly added gallery members, and admins can view it.";
}

function brandMark() {
  if (state.instance.logo_url) return `<img class="brand-logo" src="${escapeHtml(state.instance.logo_url)}" alt="">`;
  return `<div class="brand-mark" aria-hidden="true">QC</div>`;
}


function pageShell(content, options = {}) {
  const myGalleries = state.galleries
    .filter((gallery) => gallery.owner_user_id === state.me?.id || gallery.capabilities?.upload_work)
    .sort(newestFirst)
    .slice(0, 8);
  const popularTags = (state.popularTags || []).slice(0, 5);
  const source = state.instance.source_code_url
    ? `<a class="source-link is-visible" href="${escapeHtml(state.instance.source_code_url)}" rel="noreferrer">Source Code</a>`
    : "";
  return `
    <div class="layout">
      <aside class="sidebar">
        <a class="sidebar-head" href="/" data-link>${brandMark()}<div class="brand-title"><strong>${escapeHtml(state.instance.name || "QuietCollective")}</strong><span>Private artist community</span></div></a>
        <section class="sidebar-section sidebar-section-primary">
          <h2>My Galleries</h2>
          ${myGalleries.length ? `<div class="sidebar-gallery-list">${myGalleries.map((gallery) => `<a href="/galleries/${gallery.id}" data-link><span>${escapeHtml(gallery.title)}</span></a>`).join("")}</div>` : `<div class="empty-state compact">No galleries yet.</div>`}
          <a href="/galleries" class="sidebar-view-all" data-link>View All</a>
          <a href="/galleries/new" class="sidebar-new-gallery" data-link><span>${icon("plus")}</span><strong>New</strong></a>
        </section>
        ${popularTags.length ? `<section class="sidebar-section sidebar-tags"><h2>Popular Tags</h2><div class="sidebar-tag-list">${popularTags.map((tag) => `<a href="/tags/${encodePath(tag.tag)}" data-link><span>#${escapeHtml(tag.tag)}</span><small>${escapeHtml(String(tag.count || 0))}</small></a>`).join("")}</div></section>` : ""}
        <div class="sidebar-foot">
          ${state.me?.role === "admin" ? `<nav class="admin-nav" aria-label="Admin"><a href="/admin" ${location.pathname === "/admin" ? 'aria-current="page"' : ""} data-link>Admin</a><a href="/admin/invites" ${location.pathname === "/admin/invites" ? 'aria-current="page"' : ""} data-link>Invites</a></nav>` : ""}
          <p class="rights-note">Uploaded user content remains owned by the uploader or rights holder. Powered by the open source <a href="${UPSTREAM_SOURCE_URL}" rel="noreferrer">QuietCollective project</a>.</p>
          ${source}
        </div>
      </aside>
      <main class="main-column">
        <header class="topbar">
          ${iconButton("menu", "Menu", "icon-button mobile-menu", "data-menu type=button")}
          <div><strong>${escapeHtml(options.kicker || state.instance.name || "QuietCollective")}</strong></div>
          <div class="topbar-actions">${state.me ? `${notificationBell()}<a href="/me/profile" class="user-chip" data-link>${avatar(state.me)}<span>${escapeHtml(state.me.handle)}</span></a>${button("Log out", "button ghost", "data-logout")}` : link("/login", "Log in", "button")}</div>
        </header>
        <div class="content">${content}</div>
      </main>
    </div>
  `;
}

function authPage(content) {
  return `<main class="boot-screen">${brandMark()}<section class="panel" style="width:min(520px,calc(100vw - 32px));text-align:left"><div class="panel-body">${content}<p class="rights-note" style="margin-top:18px">Uploaded user content remains owned by the uploader or rights holder. Powered by the open source <a href="${UPSTREAM_SOURCE_URL}" rel="noreferrer">QuietCollective project</a>.</p></div></section></main>`;
}

function setApp(html) {
  appRoot.innerHTML = html;
  mountComponentIslands(appRoot);
  bindCommonActions();
  enhanceMarkdownEditors(appRoot);
}

function bindCommonActions() {
  document.querySelectorAll("a[data-link]").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      event.preventDefault();
      navigate(`${url.pathname}${url.search}`);
    });
  });
  document.querySelector("[data-menu]")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  document.querySelector("[data-logout]")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    state.token = "";
    state.me = null;
    state.popularTags = [];
    state.popularTagsLoaded = false;
    state.unreadNotifications = 0;
    state.notificationStatusLoaded = false;
    await disableBrowserNotifications({ silent: true });
    localStorage.removeItem("qc_token");
    navigate("/login");
  });
  bindReactionButtons();
  bindNotificationActions();
  bindReplyButtons();
  bindProtectedMedia();
  touchBrowserNotificationWindow();
}


export { authPage, bindCommonActions, brandMark, ownershipHelp, pageShell, setApp, visibilityHelp };
