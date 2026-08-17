import { useCallback, useEffect, useState } from 'react';
import { fetchEvents, createEvent, downloadCodesCsv, type CreateEventInput, type EventsSyncStatus } from '../api.js';
import type { EventAdmin } from '../types.js';

// Events admin (§8) + code CSV download (§9).
//
// One list, not two: the server syncs the org's live Humanitix events into our
// events table on every load, so a live event and its verify link are the same
// row. Manual entry stays as a fallback (no API key, or an event that isn't on
// Humanitix). Events whose date has passed are retired automatically (server
// side) and tucked into a collapsed section.
export function EventsAdmin() {
  const [state, setState] = useState<{ sync: EventsSyncStatus; events: EventAdmin[] } | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await fetchEvents());
    } catch {
      setState({ sync: { configured: true, error: null }, events: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="card">
      <h3>Events</h3>
      <p className="muted">
        Live events pull automatically from Humanitix. Download an event’s CSV and upload it to that
        event’s <em>Promote → Discounts → CSV upload</em> in Humanitix.
      </p>
      {state && <SyncNotice sync={state.sync} />}
      <EventList events={state?.events ?? null} />
      <ManualEvents onCreated={load} />
    </div>
  );
}

// Only speaks up when the auto-pull didn't happen — otherwise the absence of an
// event would look like a data problem rather than a configuration one.
function SyncNotice({ sync }: { sync: EventsSyncStatus }) {
  if (!sync.configured) {
    return (
      <p className="muted small">
        Auto-listing is off — set <code>HUMANITIX_API_KEY</code> to pull live events in
        automatically. Add events manually below in the meantime.
      </p>
    );
  }
  if (sync.error) {
    return (
      <p className="error">
        Couldn’t reach Humanitix just now, so this list may be out of date. Events already synced
        still work.
      </p>
    );
  }
  return null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// A passed event is retired server-side, so `active` is the live/finished split
// here. Kept visible (not deleted) so the codes already issued stay auditable.
function EventList({ events }: { events: EventAdmin[] | null }) {
  if (!events) return <p className="muted small">Loading events…</p>;

  const live = events.filter((e) => e.active);
  const past = events.filter((e) => !e.active);

  return (
    <>
      {live.length === 0 ? (
        <p className="muted small">No live events right now — add one manually below if it isn’t on Humanitix.</p>
      ) : (
        <div className="event-list">
          {live.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
      {past.length > 0 && (
        <details className="past-events">
          <summary>{past.length} past {past.length === 1 ? 'event' : 'events'}</summary>
          <p className="muted small">
            Retired automatically once the event date passed. Their verify links no longer resolve;
            codes already issued are untouched.
          </p>
          <div className="event-list">
            {past.map((e) => (
              <EventRow key={e.id} event={e} past />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function EventRow({ event, past = false }: { event: EventAdmin; past?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setMsg(null);
    const res = await downloadCodesCsv(event.id, event.slug);
    setBusy(false);
    setMsg(res.ok ? 'CSV downloaded — upload it to Humanitix Promote → Discounts.' : res.message);
  }
  const dates = [fmtDate(event.startDate), fmtDate(event.endDate)].filter(Boolean).join(' – ');
  return (
    <div className="event-row">
      <div>
        <strong>{event.name}</strong>
        <div className="muted small">
          {dates ? `${dates} · ` : ''}/e/{event.slug} · {event.codeCount} codes
          {event.humanitixEventId ? '' : ' · manual'}
        </div>
        {msg && <div className="muted small">{msg}</div>}
      </div>
      {!past && (
        <button className="primary" onClick={download} disabled={busy}>
          {busy ? 'Preparing…' : 'Download codes CSV'}
        </button>
      )}
    </div>
  );
}

// ── Manual fallback ───────────────────────────────────────────────────────────

function ManualEvents({ onCreated }: { onCreated: () => void }) {
  return (
    <details className="manual-events">
      <summary>Add an event manually</summary>
      <p className="muted small">For an event not on Humanitix, or if the API key isn’t set.</p>
      <CreateEventForm onCreated={onCreated} />
    </details>
  );
}

function CreateEventForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<CreateEventInput>({ name: '', slug: '', humanitixEventUrl: '', active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  function set<K extends keyof CreateEventInput>(k: K, v: CreateEventInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function onName(name: string) {
    set('name', name);
    if (!slugTouched) set('slug', name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createEvent(form);
    setBusy(false);
    if (res.kind === 'ok') {
      setForm({ name: '', slug: '', humanitixEventUrl: '', active: true });
      setSlugTouched(false);
      onCreated();
    } else if (res.kind === 'slug_taken') setError('That slug is already used by another event.');
    else if (res.kind === 'invalid') setError('Check the fields — slug must be kebab-case and the URL valid.');
    else if (res.kind === 'forbidden') setError('This account can’t create events.');
    else setError(res.message);
  }

  return (
    <form className="event-form" onSubmit={submit}>
      <label className="field-label">Event name</label>
      <input value={form.name} onChange={(e) => onName(e.target.value)} placeholder="MAC Annual Ball" disabled={busy} />
      <label className="field-label">Slug</label>
      <input value={form.slug} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value); }} placeholder="mac-annual-ball" disabled={busy} />
      <label className="field-label">Humanitix event URL</label>
      <input value={form.humanitixEventUrl} onChange={(e) => set('humanitixEventUrl', e.target.value)} placeholder="https://events.humanitix.com/mac-annual-ball" disabled={busy} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy || !form.name || !form.slug || !form.humanitixEventUrl}>
        {busy ? 'Creating…' : 'Create event & generate codes'}
      </button>
    </form>
  );
}

