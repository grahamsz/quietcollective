// @ts-nocheck
import { escapeHtml } from "../lib/utils";
import { api } from "./api";
import { state } from "./state";

let membersRequest = null;
let popup = null;
let activeContext = null;
let activeIndex = 0;
let requestSerial = 0;
let tagsRequest = null;
let tagSuggestionsLoaded = false;

async function ensureMembers() {
  if (state.membersLoaded) return state.members || [];
  if (!membersRequest) {
    membersRequest = api("/api/members")
      .then((data) => {
        state.members = data.members || [];
        state.membersLoaded = true;
        return state.members;
      })
      .catch(() => {
        state.members = [];
        state.membersLoaded = true;
        return state.members;
      })
      .finally(() => {
        membersRequest = null;
      });
  }
  return membersRequest;
}

async function ensurePopularTags() {
  if (tagSuggestionsLoaded && state.popularTagsLoaded) return state.popularTags || [];
  if (!tagsRequest) {
    tagsRequest = api("/api/tags/popular")
      .then((data) => {
        state.popularTags = data.tags || [];
        state.popularTagsLoaded = true;
        tagSuggestionsLoaded = true;
        return state.popularTags;
      })
      .catch(() => {
        if (!state.popularTagsLoaded) {
          state.popularTags = [];
          state.popularTagsLoaded = true;
        }
        tagSuggestionsLoaded = true;
        return state.popularTags;
      })
      .finally(() => {
        tagsRequest = null;
      });
  }
  return tagsRequest;
}

function completionToken(value, cursor, { tags = false } = {}) {
  const before = String(value || "").slice(0, cursor);
  const memberMatch = before.match(/(^|[\s([{])@([a-z0-9_-]*)$/i);
  if (memberMatch) {
    return {
      kind: "member",
      query: memberMatch[2] || "",
      start: cursor - (memberMatch[2] || "").length - 1,
      end: cursor,
    };
  }
  if (!tags) return null;
  const tagMatch = before.match(/(^|[\s([{])#([^\s#]+)$/);
  if (!tagMatch) return null;
  return {
    kind: "tag",
    query: tagMatch[2] || "",
    start: cursor - (tagMatch[2] || "").length - 1,
    end: cursor,
  };
}

function filteredMembers(query) {
  const term = String(query || "").toLowerCase();
  return [...(state.members || [])]
    .filter((member) => {
      const handle = String(member.handle || "").toLowerCase();
      const name = String(member.display_name || "").toLowerCase();
      return !term || handle.startsWith(term) || name.includes(term);
    })
    .slice(0, 8);
}

function filteredTags(query) {
  const term = String(query || "").toLowerCase();
  return [...(state.popularTags || [])]
    .map((tag) => ({
      tag: String(tag?.tag || tag?.name || "").toLowerCase(),
      count: Number(tag?.count || 0),
    }))
    .filter((tag) => tag.tag && (!term || tag.tag.startsWith(term) || tag.tag.includes(term)))
    .slice(0, 8);
}

function filteredSuggestions(kind, query) {
  return kind === "tag" ? filteredTags(query) : filteredMembers(query);
}

function ensurePopup() {
  if (popup) return popup;
  popup = document.createElement("div");
  popup.className = "mention-popup";
  popup.hidden = true;
  popup.addEventListener("mousedown", (event) => event.preventDefault());
  popup.addEventListener("click", (event) => {
    const option = event.target.closest("[data-mention-index]");
    if (!option || !activeContext) return;
    const item = activeContext.items[Number(option.dataset.mentionIndex)];
    if (item) commitSuggestion(item);
  });
  document.body.append(popup);
  document.addEventListener("click", (event) => {
    if (!popup.hidden && !popup.contains(event.target) && !activeContext?.source?.contains?.(event.target)) hideMentionPopup();
  });
  window.addEventListener("resize", hideMentionPopup);
  return popup;
}

function positionPopup(anchor) {
  const node = ensurePopup();
  const width = Math.min(320, Math.max(240, anchor.width || 240));
  node.style.left = `${Math.max(8, Math.min(anchor.left, window.scrollX + window.innerWidth - width - 8))}px`;
  node.style.top = `${anchor.top}px`;
  node.style.width = `${width}px`;
}

function renderPopup() {
  const node = ensurePopup();
  if (!activeContext) return;
  const items = activeContext.items || [];
  if (!items.length) {
    const emptyLabel = activeContext.kind === "tag" ? "No tags found" : "No members found";
    node.innerHTML = `<div class="mention-empty">${activeContext.loading ? "Loading..." : emptyLabel}</div>`;
    node.hidden = false;
    return;
  }
  node.innerHTML = items.map((item, index) => {
    const selected = index === activeIndex ? " is-active" : "";
    if (activeContext.kind === "tag") {
      const detail = item.count ? `<span>${escapeHtml(String(item.count))} use${item.count === 1 ? "" : "s"}</span>` : "";
      return `<button class="mention-option${selected}" type="button" data-mention-index="${index}"><strong>#${escapeHtml(item.tag)}</strong>${detail}</button>`;
    }
    const displayName = item.display_name && item.display_name !== item.handle ? `<span>${escapeHtml(item.display_name)}</span>` : "";
    return `<button class="mention-option${selected}" type="button" data-mention-index="${index}"><strong>@${escapeHtml(item.handle)}</strong>${displayName}</button>`;
  }).join("");
  node.hidden = false;
}

function showCompletionPopup(context, anchor, token) {
  const serial = ++requestSerial;
  const loaded = token.kind === "tag" ? tagSuggestionsLoaded : state.membersLoaded;
  const items = loaded || token.kind === "tag" ? filteredSuggestions(token.kind, token.query) : [];
  activeContext = {
    ...context,
    anchor,
    kind: token.kind,
    query: token.query,
    loading: !loaded,
    items,
  };
  activeIndex = 0;
  positionPopup(anchor);
  renderPopup();
  const ensure = token.kind === "tag" ? ensurePopularTags : ensureMembers;
  ensure().then(() => {
    if (serial !== requestSerial || !activeContext) return;
    activeContext.loading = false;
    activeContext.items = filteredSuggestions(activeContext.kind, activeContext.query);
    positionPopup(activeContext.anchor);
    renderPopup();
  });
}

function hideMentionPopup() {
  activeContext = null;
  requestSerial += 1;
  if (popup) popup.hidden = true;
}

function commitSuggestion(item) {
  if (!activeContext || !item) return;
  const value = activeContext.kind === "tag" ? item.tag && `#${item.tag}` : item.handle && `@${item.handle}`;
  if (!value) return;
  activeContext.commit(value);
  hideMentionPopup();
}

function moveActiveIndex(direction) {
  if (!activeContext?.items?.length) return;
  activeIndex = (activeIndex + direction + activeContext.items.length) % activeContext.items.length;
  renderPopup();
}

function handleMentionKeydown(event) {
  if (!activeContext || popup?.hidden) return false;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActiveIndex(1);
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActiveIndex(-1);
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    const item = activeContext.items?.[activeIndex];
    if (item) {
      event.preventDefault();
      commitSuggestion(item);
      return true;
    }
  }
  if (event.key === "Escape") {
    event.preventDefault();
    hideMentionPopup();
    return true;
  }
  return false;
}

function bindMentionInput(input) {
  if (!input || input.dataset.mentionReady === "true") return;
  input.dataset.mentionReady = "true";
  const update = () => {
    const token = completionToken(input.value, input.selectionStart || 0);
    if (!token) return hideMentionPopup();
    const rect = input.getBoundingClientRect();
    showCompletionPopup({
      source: input,
      commit: (value) => {
        input.value = `${input.value.slice(0, token.start)}${value}${input.value.slice(token.end)}`;
        const cursor = token.start + value.length;
        input.setSelectionRange(cursor, cursor);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      },
    }, {
      left: rect.left + window.scrollX,
      top: rect.bottom + window.scrollY + 6,
      width: rect.width,
    }, token);
  };
  input.addEventListener("input", update);
  input.addEventListener("keyup", (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
    update();
  });
  input.addEventListener("click", update);
  input.addEventListener("keydown", handleMentionKeydown);
  input.addEventListener("blur", () => setTimeout(() => {
    if (!popup?.matches(":hover")) hideMentionPopup();
  }, 120));
}

function bindMentionAutocomplete(scope = document) {
  scope.querySelectorAll("input[name=collaborator_user], input[data-mention-input]").forEach(bindMentionInput);
}

function bindMarkdownMentionAutocomplete(cm) {
  if (!cm || cm._mentionReady) return;
  cm._mentionReady = true;
  const source = cm.getWrapperElement();
  let updateTimer = null;
  const update = () => {
    updateTimer = null;
    const cursor = cm.getCursor();
    const token = completionToken(cm.getLine(cursor.line), cursor.ch, { tags: true });
    if (!token) return hideMentionPopup();
    const coords = cm.cursorCoords(null, "page");
    showCompletionPopup({
      source,
      commit: (value) => {
        cm.replaceRange(value, { line: cursor.line, ch: token.start }, { line: cursor.line, ch: token.end });
        cm.focus();
      },
    }, {
      left: coords.left,
      top: coords.bottom + 6,
      width: 280,
    }, token);
  };
  const scheduleUpdate = () => {
    if (updateTimer) window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 0);
  };
  cm.on("keyup", (_instance, event) => {
    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
    scheduleUpdate();
  });
  cm.on("inputRead", scheduleUpdate);
  cm.on("changes", scheduleUpdate);
  cm.on("cursorActivity", scheduleUpdate);
  cm.on("keydown", (_instance, event) => handleMentionKeydown(event));
  cm.on("blur", () => setTimeout(() => {
    if (updateTimer) {
      window.clearTimeout(updateTimer);
      updateTimer = null;
    }
    if (!popup?.matches(":hover")) hideMentionPopup();
  }, 120));
}

export { bindMarkdownMentionAutocomplete, bindMentionAutocomplete };
