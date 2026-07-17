import type { EventView } from '../types.js';

/**
 * Render a single event's outcome (§7). Never an error tone for "not a member" —
 * it's a normal, common outcome; we just show the plain ticket link.
 */
export function OutcomeCard({ event }: { event: EventView }) {
  const { outcome } = event;
  return (
    <div className="card outcome">
      <h3>{event.name}</h3>
      {outcome.state === 'code_ready' && (
        <>
          <p className="badge verified">Member price unlocked</p>
          <a className="primary as-button" href={outcome.autoApplyUrl}>
            Get tickets with your member discount
          </a>
        </>
      )}
      {outcome.state === 'pending' && (
        <>
          <p className="badge pending">Verified</p>
          <p className="muted">
            Your code for this event is being set up — check back soon. You’re confirmed as a
            member, this just takes a moment after a new event goes live.
          </p>
        </>
      )}
      {outcome.state === 'not_member' && (
        <a className="secondary as-button" href={outcome.ticketUrl}>
          Continue to tickets
        </a>
      )}
    </div>
  );
}
