// @ts-nocheck
import { api, bindJsonForm, ensureAuthed, pageShell, refreshMe, renderRoute, setApp, state, toast } from "../app/core";
import { adminInvitesView, adminView } from "../views/islands";

function bindAdminTabs() {
  const buttons = [...document.querySelectorAll("[data-admin-tab]")];
  const panels = [...document.querySelectorAll("[data-admin-tab-panel]")];
  if (!buttons.length || !panels.length) return;
  const saved = localStorage.getItem("qc_admin_tab") || buttons[0].dataset.adminTab;
  const activate = (tab) => {
    const validTab = buttons.some((button) => button.dataset.adminTab === tab) ? tab : buttons[0].dataset.adminTab;
    buttons.forEach((button) => button.setAttribute("aria-selected", button.dataset.adminTab === validTab ? "true" : "false"));
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.adminTabPanel !== validTab;
    });
    localStorage.setItem("qc_admin_tab", validTab);
  };
  buttons.forEach((button) => button.addEventListener("click", () => activate(button.dataset.adminTab)));
  activate(saved);
}

async function renderAdmin() {
  if (!(await ensureAuthed())) return;
  const [admin, settings, users, rules] = await Promise.all([
    api("/api/admin"),
    api("/api/admin/settings").catch(() => ({})),
    api("/api/admin/users").catch(() => ({ users: [] })),
    api("/api/admin/rules").catch(() => ({ versions: [] })),
  ]);
  setApp(pageShell(adminView({
    admin,
    settings,
    users: users.users || [],
    instance: state.instance,
    rules,
  })));
  bindAdminTabs();
  document.querySelector("#settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/admin/settings", { method: "POST", body: new FormData(event.currentTarget) }).catch((error) => toast(error.message, "error"));
    await refreshMe();
    renderRoute();
  });
  bindJsonForm("#content-form", async (body) => {
    await api("/api/admin/content", { method: "POST", body });
    const data = await api("/api/instance");
    state.instance = data.instance || state.instance;
    toast("Site text saved");
    renderRoute();
  });
  bindJsonForm("#email-form", async (body) => {
    await api("/api/admin/email", { method: "POST", body });
    toast("SMTP settings saved");
    renderRoute();
  });
  bindJsonForm("#email-test-form", async (body) => {
    await api("/api/admin/email/test", { method: "POST", body });
    toast("Test email sent");
  });
  bindJsonForm("#rules-form", async (body) => {
    await api("/api/admin/rules", { method: "POST", body });
    await refreshMe();
    toast("Server rules published");
    renderRoute();
  });
  document.querySelectorAll("[data-admin-role]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/admin/users/${control.dataset.adminRole}/role`, { method: "POST", body: { role: control.dataset.role } }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
  document.querySelectorAll("[data-admin-disable]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/admin/users/${control.dataset.adminDisable}/disable`, { method: "POST" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
  document.querySelectorAll("[data-admin-enable]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/admin/users/${control.dataset.adminEnable}/enable`, { method: "POST" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
  document.querySelectorAll("[data-admin-force-password]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/admin/users/${control.dataset.adminForcePassword}/force-password-change`, { method: "POST" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
  document.querySelectorAll("[data-admin-reset-password]").forEach((control) => {
    control.addEventListener("click", async () => {
      const data = await api(`/api/admin/users/${control.dataset.adminResetPassword}/password-reset`, { method: "POST" }).catch((error) => {
        toast(error.message, "error");
        return null;
      });
      if (data?.reset_url) await navigator.clipboard?.writeText(data.reset_url).catch(() => undefined);
      if (data) toast(data.emailed ? "Reset link emailed and copied" : "Reset link copied");
    });
  });
}

async function renderAdminInvites() {
  if (!(await ensureAuthed())) return;
  const data = await api("/api/admin/invites");
  setApp(pageShell(adminInvitesView(data.invites || [])));
  bindJsonForm("#invite-create-form", async (body) => {
    const created = await api("/api/admin/invites", { method: "POST", body });
    const url = created.invite.absolute_url || `${location.origin}${created.invite.url}`;
    await navigator.clipboard?.writeText(created.invite.invite_text || url).catch(() => undefined);
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
