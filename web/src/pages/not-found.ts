// @ts-nocheck
import { empty, ensureAuthed, pageShell, setApp } from "../app/core";

async function renderNotFound() {
  if (!(await ensureAuthed())) return;
  setApp(pageShell(`<section class="view">${empty("Page not found.")}</section>`));
}


export { renderNotFound };
