import { getToken } from './auth.js';
import type { StatusResponse, StudentIdRetryResponse } from './types.js';

export class UnauthorizedError extends Error {}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) throw new UnauthorizedError('not authenticated');
  return res;
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
