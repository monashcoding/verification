import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/mac-auth.js';
import { getActiveEvents, getEventBySlug } from '../events/query.js';
import {
  resolveLinkState,
  resolveEventOutcome,
  type LinkState,
  type EventOutcome,
} from '../linking/resolve.js';
import { submitStudentId } from '../linking/student-id.js';
import type { Event } from '../db/schema.js';

export const verifyRouter = Router();

// Serialize the account-wide link state for the frontend. Deliberately does not
// leak roster_id — the client only needs to know what to render (§7).
function serializeLinkState(state: LinkState) {
  switch (state.status) {
    case 'linked':
      return { linked: true, canEnterStudentId: false, contactUs: false };
    case 'needs_student_id':
      return {
        linked: false,
        canEnterStudentId: true,
        contactUs: false,
        attemptsRemaining: state.attempts.remaining,
      };
    case 'locked':
      // Not-linked, no more attempts this window — quiet contact-us line (§7).
      return { linked: false, canEnterStudentId: false, contactUs: true };
  }
}

function serializeEvent(event: Event, outcome: EventOutcome) {
  return {
    slug: event.slug,
    name: event.name,
    description: event.description,
    bannerImageUrl: event.bannerImageUrl,
    venueName: event.venueName,
    startDate: event.startDate ? event.startDate.toISOString() : null,
    endDate: event.endDate ? event.endDate.toISOString() : null,
    outcome,
  };
}

// GET /api/verify/events → the active-events list, no auth.
//
// Backs "browse without signing in" on the generic entry point: someone who
// isn't a member (or doesn't want to hand over an account yet) can still see
// what's on and go buy a normal ticket. Same shape as the signed-in list, with
// every outcome fixed at not_member since there's nobody to resolve.
verifyRouter.get('/events', async (_req, res) => {
  const events = await getActiveEvents();
  res.json({
    mode: 'public',
    events: events.map((e) =>
      serializeEvent(e, { state: 'not_member', ticketUrl: e.humanitixEventUrl }),
    ),
  });
});

// GET /api/verify/event/:slug → public event card, no auth.
//
// The signed-out visitor is the one case where the gate could dead-end someone:
// /e/{slug} is what marketing posts publicly, and a non-member has no reason to
// hand over a Google account just to reach a ticket they could always buy. This
// returns only what the Humanitix page already shows anyone, plus the plain
// ticket link — no roster, membership, or link state is involved (§7 "no dead
// end, no error tone").
//
// A slug that exists but is no longer served (retired by the daily cron, or
// simply past) answers 200 `mode: 'ended'` rather than 404: marketing links
// outlive the event, and "this one has finished" is a better landing than a
// generic error. Only a slug we've never heard of is a 404.
verifyRouter.get('/event/:slug', async (req, res) => {
  const event = await getEventBySlug(req.params.slug);
  if (!event) {
    const past = await getEventBySlug(req.params.slug, false);
    if (past) {
      res.json({
        mode: 'ended',
        event: { slug: past.slug, name: past.name, endDate: (past.endDate ?? past.startDate)?.toISOString() ?? null },
      });
      return;
    }
    res.status(404).json({ error: 'unknown_event' });
    return;
  }
  res.json({
    mode: 'public',
    event: serializeEvent(event, { state: 'not_member', ticketUrl: event.humanitixEventUrl }),
  });
});

// GET /api/verify/status         → generic entry point (§7): list active events.
// GET /api/verify/status/:slug   → event-specific entry point (§7): one event.
verifyRouter.get('/status/:slug?', requireAuth, async (req, res) => {
  const user = req.macUser!;
  const linkState = await resolveLinkState(user);
  const slug = typeof req.params.slug === 'string' ? req.params.slug : undefined;

  if (slug) {
    const event = await getEventBySlug(slug);
    if (!event) {
      res.status(404).json({ error: 'unknown_event' });
      return;
    }
    const outcome = await resolveEventOutcome(linkState, event);
    res.json({
      mode: 'event',
      link: serializeLinkState(linkState),
      event: serializeEvent(event, outcome),
    });
    return;
  }

  const events = await getActiveEvents();
  const eventsOut = await Promise.all(
    events.map(async (e) => serializeEvent(e, await resolveEventOutcome(linkState, e))),
  );
  res.json({ mode: 'generic', link: serializeLinkState(linkState), events: eventsOut });
});

const studentIdSchema = z.object({
  studentId: z.string().min(1).max(64),
  slug: z.string().min(1).max(200).optional(),
});

// POST /api/verify/student-id  { studentId, slug? }
// Attempt to link via student ID, then return the freshly-resolved state so the
// client re-renders in one round trip.
verifyRouter.post('/student-id', requireAuth, async (req, res) => {
  const parsed = studentIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const user = req.macUser!;
  const result = await submitStudentId(user.macUserId, parsed.data.studentId);

  if (result.outcome === 'retry') {
    // Under the cap — generic message, no re-resolve needed (still not linked).
    res.status(422).json({
      linked: false,
      message: result.message,
      attemptsRemaining: result.attempts.remaining,
    });
    return;
  }

  // linked or locked → re-resolve so the response mirrors GET /status.
  const linkState = await resolveLinkState(user);
  const slug = parsed.data.slug;
  if (slug) {
    const event = await getEventBySlug(slug);
    if (!event) {
      res.status(404).json({ error: 'unknown_event' });
      return;
    }
    const outcome = await resolveEventOutcome(linkState, event);
    res.json({ mode: 'event', link: serializeLinkState(linkState), event: serializeEvent(event, outcome) });
    return;
  }
  const events = await getActiveEvents();
  const eventsOut = await Promise.all(
    events.map(async (e) => serializeEvent(e, await resolveEventOutcome(linkState, e))),
  );
  res.json({ mode: 'generic', link: serializeLinkState(linkState), events: eventsOut });
});
