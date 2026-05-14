// @ts-nocheck
import { mountComponentIslands } from "../components/islands";
import { icon } from "../components/icons";
import { bindProtectedMedia } from "../components/media";
import { avatar, button, iconButton, link } from "../components/ui";
import { galleryIsMine, galleryIsPublic } from "../lib/gallery-filters";
import { encodePath, escapeHtml, newestFirst } from "../lib/utils";
import { api } from "./api";
import { enhanceMarkdownEditors } from "./forms";
import { bindInstallActions, installButton } from "./install";
import { bindMarkdownImageLinks, bindNotificationActions, bindReactionButtons, bindReplyButtons } from "./interactions";
import { disableBrowserNotifications, notificationBell, touchBrowserNotificationWindow, updateNotificationBell } from "./notifications";
import { navigate } from "./routing";
import { state, UPSTREAM_SOURCE_URL } from "./state";

const appRoot = document.querySelector("#app");

function ownershipHelp(value) {
  if (value === "whole_server") return "Everyone ownership lets any logged-in member add images. Gallery settings are limited to the gallery owner and managers.";
  if (value === "collaborative") return "Collaborative galleries are meant for invited collaborators. Add members who can upload, edit, or manage collaborators.";
  return "Individual galleries are controlled by you. You can still invite people to view or comment.";
}

function visibilityHelp(value, ownership = "") {
  if (ownership === "self" && value === "server_public") return "Everyone can view and comment, but only you can add images unless you invite members.";
  return value === "server_public"
    ? "Everyone means any logged-in member of this instance can view it. It is never anonymous public web access."
    : "Private means only you and explicitly added gallery members can view it.";
}

/** Renders the site logo mark used by the sidebar and auth shell. */
function brandMark() {
  if (state.instance.logo_url) return `<img class="brand-logo" src="${escapeHtml(state.instance.logo_url)}" alt="">`;
  return `<div class="brand-mark" aria-hidden="true">QC</div>`;
}

function sidebarGalleryList(galleries) {
  return `<div class="sidebar-gallery-list">${galleries.map((gallery) => `<a href="/galleries/${gallery.id}" data-link><span>${escapeHtml(gallery.title)}</span></a>`).join("")}</div>`;
}

/** Wraps authenticated page views with sidebar, topbar, and shared navigation. */
function pageShell(content, options = {}) {
  const visibleGalleries = [...(state.galleries || [])].sort(newestFirst);
  const publicGalleries = visibleGalleries.filter(galleryIsPublic).slice(0, 8);
  const myGalleries = visibleGalleries.filter((gallery) => galleryIsMine(gallery, state.me?.id)).slice(0, 8);
  const popularTags = (state.popularTags || []).slice(0, 5);
  const forumBoards = (state.forumBoards || []).slice(0, 8);
  const source = state.instance.source_code_url
    ? `<a class="source-link is-visible" href="${escapeHtml(state.instance.source_code_url)}" rel="noreferrer">Source Code</a>`
    : "";
  const rules = state.me?.current_rule_version_id
    ? `<a class="source-link is-visible" href="/rules/accept" data-link>Server Rules</a>`
    : "";
  return `
    <div class="layout">
      <aside class="sidebar">
        <a class="sidebar-head" href="/" data-link>${brandMark()}<div class="brand-title"><strong>${escapeHtml(state.instance.name || "QuietCollective")}</strong><span>Private artist community</span></div></a>
        <section class="sidebar-section sidebar-section-primary">
          <h2>Public Galleries</h2>
          ${publicGalleries.length ? sidebarGalleryList(publicGalleries) : `<div class="empty-state compact">No public galleries yet.</div>`}
          <a href="/galleries" class="sidebar-view-all" ${location.pathname === "/galleries" && !location.search ? 'aria-current="page"' : ""} data-link>All Galleries</a>
        </section>
        <section class="sidebar-section sidebar-my-galleries">
          <h2>My Galleries</h2>
          ${myGalleries.length ? sidebarGalleryList(myGalleries) : `<div class="empty-state compact">No personal galleries yet.</div>`}
          <a href="/galleries/new" class="sidebar-new-gallery" data-link><span>${icon("plus")}</span><strong>New Gallery</strong></a>
        </section>
        <section class="sidebar-section sidebar-community">
          <h2>Boards</h2>
          ${forumBoards.length ? `<div class="sidebar-board-list">${forumBoards.map((board) => {
            const href = `/discussions/boards/${encodePath(board.slug || board.id)}`;
            const current = location.pathname === href || location.pathname === `/discussions/boards/${encodePath(board.id)}`;
            return `<a href="${href}" ${current ? 'aria-current="page"' : ""} data-link><span>${escapeHtml(board.title)}</span><strong>${escapeHtml(String(board.thread_count || 0))}</strong></a>`;
          }).join("")}</div>` : `<div class="empty-state compact">No boards yet.</div>`}
          ${state.me?.role === "admin" ? `<a href="/discussions/new-board" class="sidebar-new-board" ${location.pathname === "/discussions/new-board" ? 'aria-current="page"' : ""} data-link><span>${icon("plus")}</span><strong>New Board</strong></a>` : ""}
        </section>
        ${popularTags.length ? `<section class="sidebar-section sidebar-tags"><h2>Popular Tags</h2><div class="sidebar-tag-list">${popularTags.map((tag) => `<a href="/tags/${encodePath(tag.tag)}" data-link><span>#${escapeHtml(tag.tag)}</span><small>${escapeHtml(String(tag.count || 0))}</small></a>`).join("")}</div></section>` : ""}
        <div class="sidebar-foot">
          ${installButton()}
          ${state.me?.role === "admin" ? `<nav class="admin-nav" aria-label="Admin"><a href="/admin" ${location.pathname === "/admin" ? 'aria-current="page"' : ""} data-link>Admin</a><a href="/admin/invites" ${location.pathname === "/admin/invites" ? 'aria-current="page"' : ""} data-link>Invites</a></nav>` : ""}
          <p class="rights-note">${escapeHtml(state.instance.content_notice || "Uploaded user content remains owned by the uploader or rights holder.")} Powered by the open source <a href="${UPSTREAM_SOURCE_URL}" rel="noreferrer">QuietCollective project</a>.</p>
          ${source}
          ${rules}
        </div>
      </aside>
      <main class="main-column">
        <header class="topbar">
          ${iconButton("menu", "Menu", "icon-button mobile-menu", "data-menu type=button")}
          <div class="topbar-actions">${state.me ? `${notificationBell()}<a href="/me/profile" class="user-chip" data-link>${avatar(state.me)}<span>${escapeHtml(state.me.handle)}</span></a>` : link("/login", "Log in", "button")}</div>
        </header>
        <div class="content">${content}</div>
      </main>
    </div>
  `;
}

/** Wraps setup, login, and invite views in the unauthenticated boot screen. */
function authPage(content) {
  return `<main class="boot-screen">${brandMark()}<section class="panel" style="width:min(520px,calc(100vw - 32px));text-align:left"><div class="panel-body">${content}<p class="rights-note" style="margin-top:18px">${escapeHtml(state.instance.content_notice || "Uploaded user content remains owned by the uploader or rights holder.")} Powered by the open source <a href="${UPSTREAM_SOURCE_URL}" rel="noreferrer">QuietCollective project</a>.</p></div></section></main>`;
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
      navigate(`${url.pathname}${url.search}${url.hash}`);
    });
  });
  document.querySelector("[data-menu]")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  document.querySelector("[data-logout]")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    state.token = "";
    state.me = null;
    state.forumBoards = [];
    state.forumBoardsLoaded = false;
    state.recentForumThreads = [];
    state.popularTags = [];
    state.popularTagsLoaded = false;
    state.unreadNotifications = 0;
    state.notificationStatusLoaded = false;
    state.requirementsCheckedAt = 0;
    updateNotificationBell();
    await disableBrowserNotifications({ silent: true });
    localStorage.removeItem("qc_token");
    navigate("/login");
  });
  bindReactionButtons();
  bindInstallActions();
  bindNotificationActions();
  bindReplyButtons();
  bindMarkdownImageLinks();
  bindProtectedMedia();
  touchBrowserNotificationWindow();
}


export { authPage, bindCommonActions, brandMark, ownershipHelp, pageShell, setApp, visibilityHelp };
