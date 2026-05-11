// @ts-nocheck
import { api, authPage, bindJsonForm, encodePath, loadGalleries, navigate, pageShell, refreshMe, setApp, state, syncBrowserNotifications, toast } from "../app/core";
import { forcePasswordChangeView, forgotPasswordView, inviteView, loginView, resetPasswordView, rulesAcceptView, setupDisabledView, setupFormView } from "../views/islands";

function postAuthDestination(user = state.me) {
  if (user?.password_change_required) return "/force-password-change";
  if (user?.rules_required) return "/rules/accept";
  return "/";
}

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
    navigate(postAuthDestination(data.user));
  });
}

async function renderLogin() {
  const instanceData = await api("/api/instance").catch(() => null);
  if (instanceData?.instance) state.instance = instanceData.instance;
  setApp(authPage(loginView(state.instance.name, state.instance.login_subtitle || "")));
  bindJsonForm("#login-form", async (body) => {
    const data = await api("/api/auth/login", { method: "POST", body });
    if (data.token) {
      state.token = data.token;
      localStorage.setItem("qc_token", data.token);
    }
    state.me = data.user;
    await loadGalleries();
    syncBrowserNotifications().catch(() => undefined);
    navigate(postAuthDestination(data.user));
  });
}

async function renderInvite(token) {
  const [invite, instanceData] = await Promise.all([
    api(`/api/invites/${encodePath(token)}`),
    api("/api/instance").catch(() => null),
  ]);
  if (instanceData?.instance) state.instance = instanceData.instance;
  setApp(authPage(inviteView({ instanceName: invite.instance_name || state.instance.name, roleOnJoin: invite.role_on_join, subtitle: state.instance.invite_subtitle || "" })));
  bindJsonForm("#invite-form", async (body) => {
    const data = await api(`/api/invites/${encodePath(token)}/accept`, { method: "POST", body });
    if (data.token) {
      state.token = data.token;
      localStorage.setItem("qc_token", data.token);
    }
    state.me = data.user;
    syncBrowserNotifications().catch(() => undefined);
    navigate(postAuthDestination(data.user));
  });
}

async function renderForgotPassword() {
  const instanceData = await api("/api/instance").catch(() => null);
  if (instanceData?.instance) state.instance = instanceData.instance;
  setApp(authPage(forgotPasswordView(state.instance.name)));
  bindJsonForm("#forgot-password-form", async (body) => {
    await api("/api/auth/password-reset/request", { method: "POST", body });
    toast("If that account exists, a reset link has been sent.");
    navigate("/login");
  });
}

async function renderResetPassword(token) {
  setApp(authPage(resetPasswordView()));
  bindJsonForm("#reset-password-form", async (body) => {
    await api("/api/auth/password-reset/complete", { method: "POST", body: { ...body, token } });
    toast("Password updated. Log in with the new password.");
    navigate("/login");
  });
}

async function renderForcePasswordChange() {
  if (!(await refreshMe().catch(() => null))) {
    navigate("/login");
    return;
  }
  if (!state.me?.password_change_required) {
    navigate(postAuthDestination(state.me));
    return;
  }
  setApp(pageShell(forcePasswordChangeView()));
  bindJsonForm("#force-password-form", async (body) => {
    const data = await api("/api/auth/password", { method: "PATCH", body });
    state.me = data.user;
    navigate(postAuthDestination(data.user));
  });
}

async function renderRulesAccept() {
  if (!(await refreshMe().catch(() => null))) {
    navigate("/login");
    return;
  }
  if (state.me?.password_change_required) {
    navigate("/force-password-change");
    return;
  }
  const rules = await api("/api/rules/current");
  if (!rules.required) {
    navigate("/");
    return;
  }
  setApp(pageShell(rulesAcceptView(rules)));
  bindJsonForm("#rules-accept-form", async () => {
    await api("/api/rules/accept", { method: "POST", body: { accept: true } });
    await refreshMe();
    navigate("/");
  });
}

export { renderForcePasswordChange, renderForgotPassword, renderInvite, renderLogin, renderResetPassword, renderRulesAccept, renderSetup };
