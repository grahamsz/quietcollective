// @ts-nocheck
import {
  api,
  bindJsonForm,
  bindProtectedMedia,
  canCrosspostToGallery,
  clientKey,
  empty,
  encodePath,
  enhanceMarkdownEditors,
  ensureAuthed,
  field,
  formDataObject,
  imageUploadVariants,
  loadGalleries,
  loadRoleSuggestions,
  mountComponentIslands,
  navigate,
  newestFirst,
  ownershipHelp,
  pageShell,
  renderRoute,
  setApp,
  syncMarkdownEditors,
  toast,
  visibilityHelp,
} from "../app/core";
import { bindCommentForm, highlightLinkedComment } from "../app/comments";
import { bindCollaboratorRows, collaboratorPayloads } from "../app/collaborators";
import { bindMentionAutocomplete } from "../app/mentions";
import {
  addToGalleryModalView,
  crosspostModalShellView,
  crosspostPickerView,
  galleryDetailView,
  gallerySettingsView,
  modalErrorView,
  newGalleryView,
  workUploadModalView,
} from "../views/islands";

async function renderNewGallery() {
  if (!(await ensureAuthed())) return;
  setApp(pageShell(newGalleryView()));
  bindJsonForm("#gallery-form", async (body) => {
    const data = await api("/api/galleries", { method: "POST", body });
    await loadGalleries();
    navigate(`/galleries/${data.gallery.id}`);
  });
  bindChoiceHelp(document.querySelector("#gallery-form"));
}

function bindChoiceHelp(scope) {
  const ownership = scope?.querySelector?.("[name=ownership_type]");
  const ownershipText = scope?.querySelector?.("[data-ownership-help]");
  const visibility = scope?.querySelector?.("[name=visibility]");
  const visibilityText = scope?.querySelector?.("[data-visibility-help]");
  const syncChoices = () => {
    const ownershipValue = ownership?.value || "";
    if (ownershipText && ownership) ownershipText.textContent = ownershipHelp(ownershipValue);
    if (ownershipValue === "whole_server" && visibility) {
      visibility.value = "server_public";
    }
    if (visibilityText && visibility) visibilityText.textContent = visibilityHelp(visibility.value, ownershipValue);
  };
  ownership?.addEventListener("change", syncChoices);
  visibility?.addEventListener("change", () => {
    if (visibilityText) visibilityText.textContent = visibilityHelp(visibility.value, ownership?.value || "");
  });
  syncChoices();
}

async function renderGallery(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/galleries/${encodePath(id)}`);
  const gallery = data.gallery;
  const works = [...(data.works || [])].sort(newestFirst);
  const comments = await api(`/api/comments?target_type=gallery&target_id=${encodePath(id)}`).catch(() => ({ comments: [] }));
  setApp(pageShell(galleryDetailView({ id, gallery, works, comments: comments.comments, members: data.members || [] })));
  bindCreateWork(id, gallery);
  bindGalleryDropSurface();
  bindCommentForm("gallery", id);
  highlightLinkedComment();
}

function bindCreateWork(galleryId, gallery) {
  for (const selector of ["#work-file-upload", "#work-file-camera"]) {
    const input = document.querySelector(selector);
    input?.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) openWorkUploadModal(galleryId, file);
    });
  }
  document.querySelector("[data-show-upload]")?.addEventListener("click", () => openGalleryAddMenu(galleryId, gallery));
}

function openGalleryAddMenu(galleryId, gallery) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  const canCrosspost = canCrosspostToGallery(gallery);
  modal.innerHTML = addToGalleryModalView(gallery, canCrosspost);
  const close = () => modal.remove();
  document.body.append(modal);
  mountComponentIslands(modal);
  modal.querySelectorAll("[data-close-modal]").forEach((control) => control.addEventListener("click", close));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  modal.querySelector("[data-add-action=upload]")?.addEventListener("click", () => {
    close();
    requestAnimationFrame(() => document.querySelector("#work-file-upload")?.click());
  });
  modal.querySelector("[data-add-action=camera]")?.addEventListener("click", () => {
    close();
    requestAnimationFrame(() => document.querySelector("#work-file-camera")?.click());
  });
  modal.querySelector("[data-add-action=crosspost]")?.addEventListener("click", () => {
    close();
    openCrosspostModal(galleryId, gallery);
  });
}

async function openCrosspostModal(galleryId, gallery) {
  if (!canCrosspostToGallery(gallery)) return toast("You can only crosspost to Everyone galleries or galleries you own.", "error");
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = crosspostModalShellView(gallery);
  const close = () => modal.remove();
  document.body.append(modal);
  mountComponentIslands(modal);
  modal.querySelectorAll("[data-close-modal]").forEach((control) => control.addEventListener("click", close));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });

  try {
    const data = await api(`/api/galleries/${encodePath(galleryId)}/crosspost-candidates`);
    const works = data.works || [];
    const body = modal.querySelector(".panel-body");
    body.innerHTML = works.length ? crosspostPickerView(works, galleryId) : empty("No eligible works to crosspost. Own works and works that credit you as a collaborator will appear here.");
    mountComponentIslands(body);
    bindProtectedMedia(modal);
    bindCrosspostPicker(modal, works, galleryId, close);
  } catch (error) {
    modal.querySelector(".panel-body").innerHTML = modalErrorView(error.message);
    mountComponentIslands(modal);
  }
}

function bindCrosspostPicker(modal, works, galleryId, close) {
  modal.querySelectorAll("[data-close-modal]").forEach((control) => control.addEventListener("click", close));
  const search = modal.querySelector("[data-crosspost-search]");
  const warning = modal.querySelector("[data-crosspost-warning]");
  const confirmRow = modal.querySelector("[data-crosspost-confirm-row]");
  const confirm = modal.querySelector("[name=visibility_confirm]");
  const updateWarning = () => {
    const selected = modal.querySelector("[name=work_id]:checked");
    const work = works.find((item) => item.id === selected?.value);
    const increasesVisibility = selected?.dataset.increasesVisibility === "true";
    warning.classList.toggle("is-hidden", !increasesVisibility);
    confirmRow.classList.toggle("is-hidden", !increasesVisibility);
    if (!increasesVisibility && confirm) confirm.checked = false;
    if (work?.crosspost?.warning) warning.textContent = work.crosspost.warning;
  };
  search?.addEventListener("input", () => {
    const value = search.value.trim().toLowerCase();
    modal.querySelectorAll("[data-crosspost-option]").forEach((option) => {
      option.classList.toggle("is-hidden", value && !option.dataset.search.includes(value));
    });
  });
  modal.querySelectorAll("[name=work_id]").forEach((control) => control.addEventListener("change", updateWarning));
  modal.querySelector("[data-crosspost-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = modal.querySelector("[name=work_id]:checked");
    if (!selected) return toast("Choose a work to crosspost", "error");
    if (selected.dataset.increasesVisibility === "true" && !confirm?.checked) return toast("Confirm the visibility warning first", "error");
    const submit = event.currentTarget.querySelector("[type=submit]");
    submit?.setAttribute("disabled", "disabled");
    try {
      await api(`/api/works/${encodePath(selected.value)}/galleries`, { method: "POST", body: { gallery_id: galleryId } });
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

async function openWorkUploadModal(galleryId, file) {
  await loadRoleSuggestions();
  const previewUrl = URL.createObjectURL(file);
  const title = file.name ? file.name.replace(/\.[^.]+$/, "") : "";
  const uploadKey = clientKey("work-upload");
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.dataset.uploadModal = "true";
  modal.innerHTML = workUploadModalView({ galleryId, previewUrl, title });
  const close = () => {
    URL.revokeObjectURL(previewUrl);
    modal.remove();
    document.querySelectorAll("#work-file-upload, #work-file-camera").forEach((input) => {
      input.value = "";
    });
  };
  document.body.append(modal);
  mountComponentIslands(modal);
  bindProtectedMedia(modal);
  enhanceMarkdownEditors(modal);
  bindCollaboratorRows(modal);
  modal.querySelectorAll("[data-close-modal]").forEach((control) => control.addEventListener("click", close));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  modal.querySelector("[data-upload-details-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true") return;
    syncMarkdownEditors(form);
    const collaborators = collaboratorPayloads(form);
    const body = new FormData();
    body.set("file", file);
    body.set("title", field(form, "title").value || title || "Untitled image");
    body.set("description", field(form, "description").value || "");
    body.set("client_upload_key", uploadKey);
    body.set("collaborators_json", JSON.stringify(collaborators));
    const submit = form.querySelector("[type=submit]");
    form.dataset.submitting = "true";
    submit?.setAttribute("disabled", "disabled");
    const previousLabel = submit?.textContent || "";
    if (submit) submit.textContent = "Preparing...";
    try {
      const { preview, thumbnail } = await imageUploadVariants(file);
      body.set("preview", preview);
      body.set("thumbnail", thumbnail);
      if (submit) submit.textContent = "Uploading...";
      const data = await api(`/api/galleries/${encodePath(galleryId)}/works`, { method: "POST", body });
      await loadRoleSuggestions();
      const failed = (data.collaborator_results || []).filter((result) => !result.ok);
      if (failed.length) toast(`Image uploaded, but ${failed.length} collaborator${failed.length === 1 ? "" : "s"} could not be added.`, "error");
      else toast(data.duplicate ? "Upload already completed" : "Image uploaded");
      close();
      navigate(`/works/${data.work.id}`);
    } catch (error) {
      toast(error.message, "error");
      form.dataset.submitting = "false";
      submit?.removeAttribute("disabled");
      if (submit) submit.textContent = previousLabel;
    }
  });
}

function bindGalleryDropSurface() {
  const surface = document.querySelector("[data-gallery-drop-surface]");
  const form = document.querySelector("#work-form");
  if (!surface || !form) return;
  for (const eventName of ["dragenter", "dragover"]) {
    surface.addEventListener(eventName, (event) => {
      event.preventDefault();
      surface.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    surface.addEventListener(eventName, (event) => {
      event.preventDefault();
      surface.classList.remove("is-dragging");
    });
  }
  surface.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) openWorkUploadModal(form.dataset.galleryId, file);
  });
}

async function renderGallerySettings(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/galleries/${encodePath(id)}`);
  const gallery = data.gallery;
  if (!gallery.capabilities.edit) return navigate(`/galleries/${id}`);
  setApp(pageShell(gallerySettingsView({ id, gallery, works: data.works || [], members: data.members || [] })));
  bindJsonForm("#gallery-settings-form", async (body) => {
    await api(`/api/galleries/${encodePath(id)}`, { method: "PATCH", body });
    await loadGalleries();
    toast("Gallery saved");
    renderRoute();
  });
  bindChoiceHelp(document.querySelector("#gallery-settings-form"));
  bindGalleryMemberForm(id);
}

function bindGalleryMemberForm(id) {
  const form = document.querySelector("#gallery-member-form");
  if (!form) return;
  bindMentionAutocomplete(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("[type=submit]");
    submit?.setAttribute("disabled", "disabled");
    try {
      await api(`/api/galleries/${encodePath(id)}/members`, { method: "POST", body: formDataObject(form) });
      toast("Member added");
      renderRoute();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      submit?.removeAttribute("disabled");
    }
  });
}

export { renderGallery, renderGallerySettings, renderNewGallery };
