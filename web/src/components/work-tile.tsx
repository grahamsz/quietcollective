import type { Work } from "../types";
import { encodePath, initials, newestFirst, relativeTime } from "../lib/utils";
import { Icon } from "./icon";
import { ProtectedImage } from "./protected-image";

type WorkGridProps = {
  works: Work[];
  galleryId?: string;
};

type WorkTileProps = {
  work: Work;
  index?: number;
  galleryId?: string;
};

function tileRevealStyle(index: number) {
  const delay = Math.round(Math.random() * 140 + (index % 4) * 16);
  return { "--reveal-delay": `${delay}ms` };
}

/** Displays the feedback-requested flag used on work tiles in grids and feeds. */
function FeedbackRequestedIndicator({ work }: { work: Work }) {
  if (!work.feedback_requested) return null;
  const prompt = String(work.feedback_prompt || "").trim().replace(/\s+/g, " ");
  const title = prompt ? `Feedback requested: ${prompt}` : "Feedback requested: this work is asking for critique.";
  return (
    <span class="tile-status">
      <span class="feedback-indicator" title={title} aria-label={title}>
        <Icon name="flag" />
      </span>
    </span>
  );
}

/** Displays the creator/collaborator username pill at the top of a work tile. */
function WorkAuthorPill({ work }: { work: Work }) {
  const handle = work.created_by_user?.handle || work.created_by_handle || "";
  if (!handle) return null;
  const title = `Uploaded by @${handle}`;
  return (
    <span class="work-author-pill" title={title} aria-label={title}>
      <Icon name="user" className="tile-icon" />
      <span>@{handle}</span>
    </span>
  );
}

/** Displays one work tile used by gallery grids, fresh works, feedback requests, and tag pages. */
export function WorkTile({ work, index = 0, galleryId = "" }: WorkTileProps) {
  const version = work.current_version || {};
  const imageUrl = version.thumbnail_url || version.preview_url || "";
  const hearts = Number(work.reactions?.heart_count || 0);
  const href = galleryId ? `/works/${work.id}?gallery=${encodePath(galleryId)}` : `/works/${work.id}`;
  const updated = relativeTime(work.updated_at || work.created_at);
  const meta = hearts ? `${hearts} heart${hearts === 1 ? "" : "s"}, ${updated}` : updated;
  return (
    <a href={href} class="image-tile media-reveal" data-link data-media-reveal style={tileRevealStyle(index)}>
      {imageUrl ? <ProtectedImage src={imageUrl} alt={work.title} /> : <span class="image-placeholder">{initials(work.title)}</span>}
      <WorkAuthorPill work={work} />
      <FeedbackRequestedIndicator work={work} />
      <div class="tile-overlay">
        <strong>{work.title}</strong>
        <small>{meta || "now"}</small>
      </div>
    </a>
  );
}

/** Displays a responsive grid of work tiles used by gallery, home, and tag views. */
export function WorkGrid({ works, galleryId = "" }: WorkGridProps) {
  return (
    <div class="image-grid">
      {[...(works || [])]
        .filter((work) => !work.deleted_at)
        .sort(newestFirst)
        .map((work, index) => (
          <WorkTile work={work} index={index} galleryId={galleryId} key={work.id} />
        ))}
    </div>
  );
}
