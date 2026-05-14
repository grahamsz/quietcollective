// @ts-nocheck
import { GalleryMosaic } from "../components/gallery-tile";
import { Icon } from "../components/icon";
import { EventList, MemberMini } from "../components/lists";
import { WorkGrid } from "../components/work-tile";
import { activeLabel, encodePath } from "../lib/utils";
import { renderMarkdown } from "../lib/markdown";

function Empty({ message }) {
  return <div class="empty-state">{message}</div>;
}

function Panel({ title, children, extra = "" }) {
  return (
    <section class={`panel ${extra}`}>
      <div class="panel-header"><h2>{title}</h2></div>
      <div class="panel-body">{children}</div>
    </section>
  );
}

function RawHtml({ html }) {
  return <div dangerouslySetInnerHTML={{ __html: html || "" }} />;
}

function Avatar({ user, className = "avatar" }) {
  if (user?.avatar_url) return <img class={className} src={user.avatar_url} alt="" />;
  const source = user?.handle || user?.display_name || "";
  return <span class={className} aria-hidden="true">{source.slice(0, 2).toUpperCase()}</span>;
}

function GalleryFilterTabs({ activeFilter = "all" }) {
  const tabs = [
    ["all", "All", "/galleries"],
    ["public", "Public", "/galleries?view=public"],
    ["my", "My", "/galleries?view=my"],
  ];
  return (
    <nav class="gallery-filter-tabs" aria-label="Gallery filters">
      {tabs.map(([id, label, href]) => <a href={href} aria-current={activeFilter === id ? "page" : undefined} data-link key={id}>{label}</a>)}
    </nav>
  );
}

function profileLinks(user) {
  return (user?.links || [])
    .map((link) => ({
      site: link?.site || link?.label || link?.title || "",
      url: link?.url || link?.href || (typeof link === "string" ? link : ""),
    }))
    .filter((link) => link.site || link.url);
}

/** Renders the signed-in dashboard used by the `/` route. */
export function HomeView({ instanceName, subtitle, galleries, works, activityEvents, members }) {
  return (
    <section class="view home-view">
      <div class="view-header">
        <div>
          <h1>{instanceName || "QuietCollective"}</h1>
          <p class="lede">{subtitle || "Private image galleries, critique, collaborator credits, and member profiles for logged-in members."}</p>
        </div>
      </div>
      {(galleries || []).length ? <Panel title="Recently Updated Galleries" extra="flush-panel"><GalleryMosaic galleries={galleries.slice(0, 14)} /></Panel> : <Empty message="No visible galleries yet." />}
      {(works || []).length ? <Panel title="Fresh Works" extra="flush-panel"><WorkGrid works={works.slice(0, 18)} /></Panel> : null}
      <div class="home-lower-grid">
        <Panel title="Activity" extra="activity-panel">{(activityEvents || []).length ? <EventList events={activityEvents.slice(0, 18)} /> : <Empty message="No recent visible activity." />}</Panel>
        <Panel title="Members"><div class="member-rail">{(members || []).map((member) => <MemberMini member={member} key={member.id || member.handle} />)}</div></Panel>
      </div>
    </section>
  );
}

/** Renders the gallery index route at `/galleries`. */
export function GalleriesIndexView({ galleries, activeFilter = "all" }) {
  return (
    <section class="view gallery-view">
      <div class="view-header">
        <div>
          <p class="eyebrow">Galleries</p>
          <h1>Browse galleries</h1>
        </div>
        <div class="toolbar">
          <GalleryFilterTabs activeFilter={activeFilter} />
          <a href="/galleries/new" class="button primary square-button" data-link aria-label="New gallery" title="New gallery"><Icon name="plus" /><span class="sr-only">New gallery</span></a>
        </div>
      </div>
      {(galleries || []).length ? <GalleryMosaic galleries={galleries} /> : <Empty message="No visible galleries yet." />}
    </section>
  );
}

/** Renders the member directory route at `/members`. */
export function MembersIndexView({ members }) {
  return (
    <section class="view">
      <div class="view-header"><div><p class="eyebrow">Members</p><h1>Community members</h1></div></div>
      <div class="card-grid">{(members || []).length ? members.map((member) => <MemberMini member={member} key={member.id || member.handle} />) : <Empty message="No members yet." />}</div>
    </section>
  );
}

/** Renders a member profile route and its profile comment panel. */
export function MemberProfileView({ user, commentsHtml, works }) {
  const links = profileLinks(user);
  return (
    <section class="view">
      <div class="profile-head">
        <Avatar user={user} className="avatar-lg" />
        <div>
          <p class="eyebrow">Member</p>
          <h1>@{user.handle}</h1>
          <p class="member-active">{activeLabel(user.last_active_at)}</p>
        </div>
      </div>
      {(works || []).length ? <Panel title="Recent Work" extra="flush-panel"><WorkGrid works={works} profileHandle={user.handle} /></Panel> : null}
      <div class="grid two">
        <Panel title="Profile">
          <div class="description markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(user.bio || "No bio yet.") }} />
          {links.length ? (
            <div class="profile-public-links">
              {links.map((link, index) => (
                <a href={link.url} target="_blank" rel="noreferrer" key={`${link.url}-${index}`}>
                  <strong>{link.site || link.url}</strong>
                  {link.site && link.url ? <span>{link.url}</span> : null}
                </a>
              ))}
            </div>
          ) : null}
        </Panel>
        <RawHtml html={commentsHtml} />
      </div>
    </section>
  );
}

/** Renders the tag detail route for works, galleries, members, and comments. */
export function TagPageView({ data, commentsHtml }) {
  return (
    <section class="view">
      <div class="view-header"><div><p class="eyebrow">Tag</p><h1>#{data.tag}</h1><p class="lede">Photos, galleries, members, and visible comments using this tag.</p></div></div>
      {data.works?.length ? <Panel title="Photos" extra="flush-panel"><WorkGrid works={data.works} tag={data.tag} /></Panel> : <Empty message="No visible photos use this tag yet." />}
      <div class="home-lower-grid">
        <Panel title="Galleries" extra="flush-panel">{data.galleries?.length ? <GalleryMosaic galleries={data.galleries} /> : <Empty message="No galleries use this tag." />}</Panel>
        <Panel title="Members">{data.members?.length ? <div class="member-rail">{data.members.map((member) => <MemberMini member={member} key={member.id || member.handle} />)}</div> : <Empty message="No members use this tag." />}</Panel>
      </div>
      <Panel title="Comments">{data.comments?.length ? <RawHtml html={commentsHtml} /> : <Empty message="No visible comments use this tag." />}</Panel>
    </section>
  );
}
