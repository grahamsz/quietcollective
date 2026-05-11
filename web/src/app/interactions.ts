// @ts-nocheck
import { icon } from "../components/icons";
import { button } from "../components/ui";
import { encodePath, escapeHtml } from "../lib/utils";
import { api, loadNotificationStatus } from "./api";
import { field } from "./forms";
import { navigate, renderRoute } from "./routing";
import { disableBrowserNotifications, enableBrowserNotifications, notificationBrowserToggle, notificationMenuEmpty, notificationMenuLoading } from "./notifications";
import { toast } from "./toast";

let notificationOutsideBound = false;

/** Renders the heart reaction button used by work and comment components. */
function reactionButton(targetType, targetId, reactions = {}) {
  const count = reactions.heart_count || 0;
  const label = reactions.hearted_by_me ? "Remove heart" : "Heart";
  return `<button class="heart-button ${reactions.hearted_by_me ? "is-active" : ""}" data-heart-target-type="${escapeHtml(targetType)}" data-heart-target-id="${escapeHtml(targetId)}" data-hearted="${reactions.hearted_by_me ? "true" : "false"}" type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon("heart")}${count ? `<span>${escapeHtml(String(count))}</span>` : ""}</button>`;
}

function bindReactionButtons() {
  document.querySelectorAll("[data-heart-target-type]").forEach((control) => {
    control.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const targetType = control.dataset.heartTargetType;
        const targetId = control.dataset.heartTargetId;
        const method = control.dataset.hearted === "true" ? "DELETE" : "POST";
        const data = await api(`/api/reactions/${encodePath(targetType)}/${encodePath(targetId)}/heart`, { method });
        control.dataset.hearted = data.reactions.hearted_by_me ? "true" : "false";
        control.classList.toggle("is-active", data.reactions.hearted_by_me);
        const count = data.reactions.heart_count || 0;
        const label = data.reactions.hearted_by_me ? "Remove heart" : "Heart";
        control.setAttribute("aria-label", label);
        control.setAttribute("title", label);
        control.innerHTML = `${icon("heart")}${count ? `<span>${escapeHtml(String(count))}</span>` : ""}`;
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

function openMarkdownImageModal(src, alt = "") {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop markdown-image-modal-backdrop";
  overlay.innerHTML = `<section class="modal-panel markdown-image-modal" role="dialog" aria-modal="true" aria-label="Image preview"><button class="icon-button markdown-image-modal-close" type="button" data-close-modal aria-label="Close" title="Close">${icon("x")}</button><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></section>`;
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };
  document.body.append(overlay);
  document.addEventListener("keydown", onKeydown);
  overlay.querySelector("[data-close-modal]")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
}

function bindMarkdownImageLinks(scope = document) {
  scope.querySelectorAll("[data-markdown-image-full]:not([data-markdown-image-bound])").forEach((linkEl) => {
    linkEl.dataset.markdownImageBound = "true";
    linkEl.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const src = linkEl.dataset.markdownImageFull || linkEl.getAttribute("href");
      if (!src) return;
      event.preventDefault();
      openMarkdownImageModal(src, linkEl.querySelector("img")?.getAttribute("alt") || "");
    });
  });
}

function bindNotificationActions() {
  bindNotificationMenu();
  document.querySelector("[data-notifications-read-all]")?.addEventListener("click", async () => {
    await api("/api/notifications/read-all", { method: "POST" }).catch((error) => toast(error.message, "error"));
    await loadNotificationStatus();
    renderRoute();
  });
  document.querySelectorAll("[data-notification-read]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/notifications/${encodePath(control.dataset.notificationRead)}/read`, { method: "POST" }).catch((error) => toast(error.message, "error"));
      await loadNotificationStatus();
      renderRoute();
    });
  });
  document.querySelectorAll("[data-notification-item]").forEach((control) => {
    control.addEventListener("click", handleNotificationItemClick);
  });
}

function renderNotificationMenuItems(notifications) {
  const rows = (notifications || []).slice(0, 12).map((notification) => {
    const href = notification.href || "";
    const tag = href ? "a" : "button";
    const hrefAttr = href ? ` href="${escapeHtml(href)}"` : "";
    const unread = notification.read_at ? "" : " is-unread";
    const thumb = notification.thumbnail_url ? `<img class="notification-menu-thumb" src="${escapeHtml(notification.thumbnail_url)}" alt="">` : "";
    const thumbClass = thumb ? "" : " no-thumb";
    return `<${tag}${hrefAttr} class="notification-menu-item${unread}${thumbClass}" data-notification-item data-notification-id="${escapeHtml(notification.id)}" data-notification-href="${escapeHtml(href)}" ${href ? "" : 'type="button"'}>${thumb}<span><strong>${escapeHtml(notification.summary || notification.body || "Notification")}</strong>${notification.comment_preview ? `<small>${escapeHtml(notification.comment_preview.replace(/\s+/g, " ").slice(0, 160))}</small>` : ""}</span></${tag}>`;
  }).join("");
  return rows || notificationMenuEmpty();
}

async function openNotificationMenu(root) {
  const bell = root.querySelector("[data-notification-bell]");
  const menu = root.querySelector("[data-notification-popdown]");
  const body = menu?.querySelector(".notification-popdown-body");
  if (!menu || !body) return;
  root.classList.add("is-open");
  bell?.setAttribute("aria-expanded", "true");
  menu.hidden = false;
  body.innerHTML = notificationMenuLoading();
  menu.querySelector(".notification-popdown-foot")?.remove();
  menu.insertAdjacentHTML("beforeend", notificationBrowserToggle());
  menu.querySelector("[data-browser-notifications-toggle]")?.addEventListener("click", handleBrowserNotificationsToggle);
  try {
    const data = await api("/api/notifications");
    body.innerHTML = renderNotificationMenuItems(data.notifications || []);
    body.querySelectorAll("[data-notification-item]").forEach((control) => {
      control.addEventListener("click", handleNotificationItemClick);
    });
  } catch (error) {
    body.innerHTML = `<div class="notification-menu-empty">${escapeHtml(error.message || "Could not load notifications.")}</div>`;
  }
}

function closeNotificationMenu(root) {
  const menu = root.querySelector("[data-notification-popdown]");
  const bell = root.querySelector("[data-notification-bell]");
  root.classList.remove("is-open");
  bell?.setAttribute("aria-expanded", "false");
  if (menu) menu.hidden = true;
}

function bindNotificationMenu() {
  document.querySelectorAll("[data-notification-menu-root]").forEach((root) => {
    const bell = root.querySelector("[data-notification-bell]");
    if (!bell || bell.dataset.bound === "true") return;
    bell.dataset.bound = "true";
    bell.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (root.classList.contains("is-open")) {
        closeNotificationMenu(root);
        return;
      }
      await openNotificationMenu(root);
    });
  });
  if (!notificationOutsideBound) {
    notificationOutsideBound = true;
    document.addEventListener("click", (event) => {
      document.querySelectorAll("[data-notification-menu-root].is-open").forEach((root) => {
        if (!root.contains(event.target)) closeNotificationMenu(root);
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      document.querySelectorAll("[data-notification-menu-root].is-open").forEach(closeNotificationMenu);
    });
  }
}

async function handleNotificationItemClick(event) {
  const control = event.currentTarget;
  const href = control.dataset.notificationHref || control.getAttribute("href") || "";
  event.preventDefault();
  event.stopPropagation();
  try {
    const notificationId = control.dataset.notificationId;
    if (notificationId) {
      await api(`/api/notifications/${encodePath(notificationId)}/read`, { method: "POST" });
    }
    control.classList.remove("is-unread");
    await loadNotificationStatus();
    if (href?.startsWith("/")) navigate(href);
    else if (href) window.location.href = href;
  } catch (error) {
    toast(error.message, "error");
  }
}

async function handleBrowserNotificationsToggle(event) {
  const action = event.currentTarget.dataset.browserNotificationsToggle;
  if (action === "enable") await enableBrowserNotifications();
  if (action === "disable") await disableBrowserNotifications();
}

function bindReplyButtons() {
  document.querySelectorAll("[data-reply-comment]").forEach((control) => {
    control.addEventListener("click", () => {
      const panelEl = control.closest(".panel");
      const form = panelEl?.querySelector(".comment-form");
      if (!form) return;
      field(form, "parent_comment_id").value = control.dataset.replyComment;
      const label = form.querySelector("[data-replying-to]");
      if (label) {
        label.hidden = false;
        label.querySelector("span").textContent = `Replying to @${control.dataset.replyAuthor || "member"}`;
      }
      form.querySelector("textarea[data-markdown-editor]")?._easyMDE?.codemirror?.focus();
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  document.querySelectorAll("[data-cancel-reply]").forEach((control) => {
    control.addEventListener("click", () => {
      const form = control.closest(".comment-form");
      if (!form) return;
      field(form, "parent_comment_id").value = "";
      control.closest("[data-replying-to]").hidden = true;
    });
  });
}

export { bindMarkdownImageLinks, bindNotificationActions, bindReactionButtons, bindReplyButtons, reactionButton };
