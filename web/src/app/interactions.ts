// @ts-nocheck
import { icon } from "../components/icons";
import { button } from "../components/ui";
import { encodePath, escapeHtml } from "../lib/utils";
import { api, loadNotificationStatus } from "./api";
import { field } from "./forms";
import { renderRoute } from "./routing";
import { toast } from "./toast";

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

function bindNotificationActions() {
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

export { bindNotificationActions, bindReactionButtons, bindReplyButtons, reactionButton };
