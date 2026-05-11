// @ts-nocheck
import { ensureAuthed, pageShell, setApp } from "../app/core";
import { notFoundView } from "../views/islands";

async function renderNotFound() {
  if (!(await ensureAuthed())) return;
  setApp(pageShell(notFoundView()));
}


export { renderNotFound };
