// @ts-nocheck
import { icon } from "../components/icons";

let deferredInstallPrompt = null;

function standaloneMode() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator?.standalone === true;
}

function installButton() {
  if (standaloneMode()) return "";
  return `<button class="sidebar-install-app install-button is-install-hidden" type="button" data-install-app disabled aria-hidden="true" tabindex="-1" aria-label="Install app" title="Install app"><span>${icon("download")}</span><strong>Install App</strong></button>`;
}

function setInstallButtonVisible(control: HTMLButtonElement, visible: boolean) {
  control.classList.toggle("is-install-hidden", !visible);
  control.disabled = !visible;
  control.setAttribute("aria-hidden", visible ? "false" : "true");
  control.tabIndex = visible ? 0 : -1;
}

function updateInstallButtons() {
  document.querySelectorAll("[data-install-app]").forEach((control) => {
    setInstallButtonVisible(control as HTMLButtonElement, !!deferredInstallPrompt && !standaloneMode());
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
