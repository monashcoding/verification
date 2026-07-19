import { ensureToken, fetchToken } from './auth.js';
import type { RosterSummary, StatusResponse, StudentIdRetryResponse } from './types.js';

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
