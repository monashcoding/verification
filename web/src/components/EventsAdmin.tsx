import { useCallback, useEffect, useState } from 'react';
import {
  fetchEvents,
  createEvent,
  downloadCodesCsv,
  fetchHumanitixEvents,
  downloadHumanitixCsv,
  type CreateEventInput,
  type HumanitixEventView,
} from '../api.js';
import type { EventAdmin } from '../types.js';

// Events admin (§8) + code CSV download (§9).
//
// Primary path: pull the org's live events straight from the Humanitix API so no
// URL entry is needed — click "Download codes CSV" and the internal event record
// is created behind the scenes. Manual entry stays as a fallback (no API key, or
// an event that isn't on Humanitix).
//
// Below that, every event this app knows about — including ones synced from
// Humanitix — so an officer can see which verify links are live. Events whose
// date has passed are retired automatically (server side) and listed separately.
export function EventsAdmin() {
  const [internal, setInternal] = useState<EventAdmin[] | null>(null);

  const loadInternal = useCallback(async () => {
    try {
      setInternal(await fetchEvents());
    } catch {
      setInternal([]);
    }
  }, []);

  useEffect(() => {
    void loadInternal();
  }, [loadInternal]);

  return (
    <div className="card">
      <h3>Events</h3>
      <p className="muted">
        Live events pull automatically from Humanitix. Download an event’s CSV and upload it to that
        event’s <em>Promote → Discounts → CSV upload</em> in Humanitix.
      </p>
      <HumanitixEvents onChanged={loadInternal} />
      <InternalEvents events={internal} />
      <ManualEvents onCreated={loadInternal} />
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function HumanitixEvents({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'ok'; events: HumanitixEventView[] }
    | { phase: 'not_configured' }
    | { phase: 'error'; message: string }
  >({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const res = await fetchHumanitixEvents();
      if (res.kind === 'ok') setState({ phase: 'ok', events: res.events });
      else if (res.kind === 'not_configured') setState({ phase: 'not_configured' });
      else setState({ phase: 'error', message: res.message });
    } catch {
      setState({ phase: 'error', message: 'Could not load Humanitix events.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === 'loading') return <p className="muted small">Loading live events from Humanitix…</p>;
  if (state.phase === 'not_configured') {
    return (
      <p className="muted small">
        Auto-listing is off — set <code>HUMANITIX_API_KEY</code> to pull live events. Add events
        manually below in the meantime.
      </p>
    );
  }
  if (state.phase === 'error') return <p className="error">{state.message}</p>;
  if (state.events.length === 0) return <p className="muted small">No live events on Humanitix right now.</p>;

  return (
    <div className="event-list">
      {state.events.map((e) => (
        <HumanitixRow
          key={e.humanitixEventId}
          event={e}
          onChanged={() => {
            void load();
            onChanged();
          }}
        />
      ))}
    </div>
  );
}

function HumanitixRow({ event, onChanged }: { event: HumanitixEventView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setMsg(null);
    const res = await downloadHumanitixCsv(event.humanitixEventId, event.name);
    setBusy(false);
    if (!res.ok) setMsg(res.message);
    else {
      setMsg('CSV downloaded — upload it to Humanitix Promote → Discounts.');
      onChanged();
    }
  }

  const dates = [fmtDate(event.startDate), fmtDate(event.endDate)].filter(Boolean).join(' – ');
  return (
    <div className="event-row">
      <div>
        <strong>{event.name}</strong>
        <div className="muted small">
          {dates && <>{dates} · </>}
          {event.synced ? `${event.codeCount} codes generated` : 'not yet generated'}
        </div>
        {msg && <div className="muted small">{msg}</div>}
      </div>
      <button className="primary" onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download codes CSV'}
      </button>
    </div>
  );
}

// ── Everything this app knows about ───────────────────────────────────────────

// A passed event is retired server-side, so `active` is the live/finished split
// here. Kept visible (not deleted) so the codes already issued stay auditable.
function InternalEvents({ events }: { events: EventAdmin[] | null }) {
  if (!events) return <p className="muted small">Loading events…</p>;
  if (events.length === 0) return null;

  const live = events.filter((e) => e.active);
  const past = events.filter((e) => !e.active);

  return (
    <>
      <h4>Verify links</h4>
      {live.length === 0 ? (
        <p className="muted small">No live events yet — download a CSV above, or add one manually.</p>
      ) : (
        <div className="event-list">
          {live.map((e) => (
            <InternalRow key={e.id} event={e} />
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
              <InternalRow key={e.id} event={e} past />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function InternalRow({ event, past = false }: { event: EventAdmin; past?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setMsg(null);
    const res = await downloadCodesCsv(event.id, event.slug);
    setBusy(false);
    setMsg(res.ok ? 'CSV downloaded.' : res.message);
  }
  const dates = [fmtDate(event.startDate), fmtDate(event.endDate)].filter(Boolean).join(' – ');
  return (
    <div className="event-row">
      <div>
        <strong>{event.name}</strong>
        <div className="muted small">
          /e/{event.slug} · {dates ? `${dates} · ` : ''}
          {event.codeCount} codes
          {event.humanitixEventId ? '' : ' · manual'}
        </div>
        {msg && <div className="muted small">{msg}</div>}
      </div>
      {!past && (
        <button className="secondary" onClick={download} disabled={busy}>
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

