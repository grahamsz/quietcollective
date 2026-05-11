import type { Gallery, AccessUser } from "../types";
import { escapeHtml, initials, newestFirst, relativeTime } from "../lib/utils";
import { Icon } from "./icon";
import { ProtectedImage } from "./protected-image";

type GalleryMosaicProps = {
  galleries: Gallery[];
};

type GalleryTileProps = {
  gallery: Gallery;
  index?: number;
};

type GalleryAccessChipsProps = {
  gallery: Gallery;
  className?: string;
};

type AccessKind = "submit" | "view";

function tileRevealStyle(index: number) {
  const delay = Math.round(Math.random() * 140 + (index % 4) * 16);
  return { "--reveal-delay": `${delay}ms` };
}

export function GalleryMosaic({ galleries }: GalleryMosaicProps) {
  return (
    <div class="gallery-mosaic">
      {[...(galleries || [])].sort(newestFirst).map((gallery, index) => (
        <GalleryTile gallery={gallery} index={index} key={gallery.id} />
      ))}
    </div>
  );
}

export function GalleryTile({ gallery, index = 0 }: GalleryTileProps) {
  return (
    <a
      class={`gallery-tile media-reveal ${gallery.cover_image_url ? "" : "is-empty"}`}
      href={`/galleries/${gallery.id}`}
      data-link
      data-media-reveal
      style={tileRevealStyle(index)}
    >
      {gallery.cover_image_url ? (
        <ProtectedImage src={gallery.cover_image_url} alt={gallery.title} />
      ) : (
        <span class="gallery-placeholder">{initials(gallery.title)}</span>
      )}
      <GalleryAccessChips gallery={gallery} />
      <div class="tile-overlay">
        <strong>{gallery.title}</strong>
        <small>{galleryTileMeta(gallery)}</small>
      </div>
    </a>
  );
}

export function galleryTileMeta(gallery: Gallery) {
  const count = Number(gallery.work_count ?? gallery.works_count ?? 0);
  const countLabel = `${count} ${count === 1 ? "work" : "works"}`;
  const updated = relativeTime(gallery.updated_at || gallery.created_at);
  return updated ? `${countLabel}, ${updated}` : countLabel;
}

function galleryOpenToSubmissions(gallery: Gallery = {} as Gallery) {
  return gallery.ownership_type === "whole_server" || !!gallery.whole_server_upload;
}

function galleryVisibleToEveryone(gallery: Gallery = {} as Gallery) {
  return gallery.visibility === "server_public" || galleryOpenToSubmissions(gallery);
}

function accessHandles(users: AccessUser[] = []) {
  return users.slice(0, 2).map((member) => member?.handle ? `@${member.handle}` : "").filter(Boolean);
}

function accessLabel(users: AccessUser[], count: number, everyone: boolean) {
  if (everyone) return "Everyone";
  const handles = accessHandles(users);
  if (!handles.length) return "No one";
  const extra = Math.max(0, Number(count || handles.length) - handles.length);
  return `${handles.join(", ")}${extra ? ` +${extra}` : ""}`;
}

function accessTooltip(users: AccessUser[], count: number, everyone: boolean, verb: string) {
  if (everyone) return `Everyone can ${verb} this gallery.`;
  const handles = accessHandles(users);
  if (!handles.length) return `No explicit members can ${verb} this gallery.`;
  const extra = Math.max(0, Number(count || handles.length) - handles.length);
  const subject = extra
    ? `${handles.join(", ")}, and ${extra} more`
    : handles.length === 2 ? `${handles[0]} and ${handles[1]}` : handles[0];
  return `${subject} can ${verb} this gallery.`;
}

export function galleryAccessSummary(gallery: Gallery = {} as Gallery, kind: AccessKind) {
  const summary = gallery.ownership_summary || {};
  if (kind === "submit") {
    const everyone = galleryOpenToSubmissions(gallery);
    const users = summary.submitters || [];
    const count = Number(summary.submitter_count || users.length);
    return {
      label: accessLabel(users, count, everyone),
      title: accessTooltip(users, count, everyone, "submit to"),
    };
  }
  const everyone = galleryVisibleToEveryone(gallery);
  const users = summary.viewers || [];
  const count = Number(summary.viewer_count || users.length);
  return {
    label: accessLabel(users, count, everyone),
    title: accessTooltip(users, count, everyone, "view"),
  };
}

function GalleryAccessChip({ gallery, kind }: { gallery: Gallery; kind: AccessKind }) {
  const access = galleryAccessSummary(gallery, kind);
  const iconName = kind === "submit" ? "user" : "eye";
  return (
    <span class="gallery-access-chip" title={access.title} aria-label={access.title}>
      <Icon name={iconName} className="tile-icon" />
      <span>{access.label}</span>
    </span>
  );
}

export function GalleryAccessChips({ gallery, className = "" }: GalleryAccessChipsProps) {
  return (
    <span class={`gallery-access-stack${className ? ` ${className}` : ""}`}>
      <GalleryAccessChip gallery={gallery} kind="submit" />
      <GalleryAccessChip gallery={gallery} kind="view" />
    </span>
  );
}

export function GalleryAccessRules({ gallery }: { gallery: Gallery }) {
  const submit = galleryAccessSummary(gallery, "submit");
  const view = galleryAccessSummary(gallery, "view");
  return (
    <div class="gallery-access-rules">
      <h3>Visibility rules</h3>
      <div class="gallery-access-rule-list">
        <div class="gallery-access-rule">
          <Icon name="user" className="tile-icon" />
          <span>
            <strong>{submit.label}</strong>
            <small>{submit.title}</small>
          </span>
        </div>
        <div class="gallery-access-rule">
          <Icon name="eye" className="tile-icon" />
          <span>
            <strong>{view.label}</strong>
            <small>{view.title}</small>
          </span>
        </div>
      </div>
    </div>
  );
}

export function galleryAccessRulesFallback(gallery: Gallery) {
  const submit = galleryAccessSummary(gallery, "submit");
  const view = galleryAccessSummary(gallery, "view");
  return `<div class="gallery-access-rules"><h3>Visibility rules</h3><div class="gallery-access-rule-list"><div class="gallery-access-rule"><span><strong>${escapeHtml(submit.label)}</strong><small>${escapeHtml(submit.title)}</small></span></div><div class="gallery-access-rule"><span><strong>${escapeHtml(view.label)}</strong><small>${escapeHtml(view.title)}</small></span></div></div></div>`;
}
