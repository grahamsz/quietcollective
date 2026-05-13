// @ts-nocheck
import { api, bindProtectedMedia, button, empty, escapeHtml, field, iconButton, markdownHint, panel, protectedImage, reactionButton, renderMarkdown, renderMarkdownInline, renderRoute, relativeTime, state, stripMarkdownImages, syncMarkdownEditors, toast } from "./core";

/** Picks the display author for comment cards used across work, gallery, and profile pages. */
function commentAuthor(comment) {
  return comment.handle || comment.display_name || "member";
}

/** Renders the quoted parent comment context shown above replies. */
function commentReplyContext(comment) {
  if (!comment.parent_comment_id) return "";
  const author = comment.parent_handle || comment.parent_display_name || "member";
  const preview = stripMarkdownImages(comment.parent_body || "").replace(/\s+/g, " ").trim();
  const clipped = preview.length > 160 ? `${preview.slice(0, 160)}...` : preview;
  return `<div class="reply-context"><span>Replying to @${escapeHtml(author)}</span>${clipped ? `<p>${renderMarkdownInline(clipped)}</p>` : ""}</div>`;
}

/** Renders one comment card used in comment panels and tag comment search results. */
function commentArticle(comment, options = {}) {
  const author = commentAuthor(comment);
  const replyButton = options.replyButton !== false;
  const metaExtras = typeof options.metaExtras === "function" ? options.metaExtras(comment) : "";
  const commentId = escapeHtml(comment.id);
  return `<article id="comment-${commentId}" class="comment-card${comment.parent_comment_id ? " is-reply" : ""}" data-comment-id="${commentId}"><div class="meta-row"><strong>@${escapeHtml(author)}</strong><span>${escapeHtml(relativeTime(comment.created_at))}</span>${metaExtras}</div>${commentReplyContext(comment)}<div class="description markdown-body">${renderMarkdown(comment.body)}</div><div class="comment-actions">${reactionButton("comment", comment.id, comment.reactions)}${replyButton ? button("Reply", "button ghost", `data-reply-comment="${escapeHtml(comment.id)}" data-reply-author="${escapeHtml(author)}"`) : ""}</div></article>`;
}

function linkedCommentIdFromHash() {
  if (!location.hash.startsWith("#comment-")) return "";
  const raw = location.hash.slice("#comment-".length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function linkedHighlightTargetFromHash() {
  const commentId = linkedCommentIdFromHash();
  if (commentId) return { elementId: `comment-${commentId}`, className: "is-comment-target" };
  if (!location.hash.startsWith("#heart-")) return null;
  const raw = location.hash.slice("#heart-".length);
  try {
    return { elementId: `heart-${decodeURIComponent(raw)}`, className: "is-heart-target" };
  } catch {
    return { elementId: `heart-${raw}`, className: "is-heart-target" };
  }
}

function highlightLinkedComment() {
  const target = linkedHighlightTargetFromHash();
  if (!target) return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const element = document.getElementById(target.elementId);
      if (!element) return;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      element.classList.remove(target.className);
      void element.offsetWidth;
      element.classList.add(target.className);
      element.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
      window.setTimeout(() => element.classList.remove(target.className), 2400);
    });
  });
}

/** Renders a generic comment list and form for gallery and profile pages. */
function commentsPanel(targetType, targetId, comments) {
  const title = targetType === "gallery" ? "Comments on Gallery" : "Comments";
  const label = targetType === "gallery" ? "Add Gallery Comment" : "Add comment";
  return panel(title, `<div class="grid">${(comments || []).map((comment) => commentArticle(comment)).join("") || empty("No comments yet.")}<form class="form comment-form" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><input type="hidden" name="parent_comment_id"><div class="replying-to" data-replying-to hidden><span></span>${button("Cancel", "button ghost", "type=button data-cancel-reply")}</div><div class="form-row"><label>${escapeHtml(label)}</label><textarea name="body" required data-markdown-editor data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"></textarea>${markdownHint()}</div>${button("Post comment", "button primary", "type=submit")}</form></div>`);
}

/** Renders work comments with version badges for the work detail page. */
function workCommentsPanel(workId, versions, comments, currentVersionId = "") {
  const targetType = currentVersionId ? "version" : "work";
  const targetId = currentVersionId || workId;
  return panel("Comments", `<div class="grid">${(comments || []).map((comment) => {
    const isPreviousVersion = comment.target_type === "version" && comment.version_id && comment.version_id !== currentVersionId;
    return commentArticle(comment, {
      metaExtras: () => isPreviousVersion ? button(`v${comment.version_number || ""}`, "version-pill", `type="button" data-version-overlay="${escapeHtml(comment.version_id)}" title="View previous version"`) : "",
    });
  }).join("") || empty("No comments yet.")}<form class="form comment-form" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><input type="hidden" name="parent_comment_id"><div class="replying-to" data-replying-to hidden><span></span>${button("Cancel", "button ghost", "type=button data-cancel-reply")}</div><div class="form-row"><label>Add comment</label><textarea name="body" required data-markdown-editor data-target-type="work" data-target-id="${escapeHtml(workId)}"></textarea>${markdownHint()}</div>${button("Post comment", "button primary", "type=submit")}</form></div>`);
}

function bindCommentForm(defaultType, defaultId) {
  document.querySelectorAll(".comment-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      syncMarkdownEditors(form);
      const bodyValue = field(form, "body").value.trim();
      if (!bodyValue) return toast("Comment is required", "error");
      const body = {
        target_type: form.dataset.targetType || defaultType,
        target_id: form.dataset.targetId || defaultId,
        body: bodyValue,
      };
      if (field(form, "parent_comment_id")?.value) body.parent_comment_id = field(form, "parent_comment_id").value;
      try {
        await api("/api/comments", { method: "POST", body });
        if (body.target_type === "thread") state.forumBoardsLoaded = false;
        toast(body.parent_comment_id ? "Reply posted" : "Comment posted");
        renderRoute();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

function bindVersionOverlay(versions = []) {
  document.querySelectorAll("[data-version-overlay]").forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      const version = versions.find((item) => item.id === buttonEl.dataset.versionOverlay);
      if (!version) return;
      const overlay = document.createElement("div");
      overlay.className = "modal-backdrop";
      overlay.innerHTML = `<section class="modal-panel" role="dialog" aria-modal="true"><div class="panel-header"><h2>Version ${escapeHtml(version.version_number)}</h2>${iconButton("x", "Close", "icon-button", "data-close-modal type=button")}</div><div class="panel-body">${version.preview_url ? `<div class="media-frame compact">${protectedImage(version.preview_url)}</div>` : empty("No preview available.")}<div class="toolbar" style="margin-top:14px">${version.original_url ? `<a class="button" href="${escapeHtml(version.original_url)}">Open original</a>` : ""}</div></div></section>`;
      document.body.append(overlay);
      bindProtectedMedia(overlay);
      overlay.querySelector("[data-close-modal]")?.addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) overlay.remove();
      });
    });
  });
}


export { bindCommentForm, bindVersionOverlay, commentArticle, commentsPanel, highlightLinkedComment, workCommentsPanel };
