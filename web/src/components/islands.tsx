import { h, type ComponentChildren } from "preact";
import { render } from "preact";
import type { Gallery, Work } from "../types";
import { GalleryAccessChips, GalleryAccessRules, GalleryMosaic } from "./gallery-tile";
import { WorkGrid } from "./work-tile";

type Island =
  | { component: "gallery-mosaic"; props: { galleries: Gallery[] } }
  | { component: "gallery-access-chips"; props: { gallery: Gallery; className?: string } }
  | { component: "gallery-access-rules"; props: { gallery: Gallery } }
  | { component: "work-grid"; props: { works: Work[]; galleryId?: string } };

const islands = new Map<string, Island>();
let islandSequence = 0;

function nextIslandKey(component: Island["component"]) {
  islandSequence += 1;
  return `${component}-${islandSequence}`;
}

function islandPlaceholder(component: Island["component"], props: Island["props"], tag = "div") {
  const key = nextIslandKey(component);
  islands.set(key, { component, props } as Island);
  return `<${tag} data-component-island="${component}" data-component-island-key="${key}"></${tag}>`;
}

export function galleryMosaic(galleries: Gallery[]) {
  return islandPlaceholder("gallery-mosaic", { galleries });
}

export function galleryAccessChips(gallery: Gallery, className = "") {
  return islandPlaceholder("gallery-access-chips", { gallery, className }, "span");
}

export function galleryAccessRules(gallery: Gallery) {
  return islandPlaceholder("gallery-access-rules", { gallery });
}

export function imageGrid(works: Work[], options: { galleryId?: string } = {}) {
  return islandPlaceholder("work-grid", { works, galleryId: options.galleryId || "" });
}

function islandNode(island: Island): ComponentChildren {
  if (island.component === "gallery-mosaic") return <GalleryMosaic {...island.props} />;
  if (island.component === "gallery-access-chips") return <GalleryAccessChips {...island.props} />;
  if (island.component === "gallery-access-rules") return <GalleryAccessRules {...island.props} />;
  if (island.component === "work-grid") return <WorkGrid {...island.props} />;
  return null;
}

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
