// @ts-nocheck
import { escapeHtml, navigate, pageShell, setApp, setRouteRenderer, state, updateNotificationBell } from "./app/core";
import { renderAdmin, renderAdminInvites } from "./pages/admin";
import { renderExports, renderMyProfile } from "./pages/account";
import { renderGallery, renderGallerySettings, renderNewGallery } from "./pages/galleries";
import { renderGalleries, renderHome, renderMemberProfile, renderMembers, renderTagPage } from "./pages/home";
import { renderInvite, renderLogin, renderSetup } from "./pages/auth";
import { renderNotFound } from "./pages/not-found";
import { renderWork, renderWorkEdit, renderWorkVersions } from "./pages/works";

const routes = [
  ["/setup", renderSetup],
  ["/login", renderLogin],
  [/^\/invite\/([^/]+)$/, renderInvite],
  ["/", renderHome],
  ["/galleries", renderGalleries],
  ["/galleries/new", renderNewGallery],
  [/^\/galleries\/([^/]+)\/settings$/, renderGallerySettings],
  [/^\/galleries\/([^/]+)$/, renderGallery],
  [/^\/works\/([^/]+)\/edit$/, renderWorkEdit],
  [/^\/works\/([^/]+)\/versions$/, renderWorkVersions],
  [/^\/works\/([^/]+)$/, renderWork],
  ["/members", renderMembers],
  [/^\/members\/([^/]+)$/, renderMemberProfile],
  [/^\/tags\/([^/]+)$/, renderTagPage],
  ["/me/profile", renderMyProfile],
  ["/me/exports", renderExports],
  ["/admin/invites", renderAdminInvites],
  ["/admin", renderAdmin],
];

async function renderCurrentRoute() {
  document.body.classList.remove("nav-open");
  const path = location.pathname;
  try {
    for (const [pattern, handler] of routes) {
      if (typeof pattern === "string" && pattern === path) {
        await handler();
        return;
      }
      if (pattern instanceof RegExp) {
        const match = path.match(pattern);
        if (match) {
          await handler(...match.slice(1));
          return;
        }
      }
    }
    await renderNotFound();
  } catch (error) {
    if (error.status === 401) {
      navigate("/login");
      return;
    }
    setApp(pageShell(`<section class="view"><div class="error-box"><strong>${escapeHtml(error.message || "Something went wrong")}</strong></div></section>`));
  }
}

setRouteRenderer(renderCurrentRoute);
window.addEventListener("popstate", renderCurrentRoute);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "qc-notifications-status") return;
    state.unreadNotifications = Number(event.data.unreadCount || 0);
    state.notificationStatusLoaded = true;
    updateNotificationBell();
  });
}

renderCurrentRoute();
