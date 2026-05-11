// @ts-nocheck
import {
  api,
  bindJsonForm,
  encodePath,
  ensureAuthed,
  escapeHtml,
  field,
  iconButton,
  imageUploadVariants,
  loadGalleries,
  loadRoleSuggestions,
  navigate,
  pageShell,
  renderRoute,
  setApp,
  state,
  toast,
} from "../app/core";
import { bindCommentForm, bindVersionOverlay } from "../app/comments";
import { addCollaborators, bindCollaboratorRows, collaboratorPayloads } from "../app/collaborators";
import { currentWorkGallery, workDetailView, workEditView, workVersionsView } from "../views/islands";

async function renderWork(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/works/${encodePath(id)}`);
  const work = data.work;
  const galleryId = new URLSearchParams(location.search).get("gallery") || "";
  const gallery = currentWorkGallery(work, galleryId);
  const comments = await api(`/api/works/${encodePath(id)}/comments`).catch(() => ({ comments: [] }));
  setApp(pageShell(workDetailView({
    id,
    work,
    gallery,
    comments: comments.comments,
    versions: data.versions || [],
    collaborators: data.collaborators || [],
  })));
  bindCommentForm("work", id);
  bindVersionOverlay(data.versions || []);
  bindFeedbackRequestModal();
  bindDeleteWork();
}

async function renderWorkEdit(id) {
  if (!(await ensureAuthed())) return;
  const [data] = await Promise.all([api(`/api/works/${encodePath(id)}`), loadRoleSuggestions(), loadGalleries()]);
  const work = data.work;
  const linkedIds = new Set((work.galleries || []).map((gallery) => gallery.id));
  const crosspostOptions = state.galleries.filter((gallery) => gallery.capabilities?.upload_work && !linkedIds.has(gallery.id));
  setApp(pageShell(workEditView({ id, work, collaborators: data.collaborators || [], crosspostOptions })));
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

function bindFeedbackRequestModal() {
  document.querySelectorAll("[data-feedback-request-modal]").forEach((control) => {
    control.addEventListener("click", () => {
      const workId = control.dataset.feedbackRequestModal || "";
      const prompt = control.dataset.feedbackPrompt || "";
      const canClear = control.dataset.feedbackCanClear === "true";
      const overlay = document.createElement("div");
      overlay.className = "modal-backdrop";
      overlay.innerHTML = `<section class="modal-panel feedback-request-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-request-title"><div class="panel-header"><h2 id="feedback-request-title">Feedback requested</h2>${iconButton("x", "Close", "icon-button", "type=button data-close-modal")}</div><div class="panel-body"><p class="description">${escapeHtml(prompt || "This work is asking for critique.")}</p><div class="toolbar">${canClear ? `<button class="button feedback-toggle is-active" type="button" data-clear-feedback-request="${escapeHtml(workId)}">Clear feedback request</button>` : ""}</div></div></section>`;
      document.body.append(overlay);
      overlay.querySelector("[data-close-modal]")?.addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) overlay.remove();
      });
      overlay.querySelector("[data-clear-feedback-request]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.setAttribute("disabled", "disabled");
        try {
          await api(`/api/works/${encodePath(button.dataset.clearFeedbackRequest)}/feedback-requested`, { method: "POST", body: { feedback_requested: false } });
          toast("Feedback request cleared");
          overlay.remove();
          renderRoute();
        } catch (error) {
          toast(error.message, "error");
          button.removeAttribute("disabled");
        }
      });
    });
  });
}

async function renderWorkVersions(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/works/${encodePath(id)}`);
  setApp(pageShell(workVersionsView({ id, work: data.work, versions: data.versions || [] })));
}

export { renderWork, renderWorkEdit, renderWorkVersions };
