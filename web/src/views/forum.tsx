// @ts-nocheck
import { Icon } from "../components/icon";
import { encodePath, relativeTime } from "../lib/utils";
import { renderMarkdown, renderMarkdownNoImages } from "../lib/markdown";

function Empty({ message }) {
  return <div class="empty-state">{message}</div>;
}

function Panel({ title, children, extra = "" }) {
  return (
    <section class={`panel ${extra}`}>
      <div class="panel-header"><h2>{title}</h2></div>
      <div class="panel-body">{children}</div>
    </section>
  );
}

function RawHtml({ html }) {
  return <div dangerouslySetInnerHTML={{ __html: html || "" }} />;
}

function MarkdownHint() {
  return <span class="field-hint">Markdown supported. Use @handle to mention members and #tag to tag ideas.</span>;
}

function boardDescription(board) {
  return board.description
    ? <div class="description markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdownNoImages(board.description) }} />
    : null;
}

function BoardCard({ board }) {
  const count = Number(board.thread_count || 0);
  return (
    <a class="member-card forum-board-card" href={`/discussions/boards/${encodePath(board.slug || board.id)}`} data-link>
      <div>
        <h3 class="card-title">{board.title}</h3>
        <p class="member-active">{count} thread{count === 1 ? "" : "s"}{board.latest_thread_at ? ` · ${relativeTime(board.latest_thread_at)}` : ""}</p>
      </div>
      {boardDescription(board)}
    </a>
  );
}

function ThreadRow({ thread }) {
  return (
    <a class="activity-row forum-thread-row" href={`/discussions/threads/${encodePath(thread.id)}`} data-link>
      <span class="activity-time">{relativeTime(thread.last_comment_at || thread.created_at)}</span>
      <span class="activity-copy">
        <span class="activity-summary">{thread.title}</span>
        {thread.preview ? <span class="activity-preview">{thread.preview}</span> : null}
      </span>
      <span class="forum-thread-meta">{thread.comment_count || 0}</span>
    </a>
  );
}

function ThreadList({ threads, emptyMessage = "No threads yet." }) {
  return threads?.length
    ? <div class="activity-list forum-thread-list">{threads.map((thread) => <ThreadRow thread={thread} key={thread.id} />)}</div>
    : <Empty message={emptyMessage} />;
}

function BoardForm({ board = null }) {
  const editing = !!board;
  return (
    <form class="form forum-board-form" data-forum-board-form={editing ? board.id : "new"}>
      <div class="grid two">
        <div class="form-row">
          <label>Title</label>
          <input name="title" required defaultValue={board?.title || ""} />
        </div>
        <div class="form-row">
          <label>Slug</label>
          <input name="slug" defaultValue={board?.slug || ""} />
        </div>
      </div>
      <div class="form-row">
        <label>Description</label>
        <textarea name="description" defaultValue={board?.description || ""} data-markdown-editor />
        <MarkdownHint />
      </div>
      <div class="form-row compact-field">
        <label>Sort</label>
        <input name="sort_order" type="number" defaultValue={String(board?.sort_order || 0)} />
      </div>
      <button class="button primary" type="submit">{editing ? "Save board" : "Create board"}</button>
    </form>
  );
}

function ThreadForm({ board }) {
  return (
    <form class="form" data-forum-thread-form data-board-id={board.id}>
      <div class="form-row">
        <label>Title</label>
        <input name="title" required />
      </div>
      <div class="form-row">
        <label>Post</label>
        <textarea name="body" required data-markdown-editor />
        <MarkdownHint />
      </div>
      <button class="button primary" type="submit">Start thread</button>
    </form>
  );
}

export function DiscussionsIndexView({ boards, recentThreads }) {
  return (
    <section class="view forum-view">
      <div class="view-header">
        <div>
          <p class="eyebrow">Discussions</p>
          <h1>Boards</h1>
        </div>
      </div>
      <div class="home-lower-grid">
        <Panel title="Boards">
          <div class="card-grid">{boards?.length ? boards.map((board) => <BoardCard board={board} key={board.id} />) : <Empty message="No boards yet." />}</div>
        </Panel>
        <Panel title="Recent Threads">
          <ThreadList threads={recentThreads || []} emptyMessage="No discussion yet." />
        </Panel>
      </div>
    </section>
  );
}

export function NewDiscussionBoardView() {
  return (
    <section class="view forum-view">
      <div class="view-header">
        <div>
          <p class="eyebrow"><a href="/discussions" data-link>Discussions</a></p>
          <h1>New board</h1>
        </div>
      </div>
      <Panel title="Board Details"><BoardForm /></Panel>
    </section>
  );
}

export function DiscussionBoardView({ board, threads, isAdmin }) {
  return (
    <section class="view forum-view">
      <div class="view-header">
        <div>
          <p class="eyebrow"><a href="/discussions" data-link>Discussions</a></p>
          <h1>{board.title}</h1>
          {board.description ? <div class="lede markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(board.description) }} /> : null}
        </div>
      </div>
      <div class="home-lower-grid">
        <Panel title="Threads"><ThreadList threads={threads || []} /></Panel>
        <Panel title="New Thread"><ThreadForm board={board} /></Panel>
      </div>
      {isAdmin ? <Panel title="Board Settings"><BoardForm board={board} /></Panel> : null}
    </section>
  );
}

export function DiscussionThreadView({ board, thread, commentsHtml }) {
  return (
    <section class="view forum-view">
      <div class="view-header">
        <div>
          <p class="eyebrow"><a href={`/discussions/boards/${encodePath(board.slug || board.id)}`} data-link>{board.title}</a></p>
          <h1>{thread.title}</h1>
          <p class="lede">Started by @{thread.author_handle || "member"} · {relativeTime(thread.created_at)}</p>
        </div>
        <div class="toolbar">
          <a href={`/discussions/boards/${encodePath(board.slug || board.id)}`} class="button square-button" data-link aria-label="Back to board" title="Back to board"><Icon name="chevron-left" /><span class="sr-only">Back to board</span></a>
        </div>
      </div>
      <RawHtml html={commentsHtml} />
    </section>
  );
}
