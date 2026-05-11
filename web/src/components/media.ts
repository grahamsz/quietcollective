import { escapeHtml } from "../lib/utils";

/** Renders protected media markup for string-rendered pages and modal templates. */
export function protectedImage(src: string, alt = "") {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" draggable="false" loading="lazy" decoding="async" data-protected-image><span class="image-shield" data-media-protect aria-hidden="true"></span>`;
}

/** Computes staggered tile animation CSS for legacy string-rendered media tiles. */
export function tileRevealStyle(index: number) {
  const delay = Math.round(Math.random() * 140 + (index % 4) * 16);
  return `style="--reveal-delay:${delay}ms"`;
}

/** Hydrates protected image placeholders after a page or modal has been inserted. */
export function bindProtectedMedia(scope: ParentNode = document) {
  scope.querySelectorAll("[data-media-protect], [data-protected-image]").forEach((element) => {
    if (!(element instanceof HTMLElement)) return;
    if (element.dataset.protectBound === "true") return;
    element.dataset.protectBound = "true";
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    element.addEventListener("dragstart", (event) => event.preventDefault());
  });
  scope.querySelectorAll("[data-media-reveal]").forEach((tile) => {
    if (!(tile instanceof HTMLElement)) return;
    if (tile.dataset.revealBound === "true") return;
    tile.dataset.revealBound = "true";
    const image = tile.querySelector("img");
    const reveal = () => tile.classList.add("is-loaded");
    if (!image) {
      reveal();
    } else if (image.complete) {
      requestAnimationFrame(reveal);
    } else {
      image.addEventListener("load", reveal, { once: true });
      image.addEventListener("error", reveal, { once: true });
    }
  });
}
