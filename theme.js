(() => {
  "use strict";

  const STORAGE_KEY = "obsidian-yt-notes-ui-theme";
  const THEMES = ["light", "dark", "system"];
  const labels = {
    light: "Light",
    dark: "Dark",
    system: "System",
  };

  let activeTheme = readTheme();
  const systemQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  function readTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return THEMES.includes(stored) ? stored : "system";
    } catch (_) {
      return "system";
    }
  }

  function writeTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_) {}
  }

  function systemTheme() {
    return systemQuery && systemQuery.matches ? "dark" : "light";
  }

  function resolvedTheme(theme = activeTheme) {
    return theme === "system" ? systemTheme() : theme;
  }

  function updateControls() {
    const resolved = resolvedTheme();
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-label", `Theme: ${labels[activeTheme]}`);
      button.dataset.theme = activeTheme;
      button.dataset.resolvedTheme = resolved;
      const label = button.querySelector(".theme-label");
      if (label) label.textContent = labels[activeTheme];
    });

    document.querySelectorAll("[data-theme-value]").forEach((item) => {
      const checked = item.dataset.themeValue === activeTheme;
      item.dataset.state = checked ? "checked" : "";
      item.setAttribute("aria-checked", checked ? "true" : "false");
    });
  }

  function applyTheme(theme = activeTheme) {
    activeTheme = THEMES.includes(theme) ? theme : "system";
    const resolved = resolvedTheme(activeTheme);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.dataset.theme = activeTheme;
    root.dataset.resolvedTheme = resolved;
    root.style.colorScheme = resolved;
    updateControls();
  }

  function setTheme(theme) {
    if (!THEMES.includes(theme)) return;
    writeTheme(theme);
    applyTheme(theme);
    window.dispatchEvent(
      new CustomEvent("themechange", {
        detail: {
          theme,
          resolvedTheme: resolvedTheme(theme),
        },
      }),
    );
  }

  function closeMenus(except = null) {
    document.querySelectorAll(".ui-dropdown.is-open").forEach((menu) => {
      if (menu === except) return;
      menu.classList.remove("is-open");
      const trigger = menu.querySelector("[data-theme-toggle]");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function handleClick(event) {
    const themeItem = event.target.closest("[data-theme-value]");
    if (themeItem) {
      setTheme(themeItem.dataset.themeValue);
      closeMenus();
      return;
    }

    const trigger = event.target.closest("[data-theme-toggle]");
    if (trigger) {
      const menu = trigger.closest(".ui-dropdown");
      if (!menu) return;
      const nextOpen = !menu.classList.contains("is-open");
      closeMenus(menu);
      menu.classList.toggle("is-open", nextOpen);
      trigger.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      return;
    }

    if (!event.target.closest(".ui-dropdown")) closeMenus();
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      closeMenus();
      return;
    }

    const target = event.target;
    if (!target || !target.matches("[data-theme-value]")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setTheme(target.dataset.themeValue);
    closeMenus();
  }

  function initControls() {
    updateControls();
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown);
  }

  if (systemQuery) {
    const onSystemChange = () => {
      if (activeTheme === "system") applyTheme("system");
    };
    if (typeof systemQuery.addEventListener === "function") {
      systemQuery.addEventListener("change", onSystemChange);
    } else if (typeof systemQuery.addListener === "function") {
      systemQuery.addListener(onSystemChange);
    }
  }

  window.HNTheme = {
    getTheme: () => activeTheme,
    setTheme,
    resolvedTheme,
  };

  applyTheme(activeTheme);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initControls, { once: true });
  } else {
    initControls();
  }
})();
