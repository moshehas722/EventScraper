import { useCallback, useEffect, useState } from 'react';
import { faviconUrl, resolveSiteOrigin } from './siteOrigins.js';
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

export default function App() {
  const [dateFilter, setDateFilter] = useState(/** @type {DateFilterMode} */ ('today'));
  const [date, setDate] = useState(todayIso);
  const [events, setEvents] = useState([]);
  const [selectedSources, setSelectedSources] = useState(() => new Set());
  const [multiSelect, setMultiSelect] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [siteMeta, setSiteMeta] = useState([]);

  useEffect(() => {
    fetch('/api/sites')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setSiteMeta(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const sources = [...new Set(events.map((e) => e.site))].sort((a, b) => a.localeCompare(b));

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

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/events?all=true');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      const fetchedSources = [...new Set(data.events.map((e) => e.site))];
      setEvents(data.events);
      setSelectedSources(new Set(fetchedSources));
      setLastFetched(new Date());
    } catch (err) {
      setError(err.message);
      setEvents([]);
      setSelectedSources(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  const scopeLabel = dateFilterLabel(dateFilter, date);
  const filterActive = sourceFilterActive;
  const displayCount = filteredEvents.length;
  const scopeCount = dateEvents.length;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <h1>EventScraper</h1>
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
                        const first = sources.find((s) => prev.has(s));
                        return first ? new Set([first]) : new Set();
                      });
                    }
                  }}
                />
                Multiple selection
              </label>
            </div>
            <ul className="source-list" role="group" aria-label="Filter by venue">
              {sources.map((name) => {
                const selected = selectedSources.has(name);
                const siteIcon = faviconUrl(resolveSiteOrigin(name, siteMeta));
                return (
                  <li key={name}>
                    <button
                      type="button"
                      className={`source-item${selected ? ' source-item--selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => toggleSource(name)}
                    >
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
                      <span className="source-item-name">{name}</span>
                    </button>
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

            <button
              type="button"
              className="fetch-btn"
              onClick={fetchEvents}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden />
                  Scraping…
                </>
              ) : (
                'Fetch events'
              )}
            </button>
          </div>

          {lastFetched && !loading && (
            <p className="meta">
              Last updated {lastFetched.toLocaleTimeString()} —{' '}
              {filterActive ? `${displayCount} of ${scopeCount}` : displayCount}{' '}
              event{displayCount === 1 ? '' : 's'} for {scopeLabel}
              {filterActive && ' (filtered by source)'}
              {events.length > 0 && (
                <span className="meta-total"> · {events.length} total upcoming</span>
              )}
            </p>
          )}
        </section>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <section className="results card">
          {!lastFetched && !loading && (
            <div className="empty-state">
              <p>Click <strong>Fetch events</strong> to scrape all venues, then filter by date or source.</p>
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
