// @ts-nocheck
import { api, authPage, bindJsonForm, button, encodePath, escapeHtml, link, loadGalleries, navigate, setApp, state, syncBrowserNotifications } from "../app/core";

async function renderSetup() {
  const status = await api("/api/setup/status").catch(() => ({ setup_enabled: false }));
  if (!status.setup_enabled) {
    setApp(authPage(`<p class="eyebrow">Setup</p><h1>Setup is disabled</h1><p class="lede">An admin account already exists.</p>${link("/login", "Log in", "button primary")}`));
    return;
  }
  setApp(authPage(`
    <p class="eyebrow">Setup</p><h1>Create admin</h1>
    <form class="form" id="setup-form">
      <div class="form-row"><label>Setup token</label><input name="token" required></div>
      <div class="form-row"><label>Email</label><input name="email" type="email" required></div>
      <div class="form-row"><label>Handle</label><input name="handle" required pattern="[A-Za-z0-9_-]+"></div>
      <div class="form-row"><label>Password</label><input name="password" type="password" required minlength="10"></div>
      ${button("Create admin", "button primary", "type=submit")}
    </form>
  `));
  bindJsonForm("#setup-form", async (body) => {
    const data = await api("/api/setup/admin", { method: "POST", body });
    if (data.token) {
      state.token = data.token;
      localStorage.setItem("qc_token", data.token);
    }
    state.me = data.user;
    syncBrowserNotifications().catch(() => undefined);
    navigate("/");
  });
}

async function renderLogin() {
  setApp(authPage(`
    <p class="eyebrow">Login</p><h1>${escapeHtml(state.instance.name || "QuietCollective")}</h1>
    <form class="form" id="login-form">
      <div class="form-row"><label>Email</label><input name="email" type="email" required></div>
      <div class="form-row"><label>Password</label><input name="password" type="password" required></div>
      ${button("Log in", "button primary", "type=submit")}
    </form>
  `));
  bindJsonForm("#login-form", async (body) => {
    const data = await api("/api/auth/login", { method: "POST", body });
    if (data.token) {
      state.token = data.token;
      localStorage.setItem("qc_token", data.token);
    }
    state.me = data.user;
    await loadGalleries();
    syncBrowserNotifications().catch(() => undefined);
    navigate("/");
  });
}

async function renderInvite(token) {
  const invite = await api(`/api/invites/${encodePath(token)}`);
  setApp(authPage(`
    <p class="eyebrow">Invite</p><h1>Join ${escapeHtml(state.instance.name || "QuietCollective")}</h1>
    <p class="lede">This invite grants the ${escapeHtml(invite.role_on_join || "member")} role.</p>
    <form class="form" id="invite-form">
      <div class="form-row"><label>Email</label><input name="email" type="email" required></div>
      <div class="form-row"><label>Handle</label><input name="handle" required pattern="[A-Za-z0-9_-]+"></div>
      <div class="form-row"><label>Password</label><input name="password" type="password" required minlength="10"></div>
      ${button("Accept invite", "button primary", "type=submit")}
    </form>
  `));
  bindJsonForm("#invite-form", async (body) => {
    const data = await api(`/api/invites/${encodePath(token)}/accept`, { method: "POST", body });
    if (data.token) {
      state.token = data.token;
      localStorage.setItem("qc_token", data.token);
    }
    state.me = data.user;
    syncBrowserNotifications().catch(() => undefined);
    navigate("/");
  });
}


export { renderInvite, renderLogin, renderSetup };
