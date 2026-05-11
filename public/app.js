const appRoot = document.querySelector("#app");

const state = {
  me: null,
  instance: { name: "QuietCollective", source_code_url: "", logo_url: "" },
  members: [],
  galleries: [],
  roleSuggestions: [],
  token: localStorage.getItem("qc_token") || "",
};

const UPSTREAM_SOURCE_URL = "https://www.github.com/grahamsz/quietcollective";
const DEFAULT_WORK_ROLES = ["photographer", "model", "muse", "artist", "lighting", "staging", "make-up"];

const routes = [
  ["/setup", renderSetup],
  ["/login", renderLogin],
  [/^\/invite\/([^/]+)$/, renderInvite],
  ["/", renderHome],
  ["/galleries", renderGalleries],
  ["/galleries/new", renderNewGallery],
  [/^\/galleries\/([^/]+)\/settings$/, renderGallerySettings],
  [/^\/galleries\/([^/]+)$/, renderGallery],
  [/^\/works\/([^/]+)\/edit$/, renderWorkEdit],
  [/^\/works\/([^/]+)\/versions$/, renderWorkVersions],
  [/^\/works\/([^/]+)$/, renderWork],
  ["/members", renderMembers],
  [/^\/members\/([^/]+)$/, renderMemberProfile],
  [/^\/tags\/([^/]+)$/, renderTagPage],
  ["/me/profile", renderMyProfile],
  ["/me/exports", renderExports],
  ["/admin/invites", renderAdminInvites],
  ["/admin", renderAdmin],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function encodePath(value) {
  return encodeURIComponent(String(value ?? ""));
}

function field(form, name) {
  return form.elements[name];
}

function formDataObject(form) {
  const data = {};
  for (const [key, value] of new FormData(form).entries()) data[key] = value;
  return data;
}

function newestFirst(a, b) {
  return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
}

function clientKey(prefix = "qc") {
  if (crypto.randomUUID) return `${prefix}:${crypto.randomUUID()}`;
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

async function resizeImageForUpload(file, maxDimension, label, quality = 0.86) {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  if (scale === 1 && file.type === "image/webp") {
    bitmap.close?.();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) return file;
  const base = (file.name || "image").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}-${label}.webp`, { type: "image/webp", lastModified: Date.now() });
}

async function imageUploadVariants(file) {
  const [preview, thumbnail] = await Promise.all([
    resizeImageForUpload(file, 2048, "preview", 0.88),
    resizeImageForUpload(file, 512, "thumb", 0.82),
  ]);
  return { preview, thumbnail };
}

function initials(name) {
  const bits = String(name || "QC").trim().split(/\s+/).slice(0, 2);
  return bits.map((bit) => bit[0]?.toUpperCase() || "").join("") || "QC";
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return `${Math.round(Math.abs(seconds) / size)}${unit} ${seconds >= 0 ? "ago" : "from now"}`;
  }
  return seconds >= 10 ? `${Math.abs(seconds)}s ago` : "now";
}

function activeLabel(value) {
  if (!value) return "not active yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not active yet";
  if (date.toDateString() === new Date().toDateString()) return "active today";
  return `last active ${relativeTime(value)}`;
}

function stripMarkdownImages(value) {
  return String(value || "").replace(/!\[[^\]]*]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function renderMarkdownInline(value) {
  return escapeHtml(value || "")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<img class="markdown-image" src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/(^|\s)@([a-z0-9_-]+)/gi, '$1<a href="/members/$2" data-link>@$2</a>')
    .replace(/(^|\s)#([a-z0-9_-]+)/gi, '$1<a class="text-tag" href="/tags/$2" data-link>#$2</a>');
}

function renderMarkdown(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map(renderMarkdownInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(`<${list.type}>${list.items.map((item) => `<li>${renderMarkdownInline(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const line of lines) {
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (unordered || ordered) {
      const type = unordered ? "ul" : "ol";
      flushParagraph();
      if (list?.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((unordered || ordered)[1]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

function renderMarkdownNoImages(value) {
  return renderMarkdownInline(stripMarkdownImages(value)).replace(/\n/g, "<br>");
}

function toast(message, type = "info") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.append(stack);
  }
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  stack.append(item);
  setTimeout(() => item.remove(), 4200);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const body = options.body;
  if (body && !(body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (state.token) headers.set("authorization", `Bearer ${state.token}`);
  const response = await fetch(path, {
    ...options,
    headers,
    cache: options.cache || "no-store",
    credentials: "include",
    body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(typeof data === "object" ? data.error || "Request failed" : data || "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function refreshMe() {
  const data = await api("/api/auth/me");
  state.me = data.user;
  state.instance = data.instance || state.instance;
  return state.me;
}

async function loadMembers() {
  try {
    const data = await api("/api/members");
    state.members = data.members || [];
  } catch {
    state.members = [];
  }
  return state.members;
}

async function loadGalleries() {
  try {
    const data = await api("/api/galleries");
    state.galleries = (data.galleries || []).sort(newestFirst);
  } catch {
    state.galleries = [];
  }
  return state.galleries;
}

async function loadRoleSuggestions() {
  try {
    const data = await api("/api/role-suggestions?scope=work_collaborator");
    state.roleSuggestions = data.roles || [];
  } catch {
    state.roleSuggestions = [];
  }
  return state.roleSuggestions;
}

async function ensureAuthed() {
  if (state.me) {
    if (!state.galleries.length) await loadGalleries();
    return true;
  }
  try {
    await refreshMe();
    await loadGalleries();
    return true;
  } catch (error) {
    state.me = null;
    localStorage.removeItem("qc_token");
    if (location.pathname !== "/login" && location.pathname !== "/setup" && !location.pathname.startsWith("/invite/")) navigate("/login");
    return false;
  }
}

function navigate(path) {
  history.pushState(null, "", path);
  renderRoute();
}

function button(label, className = "button", attrs = "") {
  return `<button class="${escapeHtml(className)}" ${attrs}>${escapeHtml(label)}</button>`;
}

function link(path, label, className = "") {
  return `<a href="${escapeHtml(path)}" class="${escapeHtml(className)}" data-link>${escapeHtml(label)}</a>`;
}

function badge(label, tone = "") {
  return `<span class="badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function panel(title, body, extra = "") {
  return `<section class="panel ${escapeHtml(extra)}"><div class="panel-header"><h2>${escapeHtml(title)}</h2></div><div class="panel-body">${body}</div></section>`;
}

function empty(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function markdownHint() {
  return `<span class="field-hint">Markdown supported. Use @handle to mention members and #tag to tag ideas.</span>`;
}

function ownershipLabel(value) {
  if (value === "whole_server") return "Whole Server";
  if (value === "collaborative") return "Collaborative";
  return "Self-owned";
}

function ownershipHelp(value) {
  if (value === "whole_server") return "Whole Server ownership lets any logged-in member add images. Only the owner, gallery admins, and instance admins can edit gallery settings.";
  if (value === "collaborative") return "Collaborative galleries are meant for invited collaborators. Add members who can upload, edit, or manage collaborators.";
  return "Self-owned galleries are controlled by you. You can still invite people to view or comment.";
}

function visibilityHelp(value) {
  return value === "server_public"
    ? "Whole Server means any logged-in member of this instance can view it. It is never anonymous public web access."
    : "Private means only you, explicitly added gallery members, and admins can view it.";
}

function avatar(user, className = "avatar") {
  if (user?.avatar_url) return `<img class="${escapeHtml(className)}" src="${escapeHtml(user.avatar_url)}" alt="">`;
  return `<span class="${escapeHtml(className)}" aria-hidden="true">${escapeHtml(initials(user?.handle || user?.display_name))}</span>`;
}

function brandMark() {
  if (state.instance.logo_url) return `<img class="brand-logo" src="${escapeHtml(state.instance.logo_url)}" alt="">`;
  return `<div class="brand-mark" aria-hidden="true">QC</div>`;
}

function pageShell(content, options = {}) {
  const myGalleries = state.galleries
    .filter((gallery) => gallery.owner_user_id === state.me?.id || gallery.capabilities?.upload_work)
    .sort(newestFirst)
    .slice(0, 8);
  const source = state.instance.source_code_url
    ? `<a class="source-link is-visible" href="${escapeHtml(state.instance.source_code_url)}" rel="noreferrer">Source Code</a>`
    : "";
  return `
    <div class="layout">
      <aside class="sidebar">
        <a class="sidebar-head" href="/" data-link>${brandMark()}<div class="brand-title"><strong>${escapeHtml(state.instance.name || "QuietCollective")}</strong><span>Private artist community</span></div></a>
        <section class="sidebar-section sidebar-section-primary">
          <h2>My Galleries</h2>
          ${myGalleries.length ? `<div class="sidebar-gallery-list">${myGalleries.map((gallery) => `<a href="/galleries/${gallery.id}" data-link><span>${escapeHtml(gallery.title)}</span></a>`).join("")}</div>` : `<div class="empty-state compact">No galleries yet.</div>`}
          <a href="/galleries" class="sidebar-view-all" data-link>View All</a>
          <a href="/galleries/new" class="sidebar-new-gallery" data-link><span>+</span><strong>New</strong></a>
        </section>
        <div class="sidebar-foot">
          ${state.me?.role === "admin" ? `<nav class="admin-nav" aria-label="Admin"><a href="/admin" ${location.pathname === "/admin" ? 'aria-current="page"' : ""} data-link>Admin</a><a href="/admin/invites" ${location.pathname === "/admin/invites" ? 'aria-current="page"' : ""} data-link>Invites</a></nav>` : ""}
          <p class="rights-note">Uploaded user content remains owned by the uploader or rights holder. Powered by the open source <a href="${UPSTREAM_SOURCE_URL}" rel="noreferrer">QuietCollective project</a>.</p>
          ${source}
        </div>
      </aside>
      <main class="main-column">
        <header class="topbar">
          <button class="icon-button mobile-menu" data-menu aria-label="Menu">=</button>
          <div><strong>${escapeHtml(options.kicker || state.instance.name || "QuietCollective")}</strong></div>
          <div class="topbar-actions">${state.me ? `<a href="/me/profile" class="user-chip" data-link>${avatar(state.me)}<span>${escapeHtml(state.me.handle)}</span></a>${button("Log out", "button ghost", "data-logout")}` : link("/login", "Log in", "button")}</div>
        </header>
        <div class="content">${content}</div>
      </main>
    </div>
  `;
}

function authPage(content) {
  return `<main class="boot-screen">${brandMark()}<section class="panel" style="width:min(520px,calc(100vw - 32px));text-align:left"><div class="panel-body">${content}<p class="rights-note" style="margin-top:18px">Uploaded user content remains owned by the uploader or rights holder. Powered by the open source <a href="${UPSTREAM_SOURCE_URL}" rel="noreferrer">QuietCollective project</a>.</p></div></section></main>`;
}

function setApp(html) {
  appRoot.innerHTML = html;
  bindCommonActions();
  enhanceMarkdownEditors(appRoot);
}

function bindCommonActions() {
  document.querySelectorAll("a[data-link]").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      event.preventDefault();
      navigate(`${url.pathname}${url.search}`);
    });
  });
  document.querySelector("[data-menu]")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  document.querySelector("[data-logout]")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    state.token = "";
    state.me = null;
    localStorage.removeItem("qc_token");
    navigate("/login");
  });
  bindReactionButtons();
  bindNotificationActions();
  bindReplyButtons();
}

function bindJsonForm(selector, handler) {
  const form = document.querySelector(selector);
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncMarkdownEditors(form);
    const submit = form.querySelector("[type=submit]");
    submit?.setAttribute("disabled", "disabled");
    try {
      await handler(formDataObject(form), form);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      submit?.removeAttribute("disabled");
    }
  });
}

function enhanceMarkdownEditors(scope = document) {
  if (!window.EasyMDE) return;
  scope.querySelectorAll("textarea[data-markdown-editor]:not([data-editor-ready])").forEach((textarea) => {
    textarea.dataset.editorReady = "true";
    if (textarea.required) {
      textarea.dataset.required = "true";
      textarea.required = false;
    }
    const targetType = textarea.dataset.targetType || textarea.closest("[data-target-type]")?.dataset.targetType || "draft";
    const targetId = textarea.dataset.targetId || textarea.closest("[data-target-id]")?.dataset.targetId || "";
    const editor = new EasyMDE({
      element: textarea,
      autofocus: false,
      spellChecker: false,
      status: false,
      minHeight: textarea.dataset.editorMinHeight || "130px",
      renderingConfig: { singleLineBreaks: false },
      uploadImage: true,
      imageAccept: "image/png, image/jpeg, image/gif, image/webp",
      imageMaxSize: 1024 * 1024 * 10,
      imageUploadFunction: async (file, onSuccess, onError) => {
        try {
          const body = new FormData();
          body.set("file", file);
          body.set("target_type", targetType);
          if (targetId) body.set("target_id", targetId);
          const data = await api("/api/markdown-assets", { method: "POST", body });
          onSuccess(data.url || data.data?.filePath);
        } catch (error) {
          onError(error.message || "Image upload failed");
        }
      },
      toolbar: [
        { name: "bold", action: EasyMDE.toggleBold, text: "B", title: "Bold" },
        { name: "italic", action: EasyMDE.toggleItalic, text: "I", title: "Italic" },
        { name: "heading", action: EasyMDE.toggleHeadingSmaller, text: "H", title: "Heading" },
        "|",
        { name: "quote", action: EasyMDE.toggleBlockquote, text: "Quote", title: "Quote" },
        { name: "unordered-list", action: EasyMDE.toggleUnorderedList, text: "List", title: "Bulleted list" },
        { name: "ordered-list", action: EasyMDE.toggleOrderedList, text: "1.", title: "Numbered list" },
        "|",
        { name: "link", action: EasyMDE.drawLink, text: "Link", title: "Link" },
        { name: "upload-image", action: EasyMDE.drawUploadedImage, text: "Image", title: "Upload image" },
        "|",
        { name: "preview", action: EasyMDE.togglePreview, text: "Preview", title: "Preview" },
      ],
    });
    textarea._easyMDE = editor;
    editor.codemirror.on("change", () => {
      textarea.value = editor.value();
    });
  });
}

function syncMarkdownEditors(scope = document) {
  scope.querySelectorAll("textarea[data-markdown-editor]").forEach((textarea) => {
    if (textarea._easyMDE) textarea.value = textarea._easyMDE.value();
  });
}

function reactionButton(targetType, targetId, reactions = {}) {
  const count = reactions.heart_count || 0;
  return `<button class="heart-button ${reactions.hearted_by_me ? "is-active" : ""}" data-heart-target-type="${escapeHtml(targetType)}" data-heart-target-id="${escapeHtml(targetId)}" data-hearted="${reactions.hearted_by_me ? "true" : "false"}" type="button">${escapeHtml(count ? `Heart ${count}` : "Heart")}</button>`;
}

function bindReactionButtons() {
  document.querySelectorAll("[data-heart-target-type]").forEach((control) => {
    control.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const targetType = control.dataset.heartTargetType;
        const targetId = control.dataset.heartTargetId;
        const method = control.dataset.hearted === "true" ? "DELETE" : "POST";
        const data = await api(`/api/reactions/${encodePath(targetType)}/${encodePath(targetId)}/heart`, { method });
        control.dataset.hearted = data.reactions.hearted_by_me ? "true" : "false";
        control.classList.toggle("is-active", data.reactions.hearted_by_me);
        const count = data.reactions.heart_count || 0;
        control.textContent = count ? `Heart ${count}` : "Heart";
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

function bindNotificationActions() {
  document.querySelector("[data-notifications-read-all]")?.addEventListener("click", async () => {
    await api("/api/notifications/read-all", { method: "POST" }).catch((error) => toast(error.message, "error"));
    renderRoute();
  });
  document.querySelectorAll("[data-notification-read]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/notifications/${encodePath(control.dataset.notificationRead)}/read`, { method: "POST" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
}

function bindReplyButtons() {
  document.querySelectorAll("[data-reply-comment]").forEach((control) => {
    control.addEventListener("click", () => {
      const panelEl = control.closest(".panel");
      const form = panelEl?.querySelector(".comment-form");
      if (!form) return;
      field(form, "parent_comment_id").value = control.dataset.replyComment;
      const label = form.querySelector("[data-replying-to]");
      if (label) {
        label.hidden = false;
        label.querySelector("span").textContent = `Replying to @${control.dataset.replyAuthor || "member"}`;
      }
      form.querySelector("textarea[data-markdown-editor]")?._easyMDE?.codemirror?.focus();
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  document.querySelectorAll("[data-cancel-reply]").forEach((control) => {
    control.addEventListener("click", () => {
      const form = control.closest(".comment-form");
      if (!form) return;
      field(form, "parent_comment_id").value = "";
      control.closest("[data-replying-to]").hidden = true;
    });
  });
}

async function renderSetup() {
  const status = await api("/api/setup/status").catch(() => ({ setup_enabled: false }));
  if (!status.setup_enabled) {
    setApp(authPage(`<p class="eyebrow">Setup</p><h1>Setup is disabled</h1><p class="lede">An admin account already exists.</p>${link("/login", "Log in", "button primary")}`));
    return;
  }
  setApp(authPage(`
    <p class="eyebrow">Setup</p><h1>Create admin</h1>
    <form class="form" id="setup-form">
      <div class="form-row"><label>Setup token</label><input name="token" required></div>
      <div class="form-row"><label>Email</label><input name="email" type="email" required></div>
      <div class="form-row"><label>Handle</label><input name="handle" required pattern="[A-Za-z0-9_-]+"></div>
      <div class="form-row"><label>Password</label><input name="password" type="password" required minlength="10"></div>
      ${button("Create admin", "button primary", "type=submit")}
    </form>
  `));
  bindJsonForm("#setup-form", async (body) => {
    const data = await api("/api/setup/admin", { method: "POST", body });
    if (data.token) {
      state.token = data.token;
      localStorage.setItem("qc_token", data.token);
    }
    state.me = data.user;
    navigate("/");
  });
}

async function renderLogin() {
  setApp(authPage(`
    <p class="eyebrow">Login</p><h1>${escapeHtml(state.instance.name || "QuietCollective")}</h1>
    <form class="form" id="login-form">
      <div class="form-row"><label>Email</label><input name="email" type="email" required></div>
      <div class="form-row"><label>Password</label><input name="password" type="password" required></div>
      ${button("Log in", "button primary", "type=submit")}
    </form>
  `));
  bindJsonForm("#login-form", async (body) => {
    const data = await api("/api/auth/login", { method: "POST", body });
    if (data.token) {
      state.token = data.token;
      localStorage.setItem("qc_token", data.token);
    }
    state.me = data.user;
    await loadGalleries();
    navigate("/");
  });
}

async function renderInvite(token) {
  const invite = await api(`/api/invites/${encodePath(token)}`);
  setApp(authPage(`
    <p class="eyebrow">Invite</p><h1>Join ${escapeHtml(state.instance.name || "QuietCollective")}</h1>
    <p class="lede">This invite grants the ${escapeHtml(invite.role_on_join || "member")} role.</p>
    <form class="form" id="invite-form">
      <div class="form-row"><label>Email</label><input name="email" type="email" required></div>
      <div class="form-row"><label>Handle</label><input name="handle" required pattern="[A-Za-z0-9_-]+"></div>
      <div class="form-row"><label>Password</label><input name="password" type="password" required minlength="10"></div>
      ${button("Accept invite", "button primary", "type=submit")}
    </form>
  `));
  bindJsonForm("#invite-form", async (body) => {
    const data = await api(`/api/invites/${encodePath(token)}/accept`, { method: "POST", body });
    if (data.token) {
      state.token = data.token;
      localStorage.setItem("qc_token", data.token);
    }
    state.me = data.user;
    navigate("/");
  });
}

function galleryMosaic(galleries) {
  return `<div class="gallery-mosaic">${(galleries || []).sort(newestFirst).map((gallery) => `
    <a class="gallery-tile ${gallery.cover_image_url ? "" : "is-empty"}" href="/galleries/${gallery.id}" data-link>
      ${gallery.cover_image_url ? `<img src="${escapeHtml(gallery.cover_image_url)}" alt="">` : `<span>${escapeHtml(initials(gallery.title))}</span>`}
      <div class="tile-overlay"><strong>${escapeHtml(gallery.title)}</strong><small>${gallery.visibility === "server_public" ? "Whole Server" : "Private"}</small></div>
    </a>
  `).join("")}</div>`;
}

function imageTile(work) {
  const version = work.current_version || {};
  const imageUrl = version.thumbnail_url || version.preview_url;
  const hearts = work.reactions?.heart_count || 0;
  return `<a href="/works/${work.id}" class="image-tile" data-link>${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="">` : `<span class="image-placeholder">${escapeHtml(initials(work.title))}</span>`}<div class="tile-overlay"><strong>${escapeHtml(work.title)}</strong><small>${hearts ? `${hearts} heart${hearts === 1 ? "" : "s"}` : "Image"}</small></div></a>`;
}

function imageGrid(works) {
  return `<div class="image-grid">${(works || []).filter((work) => !work.deleted_at).sort(newestFirst).map(imageTile).join("")}</div>`;
}

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

async function renderHome() {
  if (!(await ensureAuthed())) return;
  await loadMembers();
  const [activity, notificationsData] = await Promise.all([
    api("/api/activity").catch(() => ({ events: [] })),
    api("/api/notifications").catch(() => ({ notifications: [] })),
    loadGalleries(),
  ]);
  const details = await Promise.all(state.galleries.slice(0, 8).map((gallery) => api(`/api/galleries/${gallery.id}`).catch(() => null)));
  const works = Array.from(
    new Map(details.flatMap((detail) => detail?.works || []).filter((work) => !work.deleted_at).map((work) => [work.id, work])).values(),
  ).sort(newestFirst);
  const feedbackWorks = works.filter((work) => work.feedback_requested && !work.feedback_dismissed);
  const unreadNotifications = (notificationsData.notifications || []).filter((notification) => !notification.read_at);
  setApp(pageShell(`
    <section class="view home-view">
      ${unreadNotifications.length ? panel("Notifications", notificationList(unreadNotifications.slice(0, 8)), "notification-panel") : ""}
      <div class="view-header"><div><p class="eyebrow">Recently Updated</p><h1>${escapeHtml(state.instance.name || "QuietCollective")}</h1><p class="lede">Private image galleries, critique, collaborator credits, and member profiles for logged-in members.</p></div><div class="toolbar">${link("/galleries/new", "+", "button primary square-button")}</div></div>
      ${state.galleries.length ? panel("Recently Updated Galleries", galleryMosaic(state.galleries.slice(0, 14)), "flush-panel") : empty("No visible galleries yet.")}
      ${feedbackWorks.length ? panel("Feedback Requested", imageGrid(feedbackWorks.slice(0, 12)), "flush-panel") : ""}
      ${works.length ? panel("Fresh Works", imageGrid(works.slice(0, 18)), "flush-panel") : ""}
      <div class="home-lower-grid">${panel("Activity", activity.events?.length ? eventList(activity.events.slice(0, 18)) : empty("No recent visible activity."), "activity-panel")}${panel("Members", `<div class="member-rail">${state.members.map(memberMini).join("")}</div>`)}</div>
    </section>
  `));
}

async function renderGalleries() {
  if (!(await ensureAuthed())) return;
  const galleries = await loadGalleries();
  setApp(pageShell(`<section class="view gallery-view"><div class="view-header"><div><p class="eyebrow">Galleries</p><h1>Browse galleries</h1></div><div class="toolbar">${link("/galleries/new", "+", "button primary square-button")}</div></div>${galleries.length ? galleryMosaic(galleries) : empty("No visible galleries yet.")}</section>`));
}

async function renderMembers() {
  if (!(await ensureAuthed())) return;
  await loadMembers();
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Members</p><h1>Community members</h1></div></div><div class="card-grid">${state.members.map(memberMini).join("") || empty("No members yet.")}</div></section>`));
}

async function renderMemberProfile(handle) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/users/${encodePath(handle)}`);
  const user = data.user;
  const comments = await api(`/api/comments?target_type=profile&target_id=${encodePath(user.id)}`).catch(() => ({ comments: [] }));
  setApp(pageShell(`<section class="view"><div class="profile-head">${avatar(user, "avatar-lg")}<div><p class="eyebrow">Member</p><h1>@${escapeHtml(user.handle)}</h1><p class="member-active">${escapeHtml(activeLabel(user.last_active_at))}</p></div></div><div class="grid two">${panel("Profile", `<div class="description markdown-body">${renderMarkdown(user.bio || "No bio yet.")}</div><div class="badge-row">${(user.medium_tags || []).map((tag) => `<a href="/tags/${encodePath(tag)}" class="badge green" data-link>#${escapeHtml(tag)}</a>`).join("")}</div>`)}${commentsPanel("profile", user.id, comments.comments)}</div></section>`));
  bindCommentForm("profile", user.id);
}

async function renderTagPage(tag) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/tags/${encodePath(tag)}`);
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Tag</p><h1>#${escapeHtml(data.tag)}</h1><p class="lede">Photos, galleries, members, and visible comments using this tag.</p></div></div>${data.works?.length ? panel("Photos", imageGrid(data.works), "flush-panel") : empty("No visible photos use this tag yet.")}<div class="home-lower-grid">${panel("Galleries", data.galleries?.length ? galleryMosaic(data.galleries) : empty("No galleries use this tag."), "flush-panel")}${panel("Members", data.members?.length ? `<div class="member-rail">${data.members.map(memberMini).join("")}</div>` : empty("No members use this tag."))}</div>${panel("Comments", data.comments?.length ? `<div class="grid">${data.comments.map((comment) => commentArticle(comment, { replyButton: false })).join("")}</div>` : empty("No visible comments use this tag."))}</section>`));
}

function commentAuthor(comment) {
  return comment.handle || comment.display_name || "member";
}

function commentReplyContext(comment) {
  if (!comment.parent_comment_id) return "";
  const author = comment.parent_handle || comment.parent_display_name || "member";
  const preview = stripMarkdownImages(comment.parent_body || "").replace(/\s+/g, " ").trim();
  const clipped = preview.length > 160 ? `${preview.slice(0, 160)}...` : preview;
  return `<div class="reply-context"><span>Replying to @${escapeHtml(author)}</span>${clipped ? `<p>${renderMarkdownInline(clipped)}</p>` : ""}</div>`;
}

function commentArticle(comment, options = {}) {
  const author = commentAuthor(comment);
  const replyButton = options.replyButton !== false;
  const metaExtras = typeof options.metaExtras === "function" ? options.metaExtras(comment) : "";
  return `<article class="comment-card${comment.parent_comment_id ? " is-reply" : ""}"><div class="meta-row"><strong>@${escapeHtml(author)}</strong><span>${escapeHtml(relativeTime(comment.created_at))}</span>${metaExtras}</div>${commentReplyContext(comment)}<div class="description markdown-body">${renderMarkdown(comment.body)}</div><div class="comment-actions">${reactionButton("comment", comment.id, comment.reactions)}${replyButton ? button("Reply", "button ghost", `data-reply-comment="${escapeHtml(comment.id)}" data-reply-author="${escapeHtml(author)}"`) : ""}</div></article>`;
}

function commentsPanel(targetType, targetId, comments) {
  return panel("Comments", `<div class="grid">${(comments || []).map((comment) => commentArticle(comment)).join("") || empty("No comments yet.")}<form class="form comment-form" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><input type="hidden" name="parent_comment_id"><div class="replying-to" data-replying-to hidden><span></span>${button("Cancel", "button ghost", "type=button data-cancel-reply")}</div><div class="form-row"><label>Add comment</label><textarea name="body" required data-markdown-editor data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"></textarea>${markdownHint()}</div>${button("Post comment", "button primary", "type=submit")}</form></div>`);
}

function workCommentsPanel(workId, versions, comments, currentVersionId = "") {
  const targetType = currentVersionId ? "version" : "work";
  const targetId = currentVersionId || workId;
  return panel("Comments", `<div class="grid">${(comments || []).map((comment) => {
    const isPreviousVersion = comment.target_type === "version" && comment.version_id && comment.version_id !== currentVersionId;
    return commentArticle(comment, {
      metaExtras: () => isPreviousVersion ? button(`v${comment.version_number || ""}`, "version-pill", `type="button" data-version-overlay="${escapeHtml(comment.version_id)}" title="View previous version"`) : "",
    });
  }).join("") || empty("No comments yet.")}<form class="form comment-form" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><input type="hidden" name="parent_comment_id"><div class="replying-to" data-replying-to hidden><span></span>${button("Cancel", "button ghost", "type=button data-cancel-reply")}</div><div class="form-row"><label>Add comment</label><textarea name="body" required data-markdown-editor data-target-type="work" data-target-id="${escapeHtml(workId)}"></textarea>${markdownHint()}</div>${button("Post comment", "button primary", "type=submit")}</form></div>`);
}

function bindCommentForm(defaultType, defaultId) {
  document.querySelectorAll(".comment-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      syncMarkdownEditors(form);
      const bodyValue = field(form, "body").value.trim();
      if (!bodyValue) return toast("Comment is required", "error");
      const body = {
        target_type: form.dataset.targetType || defaultType,
        target_id: form.dataset.targetId || defaultId,
        body: bodyValue,
      };
      if (field(form, "parent_comment_id")?.value) body.parent_comment_id = field(form, "parent_comment_id").value;
      try {
        await api("/api/comments", { method: "POST", body });
        toast(body.parent_comment_id ? "Reply posted" : "Comment posted");
        renderRoute();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

function bindVersionOverlay(versions = []) {
  document.querySelectorAll("[data-version-overlay]").forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      const version = versions.find((item) => item.id === buttonEl.dataset.versionOverlay);
      if (!version) return;
      const overlay = document.createElement("div");
      overlay.className = "modal-backdrop";
      overlay.innerHTML = `<section class="modal-panel" role="dialog" aria-modal="true"><div class="panel-header"><h2>Version ${escapeHtml(version.version_number)}</h2><button class="icon-button" data-close-modal aria-label="Close" type="button">x</button></div><div class="panel-body">${version.preview_url ? `<div class="media-frame compact"><img src="${escapeHtml(version.preview_url)}" alt=""></div>` : empty("No preview available.")}<div class="toolbar" style="margin-top:14px">${version.original_url ? `<a class="button" href="${escapeHtml(version.original_url)}">Open original</a>` : ""}</div></div></section>`;
      document.body.append(overlay);
      overlay.querySelector("[data-close-modal]")?.addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) overlay.remove();
      });
    });
  });
}

async function renderNewGallery() {
  if (!(await ensureAuthed())) return;
  setApp(pageShell(`<section class="view"><div><p class="eyebrow">Gallery</p><h1>New gallery</h1><p class="lede">Galleries are private by default. Whole-server visibility means logged-in members only.</p></div>${panel("Details", `<form class="form" id="gallery-form"><div class="form-row"><label>Title</label><input name="title" required></div><div class="form-row"><label>Description</label><textarea name="description" data-markdown-editor></textarea>${markdownHint()}</div><div class="form-row"><label>Ownership</label><select name="ownership_type"><option value="self">Self-owned</option><option value="collaborative">Collaborative</option><option value="whole_server">Whole Server</option></select><span class="field-hint choice-hint" data-ownership-help>${ownershipHelp("self")}</span></div><div class="form-row"><label>Visibility</label><select name="visibility"><option value="private">Private</option><option value="server_public">Whole Server</option></select><span class="field-hint choice-hint" data-visibility-help>${visibilityHelp("private")}</span></div>${button("Create gallery", "button primary", "type=submit")}</form>`)}</section>`));
  bindJsonForm("#gallery-form", async (body) => {
    const data = await api("/api/galleries", { method: "POST", body });
    await loadGalleries();
    navigate(`/galleries/${data.gallery.id}`);
  });
  bindChoiceHelp(document.querySelector("#gallery-form"));
}

function bindChoiceHelp(scope) {
  const ownership = scope?.querySelector?.("[name=ownership_type]");
  const ownershipText = scope?.querySelector?.("[data-ownership-help]");
  const visibility = scope?.querySelector?.("[name=visibility]");
  const visibilityText = scope?.querySelector?.("[data-visibility-help]");
  ownership?.addEventListener("change", () => {
    ownershipText.textContent = ownershipHelp(ownership.value);
    if (ownership.value === "whole_server" && visibility) {
      visibility.value = "server_public";
      visibilityText.textContent = visibilityHelp("server_public");
    }
  });
  visibility?.addEventListener("change", () => {
    visibilityText.textContent = visibilityHelp(visibility.value);
  });
}

async function renderGallery(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/galleries/${encodePath(id)}`);
  const gallery = data.gallery;
  const works = [...(data.works || [])].sort(newestFirst);
  const comments = await api(`/api/comments?target_type=gallery&target_id=${encodePath(id)}`).catch(() => ({ comments: [] }));
  const memberBox = `${gallery.ownership_type === "whole_server" ? `<div class="notice compact">Whole Server gallery: any logged-in member can post images here. Gallery settings are still limited to gallery admins and instance admins.</div>` : ""}<div class="grid">${(data.members || []).map((member) => `<article class="member-card"><h3 class="card-title">@${escapeHtml(member.handle)}</h3><p class="description">${escapeHtml(member.role_label)}</p><div class="badge-row">${["view", "edit", "upload_work", "comment", "manage_collaborators"].filter((key) => member[`can_${key}`] || (key === "view" && member.can_view)).map((key) => badge(key)).join("")}</div></article>`).join("") || empty("No explicit gallery members yet.")}</div>`;
  setApp(pageShell(`<section class="view gallery-view"><div class="view-header"><div><p class="eyebrow">Gallery</p><h1>${escapeHtml(gallery.title)}</h1><div class="lede markdown-body">${renderMarkdown(gallery.description || "No description")}</div><div class="badge-row">${badge(gallery.visibility === "server_public" ? "Whole Server" : "private")}${badge(ownershipLabel(gallery.ownership_type))}</div></div><div class="toolbar">${gallery.capabilities.upload_work ? button("+", "button primary square-button", "data-show-upload") : ""}${gallery.capabilities.edit ? link(`/galleries/${id}/settings`, "Settings", "button") : ""}</div></div><section class="gallery-drop-surface" data-gallery-drop-surface>${works.length ? imageGrid(works) : empty(gallery.capabilities.upload_work ? "Drop images here or use the + button to start this gallery." : "No works in this gallery yet.")}</section>${gallery.capabilities.upload_work ? createWorkPanel(id) : ""}<div class="home-lower-grid">${commentsPanel("gallery", id, comments.comments)}${panel("Members", memberBox)}</div></section>`));
  bindCreateWork(id);
  bindGalleryDropSurface();
  bindCommentForm("gallery", id);
}

function createWorkPanel(galleryId) {
  return `<form class="sr-only" id="work-form" data-gallery-id="${escapeHtml(galleryId)}"><input id="work-file" name="file" type="file" accept="image/*" capture="environment"><span data-file-name>No image selected</span></form>`;
}

function bindCreateWork(galleryId) {
  const input = document.querySelector("#work-file");
  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) openWorkUploadModal(galleryId, file);
  });
  document.querySelector("[data-show-upload]")?.addEventListener("click", () => input?.click());
}

function workRoleLabels() {
  return [...new Set([...(state.roleSuggestions || []).map((role) => role.label), ...DEFAULT_WORK_ROLES].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function roleDatalist(id = "work-role-options") {
  return `<datalist id="${escapeHtml(id)}">${workRoleLabels().map((role) => `<option value="${escapeHtml(role)}"></option>`).join("")}</datalist>`;
}

function collaboratorLabel(collab) {
  if (collab.linked_handle) return `<a href="/members/${encodePath(collab.linked_handle)}" data-link>@${escapeHtml(collab.linked_handle)}</a>`;
  return escapeHtml(collab.display_name || "collaborator");
}

function collaboratorCreditRows(options = {}) {
  const listId = options.listId || "work-role-options";
  const rows = options.rows || 1;
  return `<div class="collaborator-credit-grid" data-collaborator-grid><div class="collaborator-credit-head">User</div><div class="collaborator-credit-head">Role</div>${Array.from({ length: rows }).map(() => `<input name="collaborator_user" placeholder="@handle or credited name" autocomplete="off"><input name="role_label" list="${escapeHtml(listId)}" placeholder="photographer">`).join("")}</div><div class="toolbar">${button("+ collaborator", "button ghost", "type=button data-add-collaborator-row")}</div>${roleDatalist(listId)}`;
}

function collaboratorPayloads(scope) {
  const users = Array.from(scope.querySelectorAll("[name=collaborator_user]"));
  return users.map((userInput) => {
    const roleInput = userInput.nextElementSibling?.matches?.("[name=role_label]") ? userInput.nextElementSibling : null;
    return { user: userInput.value.trim(), role_label: roleInput?.value.trim() || "" };
  }).filter((item) => item.user || item.role_label);
}

async function addCollaborators(workId, collaborators) {
  for (const collaborator of collaborators) {
    if (collaborator.user) await api(`/api/works/${encodePath(workId)}/collaborators`, { method: "POST", body: collaborator });
  }
}

function bindCollaboratorRows(scope = document) {
  scope.querySelectorAll("[data-add-collaborator-row]").forEach((control) => {
    control.addEventListener("click", () => {
      const form = control.closest("form");
      const grid = form?.querySelector("[data-collaborator-grid]");
      if (!grid) return;
      const user = document.createElement("input");
      user.name = "collaborator_user";
      user.placeholder = "@handle or credited name";
      user.autocomplete = "off";
      const role = document.createElement("input");
      role.name = "role_label";
      role.placeholder = "photographer";
      role.setAttribute("list", grid.querySelector("[name=role_label]")?.getAttribute("list") || "work-role-options");
      grid.append(user, role);
      user.focus();
    });
  });
}

async function openWorkUploadModal(galleryId, file) {
  await loadRoleSuggestions();
  const previewUrl = URL.createObjectURL(file);
  const title = file.name ? file.name.replace(/\.[^.]+$/, "") : "";
  const uploadKey = clientKey("work-upload");
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.dataset.uploadModal = "true";
  modal.innerHTML = `<section class="modal-panel upload-modal" role="dialog" aria-modal="true"><div class="panel-header"><h2>Add image details</h2><button class="icon-button" data-close-modal aria-label="Close" type="button">x</button></div><div class="panel-body"><div class="upload-preview"><img src="${escapeHtml(previewUrl)}" alt=""></div><form class="form" data-upload-details-form><div class="form-row"><label>Title</label><input name="title" value="${escapeHtml(title)}" placeholder="Defaults to file name"></div><div class="form-row"><label>Description</label><textarea name="description" data-markdown-editor data-target-type="gallery" data-target-id="${escapeHtml(galleryId)}"></textarea>${markdownHint()}</div><div class="form-row"><label>Collaborators</label>${collaboratorCreditRows({ listId: "upload-work-role-options" })}</div><div class="toolbar">${button("Cancel", "button ghost", "type=button data-close-modal")}${button("Upload image", "button primary", "type=submit")}</div></form></div></section>`;
  const close = () => {
    URL.revokeObjectURL(previewUrl);
    modal.remove();
    const input = document.querySelector("#work-file");
    if (input) input.value = "";
  };
  document.body.append(modal);
  enhanceMarkdownEditors(modal);
  bindCollaboratorRows(modal);
  modal.querySelectorAll("[data-close-modal]").forEach((control) => control.addEventListener("click", close));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  modal.querySelector("[data-upload-details-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true") return;
    syncMarkdownEditors(form);
    const collaborators = collaboratorPayloads(form);
    const body = new FormData();
    body.set("file", file);
    body.set("title", field(form, "title").value || title || "Untitled image");
    body.set("description", field(form, "description").value || "");
    body.set("client_upload_key", uploadKey);
    body.set("collaborators_json", JSON.stringify(collaborators));
    const submit = form.querySelector("[type=submit]");
    form.dataset.submitting = "true";
    submit?.setAttribute("disabled", "disabled");
    const previousLabel = submit?.textContent || "";
    if (submit) submit.textContent = "Preparing...";
    try {
      const { preview, thumbnail } = await imageUploadVariants(file);
      body.set("preview", preview);
      body.set("thumbnail", thumbnail);
      if (submit) submit.textContent = "Uploading...";
      const data = await api(`/api/galleries/${encodePath(galleryId)}/works`, { method: "POST", body });
      await loadRoleSuggestions();
      const failed = (data.collaborator_results || []).filter((result) => !result.ok);
      if (failed.length) toast(`Image uploaded, but ${failed.length} collaborator${failed.length === 1 ? "" : "s"} could not be added.`, "error");
      else toast(data.duplicate ? "Upload already completed" : "Image uploaded");
      close();
      navigate(`/works/${data.work.id}`);
    } catch (error) {
      toast(error.message, "error");
      form.dataset.submitting = "false";
      submit?.removeAttribute("disabled");
      if (submit) submit.textContent = previousLabel;
    }
  });
}

function bindGalleryDropSurface() {
  const surface = document.querySelector("[data-gallery-drop-surface]");
  const form = document.querySelector("#work-form");
  if (!surface || !form) return;
  for (const eventName of ["dragenter", "dragover"]) {
    surface.addEventListener(eventName, (event) => {
      event.preventDefault();
      surface.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    surface.addEventListener(eventName, (event) => {
      event.preventDefault();
      surface.classList.remove("is-dragging");
    });
  }
  surface.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) openWorkUploadModal(form.dataset.galleryId, file);
  });
}

async function renderGallerySettings(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/galleries/${encodePath(id)}`);
  const gallery = data.gallery;
  if (!gallery.capabilities.edit) return navigate(`/galleries/${id}`);
  setApp(pageShell(`<section class="view"><div><p class="eyebrow">Gallery settings</p><h1>${escapeHtml(gallery.title)}</h1></div><div class="grid two">${panel("Details", `<form class="form" id="gallery-settings-form"><div class="form-row"><label>Title</label><input name="title" value="${escapeHtml(gallery.title)}" required></div><div class="form-row"><label>Description</label><textarea name="description" data-markdown-editor data-target-type="gallery" data-target-id="${escapeHtml(id)}">${escapeHtml(gallery.description)}</textarea>${markdownHint()}</div><div class="form-row"><label>Ownership</label><select name="ownership_type"><option value="self" ${gallery.ownership_type === "self" ? "selected" : ""}>Self-owned</option><option value="collaborative" ${gallery.ownership_type === "collaborative" ? "selected" : ""}>Collaborative</option><option value="whole_server" ${gallery.ownership_type === "whole_server" ? "selected" : ""}>Whole Server</option></select><span class="field-hint choice-hint" data-ownership-help>${ownershipHelp(gallery.ownership_type)}</span></div><div class="form-row"><label>Visibility</label><select name="visibility"><option value="private" ${gallery.visibility === "private" ? "selected" : ""}>Private</option><option value="server_public" ${gallery.visibility === "server_public" ? "selected" : ""}>Whole Server</option></select><span class="field-hint choice-hint" data-visibility-help>${visibilityHelp(gallery.visibility)}</span></div><div class="form-row"><label>Gallery preview image</label><select name="cover_version_id"><option value="">Use fallback</option>${(data.works || []).filter((work) => work.current_version?.thumbnail_url).map((work) => `<option value="${escapeHtml(work.current_version.id)}" ${gallery.cover_version_id === work.current_version.id ? "selected" : ""}>${escapeHtml(work.title)}</option>`).join("")}</select></div>${button("Save gallery", "button primary", "type=submit")}</form>`)}${panel("Members", `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Capabilities</th></tr></thead><tbody>${(data.members || []).map((member) => `<tr><td>@${escapeHtml(member.handle)}</td><td>${escapeHtml(member.role_label)}</td><td>${["view", "edit", "upload_work", "comment", "manage_collaborators"].filter((key) => member[`can_${key}`] || (key === "view" && member.can_view)).join(", ")}</td></tr>`).join("")}</tbody></table></div>`)}</div></section>`));
  bindJsonForm("#gallery-settings-form", async (body) => {
    await api(`/api/galleries/${encodePath(id)}`, { method: "PATCH", body });
    await loadGalleries();
    toast("Gallery saved");
    renderRoute();
  });
  bindChoiceHelp(document.querySelector("#gallery-settings-form"));
}

function currentWorkGallery(work) {
  return (work.galleries || [])[0] || { id: work.gallery_id, title: work.gallery_title || "Gallery" };
}

async function renderWork(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/works/${encodePath(id)}`);
  const work = data.work;
  const version = work.current_version;
  const gallery = currentWorkGallery(work);
  const comments = await api(`/api/works/${encodePath(id)}/comments`).catch(() => ({ comments: [] }));
  const media = version?.preview_url ? `<div class="media-frame"><img src="${escapeHtml(version.preview_url)}" alt=""></div>` : empty("No image version is available.");
  setApp(pageShell(`<section class="view work-view"><div class="view-header"><div><p class="eyebrow"><a href="/galleries/${escapeHtml(gallery.id)}" data-link>${escapeHtml(gallery.title)}</a></p><h1>${escapeHtml(work.title)}</h1><div class="lede markdown-body">${renderMarkdown(work.description || "")}</div><div class="badge-row">${badge("image")}</div></div><div class="toolbar">${reactionButton("work", id, work.reactions)}${work.feedback_requested && !work.feedback_dismissed ? button("Dismiss feedback request", "button ghost", `data-dismiss-feedback="${escapeHtml(id)}"`) : ""}${link(`/works/${id}/versions`, "Versions", "button")}${work.capabilities.edit ? link(`/works/${id}/edit`, "Edit", "button primary") + button("Delete", "button warn", `data-delete-work="${escapeHtml(id)}" data-after-delete="/galleries/${escapeHtml(gallery.id)}"`) : ""}</div></div>${media}<div class="grid two">${panel("Collaborators", (data.collaborators || []).map((collab) => `<article class="comment-card"><h3 class="card-title">${collaboratorLabel(collab)}</h3><p class="description">${escapeHtml(collab.role_label || "collaborator")}</p></article>`).join("") || empty("No collaborators credited yet."))}${workCommentsPanel(id, data.versions || [], comments.comments, version?.id || "")}</div></section>`));
  bindCommentForm("work", id);
  bindVersionOverlay(data.versions || []);
  bindFeedbackDismiss();
  bindDeleteWork();
}

function existingCollaborators(collaborators, workId) {
  if (!collaborators?.length) return empty("No collaborators credited yet.");
  return `<div class="collaborator-list">${collaborators.map((collab) => `<div class="collaborator-list-row"><span>${collaboratorLabel(collab)}</span><strong>${escapeHtml(collab.role_label || "collaborator")}</strong>${button("Remove", "button ghost", `type=button data-remove-collaborator="${escapeHtml(collab.id)}" data-work-id="${escapeHtml(workId)}"`)}</div>`).join("")}</div>`;
}

async function renderWorkEdit(id) {
  if (!(await ensureAuthed())) return;
  const [data] = await Promise.all([api(`/api/works/${encodePath(id)}`), loadRoleSuggestions(), loadGalleries()]);
  const work = data.work;
  const linkedIds = new Set((work.galleries || []).map((gallery) => gallery.id));
  const crosspostOptions = state.galleries.filter((gallery) => gallery.capabilities?.upload_work && !linkedIds.has(gallery.id));
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Edit image</p><h1>${escapeHtml(work.title)}</h1></div><div class="toolbar">${button(work.feedback_requested ? "Clear feedback request" : "Request feedback", "button", `data-toggle-feedback="${escapeHtml(id)}" data-feedback-requested="${work.feedback_requested ? "true" : "false"}"`)}${button("Delete", "button warn", `data-delete-work="${escapeHtml(id)}" data-after-delete="${escapeHtml(work.galleries?.[0]?.id ? `/galleries/${work.galleries[0].id}` : "/galleries")}"`)}</div></div><div class="grid two">${panel("Details", `<form class="form" id="work-edit-form"><div class="form-row"><label>Title</label><input name="title" value="${escapeHtml(work.title)}" required></div><div class="form-row"><label>Description</label><textarea name="description" data-markdown-editor data-target-type="work" data-target-id="${escapeHtml(id)}">${escapeHtml(work.description || "")}</textarea>${markdownHint()}</div>${button("Save work", "button primary", "type=submit")}</form><hr><form class="form" id="crosspost-form"><div class="form-row"><label>Galleries</label><div class="collaborator-list">${(work.galleries || []).map((gallery) => `<div class="collaborator-list-row"><span><a href="/galleries/${escapeHtml(gallery.id)}" data-link>${escapeHtml(gallery.title)}</a></span><strong>${escapeHtml(relativeTime(gallery.updated_at || gallery.created_at))}</strong>${(work.galleries || []).length > 1 ? button("Remove", "button ghost", `type=button data-remove-work-gallery="${escapeHtml(gallery.id)}"`) : ""}</div>`).join("")}</div></div><div class="form-row"><label>Crosspost to gallery</label><select name="gallery_id"><option value="">Choose a gallery</option>${crosspostOptions.map((gallery) => `<option value="${escapeHtml(gallery.id)}">${escapeHtml(gallery.title)}</option>`).join("")}</select></div>${button("Add to gallery", "button", "type=submit")}</form><hr><div class="form-row"><label>Collaborators</label>${existingCollaborators(data.collaborators || [], id)}</div><form class="form" id="collab-form"><div class="form-row"><label>Add collaborator</label>${collaboratorCreditRows({ listId: "edit-work-role-options" })}</div>${button("Add collaborator", "button", "type=submit")}</form>`)}${panel("New Version", `<form class="form" id="version-form"><label class="drop-zone" for="version-file" data-drop-zone><input id="version-file" name="file" type="file" accept="image/*" capture="environment" required><span>Drop a replacement image here, choose a file, or use the camera on mobile.</span><strong data-file-name>No image selected</strong></label>${button("Create version", "button primary", "type=submit")}</form>`)}</div></section>`));
  bindJsonForm("#work-edit-form", async (body) => {
    await api(`/api/works/${encodePath(id)}`, { method: "PATCH", body });
    toast("Work saved");
    renderRoute();
  });
  bindJsonForm("#crosspost-form", async (body) => {
    if (!body.gallery_id) return toast("Choose a gallery", "error");
    await api(`/api/works/${encodePath(id)}/galleries`, { method: "POST", body });
    await loadGalleries();
    toast("Work added to gallery");
    renderRoute();
  });
  document.querySelectorAll("[data-remove-work-gallery]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/works/${encodePath(id)}/galleries/${encodePath(control.dataset.removeWorkGallery)}`, { method: "DELETE" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
  bindJsonForm("#collab-form", async (body, form) => {
    await addCollaborators(id, collaboratorPayloads(form));
    await loadRoleSuggestions();
    toast("Collaborator added");
    renderRoute();
  });
  bindCollaboratorRows(document);
  bindRemoveCollaborator();
  bindVersionForm(id);
  bindFeedbackToggle(id);
  bindDeleteWork();
}

function bindDeleteWork() {
  document.querySelectorAll("[data-delete-work]").forEach((control) => {
    control.addEventListener("click", async () => {
      if (!confirm("Delete this work? It will be hidden from galleries and feeds.")) return;
      control.setAttribute("disabled", "disabled");
      try {
        await api(`/api/works/${encodePath(control.dataset.deleteWork)}`, { method: "DELETE" });
        toast("Work deleted");
        navigate(control.dataset.afterDelete || "/galleries");
      } catch (error) {
        toast(error.message, "error");
        control.removeAttribute("disabled");
      }
    });
  });
}

function bindRemoveCollaborator() {
  document.querySelectorAll("[data-remove-collaborator]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/works/${encodePath(control.dataset.workId)}/collaborators/${encodePath(control.dataset.removeCollaborator)}`, { method: "DELETE" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
}

function bindVersionForm(id) {
  const form = document.querySelector("#version-form");
  const input = form?.querySelector("[name=file]");
  const label = form?.querySelector("[data-file-name]");
  const submit = form?.querySelector("[type=submit]");
  input?.addEventListener("change", () => {
    label.textContent = input.files?.[0]?.name || "No image selected";
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = input?.files?.[0];
    if (!file) return toast("Choose an image", "error");
    const previousLabel = submit?.textContent || "";
    submit?.setAttribute("disabled", "disabled");
    try {
      if (submit) submit.textContent = "Preparing...";
      const body = new FormData(form);
      const { preview, thumbnail } = await imageUploadVariants(file);
      body.set("preview", preview);
      body.set("thumbnail", thumbnail);
      if (submit) submit.textContent = "Creating...";
      await api(`/api/works/${encodePath(id)}/versions`, { method: "POST", body });
      navigate(`/works/${id}/versions`);
    } catch (error) {
      toast(error.message, "error");
      submit?.removeAttribute("disabled");
      if (submit) submit.textContent = previousLabel;
    }
  });
}

function bindFeedbackToggle(id) {
  document.querySelector("[data-toggle-feedback]")?.addEventListener("click", async (event) => {
    const requested = event.currentTarget.dataset.feedbackRequested === "true";
    await api(`/api/works/${encodePath(id)}/feedback-requested`, { method: "POST", body: { feedback_requested: !requested } }).catch((error) => toast(error.message, "error"));
    renderRoute();
  });
}

function bindFeedbackDismiss() {
  document.querySelector("[data-dismiss-feedback]")?.addEventListener("click", async (event) => {
    await api(`/api/works/${encodePath(event.currentTarget.dataset.dismissFeedback)}/feedback-requested/dismiss`, { method: "POST" }).catch((error) => toast(error.message, "error"));
    renderRoute();
  });
}

async function renderWorkVersions(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/works/${encodePath(id)}`);
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Versions</p><h1>${escapeHtml(data.work.title)}</h1></div><div class="toolbar">${link(`/works/${id}`, "Back to work", "button")}</div></div><div class="grid">${(data.versions || []).map((version) => `<article class="version-card"><h3 class="card-title">Version ${escapeHtml(version.version_number)}</h3><div class="meta-row">${escapeHtml(formatDate(version.created_at))}</div><div class="toolbar">${version.original_url ? link(version.original_url, "Original", "button") : ""}${version.preview_url ? link(version.preview_url, "Preview", "button") : ""}</div></article>`).join("") || empty("No versions yet.")}</div></section>`));
}

async function renderMyProfile() {
  if (!(await ensureAuthed())) return;
  const me = state.me;
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Profile</p><h1>@${escapeHtml(me.handle)}</h1></div><div class="toolbar">${link("/me/exports", "Exports", "button")}</div></div><div class="grid two">${panel("Details", `<form class="form" id="profile-form"><div class="form-row"><label>Handle</label><input name="handle" value="${escapeHtml(me.handle)}" required></div><div class="form-row"><label>Bio</label><textarea name="bio" data-markdown-editor data-target-type="profile" data-target-id="${escapeHtml(me.id)}">${escapeHtml(me.bio || "")}</textarea>${markdownHint()}</div><div class="form-row"><label>Links JSON</label><textarea name="links">${escapeHtml(JSON.stringify(me.links || [], null, 2))}</textarea></div>${button("Save profile", "button primary", "type=submit")}</form>`)}${panel("Medium Tags", `<form class="form" id="tag-form"><div class="form-row"><label>Tags</label><input name="tags" value="${escapeHtml((me.medium_tags || []).join(", "))}"><span class="field-hint">Comma-separated medium tags.</span></div>${button("Save tags", "button", "type=submit")}</form>`)}</div></section>`));
  bindJsonForm("#profile-form", async (body) => {
    await api("/api/users/me", { method: "PATCH", body });
    await refreshMe();
    toast("Profile saved");
    renderRoute();
  });
  bindJsonForm("#tag-form", async (body) => {
    await api("/api/users/me/medium-tags", { method: "POST", body: { tags: body.tags } });
    await refreshMe();
    toast("Tags saved");
    renderRoute();
  });
}

async function renderExports() {
  if (!(await ensureAuthed())) return;
  const data = await api("/api/exports/me").catch(() => ({ exports: [] }));
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Exports</p><h1>Your data exports</h1></div><div>${button("Create export", "button primary", "data-create-export")}</div></div>${panel("Exports", `<div class="grid">${(data.exports || []).map((item) => `<article class="export-card"><h3 class="card-title">${escapeHtml(item.status)}</h3><p class="description">${escapeHtml(formatDate(item.created_at))}</p>${item.status === "ready" ? link(`/api/exports/${item.id}`, "Open export", "button") : ""}</article>`).join("") || empty("No exports yet.")}</div>`)}</section>`));
  document.querySelector("[data-create-export]")?.addEventListener("click", async () => {
    await api("/api/exports/me", { method: "POST" }).catch((error) => toast(error.message, "error"));
    renderRoute();
  });
}

async function renderAdmin() {
  if (!(await ensureAuthed())) return;
  const [admin, settings, members, events] = await Promise.all([
    api("/api/admin"),
    api("/api/admin/settings").catch(() => ({})),
    api("/api/members").catch(() => ({ members: [] })),
    api("/api/admin/events").catch(() => ({ events: [] })),
  ]);
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Admin</p><h1>Instance settings</h1></div><div>${link("/admin/invites", "Invites", "button primary")}</div></div><div class="stat-grid"><div class="stat"><strong>${admin.members}</strong><span>Members</span></div><div class="stat"><strong>${admin.active_invites}</strong><span>Invites</span></div><div class="stat"><strong>${admin.events}</strong><span>Events</span></div></div><div class="grid two">${panel("Branding", `<form class="form" id="settings-form"><div class="form-row"><label>Instance name</label><input name="instance_name" value="${escapeHtml(settings.name || state.instance.name)}"></div><div class="form-row"><label>Source code URL</label><input name="source_code_url" value="${escapeHtml(settings.source_code_url || state.instance.source_code_url || "")}"></div><div class="form-row"><label>Logo</label><input name="logo" type="file" accept="image/*"></div>${button("Save settings", "button primary", "type=submit")}</form>`)}${panel("Members", `<div class="grid">${(members.members || []).map((member) => `<article class="member-card"><h3 class="card-title">@${escapeHtml(member.handle)}</h3><p class="description">${escapeHtml(member.role)}</p></article>`).join("")}</div>`)}</div>${panel("Recent Instance Events", eventList(events.events || []))}</section>`));
  document.querySelector("#settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/admin/settings", { method: "POST", body: new FormData(event.currentTarget) }).catch((error) => toast(error.message, "error"));
    await refreshMe();
    renderRoute();
  });
}

async function renderAdminInvites() {
  if (!(await ensureAuthed())) return;
  const data = await api("/api/admin/invites");
  setApp(pageShell(`<section class="view"><div class="view-header"><div><p class="eyebrow">Admin</p><h1>Invites</h1></div></div><div class="grid two">${panel("Create Invite", `<form class="form" id="invite-create-form"><div class="form-row"><label>Max uses</label><input name="max_uses" type="number" min="1" value="1"></div><div class="form-row"><label>Expires at</label><input name="expires_at" type="datetime-local"></div><div class="form-row"><label>Role on join</label><select name="role_on_join"><option value="member">Member</option><option value="admin">Admin</option></select></div>${button("Create invite", "button primary", "type=submit")}</form>`)}${panel("Existing Invites", `<div class="grid">${(data.invites || []).map((invite) => `<article class="invite-card"><h3 class="card-title">${escapeHtml(invite.role_on_join)}</h3><p class="description">${escapeHtml(invite.revoked_at ? "revoked" : `${invite.use_count}/${invite.max_uses} used`)}</p>${!invite.revoked_at ? button("Revoke", "button warn", `data-revoke="${escapeHtml(invite.id)}"`) : ""}</article>`).join("") || empty("No invites yet.")}</div>`)}</div></section>`));
  bindJsonForm("#invite-create-form", async (body) => {
    const created = await api("/api/admin/invites", { method: "POST", body });
    const url = `${location.origin}${created.invite.url}`;
    await navigator.clipboard?.writeText(`Welcome to my ${state.instance.name || "QuietCollective"} community. Use this invite link: ${url}`).catch(() => undefined);
    toast("Invite created and copied");
    renderRoute();
  });
  document.querySelectorAll("[data-revoke]").forEach((control) => {
    control.addEventListener("click", async () => {
      await api(`/api/admin/invites/${control.dataset.revoke}/revoke`, { method: "POST" }).catch((error) => toast(error.message, "error"));
      renderRoute();
    });
  });
}

async function renderNotFound() {
  if (!(await ensureAuthed())) return;
  setApp(pageShell(`<section class="view">${empty("Page not found.")}</section>`));
}

async function renderRoute() {
  document.body.classList.remove("nav-open");
  const path = location.pathname;
  try {
    for (const [pattern, handler] of routes) {
      if (typeof pattern === "string" && pattern === path) {
        await handler();
        return;
      }
      if (pattern instanceof RegExp) {
        const match = path.match(pattern);
        if (match) {
          await handler(...match.slice(1));
          return;
        }
      }
    }
    await renderNotFound();
  } catch (error) {
    if (error.status === 401) {
      navigate("/login");
      return;
    }
    setApp(pageShell(`<section class="view"><div class="error-box"><strong>${escapeHtml(error.message || "Something went wrong")}</strong></div></section>`));
  }
}

window.addEventListener("popstate", renderRoute);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

renderRoute();
