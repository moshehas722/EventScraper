import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { faviconUrl, resolveSiteOrigin } from './siteOrigins.js';
import {
  buildSourceGroups,
  loadUiState,
  mergeSourceSelection,
  saveUiState,
} from './sourceGroups.js';
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

/** @typedef {'today' | 'tomorrow' | 'plus2' | 'plus3' | 'week' | 'all' | 'date'} DateFilterMode */

function getFilterDayIso(mode, selectedDate) {
  const today = todayIso();
  if (mode === 'today') return today;
  if (mode === 'tomorrow') return addDays(today, 1);
  if (mode === 'plus2') return addDays(today, 2);
  if (mode === 'plus3') return addDays(today, 3);
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
  if (mode === 'all') return 'all dates';
  const dayIso = getFilterDayIso(mode, selectedDate);
  if (dayIso) return formatDisplayDate(dayIso);
  const today = todayIso();
  return `this week (${formatDayName(today, 'short')}, ${formatMonthDay(today)} – ${formatDayName(addDays(today, 6), 'short')}, ${formatMonthDay(addDays(today, 6))})`;
}

function buildDateFilters() {
  const today = todayIso();
  return [
    { id: 'today', label: 'Today' },
    { id: 'tomorrow', label: 'Tomorrow' },
    { id: 'plus2', label: formatDayName(addDays(today, 2)) },
    { id: 'plus3', label: formatDayName(addDays(today, 3)) },
    { id: 'week', label: 'This Week' },
    { id: 'all', label: 'All' },
    { id: 'date', label: 'Date' },
  ];
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
const liveScrapeEnabled = import.meta.env.DEV;

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [source, setSource] = useState(/** @type {'scrape' | 'blob' | null} */ (null));
  const [snapshotUploadedAt, setSnapshotUploadedAt] = useState(/** @type {Date | null} */ (null));
  const [siteMeta, setSiteMeta] = useState([]);
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
    const knownSources = [...new Set(events.map((e) => e.site))];
    saveUiState({ selectedSources, knownSources, multiSelect, collapsedGroups });
  }, [events, selectedSources, multiSelect, collapsedGroups]);

  const sources = [...new Set(events.map((e) => e.site))].sort((a, b) => a.localeCompare(b));
  const sourceGroups = useMemo(
    () => buildSourceGroups(sources, siteMeta),
    [sources, siteMeta],
  );

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
  const filteredEvents = dateEvents.filter((e) => selectedSources.has(e.site));
  const sourceFilterActive = sources.length > 0 && selectedSources.size < sources.length;
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
      const fetchedSources = [...new Set(data.events.map((e) => e.site))];
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
    loadFromBlob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scopeLabel = dateFilterLabel(dateFilter, date);
  const filterActive = sourceFilterActive;
  const displayCount = filteredEvents.length;
  const scopeCount = dateEvents.length;

  const renderSourceItem = (name, nested = false) => {
    const selected = selectedSources.has(name);
    const siteIcon = faviconUrl(resolveSiteOrigin(name, siteMeta));
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
            <span className="source-item-name">{name}</span>
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <h1>What's Happening...</h1>
        </div>
      </header>

      <div className="app-body">
        {lastFetched && sources.length > 0 && (
          <aside className="sources-sidebar card">
            <div className="source-filter-header">
              <span className="field-label">Sources</span>
            </div>
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
            <ul className="source-list" role="group" aria-label="Filter by venue">
              {sourceGroups.map((group) => {
                if (group.sources.length === 1) {
                  return renderSourceItem(group.sources[0]);
                }

                const selectedCount = group.sources.filter((n) => selectedSources.has(n)).length;
                const allSelected = selectedCount === group.sources.length;
                const someSelected = selectedCount > 0 && !allSelected;
                const collapsed = collapsedGroups.has(group.key);
                const groupIcon = faviconUrl(group.origin ?? resolveSiteOrigin(group.label, siteMeta));

                return (
                  <li key={group.key} className="source-group">
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
              })}
            </ul>
          </aside>
        )}

        <main className="main">
        <section className="controls card">
          <div className="controls-row">
            <div className="date-filter">
              <span className="field-label">When</span>
              <div className="filter-segment" role="group" aria-label="Filter by date">
                {dateFilters.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`filter-segment-btn${dateFilter === id ? ' filter-segment-btn--selected' : ''}`}
                    aria-pressed={dateFilter === id}
                    onClick={() => setDateFilter(/** @type {DateFilterMode} */ (id))}
                  >
                    {label}
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
              {source === 'blob'
                ? `Loaded saved snapshot${snapshotUploadedAt ? ` from ${snapshotUploadedAt.toLocaleString()}` : ''}`
                : `Last updated ${lastFetched.toLocaleTimeString()}`}
              {' — '}
              {filterActive ? `${displayCount} of ${scopeCount}` : displayCount}{' '}
              event{displayCount === 1 ? '' : 's'} for {scopeLabel}
              {filterActive && ' (filtered by source)'}
              {events.length > 0 && (
                <span className="meta-total"> · {events.length} total upcoming</span>
              )}
            </p>
          )}
          {loading && !lastFetched && (
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
              <p>No events loaded yet.</p>
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
              <p>No events match the selected sources.</p>
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
                    <th>Venue</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((e, i) => {
                    const siteIcon = faviconUrl(
                      e.siteOrigin ?? resolveSiteOrigin(e.site, siteMeta),
                    );
                    return (
                    <tr key={`${e.url}-${i}`}>
                      {showDateColumn && (
                        <td className="date-cell">
                          <span className="day-name">{formatDayName(e.date, 'short')}</span>
                          <span className="day-date">{formatMonthDay(e.date)}</span>
                        </td>
                      )}
                      <td className="time-cell">{e.time}</td>
                      <td className="price-cell">{e.priceText}</td>
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
                        <span>{e.site}</span>
                      </td>
                      <td className="name-cell">
                        <a href={e.url} target="_blank" rel="noopener noreferrer">
                          {e.name}
                        </a>
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
    </div>
  );
}
