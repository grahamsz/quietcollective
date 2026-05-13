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

function workDetailHref(id, gallery, lightboxContext) {
  if (lightboxContext?.type === "tag" && lightboxContext.value) return `/works/${id}?tag=${encodePath(lightboxContext.value)}`;
  if (lightboxContext?.type === "profile" && lightboxContext.value) return `/works/${id}?profile=${encodePath(lightboxContext.value)}`;
  return `/works/${id}${gallery?.id ? `?gallery=${encodePath(gallery.id)}` : ""}`;
}

function MarkdownHint() {
  return <span class="field-hint">Markdown supported. Use @handle to mention members and #tag to tag ideas.</span>;
}

function CollaboratorLabel({ collab }) {
  if (collab.linked_handle) return <a href={`/members/${encodePath(collab.linked_handle)}`} data-link>@{collab.linked_handle}</a>;
  return <>{collab.display_name || "collaborator"}</>;
}

function CollaboratorValue({ collab }) {
  return collab.linked_handle ? `@${collab.linked_handle}` : collab.display_name || "";
}

function CollaboratorRemoveLabel({ collab }) {
  return CollaboratorValue({ collab }) || "contributor";
}

function creditKey(label) {
  return String(label || "").trim().replace(/^@/, "").toLowerCase();
}

function userCredit(work) {
  const handle = String(work?.created_by_user?.handle || work?.created_by_handle || "").trim();
  const displayName = String(work?.created_by_user?.display_name || "").trim();
  const label = handle ? `@${handle}` : displayName;
  if (!label) return null;
  return {
    kind: "uploader",
    label,
    href: handle ? `/members/${encodePath(handle)}` : "",
    roles: [],
    title: `Uploaded by ${label}`,
  };
}

function collaboratorCredit(collab) {
  const handle = String(collab?.linked_handle || "").trim();
  const displayName = String(collab?.display_name || "").trim();
  const label = handle ? `@${handle}` : displayName;
  if (!label) return null;
  const role = String(collab?.role_label || "").trim();
  return {
    kind: "contributor",
    label,
    href: handle ? `/members/${encodePath(handle)}` : "",
    roles: [role || "contributor"],
    title: role ? `${label}, ${role}` : `${label}, contributor`,
  };
}

function creditTitle(credit, roles) {
  const normalizedRoles = roles.length ? roles : credit.kind === "uploader" ? ["uploader"] : ["contributor"];
  if (credit.kind === "uploader") return `${credit.label}, ${["uploader", ...normalizedRoles].filter((role, index, all) => all.findIndex((value) => value.toLowerCase() === role.toLowerCase()) === index).join(", ")}`;
  return `${credit.label}, ${normalizedRoles.join(", ")}`;
}

function mergeCreditRole(credit, role) {
  const label = String(role || "").trim();
  if (!label) return credit;
  const roles = credit.roles || [];
  if (roles.some((existing) => existing.toLowerCase() === label.toLowerCase())) return credit;
  const mergedRoles = [...roles, label];
  return {
    ...credit,
    roles: mergedRoles,
    title: creditTitle(credit, mergedRoles),
  };
}

function workCredits(work, collaborators) {
  const credits = [];
  const seen = new Map();
  const uploader = userCredit(work);
  if (uploader) {
    credits.push(uploader);
    seen.set(creditKey(uploader.label), 0);
  }
  for (const collab of collaborators || []) {
    const credit = collaboratorCredit(collab);
    const key = creditKey(credit?.label);
    if (!credit || !key) continue;
    if (seen.has(key)) {
      const index = seen.get(key);
      credits[index] = mergeCreditRole(credits[index], collab?.role_label || "contributor");
      continue;
    }
    credits.push(credit);
    seen.set(key, credits.length - 1);
  }
  return credits;
}

function WorkCreditChip({ credit }) {
  const content = (
    <>
      <Icon name={credit.kind === "uploader" ? "upload" : "user"} className="tile-icon" />
      <span>{credit.label}</span>
    </>
  );
  const className = `work-credit-chip is-${credit.kind}`;
  if (credit.href) {
    return <a href={credit.href} class={className} data-link title={credit.title} aria-label={credit.title}>{content}</a>;
  }
  return <span class={className} title={credit.title} aria-label={credit.title}>{content}</span>;
}

function WorkCreditChips({ work, collaborators }) {
  const credits = workCredits(work, collaborators);
  if (!credits.length) return null;
  const visible = credits.slice(0, 4);
  const hidden = credits.slice(4);
  return (
    <span class="work-credit-stack" aria-label="Work credits">
      {visible.map((credit) => <WorkCreditChip credit={credit} key={`${credit.kind}-${credit.label}`} />)}
      {hidden.length ? <span class="work-credit-chip is-overflow" title={hidden.map((credit) => credit.label).join(", ")} aria-label={`${hidden.length} more contributors`}>+{hidden.length}</span> : null}
    </span>
  );
}

function InlineEditButton({ field, label }) {
  return (
    <button class="icon-button ghost inline-edit-button" type="button" data-edit-work-field={field} aria-label={label} title={label}>
      <Icon name="pencil" />
    </button>
  );
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

function WorkTitleEditor({ id, work }) {
  const editable = !!work.capabilities?.edit;
  return (
    <div class="inline-edit-block work-title-edit">
      <div class="work-title-line" data-inline-edit-view="title">
        <h1>{work.title}</h1>
        {editable ? <InlineEditButton field="title" label="Edit title" /> : null}
      </div>
      {editable ? (
        <form class="form inline-edit-form" id="work-title-form" data-inline-edit-form="title" hidden>
          <input type="hidden" name="description" value={work.description || ""} />
          <div class="inline-field-row">
            <input name="title" defaultValue={work.title} required autocomplete="off" data-edit-input />
            <button class="button primary" type="submit">Save</button>
            <button class="button ghost" type="button" data-cancel-inline-edit="title">Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function WorkDescriptionEditor({ id, work }) {
  const editable = !!work.capabilities?.edit;
  return (
    <div class="inline-edit-block work-description-edit">
      <div class="work-description-line" data-inline-edit-view="description">
        <div class="lede markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(work.description || "") }} />
        {editable ? <InlineEditButton field="description" label="Edit description" /> : null}
      </div>
      {editable ? (
        <form class="form inline-edit-form" id="work-description-form" data-inline-edit-form="description" hidden>
          <input type="hidden" name="title" value={work.title} />
          <div class="form-row">
            <textarea name="description" rows="5" defaultValue={work.description || ""} data-edit-input />
            <MarkdownHint />
          </div>
          <div class="toolbar">
            <button class="button primary" type="submit">Save description</button>
            <button class="button ghost" type="button" data-cancel-inline-edit="description">Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** Renders the contributor list shown on the work detail route. */
export function WorkCollaboratorsPanel({ collaborators, workId, editable, collaboratorRowsHtml }) {
  return (
    <Panel title="Contributors">
      <div class="contributors-list">
        <div class="contributor-row contributor-row-head">
          <span>Contributor</span>
          <span>Role</span>
          {editable ? <span>Actions</span> : null}
        </div>
        {(collaborators || []).length
          ? collaborators.map((collab) => (
            <>
              <div class="contributor-row" data-collaborator-view-row={collab.id} key={`${collab.id}-view`}>
                <span><CollaboratorLabel collab={collab} /></span>
                <strong>{collab.role_label || "collaborator"}</strong>
                {editable ? (
                  <div class="toolbar row-actions">
                    <button class="icon-button ghost" type="button" data-edit-collaborator={collab.id} aria-label="Edit contributor" title="Edit contributor"><Icon name="pencil" /></button>
                    <button
                      class="icon-button ghost"
                      type="button"
                      data-remove-collaborator={collab.id}
                      data-remove-collaborator-label={CollaboratorRemoveLabel({ collab })}
                      data-work-id={workId}
                      aria-label={`Remove ${CollaboratorRemoveLabel({ collab })}`}
                      title={`Remove ${CollaboratorRemoveLabel({ collab })}`}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                ) : null}
              </div>
              {editable ? (
                <form class="contributor-row contributor-edit-row" data-collaborator-edit-form={collab.id} data-collaborator-edit-row={collab.id} hidden key={`${collab.id}-edit`}>
                  <input name="collaborator_user" defaultValue={CollaboratorValue({ collab })} placeholder="@handle or credited name" autocomplete="off" required />
                  <input name="role_label" list="detail-work-role-options" defaultValue={collab.role_label || "collaborator"} placeholder="role" />
                  <div class="toolbar row-actions">
                    <button class="icon-button ghost" type="submit" aria-label="Save contributor" title="Save contributor"><Icon name="check" /></button>
                    <button class="icon-button ghost" type="button" data-cancel-collaborator-edit={collab.id} aria-label="Cancel" title="Cancel"><Icon name="x" /></button>
                  </div>
                </form>
              ) : null}
            </>
          ))
          : <div class="contributor-row empty-contributor-row"><span>No contributors credited yet.</span></div>}
        {editable ? (
          <form class="contributor-row contributor-add-row" id="collab-form" hidden>
            <input name="collaborator_user" placeholder="@handle or credited name" autocomplete="off" required />
            <input name="role_label" list="detail-work-role-options" placeholder="role" />
            <div class="toolbar row-actions">
              <button class="icon-button ghost" type="submit" aria-label="Add contributor" title="Add contributor"><Icon name="check" /></button>
              <button class="icon-button ghost" type="button" data-cancel-collaborator-add aria-label="Cancel" title="Cancel"><Icon name="x" /></button>
            </div>
          </form>
        ) : null}
      </div>
      {editable ? (
        <div class="contributor-add-actions">
          <button class="button ghost" type="button" data-show-collaborator-add><Icon name="plus" /><span>Add contributor</span></button>
          <RawHtml html={collaboratorRowsHtml} />
        </div>
      ) : null}
    </Panel>
  );
}

/** Renders the pulsing feedback-request flag shown in the work detail toolbar. */
function FeedbackRequestAction({ id, work }) {
  if (!work.feedback_requested || work.feedback_dismissed) return null;
  const prompt = String(work.feedback_prompt || "").trim().replace(/\s+/g, " ");
  const title = prompt ? `Feedback requested: ${prompt}` : "Feedback requested: this work is asking for critique.";
  return (
    <button
      class="feedback-indicator feedback-action-flag"
      type="button"
      data-feedback-request-modal={id}
      data-feedback-prompt={prompt}
      title={title}
      aria-label={title}
    >
      <Icon name="flag" />
    </button>
  );
}

function FeedbackToggleButton({ id, work }) {
  return (
    <button class={`button feedback-toggle ${work.feedback_requested ? "is-active" : ""}`} type="button" data-toggle-feedback={id} data-feedback-requested={work.feedback_requested ? "true" : "false"} data-feedback-own-work={work.is_owner ? "true" : "false"}>
      <Icon name="flag" />
      <span>{work.feedback_requested ? "Clear feedback request" : "Request feedback"}</span>
    </button>
  );
}

function GalleryPickerOption({ gallery }) {
  const search = `${gallery.title || ""} ${gallery.description || ""} ${gallery.visibility || ""} ${gallery.ownership_type || ""}`.toLowerCase();
  return (
    <label class="gallery-picker-option" data-gallery-picker-option data-search={search}>
      <input type="radio" name="gallery_id" value={gallery.id} />
      <span class="gallery-picker-copy">
        <strong>{gallery.title}</strong>
        {gallery.description ? <span>{gallery.description}</span> : null}
        <GalleryAccessChips gallery={gallery} className="is-inline" />
      </span>
    </label>
  );
}

/** Renders the gallery picker modal opened from a work detail page. */
export function WorkCrosspostGalleryModalView({ work, galleries }) {
  const targets = galleries || [];
  return (
    <section class="modal-panel crosspost-modal" role="dialog" aria-modal="true" aria-labelledby="work-crosspost-title">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Crosspost</p>
          <h2 id="work-crosspost-title">{work?.title || "Work"}</h2>
        </div>
        <button class="icon-button" data-close-modal type="button" aria-label="Close" title="Close"><Icon name="x" /></button>
      </div>
      <div class="panel-body">
        {targets.length ? (
          <form class="form" data-work-crosspost-form>
            <div class="form-row">
              <label>Gallery</label>
              <input type="search" data-gallery-picker-search placeholder="Search galleries" />
            </div>
            <div class="gallery-picker-list">
              {targets.map((gallery) => <GalleryPickerOption gallery={gallery} key={gallery.id} />)}
            </div>
            <div class="toolbar">
              <button class="button ghost" type="button" data-close-modal>Cancel</button>
              <button class="button primary" type="submit">Crosspost</button>
            </div>
          </form>
        ) : <Empty message="No eligible galleries are available." />}
      </div>
    </section>
  );
}

function WorkGalleriesPanel({ id, work, editable, crosspostOptions }) {
  const galleries = work.galleries || [];
  const canOpenCrosspost = !!crosspostOptions?.length;
  return (
    <Panel title="Galleries">
      {galleries.length ? (
        <div class="collaborator-list work-gallery-list">
          {galleries.map((linkedGallery) => (
            <div class="collaborator-list-row" key={linkedGallery.id}>
              <span><a href={`/galleries/${linkedGallery.id}`} data-link>{linkedGallery.title}</a></span>
              <strong>{relativeTime(linkedGallery.updated_at || linkedGallery.created_at)}</strong>
              {editable && galleries.length > 1 ? (
                <button
                  class="icon-button ghost"
                  type="button"
                  data-remove-work-gallery={linkedGallery.id}
                  data-remove-work-gallery-title={linkedGallery.title}
                  aria-label={`Remove from ${linkedGallery.title}`}
                  title={`Remove from ${linkedGallery.title}`}
                >
                  <Icon name="x" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : <Empty message="This image is not posted to a visible gallery." />}
      {work.can_crosspost ? (
        <div class="crosspost-inline-form">
          <button
            class="button"
            type="button"
            data-open-work-crosspost
            disabled={!canOpenCrosspost}
            aria-label="Crosspost to gallery"
            title={canOpenCrosspost ? "Crosspost to gallery" : "No eligible galleries available"}
          >
            <Icon name="send" />
            <span>Crosspost to gallery</span>
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

function WorkVersionUploadPanel({ id, work }) {
  if (!work.can_create_version) return null;
  return (
    <section class="panel work-version-panel" data-version-panel hidden>
      <div class="panel-header"><h2>Add New Version</h2></div>
      <div class="panel-body">
        <form class="form" id="version-form">
          <label class="drop-zone" for="version-file" data-drop-zone>
            <input id="version-file" name="file" type="file" accept="image/*" capture="environment" required />
            <span>Drop a replacement image here, choose a file, or use the camera on mobile.</span>
            <strong data-file-name>No image selected</strong>
          </label>
          <div class="toolbar">
            <button class="button primary" type="submit">Create version</button>
            <button class="button ghost" type="button" data-hide-version-form>Cancel</button>
          </div>
        </form>
      </div>
    </section>
  );
}

function WorkDangerZone({ id, work, gallery }) {
  if (!work.capabilities?.edit) return null;
  const galleries = work.galleries || [];
  const removeFromGallery = galleries.length > 1 && gallery?.id;
  const afterDelete = gallery?.id ? `/galleries/${gallery.id}` : "/galleries";
  return (
    <section class="work-danger-zone">
      <div>
        <h2>Delete</h2>
        <p class="description">{removeFromGallery ? "Remove this image from the current gallery without deleting the image everywhere." : "Delete this image from galleries and feeds."}</p>
      </div>
      <button class="button ghost subtle-danger" type="button" data-delete-work={id} data-delete-work-gallery={removeFromGallery ? gallery.id : undefined} data-after-delete={afterDelete}>
        {removeFromGallery ? "Remove from gallery" : "Delete image"}
      </button>
    </section>
  );
}

/** Renders the work detail route including media, actions, collaborators, and comments. */
export function WorkDetailView({ id, work, gallery, commentsHtml, reactionButtonHtml, collaborators, crosspostOptions, collaboratorRowsHtml, lightboxWorks, lightboxContext }) {
  const version = work.current_version;
  const lightboxItems = (lightboxWorks || [work])
    .map((item) => {
      const itemVersion = item.current_version || {};
      const src = itemVersion.preview_url || itemVersion.thumbnail_url || "";
      return src ? {
        src,
        alt: item.title || "",
        title: item.title || "",
        href: workDetailHref(item.id, gallery, lightboxContext),
        targetType: "work",
        targetId: item.id,
      } : null;
    })
    .filter(Boolean);
  const lightboxIndex = Math.max(0, lightboxItems.findIndex((item) => item.href.startsWith(`/works/${id}`)));
  return (
    <section class="view work-view">
      <div class="view-header">
        <div>
          <p class="eyebrow"><a href={`/galleries/${gallery.id}`} data-link>{gallery.title}</a></p>
          <WorkTitleEditor id={id} work={work} />
          <WorkDescriptionEditor id={id} work={work} />
          <div class="gallery-access-inline">
            <WorkCreditChips work={work} collaborators={collaborators || []} />
            <GalleryAccessChips gallery={gallery} className="is-inline" kinds={["view"]} />
            <span class="work-meta-actions">
              <RawInline html={reactionButtonHtml} />
              <a href={`/works/${id}/versions`} class="button" data-link>Versions</a>
            </span>
          </div>
        </div>
        <div class="toolbar">
          {work.is_owner ? <FeedbackToggleButton id={id} work={work} /> : <FeedbackRequestAction id={id} work={work} />}
          {work.can_create_version ? <button class="button primary" type="button" data-show-version-form><Icon name="upload" /><span>Add New Version</span></button> : null}
        </div>
      </div>
      {version?.preview_url ? (
        <div
          class="media-frame"
          data-lightbox-item="true"
          data-lightbox-src={version.preview_url}
          data-lightbox-title={work.title || undefined}
          data-lightbox-href={workDetailHref(id, gallery, lightboxContext)}
          data-lightbox-target-type="work"
          data-lightbox-target-id={id}
          data-doubletap-heart-type="work"
          data-doubletap-heart-id={id}
          data-lightbox-items={JSON.stringify(lightboxItems)}
          data-lightbox-index={String(lightboxIndex)}
        >
          <ProtectedImage src={version.preview_url} alt={work.title} />
        </div>
      ) : <Empty message="No image version is available." />}
      <WorkVersionUploadPanel id={id} work={work} />
      <WorkCrosspostNotice work={work} currentGallery={gallery} />
      <div class="work-info-stack">
        <WorkCollaboratorsPanel collaborators={collaborators} workId={id} editable={!!work.capabilities?.edit} collaboratorRowsHtml={collaboratorRowsHtml} />
        <WorkGalleriesPanel id={id} work={work} editable={!!work.capabilities?.edit} crosspostOptions={crosspostOptions || []} />
      </div>
      <RawHtml html={commentsHtml} />
      <WorkDangerZone id={id} work={work} gallery={gallery} />
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
          <button
            class="icon-button ghost"
            type="button"
            data-remove-collaborator={collab.id}
            data-remove-collaborator-label={CollaboratorRemoveLabel({ collab })}
            data-work-id={workId}
            aria-label={`Remove ${CollaboratorRemoveLabel({ collab })}`}
            title={`Remove ${CollaboratorRemoveLabel({ collab })}`}
          >
            <Icon name="x" />
          </button>
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
          {work.is_owner ? <button class={`button feedback-toggle ${work.feedback_requested ? "is-active" : ""}`} type="button" data-toggle-feedback={id} data-feedback-requested={work.feedback_requested ? "true" : "false"} data-feedback-own-work="true"><Icon name="flag" /><span>{work.feedback_requested ? "Clear feedback request" : "Request feedback"}</span></button> : null}
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
                    {(work.galleries || []).length > 1 ? (
                      <button
                        class="icon-button ghost"
                        type="button"
                        data-remove-work-gallery={gallery.id}
                        data-remove-work-gallery-title={gallery.title}
                        aria-label={`Remove from ${gallery.title}`}
                        title={`Remove from ${gallery.title}`}
                      >
                        <Icon name="x" />
                      </button>
                    ) : null}
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
          ? versions.map((version) => {
            const thumb = version.preview_url || version.thumbnail_url || "";
            return (
              <article class="version-card" key={version.id}>
                {thumb ? <div class="version-thumb"><ProtectedImage src={thumb} alt={`Version ${version.version_number}`} /></div> : null}
                <h3 class="card-title">Version {version.version_number}</h3>
                <div class="meta-row">{formatDate(version.created_at)}</div>
                <div class="toolbar">{version.original_url ? <a href={version.original_url} class="button">Original</a> : null}{version.preview_url ? <a href={version.preview_url} class="button">Preview</a> : null}</div>
              </article>
            );
          })
          : <Empty message="No versions yet." />}
      </div>
    </section>
  );
}
