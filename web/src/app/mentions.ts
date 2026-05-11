// @ts-nocheck
import { escapeHtml } from "../lib/utils";
import { api } from "./api";
import { state } from "./state";

let membersRequest = null;
let popup = null;
let activeContext = null;
let activeIndex = 0;
let requestSerial = 0;

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

function mentionToken(value, cursor) {
  const before = String(value || "").slice(0, cursor);
  const match = before.match(/(^|[\s([{])@([a-z0-9_-]*)$/i);
  if (!match) return null;
  return {
    query: match[2] || "",
    start: cursor - (match[2] || "").length - 1,
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

function ensurePopup() {
  if (popup) return popup;
  popup = document.createElement("div");
  popup.className = "mention-popup";
  popup.hidden = true;
  popup.addEventListener("mousedown", (event) => event.preventDefault());
  popup.addEventListener("click", (event) => {
    const option = event.target.closest("[data-mention-index]");
    if (!option || !activeContext) return;
    const member = activeContext.members[Number(option.dataset.mentionIndex)];
    if (member) commitMention(member);
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
  const members = activeContext.members || [];
  if (!members.length) {
    node.innerHTML = `<div class="mention-empty">${activeContext.loading ? "Loading..." : "No members found"}</div>`;
    node.hidden = false;
    return;
  }
  node.innerHTML = members.map((member, index) => {
    const selected = index === activeIndex ? " is-active" : "";
    const displayName = member.display_name && member.display_name !== member.handle ? `<span>${escapeHtml(member.display_name)}</span>` : "";
    return `<button class="mention-option${selected}" type="button" data-mention-index="${index}"><strong>@${escapeHtml(member.handle)}</strong>${displayName}</button>`;
  }).join("");
  node.hidden = false;
}

function showMentionPopup(context, anchor, query) {
  const serial = ++requestSerial;
  activeContext = {
    ...context,
    anchor,
    query,
    loading: !state.membersLoaded,
    members: state.membersLoaded ? filteredMembers(query) : [],
  };
  activeIndex = 0;
  positionPopup(anchor);
  renderPopup();
  ensureMembers().then(() => {
    if (serial !== requestSerial || !activeContext) return;
    activeContext.loading = false;
    activeContext.members = filteredMembers(activeContext.query);
    positionPopup(activeContext.anchor);
    renderPopup();
  });
}

function hideMentionPopup() {
  activeContext = null;
  requestSerial += 1;
  if (popup) popup.hidden = true;
}

function commitMention(member) {
  if (!activeContext || !member?.handle) return;
  activeContext.commit(`@${member.handle}`);
  hideMentionPopup();
}

function moveActiveIndex(direction) {
  if (!activeContext?.members?.length) return;
  activeIndex = (activeIndex + direction + activeContext.members.length) % activeContext.members.length;
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
    const member = activeContext.members?.[activeIndex];
    if (member) {
      event.preventDefault();
      commitMention(member);
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
    const token = mentionToken(input.value, input.selectionStart || 0);
    if (!token) return hideMentionPopup();
    const rect = input.getBoundingClientRect();
    showMentionPopup({
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
    }, token.query);
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
  const update = () => {
    const cursor = cm.getCursor();
    const token = mentionToken(cm.getLine(cursor.line), cursor.ch);
    if (!token) return hideMentionPopup();
    const coords = cm.cursorCoords(null, "page");
    showMentionPopup({
      source,
      commit: (value) => {
        cm.replaceRange(value, { line: cursor.line, ch: token.start }, { line: cursor.line, ch: token.end });
        cm.focus();
      },
    }, {
      left: coords.left,
      top: coords.bottom + 6,
      width: 280,
    }, token.query);
  };
  cm.on("keyup", (_instance, event) => {
    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
    update();
  });
  cm.on("cursorActivity", update);
  cm.on("keydown", (_instance, event) => handleMentionKeydown(event));
  cm.on("blur", () => setTimeout(() => {
    if (!popup?.matches(":hover")) hideMentionPopup();
  }, 120));
}

export { bindMarkdownMentionAutocomplete, bindMentionAutocomplete };
