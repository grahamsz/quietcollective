// @ts-nocheck
import { api, badge, bindJsonForm, button, buttonIcon, empty, encodePath, ensureAuthed, escapeHtml, field, formatDate, galleryAccessChips, imageUploadVariants, link, loadGalleries, loadRoleSuggestions, navigate, pageShell, panel, protectedImage, reactionButton, relativeTime, renderMarkdown, renderRoute, setApp, state, toast } from "../app/core";
import { bindCommentForm, bindVersionOverlay, workCommentsPanel } from "../app/comments";
import { addCollaborators, bindCollaboratorRows, collaboratorCreditRows, collaboratorLabel, collaboratorPayloads } from "../app/collaborators";

function currentWorkGallery(work, galleryId = "") {
  const galleries = work.galleries || [];
  if (galleryId) {
    const requested = galleries.find((gallery) => gallery.id === galleryId);
    if (requested) return requested;
  }
  return galleries[0] || { id: work.gallery_id, title: work.gallery_title || "Gallery" };
}

function workCrosspostNotice(work, currentGallery) {
  const galleries = work.galleries || [];
  const origin = galleries.find((gallery) => gallery.id === work.gallery_id);
  const current = currentGallery || currentWorkGallery(work);
  const crossposted = galleries.length > 1 || (current?.id && work.gallery_id && current.id !== work.gallery_id);
  if (!crossposted) return "";

  const currentLabel = current?.id ? `<a href="/galleries/${escapeHtml(current.id)}" data-link>${escapeHtml(current.title || "this gallery")}</a>` : "this gallery";
  if (origin && current?.id && origin.id !== current.id) {
    return `<div class="notice compact work-crosspost-notice">This image was crossposted from <a href="/galleries/${escapeHtml(origin.id)}" data-link>${escapeHtml(origin.title)}</a> to ${currentLabel}.</div>`;
  }
  if (!origin && current?.id && work.gallery_id && current.id !== work.gallery_id) {
    return `<div class="notice compact work-crosspost-notice">This image was crossposted from another gallery to ${currentLabel}.</div>`;
  }

  const otherGalleries = galleries.filter((gallery) => gallery.id !== origin?.id);
  if (otherGalleries.length) {
    const links = otherGalleries.map((gallery) => `<a href="/galleries/${escapeHtml(gallery.id)}" data-link>${escapeHtml(gallery.title)}</a>`).join(", ");
    return `<div class="notice compact work-crosspost-notice">This image is also crossposted in ${links}.</div>`;
  }
  return "";
}

async function renderWork(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/works/${encodePath(id)}`);
  const work = data.work;
  const version = work.current_version;
  const galleryId = new URLSearchParams(location.search).get("gallery") || "";
  const gallery = currentWorkGallery(work, galleryId);
  const comments = await api(`/api/works/${encodePath(id)}/comments`).catch(() => ({ comments: [] }));
  const media = version?.preview_url ? `<div class="media-frame">${protectedImage(version.preview_url, work.title)}</div>` : empty("No image version is available.");
  const crosspostNotice = workCrosspostNotice(work, gallery);
  const removeFromGallery = (work.galleries || []).length > 1 && gallery?.id;
  const deleteAction = removeFromGallery
    ? button("Remove from gallery", "button warn", `data-delete-work="${escapeHtml(id)}" data-delete-work-gallery="${escapeHtml(gallery.id)}" data-after-delete="/galleries/${escapeHtml(gallery.id)}"`)
    : button("Delete", "button warn", `data-delete-work="${escapeHtml(id)}" data-after-delete="/galleries/${escapeHtml(gallery.id)}"`);
  setApp(pageShell(`<section class="view work-view"><div class="view-header"><div><p class="eyebrow"><a href="/galleries/${escapeHtml(gallery.id)}" data-link>${escapeHtml(gallery.title)}</a></p><h1>${escapeHtml(work.title)}</h1><div class="lede markdown-body">${renderMarkdown(work.description || "")}</div><div class="gallery-access-inline">${galleryAccessChips(gallery, "is-inline")}</div><div class="badge-row">${badge("image")}</div></div><div class="toolbar">${reactionButton("work", id, work.reactions)}${work.feedback_requested && !work.feedback_dismissed ? button("Dismiss feedback request", "button ghost", `data-dismiss-feedback="${escapeHtml(id)}"`) : ""}${link(`/works/${id}/versions`, "Versions", "button")}${work.capabilities.edit ? link(`/works/${id}/edit`, "Edit", "button primary") + deleteAction : ""}</div></div>${media}${crosspostNotice}<div class="grid two">${panel("Collaborators", (data.collaborators || []).map((collab) => `<article class="comment-card"><h3 class="card-title">${collaboratorLabel(collab)}</h3><p class="description">${escapeHtml(collab.role_label || "collaborator")}</p></article>`).join("") || empty("No collaborators credited yet."))}${workCommentsPanel(id, data.versions || [], comments.comments, version?.id || "")}</div></section>`));
  bindCommentForm("work", id);
  bindVersionOverlay(data.versions || []);
  bindFeedbackDismiss();
  bindDeleteWork();
}

function existingCollaborators(collaborators, workId) {
  if (!collaborators?.length) return empty("No collaborators credited yet.");
  return `<div class="collaborator-list">${collaborators.map((collab) => `<div class="collaborator-list-row"><span>${collaboratorLabel(collab)}</span><strong>${escapeHtml(collab.role_label || "collaborator")}</strong>${button("Remove", "button ghost", `type=button data-remove-collaborator="${escapeHtml(collab.id)}" data-work-id="${escapeHtml(workId)}"`)}</div>`).join("")}</div>`;
}

async function renderWorkEdit(id) {
  if (!(await ensureAuthed())) return;
  const [data] = await Promise.all([api(`/api/works/${encodePath(id)}`), loadRoleSuggestions(), loadGalleries()]);
  const work = data.work;
  const linkedIds = new Set((work.galleries || []).map((gallery) => gallery.id));
  const crosspostOptions = state.galleries.filter((gallery) => gallery.capabilities?.upload_work && !linkedIds.has(gallery.id));
  const feedbackButton = buttonIcon("flag", work.feedback_requested ? "Clear feedback request" : "Request feedback", `button feedback-toggle ${work.feedback_requested ? "is-active" : ""}`, `data-toggle-feedback="${escapeHtml(id)}" data-feedback-requested="${work.feedback_requested ? "true" : "false"}"`);
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Edit image</p><h1>${escapeHtml(work.title)}</h1></div><div class="toolbar">${feedbackButton}${button("Delete", "button warn", `data-delete-work="${escapeHtml(id)}" data-after-delete="${escapeHtml(work.galleries?.[0]?.id ? `/galleries/${work.galleries[0].id}` : "/galleries")}"`)}</div></div><div class="grid two">${panel("Details", `<form class="form" id="work-edit-form"><div class="form-row"><label>Title</label><input name="title" value="${escapeHtml(work.title)}" required></div><div class="form-row"><label>Description</label><textarea name="description" data-markdown-editor data-target-type="work" data-target-id="${escapeHtml(id)}">${escapeHtml(work.description || "")}</textarea>${markdownHint()}</div>${button("Save work", "button primary", "type=submit")}</form><hr><form class="form" id="crosspost-form"><div class="form-row"><label>Galleries</label><div class="collaborator-list">${(work.galleries || []).map((gallery) => `<div class="collaborator-list-row"><span><a href="/galleries/${escapeHtml(gallery.id)}" data-link>${escapeHtml(gallery.title)}</a></span><strong>${escapeHtml(relativeTime(gallery.updated_at || gallery.created_at))}</strong>${(work.galleries || []).length > 1 ? button("Remove", "button ghost", `type=button data-remove-work-gallery="${escapeHtml(gallery.id)}"`) : ""}</div>`).join("")}</div></div><div class="form-row"><label>Crosspost to gallery</label><select name="gallery_id"><option value="">Choose a gallery</option>${crosspostOptions.map((gallery) => `<option value="${escapeHtml(gallery.id)}">${escapeHtml(gallery.title)}</option>`).join("")}</select></div>${button("Add to gallery", "button", "type=submit")}</form><hr><div class="form-row"><label>Collaborators</label>${existingCollaborators(data.collaborators || [], id)}</div><form class="form" id="collab-form"><div class="form-row"><label>Add collaborator</label>${collaboratorCreditRows({ listId: "edit-work-role-options" })}</div>${button("Add collaborator", "button", "type=submit")}</form>`)}${panel("New Version", `<form class="form" id="version-form"><label class="drop-zone" for="version-file" data-drop-zone><input id="version-file" name="file" type="file" accept="image/*" capture="environment" required><span>Drop a replacement image here, choose a file, or use the camera on mobile.</span><strong data-file-name>No image selected</strong></label>${button("Create version", "button primary", "type=submit")}</form>`)}</div></section>`));
  bindJsonForm("#work-edit-form", async (body) => {
    await api(`/api/works/${encodePath(id)}`, { method: "PATCH", body });
    toast("Work saved");
    renderRoute();
  });
  bindJsonForm("#crosspost-form", async (body) => {
    if (!body.gallery_id) return toast("Choose a gallery", "error");
    await api(`/api/works/${encodePath(id)}/galleries`, { method: "POST", body });
    await loadGalleries();
    toast("Work added to gallery");
    renderRoute();
  });
  document.querySelectorAll("[data-remove-work-gallery]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/works/${encodePath(id)}/galleries/${encodePath(control.dataset.removeWorkGallery)}`, { method: "DELETE" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
  bindJsonForm("#collab-form", async (body, form) => {
    await addCollaborators(id, collaboratorPayloads(form));
    await loadRoleSuggestions();
    toast("Collaborator added");
    renderRoute();
  });
  bindCollaboratorRows(document);
  bindRemoveCollaborator();
  bindVersionForm(id);
  bindFeedbackToggle(id);
  bindDeleteWork();
}

function bindDeleteWork() {
  document.querySelectorAll("[data-delete-work]").forEach((control) => {
    control.addEventListener("click", async () => {
      const removeGalleryId = control.dataset.deleteWorkGallery;
      const message = removeGalleryId
        ? "Remove this work from this gallery? It will remain in its other galleries."
        : "Delete this work? It will be hidden from galleries and feeds.";
      if (!confirm(message)) return;
      control.setAttribute("disabled", "disabled");
      try {
        if (removeGalleryId) {
          await api(`/api/works/${encodePath(control.dataset.deleteWork)}/galleries/${encodePath(removeGalleryId)}`, { method: "DELETE" });
          toast("Work removed from gallery");
        } else {
          await api(`/api/works/${encodePath(control.dataset.deleteWork)}`, { method: "DELETE" });
          toast("Work deleted");
        }
        navigate(control.dataset.afterDelete || "/galleries");
      } catch (error) {
        toast(error.message, "error");
        control.removeAttribute("disabled");
      }
    });
  });
}

function bindRemoveCollaborator() {
  document.querySelectorAll("[data-remove-collaborator]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/works/${encodePath(control.dataset.workId)}/collaborators/${encodePath(control.dataset.removeCollaborator)}`, { method: "DELETE" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
}

function bindVersionForm(id) {
  const form = document.querySelector("#version-form");
  const input = form?.querySelector("[name=file]");
  const label = form?.querySelector("[data-file-name]");
  const submit = form?.querySelector("[type=submit]");
  input?.addEventListener("change", () => {
    label.textContent = input.files?.[0]?.name || "No image selected";
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = input?.files?.[0];
    if (!file) return toast("Choose an image", "error");
    const previousLabel = submit?.textContent || "";
    submit?.setAttribute("disabled", "disabled");
    try {
      if (submit) submit.textContent = "Preparing...";
      const body = new FormData(form);
      const { preview, thumbnail } = await imageUploadVariants(file);
      body.set("preview", preview);
      body.set("thumbnail", thumbnail);
      if (submit) submit.textContent = "Creating...";
      await api(`/api/works/${encodePath(id)}/versions`, { method: "POST", body });
      navigate(`/works/${id}/versions`);
    } catch (error) {
      toast(error.message, "error");
      submit?.removeAttribute("disabled");
      if (submit) submit.textContent = previousLabel;
    }
  });
}

function bindFeedbackToggle(id) {
  document.querySelector("[data-toggle-feedback]")?.addEventListener("click", async (event) => {
    const requested = event.currentTarget.dataset.feedbackRequested === "true";
    await api(`/api/works/${encodePath(id)}/feedback-requested`, { method: "POST", body: { feedback_requested: !requested } }).catch((error) => toast(error.message, "error"));
    renderRoute();
  });
}

function bindFeedbackDismiss() {
  document.querySelector("[data-dismiss-feedback]")?.addEventListener("click", async (event) => {
    await api(`/api/works/${encodePath(event.currentTarget.dataset.dismissFeedback)}/feedback-requested/dismiss`, { method: "POST" }).catch((error) => toast(error.message, "error"));
    renderRoute();
  });
}

async function renderWorkVersions(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/works/${encodePath(id)}`);
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Versions</p><h1>${escapeHtml(data.work.title)}</h1></div><div class="toolbar">${link(`/works/${id}`, "Back to work", "button")}</div></div><div class="grid">${(data.versions || []).map((version) => `<article class="version-card"><h3 class="card-title">Version ${escapeHtml(version.version_number)}</h3><div class="meta-row">${escapeHtml(formatDate(version.created_at))}</div><div class="toolbar">${version.original_url ? link(version.original_url, "Original", "button") : ""}${version.preview_url ? link(version.preview_url, "Preview", "button") : ""}</div></article>`).join("") || empty("No versions yet.")}</div></section>`));
}


export { renderWork, renderWorkEdit, renderWorkVersions };
