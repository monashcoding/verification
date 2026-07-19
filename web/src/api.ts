import { ensureToken, fetchToken } from './auth.js';
import type { EventAdmin, RosterSummary, StatusResponse, StudentIdRetryResponse } from './types.js';

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

/**
 * Authenticated fetch: attaches the Bearer token and refreshes it once on 401.
 * Does not set Content-Type — callers do (JSON) or leave it for FormData uploads.
 */
async function authedFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await ensureToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    // The 15-minute JWT may have expired — refresh once from the session cookie.
    if (retry && (await fetchToken())) return authedFetch(path, init, false);
    throw new UnauthorizedError('not authenticated');
  }
  return res;
}

function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return authedFetch(path, { ...init, headers });
}

/** GET the resolution status. Pass a slug for the event-specific entry point. */
export async function fetchStatus(slug?: string): Promise<StatusResponse> {
  const res = await apiFetch(`/api/verify/status${slug ? `/${encodeURIComponent(slug)}` : ''}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export type SubmitResult =
  | { ok: true; status: StatusResponse }
  | { ok: false; retry: StudentIdRetryResponse };

export async function submitStudentId(studentId: string, slug?: string): Promise<SubmitResult> {
  const res = await apiFetch('/api/verify/student-id', {
    method: 'POST',
    body: JSON.stringify({ studentId, slug }),
  });
  if (res.status === 422) return { ok: false, retry: await res.json() };
  if (!res.ok) throw new Error(`status ${res.status}`);
  return { ok: true, status: await res.json() };
}

// ── Admin: roster (§6, §11) ───────────────────────────────────────────────────

export async function fetchRosterSummary(): Promise<RosterSummary> {
  const res = await authedFetch('/api/admin/roster/summary');
  if (res.status === 403) throw new ForbiddenError();
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export interface ImportResult {
  importBatchId: string;
  totalRows: number;
  enrolledRows: number;
  previousEnrolled: number;
  overrideUsed: boolean;
}

export type ImportOutcome =
  | { kind: 'ok'; result: ImportResult }
  // Safety gate (§6): incoming ENROLLED is 0 or < half — needs an override.
  | { kind: 'safety_gate'; message: string; currentEnrolled: number; incomingEnrolled: number }
  | { kind: 'parse_error'; message: string }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

export async function uploadRoster(file: File, override: boolean): Promise<ImportOutcome> {
  const form = new FormData();
  form.append('file', file);
  if (override) form.append('override', 'true');

  const res = await authedFetch('/api/admin/roster/import', { method: 'POST', body: form });
  if (res.status === 403) return { kind: 'forbidden' };
  if (res.status === 409) {
    const b = await res.json();
    return {
      kind: 'safety_gate',
      message: b.message,
      currentEnrolled: b.currentEnrolled,
      incomingEnrolled: b.incomingEnrolled,
    };
  }
  if (res.status === 422) return { kind: 'parse_error', message: (await res.json()).message };
  if (!res.ok) return { kind: 'error', message: `Upload failed (${res.status})` };
  return { kind: 'ok', result: await res.json() };
}

// ── Admin: events + codes (§8, §9) ────────────────────────────────────────────

export async function fetchEvents(): Promise<EventAdmin[]> {
  const res = await authedFetch('/api/admin/events');
  if (res.status === 403) throw new ForbiddenError();
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export interface CreateEventInput {
  name: string;
  slug: string;
  humanitixEventUrl: string;
  active: boolean;
}

export type CreateEventOutcome =
  | { kind: 'ok'; event: EventAdmin }
  | { kind: 'slug_taken' }
  | { kind: 'invalid' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

export async function createEvent(input: CreateEventInput): Promise<CreateEventOutcome> {
  const res = await apiFetch('/api/admin/events', { method: 'POST', body: JSON.stringify(input) });
  if (res.status === 403) return { kind: 'forbidden' };
  if (res.status === 409) return { kind: 'slug_taken' };
  if (res.status === 400) return { kind: 'invalid' };
  if (!res.ok) return { kind: 'error', message: `Failed (${res.status})` };
  return { kind: 'ok', event: (await res.json()).event };
}

async function triggerCsvDownload(res: Response, slug: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (res.status === 409) return { ok: false, message: (await res.json()).message };
  if (res.status === 501) return { ok: false, message: 'Humanitix isn’t configured (HUMANITIX_API_KEY).' };
  if (res.status === 502) return { ok: false, message: `Humanitix error: ${(await res.json()).message ?? ''}` };
  if (!res.ok) return { ok: false, message: `Download failed (${res.status})` };

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `codes-${slug}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}

/** Download the Humanitix discount CSV for an internal event. */
export async function downloadCodesCsv(eventId: number, slug: string) {
  return triggerCsvDownload(await authedFetch(`/api/admin/events/${eventId}/codes.csv`), slug);
}

// ── Admin: live Humanitix events (auto-listed) ────────────────────────────────

export interface HumanitixEventView {
  humanitixEventId: string;
  name: string;
  url: string;
  startDate: string | null;
  endDate: string | null;
  synced: boolean;
  slug: string | null;
  codeCount: number;
}

export type HumanitixListResult =
  | { kind: 'ok'; events: HumanitixEventView[] }
  | { kind: 'not_configured' }
  | { kind: 'error'; message: string };

export async function fetchHumanitixEvents(): Promise<HumanitixListResult> {
  const res = await authedFetch('/api/admin/humanitix/events');
  if (res.status === 501) return { kind: 'not_configured' };
  if (res.status === 403) throw new ForbiddenError();
  if (res.status === 502) return { kind: 'error', message: (await res.json()).message ?? 'Humanitix error' };
  if (!res.ok) return { kind: 'error', message: `Failed (${res.status})` };
  return { kind: 'ok', events: await res.json() };
}

/** Download codes for a live Humanitix event (creates the internal record). */
export async function downloadHumanitixCsv(hxId: string, name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
  return triggerCsvDownload(
    await authedFetch(`/api/admin/humanitix/events/${encodeURIComponent(hxId)}/codes.csv`),
    slug,
  );
}
