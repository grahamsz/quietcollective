// @ts-nocheck
import { activeLabel, avatar, button, encodePath, escapeHtml, link, relativeTime, renderMarkdownNoImages } from "../app/core";

function memberMini(member) {
  const tags = (member.medium_tags || []).slice(0, 4).map((tag) => `<a href="/tags/${encodePath(tag)}" class="badge" data-link>#${escapeHtml(tag)}</a>`).join("");
  return `<article class="member-card"><a href="/members/${encodePath(member.handle)}" class="profile-head member-link" data-link>${avatar(member)}<div><h3 class="card-title">@${escapeHtml(member.handle)}</h3><p class="member-active">${escapeHtml(activeLabel(member.last_active_at))}</p></div></a><div class="badge-row">${tags}</div></article>`;
}

function eventList(events) {
  return `<div class="activity-list">${(events || []).map((event) => {
    const body = `<span class="activity-time">${escapeHtml(relativeTime(event.created_at))}</span><span class="activity-copy"><span class="activity-summary">${escapeHtml(event.summary || (event.type || "").replaceAll(".", " "))}</span>${event.comment_preview ? `<span class="activity-preview">${renderMarkdownNoImages(event.comment_preview)}</span>` : ""}</span>${event.thumbnail_url ? `<img class="activity-thumb" src="${escapeHtml(event.thumbnail_url)}" alt="">` : ""}`;
    return event.href ? `<a class="activity-row" href="${escapeHtml(event.href)}" data-link>${body}</a>` : `<div class="activity-row">${body}</div>`;
  }).join("")}</div>`;
}

function notificationList(notifications) {
  return `<div class="notification-list">${(notifications || []).map((notification) => `<div class="activity-row notification-row"><span class="activity-time">${escapeHtml(relativeTime(notification.created_at))}</span><span class="activity-copy"><span class="activity-summary">${escapeHtml(notification.summary || notification.body || "Notification")}</span>${notification.comment_preview ? `<span class="activity-preview">${renderMarkdownNoImages(notification.comment_preview)}</span>` : ""}</span>${notification.thumbnail_url ? `<img class="activity-thumb" src="${escapeHtml(notification.thumbnail_url)}" alt="">` : ""}<span class="notification-actions">${notification.href ? link(notification.href, "Open", "button ghost") : ""}${button("Read", "button ghost", `data-notification-read="${escapeHtml(notification.id)}"`)}</span></div>`).join("")}</div><div class="toolbar notification-toolbar">${button("Mark all read", "button", "data-notifications-read-all")}</div>`;
}


export { eventList, memberMini, notificationList };
