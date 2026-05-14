import type { Gallery } from "../types";

export type GalleryFilter = "all" | "public" | "my";

export function galleryIsPublic(gallery: Gallery = {} as Gallery) {
  return gallery.visibility === "server_public" || gallery.ownership_type === "whole_server" || !!gallery.whole_server_upload;
}

export function galleryIsMine(gallery: Gallery = {} as Gallery, userId?: string | null) {
  return (
    (!!userId && gallery.owner_user_id === userId) ||
    !!gallery.capabilities?.upload_work ||
    !!gallery.capabilities?.edit ||
    !!gallery.capabilities?.manage_collaborators ||
    gallery.ownership_type === "collaborative"
  );
}

export function normalizeGalleryFilter(value?: string | null): GalleryFilter {
  if (value === "public") return "public";
  if (value === "my" || value === "mine") return "my";
  return "all";
}

export function filterGalleries(galleries: Gallery[] = [], filter: GalleryFilter = "all", userId?: string | null) {
  if (filter === "public") return galleries.filter((gallery) => galleryIsPublic(gallery));
  if (filter === "my") return galleries.filter((gallery) => galleryIsMine(gallery, userId));
  return galleries;
}
