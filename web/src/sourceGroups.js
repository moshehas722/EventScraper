import { resolveSiteOrigin } from './siteOrigins.js';

export const STORAGE_KEY = 'eventscraper-ui';

/** @typedef {{ selectedSources: string[] | null, knownSources: string[] | null, multiSelect: boolean, collapsedGroups: Set<string>, sourcesMenuOpen: boolean }} UiState */

/** @returns {UiState | null} */
export function loadUiState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      selectedSources: Array.isArray(data.selectedSources) ? data.selectedSources : null,
      knownSources: Array.isArray(data.knownSources) ? data.knownSources : null,
      multiSelect: typeof data.multiSelect === 'boolean' ? data.multiSelect : true,
      collapsedGroups: new Set(
        Array.isArray(data.collapsedGroups) ? data.collapsedGroups : [],
      ),
      sourcesMenuOpen:
        typeof data.sourcesMenuOpen === 'boolean' ? data.sourcesMenuOpen : false,
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ selectedSources: Set<string>, knownSources: string[], multiSelect: boolean, collapsedGroups: Set<string>, sourcesMenuOpen: boolean }} state
 */
export function saveUiState({
  selectedSources,
  knownSources,
  multiSelect,
  collapsedGroups,
  sourcesMenuOpen,
}) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedSources: [...selectedSources],
        knownSources,
        multiSelect,
        collapsedGroups: [...collapsedGroups],
        sourcesMenuOpen,
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
 * Top-level source tree: Sites (venue sub-groups) and WhatsApp (per sender).
 * @param {string[]} sourceNames
 * @param {Array<{ id: string, name: string, origin?: string }>} siteMeta
 * @param {Set<string>} whatsappSources
 */
export function buildOriginSourceTree(sourceNames, siteMeta = [], whatsappSources = new Set()) {
  const siteNames = sourceNames.filter((n) => !whatsappSources.has(n));
  const waNames = sourceNames.filter((n) => whatsappSources.has(n));
  /** @type {Array<{ key: string, label: string, sources: string[], children: Array<object> }>} */
  const tree = [];

  if (siteNames.length) {
    tree.push({
      key: 'origin:site',
      label: 'Sites',
      sources: siteNames,
      children: buildSourceGroups(siteNames, siteMeta),
    });
  }

  if (waNames.length) {
    tree.push({
      key: 'origin:whatsapp',
      label: 'WhatsApp',
      sources: waNames,
      children: [...waNames]
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          key: `wa:${name}`,
          label: name,
          origin: null,
          sources: [name],
        })),
    });
  }

  return tree;
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
 * Restore stored selection: keep it exactly as last saved (dropping sources that
 * no longer exist), except for sources that have never been seen before — those
 * default to selected so newly-added venues show up automatically.
 * @param {string[] | null | undefined} storedNames
 * @param {string[]} currentSources
 * @param {string[] | null | undefined} [knownSources] sources seen as of the last save
 */
export function mergeSourceSelection(storedNames, currentSources, knownSources) {
  const current = new Set(currentSources);
  if (!storedNames?.length) {
    return new Set(currentSources);
  }

  const known = new Set(knownSources ?? []);
  const merged = new Set(storedNames.filter((s) => current.has(s)));
  for (const s of currentSources) {
    if (!merged.has(s) && !known.has(s)) merged.add(s);
  }
  return merged;
}
