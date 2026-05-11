// @ts-nocheck
import { icon } from "../components/icons";

let deferredInstallPrompt = null;

function standaloneMode() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator?.standalone === true;
}

function installButton() {
  if (standaloneMode()) return "";
  return `<button class="sidebar-install-app install-button" type="button" data-install-app hidden aria-label="Install app" title="Install app"><span>${icon("download")}</span><strong>Install App</strong></button>`;
}

function updateInstallButtons() {
  document.querySelectorAll("[data-install-app]").forEach((control) => {
    control.hidden = !deferredInstallPrompt || standaloneMode();
  });
}

function bindInstallActions() {
  updateInstallButtons();
  document.querySelectorAll("[data-install-app]").forEach((control) => {
    if (control.dataset.installBound === "true") return;
    control.dataset.installBound = "true";
    control.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      updateInstallButtons();
      await prompt.prompt();
      await prompt.userChoice.catch(() => undefined);
    });
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButtons();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButtons();
});

export { bindInstallActions, installButton };
