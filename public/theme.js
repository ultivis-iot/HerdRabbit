(function initializeTheme() {
  const storageKey = "herdrbridge-theme";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const themeColor = document.querySelector("#theme-color");

  function storedTheme() {
    try {
      const value = window.localStorage.getItem(storageKey);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  }

  function systemTheme() {
    return media.matches ? "dark" : "light";
  }

  function apply(theme, { remember = false } = {}) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (themeColor) {
      themeColor.content = theme === "dark" ? "#10151a" : "#f3f7f5";
    }
    if (remember) {
      try {
        window.localStorage.setItem(storageKey, theme);
      } catch {
        // The visible theme can still change when storage is unavailable.
      }
    }
    window.dispatchEvent(new CustomEvent("herdr-theme-change", { detail: { theme } }));
  }

  apply(storedTheme() || systemTheme());
  media.addEventListener("change", () => {
    if (!storedTheme()) apply(systemTheme());
  });

  window.herdrTheme = {
    current: () => root.dataset.theme || systemTheme(),
    set: (theme) => apply(theme, { remember: true }),
  };
})();
