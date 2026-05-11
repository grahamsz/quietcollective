// @ts-nocheck
import { api, badge, bindJsonForm, bindProtectedMedia, button, clientKey, empty, encodePath, enhanceMarkdownEditors, ensureAuthed, escapeHtml, field, galleryAccessChips, galleryAccessRules, icon, iconButton, imageGrid, imageUploadVariants, initials, link, loadGalleries, loadRoleSuggestions, markdownHint, mountComponentIslands, navigate, newestFirst, ownershipHelp, pageShell, panel, protectedImage, renderMarkdown, renderRoute, setApp, syncMarkdownEditors, toast, visibilityHelp } from "../app/core";
import { bindCommentForm, commentsPanel } from "../app/comments";
import { bindCollaboratorRows, collaboratorCreditRows, collaboratorPayloads } from "../app/collaborators";

async function renderNewGallery() {
  if (!(await ensureAuthed())) return;
  setApp(pageShell(`<section class="view"><div><p class="eyebrow">Gallery</p><h1>New gallery</h1><p class="lede">Galleries are private by default. Everyone visibility means logged-in members only.</p></div>${panel("Details", `<form class="form" id="gallery-form"><div class="form-row"><label>Title</label><input name="title" required></div><div class="form-row"><label>Description</label><textarea name="description" data-markdown-editor></textarea>${markdownHint()}</div><div class="form-row"><label>Ownership</label><select name="ownership_type"><option value="self">Self-owned</option><option value="collaborative">Collaborative</option><option value="whole_server">Everyone</option></select><span class="field-hint choice-hint" data-ownership-help>${ownershipHelp("self")}</span></div><div class="form-row"><label>Visibility</label><select name="visibility"><option value="private">Private</option><option value="server_public">Everyone</option></select><span class="field-hint choice-hint" data-visibility-help>${visibilityHelp("private")}</span></div>${button("Create gallery", "button primary", "type=submit")}</form>`)}</section>`));
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
  ownership?.addEventListener("change", () => {
    ownershipText.textContent = ownershipHelp(ownership.value);
    if (ownership.value === "whole_server" && visibility) {
      visibility.value = "server_public";
      visibilityText.textContent = visibilityHelp("server_public");
    }
  });
  visibility?.addEventListener("change", () => {
    visibilityText.textContent = visibilityHelp(visibility.value);
  });
}

async function renderGallery(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/galleries/${encodePath(id)}`);
  const gallery = data.gallery;
  const works = [...(data.works || [])].sort(newestFirst);
  const comments = await api(`/api/comments?target_type=gallery&target_id=${encodePath(id)}`).catch(() => ({ comments: [] }));
  const memberBox = `${gallery.ownership_type === "whole_server" ? `<div class="notice compact">Everyone gallery: any logged-in member can post images here. Gallery settings are still limited to gallery admins and instance admins.</div>` : ""}<div class="grid">${(data.members || []).map((member) => `<article class="member-card"><h3 class="card-title">@${escapeHtml(member.handle)}</h3><p class="description">${escapeHtml(member.role_label)}</p><div class="badge-row">${["view", "edit", "upload_work", "comment", "manage_collaborators"].filter((key) => member[`can_${key}`] || (key === "view" && member.can_view)).map((key) => badge(key)).join("")}</div></article>`).join("") || empty("No explicit gallery members yet.")}</div>`;
  setApp(pageShell(`<section class="view gallery-view"><div class="view-header"><div><p class="eyebrow">Gallery</p><h1>${escapeHtml(gallery.title)}</h1><div class="lede markdown-body">${renderMarkdown(gallery.description || "No description")}</div><div class="gallery-access-inline">${galleryAccessChips(gallery, "is-inline")}</div></div><div class="toolbar">${gallery.capabilities.upload_work ? iconButton("plus", "Add to gallery", "button primary square-button", "data-show-upload type=button") : ""}${gallery.capabilities.edit ? link(`/galleries/${id}/settings`, "Settings", "button") : ""}</div></div><section class="gallery-drop-surface" data-gallery-drop-surface>${works.length ? imageGrid(works, { galleryId: id }) : empty(gallery.capabilities.upload_work ? "Drop images here or use the + button to start this gallery." : "No works in this gallery yet.")}</section>${gallery.capabilities.upload_work ? createWorkPanel(id) : ""}<div class="home-lower-grid">${commentsPanel("gallery", id, comments.comments)}${panel("Members", memberBox)}</div></section>`));
  bindCreateWork(id, gallery);
  bindGalleryDropSurface();
  bindCommentForm("gallery", id);
}

function createWorkPanel(galleryId) {
  return `<form class="sr-only" id="work-form" data-gallery-id="${escapeHtml(galleryId)}"><input id="work-file-upload" name="file" type="file" accept="image/*"><input id="work-file-camera" name="camera" type="file" accept="image/*" capture="environment"><span data-file-name>No image selected</span></form>`;
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
  modal.innerHTML = `<section class="modal-panel add-menu-modal" role="dialog" aria-modal="true"><div class="panel-header"><div><p class="eyebrow">Add to gallery</p><h2>${escapeHtml(gallery?.title || "Gallery")}</h2></div>${iconButton("x", "Close", "icon-button", "data-close-modal type=button")}</div><div class="panel-body"><div class="add-action-grid"><button class="add-action" type="button" data-add-action="upload">${icon("upload")}<strong>Upload</strong><span>Choose an image file from this device.</span></button><button class="add-action" type="button" data-add-action="camera">${icon("camera")}<strong>Camera</strong><span>Take a new image and add the details.</span></button><button class="add-action" type="button" data-add-action="crosspost">${icon("send")}<strong>Crosspost</strong><span>Add one of your works or collaborator credits.</span></button></div>${galleryAccessRules(gallery || {})}</div></section>`;
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
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<section class="modal-panel crosspost-modal" role="dialog" aria-modal="true"><div class="panel-header"><div><p class="eyebrow">Crosspost</p><h2>${escapeHtml(gallery?.title || "Gallery")}</h2></div>${iconButton("x", "Close", "icon-button", "data-close-modal type=button")}</div><div class="panel-body">${empty("Loading works...")}</div></section>`;
  const close = () => modal.remove();
  document.body.append(modal);
  modal.querySelectorAll("[data-close-modal]").forEach((control) => control.addEventListener("click", close));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });

  try {
    const data = await api(`/api/galleries/${encodePath(galleryId)}/crosspost-candidates`);
    const works = data.works || [];
    const body = modal.querySelector(".panel-body");
    body.innerHTML = works.length ? crosspostPicker(works, galleryId) : empty("No eligible works to crosspost. Own works and works that credit you as a collaborator will appear here.");
    bindProtectedMedia(modal);
    bindCrosspostPicker(modal, works, galleryId, close);
  } catch (error) {
    modal.querySelector(".panel-body").innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  }
}

function crosspostPicker(works, galleryId) {
  return `<form class="form" data-crosspost-form><div class="form-row"><label>Find work</label><input type="search" data-crosspost-search placeholder="Search by title or gallery"></div><div class="crosspost-list">${works.map((work) => crosspostOption(work)).join("")}</div><div class="notice compact warning is-hidden" data-crosspost-warning></div><label class="checkbox-row is-hidden" data-crosspost-confirm-row><input type="checkbox" name="visibility_confirm"><span>I understand this may increase who can see the selected work.</span></label><div class="toolbar">${button("Cancel", "button ghost", "type=button data-close-modal")}${button("Crosspost", "button primary", `type=submit data-target-gallery="${escapeHtml(galleryId)}"`)}</div></form>`;
}

function crosspostOption(work) {
  const version = work.current_version || {};
  const imageUrl = version.thumbnail_url || version.preview_url;
  const galleries = (work.galleries || []).map((gallery) => gallery.title).join(", ") || "No visible gallery";
  const relationship = work.crosspost?.relationship === "owner" ? "Your work" : "Collaborator credit";
  const warning = work.crosspost?.increases_visibility ? "Visibility change" : "";
  const search = `${work.title || ""} ${work.description || ""} ${galleries} ${relationship}`.toLowerCase();
  return `<label class="crosspost-option" data-crosspost-option data-search="${escapeHtml(search)}"><input type="radio" name="work_id" value="${escapeHtml(work.id)}" data-increases-visibility="${work.crosspost?.increases_visibility ? "true" : "false"}"><span class="crosspost-thumb">${imageUrl ? protectedImage(imageUrl, work.title) : `<span class="image-placeholder">${escapeHtml(initials(work.title))}</span>`}</span><span class="crosspost-copy"><strong>${escapeHtml(work.title)}</strong><span>${escapeHtml(galleries)}</span><span class="badge-row">${badge(relationship)}${warning ? badge(warning, "amber") : ""}</span></span></label>`;
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
  modal.innerHTML = `<section class="modal-panel upload-modal" role="dialog" aria-modal="true"><div class="panel-header"><h2>Add image details</h2>${iconButton("x", "Close", "icon-button", "data-close-modal type=button")}</div><div class="panel-body"><div class="upload-preview">${protectedImage(previewUrl)}</div><form class="form" data-upload-details-form><div class="form-row"><label>Title</label><input name="title" value="${escapeHtml(title)}" placeholder="Defaults to file name"></div><div class="form-row"><label>Description</label><textarea name="description" data-markdown-editor data-target-type="gallery" data-target-id="${escapeHtml(galleryId)}"></textarea>${markdownHint()}</div><div class="form-row"><label>Collaborators</label>${collaboratorCreditRows({ listId: "upload-work-role-options" })}</div><div class="toolbar">${button("Cancel", "button ghost", "type=button data-close-modal")}${button("Upload image", "button primary", "type=submit")}</div></form></div></section>`;
  const close = () => {
    URL.revokeObjectURL(previewUrl);
    modal.remove();
    document.querySelectorAll("#work-file-upload, #work-file-camera").forEach((input) => {
      input.value = "";
    });
  };
  document.body.append(modal);
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
  setApp(pageShell(`<section class="view"><div><p class="eyebrow">Gallery settings</p><h1>${escapeHtml(gallery.title)}</h1></div><div class="grid two">${panel("Details", `<form class="form" id="gallery-settings-form"><div class="form-row"><label>Title</label><input name="title" value="${escapeHtml(gallery.title)}" required></div><div class="form-row"><label>Description</label><textarea name="description" data-markdown-editor data-target-type="gallery" data-target-id="${escapeHtml(id)}">${escapeHtml(gallery.description)}</textarea>${markdownHint()}</div><div class="form-row"><label>Ownership</label><select name="ownership_type"><option value="self" ${gallery.ownership_type === "self" ? "selected" : ""}>Self-owned</option><option value="collaborative" ${gallery.ownership_type === "collaborative" ? "selected" : ""}>Collaborative</option><option value="whole_server" ${gallery.ownership_type === "whole_server" ? "selected" : ""}>Everyone</option></select><span class="field-hint choice-hint" data-ownership-help>${ownershipHelp(gallery.ownership_type)}</span></div><div class="form-row"><label>Visibility</label><select name="visibility"><option value="private" ${gallery.visibility === "private" ? "selected" : ""}>Private</option><option value="server_public" ${gallery.visibility === "server_public" ? "selected" : ""}>Everyone</option></select><span class="field-hint choice-hint" data-visibility-help>${visibilityHelp(gallery.visibility)}</span></div><div class="form-row"><label>Gallery preview image</label><select name="cover_version_id"><option value="">Use fallback</option>${(data.works || []).filter((work) => work.current_version?.thumbnail_url).map((work) => `<option value="${escapeHtml(work.current_version.id)}" ${gallery.cover_version_id === work.current_version.id ? "selected" : ""}>${escapeHtml(work.title)}</option>`).join("")}</select></div>${button("Save gallery", "button primary", "type=submit")}</form>`)}${panel("Members", `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Capabilities</th></tr></thead><tbody>${(data.members || []).map((member) => `<tr><td>@${escapeHtml(member.handle)}</td><td>${escapeHtml(member.role_label)}</td><td>${["view", "edit", "upload_work", "comment", "manage_collaborators"].filter((key) => member[`can_${key}`] || (key === "view" && member.can_view)).join(", ")}</td></tr>`).join("")}</tbody></table></div>`)}</div></section>`));
  bindJsonForm("#gallery-settings-form", async (body) => {
    await api(`/api/galleries/${encodePath(id)}`, { method: "PATCH", body });
    await loadGalleries();
    toast("Gallery saved");
    renderRoute();
  });
  bindChoiceHelp(document.querySelector("#gallery-settings-form"));
}


export { renderGallery, renderGallerySettings, renderNewGallery };
