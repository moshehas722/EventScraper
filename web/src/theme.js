// Light/dark theme preference. Mirrors the pattern in sourceGroups.js: read
// from localStorage, fail quiet in private-browsing/quota-exceeded contexts.
// The initial choice (before any explicit user toggle) is left unset here —
// index.html's inline head script and index.css's prefers-color-scheme
// media query already handle that for the very first paint — this module
// only takes over once the user has explicitly picked a theme.

export const THEME_STORAGE_KEY = 'eventscraper-theme';

/** @returns {'light' | 'dark' | null} null means "no explicit choice — follow the OS". */
export function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

/** @param {'light' | 'dark' | null} theme */
export function saveTheme(theme) {
  try {
    if (theme === 'light' || theme === 'dark') {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } else {
      localStorage.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
}

/** @param {'light' | 'dark' | null} theme */
export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
