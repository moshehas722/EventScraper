import { resolveSiteOrigin } from './siteOrigins.js';

export const STORAGE_KEY = 'eventscraper-ui';

/** @typedef {{ selectedSources: string[] | null, multiSelect: boolean, collapsedGroups: Set<string> }} UiState */

/** @returns {UiState | null} */
export function loadUiState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      selectedSources: Array.isArray(data.selectedSources) ? data.selectedSources : null,
      multiSelect: typeof data.multiSelect === 'boolean' ? data.multiSelect : true,
      collapsedGroups: new Set(
        Array.isArray(data.collapsedGroups) ? data.collapsedGroups : [],
      ),
    };
  } catch {
    return null;
  }
}

/** @param {{ selectedSources: Set<string>, multiSelect: boolean, collapsedGroups: Set<string> }} state */
export function saveUiState({ selectedSources, multiSelect, collapsedGroups }) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedSources: [...selectedSources],
        multiSelect,
        collapsedGroups: [...collapsedGroups],
      }),
    );
  } catch {
    // ignore quota / private mode
  }
}

/** @param {string} origin */
function normalizeHostname(origin) {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * @param {string} sourceName
 * @param {Array<{ id: string, name: string, origin?: string }>} siteMeta
 */
function findPrefixMeta(sourceName, siteMeta) {
  return siteMeta
    .filter((s) => sourceName === s.name || sourceName.startsWith(`${s.name} (`))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

/** @param {string} metaName @param {string[]} sourceNames */
function scraperHasSubVenues(metaName, sourceNames) {
  return sourceNames.some((n) => n !== metaName && n.startsWith(`${metaName} (`));
}

/**
 * Stable group key for a source.
 * Scraper id when the source is a sub-venue (or root of a scraper with sub-venues);
 * otherwise shared origin hostname; otherwise the source name itself.
 * @param {string} sourceName
 * @param {Array<{ id: string, name: string, origin?: string }>} siteMeta
 * @param {string[]} allSourceNames
 */
export function resolveGroupKey(sourceName, siteMeta = [], allSourceNames = []) {
  const prefixMeta = findPrefixMeta(sourceName, siteMeta);
  const origin = resolveSiteOrigin(sourceName, siteMeta);

  if (prefixMeta) {
    const isSubVenue = sourceName.startsWith(`${prefixMeta.name} (`);
    const hasSubs = scraperHasSubVenues(prefixMeta.name, allSourceNames);
    if (isSubVenue || (sourceName === prefixMeta.name && hasSubs)) {
      return {
        key: prefixMeta.id,
        origin: prefixMeta.origin ?? origin,
      };
    }
  }

  const host = origin ? normalizeHostname(origin) : null;
  if (host) {
    return { key: host, origin };
  }

  return { key: sourceName, origin: null };
}

/** @param {string} name */
function deriveBrandPrefix(name) {
  const match = name.match(/^(.+?) \([^)]+\)$/);
  return match ? match[1].trim() : name;
}

/**
 * Display label for a group after all members are known.
 * @param {string[]} sources
 * @param {string} key
 * @param {string | null} origin
 * @param {Array<{ id: string, name: string, origin?: string }>} siteMeta
 */
export function deriveGroupLabel(sources, key, origin, siteMeta = []) {
  const meta = siteMeta.find((s) => s.id === key);
  if (meta) return meta.name;

  const brands = sources.map(deriveBrandPrefix);
  if (brands.length && brands.every((b) => b === brands[0])) {
    return brands[0];
  }

  const host = origin ? normalizeHostname(origin) : null;
  if (host) return host;

  return sources[0] ?? key;
}

/**
 * Derive group metadata for a single source (label is provisional until buildSourceGroups).
 * @param {string} sourceName
 * @param {Array<{ id: string, name: string, origin?: string }>} siteMeta
 * @param {string[]} [allSourceNames]
 */
export function resolveGroupInfo(sourceName, siteMeta = [], allSourceNames) {
  const names = allSourceNames ?? [sourceName];
  const { key, origin } = resolveGroupKey(sourceName, siteMeta, names);
  return {
    key,
    label: deriveGroupLabel([sourceName], key, origin, siteMeta),
    origin,
  };
}

/**
 * @param {string[]} sourceNames
 * @param {Array<{ id: string, name: string, origin?: string }>} siteMeta
 */
export function buildSourceGroups(sourceNames, siteMeta = []) {
  /** @type {Map<string, { key: string, origin: string | null, sources: string[] }>} */
  const map = new Map();

  for (const name of sourceNames) {
    const { key, origin } = resolveGroupKey(name, siteMeta, sourceNames);
    if (!map.has(key)) {
      map.set(key, { key, origin, sources: [] });
    }
    const group = map.get(key);
    group.sources.push(name);
    if (!group.origin && origin) group.origin = origin;
  }

  return [...map.values()]
    .map((g) => ({
      ...g,
      label: deriveGroupLabel(g.sources, g.key, g.origin, siteMeta),
      sources: g.sources.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Restore stored selection, drop stale names, optionally select newly appeared sources.
 * @param {string[] | null | undefined} storedNames
 * @param {string[]} currentSources
 * @param {{ defaultNewSelected?: boolean }} [opts]
 */
export function mergeSourceSelection(storedNames, currentSources, { defaultNewSelected = true } = {}) {
  const current = new Set(currentSources);
  if (!storedNames?.length) {
    return new Set(currentSources);
  }

  const merged = new Set(storedNames.filter((s) => current.has(s)));
  if (defaultNewSelected) {
    for (const s of currentSources) {
      if (!merged.has(s)) merged.add(s);
    }
  }
  return merged;
}
