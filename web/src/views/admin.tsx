// @ts-nocheck
import { renderMarkdown } from "../lib/markdown";
import { activeLabel } from "../lib/utils";

/** Shared admin panel frame used by every admin dashboard section. */
function Panel({ title, children, extra = "" }) {
  return (
    <section class={`panel ${extra}`}>
      <div class="panel-header"><h2>{title}</h2></div>
      <div class="panel-body">{children}</div>
    </section>
  );
}

/** Small empty-state message used inside admin lists. */
function Empty({ message }) {
  return <div class="empty-state">{message}</div>;
}

function settingValue(settings, key, fallback = "") {
  return settings?.values?.[key] ?? settings?.[key] ?? fallback;
}

/** Renders instance identity controls used from the admin dashboard. */
function BrandingPanel({ settings, instance }) {
  return (
    <Panel title="Branding">
      <form class="form" id="settings-form">
        <div class="form-row"><label>Instance name</label><input name="instance_name" defaultValue={settingValue(settings, "instance_name", instance.name)} /></div>
        <div class="form-row"><label>Installable app name</label><input name="app_name" defaultValue={settingValue(settings, "app_name", instance.app_name || instance.name)} /></div>
        <div class="form-row"><label>Short app name</label><input name="app_short_name" maxLength="24" defaultValue={settingValue(settings, "app_short_name", instance.app_short_name || "QC")} /></div>
        <div class="grid two compact-grid">
          <div class="form-row"><label>Theme color</label><input name="app_theme_color" type="color" defaultValue={settingValue(settings, "app_theme_color", instance.app_theme_color || "#050505")} /></div>
          <div class="form-row"><label>Launch background</label><input name="app_background_color" type="color" defaultValue={settingValue(settings, "app_background_color", instance.app_background_color || "#050505")} /></div>
        </div>
        <div class="form-row"><label>Source code URL</label><input name="source_code_url" defaultValue={settingValue(settings, "source_code_url", instance.source_code_url || "")} /></div>
        <div class="form-row"><label>Site logo</label><input name="logo" type="file" accept="image/*" /></div>
        <div class="form-row"><label>App icon</label><input name="app_icon" type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" /><span class="field-hint">Square 512x512 PNG works best.</span></div>
        <div class="form-row"><label>Maskable app icon</label><input name="app_maskable_icon" type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" /><span class="field-hint">Use extra padding so launchers can crop it safely.</span></div>
        <button class="button primary" type="submit">Save branding</button>
      </form>
    </Panel>
  );
}

/** Renders editable high-level copy and email template controls. */
function ContentPanel({ settings, instance }) {
  return (
    <Panel title="Site Text and Messages">
      <form class="form" id="content-form">
        <div class="form-row"><label>Home subtitle</label><textarea name="homepage_subtitle" rows="2" defaultValue={settingValue(settings, "homepage_subtitle", instance.homepage_subtitle || "")} /></div>
        <div class="form-row"><label>Login subtitle</label><textarea name="login_subtitle" rows="2" defaultValue={settingValue(settings, "login_subtitle", instance.login_subtitle || "")} /></div>
        <div class="form-row"><label>Invite subtitle</label><textarea name="invite_subtitle" rows="2" defaultValue={settingValue(settings, "invite_subtitle", instance.invite_subtitle || "")} /></div>
        <div class="form-row"><label>Content notice</label><textarea name="content_notice" rows="2" defaultValue={settingValue(settings, "content_notice", instance.content_notice || "")} /></div>
        <div class="form-row"><label>Invite link text</label><textarea name="invite_text_template" rows="3" defaultValue={settingValue(settings, "invite_text_template", "Welcome to my {{instance_name}} community. Use this invite link: {{invite_url}}")} /></div>
        <div class="form-row"><label>Welcome email subject</label><input name="welcome_email_subject" defaultValue={settingValue(settings, "welcome_email_subject", "Welcome to {{instance_name}}")} /></div>
        <div class="form-row"><label>Welcome email body</label><textarea name="welcome_email_body" rows="5" defaultValue={settingValue(settings, "welcome_email_body", "Hi {{handle}},\n\nWelcome to {{instance_name}}. You can sign in at {{site_url}}.")} /></div>
        <div class="form-row"><label>Reset email subject</label><input name="password_reset_email_subject" defaultValue={settingValue(settings, "password_reset_email_subject", "Reset your {{instance_name}} password")} /></div>
        <div class="form-row"><label>Reset email body</label><textarea name="password_reset_email_body" rows="5" defaultValue={settingValue(settings, "password_reset_email_body", "Hi {{handle}},\n\nUse this link to reset your password:\n\n{{reset_url}}\n\nThis link expires in one hour.")} /></div>
        <button class="button primary" type="submit">Save text</button>
      </form>
    </Panel>
  );
}

/** Renders SMTP configuration and test controls. */
function EmailPanel({ settings }) {
  const enabled = !!settingValue(settings, "smtp_enabled", false);
  return (
    <Panel title="SMTP Email">
      <form class="form" id="email-form">
        <label class="check-row"><input name="smtp_enabled" type="checkbox" value="1" defaultChecked={enabled} /> Enable SMTP delivery</label>
        <div class="form-row"><label>Host</label><input name="smtp_host" defaultValue={settingValue(settings, "smtp_host", "")} /></div>
        <div class="form-row"><label>Port</label><input name="smtp_port" inputMode="numeric" defaultValue={settingValue(settings, "smtp_port", "465")} /></div>
        <div class="form-row"><label>Username</label><input name="smtp_username" defaultValue={settingValue(settings, "smtp_username", "")} /></div>
        <div class="form-row"><label>Password</label><input name="smtp_password" type="password" placeholder={settingValue(settings, "smtp_password_set", false) ? "Password is saved" : ""} /></div>
        <div class="form-row"><label>From email</label><input name="smtp_from_email" type="email" defaultValue={settingValue(settings, "smtp_from_email", "")} /></div>
        <div class="form-row"><label>Reply-to</label><input name="smtp_reply_to" type="email" defaultValue={settingValue(settings, "smtp_reply_to", "")} /></div>
        <button class="button primary" type="submit">Save SMTP</button>
      </form>
      <form class="form compact-form" id="email-test-form">
        <div class="form-row"><label>Send test to</label><input name="to" type="email" /></div>
        <button class="button" type="submit">Send test</button>
      </form>
    </Panel>
  );
}

/** Renders one user admin row with role, lockout, and password actions. */
function UserAdminCard({ user }) {
  const disabled = !!user.disabled_at;
  return (
    <article class={`member-card admin-user-card ${disabled ? "is-disabled" : ""}`}>
      <div>
        <h3 class="card-title">@{user.handle}</h3>
        <p class="description">{user.email}</p>
        <p class="description">{user.role}{disabled ? " - locked out" : ""}{user.password_change_required ? " - password change required" : ""}</p>
        <p class="member-active">{activeLabel(user.last_active_at)}</p>
      </div>
      <div class="toolbar">
        <button class="button small" type="button" data-admin-role={user.id} data-role={user.role === "admin" ? "member" : "admin"}>{user.role === "admin" ? "Make member" : "Make admin"}</button>
        {disabled
          ? <button class="button small" type="button" data-admin-enable={user.id}>Unlock</button>
          : <button class="button small warn" type="button" data-admin-disable={user.id}>Lock out</button>}
        <button class="button small" type="button" data-admin-force-password={user.id}>Force password change</button>
        <button class="button small" type="button" data-admin-reset-password={user.id}>Reset link</button>
      </div>
    </article>
  );
}

/** Renders the member administration list on the admin dashboard. */
function UsersPanel({ users }) {
  return (
    <Panel title="Users">
      <div class="admin-user-list">{(users || []).length ? users.map((user) => <UserAdminCard user={user} key={user.id} />) : <Empty message="No users yet." />}</div>
    </Panel>
  );
}

/** Renders versioned server-rule publishing and acceptance tracking. */
function RulesPanel({ rules }) {
  const current = rules?.current || null;
  return (
    <Panel title="Server Rules">
      <form class="form" id="rules-form">
        <div class="form-row"><label>Current rules</label><textarea name="body_markdown" rows="10" data-markdown-editor data-editor-min-height="220px" defaultValue={current?.body_markdown || ""} /></div>
        <button class="button primary" type="submit">Publish new version</button>
      </form>
      <div class="rule-version-list">
        {(rules?.versions || []).length ? rules.versions.map((rule) => (
          <article class="rule-version-card" key={rule.id}>
            <h3 class="card-title">{rule.superseded_at ? "Previous version" : "Current version"}</h3>
            <p class="description">Published {activeLabel(rule.published_at)} by @{rule.created_by_handle || "admin"} - {rule.accepted_count || 0} accepted</p>
            <details><summary>Preview</summary><div class="markdown-body" dangerouslySetInnerHTML={{ __html: rule.body_html || renderMarkdown(rule.body_markdown) }} /></details>
          </article>
        )) : <Empty message="No server rules have been published." />}
      </div>
    </Panel>
  );
}

/** Renders the instance admin dashboard used by `/admin`. */
export function AdminView({ admin, settings, users, instance, rules }) {
  const tabs = [
    ["branding", "Branding"],
    ["text", "Text"],
    ["rules", "Rules"],
    ["users", "Users"],
    ["email", "Email"],
  ];
  return (
    <section class="view admin-view">
      <div class="view-header"><div><p class="eyebrow">Admin</p><h1>Instance settings</h1></div><div><a href="/admin/invites" class="button primary" data-link>Invites</a></div></div>
      <div class="stat-grid"><div class="stat"><strong>{admin.members}</strong><span>Members</span></div><div class="stat"><strong>{admin.active_invites}</strong><span>Invites</span></div><div class="stat"><strong>{admin.events}</strong><span>Events</span></div></div>
      <div class="admin-tabs" role="tablist" aria-label="Admin sections">
        {tabs.map(([id, label], index) => (
          <button class="admin-tab-button" type="button" role="tab" aria-selected={index === 0 ? "true" : "false"} data-admin-tab={id} key={id}>{label}</button>
        ))}
      </div>
      <div class="admin-tab-panel" data-admin-tab-panel="branding"><BrandingPanel settings={settings} instance={instance} /></div>
      <div class="admin-tab-panel" data-admin-tab-panel="text">
        <ContentPanel settings={settings} instance={instance} />
      </div>
      <div class="admin-tab-panel" data-admin-tab-panel="rules"><RulesPanel rules={rules} /></div>
      <div class="admin-tab-panel" data-admin-tab-panel="users"><UsersPanel users={users} /></div>
      <div class="admin-tab-panel" data-admin-tab-panel="email"><EmailPanel settings={settings} /></div>
    </section>
  );
}

/** Renders one invite card in the `/admin/invites` route. */
export function InviteCard({ invite }) {
  const usable = !invite.revoked_at && invite.absolute_url;
  return (
    <article class="invite-card">
      <h3 class="card-title">{invite.role_on_join}</h3>
      <p class="description">{invite.revoked_at ? "revoked" : `${invite.use_count}/${invite.max_uses} used`}</p>
      {usable ? <div class="form-row"><label>Link</label><input readOnly value={invite.absolute_url || ""} /></div> : null}
      {usable ? <div class="form-row"><label>Invite text</label><textarea readOnly rows="3" value={invite.invite_text || invite.absolute_url || ""} /></div> : <p class="description">Link text is unavailable for older invites.</p>}
      {!invite.revoked_at ? <button class="button warn" data-revoke={invite.id}>Revoke</button> : null}
    </article>
  );
}

/** Renders the invite management route used by `/admin/invites`. */
export function AdminInvitesView({ invites }) {
  return (
    <section class="view">
      <div class="view-header"><div><p class="eyebrow">Admin</p><h1>Invites</h1></div></div>
      <div class="grid two">
        <Panel title="Create Invite">
          <form class="form" id="invite-create-form">
            <div class="form-row"><label>Max uses</label><input name="max_uses" type="number" min="1" defaultValue="1" /></div>
            <div class="form-row"><label>Expires at</label><input name="expires_at" type="datetime-local" /></div>
            <div class="form-row"><label>Role on join</label><select name="role_on_join"><option value="member">Member</option><option value="admin">Admin</option></select></div>
            <button class="button primary" type="submit">Create invite</button>
          </form>
        </Panel>
        <Panel title="Existing Invites">
          <div class="grid">{(invites || []).length ? invites.map((invite) => <InviteCard invite={invite} key={invite.id} />) : <Empty message="No invites yet." />}</div>
        </Panel>
      </div>
    </section>
  );
}
