import { h, type ComponentChildren } from "preact";
import { render } from "preact";
import type { Gallery, Work } from "../types";
import { GalleryAccessChips, GalleryAccessRules, GalleryMosaic } from "./gallery-tile";
import { WorkGrid } from "./work-tile";
import {
  AddToGalleryModalView,
  CrosspostModalShellView,
  CrosspostPickerView,
  GalleryDetailView,
  GallerySettingsView,
  ModalErrorNotice,
  NewGalleryView,
  WorkUploadModalView,
} from "../views/galleries";
import { ExportsView, ProfileView } from "../views/account";
import { AdminInvitesView, AdminView } from "../views/admin";
import { ForcePasswordChangeView, ForgotPasswordView, InviteView, LoginView, ResetPasswordView, RulesAcceptView, SetupDisabledView, SetupFormView } from "../views/auth";
import { DiscussionBoardView, DiscussionsIndexView, DiscussionThreadView, NewDiscussionBoardView } from "../views/forum";
import { GalleriesIndexView, HomeView, MemberProfileView, MembersIndexView, TagPageView } from "../views/home";
import { NotFoundView } from "../views/not-found";
import { WorkCrosspostGalleryModalView, WorkDetailView, WorkEditView, WorkVersionsView } from "../views/works";

type Island = { component: string; props: Record<string, unknown> };

const islands = new Map<string, Island>();
let islandSequence = 0;

function nextIslandKey(component: string) {
  islandSequence += 1;
  return `${component}-${islandSequence}`;
}

export function islandPlaceholder(component: string, props: Record<string, unknown>, tag = "div") {
  const key = nextIslandKey(component);
  islands.set(key, { component, props } as Island);
  return `<${tag} data-component-island="${component}" data-component-island-key="${key}"></${tag}>`;
}

/** Creates a GalleryMosaic island placeholder used by string-rendered views. */
export function galleryMosaic(galleries: Gallery[]) {
  return islandPlaceholder("gallery-mosaic", { galleries });
}

/** Creates a GalleryAccessChips island placeholder for gallery and work page metadata. */
export function galleryAccessChips(gallery: Gallery, className = "") {
  return islandPlaceholder("gallery-access-chips", { gallery, className }, "span");
}

/** Creates a GalleryAccessRules island placeholder for the add-to-gallery modal. */
export function galleryAccessRules(gallery: Gallery) {
  return islandPlaceholder("gallery-access-rules", { gallery });
}

/** Creates a WorkGrid island placeholder used by galleries, feeds, and tag pages. */
export function imageGrid(works: Work[], options: { galleryId?: string; profileHandle?: string; tag?: string } = {}) {
  return islandPlaceholder("work-grid", { works, galleryId: options.galleryId || "", profileHandle: options.profileHandle || "", tag: options.tag || "" });
}

function islandNode(island: Island): ComponentChildren {
  const props = island.props as any;
  if (island.component === "gallery-mosaic") return <GalleryMosaic {...props} />;
  if (island.component === "gallery-access-chips") return <GalleryAccessChips {...props} />;
  if (island.component === "gallery-access-rules") return <GalleryAccessRules {...props} />;
  if (island.component === "work-grid") return <WorkGrid {...props} />;
  if (island.component === "new-gallery-view") return <NewGalleryView {...props} />;
  if (island.component === "gallery-detail-view") return <GalleryDetailView {...props} />;
  if (island.component === "add-to-gallery-modal-view") return <AddToGalleryModalView {...props} />;
  if (island.component === "crosspost-modal-shell-view") return <CrosspostModalShellView {...props} />;
  if (island.component === "crosspost-picker-view") return <CrosspostPickerView {...props} />;
  if (island.component === "work-upload-modal-view") return <WorkUploadModalView {...props} />;
  if (island.component === "modal-error-notice") return <ModalErrorNotice {...props} />;
  if (island.component === "gallery-settings-view") return <GallerySettingsView {...props} />;
  if (island.component === "home-view") return <HomeView {...props} />;
  if (island.component === "galleries-index-view") return <GalleriesIndexView {...props} />;
  if (island.component === "members-index-view") return <MembersIndexView {...props} />;
  if (island.component === "member-profile-view") return <MemberProfileView {...props} />;
  if (island.component === "tag-page-view") return <TagPageView {...props} />;
  if (island.component === "discussions-index-view") return <DiscussionsIndexView {...props} />;
  if (island.component === "new-discussion-board-view") return <NewDiscussionBoardView {...props} />;
  if (island.component === "discussion-board-view") return <DiscussionBoardView {...props} />;
  if (island.component === "discussion-thread-view") return <DiscussionThreadView {...props} />;
  if (island.component === "setup-disabled-view") return <SetupDisabledView {...props} />;
  if (island.component === "setup-form-view") return <SetupFormView {...props} />;
  if (island.component === "login-view") return <LoginView {...props} />;
  if (island.component === "invite-view") return <InviteView {...props} />;
  if (island.component === "forgot-password-view") return <ForgotPasswordView {...props} />;
  if (island.component === "reset-password-view") return <ResetPasswordView {...props} />;
  if (island.component === "force-password-change-view") return <ForcePasswordChangeView {...props} />;
  if (island.component === "rules-accept-view") return <RulesAcceptView {...props} />;
  if (island.component === "profile-view") return <ProfileView {...props} />;
  if (island.component === "exports-view") return <ExportsView {...props} />;
  if (island.component === "admin-view") return <AdminView {...props} />;
  if (island.component === "admin-invites-view") return <AdminInvitesView {...props} />;
  if (island.component === "not-found-view") return <NotFoundView {...props} />;
  if (island.component === "work-detail-view") return <WorkDetailView {...props} />;
  if (island.component === "work-crosspost-gallery-modal-view") return <WorkCrosspostGalleryModalView {...props} />;
  if (island.component === "work-edit-view") return <WorkEditView {...props} />;
  if (island.component === "work-versions-view") return <WorkVersionsView {...props} />;
  return null;
}

/** Mounts all Preact island placeholders inside newly rendered page or modal HTML. */
export function mountComponentIslands(scope: ParentNode = document) {
  scope.querySelectorAll<HTMLElement>("[data-component-island-key]").forEach((element) => {
    if (element.dataset.componentIslandMounted === "true") return;
    const key = element.dataset.componentIslandKey || "";
    const island = islands.get(key);
    if (!island) return;
    element.dataset.componentIslandMounted = "true";
    render(h(() => islandNode(island), {}), element);
  });
}
