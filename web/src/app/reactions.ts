// @ts-nocheck
import { icon } from "../components/icons";
import { encodePath, escapeHtml } from "../lib/utils";
import { api } from "./api";
import { toast } from "./toast";
import { updatePrefetchedWorkReactions } from "./work-prefetch";

function heartControls(targetType, targetId) {
  return [...document.querySelectorAll("[data-heart-target-type][data-heart-target-id]")].filter(
    (control) => control.dataset.heartTargetType === targetType && control.dataset.heartTargetId === targetId,
  );
}

function syncHeartControl(control, reactions = {}) {
  const count = reactions.heart_count || 0;
  const hearted = !!reactions.hearted_by_me;
  const label = hearted ? "Remove heart" : "Heart";
  control.dataset.hearted = hearted ? "true" : "false";
  control.classList.toggle("is-active", hearted);
  control.setAttribute("aria-label", label);
  control.setAttribute("title", label);
  control.innerHTML = `${icon("heart")}${count ? `<span>${escapeHtml(String(count))}</span>` : ""}`;
}

function updateHeartControls(targetType, targetId, reactions = {}) {
  heartControls(targetType, targetId).forEach((control) => syncHeartControl(control, reactions));
}

function burstContainer(source) {
  return source.closest?.(".media-lightbox-stage, .media-frame, .image-tile, .gallery-tile") || source;
}

function burstCenter(container) {
  const image = container.querySelector?.("[data-lightbox-current-image]")
    || container.querySelector?.("img[data-protected-image]")
    || container.querySelector?.("img");
  const rect = container.getBoundingClientRect();
  if (image instanceof HTMLElement) {
    const imageRect = image.getBoundingClientRect();
    if (imageRect.width && imageRect.height) {
      return {
        x: imageRect.left - rect.left + imageRect.width / 2,
        y: imageRect.top - rect.top + imageRect.height / 2,
      };
    }
  }
  return { x: rect.width / 2, y: rect.height / 2 };
}

function heartBurstMarkup() {
  const heart = icon("heart");
  return `<span class="doubletap-heart-ring is-one">${heart}</span><span class="doubletap-heart-ring is-two">${heart}</span><span class="doubletap-heart-core">${heart}</span>`;
}

function animateHeartBurst(source) {
  if (!(source instanceof HTMLElement)) return;
  const container = burstContainer(source);
  if (!(container instanceof HTMLElement)) return;
  const rect = container.getBoundingClientRect();
  const { x, y } = burstCenter(container);
  const burst = document.createElement("span");
  burst.className = "doubletap-heart-burst";
  burst.style.setProperty("--heart-x", `${Math.max(0, Math.min(rect.width, x))}px`);
  burst.style.setProperty("--heart-y", `${Math.max(0, Math.min(rect.height, y))}px`);
  burst.innerHTML = heartBurstMarkup();
  container.classList.remove("is-doubletap-heart");
  void container.offsetWidth;
  container.classList.add("is-doubletap-heart");
  container.append(burst);
  burst.addEventListener("animationend", () => {
    burst.remove();
    container.classList.remove("is-doubletap-heart");
  }, { once: true });
}

async function heartTarget(targetType, targetId, source, event) {
  if (!targetType || !targetId) return null;
  animateHeartBurst(source);
  try {
    const data = await api(`/api/reactions/${encodePath(targetType)}/${encodePath(targetId)}/heart`, { method: "POST" });
    updateHeartControls(targetType, targetId, data.reactions || {});
    if (targetType === "work") updatePrefetchedWorkReactions(targetId, data.reactions || {});
    return data;
  } catch (error) {
    toast(error.message, "error");
    return null;
  }
}

export { animateHeartBurst, heartTarget, syncHeartControl, updateHeartControls };
