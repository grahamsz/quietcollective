// @ts-nocheck

/** Renders the disabled setup message used when an admin account already exists. */
export function SetupDisabledView() {
  return (
    <>
      <p class="eyebrow">Setup</p>
      <h1>Setup is disabled</h1>
      <p class="lede">An admin account already exists.</p>
      <a href="/login" class="button primary" data-link>Log in</a>
    </>
  );
}

/** Renders the first-admin setup form used by `/setup`. */
export function SetupFormView() {
  return (
    <>
      <p class="eyebrow">Setup</p>
      <h1>Create admin</h1>
      <form class="form" id="setup-form">
        <div class="form-row"><label>Setup token</label><input name="token" required /></div>
        <div class="form-row"><label>Email</label><input name="email" type="email" required /></div>
        <div class="form-row"><label>Handle</label><input name="handle" required pattern="[A-Za-z0-9_-]+" /></div>
        <div class="form-row"><label>Password</label><input name="password" type="password" required minLength={10} /></div>
        <button class="button primary" type="submit">Create admin</button>
      </form>
    </>
  );
}

/** Renders the login form used by `/login`. */
export function LoginView({ instanceName }) {
  return (
    <>
      <p class="eyebrow">Login</p>
      <h1>{instanceName || "QuietCollective"}</h1>
      <form class="form" id="login-form">
        <div class="form-row"><label>Email</label><input name="email" type="email" required /></div>
        <div class="form-row"><label>Password</label><input name="password" type="password" required /></div>
        <button class="button primary" type="submit">Log in</button>
      </form>
    </>
  );
}

/** Renders the invite acceptance form used by `/invite/:token`. */
export function InviteView({ instanceName, roleOnJoin }) {
  return (
    <>
      <p class="eyebrow">Invite</p>
      <h1>Join {instanceName || "QuietCollective"}</h1>
      <p class="lede">This invite grants the {roleOnJoin || "member"} role.</p>
      <form class="form" id="invite-form">
        <div class="form-row"><label>Email</label><input name="email" type="email" required /></div>
        <div class="form-row"><label>Handle</label><input name="handle" required pattern="[A-Za-z0-9_-]+" /></div>
        <div class="form-row"><label>Password</label><input name="password" type="password" required minLength={10} /></div>
        <button class="button primary" type="submit">Accept invite</button>
      </form>
    </>
  );
}
