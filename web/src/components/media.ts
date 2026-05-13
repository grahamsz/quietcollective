import { escapeHtml } from "../lib/utils";
import { navigate } from "../app/routing";
import { icon } from "./icons";

type LightboxItem = {
  src: string;
  alt: string;
  title: string;
  href: string;
};

let closeActiveLightbox: (() => void) | null = null;

/** Renders protected media markup for string-rendered pages and modal templates. */
export function protectedImage(src: string, alt = "") {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" draggable="false" loading="lazy" decoding="async" data-protected-image><span class="image-shield" data-media-protect aria-hidden="true"></span>`;
}

/** Computes staggered tile animation CSS for legacy string-rendered media tiles. */
export function tileRevealStyle(index: number) {
  const delay = Math.round(Math.random() * 140 + (index % 4) * 16);
  return `style="--reveal-delay:${delay}ms"`;
}

function lightboxData(element: HTMLElement): LightboxItem | null {
  const image = element.querySelector("img");
  const src = element.dataset.lightboxSrc || image?.currentSrc || image?.src || "";
  if (!src) return null;
  return {
    src,
    alt: element.dataset.lightboxAlt || image?.alt || "",
    title: element.dataset.lightboxTitle || image?.alt || "",
    href: element.dataset.lightboxHref || "",
  };
}

function parsedLightboxItems(element: HTMLElement) {
  if (!element.dataset.lightboxItems) return null;
  try {
    const parsed = JSON.parse(element.dataset.lightboxItems);
    if (!Array.isArray(parsed)) return null;
    const items = parsed
      .map((item) => ({
        src: String(item?.src || ""),
        alt: String(item?.alt || ""),
        title: String(item?.title || ""),
        href: String(item?.href || ""),
      }))
      .filter((item) => item.src);
    if (!items.length) return null;
    const requestedIndex = Number(element.dataset.lightboxIndex || 0);
    const index = Number.isFinite(requestedIndex) ? Math.max(0, Math.min(items.length - 1, Math.round(requestedIndex))) : 0;
    return { items, index };
  } catch {
    return null;
  }
}

function lightboxGroup(origin: HTMLElement) {
  const embedded = parsedLightboxItems(origin);
  if (embedded) return embedded;
  const group = origin.dataset.lightboxGallery || "";
  const elements = group
    ? [...document.querySelectorAll<HTMLElement>("[data-lightbox-item]")].filter((element) => element.dataset.lightboxGallery === group)
    : [origin];
  const items: LightboxItem[] = [];
  let index = 0;
  elements.forEach((element) => {
    const data = lightboxData(element);
    if (!data) return;
    if (element === origin) index = items.length;
    items.push(data);
  });
  return { items, index };
}

function openMediaLightbox(origin: HTMLElement) {
  const { items, index } = lightboxGroup(origin);
  if (!items.length) return;
  closeActiveLightbox?.();

  let activeIndex = index;
  let pointerId: number | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let dragOffset = 0;
  let suppressNextBackdropClick = false;
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop media-lightbox-backdrop";
  overlay.tabIndex = -1;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Image preview");
  overlay.innerHTML = `
    <button class="icon-button media-lightbox-close" type="button" data-lightbox-close aria-label="Close" title="Close">${icon("x")}</button>
    <button class="icon-button media-lightbox-nav media-lightbox-prev" type="button" data-lightbox-prev aria-label="Previous image" title="Previous image">${icon("chevron-left")}</button>
    <figure class="media-lightbox-content">
      <div class="media-lightbox-stage" data-lightbox-stage>
        <div class="media-lightbox-track" data-lightbox-track>
          <img class="media-lightbox-image" data-lightbox-prev-image alt="" draggable="false">
          <img class="media-lightbox-image" data-lightbox-current-image alt="" draggable="false">
          <img class="media-lightbox-image" data-lightbox-next-image alt="" draggable="false">
        </div>
      </div>
      <figcaption class="media-lightbox-caption">
        <span data-lightbox-title></span>
        <span data-lightbox-count></span>
      </figcaption>
    </figure>
    <button class="icon-button media-lightbox-nav media-lightbox-next" type="button" data-lightbox-next aria-label="Next image" title="Next image">${icon("chevron-right")}</button>
  `;

  const stage = overlay.querySelector<HTMLElement>("[data-lightbox-stage]")!;
  const track = overlay.querySelector<HTMLElement>("[data-lightbox-track]")!;
  const prevImage = overlay.querySelector<HTMLImageElement>("[data-lightbox-prev-image]")!;
  const currentImage = overlay.querySelector<HTMLImageElement>("[data-lightbox-current-image]")!;
  const nextImage = overlay.querySelector<HTMLImageElement>("[data-lightbox-next-image]")!;
  const title = overlay.querySelector<HTMLElement>("[data-lightbox-title]")!;
  const count = overlay.querySelector<HTMLElement>("[data-lightbox-count]")!;
  const previous = overlay.querySelector<HTMLButtonElement>("[data-lightbox-prev]")!;
  const next = overlay.querySelector<HTMLButtonElement>("[data-lightbox-next]")!;

  const itemAt = (itemIndex: number) => items[(itemIndex + items.length) % items.length];
  const setImage = (image: HTMLImageElement, item: LightboxItem) => {
    image.src = item.src;
    image.alt = item.alt;
  };
  const setTrackOffset = (offset: number, animated = false) => {
    track.classList.toggle("is-animating", animated);
    track.style.transform = `translate3d(calc(-100% + ${offset}px), 0, 0)`;
  };
  const resetTrack = () => setTrackOffset(0, false);

  const show = (nextIndex: number, options: { keepTrack?: boolean } = {}) => {
    activeIndex = (nextIndex + items.length) % items.length;
    const item = items[activeIndex];
    setImage(currentImage, item);
    setImage(prevImage, itemAt(activeIndex - 1));
    setImage(nextImage, itemAt(activeIndex + 1));
    title.textContent = item.title;
    title.hidden = !item.title;
    count.textContent = items.length > 1 ? `${activeIndex + 1} / ${items.length}` : "";
    count.hidden = items.length < 2;
    previous.hidden = items.length < 2;
    next.hidden = items.length < 2;
    if (!options.keepTrack) resetTrack();
    if (items.length > 1) {
      const preload = new Image();
      preload.src = items[(activeIndex + 1) % items.length].src;
    }
  };

  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    document.body.classList.remove("media-lightbox-open");
    overlay.remove();
    if (closeActiveLightbox === close) closeActiveLightbox = null;
  };

  const closeToActiveWork = () => {
    const href = items[activeIndex]?.href || "";
    close();
    if (!href || href === `${location.pathname}${location.search}`) return;
    navigate(href);
  };

  const finishSlide = (step: number) => {
    if (items.length < 2) return;
    const slideWidth = stage.clientWidth || window.innerWidth;
    const targetOffset = step > 0 ? -slideWidth : slideWidth;
    setTrackOffset(targetOffset, true);
    window.setTimeout(() => {
      show(activeIndex + step, { keepTrack: true });
      resetTrack();
    }, 190);
  };

  const move = (step: number) => finishSlide(step);

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft" && items.length > 1) move(-1);
    if (event.key === "ArrowRight" && items.length > 1) move(1);
  };

  overlay.addEventListener("click", (event) => {
    if (event.target !== overlay) return;
    if (suppressNextBackdropClick) {
      suppressNextBackdropClick = false;
      return;
    }
    close();
  });
  overlay.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a")) return;
    pointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    dragOffset = 0;
    track.classList.remove("is-animating");
    overlay.setPointerCapture?.(event.pointerId);
  });
  overlay.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    if (items.length < 2 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    dragOffset = deltaX;
    if (Math.abs(dragOffset) > 8) suppressNextBackdropClick = true;
    event.preventDefault();
    setTrackOffset(dragOffset, false);
  });
  overlay.addEventListener("pointerup", (event) => {
    if (pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    pointerId = null;
    overlay.releasePointerCapture?.(event.pointerId);
    if (items.length < 2 || Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      setTrackOffset(0, true);
      return;
    }
    event.preventDefault();
    finishSlide(deltaX < 0 ? 1 : -1);
  });
  overlay.addEventListener("pointercancel", () => {
    pointerId = null;
    setTrackOffset(0, true);
  });
  overlay.querySelector("[data-lightbox-close]")?.addEventListener("click", closeToActiveWork);
  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));

  closeActiveLightbox = close;
  document.body.append(overlay);
  document.body.classList.add("media-lightbox-open");
  document.addEventListener("keydown", onKeydown);
  show(activeIndex);
  overlay.focus();
}

function bindMediaLightbox(scope: ParentNode = document) {
  scope.querySelectorAll<HTMLElement>("[data-lightbox-item]").forEach((item) => {
    if (item.dataset.lightboxBound === "true") return;
    item.dataset.lightboxBound = "true";
    item.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-media-protect], [data-protected-image]")) return;
      event.preventDefault();
      event.stopPropagation();
      openMediaLightbox(item);
    }, true);
  });
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
  bindMediaLightbox(scope);
}
