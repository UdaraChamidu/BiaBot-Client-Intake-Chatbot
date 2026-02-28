const THEME_KEY = "biabot-theme";

export function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || "dark";
}

export function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
