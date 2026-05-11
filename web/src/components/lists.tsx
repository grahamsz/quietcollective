// @ts-nocheck
import { activeLabel, encodePath, initials, relativeTime } from "../lib/utils";
import { renderMarkdownNoImages } from "../lib/markdown";

function Avatar({ user, className = "avatar" }) {
  if (user?.avatar_url) return <img class={className} src={user.avatar_url} alt="" />;
  return <span class={className} aria-hidden="true">{initials(user?.handle || user?.display_name)}</span>;
}

/** Renders a compact member card used by the home page, member index, and tag pages. */
export function MemberMini({ member }) {
  const tags = (member.medium_tags || []).slice(0, 4);
  return (
    <article class="member-card">
      <a href={`/members/${encodePath(member.handle)}`} class="profile-head member-link" data-link>
        <Avatar user={member} />
        <div>
          <h3 class="card-title">@{member.handle}</h3>
          <p class="member-active">{activeLabel(member.last_active_at)}</p>
        </div>
      </a>
      <div class="badge-row">{tags.map((tag) => <a href={`/tags/${encodePath(tag)}`} class="badge" data-link key={tag}>#{tag}</a>)}</div>
    </article>
  );
}

/** Renders activity rows used by the home page and admin event feed. */
export function EventList({ events }) {
  return (
    <div class="activity-list">
      {(events || []).map((event) => {
        const body = (
          <>
            <span class="activity-time">{relativeTime(event.created_at)}</span>
            <span class="activity-copy">
              <span class="activity-summary">{event.summary || (event.type || "").replaceAll(".", " ")}</span>
              {event.comment_preview ? <span class="activity-preview" dangerouslySetInnerHTML={{ __html: renderMarkdownNoImages(event.comment_preview) }} /> : null}
            </span>
            {event.thumbnail_url ? <img class="activity-thumb" src={event.thumbnail_url} alt="" /> : null}
          </>
        );
        return event.href
          ? <a class="activity-row" href={event.href} data-link key={event.id || event.created_at}>{body}</a>
          : <div class="activity-row" key={event.id || event.created_at}>{body}</div>;
      })}
    </div>
  );
}

/** Renders unread notification rows used by the home page notification panel. */
export function NotificationList({ notifications }) {
  return (
    <>
      <div class="notification-list">
        {(notifications || []).map((notification) => {
          const body = (
            <>
              <span class="activity-time">{relativeTime(notification.created_at)}</span>
              <span class="activity-copy">
                <span class="activity-summary">{notification.summary || notification.body || "Notification"}</span>
                {notification.comment_preview ? <span class="activity-preview" dangerouslySetInnerHTML={{ __html: renderMarkdownNoImages(notification.comment_preview) }} /> : null}
              </span>
              {notification.thumbnail_url ? <img class="activity-thumb" src={notification.thumbnail_url} alt="" /> : null}
            </>
          );
          return notification.href
            ? <a class="activity-row notification-row" href={notification.href} data-notification-item data-notification-id={notification.id} data-notification-href={notification.href} key={notification.id}>{body}</a>
            : <button class="activity-row notification-row" type="button" data-notification-item data-notification-id={notification.id} key={notification.id}>{body}</button>;
        })}
      </div>
      <div class="toolbar notification-toolbar">
        <button class="button" data-notifications-read-all>Mark all read</button>
      </div>
    </>
  );
}
