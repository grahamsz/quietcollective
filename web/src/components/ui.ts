import { escapeHtml, initials } from "../lib/utils";
import { icon } from "./icons";

type AvatarUser = {
  avatar_url?: string | null;
  handle?: string | null;
  display_name?: string | null;
};

export function iconButton(name: string, label: string, className = "icon-button", attrs = "") {
  return `<button class="${escapeHtml(className)}" ${attrs} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(name)}</button>`;
}

export function buttonIcon(name: string, label: string, className = "button", attrs = "") {
  return `<button class="${escapeHtml(className)}" ${attrs}>${icon(name)}<span>${escapeHtml(label)}</span></button>`;
}

export function iconLink(path: string, name: string, label: string, className = "") {
  return `<a href="${escapeHtml(path)}" class="${escapeHtml(className)}" data-link aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(name)}<span class="sr-only">${escapeHtml(label)}</span></a>`;
}

export function button(label: string, className = "button", attrs = "") {
  return `<button class="${escapeHtml(className)}" ${attrs}>${escapeHtml(label)}</button>`;
}

export function link(path: string, label: string, className = "") {
  return `<a href="${escapeHtml(path)}" class="${escapeHtml(className)}" data-link>${escapeHtml(label)}</a>`;
}

export function badge(label: string, tone = "") {
  return `<span class="badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

export function panel(title: string, body: string, extra = "") {
  return `<section class="panel ${escapeHtml(extra)}"><div class="panel-header"><h2>${escapeHtml(title)}</h2></div><div class="panel-body">${body}</div></section>`;
}

export function empty(message: string) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

export function avatar(user: AvatarUser | null | undefined, className = "avatar") {
  if (user?.avatar_url) return `<img class="${escapeHtml(className)}" src="${escapeHtml(user.avatar_url)}" alt="">`;
  return `<span class="${escapeHtml(className)}" aria-hidden="true">${escapeHtml(initials(user?.handle || user?.display_name))}</span>`;
}
