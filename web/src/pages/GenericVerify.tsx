import { useEffect, useState } from 'react';
import { useStatus } from '../useStatus.js';
import { fetchPublicEvents } from '../api.js';
import { StudentIdForm } from '../components/StudentIdForm.js';
import { OutcomeCard } from '../components/Outcome.js';
import { SignIn } from '../components/SignIn.js';
import { AccountBar } from '../components/AccountBar.js';
import type { EventView, GenericStatusResponse } from '../types.js';

// Generic entry point (§7): verify.monashcoding.com/. For a member checking
// their status any time, not tied to one event. Lists active events with buttons
// instead of redirecting — each event's outcome rendered independently.
export function GenericVerify() {
  const { state, setData } = useStatus();
  const [skipped, setSkipped] = useState(false);

  if (state.phase === 'loading') return <Centered>Loading…</Centered>;
  // 'unavailable' is an event-slug outcome; the generic entry has no slug, so it
  // can only mean something unexpected.
  if (state.phase === 'error' || state.phase === 'unavailable')
    return <Centered>Something went wrong. Please refresh.</Centered>;
  if (state.phase === 'unauthenticated') return <SignedOut />;

  const data = state.data as GenericStatusResponse;
  const { link, events } = data;
  const showForm = !link.linked && link.canEnterStudentId && !skipped;

  return (
    <div className="page">
      <AccountBar />
      <h1>MAC member verification</h1>
      <p className="lead">
        Check your MAC membership once and unlock member pricing across every event — no switching
        ticket platforms.
      </p>

      {showForm && (
        <StudentIdForm
          attemptsRemaining={link.attemptsRemaining}
          onResolved={(r) => r.ok && setData(r.status)}
          onSkip={() => setSkipped(true)}
        />
      )}

      {link.contactUs && (
        <p className="muted">Think this is wrong? Contact us and we’ll sort it out.</p>
      )}

      <h2>Active events</h2>
      {events.length === 0 && <p className="muted">No active events right now.</p>}
      <div className="events-grid">
        {events.map((e) => (
          <OutcomeCard key={e.slug} event={e} />
        ))}
      </div>
    </div>
  );
}

/**
 * Signed-out landing. Sign-in is offered, never imposed: the events list is the
 * page, with the membership prompt sitting above it. Someone who isn't a member
 * — or isn't ready to hand over an account — just scrolls and picks an event.
 * Nothing is written either way, so the prompt is there again next visit.
 */
function SignedOut() {
  return (
    <div className="page">
      <h1>MAC events</h1>
      <div className="card">
        <SignIn prompt="MAC member? Sign in to link your membership and unlock member pricing." />
      </div>
      <PublicEvents />
    </div>
  );
}

/** The active-events list as an unauthenticated visitor sees it: every card's
 *  action is the plain ticket link. */
function PublicEvents() {
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetchPublicEvents()
      .then((r) => live && setEvents(r.events))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="muted">Couldn’t load events. Please refresh.</p>;
  if (!events) return <p className="muted">Loading events…</p>;

  return (
    <>
      <h2>Active events</h2>
      {events.length === 0 && <p className="muted">No active events right now.</p>}
      <div className="events-grid">
        {events.map((e) => (
          <OutcomeCard key={e.slug} event={e} />
        ))}
      </div>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="page centered">{children}</div>;
}
