// @ts-nocheck
import { formatDate } from "../lib/utils";

function Panel({ title, children }) {
  return (
    <section class="panel ">
      <div class="panel-header"><h2>{title}</h2></div>
      <div class="panel-body">{children}</div>
    </section>
  );
}

function RawHtml({ html }) {
  return <div dangerouslySetInnerHTML={{ __html: html || "" }} />;
}

function MarkdownHint() {
  return <span class="field-hint">Markdown supported. Use @handle to mention members and #tag to tag ideas.</span>;
}

function Empty({ message }) {
  return <div class="empty-state">{message}</div>;
}

function profileLinkRows(links = []) {
  const rows = (links || []).map((link) => ({
    site: link?.site || link?.label || link?.title || "",
    url: link?.url || link?.href || (typeof link === "string" ? link : ""),
  }));
  return rows.length ? rows : [{ site: "", url: "" }];
}

/** Renders the profile settings route used by `/me/profile`. */
export function ProfileView({ me, browserNotificationsHtml }) {
  return (
    <section class="view">
      <div class="view-header">
        <div><p class="eyebrow">Profile</p><h1>@{me.handle}</h1></div>
        <div class="toolbar">
          <a href="/me/exports" class="button" data-link>Exports</a>
          <button class="button ghost" type="button" data-logout>Log out</button>
        </div>
      </div>
      <div class="grid two">
        <Panel title="Details">
          <form class="form" id="profile-form">
            <div class="form-row"><label>Handle</label><input name="handle" defaultValue={me.handle} required /></div>
            <div class="form-row"><label>Bio</label><textarea name="bio" data-markdown-editor data-target-type="profile" data-target-id={me.id} defaultValue={me.bio || ""} /><MarkdownHint /></div>
            <div class="form-row">
              <label>Links</label>
              <div class="profile-link-list" data-profile-link-list>
                {profileLinkRows(me.links).map((link, index) => (
                  <div class="profile-link-row" data-profile-link-row key={index}>
                    <input name="link_site" defaultValue={link.site} placeholder="Site" autocomplete="off" />
                    <input name="link_url" type="url" defaultValue={link.url} placeholder="https://example.com" autocomplete="off" />
                    <button class="button ghost" type="button" data-remove-profile-link>Remove</button>
                  </div>
                ))}
              </div>
              <button class="button ghost" type="button" data-add-profile-link>Add link</button>
            </div>
            <button class="button primary" type="submit">Save profile</button>
          </form>
        </Panel>
        <div>
          <RawHtml html={browserNotificationsHtml} />
        </div>
      </div>
    </section>
  );
}

/** Renders a single export job card inside the `/me/exports` route. */
export function ExportCard({ item }) {
  return (
    <article class="export-card">
      <h3 class="card-title">{item.status}</h3>
      <p class="description">
        {formatDate(item.created_at)}
        {item.expires_at && !item.downloaded_at ? ` · expires ${formatDate(item.expires_at)}` : ""}
        {item.downloaded_at ? ` · downloaded ${formatDate(item.downloaded_at)}` : ""}
      </p>
      {item.status === "ready" ? <a href={`/api/exports/${item.id}`} class="button">Download ZIP</a> : null}
    </article>
  );
}

/** Renders the export list and create-export action used by `/me/exports`. */
export function ExportsView({ exports }) {
  return (
    <section class="view">
      <div class="view-header">
        <div><p class="eyebrow">Exports</p><h1>Your data exports</h1><p class="lede">Export ZIPs include JSON data, a works spreadsheet, and high-resolution WebP files. Undownloaded exports are deleted after 7 days.</p></div>
        <div><button class="button primary" data-create-export>Create export</button></div>
      </div>
      <Panel title="Exports">
        <div class="grid">{(exports || []).length ? exports.map((item) => <ExportCard item={item} key={item.id} />) : <Empty message="No exports yet." />}</div>
      </Panel>
    </section>
  );
}
