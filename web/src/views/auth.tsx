// @ts-nocheck
import { renderMarkdown } from "../lib/markdown";

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
export function LoginView({ instanceName, subtitle }) {
  return (
    <>
      <p class="eyebrow">Login</p>
      <h1>{instanceName || "QuietCollective"}</h1>
      {subtitle ? <p class="lede">{subtitle}</p> : null}
      <form class="form" id="login-form">
        <div class="form-row"><label>Email</label><input name="email" type="email" required /></div>
        <div class="form-row"><label>Password</label><input name="password" type="password" required /></div>
        <button class="button primary" type="submit">Log in</button>
      </form>
      <p class="description"><a href="/forgot-password" data-link>Forgot password?</a></p>
    </>
  );
}

/** Renders the invite acceptance form used by `/invite/:token`. */
export function InviteView({ instanceName, roleOnJoin, subtitle }) {
  return (
    <>
      <p class="eyebrow">Invite</p>
      <h1>Join {instanceName || "QuietCollective"}</h1>
      <p class="lede">{subtitle || `This invite grants the ${roleOnJoin || "member"} role.`}</p>
      <form class="form" id="invite-form">
        <div class="form-row"><label>Email</label><input name="email" type="email" required /></div>
        <div class="form-row"><label>Handle</label><input name="handle" required pattern="[A-Za-z0-9_-]+" /></div>
        <div class="form-row"><label>Password</label><input name="password" type="password" required minLength={10} /></div>
        <button class="button primary" type="submit">Accept invite</button>
      </form>
    </>
  );
}

/** Renders the password reset request form used by `/forgot-password`. */
export function ForgotPasswordView({ instanceName }) {
  return (
    <>
      <p class="eyebrow">Password</p>
      <h1>Reset password</h1>
      <p class="lede">Enter the email address for your {instanceName || "QuietCollective"} account.</p>
      <form class="form" id="forgot-password-form">
        <div class="form-row"><label>Email</label><input name="email" type="email" required /></div>
        <button class="button primary" type="submit">Send reset link</button>
      </form>
      <p class="description"><a href="/login" data-link>Back to login</a></p>
    </>
  );
}

/** Renders the password reset completion form used by `/reset-password/:token`. */
export function ResetPasswordView() {
  return (
    <>
      <p class="eyebrow">Password</p>
      <h1>Choose a new password</h1>
      <form class="form" id="reset-password-form">
        <div class="form-row"><label>New password</label><input name="password" type="password" required minLength={10} /></div>
        <button class="button primary" type="submit">Update password</button>
      </form>
    </>
  );
}

/** Renders the forced password change gate used by `/force-password-change`. */
export function ForcePasswordChangeView() {
  return (
    <section class="view narrow">
      <div class="view-header"><div><p class="eyebrow">Account</p><h1>Password change required</h1><p class="lede">Update your password before continuing.</p></div></div>
      <section class="panel"><div class="panel-body">
        <form class="form" id="force-password-form">
          <div class="form-row"><label>Current password</label><input name="current_password" type="password" required /></div>
          <div class="form-row"><label>New password</label><input name="new_password" type="password" required minLength={10} /></div>
          <button class="button primary" type="submit">Update password</button>
        </form>
      </div></section>
    </section>
  );
}

/** Renders the server rules acceptance gate used by `/rules/accept`. */
export function RulesAcceptView({ rules }) {
  const current = rules?.current || null;
  const previous = rules?.previous_accepted || null;
  return (
    <section class="view narrow">
      <div class="view-header"><div><p class="eyebrow">Server rules</p><h1>Review and accept</h1><p class="lede">You need to accept the current server rules before posting or interacting.</p></div></div>
      <section class="panel">
        <div class="panel-body">
          {current ? <div class="markdown-body rules-body" dangerouslySetInnerHTML={{ __html: current.body_html || renderMarkdown(current.body_markdown) }} /> : <p class="description">No server rules have been published.</p>}
          {previous && previous.id !== current?.id ? (
            <details class="rule-history">
              <summary>Previous version you accepted</summary>
              <div class="markdown-body" dangerouslySetInnerHTML={{ __html: previous.body_html || renderMarkdown(previous.body_markdown) }} />
            </details>
          ) : null}
          <form class="form" id="rules-accept-form">
            <label class="check-row"><input type="checkbox" name="accept" required /> I agree to follow these server rules.</label>
            <button class="button primary" type="submit" disabled={!current}>Accept rules</button>
          </form>
        </div>
      </section>
    </section>
  );
}
