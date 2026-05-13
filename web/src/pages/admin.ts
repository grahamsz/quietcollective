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

function imageLoaded(image) {
  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("Could not load icon image")), { once: true });
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare icon image")), "image/png");
  });
}

async function resizeIconFile(file, size, basename) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await imageLoaded(image);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare icon canvas");
    context.clearRect(0, 0, size, size);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const sourceWidth = image.naturalWidth || size;
    const sourceHeight = image.naturalHeight || size;
    const scale = Math.min(size / sourceWidth, size / sourceHeight);
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
    const blob = await canvasBlob(canvas);
    return new File([blob], `${basename}-${size}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function appendInstallIconRenditions(body, form) {
  const appIcon = form.querySelector('input[name="app_icon"]')?.files?.[0];
  const maskableIcon = form.querySelector('input[name="app_maskable_icon"]')?.files?.[0];
  if (appIcon) {
    body.set("app_icon_16", await resizeIconFile(appIcon, 16, "app-icon"));
    body.set("app_icon_32", await resizeIconFile(appIcon, 32, "app-icon"));
    body.set("app_icon_192", await resizeIconFile(appIcon, 192, "app-icon"));
    body.set("app_icon_512", await resizeIconFile(appIcon, 512, "app-icon"));
  }
  if (maskableIcon) {
    body.set("app_maskable_icon_192", await resizeIconFile(maskableIcon, 192, "maskable-app-icon"));
    body.set("app_maskable_icon_512", await resizeIconFile(maskableIcon, 512, "maskable-app-icon"));
  }
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
    const body = new FormData(event.currentTarget);
    try {
      await appendInstallIconRenditions(body, event.currentTarget);
      await api("/api/admin/settings", { method: "POST", body });
    } catch (error) {
      toast(error.message, "error");
      return;
    }
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
