// @ts-nocheck
import { GalleryAccessChips } from "../components/gallery-tile";
import { Icon } from "../components/icon";
import { ProtectedImage } from "../components/protected-image";
import { encodePath, formatDate, relativeTime } from "../lib/utils";
import { renderMarkdown } from "../lib/markdown";

function Empty({ message }) {
  return <div class="empty-state">{message}</div>;
}

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

function RawInline({ html }) {
  return <span dangerouslySetInnerHTML={{ __html: html || "" }} />;
}

function MarkdownHint() {
  return <span class="field-hint">Markdown supported. Use @handle to mention members and #tag to tag ideas.</span>;
}

function CollaboratorLabel({ collab }) {
  if (collab.linked_handle) return <a href={`/members/${encodePath(collab.linked_handle)}`} data-link>@{collab.linked_handle}</a>;
  return <>{collab.display_name || "collaborator"}</>;
}

/** Picks the gallery context used by the work detail route and work breadcrumbs. */
export function currentWorkGallery(work, galleryId = "") {
  const galleries = work.galleries || [];
  if (galleryId) {
    const requested = galleries.find((gallery) => gallery.id === galleryId);
    if (requested) return requested;
  }
  return galleries[0] || { id: work.gallery_id, title: work.gallery_title || "Gallery" };
}

/** Renders the crosspost explanation shown on work detail pages. */
export function WorkCrosspostNotice({ work, currentGallery }) {
  const galleries = work.galleries || [];
  const origin = galleries.find((gallery) => gallery.id === work.gallery_id);
  const current = currentGallery || currentWorkGallery(work);
  const crossposted = galleries.length > 1 || (current?.id && work.gallery_id && current.id !== work.gallery_id);
  if (!crossposted) return null;

  const currentLabel = current?.id ? <a href={`/galleries/${current.id}`} data-link>{current.title || "this gallery"}</a> : "this gallery";
  if (origin && current?.id && origin.id !== current.id) {
    return <div class="notice compact work-crosspost-notice">This image was crossposted from <a href={`/galleries/${origin.id}`} data-link>{origin.title}</a> to {currentLabel}.</div>;
  }
  if (!origin && current?.id && work.gallery_id && current.id !== work.gallery_id) {
    return <div class="notice compact work-crosspost-notice">This image was crossposted from another gallery to {currentLabel}.</div>;
  }

  const otherGalleries = galleries.filter((gallery) => gallery.id !== origin?.id);
  if (otherGalleries.length) {
    return <div class="notice compact work-crosspost-notice">This image is also crossposted in {otherGalleries.map((gallery, index) => <>{index ? ", " : ""}<a href={`/galleries/${gallery.id}`} data-link>{gallery.title}</a></>)}.</div>;
  }
  return null;
}

/** Renders the collaborator cards shown on the work detail route. */
export function WorkCollaboratorsPanel({ collaborators }) {
  return (
    <Panel title="Collaborators">
      {(collaborators || []).length
        ? collaborators.map((collab) => <article class="comment-card" key={collab.id || `${collab.display_name}-${collab.role_label}`}><h3 class="card-title"><CollaboratorLabel collab={collab} /></h3><p class="description">{collab.role_label || "collaborator"}</p></article>)
        : <Empty message="No collaborators credited yet." />}
    </Panel>
  );
}

/** Renders the pulsing feedback-request flag shown in the work detail toolbar. */
function FeedbackRequestAction({ id, work }) {
  if (!work.feedback_requested) return null;
  const prompt = String(work.feedback_prompt || "").trim().replace(/\s+/g, " ");
  const title = prompt ? `Feedback requested: ${prompt}` : "Feedback requested: this work is asking for critique.";
  const canClear = work.capabilities?.comment || work.capabilities?.edit;
  return (
    <button
      class="feedback-indicator feedback-action-flag"
      type="button"
      data-feedback-request-modal={id}
      data-feedback-can-clear={canClear ? "true" : "false"}
      data-feedback-prompt={prompt}
      title={title}
      aria-label={title}
    >
      <Icon name="flag" />
    </button>
  );
}

/** Renders the work detail route including media, actions, collaborators, and comments. */
export function WorkDetailView({ id, work, gallery, commentsHtml, reactionButtonHtml, collaborators }) {
  const version = work.current_version;
  const removeFromGallery = (work.galleries || []).length > 1 && gallery?.id;
  const afterDelete = `/galleries/${gallery.id}`;
  return (
    <section class="view work-view">
      <div class="view-header">
        <div>
          <p class="eyebrow"><a href={`/galleries/${gallery.id}`} data-link>{gallery.title}</a></p>
          <h1>{work.title}</h1>
          <div class="lede markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(work.description || "") }} />
          <div class="gallery-access-inline"><GalleryAccessChips gallery={gallery} className="is-inline" /></div>
          <div class="badge-row"><span class="badge">image</span></div>
        </div>
        <div class="toolbar">
          <RawInline html={reactionButtonHtml} />
          <FeedbackRequestAction id={id} work={work} />
          <a href={`/works/${id}/versions`} class="button" data-link>Versions</a>
          {work.capabilities.edit ? <><a href={`/works/${id}/edit`} class="button primary" data-link>Edit</a><button class="button warn" data-delete-work={id} data-delete-work-gallery={removeFromGallery ? gallery.id : undefined} data-after-delete={afterDelete}>{removeFromGallery ? "Remove from gallery" : "Delete"}</button></> : null}
        </div>
      </div>
      {version?.preview_url ? <div class="media-frame"><ProtectedImage src={version.preview_url} alt={work.title} /></div> : <Empty message="No image version is available." />}
      <WorkCrosspostNotice work={work} currentGallery={gallery} />
      <div class="grid two">
        <WorkCollaboratorsPanel collaborators={collaborators} />
        <RawHtml html={commentsHtml} />
      </div>
    </section>
  );
}

function ExistingCollaborators({ collaborators, workId }) {
  if (!collaborators?.length) return <Empty message="No collaborators credited yet." />;
  return (
    <div class="collaborator-list">
      {collaborators.map((collab) => (
        <div class="collaborator-list-row" key={collab.id}>
          <span><CollaboratorLabel collab={collab} /></span>
          <strong>{collab.role_label || "collaborator"}</strong>
          <button class="button ghost" type="button" data-remove-collaborator={collab.id} data-work-id={workId}>Remove</button>
        </div>
      ))}
    </div>
  );
}

/** Renders the edit route for work metadata, crossposting, collaborators, and versions. */
export function WorkEditView({ id, work, collaborators, crosspostOptions, collaboratorRowsHtml }) {
  const afterDelete = work.galleries?.[0]?.id ? `/galleries/${work.galleries[0].id}` : "/galleries";
  return (
    <section class="view">
      <div class="view-header">
        <div><p class="eyebrow">Edit image</p><h1>{work.title}</h1></div>
        <div class="toolbar">
          <button class={`button feedback-toggle ${work.feedback_requested ? "is-active" : ""}`} data-toggle-feedback={id} data-feedback-requested={work.feedback_requested ? "true" : "false"}><Icon name="flag" /><span>{work.feedback_requested ? "Clear feedback request" : "Request feedback"}</span></button>
          <button class="button warn" data-delete-work={id} data-after-delete={afterDelete}>Delete</button>
        </div>
      </div>
      <div class="grid two">
        <Panel title="Details">
          <form class="form" id="work-edit-form">
            <div class="form-row"><label>Title</label><input name="title" defaultValue={work.title} required /></div>
            <div class="form-row"><label>Description</label><textarea name="description" data-markdown-editor data-target-type="work" data-target-id={id} defaultValue={work.description || ""} /><MarkdownHint /></div>
            <button class="button primary" type="submit">Save work</button>
          </form>
          <hr />
          <form class="form" id="crosspost-form">
            <div class="form-row">
              <label>Galleries</label>
              <div class="collaborator-list">
                {(work.galleries || []).map((gallery) => (
                  <div class="collaborator-list-row" key={gallery.id}>
                    <span><a href={`/galleries/${gallery.id}`} data-link>{gallery.title}</a></span>
                    <strong>{relativeTime(gallery.updated_at || gallery.created_at)}</strong>
                    {(work.galleries || []).length > 1 ? <button class="button ghost" type="button" data-remove-work-gallery={gallery.id}>Remove</button> : null}
                  </div>
                ))}
              </div>
            </div>
            <div class="form-row"><label>Crosspost to gallery</label><select name="gallery_id"><option value="">Choose a gallery</option>{(crosspostOptions || []).map((gallery) => <option value={gallery.id} key={gallery.id}>{gallery.title}</option>)}</select></div>
            <button class="button" type="submit">Add to gallery</button>
          </form>
          <hr />
          <div class="form-row"><label>Collaborators</label><ExistingCollaborators collaborators={collaborators || []} workId={id} /></div>
          <form class="form" id="collab-form"><div class="form-row"><label>Add collaborator</label><RawHtml html={collaboratorRowsHtml} /></div><button class="button" type="submit">Add collaborator</button></form>
        </Panel>
        <Panel title="New Version">
          <form class="form" id="version-form">
            <label class="drop-zone" for="version-file" data-drop-zone>
              <input id="version-file" name="file" type="file" accept="image/*" capture="environment" required />
              <span>Drop a replacement image here, choose a file, or use the camera on mobile.</span>
              <strong data-file-name>No image selected</strong>
            </label>
            <button class="button primary" type="submit">Create version</button>
          </form>
        </Panel>
      </div>
    </section>
  );
}

/** Renders the work version list shown by the `/works/:id/versions` route. */
export function WorkVersionsView({ id, work, versions }) {
  return (
    <section class="view">
      <div class="view-header"><div><p class="eyebrow">Versions</p><h1>{work.title}</h1></div><div class="toolbar"><a href={`/works/${id}`} class="button" data-link>Back to work</a></div></div>
      <div class="grid">
        {(versions || []).length
          ? versions.map((version) => <article class="version-card" key={version.id}><h3 class="card-title">Version {version.version_number}</h3><div class="meta-row">{formatDate(version.created_at)}</div><div class="toolbar">{version.original_url ? <a href={version.original_url} class="button">Original</a> : null}{version.preview_url ? <a href={version.preview_url} class="button">Preview</a> : null}</div></article>)
          : <Empty message="No versions yet." />}
      </div>
    </section>
  );
}
