// @ts-nocheck
import { api, bindJsonForm, ensureAuthed, pageShell, refreshMe, renderRoute, setApp, state, toast } from "../app/core";
import { adminInvitesView, adminView } from "../views/islands";

async function renderAdmin() {
  if (!(await ensureAuthed())) return;
  const [admin, settings, members, events] = await Promise.all([
    api("/api/admin"),
    api("/api/admin/settings").catch(() => ({})),
    api("/api/members").catch(() => ({ members: [] })),
    api("/api/admin/events").catch(() => ({ events: [] })),
  ]);
  setApp(pageShell(adminView({
    admin,
    settings,
    members: members.members || [],
    events: events.events || [],
    instance: state.instance,
  })));
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
  setApp(pageShell(adminInvitesView(data.invites || [])));
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
