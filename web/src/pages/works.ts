// @ts-nocheck
import {
  api,
  bindJsonForm,
  canCrosspostToGallery,
  encodePath,
  ensureAuthed,
  escapeHtml,
  formDataObject,
  iconButton,
  imageUploadVariants,
  loadGalleries,
  loadRoleSuggestions,
  mountComponentIslands,
  navigate,
  pageShell,
  renderRoute,
  setApp,
  state,
  toast,
} from "../app/core";
import { bindCommentForm, bindVersionOverlay } from "../app/comments";
import { addCollaborators, bindCollaboratorRows, collaboratorPayloads } from "../app/collaborators";
import { currentWorkGallery, workCrosspostGalleryModalView, workDetailView, workVersionsView } from "../views/islands";

async function renderWork(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/works/${encodePath(id)}`);
  const work = data.work;
  if (work.capabilities?.edit || work.can_crosspost || work.can_create_version) await Promise.all([loadRoleSuggestions(), loadGalleries()]);
  const galleryId = new URLSearchParams(location.search).get("gallery") || "";
  const gallery = currentWorkGallery(work, galleryId);
  const linkedIds = new Set((work.galleries || []).map((linkedGallery) => linkedGallery.id));
  const crosspostOptions = work.can_crosspost
    ? state.galleries.filter((linkedGallery) => canCrosspostToGallery(linkedGallery) && !linkedIds.has(linkedGallery.id))
    : [];
  const comments = await api(`/api/works/${encodePath(id)}/comments`).catch(() => ({ comments: [] }));
  setApp(pageShell(workDetailView({
    id,
    work,
    gallery,
    comments: comments.comments,
    versions: data.versions || [],
    collaborators: data.collaborators || [],
    crosspostOptions,
  })));
  bindCommentForm("work", id);
  bindVersionOverlay(data.versions || []);
  bindWorkInlineEdits(id);
  bindWorkGalleryForms(id, work, crosspostOptions);
  bindCollaboratorManagement(id);
  bindVersionPanel();
  bindVersionForm(id);
  bindFeedbackRequestModal();
  bindFeedbackToggle(id);
  bindDeleteWork();
}

async function renderWorkEdit(id) {
  navigate(`/works/${id}${location.search || ""}`);
}

function bindWorkInlineEdits(id) {
  document.querySelectorAll("[data-edit-work-field]").forEach((control) => {
    control.addEventListener("click", () => {
      const fieldName = control.dataset.editWorkField;
      if (!fieldName) return;
      document.querySelector(`[data-inline-edit-view="${fieldName}"]`)?.setAttribute("hidden", "hidden");
      const form = document.querySelector(`[data-inline-edit-form="${fieldName}"]`);
      form?.removeAttribute("hidden");
      form?.querySelector("[data-edit-input]")?.focus();
    });
  });
  document.querySelectorAll("[data-cancel-inline-edit]").forEach((control) => {
    control.addEventListener("click", () => {
      const fieldName = control.dataset.cancelInlineEdit;
      document.querySelector(`[data-inline-edit-form="${fieldName}"]`)?.setAttribute("hidden", "hidden");
      document.querySelector(`[data-inline-edit-view="${fieldName}"]`)?.removeAttribute("hidden");
    });
  });
  bindJsonForm("#work-edit-form", async (body) => {
    await api(`/api/works/${encodePath(id)}`, { method: "PATCH", body });
    toast("Work saved");
    renderRoute();
  });
  bindJsonForm("#work-title-form", async (body) => {
    await api(`/api/works/${encodePath(id)}`, { method: "PATCH", body });
    await loadGalleries();
    toast("Title saved");
    renderRoute();
  });
  bindJsonForm("#work-description-form", async (body) => {
    await api(`/api/works/${encodePath(id)}`, { method: "PATCH", body });
    await loadGalleries();
    toast("Description saved");
    renderRoute();
  });
}

function bindWorkGalleryForms(id, work, crosspostOptions) {
  document.querySelector("[data-open-work-crosspost]")?.addEventListener("click", () => {
    openWorkCrosspostModal(id, work, crosspostOptions || []);
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
      const galleryId = control.dataset.removeWorkGallery;
      if (!galleryId) return;
      const galleryTitle = control.dataset.removeWorkGalleryTitle || "this gallery";
      if (!confirm(`Remove this work from "${galleryTitle}"? It will remain in its other galleries.`)) return;
      control.setAttribute("disabled", "disabled");
      try {
        await api(`/api/works/${encodePath(id)}/galleries/${encodePath(galleryId)}`, { method: "DELETE" });
        toast("Work removed from gallery");
        renderRoute();
      } catch (error) {
        toast(error.message, "error");
        control.removeAttribute("disabled");
      }
    });
  });
}

function openWorkCrosspostModal(id, work, crosspostOptions) {
  if (!crosspostOptions?.length) return toast("No eligible galleries available", "error");
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = workCrosspostGalleryModalView(work, crosspostOptions);
  const close = () => modal.remove();
  document.body.append(modal);
  mountComponentIslands(modal);
  bindWorkCrosspostModal(modal, id, close);
}

function bindWorkCrosspostModal(modal, id, close) {
  modal.querySelectorAll("[data-close-modal]").forEach((control) => control.addEventListener("click", close));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  const search = modal.querySelector("[data-gallery-picker-search]");
  search?.addEventListener("input", () => {
    const value = search.value.trim().toLowerCase();
    modal.querySelectorAll("[data-gallery-picker-option]").forEach((option) => {
      option.classList.toggle("is-hidden", !!value && !(option.dataset.search || "").includes(value));
    });
  });
  modal.querySelector("[data-work-crosspost-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = modal.querySelector("[name=gallery_id]:checked");
    if (!selected) return toast("Choose a gallery", "error");
    const submit = event.currentTarget.querySelector("[type=submit]");
    submit?.setAttribute("disabled", "disabled");
    try {
      await api(`/api/works/${encodePath(id)}/galleries`, { method: "POST", body: { gallery_id: selected.value } });
      await loadGalleries();
      toast("Work crossposted");
      close();
      renderRoute();
    } catch (error) {
      toast(error.message, "error");
      submit?.removeAttribute("disabled");
    }
  });
}

function bindCollaboratorManagement(id) {
  const addForm = document.querySelector("#collab-form");
  const addButton = document.querySelector("[data-show-collaborator-add]");
  addButton?.addEventListener("click", () => {
    addButton.setAttribute("hidden", "hidden");
    addForm?.removeAttribute("hidden");
    addForm?.querySelector("input")?.focus();
  });
  document.querySelector("[data-cancel-collaborator-add]")?.addEventListener("click", () => {
    addForm?.setAttribute("hidden", "hidden");
    addForm?.reset?.();
    addButton?.removeAttribute("hidden");
  });
  bindJsonForm("#collab-form", async (body, form) => {
    await addCollaborators(id, collaboratorPayloads(form));
    await loadRoleSuggestions();
    toast("Collaborator added");
    renderRoute();
  });
  bindCollaboratorRows(document);
  document.querySelectorAll("[data-edit-collaborator]").forEach((control) => {
    control.addEventListener("click", () => {
      const collaboratorId = control.dataset.editCollaborator;
      document.querySelector(`[data-collaborator-view-row="${collaboratorId}"]`)?.setAttribute("hidden", "hidden");
      const editRow = document.querySelector(`[data-collaborator-edit-row="${collaboratorId}"]`);
      editRow?.removeAttribute("hidden");
      editRow?.querySelector("input")?.focus();
    });
  });
  document.querySelectorAll("[data-cancel-collaborator-edit]").forEach((control) => {
    control.addEventListener("click", () => {
      const collaboratorId = control.dataset.cancelCollaboratorEdit;
      document.querySelector(`[data-collaborator-edit-row="${collaboratorId}"]`)?.setAttribute("hidden", "hidden");
      document.querySelector(`[data-collaborator-view-row="${collaboratorId}"]`)?.removeAttribute("hidden");
    });
  });
  document.querySelectorAll("[data-collaborator-edit-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const collaboratorId = form.dataset.collaboratorEditForm;
      const submit = form.querySelector("[type=submit]");
      submit?.setAttribute("disabled", "disabled");
      try {
        await api(`/api/works/${encodePath(id)}/collaborators/${encodePath(collaboratorId)}`, { method: "PATCH", body: formDataObject(form) });
        await loadRoleSuggestions();
        toast("Contributor saved");
        renderRoute();
      } catch (error) {
        toast(error.message, "error");
        submit?.removeAttribute("disabled");
      }
    });
  });
  bindRemoveCollaborator();
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
      const collaboratorId = control.dataset.removeCollaborator;
      const workId = control.dataset.workId;
      if (!collaboratorId || !workId) return;
      const label = control.dataset.removeCollaboratorLabel || "this contributor";
      if (!confirm(`Remove ${label} from this work?`)) return;
      control.setAttribute("disabled", "disabled");
      try {
        await api(`/api/works/${encodePath(workId)}/collaborators/${encodePath(collaboratorId)}`, { method: "DELETE" });
        toast("Contributor removed");
        renderRoute();
      } catch (error) {
        toast(error.message, "error");
        control.removeAttribute("disabled");
      }
    });
  });
}

function bindVersionPanel() {
  const panel = document.querySelector("[data-version-panel]");
  document.querySelector("[data-show-version-form]")?.addEventListener("click", () => {
    panel?.removeAttribute("hidden");
    panel?.scrollIntoView({ behavior: "smooth", block: "center" });
    panel?.querySelector("input[type=file]")?.focus();
  });
  document.querySelector("[data-hide-version-form]")?.addEventListener("click", () => {
    panel?.setAttribute("hidden", "hidden");
  });
  bindFileDropZones(document);
}

function bindFileDropZones(scope = document) {
  scope.querySelectorAll("[data-drop-zone]").forEach((zone) => {
    const input = zone.querySelector("input[type=file]");
    if (!input) return;
    for (const eventName of ["dragenter", "dragover"]) {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.add("is-dragging");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.remove("is-dragging");
      });
    }
    zone.addEventListener("drop", (event) => {
      const fileList = event.dataTransfer?.files;
      if (!fileList?.length) return;
      input.files = fileList;
      input.dispatchEvent(new Event("change", { bubbles: true }));
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
      toast("Version created");
      renderRoute();
    } catch (error) {
      toast(error.message, "error");
      submit?.removeAttribute("disabled");
      if (submit) submit.textContent = previousLabel;
    }
  });
}

function bindFeedbackToggle(id) {
  document.querySelector("[data-toggle-feedback]")?.addEventListener("click", async (event) => {
    const control = event.currentTarget;
    const requested = control.dataset.feedbackRequested === "true";
    if (requested && !confirm("Clear this feedback request for everyone? People who have not responded yet will stop seeing it.")) return;
    control.setAttribute("disabled", "disabled");
    try {
      await api(`/api/works/${encodePath(id)}/feedback-requested`, { method: "POST", body: { feedback_requested: !requested } });
      toast(requested ? "Feedback request cleared for everyone" : "Feedback requested");
      renderRoute();
    } catch (error) {
      toast(error.message, "error");
      control.removeAttribute("disabled");
    }
  });
}

function bindFeedbackRequestModal() {
  document.querySelectorAll("[data-feedback-request-modal]").forEach((control) => {
    control.addEventListener("click", () => {
      const workId = control.dataset.feedbackRequestModal || "";
      const prompt = control.dataset.feedbackPrompt || "";
      const overlay = document.createElement("div");
      overlay.className = "modal-backdrop";
      overlay.innerHTML = `<section class="modal-panel feedback-request-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-request-title"><div class="panel-header"><h2 id="feedback-request-title">Feedback requested</h2>${iconButton("x", "Close", "icon-button", "type=button data-close-modal")}</div><div class="panel-body"><p class="description">${escapeHtml(prompt || "This work is asking for critique.")}</p><div class="toolbar"><button class="button feedback-toggle is-active" type="button" data-dismiss-feedback-request="${escapeHtml(workId)}">Clear for me</button></div></div></section>`;
      document.body.append(overlay);
      overlay.querySelector("[data-close-modal]")?.addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) overlay.remove();
      });
      overlay.querySelector("[data-dismiss-feedback-request]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.setAttribute("disabled", "disabled");
        try {
          await api(`/api/works/${encodePath(button.dataset.dismissFeedbackRequest)}/feedback-requested/dismiss`, { method: "POST" });
          toast("Feedback request cleared for you");
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
