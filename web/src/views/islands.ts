// @ts-nocheck
import { commentsPanel, commentArticle, workCommentsPanel } from "../app/comments";
import { collaboratorCreditRows, roleDatalist } from "../app/collaborators";
import { reactionButton } from "../app/interactions";
import { browserNotificationsPanel } from "../app/notifications";
import { islandPlaceholder } from "../components/islands";
import { currentWorkGallery } from "./works";

/** Mounts the TSX new-gallery form used by the `/galleries/new` route. */
export function newGalleryView() {
  return islandPlaceholder("new-gallery-view", {});
}

/** Mounts the TSX gallery detail view used by `/galleries/:id`. */
export function galleryDetailView({ id, gallery, works, comments, members }) {
  return islandPlaceholder("gallery-detail-view", {
    id,
    gallery,
    works,
    commentsHtml: commentsPanel("gallery", id, comments),
    reactionButtonHtml: reactionButton("gallery", id, gallery.reactions),
    members,
  });
}

/** Mounts the TSX add-to-gallery modal opened from a gallery detail page. */
export function addToGalleryModalView(gallery, canCrosspost = false) {
  return islandPlaceholder("add-to-gallery-modal-view", { gallery, canCrosspost });
}

/** Mounts the TSX crosspost modal shell while candidate works are loading. */
export function crosspostModalShellView(gallery) {
  return islandPlaceholder("crosspost-modal-shell-view", { gallery });
}

/** Mounts the TSX candidate picker inside the crosspost modal. */
export function crosspostPickerView(works, galleryId) {
  return islandPlaceholder("crosspost-picker-view", { works, galleryId });
}

/** Mounts the TSX target-gallery picker for crossposting a work. */
export function workCrosspostGalleryModalView(work, galleries) {
  return islandPlaceholder("work-crosspost-gallery-modal-view", { work, galleries });
}

/** Mounts the TSX image upload modal after a file is selected. */
export function workUploadModalView({ galleryId, previewUrl, title }) {
  return islandPlaceholder("work-upload-modal-view", {
    galleryId,
    previewUrl,
    title,
    collaboratorRowsHtml: collaboratorCreditRows({ listId: "upload-work-role-options" }),
  });
}

/** Mounts a small TSX modal error notice. */
export function modalErrorView(message) {
  return islandPlaceholder("modal-error-notice", { message });
}

/** Mounts the TSX gallery settings route used by `/galleries/:id/settings`. */
export function gallerySettingsView({ id, gallery, works, members }) {
  return islandPlaceholder("gallery-settings-view", { id, gallery, works, members });
}

/** Mounts the TSX signed-in dashboard used by `/`. */
export function homeView(props) {
  return islandPlaceholder("home-view", props);
}

/** Mounts the TSX gallery index route at `/galleries`. */
export function galleriesIndexView(props) {
  return islandPlaceholder("galleries-index-view", props);
}

/** Mounts the TSX member directory route at `/members`. */
export function membersIndexView(members) {
  return islandPlaceholder("members-index-view", { members });
}

/** Mounts the TSX member profile route. */
export function memberProfileView({ user, comments, works }) {
  return islandPlaceholder("member-profile-view", { user, works, commentsHtml: commentsPanel("profile", user.id, comments) });
}

/** Mounts the TSX tag detail route. */
export function tagPageView(data) {
  const commentsHtml = data.comments?.length
    ? `<div class="grid">${data.comments.map((comment) => commentArticle(comment, { replyButton: false })).join("")}</div>`
    : "";
  return islandPlaceholder("tag-page-view", { data, commentsHtml });
}

/** Mounts the discussions index route. */
export function discussionsIndexView({ boards, recentThreads }) {
  return islandPlaceholder("discussions-index-view", { boards, recentThreads });
}

/** Mounts the admin-only new forum board route. */
export function newDiscussionBoardView() {
  return islandPlaceholder("new-discussion-board-view", {});
}

/** Mounts one forum board route. */
export function discussionBoardView({ board, threads, isAdmin }) {
  return islandPlaceholder("discussion-board-view", { board, threads, isAdmin });
}

/** Mounts one forum thread route. */
export function discussionThreadView({ board, thread, comments }) {
  return islandPlaceholder("discussion-thread-view", { board, thread, commentsHtml: commentsPanel("thread", thread.id, comments) });
}

/** Mounts the setup-disabled auth view. */
export function setupDisabledView() {
  return islandPlaceholder("setup-disabled-view", {});
}

/** Mounts the setup form auth view. */
export function setupFormView() {
  return islandPlaceholder("setup-form-view", {});
}

/** Mounts the login auth view. */
export function loginView(instanceName, subtitle = "") {
  return islandPlaceholder("login-view", { instanceName, subtitle });
}

/** Mounts the invite acceptance auth view. */
export function inviteView({ instanceName, roleOnJoin, subtitle }) {
  return islandPlaceholder("invite-view", { instanceName, roleOnJoin, subtitle });
}

/** Mounts the password reset request auth view. */
export function forgotPasswordView(instanceName) {
  return islandPlaceholder("forgot-password-view", { instanceName });
}

/** Mounts the password reset completion auth view. */
export function resetPasswordView() {
  return islandPlaceholder("reset-password-view", {});
}

/** Mounts the forced password change gate view. */
export function forcePasswordChangeView() {
  return islandPlaceholder("force-password-change-view", {});
}

/** Mounts the server rules acceptance gate view. */
export function rulesAcceptView(rules) {
  return islandPlaceholder("rules-accept-view", { rules });
}

/** Mounts the profile settings route at `/me/profile`. */
export function profileView(me) {
  return islandPlaceholder("profile-view", { me, browserNotificationsHtml: browserNotificationsPanel() });
}

/** Mounts the export list route at `/me/exports`. */
export function exportsView(exports) {
  return islandPlaceholder("exports-view", { exports });
}

/** Mounts the instance admin dashboard at `/admin`. */
export function adminView(props) {
  return islandPlaceholder("admin-view", props);
}

/** Mounts the invite management route at `/admin/invites`. */
export function adminInvitesView(invites) {
  return islandPlaceholder("admin-invites-view", { invites });
}

/** Mounts the fallback not-found route. */
export function notFoundView() {
  return islandPlaceholder("not-found-view", {});
}

export { currentWorkGallery };

/** Mounts the TSX work detail route at `/works/:id`. */
export function workDetailView({ id, work, gallery, comments, versions, collaborators, crosspostOptions, lightboxWorks, lightboxContext }) {
  return islandPlaceholder("work-detail-view", {
    id,
    work,
    gallery,
    commentsHtml: workCommentsPanel(id, versions || [], comments, work.current_version?.id || ""),
    reactionButtonHtml: reactionButton("work", id, work.reactions),
    collaborators,
    crosspostOptions,
    lightboxWorks,
    lightboxContext,
    collaboratorRowsHtml: roleDatalist("detail-work-role-options"),
  });
}

/** Mounts the TSX work edit route at `/works/:id/edit`. */
export function workEditView({ id, work, collaborators, crosspostOptions }) {
  return islandPlaceholder("work-edit-view", {
    id,
    work,
    collaborators,
    crosspostOptions,
    collaboratorRowsHtml: collaboratorCreditRows({ listId: "edit-work-role-options" }),
  });
}

/** Mounts the TSX work versions route at `/works/:id/versions`. */
export function workVersionsView({ id, work, versions }) {
  return islandPlaceholder("work-versions-view", { id, work, versions });
}
