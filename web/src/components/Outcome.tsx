import type { EventView } from '../types.js';

/**
 * Event preview card (§7). Shows the Humanitix banner, name, blurb and date —
 * mirroring how monashcoding.com previews an event — then a single clear action.
 * Membership status rides as a small corner tag so it never competes with the CTA
 * for size. "Not a member" is a normal outcome, never styled as an error.
 */
export function OutcomeCard({ event }: { event: EventView }) {
  const { outcome } = event;
  return (
    <div className="event-card">
      {event.bannerImageUrl && (
        <div className="event-card-banner">
          <img src={event.bannerImageUrl} alt="" loading="lazy" />
          <StatusTag state={outcome.state} overlay />
        </div>
      )}

      <div className="event-card-body">
        {!event.bannerImageUrl && <StatusTag state={outcome.state} />}
        <h3>{event.name}</h3>

        {event.description && <p className="event-card-desc">{event.description}</p>}

        {(event.startDate || event.venueName) && (
          <div className="event-card-meta">
            {event.startDate && (
              <span className="meta-pill">
                <CalendarIcon />
                {formatDateRange(event.startDate, event.endDate)}
              </span>
            )}
            {event.venueName && <span className="meta-venue">{event.venueName}</span>}
          </div>
        )}

        <div className="event-card-action">
          {outcome.state === 'code_ready' && (
            <a className="primary as-button block" href={outcome.autoApplyUrl}>
              Get tickets with your member discount
            </a>
          )}
          {outcome.state === 'pending' && (
            <p className="muted small event-card-note">
              You’re confirmed as a member — your code for this event is being set up. Check back
              soon.
            </p>
          )}
          {outcome.state === 'not_member' && (
            <a className="secondary as-button block" href={outcome.ticketUrl}>
              Continue to tickets
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusTag({ state, overlay }: { state: EventView['outcome']['state']; overlay?: boolean }) {
  if (state === 'not_member') return null;
  const cls = state === 'code_ready' ? 'verified' : 'pending';
  const label = state === 'code_ready' ? 'Member price' : 'Verified';
  return <span className={`event-tag ${cls}${overlay ? ' overlay' : ''}`}>{label}</span>;
}

function formatDateRange(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return '';
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const startStr = `${start.toLocaleDateString(undefined, dateOpts)}, ${start
    .toLocaleTimeString(undefined, timeOpts)
    .toLowerCase()}`;

  const end = endIso ? new Date(endIso) : null;
  if (!end || Number.isNaN(end.getTime())) return startStr;

  const sameDay = start.toDateString() === end.toDateString();
  const endStr = sameDay
    ? end.toLocaleTimeString(undefined, timeOpts).toLowerCase()
    : `${end.toLocaleDateString(undefined, dateOpts)}, ${end
        .toLocaleTimeString(undefined, timeOpts)
        .toLowerCase()}`;
  return `${startStr} – ${endStr}`;
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
