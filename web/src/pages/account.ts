// @ts-nocheck
import { api, bindBrowserNotificationSettings, bindJsonForm, browserNotificationsPanel, button, empty, ensureAuthed, escapeHtml, formatDate, link, loadPopularTags, markdownHint, pageShell, panel, refreshMe, renderRoute, setApp, state, toast } from "../app/core";

async function renderMyProfile() {
  if (!(await ensureAuthed())) return;
  const me = state.me;
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Profile</p><h1>@${escapeHtml(me.handle)}</h1></div><div class="toolbar">${link("/me/exports", "Exports", "button")}</div></div><div class="grid two">${panel("Details", `<form class="form" id="profile-form"><div class="form-row"><label>Handle</label><input name="handle" value="${escapeHtml(me.handle)}" required></div><div class="form-row"><label>Bio</label><textarea name="bio" data-markdown-editor data-target-type="profile" data-target-id="${escapeHtml(me.id)}">${escapeHtml(me.bio || "")}</textarea>${markdownHint()}</div><div class="form-row"><label>Links JSON</label><textarea name="links">${escapeHtml(JSON.stringify(me.links || [], null, 2))}</textarea></div>${button("Save profile", "button primary", "type=submit")}</form>`)}<div>${panel("Medium Tags", `<form class="form" id="tag-form"><div class="form-row"><label>Tags</label><input name="tags" value="${escapeHtml((me.medium_tags || []).join(", "))}"><span class="field-hint">Comma-separated medium tags.</span></div>${button("Save tags", "button", "type=submit")}</form>`)}${browserNotificationsPanel()}</div></div></section>`));
  bindJsonForm("#profile-form", async (body) => {
    await api("/api/users/me", { method: "PATCH", body });
    await refreshMe();
    toast("Profile saved");
    renderRoute();
  });
  bindJsonForm("#tag-form", async (body) => {
    await api("/api/users/me/medium-tags", { method: "POST", body: { tags: body.tags } });
    await refreshMe();
    state.popularTagsLoaded = false;
    await loadPopularTags();
    toast("Tags saved");
    renderRoute();
  });
  bindBrowserNotificationSettings();
}

async function renderExports() {
  if (!(await ensureAuthed())) return;
  const data = await api("/api/exports/me").catch(() => ({ exports: [] }));
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Exports</p><h1>Your data exports</h1><p class="lede">Export ZIPs include JSON data, a works spreadsheet, and high-resolution WebP files. Undownloaded exports are deleted after 7 days.</p></div><div>${button("Create export", "button primary", "data-create-export")}</div></div>${panel("Exports", `<div class="grid">${(data.exports || []).map((item) => `<article class="export-card"><h3 class="card-title">${escapeHtml(item.status)}</h3><p class="description">${escapeHtml(formatDate(item.created_at))}${item.expires_at && !item.downloaded_at ? ` · expires ${escapeHtml(formatDate(item.expires_at))}` : ""}${item.downloaded_at ? ` · downloaded ${escapeHtml(formatDate(item.downloaded_at))}` : ""}</p>${item.status === "ready" ? link(`/api/exports/${item.id}`, "Download ZIP", "button") : ""}</article>`).join("") || empty("No exports yet.")}</div>`)}</section>`));
  document.querySelector("[data-create-export]")?.addEventListener("click", async () => {
    await api("/api/exports/me", { method: "POST" }).catch((error) => toast(error.message, "error"));
    renderRoute();
  });
}


export { renderExports, renderMyProfile };
