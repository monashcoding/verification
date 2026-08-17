import { db } from '../db/index.js';
import { events } from '../db/schema.js';
import {
  listLiveEvents,
  getEvent,
  humanitixConfigured,
  HumanitixError,
  HumanitixNotConfigured,
  type HumanitixEvent,
} from '../humanitix/client.js';
import { upsertFromHumanitix } from './upsert.js';

// Keeps our `events` table in step with the org's live Humanitix events, so the
// preview metadata (banner, description, venue, dates) is no longer a side effect
// of an officer clicking "download codes". Read-only against Humanitix — the
// discount CSV upload stays manual (CLAUDE.md).

export interface SyncResult {
  /** false when HUMANITIX_API_KEY isn't set — manual event entry only. */
  configured: boolean;
  created: string[];
  updated: string[];
  /** Set when Humanitix was unreachable; callers treat this as a soft failure. */
  error?: string;
}

/**
 * The list endpoint returns a lighter event shape than the single-event one, and
 * we can't tell "no banner" from "not included in the list payload". Fetching the
 * detail would then be the only way to know — so only pay for that request when
 * the list row has neither banner nor description, and leave existing preview
 * metadata alone if the detail fetch also comes back empty.
 */
async function withDetail(e: HumanitixEvent): Promise<HumanitixEvent> {
  if (e.bannerImageUrl || e.description) return e;
  try {
    return await getEvent(e.id);
  } catch {
    return e;
  }
}

/**
 * Sync every live/upcoming Humanitix event into our events table. New events land
 * `active: true` (see `upsertFromHumanitix`), which is what makes the daily diff
 * provision their member codes without an officer touching anything.
 */
export async function syncLiveEvents(): Promise<SyncResult> {
  if (!humanitixConfigured()) return { configured: false, created: [], updated: [] };

  let live: HumanitixEvent[];
  try {
    live = await listLiveEvents();
  } catch (err) {
    if (err instanceof HumanitixNotConfigured) return { configured: false, created: [], updated: [] };
    if (err instanceof HumanitixError) return { configured: true, created: [], updated: [], error: err.message };
    throw err;
  }

  const before = new Set(
    (await db.select({ humanitixEventId: events.humanitixEventId }).from(events))
      .map((r) => r.humanitixEventId)
      .filter((id): id is string => !!id),
  );

  const created: string[] = [];
  const updated: string[] = [];
  for (const listed of live) {
    const event = await upsertFromHumanitix(await withDetail(listed));
    (before.has(listed.id) ? updated : created).push(event.slug);
  }
  return { configured: true, created, updated };
}
