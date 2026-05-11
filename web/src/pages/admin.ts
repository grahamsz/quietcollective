// @ts-nocheck
import { api, bindJsonForm, button, empty, ensureAuthed, escapeHtml, link, pageShell, panel, refreshMe, renderRoute, setApp, state, toast } from "../app/core";
import { eventList } from "../views/lists";

async function renderAdmin() {
  if (!(await ensureAuthed())) return;
  const [admin, settings, members, events] = await Promise.all([
    api("/api/admin"),
    api("/api/admin/settings").catch(() => ({})),
    api("/api/members").catch(() => ({ members: [] })),
    api("/api/admin/events").catch(() => ({ events: [] })),
  ]);
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Admin</p><h1>Instance settings</h1></div><div>${link("/admin/invites", "Invites", "button primary")}</div></div><div class="stat-grid"><div class="stat"><strong>${admin.members}</strong><span>Members</span></div><div class="stat"><strong>${admin.active_invites}</strong><span>Invites</span></div><div class="stat"><strong>${admin.events}</strong><span>Events</span></div></div><div class="grid two">${panel("Branding", `<form class="form" id="settings-form"><div class="form-row"><label>Instance name</label><input name="instance_name" value="${escapeHtml(settings.name || state.instance.name)}"></div><div class="form-row"><label>Source code URL</label><input name="source_code_url" value="${escapeHtml(settings.source_code_url || state.instance.source_code_url || "")}"></div><div class="form-row"><label>Logo</label><input name="logo" type="file" accept="image/*"></div>${button("Save settings", "button primary", "type=submit")}</form>`)}${panel("Members", `<div class="grid">${(members.members || []).map((member) => `<article class="member-card"><h3 class="card-title">@${escapeHtml(member.handle)}</h3><p class="description">${escapeHtml(member.role)}</p></article>`).join("")}</div>`)}</div>${panel("Recent Instance Events", eventList(events.events || []))}</section>`));
  document.querySelector("#settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/admin/settings", { method: "POST", body: new FormData(event.currentTarget) }).catch((error) => toast(error.message, "error"));
    await refreshMe();
    renderRoute();
  });
}

async function renderAdminInvites() {
  if (!(await ensureAuthed())) return;
  const data = await api("/api/admin/invites");
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Admin</p><h1>Invites</h1></div></div><div class="grid two">${panel("Create Invite", `<form class="form" id="invite-create-form"><div class="form-row"><label>Max uses</label><input name="max_uses" type="number" min="1" value="1"></div><div class="form-row"><label>Expires at</label><input name="expires_at" type="datetime-local"></div><div class="form-row"><label>Role on join</label><select name="role_on_join"><option value="member">Member</option><option value="admin">Admin</option></select></div>${button("Create invite", "button primary", "type=submit")}</form>`)}${panel("Existing Invites", `<div class="grid">${(data.invites || []).map((invite) => `<article class="invite-card"><h3 class="card-title">${escapeHtml(invite.role_on_join)}</h3><p class="description">${escapeHtml(invite.revoked_at ? "revoked" : `${invite.use_count}/${invite.max_uses} used`)}</p>${!invite.revoked_at ? button("Revoke", "button warn", `data-revoke="${escapeHtml(invite.id)}"`) : ""}</article>`).join("") || empty("No invites yet.")}</div>`)}</div></section>`));
  bindJsonForm("#invite-create-form", async (body) => {
    const created = await api("/api/admin/invites", { method: "POST", body });
    const url = `${location.origin}${created.invite.url}`;
    await navigator.clipboard?.writeText(`Welcome to my ${state.instance.name || "QuietCollective"} community. Use this invite link: ${url}`).catch(() => undefined);
    toast("Invite created and copied");
    renderRoute();
  });
  document.querySelectorAll("[data-revoke]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/admin/invites/${control.dataset.revoke}/revoke`, { method: "POST" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
}


export { renderAdmin, renderAdminInvites };
