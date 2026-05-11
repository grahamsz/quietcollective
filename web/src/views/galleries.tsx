// @ts-nocheck
import { GalleryAccessChips, GalleryAccessRules } from "../components/gallery-tile";
import { Icon } from "../components/icon";
import { ProtectedImage } from "../components/protected-image";
import { WorkGrid } from "../components/work-tile";
import { initials } from "../lib/utils";
import { renderMarkdown } from "../lib/markdown";

function Markdown({ source, fallback = "" }) {
  return <div class="lede markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(source || fallback) }} />;
}

function RawHtml({ html }) {
  return <div dangerouslySetInnerHTML={{ __html: html || "" }} />;
}

function Empty({ message }) {
  return <div class="empty-state">{message}</div>;
}

function Panel({ title, children, extra = "" }) {
  return (
    <section class={`panel ${extra}`}>
      <div class="panel-header">
        <h2>{title}</h2>
      </div>
      <div class="panel-body">{children}</div>
    </section>
  );
}

function GalleryChoiceHelp({ type, value }) {
  const help = type === "ownership"
    ? value === "whole_server"
      ? "Everyone ownership lets any logged-in member add images. Gallery settings are limited to the gallery owner and managers."
      : value === "collaborative"
        ? "Collaborative galleries are meant for invited collaborators. Add members who can upload, edit, or manage collaborators."
        : "Individual galleries are controlled by you. You can still invite people to view or comment."
    : value === "server_public"
      ? "Everyone means any logged-in member of this instance can view it. It is never anonymous public web access."
      : "Private means only you, explicitly added gallery members, and admins can view it.";
  return <span class="field-hint choice-hint" data-ownership-help={type === "ownership" ? "" : undefined} data-visibility-help={type === "visibility" ? "" : undefined}>{help}</span>;
}

function MarkdownHint() {
  return <span class="field-hint">Markdown supported. Use @handle to mention members and #tag to tag ideas.</span>;
}

/** TSX block for the `/galleries/new` form; submitted by `pages/galleries.ts`. */
export function NewGalleryView() {
  return (
    <section class="view">
      <div>
        <p class="eyebrow">Gallery</p>
        <h1>New gallery</h1>
        <p class="lede">Galleries are private by default. Everyone visibility means logged-in members only.</p>
      </div>
      <Panel title="Details">
        <form class="form" id="gallery-form">
          <div class="form-row">
            <label>Title</label>
            <input name="title" required />
          </div>
          <div class="form-row">
            <label>Description</label>
            <textarea name="description" data-markdown-editor />
            <MarkdownHint />
          </div>
          <div class="form-row">
            <label>Ownership</label>
            <select name="ownership_type">
              <option value="self">Individual</option>
              <option value="collaborative">Collaborative</option>
              <option value="whole_server">Everyone</option>
            </select>
            <GalleryChoiceHelp type="ownership" value="self" />
          </div>
          <div class="form-row">
            <label>Visibility</label>
            <select name="visibility">
              <option value="private">Private</option>
              <option value="server_public">Everyone</option>
            </select>
            <GalleryChoiceHelp type="visibility" value="private" />
          </div>
          <button class="button primary" type="submit">Create gallery</button>
        </form>
      </Panel>
    </section>
  );
}

function CreateWorkPanel({ galleryId }) {
  return (
    <form class="sr-only" id="work-form" data-gallery-id={galleryId}>
      <input id="work-file-upload" name="file" type="file" accept="image/*" />
      <input id="work-file-camera" name="camera" type="file" accept="image/*" capture="environment" />
      <span data-file-name>No image selected</span>
    </form>
  );
}

function GalleryMemberCard({ member, gallery }) {
  const individualGallery = gallery?.ownership_type === "self" && !gallery?.whole_server_upload;
  const capabilities = ["view", "edit", "upload_work", "comment", "manage_collaborators"]
    .filter((key) => !individualGallery || key === "view" || key === "comment")
    .filter((key) => member[`can_${key}`] || (key === "view" && member.can_view));
  return (
    <article class="member-card">
      <h3 class="card-title">@{member.handle}</h3>
      <p class="description">{member.role_label}</p>
      <div class="badge-row">{capabilities.map((capability) => <span class="badge" key={capability}>{capability}</span>)}</div>
    </article>
  );
}

function GalleryMembersPanel({ gallery, members }) {
  return (
    <>
      {gallery.ownership_type === "whole_server" ? (
        <div class="notice compact">Everyone gallery: any logged-in member can post images here. Gallery settings are limited to the gallery owner and managers.</div>
      ) : null}
      <div class="grid">
        {(members || []).length ? members.map((member) => <GalleryMemberCard member={member} gallery={gallery} key={member.id || member.handle} />) : <Empty message="No explicit gallery members yet." />}
      </div>
    </>
  );
}

/** TSX block for the gallery detail route; `pages/galleries.ts` binds upload/drop/comment behavior. */
export function GalleryDetailView({ id, gallery, works, commentsHtml, members }) {
  const emptyMessage = gallery.capabilities.upload_work
    ? "Drop images here or use the + button to start this gallery."
    : "No works in this gallery yet.";
  return (
    <section class="view gallery-view">
      <div class="view-header">
        <div>
          <p class="eyebrow">Gallery</p>
          <h1>{gallery.title}</h1>
          <Markdown source={gallery.description} fallback="No description" />
          <div class="gallery-access-inline"><GalleryAccessChips gallery={gallery} className="is-inline" /></div>
        </div>
        <div class="toolbar">
          {gallery.capabilities.upload_work ? (
            <button class="button primary square-button" data-show-upload type="button" aria-label="Add to gallery" title="Add to gallery"><Icon name="plus" /></button>
          ) : null}
          {gallery.capabilities.edit ? <a href={`/galleries/${id}/settings`} class="button" data-link>Settings</a> : null}
        </div>
      </div>
      <section class="gallery-drop-surface" data-gallery-drop-surface>
        {(works || []).length ? <WorkGrid works={works} galleryId={id} /> : <Empty message={emptyMessage} />}
      </section>
      {gallery.capabilities.upload_work ? <CreateWorkPanel galleryId={id} /> : null}
      <div class="home-lower-grid">
        <RawHtml html={commentsHtml} />
        <Panel title="Members"><GalleryMembersPanel gallery={gallery} members={members || []} /></Panel>
      </div>
    </section>
  );
}

/** TSX block for the add-to-gallery modal opened from a gallery detail route. */
export function AddToGalleryModalView({ gallery, canCrosspost = false }) {
  return (
    <section class="modal-panel add-menu-modal" role="dialog" aria-modal="true">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Add to gallery</p>
          <h2>{gallery?.title || "Gallery"}</h2>
        </div>
        <button class="icon-button" data-close-modal type="button" aria-label="Close" title="Close"><Icon name="x" /></button>
      </div>
      <div class="panel-body">
        <div class="add-action-grid">
          <button class="add-action" type="button" data-add-action="upload"><Icon name="upload" /><strong>Upload</strong><span>Choose an image file from this device.</span></button>
          <button class="add-action" type="button" data-add-action="camera"><Icon name="camera" /><strong>Camera</strong><span>Take a new image and add the details.</span></button>
          {canCrosspost ? (
            <button class="add-action" type="button" data-add-action="crosspost"><Icon name="send" /><strong>Crosspost</strong><span>Add one of your works or collaborator credits.</span></button>
          ) : null}
        </div>
        <GalleryAccessRules gallery={gallery || {}} />
      </div>
    </section>
  );
}

/** TSX shell for the crosspost modal while eligible works are being fetched. */
export function CrosspostModalShellView({ gallery }) {
  return (
    <section class="modal-panel crosspost-modal" role="dialog" aria-modal="true">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Crosspost</p>
          <h2>{gallery?.title || "Gallery"}</h2>
        </div>
        <button class="icon-button" data-close-modal type="button" aria-label="Close" title="Close"><Icon name="x" /></button>
      </div>
      <div class="panel-body"><Empty message="Loading works..." /></div>
    </section>
  );
}

function CrosspostOption({ work }) {
  const version = work.current_version || {};
  const imageUrl = version.thumbnail_url || version.preview_url;
  const galleries = (work.galleries || []).map((gallery) => gallery.title).join(", ") || "No visible gallery";
  const relationship = work.crosspost?.relationship === "owner" ? "Your work" : "Collaborator credit";
  const warning = work.crosspost?.increases_visibility ? "Visibility change" : "";
  const search = `${work.title || ""} ${work.description || ""} ${galleries} ${relationship}`.toLowerCase();
  return (
    <label class="crosspost-option" data-crosspost-option data-search={search}>
      <input type="radio" name="work_id" value={work.id} data-increases-visibility={work.crosspost?.increases_visibility ? "true" : "false"} />
      <span class="crosspost-thumb">{imageUrl ? <ProtectedImage src={imageUrl} alt={work.title} /> : <span class="image-placeholder">{initials(work.title)}</span>}</span>
      <span class="crosspost-copy">
        <strong>{work.title}</strong>
        <span>{galleries}</span>
        <span class="badge-row">
          <span class="badge">{relationship}</span>
          {warning ? <span class="badge amber">{warning}</span> : null}
        </span>
      </span>
    </label>
  );
}

/** TSX block for the loaded crosspost picker inside the crosspost modal. */
export function CrosspostPickerView({ works, galleryId }) {
  return (
    <form class="form" data-crosspost-form>
      <div class="form-row">
        <label>Find work</label>
        <input type="search" data-crosspost-search placeholder="Search by title or gallery" />
      </div>
      <div class="crosspost-list">{(works || []).map((work) => <CrosspostOption work={work} key={work.id} />)}</div>
      <div class="notice compact warning is-hidden" data-crosspost-warning />
      <label class="checkbox-row is-hidden" data-crosspost-confirm-row>
        <input type="checkbox" name="visibility_confirm" />
        <span>I understand this may increase who can see the selected work.</span>
      </label>
      <div class="toolbar">
        <button class="button ghost" type="button" data-close-modal>Cancel</button>
        <button class="button primary" type="submit" data-target-gallery={galleryId}>Crosspost</button>
      </div>
    </form>
  );
}

/** TSX block for the upload-details modal after a file has been selected. */
export function WorkUploadModalView({ galleryId, previewUrl, title, collaboratorRowsHtml }) {
  return (
    <section class="modal-panel upload-modal" role="dialog" aria-modal="true">
      <div class="panel-header">
        <h2>Add image details</h2>
        <button class="icon-button" data-close-modal type="button" aria-label="Close" title="Close"><Icon name="x" /></button>
      </div>
      <div class="panel-body">
        <div class="upload-preview"><ProtectedImage src={previewUrl} /></div>
        <form class="form" data-upload-details-form>
          <div class="form-row">
            <label>Title</label>
            <input name="title" value={title} placeholder="Defaults to file name" />
          </div>
          <div class="form-row">
            <label>Description</label>
            <textarea name="description" data-markdown-editor data-target-type="gallery" data-target-id={galleryId} />
            <MarkdownHint />
          </div>
          <div class="form-row">
            <label>Collaborators</label>
            <RawHtml html={collaboratorRowsHtml} />
          </div>
          <div class="toolbar">
            <button class="button ghost" type="button" data-close-modal>Cancel</button>
            <button class="button primary" type="submit">Upload image</button>
          </div>
        </form>
      </div>
    </section>
  );
}

/** TSX notice used when a modal request fails. */
export function ModalErrorNotice({ message }) {
  return <div class="notice error">{message}</div>;
}

function GallerySettingsMemberRows({ members }) {
  return (
    <div class="table-wrap">
      <table>
        <thead><tr><th>Member</th><th>Role</th><th>Capabilities</th></tr></thead>
        <tbody>
          {(members || []).map((member) => {
            const capabilities = ["view", "edit", "upload_work", "comment", "manage_collaborators"]
              .filter((key) => member[`can_${key}`] || (key === "view" && member.can_view))
              .join(", ");
            return <tr key={member.id || member.handle}><td>@{member.handle}</td><td>{member.role_label}</td><td>{capabilities}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

/** TSX block for the gallery settings route; saved by `pages/galleries.ts`. */
export function GallerySettingsView({ id, gallery, works, members }) {
  return (
    <section class="view">
      <div>
        <p class="eyebrow">Gallery settings</p>
        <h1>{gallery.title}</h1>
      </div>
      <div class="grid two">
        <Panel title="Details">
          <form class="form" id="gallery-settings-form">
            <div class="form-row">
              <label>Title</label>
              <input name="title" value={gallery.title} required />
            </div>
            <div class="form-row">
              <label>Description</label>
              <textarea name="description" data-markdown-editor data-target-type="gallery" data-target-id={id}>{gallery.description || ""}</textarea>
              <MarkdownHint />
            </div>
            <div class="form-row">
              <label>Ownership</label>
              <select name="ownership_type" value={gallery.ownership_type}>
                <option value="self">Individual</option>
                <option value="collaborative">Collaborative</option>
                <option value="whole_server">Everyone</option>
              </select>
              <GalleryChoiceHelp type="ownership" value={gallery.ownership_type} />
            </div>
            <div class="form-row">
              <label>Visibility</label>
              <select name="visibility" value={gallery.visibility}>
                <option value="private">Private</option>
                <option value="server_public">Everyone</option>
              </select>
              <GalleryChoiceHelp type="visibility" value={gallery.visibility} />
            </div>
            <div class="form-row">
              <label>Gallery preview image</label>
              <select name="cover_version_id" value={gallery.cover_version_id || ""}>
                <option value="">Use fallback</option>
                {(works || []).filter((work) => work.current_version?.thumbnail_url).map((work) => (
                  <option value={work.current_version.id} key={work.current_version.id}>{work.title}</option>
                ))}
              </select>
            </div>
            <button class="button primary" type="submit">Save gallery</button>
          </form>
        </Panel>
        <Panel title="Members"><GallerySettingsMemberRows members={members || []} /></Panel>
      </div>
    </section>
  );
}
