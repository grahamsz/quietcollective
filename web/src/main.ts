// @ts-nocheck
import { escapeHtml, navigate, pageShell, setApp, setRouteRenderer, state, updateNotificationBell } from "./app/core";
import { renderAdmin, renderAdminInvites } from "./pages/admin";
import { renderExports, renderMyProfile } from "./pages/account";
import { renderGallery, renderGallerySettings, renderNewGallery } from "./pages/galleries";
import { renderDiscussionBoard, renderDiscussions, renderDiscussionThread } from "./pages/forum";
import { renderGalleries, renderHome, renderMemberProfile, renderMembers, renderTagPage } from "./pages/home";
import { renderForcePasswordChange, renderForgotPassword, renderInvite, renderLogin, renderResetPassword, renderRulesAccept, renderSetup } from "./pages/auth";
import { renderNotFound } from "./pages/not-found";
import { renderWork, renderWorkEdit, renderWorkVersions } from "./pages/works";

const routes = [
  ["/setup", renderSetup],
  ["/login", renderLogin],
  ["/forgot-password", renderForgotPassword],
  [/^\/reset-password\/([^/]+)$/, renderResetPassword],
  ["/force-password-change", renderForcePasswordChange],
  ["/rules/accept", renderRulesAccept],
  [/^\/invite\/([^/]+)$/, renderInvite],
  ["/", renderHome],
  ["/galleries", renderGalleries],
  ["/galleries/new", renderNewGallery],
  [/^\/galleries\/([^/]+)\/settings$/, renderGallerySettings],
  [/^\/galleries\/([^/]+)$/, renderGallery],
  ["/discussions", renderDiscussions],
  [/^\/discussions\/boards\/([^/]+)$/, renderDiscussionBoard],
  [/^\/discussions\/threads\/([^/]+)$/, renderDiscussionThread],
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

function documentIsPrerendering() {
  return !!document.prerendering || document.visibilityState === "prerender";
}

function renderAfterPrerenderActivation() {
  if (!documentIsPrerendering()) {
    renderCurrentRoute();
    return;
  }

  let rendered = false;
  const renderOnceActive = () => {
    if (rendered || documentIsPrerendering()) return;
    rendered = true;
    document.removeEventListener("prerenderingchange", renderOnceActive);
    document.removeEventListener("visibilitychange", renderOnceActive);
    window.removeEventListener("pageshow", renderOnceActive);
    renderCurrentRoute();
  };

  document.addEventListener("prerenderingchange", renderOnceActive);
  document.addEventListener("visibilitychange", renderOnceActive);
  window.addEventListener("pageshow", renderOnceActive);
}

if ("serviceWorker" in navigator) {
  const buildVersion = document.querySelector('meta[name="qc-build"]')?.getAttribute("content") || "";
  const serviceWorkerUrl = buildVersion && buildVersion !== "dev" ? `/sw.js?v=${encodeURIComponent(buildVersion)}` : "/sw.js";
  navigator.serviceWorker.register(serviceWorkerUrl, { scope: "/" }).then((registration) => registration.update().catch(() => undefined)).catch(() => undefined);
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "qc-notifications-status") return;
    state.unreadNotifications = Number(event.data.unreadCount || 0);
    state.notificationStatusLoaded = true;
    updateNotificationBell();
  });
}

renderAfterPrerenderActivation();
