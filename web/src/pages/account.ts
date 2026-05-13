// @ts-nocheck
import { api, bindBrowserNotificationSettings, bindJsonForm, ensureAuthed, pageShell, refreshMe, renderRoute, setApp, state, toast } from "../app/core";
import { exportsView, profileView } from "../views/islands";

function profileLinks(form) {
  return [...form.querySelectorAll("[data-profile-link-row]")]
    .map((row) => ({
      site: row.querySelector("[name=link_site]")?.value.trim() || "",
      url: row.querySelector("[name=link_url]")?.value.trim() || "",
    }))
    .filter((link) => link.site || link.url);
}

function bindProfileLinkRows() {
  document.querySelector("[data-add-profile-link]")?.addEventListener("click", () => {
    const list = document.querySelector("[data-profile-link-list]");
    if (!list) return;
    const row = document.createElement("div");
    row.className = "profile-link-row";
    row.dataset.profileLinkRow = "true";
    row.innerHTML = `<input name="link_site" placeholder="Site" autocomplete="off"><input name="link_url" type="url" placeholder="https://example.com" autocomplete="off"><button class="button ghost" type="button" data-remove-profile-link>Remove</button>`;
    list.append(row);
    row.querySelector("input")?.focus();
  });
  document.querySelector("[data-profile-link-list]")?.addEventListener("click", (event) => {
    const control = event.target?.closest?.("[data-remove-profile-link]");
    if (!control) return;
    const row = control.closest("[data-profile-link-row]");
    row?.remove();
  });
}

async function renderMyProfile() {
  if (!(await ensureAuthed())) return;
  const me = state.me;
  setApp(pageShell(profileView(me)));
  bindProfileLinkRows();
  bindJsonForm("#profile-form", async (body, form) => {
    body.links = profileLinks(form);
    await api("/api/users/me", { method: "PATCH", body });
    await refreshMe();
    toast("Profile saved");
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
