// @ts-nocheck
import { api, encodePath, ensureAuthed, formDataObject, navigate, pageShell, renderRoute, setApp, state, syncMarkdownEditors, toast } from "../app/core";
import { bindCommentForm, highlightLinkedComment } from "../app/comments";
import { discussionBoardView, discussionsIndexView, discussionThreadView } from "../views/islands";

async function submitWithLock(form, handler) {
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
}

function bindForumBoardForms() {
  document.querySelectorAll("[data-forum-board-form]").forEach((form) => {
    if (form.dataset.bound === "true") return;
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitWithLock(form, async (body) => {
        const boardId = form.dataset.forumBoardForm;
        const creating = !boardId || boardId === "new";
        const data = creating
          ? await api("/api/forum/boards", { method: "POST", body })
          : await api(`/api/forum/boards/${encodePath(boardId)}`, { method: "PATCH", body });
        if (creating) navigate(`/discussions/boards/${encodePath(data.board.slug || data.board.id)}`);
        else renderRoute();
      });
    });
  });
}

function bindForumThreadForm() {
  const form = document.querySelector("[data-forum-thread-form]");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitWithLock(form, async (body) => {
      const boardId = form.dataset.boardId;
      const data = await api(`/api/forum/boards/${encodePath(boardId)}/threads`, { method: "POST", body });
      const hash = data.first_comment_id ? `#comment-${encodePath(data.first_comment_id)}` : "";
      navigate(`/discussions/threads/${encodePath(data.thread.id)}${hash}`);
    });
  });
}

async function renderDiscussions() {
  if (!(await ensureAuthed())) return;
  const data = await api("/api/forum/boards");
  setApp(pageShell(discussionsIndexView({
    boards: data.boards || [],
    recentThreads: data.recent_threads || [],
    isAdmin: state.me?.role === "admin",
  })));
  bindForumBoardForms();
}

async function renderDiscussionBoard(idOrSlug) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/forum/boards/${encodePath(idOrSlug)}`);
  setApp(pageShell(discussionBoardView({
    board: data.board,
    threads: data.threads || [],
    isAdmin: state.me?.role === "admin",
  })));
  bindForumThreadForm();
  bindForumBoardForms();
}

async function renderDiscussionThread(id) {
  if (!(await ensureAuthed())) return;
  const data = await api(`/api/forum/threads/${encodePath(id)}`);
  setApp(pageShell(discussionThreadView({
    board: data.board,
    thread: data.thread,
    comments: data.comments || [],
  })));
  bindCommentForm("thread", id);
  highlightLinkedComment();
}

export { renderDiscussionBoard, renderDiscussionThread, renderDiscussions };
