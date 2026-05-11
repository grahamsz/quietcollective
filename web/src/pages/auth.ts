// @ts-nocheck
import { api, authPage, bindJsonForm, encodePath, loadGalleries, navigate, setApp, state, syncBrowserNotifications } from "../app/core";
import { inviteView, loginView, setupDisabledView, setupFormView } from "../views/islands";

async function renderSetup() {
  const status = await api("/api/setup/status").catch(() => ({ setup_enabled: false }));
  if (!status.setup_enabled) {
    setApp(authPage(setupDisabledView()));
    return;
  }
  setApp(authPage(setupFormView()));
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
  setApp(authPage(loginView(state.instance.name)));
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
  setApp(authPage(inviteView({ instanceName: state.instance.name, roleOnJoin: invite.role_on_join })));
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
