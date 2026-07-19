import { useCallback, useEffect, useState } from 'react';
import { fetchEvents, createEvent, downloadCodesCsv, type CreateEventInput } from '../api.js';
import type { EventAdmin } from '../types.js';

// Events admin (§8) + code CSV download (§9). Creating an event auto-provisions a
// unique code per enrolled member; "Download codes CSV" produces the file to
// upload to that event's Humanitix Promote → Discounts → CSV upload.
export function EventsAdmin() {
  const [events, setEvents] = useState<EventAdmin[] | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents(await fetchEvents());
    } catch {
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="card">
      <h3>Events</h3>
      <p className="muted">
        Add each MAC event with member pricing. Creating it generates a unique discount code per
        enrolled member; download the CSV and upload it to that event’s Humanitix
        <em> Promote → Discounts → CSV upload</em>.
      </p>
      <CreateEventForm onCreated={load} />
      <EventList events={events} onChanged={load} />
    </div>
  );
}

function CreateEventForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<CreateEventInput>({ name: '', slug: '', humanitixEventUrl: '', active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CreateEventInput>(k: K, v: CreateEventInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Suggest a kebab-case slug from the name until the user edits the slug.
  const [slugTouched, setSlugTouched] = useState(false);
  function onName(name: string) {
    set('name', name);
    if (!slugTouched) {
      set('slug', name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
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

      <label className="field-label">Slug (used in the link verify.monashcoding.com/e/…)</label>
      <input
        value={form.slug}
        onChange={(e) => { setSlugTouched(true); set('slug', e.target.value); }}
        placeholder="mac-annual-ball"
        disabled={busy}
      />

      <label className="field-label">Humanitix event URL</label>
      <input
        value={form.humanitixEventUrl}
        onChange={(e) => set('humanitixEventUrl', e.target.value)}
        placeholder="https://events.humanitix.com/mac-annual-ball"
        disabled={busy}
      />

      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy || !form.name || !form.slug || !form.humanitixEventUrl}>
        {busy ? 'Creating…' : 'Create event & generate codes'}
      </button>
    </form>
  );
}

function EventList({ events, onChanged }: { events: EventAdmin[] | null; onChanged: () => void }) {
  if (!events) return <p className="muted small">Loading events…</p>;
  if (events.length === 0) return <p className="muted small">No events yet.</p>;

  return (
    <div className="event-list">
      {events.map((e) => (
        <EventRow key={e.id} event={e} onChanged={onChanged} />
      ))}
    </div>
  );
}

function EventRow({ event, onChanged }: { event: EventAdmin; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setMsg(null);
    const res = await downloadCodesCsv(event.id, event.slug);
    setBusy(false);
    if (!res.ok) setMsg(res.message);
    else {
      setMsg('CSV downloaded — upload it to Humanitix Promote → Discounts.');
      onChanged(); // code count / exported state may have changed
    }
  }

  return (
    <div className="event-row">
      <div>
        <strong>{event.name}</strong>{' '}
        {!event.active && <span className="badge pending">inactive</span>}
        <div className="muted small">
          /e/{event.slug} · {event.codeCount} code{event.codeCount === 1 ? '' : 's'} generated
        </div>
        {msg && <div className="muted small">{msg}</div>}
      </div>
      <button className="secondary" onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download codes CSV'}
      </button>
    </div>
  );
}
