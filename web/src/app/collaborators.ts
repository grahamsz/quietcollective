// @ts-nocheck
import { api, buttonIcon, DEFAULT_WORK_ROLES, encodePath, escapeHtml, state } from "./core";
import { bindMentionAutocomplete } from "./mentions";

function workRoleLabels() {
  return [...new Set([...(state.roleSuggestions || []).map((role) => role.label), ...DEFAULT_WORK_ROLES].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Renders the collaborator role suggestion list used by upload and work edit forms. */
function roleDatalist(id = "work-role-options") {
  return `<datalist id="${escapeHtml(id)}">${workRoleLabels().map((role) => `<option value="${escapeHtml(role)}"></option>`).join("")}</datalist>`;
}

/** Renders a linked or plain collaborator name used by work detail and edit views. */
function collaboratorLabel(collab) {
  if (collab.linked_handle) return `<a href="/members/${encodePath(collab.linked_handle)}" data-link>@${escapeHtml(collab.linked_handle)}</a>`;
  return escapeHtml(collab.display_name || "collaborator");
}

/** Renders collaborator credit input rows used by upload and work edit forms. */
function collaboratorCreditRows(options = {}) {
  const listId = options.listId || "work-role-options";
  const rows = options.rows || 1;
  const addLabel = options.addLabel || "collaborator";
  return `<div class="collaborator-credit-grid" data-collaborator-grid><div class="collaborator-credit-head">User</div><div class="collaborator-credit-head">Role</div>${Array.from({ length: rows }).map(() => `<input name="collaborator_user" placeholder="@handle or credited name" autocomplete="off"><input name="role_label" list="${escapeHtml(listId)}" placeholder="photographer">`).join("")}</div><div class="toolbar">${buttonIcon("plus", addLabel, "button ghost", "type=button data-add-collaborator-row")}</div>${roleDatalist(listId)}`;
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
  bindMentionAutocomplete(scope);
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
      bindMentionAutocomplete(grid);
      user.focus();
    });
  });
}


export { addCollaborators, bindCollaboratorRows, collaboratorCreditRows, collaboratorLabel, collaboratorPayloads, roleDatalist, workRoleLabels };
