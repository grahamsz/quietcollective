import { escapeHtml, initials } from "../lib/utils";
import { icon } from "./icons";

type AvatarUser = {
  avatar_url?: string | null;
  handle?: string | null;
  display_name?: string | null;
};

/** Renders an icon-only button used by modals, toolbar controls, and mobile nav. */
export function iconButton(name: string, label: string, className = "icon-button", attrs = "") {
  return `<button class="${escapeHtml(className)}" ${attrs} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(name)}</button>`;
}

/** Renders a button with an icon and text used by action-heavy forms. */
export function buttonIcon(name: string, label: string, className = "button", attrs = "") {
  return `<button class="${escapeHtml(className)}" ${attrs}>${icon(name)}<span>${escapeHtml(label)}</span></button>`;
}

/** Renders an icon link used for compact navigation actions like new gallery. */
export function iconLink(path: string, name: string, label: string, className = "") {
  return `<a href="${escapeHtml(path)}" class="${escapeHtml(className)}" data-link aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(name)}<span class="sr-only">${escapeHtml(label)}</span></a>`;
}

/** Renders a standard button used throughout string-rendered forms and panels. */
export function button(label: string, className = "button", attrs = "") {
  return `<button class="${escapeHtml(className)}" ${attrs}>${escapeHtml(label)}</button>`;
}

/** Renders an internal app link wired into client-side navigation. */
export function link(path: string, label: string, className = "") {
  return `<a href="${escapeHtml(path)}" class="${escapeHtml(className)}" data-link>${escapeHtml(label)}</a>`;
}

/** Renders a small metadata badge used by members, galleries, and crosspost rows. */
export function badge(label: string, tone = "") {
  return `<span class="badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

/** Renders a titled panel section used by page view components. */
export function panel(title: string, body: string, extra = "") {
  return `<section class="panel ${escapeHtml(extra)}"><div class="panel-header"><h2>${escapeHtml(title)}</h2></div><div class="panel-body">${body}</div></section>`;
}

/** Renders an empty-state message used by lists and grids with no content. */
export function empty(message: string) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

/** Renders a member avatar used in navigation, member cards, and profile headers. */
export function avatar(user: AvatarUser | null | undefined, className = "avatar") {
  if (user?.avatar_url) return `<img class="${escapeHtml(className)}" src="${escapeHtml(user.avatar_url)}" alt="">`;
  return `<span class="${escapeHtml(className)}" aria-hidden="true">${escapeHtml(initials(user?.handle || user?.display_name))}</span>`;
}
