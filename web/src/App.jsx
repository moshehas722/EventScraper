import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { faviconUrl, resolveSiteOrigin } from './siteOrigins.js';
import {
  buildOriginSourceTree,
  loadUiState,
  mergeSourceSelection,
  saveUiState,
} from './sourceGroups.js';
import {
  daysUntil,
  formatDaysLeft,
  getUpcomingFavoritesHighlight,
  mergeFavoriteWithLiveEvent,
  upcomingHighlightKey,
  sortFavorites,
  toFavoriteRecord,
} from './favorites.js';
import {
  eventKey,
  isBlacklisted,
  blacklistEntryMatches,
  sortBlacklist,
  toBlacklistRecord,
} from './blacklist.js';
import './App.css';

function todayIso() {
  const d = new Date();
  return toIsoDate(d);
}

function toIsoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toIsoDate(dt);
}

function formatDisplayDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatDayName(iso, style = 'long') {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: style });
}

function formatMonthDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatShortDateTime(d) {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCompactScope(mode, selectedDate) {
  if (mode === 'all') return 'All';
  const dayIso = getFilterDayIso(mode, selectedDate);
  if (dayIso) return `${formatDayName(dayIso, 'short')}, ${formatMonthDay(dayIso)}`;
  if (mode === 'week') {
    const today = todayIso();
    return `${formatMonthDay(today)}–${formatMonthDay(addDays(today, 6))}`;
  }
  return null;
}

/** @typedef {'today' | 'tomorrow' | `plus${number}` | 'week' | 'all' | 'date'} DateFilterMode */

function dayOffsetFromMode(mode) {
  if (mode === 'today') return 0;
  if (mode === 'tomorrow') return 1;
  const match = mode.match(/^plus(\d+)$/);
  return match ? Number(match[1]) : null;
}

function getFilterDayIso(mode, selectedDate) {
  const offset = dayOffsetFromMode(mode);
  if (offset !== null) return addDays(todayIso(), offset);
  if (mode === 'date') return selectedDate;
  return null;
}

function matchesDateFilter(eventDate, mode, selectedDate) {
  if (mode === 'all') return true;
  const dayIso = getFilterDayIso(mode, selectedDate);
  if (dayIso) return eventDate === dayIso;
  if (mode === 'week') {
    const today = todayIso();
    return eventDate >= today && eventDate <= addDays(today, 6);
  }
  return false;
}

function dateFilterLabel(mode, selectedDate) {
  if (mode === 'all') return 'all upcoming events';
  const dayIso = getFilterDayIso(mode, selectedDate);
  if (dayIso) return formatDisplayDate(dayIso);
  const today = todayIso();
  return `this week (${formatDayName(today, 'short')}, ${formatMonthDay(today)} – ${formatDayName(addDays(today, 6), 'short')}, ${formatMonthDay(addDays(today, 6))})`;
}

function buildDateFilters() {
  const today = todayIso();
  /** @type {Array<{ id: DateFilterMode, label: string, compactLabel: string, title: string }>} */
  const filters = [
    { id: 'today', label: 'Today', compactLabel: 'Now', title: formatDisplayDate(today) },
  ];

  for (let offset = 1; offset <= 6; offset += 1) {
    const iso = addDays(today, offset);
    filters.push({
      id: offset === 1 ? 'tomorrow' : /** @type {DateFilterMode} */ (`plus${offset}`),
      label: formatDayName(iso, 'short'),
      compactLabel: formatDayName(iso, 'short').slice(0, 2),
      title: formatDisplayDate(iso),
    });
  }

  filters.push({
    id: 'week',
    label: 'Week',
    compactLabel: 'Wk',
    title: `${formatDisplayDate(today)} – ${formatDisplayDate(addDays(today, 6))}`,
  });
  filters.push({
    id: 'all',
    label: 'All',
    compactLabel: 'All',
    title: 'All upcoming events',
  });
  filters.push({
    id: 'date',
    label: 'Date',
    compactLabel: 'Cal',
    title: 'Pick a specific date',
  });

  return filters;
}

function formatWhatsappCategory(category) {
  if (!category || category === 'other') return 'Other';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function GroupCheckbox({ checked, indeterminate, onChange, label }) {
  const ref = useRef(/** @type {HTMLInputElement | null} */ (null));

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="source-group-checkbox"
      checked={checked}
      aria-label={label}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// Live scraping talks to the local Express API (proxied by Vite in dev) —
// there's no such backend on the deployed (Vercel) build, only Blob storage.
// Set VITE_DISABLE_BLOB=true in .env to skip Blob auto-load and show the button.
const disableBlob = import.meta.env.VITE_DISABLE_BLOB === 'true';
const liveScrapeEnabled = import.meta.env.DEV || disableBlob;

export default function App() {
  const initialUi = useMemo(() => loadUiState(), []);

  const [dateFilter, setDateFilter] = useState(/** @type {DateFilterMode} */ ('today'));
  const [date, setDate] = useState(todayIso);
  const [events, setEvents] = useState([]);
  const [selectedSources, setSelectedSources] = useState(() => new Set());
  const [multiSelect, setMultiSelect] = useState(() => initialUi?.multiSelect ?? true);
  const [collapsedGroups, setCollapsedGroups] = useState(
    () => initialUi?.collapsedGroups ?? new Set(),
  );
  const [sourcesPanelCollapsed, setSourcesPanelCollapsed] = useState(
    () => initialUi?.sourcesPanelCollapsed ?? true,
  );
  const [dismissedUpcomingBannerKey, setDismissedUpcomingBannerKey] = useState(
    /** @type {string | null} */ (null),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [source, setSource] = useState(/** @type {'scrape' | 'blob' | null} */ (null));
  const [snapshotUploadedAt, setSnapshotUploadedAt] = useState(/** @type {Date | null} */ (null));
  const [siteMeta, setSiteMeta] = useState([]);
  const [favorites, setFavorites] = useState(/** @type {Array} */ ([]));
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favoritesError, setFavoritesError] = useState(null);
  const [blacklist, setBlacklist] = useState(/** @type {Array} */ ([]));
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [blacklistError, setBlacklistError] = useState(null);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [whatsappMessages, setWhatsappMessages] = useState(/** @type {Array} */ ([]));
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappError, setWhatsappError] = useState(null);
  const [waMessagePreview, setWaMessagePreview] = useState(/** @type {string | null} */ (null));
  // Guards against the initial (still-empty) render's state overwriting the
  // saved selection in localStorage before the auto-load-on-mount fetch resolves.
  const hydratedRef = useRef(false);
  // Remembers the last multi-selection so turning "Multiple selection" back on
  // restores it, instead of being stuck with whatever single item was left.
  const multiSelectionBackupRef = useRef(/** @type {Set<string> | null} */ (null));

  useEffect(() => {
    if (!liveScrapeEnabled) return;
    fetch('/api/sites')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setSiteMeta(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const knownSources = [...new Set(events.map((e) => e.source))];
    saveUiState({
      selectedSources,
      knownSources,
      multiSelect,
      collapsedGroups,
      sourcesPanelCollapsed,
    });
  }, [events, selectedSources, multiSelect, collapsedGroups, sourcesPanelCollapsed]);

  // Guards toggleFavorite against running before the initial GET resolves —
  // otherwise a click that races the load would save based on a stale
  // (often empty) list and silently wipe out existing favorites.
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  // Only the most recently issued PUT's response is allowed to reconcile
  // local state, so an older response completing after a newer one (out of
  // order) can't clobber a more recent click.
  const persistRequestIdRef = useRef(0);
  // StrictMode (dev only) double-invokes this effect, which would otherwise
  // fire two concurrent GETs — the second one resolving after a user's click
  // could overwrite it back to the pre-click state. Only the first
  // invocation's fetch is allowed to actually run.
  const favoritesLoadStartedRef = useRef(false);
  const [blacklistLoaded, setBlacklistLoaded] = useState(false);
  const blacklistPersistRequestIdRef = useRef(0);
  const blacklistLoadStartedRef = useRef(false);

  useEffect(() => {
    if (favoritesLoadStartedRef.current) return;
    favoritesLoadStartedRef.current = true;
    fetch('/api/favorites')
      .then((res) => (res.ok ? res.json() : { favorites: [] }))
      .then((data) => setFavorites(Array.isArray(data.favorites) ? data.favorites : []))
      .catch(() => {})
      .finally(() => setFavoritesLoaded(true));
  }, []);

  useEffect(() => {
    if (blacklistLoadStartedRef.current) return;
    blacklistLoadStartedRef.current = true;
    fetch('/api/blacklist')
      .then((res) => (res.ok ? res.json() : { blacklist: [] }))
      .then((data) => setBlacklist(Array.isArray(data.blacklist) ? data.blacklist : []))
      .catch(() => {})
      .finally(() => setBlacklistLoaded(true));
  }, []);

  const persistFavorites = useCallback(async (next) => {
    const requestId = ++persistRequestIdRef.current;
    try {
      setFavoritesError(null);
      const res = await fetch('/api/favorites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorites: next }),
        // Let the save finish even if the page is refreshed/unloaded right
        // after clicking the heart, instead of the browser aborting it.
        keepalive: true,
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      // Server strips past-dated entries — reconcile local state to match
      // what actually got saved, but only if no newer request has since
      // superseded this one.
      if (requestId === persistRequestIdRef.current && Array.isArray(data.favorites)) {
        setFavorites(data.favorites);
      }
    } catch {
      setFavoritesError('Failed to save favorites — try again.');
    }
  }, []);

  const toggleFavorite = useCallback(
    (event) => {
      if (!favoritesLoaded) return;
      const exists = favorites.some((f) => f.id === event.id);
      const next = exists
        ? favorites.filter((f) => f.id !== event.id)
        : [...favorites, toFavoriteRecord(event)];
      setFavorites(next);
      persistFavorites(next);
    },
    [favorites, favoritesLoaded, persistFavorites],
  );

  const persistBlacklist = useCallback(async (next) => {
    const requestId = ++blacklistPersistRequestIdRef.current;
    try {
      setBlacklistError(null);
      const res = await fetch('/api/blacklist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blacklist: next }),
        keepalive: true,
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      if (requestId === blacklistPersistRequestIdRef.current && Array.isArray(data.blacklist)) {
        setBlacklist(data.blacklist);
      }
    } catch {
      setBlacklistError('Failed to save hidden events — try again.');
    }
  }, []);

  const toggleBlacklist = useCallback(
    (event) => {
      if (!blacklistLoaded) return;
      const exists = isBlacklisted(event, blacklist);
      const next = exists
        ? blacklist.filter((entry) => !blacklistEntryMatches(entry, event))
        : [...blacklist, toBlacklistRecord(event)];
      setBlacklist(next);
      persistBlacklist(next);
    },
    [blacklist, blacklistLoaded, persistBlacklist],
  );

  // Refetched every time the panel opens (rather than loaded once, like
  // favorites) since new messages arrive continuously in the background via
  // the WhatsApp plugin, independent of anything this UI does.
  const loadWhatsAppMessages = useCallback(async () => {
    setWhatsappLoading(true);
    setWhatsappError(null);
    try {
      const res = await fetch('/api/whatsapp-messages');
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setWhatsappMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch {
      setWhatsappError('Failed to load WhatsApp messages — try again.');
    } finally {
      setWhatsappLoading(false);
    }
  }, []);

  const toggleWhatsapp = useCallback(() => {
    setWhatsappOpen((wasOpen) => {
      const next = !wasOpen;
      if (next) loadWhatsAppMessages();
      return next;
    });
  }, [loadWhatsAppMessages]);

  const sortedWhatsappMessages = useMemo(
    () => [...whatsappMessages].sort((a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0)),
    [whatsappMessages],
  );

  const sources = [...new Set(events.map((e) => e.source))].sort((a, b) => a.localeCompare(b));
  // WhatsApp-origin sources have no favicon-able origin — shown with a badge
  // instead, wherever a favicon would otherwise be missing.
  const whatsappSources = useMemo(
    () => new Set(events.filter((e) => e.origin === 'whatsapp').map((e) => e.source)),
    [events],
  );
  const originSourceTree = useMemo(
    () => buildOriginSourceTree(sources, siteMeta, whatsappSources),
    [sources, siteMeta, whatsappSources],
  );

  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);
  const sortedFavorites = useMemo(() => {
    const today = todayIso();
    const enriched = favorites.map((f) => {
      const merged = mergeFavoriteWithLiveEvent(f, events);
      return { ...merged, daysUntil: daysUntil(today, merged.date) };
    });
    return sortFavorites(enriched, today);
  }, [favorites, events]);
  const sortedBlacklist = useMemo(() => sortBlacklist(blacklist), [blacklist]);
  const upcomingFavoriteHighlight = useMemo(() => {
    if (!favoritesLoaded) return null;
    return getUpcomingFavoritesHighlight(favorites, events, todayIso());
  }, [favorites, events, favoritesLoaded]);
  const upcomingBannerVisible =
    upcomingFavoriteHighlight &&
    upcomingHighlightKey(upcomingFavoriteHighlight) !== dismissedUpcomingBannerKey;

  const toggleSource = (name) => {
    setSelectedSources((prev) => {
      if (!multiSelect) {
        return prev.has(name) && prev.size === 1 ? new Set() : new Set([name]);
      }
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleGroup = (group) => {
    setSelectedSources((prev) => {
      const { sources: names } = group;
      const allSelected = names.every((n) => prev.has(n));

      if (!multiSelect) {
        if (allSelected) return new Set();
        return new Set([names[0]]);
      }

      const next = new Set(prev);
      if (allSelected) names.forEach((n) => next.delete(n));
      else names.forEach((n) => next.add(n));
      return next;
    });
  };

  const toggleGroupCollapsed = (key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllSources = () => {
    setSelectedSources(new Set(sources));
  };

  const selectNoneSources = () => {
    setSelectedSources(new Set());
  };

  const dateEvents = events.filter((e) => matchesDateFilter(e.date, dateFilter, date));
  const sourceFilteredEvents = dateEvents.filter((e) => selectedSources.has(e.source));
  const filteredEvents = sourceFilteredEvents.filter((e) => !isBlacklisted(e, blacklist));
  const sourceFilterActive = sources.length > 0 && selectedSources.size < sources.length;
  const blacklistActive = sourceFilteredEvents.length > filteredEvents.length;
  const showDateColumn = dateFilter === 'week' || dateFilter === 'all';
  const activeDayIso = getFilterDayIso(dateFilter, date);
  const dateFilters = buildDateFilters();

  const loadEvents = useCallback(async (endpoint, sourceKind) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      const fetchedSources = [...new Set(data.events.map((e) => e.source))];
      const stored = loadUiState();
      setEvents(data.events);
      setSelectedSources(
        mergeSourceSelection(stored?.selectedSources, fetchedSources, stored?.knownSources),
      );
      setLastFetched(new Date());
      setSource(sourceKind);
      setSnapshotUploadedAt(data.uploadedAt ? new Date(data.uploadedAt) : null);
    } catch (err) {
      setError(err.message);
      setEvents([]);
      setSelectedSources(new Set());
      setSource(null);
      setSnapshotUploadedAt(null);
    } finally {
      hydratedRef.current = true;
      setLoading(false);
    }
  }, []);

  const fetchEvents = useCallback(
    () => loadEvents('/api/events?all=true', 'scrape'),
    [loadEvents],
  );
  const loadFromBlob = useCallback(
    () => loadEvents('/api/events/blob?all=true', 'blob'),
    [loadEvents],
  );

  useEffect(() => {
    if (!disableBlob) loadFromBlob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scopeLabel = dateFilterLabel(dateFilter, date);
  const scopeCompact = formatCompactScope(dateFilter, date);
  const filterActive = sourceFilterActive || blacklistActive;
  const displayCount = filteredEvents.length;
  const scopeCount = dateEvents.length;

  const renderSourceItem = (name, nested = false) => {
    const selected = selectedSources.has(name);
    const siteIcon = faviconUrl(resolveSiteOrigin(name, siteMeta));
    const isWhatsapp = whatsappSources.has(name);
    return (
      <li key={name} className={nested ? 'source-group-item' : undefined}>
        <div className="source-item-row">
          {multiSelect && (
            <input
              type="checkbox"
              className="source-item-checkbox"
              checked={selected}
              aria-label={`${selected ? 'Deselect' : 'Select'} ${name}`}
              onChange={() => toggleSource(name)}
            />
          )}
          <button
            type="button"
            className={`source-item${selected ? ' source-item--selected' : ''}${nested ? ' source-item--nested' : ''}`}
            aria-pressed={selected}
            onClick={() => toggleSource(name)}
          >
            {!nested && siteIcon && (
              <img
                src={siteIcon}
                alt=""
                className="site-icon"
                width={16}
                height={16}
                loading="lazy"
              />
            )}
            {!nested && !siteIcon && isWhatsapp && (
              <span className="site-icon-badge" aria-hidden>💬</span>
            )}
            <span className="source-item-name">{name}</span>
          </button>
        </div>
      </li>
    );
  };

  const renderVenueGroupBlock = (group) => {
    if (group.sources.length === 1) {
      return renderSourceItem(group.sources[0], true);
    }

    const selectedCount = group.sources.filter((n) => selectedSources.has(n)).length;
    const allSelected = selectedCount === group.sources.length;
    const someSelected = selectedCount > 0 && !allSelected;
    const collapsed = collapsedGroups.has(group.key);
    const groupIcon = faviconUrl(group.origin ?? resolveSiteOrigin(group.label, siteMeta));

    return (
      <li key={group.key} className="source-group source-group--nested">
        <div className="source-group-header">
          {multiSelect && (
            <GroupCheckbox
              checked={allSelected}
              indeterminate={someSelected}
              label={`${allSelected ? 'Deselect' : 'Select'} all in ${group.label}`}
              onChange={() => toggleGroup(group)}
            />
          )}
          <button
            type="button"
            className="source-group-toggle"
            aria-expanded={!collapsed}
            onClick={() => toggleGroupCollapsed(group.key)}
          >
            <span
              className={`source-group-chevron${collapsed ? ' source-group-chevron--collapsed' : ''}`}
              aria-hidden
            >
              ▾
            </span>
            {groupIcon && (
              <img
                src={groupIcon}
                alt=""
                className="site-icon"
                width={16}
                height={16}
                loading="lazy"
              />
            )}
            <span className="source-group-label">{group.label}</span>
            <span className="source-group-count">
              {selectedCount}/{group.sources.length}
            </span>
          </button>
        </div>
        {!collapsed && (
          <ul className="source-group-items" role="group" aria-label={group.label}>
            {group.sources.map((name) => renderSourceItem(name, true))}
          </ul>
        )}
      </li>
    );
  };

  const renderOriginGroup = (originGroup) => {
    const selectedCount = originGroup.sources.filter((n) => selectedSources.has(n)).length;
    const allSelected = selectedCount === originGroup.sources.length;
    const someSelected = selectedCount > 0 && !allSelected;
    const collapsed = collapsedGroups.has(originGroup.key);
    const isWhatsapp = originGroup.key === 'origin:whatsapp';

    return (
      <li key={originGroup.key} className="source-origin-group">
        <div className="source-group-header source-origin-header">
          {multiSelect && (
            <GroupCheckbox
              checked={allSelected}
              indeterminate={someSelected}
              label={`${allSelected ? 'Deselect' : 'Select'} all in ${originGroup.label}`}
              onChange={() => toggleGroup(originGroup)}
            />
          )}
          <button
            type="button"
            className="source-group-toggle source-origin-toggle"
            aria-expanded={!collapsed}
            onClick={() => toggleGroupCollapsed(originGroup.key)}
          >
            <span
              className={`source-group-chevron${collapsed ? ' source-group-chevron--collapsed' : ''}`}
              aria-hidden
            >
              ▾
            </span>
            {isWhatsapp && <span className="site-icon-badge" aria-hidden>💬</span>}
            <span className="source-group-label">{originGroup.label}</span>
            <span className="source-group-count">
              {selectedCount}/{originGroup.sources.length}
            </span>
          </button>
        </div>
        {!collapsed && (
          <ul
            className="source-origin-items"
            role="group"
            aria-label={originGroup.label}
          >
            {isWhatsapp
              ? originGroup.children.map((child) => renderSourceItem(child.sources[0], true))
              : originGroup.children.map((child) => renderVenueGroupBlock(child))}
          </ul>
        )}
      </li>
    );
  };

  const renderWhatsappStructured = (message) => {
    const ev = message.event;
    if (!ev?.isEvent) {
      return (
        <p className="whatsapp-item-structured whatsapp-item-structured--none">
          No event detected
          {ev?.category ? ` · ${formatWhatsappCategory(ev.category)}` : ''}
        </p>
      );
    }

    const fields = [
      ['Name', ev.name],
      ['Date', ev.date],
      ['Time', ev.time],
      ['Location', ev.location],
      ['Cost', ev.cost],
      ['Category', formatWhatsappCategory(ev.category)],
    ].filter(([, value]) => value);

    return (
      <dl className="whatsapp-item-structured">
        {fields.map(([label, value]) => (
          <div key={label} className="whatsapp-structured-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <h1>What's Happening...</h1>
          <div className="header-actions">
            <button
              type="button"
              className="whatsapp-toggle"
              aria-pressed={whatsappOpen}
              aria-expanded={whatsappOpen}
              aria-label={
                whatsappMessages.length > 0
                  ? `WhatsApp Messages (${whatsappMessages.length})`
                  : 'WhatsApp Messages'
              }
              onClick={toggleWhatsapp}
            >
              <span className="whatsapp-toggle-icon" aria-hidden>
                💬
              </span>
              <span className="whatsapp-toggle-text">WhatsApp Messages</span>
              {whatsappMessages.length > 0 && (
                <span className="whatsapp-count">{whatsappMessages.length}</span>
              )}
            </button>
            <button
              type="button"
              className="blacklist-toggle"
              aria-pressed={blacklistOpen}
              aria-expanded={blacklistOpen}
              aria-label={
                blacklist.length > 0 ? `Hidden events (${blacklist.length})` : 'Hidden events'
              }
              onClick={() => setBlacklistOpen((v) => !v)}
            >
              <span className="blacklist-toggle-icon" aria-hidden>
                ✕
              </span>
              <span className="blacklist-toggle-text">Hidden</span>
              {blacklist.length > 0 && (
                <span className="blacklist-count">{blacklist.length}</span>
              )}
            </button>
            <button
              type="button"
              className="favorites-toggle"
              aria-pressed={favoritesOpen}
              aria-expanded={favoritesOpen}
              aria-label={
                favorites.length > 0 ? `Favorites (${favorites.length})` : 'Favorites'
              }
              onClick={() => setFavoritesOpen((v) => !v)}
            >
              <span className="favorites-toggle-icon" aria-hidden>
                ♥
              </span>
              <span className="favorites-toggle-text">Favorites</span>
              {favorites.length > 0 && (
                <span className="favorites-count">{favorites.length}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {upcomingBannerVisible && (
        <div className="upcoming-favorites-banner" role="status" aria-live="polite">
          <div className="upcoming-favorites-banner-header">
            <span className="upcoming-favorites-banner-icon" aria-hidden>
              ♥
            </span>
            <span className="upcoming-favorites-banner-label">
              Next up · {formatDaysLeft(daysUntil(todayIso(), upcomingFavoriteHighlight.date))}
              {' · '}
              {formatDayName(upcomingFavoriteHighlight.date, 'short')}, {formatMonthDay(upcomingFavoriteHighlight.date)}
            </span>
            <button
              type="button"
              className="upcoming-favorites-banner-close"
              aria-label="Dismiss upcoming favorites"
              onClick={() =>
                setDismissedUpcomingBannerKey(upcomingHighlightKey(upcomingFavoriteHighlight))
              }
            >
              ✕
            </button>
          </div>
          <ul className="upcoming-favorites-banner-list">
            {upcomingFavoriteHighlight.events.map((f) =>
              f.referenceType === 'url' ? (
                <li key={f.id} className="upcoming-favorites-banner-item">
                  <a
                    href={f.reference}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="upcoming-favorites-banner-name"
                  >
                    {f.name || 'Untitled event'}
                  </a>
                  <span className="upcoming-favorites-banner-meta">
                    {f.time}
                    <span aria-hidden> · </span>
                    {f.source}
                  </span>
                </li>
              ) : (
                <li key={f.id} className="upcoming-favorites-banner-item">
                  <span className="upcoming-favorites-banner-name">{f.name || 'Untitled event'}</span>
                  <span className="upcoming-favorites-banner-meta">
                    {f.time}
                    <span aria-hidden> · </span>
                    {f.source}
                  </span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      {blacklistOpen && (
        <div className="blacklist-panel" role="dialog" aria-label="Hidden events">
          <div className="blacklist-panel-header">
            <h2>Hidden events</h2>
            <button
              type="button"
              className="blacklist-panel-close"
              aria-label="Close hidden events"
              onClick={() => setBlacklistOpen(false)}
            >
              ✕
            </button>
          </div>

          {blacklistError && <p className="blacklist-panel-error">{blacklistError}</p>}

          {sortedBlacklist.length === 0 ? (
            <p className="blacklist-panel-empty">
              No hidden events — tap ✕ on any event to hide it from the list.
            </p>
          ) : (
            <ul className="blacklist-list">
              {sortedBlacklist.map((entry) => (
                <li key={eventKey(entry)} className="blacklist-item">
                  <button
                    type="button"
                    className="hide-btn hide-btn--active"
                    aria-label={`Show ${entry.name} again`}
                    onClick={() => toggleBlacklist(entry)}
                  >
                    ↩
                  </button>
                  <div className="blacklist-item-body">
                    <span className="blacklist-item-name">{entry.name}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {whatsappOpen && (
        <div className="whatsapp-panel" role="dialog" aria-label="WhatsApp Messages">
          <div className="whatsapp-panel-header">
            <h2>WhatsApp Messages</h2>
            <button
              type="button"
              className="whatsapp-panel-close"
              aria-label="Close WhatsApp messages"
              onClick={() => setWhatsappOpen(false)}
            >
              ✕
            </button>
          </div>

          {whatsappError && <p className="whatsapp-panel-error">{whatsappError}</p>}

          {whatsappLoading && <p className="whatsapp-panel-empty">Loading…</p>}

          {!whatsappLoading && !whatsappError && sortedWhatsappMessages.length === 0 && (
            <p className="whatsapp-panel-empty">No messages stored yet.</p>
          )}

          {!whatsappLoading && sortedWhatsappMessages.length > 0 && (
            <ul className="whatsapp-list">
              {sortedWhatsappMessages.map((m) => (
                <li key={m.id ?? `${m.chatJid}-${m.receivedAt}`} className="whatsapp-item">
                  <div className="whatsapp-item-meta">
                    <span className="whatsapp-item-sender">
                      {m.senderName || m.sender || 'Unknown'}
                    </span>
                    {m.receivedAt && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{new Date(m.receivedAt).toLocaleString()}</span>
                      </>
                    )}
                  </div>
                  {renderWhatsappStructured(m)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {favoritesOpen && (
        <div className="favorites-panel" role="dialog" aria-label="Favorites">
          <div className="favorites-panel-header">
            <h2>Favorites</h2>
            <button
              type="button"
              className="favorites-panel-close"
              aria-label="Close favorites"
              onClick={() => setFavoritesOpen(false)}
            >
              ✕
            </button>
          </div>

          {favoritesError && <p className="favorites-panel-error">{favoritesError}</p>}

          {sortedFavorites.length === 0 ? (
            <p className="favorites-panel-empty">
              No favorites yet — tap the heart on any event to save it here.
            </p>
          ) : (
            <ul className="favorites-list">
              {sortedFavorites.map((f) => (
                <li key={f.id} className="favorites-item">
                  <button
                    type="button"
                    className="favorite-btn favorite-btn--active"
                    aria-label={`Remove ${f.name || 'this event'} from favorites`}
                    onClick={() => toggleFavorite(f)}
                  >
                    ♥
                  </button>
                  <div className="favorites-item-body">
                    {f.referenceType === 'url' ? (
                      <a
                        href={f.reference}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="favorites-item-name"
                      >
                        {f.name || 'Untitled event'}
                      </a>
                    ) : (
                      <span className="favorites-item-name">{f.name || 'Untitled event'}</span>
                    )}
                    <div className="favorites-item-meta">
                      <span className="favorites-item-days">{formatDaysLeft(f.daysUntil)}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {formatMonthDay(f.date)} {f.time}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{f.source}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="app-body">
        {lastFetched && sources.length > 0 && (
          <aside
            className={`sources-sidebar card${sourcesPanelCollapsed ? ' sources-sidebar--collapsed' : ''}`}
          >
            <button
              type="button"
              className="sources-sidebar-toggle"
              aria-expanded={!sourcesPanelCollapsed}
              aria-controls="sources-panel-body"
              aria-label={`Sources, ${selectedSources.size} of ${sources.length} selected`}
              onClick={() => setSourcesPanelCollapsed((v) => !v)}
            >
              <span className="sources-sidebar-label">Sources</span>
              <span className="sources-sidebar-summary">
                {selectedSources.size}/{sources.length}
              </span>
              <span
                className={`source-group-chevron${sourcesPanelCollapsed ? ' source-group-chevron--collapsed' : ''}`}
                aria-hidden
              >
                ▾
              </span>
            </button>
            <div id="sources-panel-body" className="sources-sidebar-body">
            <div className="source-options">
              <div className="source-bulk-actions">
                <button type="button" className="link-btn" onClick={selectAllSources}>
                  Select all
                </button>
                <span className="source-bulk-sep" aria-hidden>·</span>
                <button type="button" className="link-btn" onClick={selectNoneSources}>
                  Select none
                </button>
              </div>
              <label className="source-multi-toggle">
                <input
                  type="checkbox"
                  checked={multiSelect}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setMultiSelect(on);
                    if (!on) {
                      setSelectedSources((prev) => {
                        if (prev.size <= 1) return prev;
                        multiSelectionBackupRef.current = prev;
                        const first = sources.find((s) => prev.has(s));
                        return first ? new Set([first]) : new Set();
                      });
                    } else if (multiSelectionBackupRef.current) {
                      const restored = new Set(
                        [...multiSelectionBackupRef.current].filter((s) => sources.includes(s)),
                      );
                      multiSelectionBackupRef.current = null;
                      if (restored.size > 0) setSelectedSources(restored);
                    }
                  }}
                />
                Multiple selection
              </label>
            </div>
            <ul className="source-list" role="group" aria-label="Filter by source">
              {originSourceTree.map((originGroup) => renderOriginGroup(originGroup))}
            </ul>
            </div>
          </aside>
        )}

        <main className="main">
        <section className="controls card">
          <div className="controls-row">
            <div className="date-filter">
              <span className="field-label field-label--inline">When</span>
              <div className="filter-segment filter-segment--compact" role="group" aria-label="Filter by date">
                {dateFilters.map(({ id, label, compactLabel, title }) => (
                  <button
                    key={id}
                    type="button"
                    className={`filter-segment-btn filter-segment-btn--compact${dateFilter === id ? ' filter-segment-btn--selected' : ''}${id === 'today' ? ' filter-segment-btn--today' : ''}`}
                    aria-pressed={dateFilter === id}
                    aria-label={title}
                    title={title}
                    onClick={() => setDateFilter(id)}
                  >
                    <span className="filter-segment-btn-label">{label}</span>
                    <span className="filter-segment-btn-label filter-segment-btn-label--short" aria-hidden>
                      {compactLabel}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {dateFilter === 'date' && (
              <label className="field">
                <span className="field-label">Pick date</span>
                <div className="date-picker-row">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={loading}
                  />
                  <span className="picked-day">{formatDayName(date)}</span>
                </div>
              </label>
            )}

            {liveScrapeEnabled && (
              <div className="fetch-actions">
                <button
                  type="button"
                  className="fetch-btn"
                  onClick={fetchEvents}
                  disabled={loading}
                >
                  {loading && source !== 'blob' ? (
                    <>
                      <span className="spinner" aria-hidden />
                      Scraping…
                    </>
                  ) : (
                    'Fetch events'
                  )}
                </button>
              </div>
            )}
          </div>

          {lastFetched && !loading && (
            <p className="meta">
              <time dateTime={(source === 'blob' && snapshotUploadedAt ? snapshotUploadedAt : lastFetched).toISOString()}>
                {formatShortDateTime(source === 'blob' && snapshotUploadedAt ? snapshotUploadedAt : lastFetched)}
              </time>
              {' · '}
              {filterActive ? `${displayCount}/${scopeCount}` : displayCount} events
              {scopeCompact && <> · {scopeCompact}</>}
            </p>
          )}
          {loading && !lastFetched && !disableBlob && (
            <p className="meta">Loading the latest snapshot…</p>
          )}
        </section>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <section className="results card">
          {!lastFetched && !loading && !error && (
            <div className="empty-state">
              <p>
                {disableBlob
                  ? 'No events loaded yet. Click Fetch events to scrape from venues.'
                  : 'No events loaded yet.'}
              </p>
            </div>
          )}

          {lastFetched && events.length === 0 && !loading && !error && (
            <div className="empty-state">
              <p>No events found for {scopeLabel}.</p>
            </div>
          )}

          {lastFetched && events.length > 0 && dateEvents.length === 0 && !loading && (
            <div className="empty-state">
              <p>No events for {scopeLabel}.</p>
            </div>
          )}

          {lastFetched && dateEvents.length > 0 && filteredEvents.length === 0 && !loading && (
            <div className="empty-state">
              <p>
                {sourceFilteredEvents.length === 0
                  ? 'No events match the selected sources.'
                  : 'All matching events are hidden.'}
              </p>
            </div>
          )}

          {filteredEvents.length > 0 && (
            <div className="table-wrap">
              {activeDayIso && (
                <p className="results-day">{formatDayName(activeDayIso)}</p>
              )}
              <table className="events-table">
                <thead>
                  <tr>
                    {showDateColumn && <th>Day</th>}
                    <th>Time</th>
                    <th>Price</th>
                    <th>Location</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((e, i) => {
                    const siteIcon = faviconUrl(
                      e.sourceOrigin ?? resolveSiteOrigin(e.source, siteMeta),
                    );
                    const isFavorite = favoriteIds.has(e.id);
                    const displayName = e.name || 'Untitled event';
                    return (
                    <tr key={`${e.id}-${i}`}>
                      {showDateColumn && (
                        <td className="date-cell">
                          <span className="day-name">{formatDayName(e.date, 'short')}</span>
                          <span className="day-date">{formatMonthDay(e.date)}</span>
                        </td>
                      )}
                      <td className="time-cell">{e.time}</td>
                      <td className="price-cell">{e.cost}</td>
                      <td className="site-cell">
                        {siteIcon && (
                          <img
                            src={siteIcon}
                            alt=""
                            className="site-icon"
                            width={16}
                            height={16}
                            loading="lazy"
                          />
                        )}
                        {!siteIcon && e.origin === 'whatsapp' && (
                          <span className="site-icon-badge" aria-hidden>💬</span>
                        )}
                        <span>{e.location || e.source}</span>
                      </td>
                      <td className="name-cell">
                        <div className="event-row-actions">
                          <button
                            type="button"
                            className={`favorite-btn${isFavorite ? ' favorite-btn--active' : ''}`}
                            aria-pressed={isFavorite}
                            disabled={!favoritesLoaded}
                            aria-label={
                              isFavorite
                                ? `Remove ${displayName} from favorites`
                                : `Add ${displayName} to favorites`
                            }
                            onClick={() => toggleFavorite(e)}
                          >
                            {isFavorite ? '♥' : '♡'}
                          </button>
                          <button
                            type="button"
                            className="hide-btn"
                            disabled={!blacklistLoaded}
                            aria-label={`Hide ${displayName}`}
                            onClick={() => toggleBlacklist(e)}
                          >
                            ✕
                          </button>
                          {e.referenceType === 'url' ? (
                            <a href={e.reference} target="_blank" rel="noopener noreferrer">
                              {displayName}
                            </a>
                          ) : (
                            <button
                              type="button"
                              className="event-name-link"
                              onClick={() => setWaMessagePreview(e.reference)}
                            >
                              {displayName}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </main>
      </div>

      {waMessagePreview && (
        <div
          className="message-modal-overlay"
          role="presentation"
          onClick={() => setWaMessagePreview(null)}
        >
          <div
            className="message-modal"
            role="dialog"
            aria-label="Original WhatsApp message"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="message-modal-header">
              <h2>Original message</h2>
              <button
                type="button"
                className="message-modal-close"
                aria-label="Close message"
                onClick={() => setWaMessagePreview(null)}
              >
                ✕
              </button>
            </div>
            <pre className="message-modal-text">{waMessagePreview}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
