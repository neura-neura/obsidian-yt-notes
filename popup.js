(() => {
  "use strict";

  function sendToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      chrome.tabs.sendMessage(tab.id, message, () => {
        window.close();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const manifest = chrome.runtime.getManifest();
    document.getElementById("version").textContent = manifest.version;

    document.getElementById("injectEditor").addEventListener("click", (event) => {
      event.preventDefault();
      sendToActiveTab({ source: "FROM_POPUP", action: "openAllNotes" });
    });

    document.getElementById("viewMyNotes").addEventListener("click", (event) => {
      event.preventDefault();
      sendToActiveTab({ source: "FROM_POPUP", action: "injectEditor" });
    });

    document.getElementById("openSettings").addEventListener("click", (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
      window.close();
    });
  });
})();
