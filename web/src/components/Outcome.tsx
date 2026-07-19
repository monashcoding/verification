import type { EventView } from '../types.js';

/**
 * Event preview card (§7). Structure + styling mirror monashcoding-site's
 * EventCard: inset 2:1 banner, an "Event" tag top-left and the membership status
 * top-right, white/5 meta pills, then a single clear action. "Not a member" is a
 * normal outcome, never styled as an error.
 */
export function OutcomeCard({ event }: { event: EventView }) {
  const { outcome } = event;
  const tags = (
    <>
      <span className="event-tag plain">Event</span>
      <StatusTag state={outcome.state} />
    </>
  );

  return (
    <div className="event-card">
      {event.bannerImageUrl ? (
        <div className="event-card-banner">
          <img src={event.bannerImageUrl} alt="" loading="lazy" />
          <div className="event-card-tags">{tags}</div>
        </div>
      ) : null}

      <div className="event-card-body">
        {!event.bannerImageUrl && (
          <div className="event-card-tags" style={{ position: 'static' }}>
            {tags}
          </div>
        )}
        <h3>{event.name}</h3>

        {event.description && <p className="event-card-desc">{event.description}</p>}

        {(event.startDate || event.venueName) && (
          <div className="event-card-meta">
            {event.startDate && (
              <span className="meta-pill">
                <CalendarIcon />
                {formatEventDate(event.startDate, event.endDate)}
              </span>
            )}
            {event.venueName && (
              <span className="meta-pill">
                <PinIcon />
                {event.venueName}
              </span>
            )}
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

function StatusTag({ state }: { state: EventView['outcome']['state'] }) {
  if (state === 'not_member') return null;
  const cls = state === 'code_ready' ? 'verified' : 'pending';
  const label = state === 'code_ready' ? 'Member price' : 'Verified';
  return <span className={`event-tag ${cls}`}>{label}</span>;
}

// Matches the reference's en-AU / Melbourne formatting.
function formatEventDate(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return '';
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Melbourne',
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Australia/Melbourne',
  };
  const fmt = (d: Date) =>
    `${d.toLocaleDateString('en-AU', dateOpts)}, ${d.toLocaleTimeString('en-AU', timeOpts)}`;

  const end = endIso ? new Date(endIso) : null;
  if (!end || Number.isNaN(end.getTime())) return fmt(start);
  const sameDay =
    start.toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' }) ===
    end.toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
  const endStr = sameDay ? end.toLocaleTimeString('en-AU', timeOpts) : fmt(end);
  return `${fmt(start)} - ${endStr}`;
}

function CalendarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
