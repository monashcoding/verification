import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStatus } from '../useStatus.js';
import { fetchPublicEvent } from '../api.js';
import { StudentIdForm } from '../components/StudentIdForm.js';
import { OutcomeCard } from '../components/Outcome.js';
import { SignIn } from '../components/SignIn.js';
import { AccountBar } from '../components/AccountBar.js';
import type { EventStatusResponse, PublicEventLookup } from '../types.js';

// Event-specific entry point (§7): verify.monashcoding.com/e/{slug}. What
// marketing links to. Shows the event as a preview card (consistent with the
// generic page) with a manual action — never a silent bounce (§7).
export function EventVerify() {
  const { slug } = useParams<{ slug: string }>();
  const { state, setData } = useStatus(slug);
  const [skipped, setSkipped] = useState(false);

  if (state.phase === 'loading') return <Centered>Checking your membership…</Centered>;
  if (state.phase === 'error') return <Centered>Something went wrong. Please refresh.</Centered>;
  if (state.phase === 'unavailable') return <Unavailable slug={slug!} />;
  if (state.phase === 'unauthenticated') return <SignedOut slug={slug!} />;

  const data = state.data as EventStatusResponse;
  const { link, event } = data;
  // Not linked yet and still able to try → the student-ID step (primary path).
  const showForm = !link.linked && link.canEnterStudentId && !skipped;

  return (
    <div className="page">
      <AccountBar />
      <h1>{event.name}</h1>
      {/* When the student-ID form is showing, the card is a pure preview and the
          form carries the action; otherwise the card's own CTA sends them on. */}
      <OutcomeCard event={event} previewOnly={showForm} />

      {showForm && (
        <StudentIdForm
          slug={slug}
          ticketUrl={event.outcome.state === 'not_member' ? event.outcome.ticketUrl : undefined}
          attemptsRemaining={link.attemptsRemaining}
          onResolved={(r) => r.ok && setData(r.status)}
          onSkip={() => setSkipped(true)}
        />
      )}

      {link.contactUs && (
        <p className="muted small">Think this is wrong? Contact us and we’ll sort it out.</p>
      )}
    </div>
  );
}

/** Public lookup for one slug, shared by the signed-out and unavailable views. */
type PublicState = { phase: 'loading' } | { phase: 'unknown' } | { phase: 'found'; data: PublicEventLookup };

function usePublicEvent(slug: string): PublicState {
  const [state, setState] = useState<PublicState>({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    fetchPublicEvent(slug)
      .then((data) => live && setState({ phase: 'found', data }))
      // A network failure reads the same as an unknown slug here: either way we
      // have nothing to show about this event.
      .catch(() => live && setState({ phase: 'unknown' }));
    return () => {
      live = false;
    };
  }, [slug]);

  return state;
}

/**
 * Signed-out view. Sign-in is how membership gets checked, but it must not gate
 * the ticket itself — this link is posted publicly, and plenty of people who
 * click it aren't MAC members (§7 "no dead end"). So we show the event and the
 * plain Humanitix link alongside the sign-in prompt, using the same public
 * endpoint the card would get anyway. No membership data is involved.
 */
function SignedOut({ slug }: { slug: string }) {
  const lookup = usePublicEvent(slug);
  const signIn = <SignIn prompt="Sign in to check your MAC member pricing for this event." />;

  if (lookup.phase === 'loading') return <Centered>Loading…</Centered>;
  // Signed-out requests are rejected by requireAuth before the slug is ever
  // checked, so this — not `Unavailable` — is where a bad link lands for someone
  // who isn't signed in. Both states have to be handled here too.
  if (lookup.phase === 'unknown') return <NotFoundNotice />;
  if (lookup.data.mode === 'ended') return <EndedNotice name={lookup.data.event.name} />;

  const { event } = lookup.data;
  return (
    <div className="page">
      <h1>{event.name}</h1>
      <OutcomeCard event={event} previewOnly />
      <div className="card">
        {signIn}
        {event.outcome.state === 'not_member' && (
          <p className="muted small">
            Not a MAC member?{' '}
            <a href={event.outcome.ticketUrl}>Continue to tickets at the standard price.</a>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The slug resolved for nobody — retired, past, or never existed. Marketing
 * links outlive their events, so say which it is and point somewhere useful
 * instead of showing the generic "something went wrong" screen.
 */
function Unavailable({ slug }: { slug: string }) {
  const lookup = usePublicEvent(slug);

  if (lookup.phase === 'loading') return <Centered>Loading…</Centered>;
  if (lookup.phase === 'found') {
    if (lookup.data.mode === 'ended') return <EndedNotice name={lookup.data.event.name} />;
    // Active again between the two calls — rare; a reload is the honest fix.
    return <Centered>Please refresh.</Centered>;
  }

  return <NotFoundNotice />;
}

function NotFoundNotice() {
  return (
    <Centered>
      <h1>Event not found</h1>
      <p className="muted">
        We couldn’t find that event. It may have been removed, or the link may be mistyped.
      </p>
      <p>
        <a href="/">See MAC’s upcoming events</a>
      </p>
    </Centered>
  );
}

function EndedNotice({ name }: { name: string }) {
  return (
    <Centered>
      <h1>{name}</h1>
      <p className="muted">This event has finished, so tickets are no longer available.</p>
      <p>
        <a href="/">See MAC’s upcoming events</a>
      </p>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="page centered">{children}</div>;
}
