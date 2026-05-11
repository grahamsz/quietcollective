// @ts-nocheck
import { EventList } from "../components/lists";

function Panel({ title, children }) {
  return (
    <section class="panel ">
      <div class="panel-header"><h2>{title}</h2></div>
      <div class="panel-body">{children}</div>
    </section>
  );
}

function Empty({ message }) {
  return <div class="empty-state">{message}</div>;
}

/** Renders the instance admin dashboard used by `/admin`. */
export function AdminView({ admin, settings, members, events, instance }) {
  return (
    <section class="view">
      <div class="view-header"><div><p class="eyebrow">Admin</p><h1>Instance settings</h1></div><div><a href="/admin/invites" class="button primary" data-link>Invites</a></div></div>
      <div class="stat-grid"><div class="stat"><strong>{admin.members}</strong><span>Members</span></div><div class="stat"><strong>{admin.active_invites}</strong><span>Invites</span></div><div class="stat"><strong>{admin.events}</strong><span>Events</span></div></div>
      <div class="grid two">
        <Panel title="Branding">
          <form class="form" id="settings-form">
            <div class="form-row"><label>Instance name</label><input name="instance_name" defaultValue={settings.name || instance.name} /></div>
            <div class="form-row"><label>Source code URL</label><input name="source_code_url" defaultValue={settings.source_code_url || instance.source_code_url || ""} /></div>
            <div class="form-row"><label>Logo</label><input name="logo" type="file" accept="image/*" /></div>
            <button class="button primary" type="submit">Save settings</button>
          </form>
        </Panel>
        <Panel title="Members">
          <div class="grid">{(members || []).map((member) => <article class="member-card" key={member.id || member.handle}><h3 class="card-title">@{member.handle}</h3><p class="description">{member.role}</p></article>)}</div>
        </Panel>
      </div>
      <Panel title="Recent Instance Events"><EventList events={events || []} /></Panel>
    </section>
  );
}

/** Renders one invite card in the `/admin/invites` route. */
export function InviteCard({ invite }) {
  return (
    <article class="invite-card">
      <h3 class="card-title">{invite.role_on_join}</h3>
      <p class="description">{invite.revoked_at ? "revoked" : `${invite.use_count}/${invite.max_uses} used`}</p>
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
