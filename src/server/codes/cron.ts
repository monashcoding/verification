import { provisionEventCodes, buildPendingBatch, markExported } from './provision.js';
import { getActiveEvents, getEventBySlug } from '../events/query.js';
import { discordNotifier, type Notifier } from './notify.js';
import type { Event } from '../db/schema.js';

// §9 code provisioning. Two triggers, both funnel through the same
// provision → build CSV → ping → mark-exported pipeline.

export const BATCH_MIN_SIZE = 5;
export const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/** Whether a pending batch is worth bothering the officer about (§10). */
export function shouldExport(count: number, oldestGeneratedAt: Date | null, now = new Date()): boolean {
  if (count === 0) return false;
  if (count >= BATCH_MIN_SIZE) return true;
  if (oldestGeneratedAt && now.getTime() - oldestGeneratedAt.getTime() >= MAX_PENDING_AGE_MS) return true;
  return false;
}

async function exportAndNotify(event: Event, notifier: Notifier): Promise<number> {
  const batch = await buildPendingBatch(event.id);
  if (batch.count === 0) return 0;
  await notifier.notifyBatch({
    eventName: event.name,
    eventSlug: event.slug,
    count: batch.count,
    csv: batch.csv,
  });
  // Optimistic mark — §9: no way to confirm the officer completed the upload.
  await markExported(batch.codeIds);
  return batch.count;
}

/**
 * Trigger A (§9): a new event was published/activated. Provision the full
 * ENROLLED batch and export it immediately — early buyers need the discount
 * before or around when sales open (§10).
 */
export async function onEventPublished(
  eventOrSlug: Event | string,
  notifier: Notifier = discordNotifier,
): Promise<{ provisioned: number; exported: number }> {
  const event = typeof eventOrSlug === 'string' ? await getEventBySlug(eventOrSlug, false) : eventOrSlug;
  if (!event) throw new Error('event not found');
  const provisioned = await provisionEventCodes(event.id);
  const exported = await exportAndNotify(event, notifier);
  return { provisioned, exported };
}

/**
 * Trigger B (§9): daily diff for still-open events. Catches members who linked
 * after an event's initial batch went out. Only pings when a batch is meaningful
 * (§10) — a single straggler waits until the batch grows or ages past a week.
 */
export async function runDailyDiff(
  notifier: Notifier = discordNotifier,
  now = new Date(),
): Promise<Array<{ slug: string; provisioned: number; exported: number }>> {
  const events = await getActiveEvents();
  const results: Array<{ slug: string; provisioned: number; exported: number }> = [];

  for (const event of events) {
    const provisioned = await provisionEventCodes(event.id);
    const batch = await buildPendingBatch(event.id);
    let exported = 0;
    if (shouldExport(batch.count, batch.oldestGeneratedAt, now)) {
      exported = await exportAndNotify(event, notifier);
    }
    results.push({ slug: event.slug, provisioned, exported });
  }
  return results;
}
