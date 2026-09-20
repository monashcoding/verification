import { useCallback, useEffect, useState } from 'react';
import {
  fetchEvents,
  createEvent,
  downloadCodesCsv,
  revertCodesExport,
  deleteEvent,
  restoreEvent,
  type CreateEventInput,
  type EventsSyncStatus,
} from '../api.js';
import type { EventAdmin } from '../types.js';

// Events admin (§8) + code CSV download (§9).
//
// One list, not two: the server syncs the org's live Humanitix events into our
// events table on every load, so a live event and its verify link are the same
// row. Manual entry stays as a fallback (no API key, or an event that isn't on
// Humanitix). Events whose date has passed are retired automatically (server
// side) and tucked into a collapsed section. Removing one is a soft delete: it
// moves to its own collapsed section and can be restored, because a live
// Humanitix event would otherwise just reappear on the next sync.
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
      <EventList events={state?.events ?? null} onChanged={load} />
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
function EventList({ events, onChanged }: { events: EventAdmin[] | null; onChanged: () => void }) {
  if (!events) return <p className="muted small">Loading events…</p>;

  // Removed first — a removed event is removed whether or not its date passed.
  const removed = events.filter((e) => e.deletedAt);
  const listed = events.filter((e) => !e.deletedAt);
  const live = listed.filter((e) => e.active);
  const past = listed.filter((e) => !e.active);

  return (
    <>
      {live.length === 0 ? (
        <p className="muted small">No live events right now — add one manually below if it isn’t on Humanitix.</p>
      ) : (
        <div className="event-list">
          {live.map((e) => (
            <EventRow key={e.id} event={e} onChanged={onChanged} />
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
              <EventRow key={e.id} event={e} onChanged={onChanged} past />
            ))}
          </div>
        </details>
      )}
      {removed.length > 0 && (
        <details className="past-events">
          <summary>{removed.length} removed {removed.length === 1 ? 'event' : 'events'}</summary>
          <p className="muted small">
            Hidden from the verify pages and from code provisioning. Their codes are kept, so
            restoring one brings it back exactly as it was — inactive until you download its CSV
            again.
          </p>
          <div className="event-list">
            {removed.map((e) => (
              <EventRow key={e.id} event={e} onChanged={onChanged} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function EventRow({ event, onChanged, past = false }: { event: EventAdmin; onChanged: () => void; past?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setMsg(null);
    const res = await downloadCodesCsv(event.id, event.slug);
    setBusy(false);
    setMsg(res.ok ? 'CSV downloaded — upload it to Humanitix Promote → Discounts.' : res.message);
    if (res.ok) onChanged();
  }
  async function remove() {
    if (
      !window.confirm(
        `Remove ${event.name} from this list? Its verify link stops working and no more codes are generated. Codes already issued are kept, and you can restore it.`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    const res = await deleteEvent(event.id);
    setBusy(false);
    if (res.ok) onChanged();
    else setMsg(res.message);
  }
  async function restore() {
    setBusy(true);
    setMsg(null);
    const res = await restoreEvent(event.id);
    setBusy(false);
    if (res.ok) onChanged();
    else setMsg(res.message);
  }
  async function undo() {
    if (!window.confirm(`Mark ${event.name}'s codes as not uploaded? Members will get the normal ticket link until you download the CSV again.`)) return;
    setBusy(true);
    setMsg(null);
    const res = await revertCodesExport(event.id);
    setBusy(false);
    setMsg(res.ok ? 'Undone — members get the normal ticket link for this event.' : res.message);
    if (res.ok) onChanged();
  }
  const dates = [fmtDate(event.startDate), fmtDate(event.endDate)].filter(Boolean).join(' – ');
  return (
    <div className="event-row">
      <div>
        <strong>{event.name}</strong>
        <div className="muted small">
          {dates ? `${dates} · ` : ''}/e/{event.slug} · {event.codeCount} codes
          {event.humanitixEventId ? '' : ' · manual'}
          {event.codesOnHold ? ' · not uploaded (on hold)' : event.exportedCount > 0 ? ' · sent out' : ''}
          {event.deletedAt ? ' · removed' : ''}
        </div>
        {msg && <div className="muted small">{msg}</div>}
      </div>
      {event.deletedAt ? (
        <div className="event-row-actions">
          <button className="secondary" onClick={restore} disabled={busy}>
            {busy ? 'Working…' : 'Restore'}
          </button>
        </div>
      ) : (
        <div className="event-row-actions">
          {!past && (
            <>
              <button className="primary" onClick={download} disabled={busy}>
                {busy ? 'Working…' : 'Download codes CSV'}
              </button>
              {event.exportedCount > 0 && (
                <button className="secondary" onClick={undo} disabled={busy} title="Use this if the CSV was downloaded but never uploaded to Humanitix">
                  Undo download
                </button>
              )}
            </>
          )}
          <button
            className="secondary danger"
            onClick={remove}
            disabled={busy}
            title="Hide this event from the verify pages. Codes are kept and it can be restored."
          >
            Remove
          </button>
        </div>
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
    } else if (res.kind === 'slug_taken')
      setError(
        res.removed
          ? 'That slug belongs to a removed event — restore it below instead of creating a duplicate.'
          : 'That slug is already used by another event.',
      );
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

