// @ts-nocheck
import { api, bindBrowserNotificationSettings, bindJsonForm, ensureAuthed, loadPopularTags, pageShell, refreshMe, renderRoute, setApp, state, toast } from "../app/core";
import { exportsView, profileView } from "../views/islands";

async function renderMyProfile() {
  if (!(await ensureAuthed())) return;
  const me = state.me;
  setApp(pageShell(profileView(me)));
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
  setApp(pageShell(exportsView(data.exports || [])));
  document.querySelector("[data-create-export]")?.addEventListener("click", async () => {
    await api("/api/exports/me", { method: "POST" }).catch((error) => toast(error.message, "error"));
    renderRoute();
  });
}


export { renderExports, renderMyProfile };
