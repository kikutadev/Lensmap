import { browser } from "wxt/browser";

const openButton = document.getElementById("open");
openButton?.addEventListener("click", () => {
  void browser.windows.getCurrent().then((window) => {
    if (window.id === undefined) throw new Error("Current window id is unavailable");
    return browser.sidePanel.open({ windowId: window.id });
  });
});
