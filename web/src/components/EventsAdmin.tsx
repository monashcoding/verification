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
export function EventsAdmin() {
  return (
    <div className="card">
      <h3>Events</h3>
      <p className="muted">
        Live events pull automatically from Humanitix. Download an event’s CSV and upload it to that
        event’s <em>Promote → Discounts → CSV upload</em> in Humanitix.
      </p>
      <HumanitixEvents />
      <ManualEvents />
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function HumanitixEvents() {
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
        <HumanitixRow key={e.humanitixEventId} event={e} onChanged={load} />
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

// ── Manual fallback ───────────────────────────────────────────────────────────

function ManualEvents() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<EventAdmin[] | null>(null);

  const load = useCallback(async () => {
    try {
      // Only show manually-added events (those without a Humanitix id are the ones
      // not already listed above). We fetch all and show them for completeness.
      setEvents(await fetchEvents());
    } catch {
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <details className="manual-events" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Add an event manually</summary>
      <p className="muted small">For an event not on Humanitix, or if the API key isn’t set.</p>
      <CreateEventForm onCreated={load} />
      <ManualList events={events} />
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

function ManualList({ events }: { events: EventAdmin[] | null }) {
  const manual = (events ?? []).filter((e) => e.codeCount >= 0);
  if (!events) return null;
  if (manual.length === 0) return null;
  return (
    <div className="event-list">
      {manual.map((e) => (
        <ManualRow key={e.id} event={e} />
      ))}
    </div>
  );
}

function ManualRow({ event }: { event: EventAdmin }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setMsg(null);
    const res = await downloadCodesCsv(event.id, event.slug);
    setBusy(false);
    setMsg(res.ok ? 'CSV downloaded.' : res.message);
  }
  return (
    <div className="event-row">
      <div>
        <strong>{event.name}</strong>
        <div className="muted small">/e/{event.slug} · {event.codeCount} codes</div>
        {msg && <div className="muted small">{msg}</div>}
      </div>
      <button className="secondary" onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download codes CSV'}
      </button>
    </div>
  );
}
