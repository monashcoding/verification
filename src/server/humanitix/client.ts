// Read-only Humanitix Public API client. Used to list the org's live events so an
// officer doesn't have to hand-enter each event's URL into the admin. This is the
// official API (x-api-key header) — NOT dashboard scripting, and not order/ticket
// sync; we only ever read the event list + a single event's details.

const API_BASE = process.env.HUMANITIX_API_BASE ?? 'https://api.humanitix.com/v1';
const API_KEY = process.env.HUMANITIX_API_KEY;

export class HumanitixNotConfigured extends Error {
  constructor() {
    super('HUMANITIX_API_KEY is not set');
  }
}
export class HumanitixError extends Error {}

export function humanitixConfigured(): boolean {
  return !!API_KEY;
}

export interface HumanitixEvent {
  id: string;
  name: string;
  /** Public event URL — the base for the auto-apply discount link. */
  url: string;
  slug: string;
  startDate: string | null;
  endDate: string | null;
}

interface RawEvent {
  _id: string;
  name: string;
  url?: string;
  slug?: string;
  startDate?: string;
  endDate?: string;
  public?: boolean;
  published?: boolean;
  isArchived?: boolean;
  isPermanentlyArchived?: boolean;
}

async function call(path: string): Promise<unknown> {
  if (!API_KEY) throw new HumanitixNotConfigured();
  const res = await fetch(`${API_BASE}${path}`, { headers: { 'x-api-key': API_KEY } });
  if (!res.ok) {
    throw new HumanitixError(`Humanitix API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

function toEvent(r: RawEvent): HumanitixEvent {
  return {
    id: r._id,
    name: r.name,
    url: r.url ?? '',
    slug: r.slug ?? '',
    startDate: r.startDate ?? null,
    endDate: r.endDate ?? null,
  };
}

function isLive(r: RawEvent): boolean {
  return !!r.published && !!r.public && !r.isArchived && !r.isPermanentlyArchived;
}

/**
 * List the org's live, upcoming events (published + public, not archived). Uses
 * `inFutureOnly=true` so past events drop off. Pages until exhausted (capped).
 */
export async function listLiveEvents(): Promise<HumanitixEvent[]> {
  const pageSize = 100;
  const out: HumanitixEvent[] = [];
  for (let page = 1; page <= 20; page++) {
    const body = (await call(`/events?page=${page}&pageSize=${pageSize}&inFutureOnly=true`)) as {
      events?: RawEvent[];
    };
    const events = body.events ?? [];
    for (const e of events) if (isLive(e)) out.push(toEvent(e));
    if (events.length < pageSize) break;
  }
  return out;
}

/** Fetch a single event by its Humanitix id. */
export async function getEvent(eventId: string): Promise<HumanitixEvent> {
  const raw = (await call(`/events/${encodeURIComponent(eventId)}`)) as RawEvent;
  return toEvent(raw);
}
